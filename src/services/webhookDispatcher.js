// =============================================================
// Webhook Dispatcher — 외부 시스템 통합 발송기
//
// 기능:
//   • 이벤트 발생 시 등록된 모든 webhook 으로 비동기 POST
//   • HMAC-SHA256 서명 (시크릿)
//   • 3회 백오프 재시도 (5초 / 30초 / 5분)
//   • 발송 결과 webhook_deliveries 에 기록
//   • 메인 트랜잭션 차단 안 함 (fire-and-forget via setImmediate)
//
// 사용:
//   const wh = require('./services/webhookDispatcher');
//   wh.emit('lead.won', { id: 123, customer_name: '...', ... });
// =============================================================
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const pool = require('../db');

// 환경 변수: 개발 모드에서 http:// 허용
const ALLOW_HTTP =
  process.env.WEBHOOK_ALLOW_HTTP === 'true' || process.env.NODE_ENV !== 'production';
const TIMEOUT_MS = 10 * 1000;
const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000]; // 3회 백오프
const MAX_PAYLOAD_PREVIEW = 480;

// 화이트리스트 — 추후 UI 에서 관리 가능
const ALLOWED_EVENTS = new Set([
  'lead.created',
  'lead.stage_changed',
  'lead.won',
  'project.completed',
  'meeting.created',
]);

function isAllowedEvent(eventType) {
  return ALLOWED_EVENTS.has(eventType);
}

function listAllowedEvents() {
  return [...ALLOWED_EVENTS];
}

function generateDeliveryId() {
  return crypto.randomBytes(16).toString('hex');
}

function signPayload(payload, secret) {
  if (!secret) return null;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return 'sha256=' + hmac.digest('hex');
}

// HTTP POST — Node 내장 모듈 (의존성 없음)
function postJson(targetUrl, headers, body) {
  return new Promise(resolve => {
    let urlObj;
    try {
      urlObj = new URL(targetUrl);
    } catch (_) {
      return resolve({ ok: false, error: 'INVALID_URL' });
    }

    const isHttps = urlObj.protocol === 'https:';
    if (!isHttps && !ALLOW_HTTP) {
      return resolve({ ok: false, error: 'HTTP_NOT_ALLOWED' });
    }

    const lib = isHttps ? https : http;
    const t0 = Date.now();
    const req = lib.request(
      urlObj,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
        timeout: TIMEOUT_MS,
      },
      res => {
        let chunks = '';
        res.on('data', d => {
          if (chunks.length < 2000) chunks += d.toString();
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            ms: Date.now() - t0,
            body: chunks.slice(0, 500),
          });
        });
      }
    );

    req.on('error', err => {
      resolve({ ok: false, error: err.code || err.message, ms: Date.now() - t0 });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT', ms: Date.now() - t0 });
    });
    req.write(body);
    req.end();
  });
}

// 단일 webhook 으로 발송 (재시도 포함)
async function deliverToWebhook(webhook, eventType, data, deliveryId, attempt = 1) {
  const payload = JSON.stringify({
    event: eventType,
    delivery_id: deliveryId,
    timestamp: new Date().toISOString(),
    data,
  });

  const headers = {
    'X-OCI-Event': eventType,
    'X-OCI-Delivery': deliveryId,
    'X-OCI-Attempt': String(attempt),
  };
  const sig = signPayload(payload, webhook.secret);
  if (sig) headers['X-OCI-Signature'] = sig;

  const result = await postJson(webhook.url, headers, payload);

  // 로그 기록
  try {
    await pool.query(
      `INSERT INTO webhook_deliveries
         (webhook_id, event_type, delivery_id, status, http_status,
          response_ms, attempt, error_message, payload_preview)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        webhook.id,
        eventType,
        deliveryId,
        result.ok ? 'success' : 'failed',
        result.status || null,
        result.ms || null,
        attempt,
        result.error || null,
        payload.slice(0, MAX_PAYLOAD_PREVIEW),
      ]
    );
  } catch (_) {
    /* 로그 실패는 무시 */
  }

  // webhook 상태 업데이트
  try {
    if (result.ok) {
      await pool.query(
        `UPDATE webhooks SET failure_count = 0,
                              last_status   = 'success',
                              last_sent_at  = NOW()
            WHERE id = ?`,
        [webhook.id]
      );
    } else {
      await pool.query(
        `UPDATE webhooks SET failure_count = failure_count + 1,
                              last_status   = ?,
                              last_sent_at  = NOW()
            WHERE id = ?`,
        [result.error || 'failed', webhook.id]
      );
    }
  } catch (_) {
    /* 무시 */
  }

  // 재시도
  if (!result.ok && attempt < RETRY_DELAYS_MS.length + 1) {
    const delay = RETRY_DELAYS_MS[attempt - 1];
    setTimeout(() => {
      deliverToWebhook(webhook, eventType, data, deliveryId, attempt + 1).catch(() => {});
    }, delay);
  }

  return result;
}

// 메인 진입점 — 이벤트 발행
function emit(eventType, data) {
  if (!isAllowedEvent(eventType)) {
    // 허용되지 않은 이벤트는 조용히 무시 (개발 중 오타 방지)
    return;
  }

  // 메인 코드 차단 안 함
  setImmediate(async () => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, url, event_types, secret
           FROM webhooks
          WHERE is_active = 1`
      );
      for (const w of rows) {
        let types;
        try {
          types = JSON.parse(w.event_types);
        } catch (_) {
          continue;
        }
        if (!Array.isArray(types) || !types.includes(eventType)) continue;

        const deliveryId = generateDeliveryId();
        deliverToWebhook(w, eventType, data, deliveryId).catch(() => {});
      }
    } catch (_) {
      /* DB 오류 등 — 메인 흐름 차단 안 함 */
    }
  });
}

// 수동 테스트 발송 (Settings UI 의 "테스트 발송" 버튼 용)
async function testDispatch(webhookId, sampleEvent = 'lead.won') {
  const [[w]] = await pool.query(
    `SELECT id, name, url, event_types, secret FROM webhooks WHERE id = ?`,
    [webhookId]
  );
  if (!w) throw new Error('webhook not found');
  const sampleData = {
    id: 0,
    customer_name: '__TEST__',
    project_name: 'Webhook Test',
    note: '이것은 OCI CRM Webhook 테스트 발송입니다.',
  };
  const deliveryId = generateDeliveryId();
  return deliverToWebhook(w, sampleEvent, sampleData, deliveryId);
}

module.exports = {
  emit,
  testDispatch,
  signPayload, // 단위 테스트용
  isAllowedEvent,
  listAllowedEvents,
  generateDeliveryId, // 단위 테스트용
};
