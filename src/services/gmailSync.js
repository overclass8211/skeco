'use strict';
// =============================================================
// Gmail Sync — Phase G3
//
// 동작:
//   1) 5분 주기로 server.js 가 pollAll() 호출
//   2) gmail_sync_enabled=1 인 사용자별로 pollOne(userId) 실행
//   3) 마지막 폴링 시각 이후의 새 메시지 fetch
//   4) From/To 의 이메일 주소를 customers.email 과 매칭
//   5) 매칭 시 activities INSERT (gmail_message_id UNIQUE 로 중복 차단)
//   6) gmail_last_polled_at 갱신
//
// 중복 방지:
//   activities.gmail_message_id UNIQUE 인덱스 — INSERT 시 ER_DUP_ENTRY 무시.
//   서버 재시작, cron 재실행, 두 사용자가 같은 메시지를 받는 경우 등 모두 안전.
//
// 매칭 정책:
//   - From/To 주소 중 어느 것이라도 customers.email 과 일치하면 매칭
//   - 매칭된 customer 의 최근 활성 lead (stage NOT IN won/lost/dropped) 가 있으면 lead_id 함께 기록
//   - 매칭 0건 시 INSERT 안 함 (개인 메일은 활동에 안 들어감 — 프라이버시 보호)
//
// 옵트인:
//   기본값 0. 사용자가 UI 에서 "Gmail 자동 동기화" 토글 → enabled=1.
// =============================================================

const pool = require('../db');
const gmail = require('./gmail');

