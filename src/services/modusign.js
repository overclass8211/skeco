'use strict';
/**
 * Modusign (모두싸인) 전자서명 통합 서비스
 *
 * 환경변수:
 *   MODUSIGN_CLIENT_ID       — OAuth 클라이언트 ID
 *   MODUSIGN_CLIENT_SECRET   — OAuth 클라이언트 시크릿
 *   MODUSIGN_REDIRECT_URI    — OAuth 콜백 URL
 *   MODUSIGN_API_BASE_URL    — API 베이스 (기본: https://api.modusign.co.kr)
 *   MODUSIGN_OAUTH_BASE_URL  — OAuth 인가 페이지 (기본: https://app.modusign.co.kr)
 *   MODUSIGN_WEBHOOK_SECRET  — Webhook 서명 검증 시크릿
 *   MODUSIGN_USE_API_KEY     — '1' 이면 API Key 모드 (단일 계정)
 *   MODUSIGN_API_KEY         — API Key 모드 시 사용
 *
 * Mock 모드:
 *   - MODUSIGN_CLIENT_ID 미설정 시 자동 Mock
 *   - NODE_ENV='test' 일 때도 자동 Mock
 *   - Mock 응답은 일관된 형식 (실제 응답 schema 와 동일)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.MODUSIGN_API_BASE_URL || 'https://api.modusign.co.kr';
const OAUTH_BASE = process.env.MODUSIGN_OAUTH_BASE_URL || 'https://app.modusign.co.kr';
const CLIENT_ID = process.env.MODUSIGN_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MODUSIGN_CLIENT_SECRET || '';
const REDIRECT_URI =
  process.env.MODUSIGN_REDIRECT_URI || 'http://localhost:3001/api/contracts/esign/oauth/callback';
const WEBHOOK_SECRET = process.env.MODUSIGN_WEBHOOK_SECRET || '';

const PLACEHOLDER_VALUES = new Set([
  '',
  'your-modusign-oauth-client-id',
  'your-modusign-oauth-client-secret',
  'your-modusign-webhook-secret',
]);

function isConfigured() {
  return !PLACEHOLDER_VALUES.has(CLIENT_ID) && !PLACEHOLDER_VALUES.has(CLIENT_SECRET);
}

function isMockMode() {
  if (process.env.NODE_ENV === 'test') return true;
  return !isConfigured();
}

// ── OAuth 헬퍼 ───────────────────────────────────────────────
function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'document:read document:write user:read',
  });
  if (state) params.set('state', state);
  return `${OAUTH_BASE}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  if (isMockMode()) {
    return {
      access_token: '__MOCK_AT_' + crypto.randomBytes(8).toString('hex'),
      refresh_token: '__MOCK_RT_' + crypto.randomBytes(8).toString('hex'),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'document:read document:write user:read',
      modusign_user_id: '__MOCK_USER_001',
      modusign_email: 'mock@modusign.co.kr',
    };
  }
  const res = await _fetchJson(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });
  return res;
}

async function refreshAccessToken(refreshToken) {
  if (isMockMode()) {
    return {
      access_token: '__MOCK_AT_REFRESHED_' + crypto.randomBytes(8).toString('hex'),
      token_type: 'Bearer',
      expires_in: 3600,
    };
  }
  const r = await _fetchJson(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });
  return r;
}

// ── 서명 요청 / 상태 / 다운로드 ──────────────────────────────
async function createSignatureRequest({ accessToken, filePath, fileName, signers, message }) {
  if (isMockMode()) {
    return {
      document_id: '__MOCK_DOC_' + crypto.randomBytes(8).toString('hex'),
      status: 'requested',
      created_at: new Date().toISOString(),
      signers: (signers || []).map((s, i) => ({
        signer_id: `__MOCK_SIGNER_${i + 1}`,
        name: s.name,
        email: s.email,
        status: 'pending',
      })),
    };
  }
  // 실제 호출 (모두싸인 V2 API 기준 — 실제 API spec 에 따라 조정 필요)
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일 없음: ${filePath}`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const fileBase64 = fileBuffer.toString('base64');
  const body = {
    file: { name: fileName, base64: fileBase64 },
    title: fileName,
    message: message || '계약서 서명 요청',
    requester: {},
    participants: (signers || []).map(s => ({
      role: 'signer',
      name: s.name,
      email: s.email,
      phone: s.phone || undefined,
    })),
  };
  const r = await _fetchJson(`${API_BASE}/documents/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return r;
}

async function getDocumentStatus({ accessToken, documentId }) {
  if (isMockMode()) {
    return {
      document_id: documentId,
      status: documentId.includes('SIGNED') ? 'completed' : 'in_progress',
      title: '__MOCK 계약서',
      signers: [
        { signer_id: '__MOCK_S1', email: 's1@example.com', status: 'signed' },
        { signer_id: '__MOCK_S2', email: 's2@example.com', status: 'pending' },
      ],
      updated_at: new Date().toISOString(),
    };
  }
  const r = await _fetchJson(`${API_BASE}/documents/${encodeURIComponent(documentId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r;
}

async function downloadSignedPdf({ accessToken, documentId, savePath }) {
  if (isMockMode()) {
    // Mock: 작은 PDF 헤더만 생성
    const pdfMin = Buffer.from(
      '%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1>>\nstartxref\n50\n%%EOF',
      'utf8'
    );
    if (savePath) {
      try {
        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(savePath, pdfMin);
      } catch (_) {
        /* 무시 */
      }
    }
    return { ok: true, size: pdfMin.length, path: savePath || null };
  }
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(documentId)}/download`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Modusign download failed: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (savePath) {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savePath, buffer);
  }
  return { ok: true, size: buffer.length, path: savePath || null, buffer };
}

async function cancelSignatureRequest({ accessToken, documentId }) {
  if (isMockMode()) {
    return { document_id: documentId, status: 'cancelled' };
  }
  const r = await _fetchJson(`${API_BASE}/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r;
}

// ── Webhook 서명 검증 ────────────────────────────────────────
/**
 * 모두싸인 Webhook 서명 검증 (HMAC-SHA256)
 * @param {string} signatureHeader  X-Modusign-Signature 헤더 값
 * @param {string|Buffer} rawBody   요청 raw body
 * @returns {boolean}
 */
function verifyWebhookSignature(signatureHeader, rawBody) {
  if (isMockMode()) return true; // mock 모드에서는 검증 skip
  if (!WEBHOOK_SECRET || PLACEHOLDER_VALUES.has(WEBHOOK_SECRET)) {
    console.warn('[modusign] WEBHOOK_SECRET 미설정 — 서명 검증 skip (비권장)');
    return true;
  }
  if (!signatureHeader) return false;
  try {
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');
    // timing-safe 비교
    const a = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

// ── 내부: fetch + JSON ───────────────────────────────────────
async function _fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Modusign API ${res.status}: ${json?.message || text || 'failed'}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = {
  isConfigured,
  isMockMode,
  getAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  createSignatureRequest,
  getDocumentStatus,
  downloadSignedPdf,
  cancelSignatureRequest,
  verifyWebhookSignature,
  // 노출 (테스트/디버깅용)
  _constants: { API_BASE, OAUTH_BASE, CLIENT_ID, REDIRECT_URI },
};