// ── 자가 마이그레이션 (모듈 로드 시 1회, idempotent) ──────────
// 기존 google_oauth_tokens 에 컬럼 3개, activities 에 컬럼+UNIQUE 인덱스 추가.
// 테스트에서 await 가능하도록 promise 를 export.
async function ensureSchema() {
  const stmts = [
    `ALTER TABLE google_oauth_tokens
       ADD COLUMN IF NOT EXISTS gmail_sync_enabled TINYINT(1) DEFAULT 0`,
    `ALTER TABLE google_oauth_tokens
       ADD COLUMN IF NOT EXISTS gmail_last_polled_at TIMESTAMP NULL`,
    `ALTER TABLE google_oauth_tokens
       ADD COLUMN IF NOT EXISTS gmail_sync_error VARCHAR(500) NULL`,
    `ALTER TABLE activities
       ADD COLUMN IF NOT EXISTS gmail_message_id VARCHAR(64) NULL
       COMMENT 'Gmail 메시지 ID (G3 동기화 중복 방지)'`,
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (_) {}
  }
  // MariaDB 는 ADD UNIQUE INDEX IF NOT EXISTS 미지원 → 존재 확인 후 생성
  try {
    const [exists] = await pool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'activities'
          AND INDEX_NAME   = 'uniq_activities_gmail_message_id'
        LIMIT 1`
    );
    if (!exists.length) {
      await pool.query(
        `CREATE UNIQUE INDEX uniq_activities_gmail_message_id
           ON activities (gmail_message_id)`
      );
    }
  } catch (_) {
    /* 권한 없거나 이미 존재 — 무시 */
  }
}
const _migrationPromise = ensureSchema();

const MAX_BACKTRACK_MS = 24 * 60 * 60 * 1000; // 첫 폴링 시 최대 24시간 백트래킹
const PER_POLL_LIMIT = 100;

/**
 * 단일 사용자 폴링
 * @returns {Promise<{ matched, inserted, skipped, error }>}
 */
async function pollOne(userId) {
  const summary = { matched: 0, inserted: 0, skipped: 0, error: null };

  // 1) 사용자 동기화 상태
  const [[state]] = await pool.query(
    `SELECT gmail_sync_enabled, gmail_last_polled_at
       FROM google_oauth_tokens WHERE user_id = ?`,
    [userId]
  );
  if (!state) {
    summary.error = 'no_tokens';
    return summary;
  }
  if (!state.gmail_sync_enabled) {
    summary.skipped = 1;
    summary.error = 'disabled';
    return summary;
  }

  // 2) 마지막 폴링 시각 (없으면 24시간 전부터)
  const sinceMs = state.gmail_last_polled_at
    ? new Date(state.gmail_last_polled_at).getTime()
    : Date.now() - MAX_BACKTRACK_MS;

  let messages;
  try {
    messages = await gmail.listSince(userId, sinceMs, { limit: PER_POLL_LIMIT });
  } catch (err) {
    const rawMsg = err.message || 'gmail_fetch_failed';
    // refresh token 무효/회수 — 재연결 필요. 더 이상 폴링 금지 (계속 시도하면 Google 알람).
    const isInvalidGrant =
      /invalid_grant/i.test(rawMsg) || err?.response?.data?.error === 'invalid_grant';
    summary.error = isInvalidGrant
      ? 'Google 인증이 만료되었거나 권한이 회수되었습니다 — 연동 해제 → 재연결 필요'
      : rawMsg;
    summary.reason = isInvalidGrant ? 'invalid_grant' : 'fetch_failed';

    if (isInvalidGrant) {
      // 자동 비활성화 — 사용자가 재연결할 때까지 폴링 중단
      await pool.query(
        `UPDATE google_oauth_tokens
            SET gmail_sync_enabled = 0,
                gmail_sync_error   = ?
          WHERE user_id = ?`,
        [summary.error.slice(0, 500), userId]
      );
    } else {
      await pool.query(`UPDATE google_oauth_tokens SET gmail_sync_error = ? WHERE user_id = ?`, [
        summary.error.slice(0, 500),
        userId,
      ]);
    }
    return summary;
  }

  // 3) 메시지별 매칭 + 활동 INSERT
  for (const msg of messages) {
    try {
      // From + To 주소들 중 첫 매칭 customer
      const addrs = [msg.fromAddr, ...(msg.toAddrs || [])].filter(Boolean);
      if (!addrs.length) {
        summary.skipped++;
        continue;
      }

      const placeholders = addrs.map(() => '?').join(',');
      const [custRows] = await pool.query(
        `SELECT id, name, email AS contact_email
           FROM customers
          WHERE LOWER(email) IN (${placeholders})
          LIMIT 1`,
        addrs.map(a => a.toLowerCase())
      );
      if (!custRows.length) {
        summary.skipped++;
        continue;
      }
      const matchedCustomer = custRows[0];
      summary.matched++;

      // 4) 활성 lead 매칭 (가장 최근 active)
      const [leadRows] = await pool.query(
        `SELECT id FROM leads
          WHERE customer_id = ?
            AND stage NOT IN ('won', 'lost', 'dropped')
          ORDER BY updated_at DESC LIMIT 1`,
        [matchedCustomer.id]
      );
      const leadId = leadRows.length ? leadRows[0].id : null;

      // 5) activities INSERT — UNIQUE(gmail_message_id) 로 중복 차단
      const title = (msg.subject || '이메일').slice(0, 290);
      const content = [
        `[${msg.direction === 'outbound' ? '발신' : '수신'}]`,
        `From: ${msg.from}`,
        `To: ${msg.to}`,
        `Date: ${msg.date ? new Date(msg.date).toISOString() : ''}`,
        `Gmail: ${msg.gmail_url}`,
        '',
        msg.snippet,
      ]
        .join('\n')
        .slice(0, 5000);

      try {
        await pool.query(
          `INSERT INTO activities
             (lead_id, activity_type, title, content, performed_by,
              activity_date, status, gmail_message_id)
           VALUES (?, '이메일', ?, ?, ?, ?, 'done', ?)`,
          [leadId, title, content, userId, msg.date ? new Date(msg.date) : new Date(), msg.id]
        );
        summary.inserted++;
      } catch (insErr) {
        if (insErr.code === 'ER_DUP_ENTRY') {
          // 이미 처리한 메시지 — 정상
          summary.skipped++;
        } else {
          throw insErr;
        }
      }
    } catch (perMsgErr) {
      summary.skipped++;
      // 메시지 1건 실패는 무시하고 계속 (전체 폴링 실패 X)
      console.warn('[gmailSync] message skip:', perMsgErr.message);
    }
  }

  // 6) 마지막 폴링 시각 갱신 + 에러 클리어
  await pool.query(
    `UPDATE google_oauth_tokens
        SET gmail_last_polled_at = NOW(),
            gmail_sync_error     = NULL
      WHERE user_id = ?`,
    [userId]
  );

  return summary;
}

/**
 * sync 활성화된 모든 사용자 폴링
 */
async function pollAll() {
  const results = [];
  try {
    // 기능 토글 OFF 시 백그라운드 cron 도 즉시 skip (리소스/외부 API 호출 방지)
    const { isFeatureEnabled } = require('../middleware/featureGuard');
    const enabled = await isFeatureEnabled('gmail.sync');
    if (!enabled) {
      return { skipped: true, reason: 'feature_disabled' };
    }

    const [users] = await pool.query(
      `SELECT user_id FROM google_oauth_tokens
        WHERE gmail_sync_enabled = 1`
    );
    for (const u of users) {
      const r = await pollOne(u.user_id);
      results.push({ user_id: u.user_id, ...r });
    }
  } catch (err) {
    console.error('[gmailSync.pollAll] failed:', err.message);
  }
  return results;
}

module.exports = { pollOne, pollAll, _migrationPromise };
