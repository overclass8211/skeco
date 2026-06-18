'use strict';
// =============================================================
// Gmail API 래퍼 — Phase G1 (읽기 + 리드/고객 매칭)
//
// 사용:
//   const gmail = require('../services/gmail');
//   const msgs = await gmail.listByEmail(userId, 'contact@example.com', { limit: 10 });
//
// 인증:
//   기존 google_oauth_tokens 의 토큰을 getAuthenticatedClient() 로 가져와 사용.
//   gmail.readonly scope 필요 — 미보유 시 403 응답으로 안내.
//
// 결과 포맷 (각 메시지):
//   {
//     id, threadId,
//     from, to, subject, snippet,
//     date (Date),
//     direction: 'inbound' | 'outbound',
//     gmail_url (gmail.com 열기용)
//   }
// =============================================================

const { google } = require('googleapis');

// google.js 의 getAuthenticatedClient 재사용 (순환 import 방지 위해 lazy require)
function _getGoogleAuthHelpers() {
  return require('../routes/google');
}

/** 사용자별 Gmail API 클라이언트 */
async function getGmailClient(userId) {
  const { getAuthenticatedClient } = _getGoogleAuthHelpers();
  const oauth2Client = await getAuthenticatedClient(userId);
  return {
    gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
    oauth2Client,
  };
}

/** 사용자 본인 Gmail 주소 (방향 판별용) */
async function getOwnEmail(userId) {
  const { gmail } = await getGmailClient(userId);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

/** Gmail RFC 822 헤더에서 단일 헤더 값 추출 */
function _hdr(headers, name) {
  if (!headers) return '';
  const h = headers.find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/** 이메일 주소 추출 — "Name <a@b.com>" → "a@b.com" */
function _extractAddr(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * 특정 이메일 주소와의 송수신 메시지 목록
 * @param {number} userId
 * @param {string} contactEmail  — 매칭 대상 이메일
 * @param {object} opts          — { limit (기본 10) }
 * @returns {Promise<Array>}
 */
async function listByEmail(userId, contactEmail, opts = {}) {
  if (!contactEmail || !/@/.test(contactEmail)) {
    return [];
  }
  const limit = Math.min(50, Math.max(1, parseInt(opts.limit) || 10));
  const { gmail } = await getGmailClient(userId);

  // Gmail 검색 쿼리 — 송수신 둘 다 포함
  // from:foo@bar.com OR to:foo@bar.com
  const safeEmail = contactEmail.replace(/["]/g, '');
  const q = `from:${safeEmail} OR to:${safeEmail}`;

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults: limit,
  });
  const ids = (listRes.data.messages || []).map(m => m.id);
  if (!ids.length) return [];

  // 본인 이메일 (방향 판별)
  let myEmail = '';
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    myEmail = (profile.data.emailAddress || '').toLowerCase();
  } catch (_) {}

  // 각 메시지 메타데이터 fetch (병렬)
  const detailed = await Promise.all(
    ids.map(id =>
      gmail.users.messages
        .get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        })
        .then(r => r.data)
        .catch(() => null)
    )
  );

  return detailed.filter(Boolean).map(m => {
    const headers = m.payload?.headers || [];
    const from = _hdr(headers, 'From');
    const to = _hdr(headers, 'To');
    const subject = _hdr(headers, 'Subject') || '(제목 없음)';
    const dateHdr = _hdr(headers, 'Date');
    const internalDate = m.internalDate ? new Date(parseInt(m.internalDate)) : null;
    const date = internalDate || (dateHdr ? new Date(dateHdr) : null);

    const fromAddr = _extractAddr(from);
    // 본인이 보낸 메일이면 outbound, 아니면 inbound
    const direction = myEmail && fromAddr === myEmail ? 'outbound' : 'inbound';

    return {
      id: m.id,
      threadId: m.threadId,
      from,
      to,
      subject,
      snippet: m.snippet || '',
      date,
      direction,
      gmail_url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    };
  });
}

/**
 * 에러 분류 — gmail.readonly scope 미보유 / 토큰 만료 등을 친절한 응답으로
 */
function classifyError(err) {
  if (err?.notConnected) {
    return { status: 401, body: { success: false, error: err.message, notConnected: true } };
  }
  const code = err?.code || err?.response?.status;
  const msg = err?.message || '';
  const oauthErr = err?.response?.data?.error || '';

  // OAuth refresh token 무효/회수 — 사용자가 권한을 회수했거나 토큰 만료된 케이스
  // googleapis SDK 는 err.message = 'invalid_grant' 로 throw
  if (oauthErr === 'invalid_grant' || /invalid_grant/i.test(msg)) {
    return {
      status: 401,
      body: {
        success: false,
        error:
          'Google 인증이 만료되었거나 권한이 회수되었습니다 — Google 연동을 해제하고 다시 연결해 주세요.',
        notConnected: true,
        reason: 'invalid_grant',
      },
    };
  }
  // Insufficient permission (scope 미보유)
  if (code === 403 || /insufficient|forbidden|permission/i.test(msg)) {
    return {
      status: 403,
      body: {
        success: false,
        error: 'Gmail 권한이 없습니다. Google 계정을 재연결해 권한을 추가해 주세요.',
        scopeRequired: 'gmail.readonly',
      },
    };
  }
  if (code === 401 || /unauthor/i.test(msg)) {
    return {
      status: 401,
      body: {
        success: false,
        error: 'Google 인증이 만료되었습니다. 재연결해 주세요.',
        notConnected: true,
      },
    };
  }
  return { status: 500, body: { success: false, error: msg || 'Gmail API 오류' } };
}

// ── RFC 2822 raw 메시지 빌드 + base64url 인코딩 ────────────────
// Gmail API users.messages.send 는 base64url encoded raw 만 받음.
// Korean 제목은 RFC 2047 인코딩 (=?UTF-8?B?...?=) 으로 비ASCII 안전.
function _buildRawMessage({ from, to, subject, body, cc, bcc }) {
  const enc2047 = s => '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
  const lines = [`From: ${from}`, `To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  // 비-ASCII (Korean) 안전 위해 항상 2047 인코딩
  lines.push(`Subject: ${enc2047(subject || '')}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  // body 도 base64 — 한국어/이모지 + 긴 줄 안전 (Quoted-Printable 대안 가능하지만 base64 가 단순)
  lines.push(Buffer.from(String(body || ''), 'utf8').toString('base64'));
  const raw = lines.join('\r\n');
  // base64url
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Gmail 로 직접 발송
 * @param {number} userId
 * @param {object} opts — { to, subject, body, cc?, bcc? }
 * @returns {Promise<{ message_id, thread_id }>}
 */
async function sendMessage(userId, opts) {
  if (!opts || !opts.to || !/@/.test(opts.to)) {
    throw Object.assign(new Error('유효한 수신자(to) 가 필요합니다'), { status: 400 });
  }
  if (!opts.subject || !String(opts.subject).trim()) {
    throw Object.assign(new Error('제목이 필요합니다'), { status: 400 });
  }
  const { gmail } = await getGmailClient(userId);
  // 본인 이메일 — From 헤더에 사용
  const myEmail = await getOwnEmail(userId);
  const raw = _buildRawMessage({
    from: myEmail,
    to: opts.to,
    subject: opts.subject,
    body: opts.body || '',
    cc: opts.cc || '',
    bcc: opts.bcc || '',
  });
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  return {
    message_id: res.data.id,
    thread_id: res.data.threadId,
    from: myEmail,
  };
}

// ── Phase 5-A: 첨부파일 지원 multipart/mixed 메시지 빌더 ────
// Gmail API send 는 RFC 822 raw + base64url 인코딩을 요구한다.
// 첨부 시 multipart/mixed boundary 로 본문 + N개 첨부를 묶는다.
// 기존 _buildRawMessage 는 그대로 두고 (text/plain only), 첨부 케이스만 분리.
//
// 입력:
//   attachments: [{ filename, mimeType, data: Buffer }] — data 는 Buffer 권장
// 반환: Gmail API users.messages.send 의 raw 필드 (base64url)
function _buildRawMessageWithAttachments({ from, to, subject, body, cc, bcc, attachments = [] }) {
  const enc2047 = s => '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
  // RFC 2046 — 본문에 포함될 수 없도록 충분히 unique 한 boundary
  const boundary = `=_OCI_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // (1) 헤더
  const headers = [`From: ${from}`, `To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${enc2047(subject || '')}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  // (2) 본문 파트 — text/plain + base64
  const bodyPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(body || ''), 'utf8').toString('base64'),
  ];

  // (3) 첨부 파트들 — 각 파일을 base64 로 76자 단위 줄바꿈 (RFC 2045 권장)
  const wrapBase64 = b64 => {
    const lines = [];
    for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
    return lines.join('\r\n');
  };
  const attachParts = (attachments || [])
    .filter(a => a && a.data && a.filename)
    .map(a => {
      const mime = a.mimeType || 'application/octet-stream';
      const fnameEnc = enc2047(a.filename);
      const dataB64 = Buffer.isBuffer(a.data)
        ? a.data.toString('base64')
        : Buffer.from(a.data).toString('base64');
      return [
        `--${boundary}`,
        `Content-Type: ${mime}; name="${fnameEnc}"`,
        `Content-Disposition: attachment; filename="${fnameEnc}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(dataB64),
      ].join('\r\n');
    });

  // (4) 조립 — boundary 종료 마커 (--BOUNDARY--)
  const parts = [
    headers.join('\r\n'),
    '',
    bodyPart.join('\r\n'),
    ...attachParts,
    `--${boundary}--`,
  ];
  const raw = parts.join('\r\n');

  // base64url 변환
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Gmail 로 첨부파일과 함께 발송 (Phase 5-A)
 * 기존 sendMessage 와 분리 — multipart/mixed 인코딩만 다름.
 *
 * @param {number} userId
 * @param {object} opts
 *   - to {string}        — 수신자 (콤마 구분 가능)
 *   - subject {string}
 *   - body {string}      — text/plain 본문
 *   - cc {string?}
 *   - bcc {string?}
 *   - attachments {Array<{filename, mimeType, data: Buffer}>}
 * @returns {Promise<{ message_id, thread_id, from }>}
 *
 * 제약:
 * - Gmail API raw 한도: base64 인코딩 후 최대 35MB (실제 원본 ~26MB)
 *   → 호출자가 사전에 합산 크기 검증 권장
 */
async function sendMessageWithAttachments(userId, opts) {
  if (!opts || !opts.to || !/@/.test(opts.to)) {
    throw Object.assign(new Error('유효한 수신자(to) 가 필요합니다'), { status: 400 });
  }
  if (!opts.subject || !String(opts.subject).trim()) {
    throw Object.assign(new Error('제목이 필요합니다'), { status: 400 });
  }

  // 첨부 사전 검증 — 합계 25MB 초과 시 거부 (Gmail base64 한도 35MB → 안전마진)
  const attachments = (opts.attachments || []).filter(a => a && a.data && a.filename);
  let totalSize = 0;
  for (const a of attachments) {
    const sz = Buffer.isBuffer(a.data) ? a.data.length : Buffer.byteLength(a.data);
    totalSize += sz;
  }
  if (totalSize > 25 * 1024 * 1024) {
    throw Object.assign(
      new Error(
        `첨부파일 합계 ${(totalSize / 1024 / 1024).toFixed(1)}MB 가 25MB 한도 초과 — 일부 파일 제외 후 재시도`
      ),
      { status: 400 }
    );
  }

  // 테스트 환경 — Gmail API 호출 없이 mock 반환 (raw 빌드는 그대로 검증 가능)
  if (process.env.NODE_ENV === 'test') {
    const raw = _buildRawMessageWithAttachments({
      from: 'test@example.com',
      to: opts.to,
      subject: opts.subject,
      body: opts.body || '',
      cc: opts.cc || '',
      bcc: opts.bcc || '',
      attachments,
    });
    return {
      message_id: '__MOCK_MID__',
      thread_id: '__MOCK_TID__',
      from: 'test@example.com',
      _raw_length: raw.length,
      _attachment_count: attachments.length,
      _total_attachment_bytes: totalSize,
      _mock: true,
    };
  }

  const { gmail } = await getGmailClient(userId);
  const myEmail = await getOwnEmail(userId);
  const raw = _buildRawMessageWithAttachments({
    from: myEmail,
    to: opts.to,
    subject: opts.subject,
    body: opts.body || '',
    cc: opts.cc || '',
    bcc: opts.bcc || '',
    attachments,
  });
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  return {
    message_id: res.data.id,
    thread_id: res.data.threadId,
    from: myEmail,
  };
}

/**
 * 특정 시각 이후의 메시지 N건 (백그라운드 동기화용)
 * Gmail 쿼리 `after:` 는 초 단위 epoch.
 * @param {number} userId
 * @param {Date|number} sinceTs   — Date 또는 epoch ms. null/undefined 면 최근 24시간
 * @param {object} opts           — { limit (기본 100), maxBack: 24*60*60*1000 }
 * @returns {Promise<Array>}      — listByEmail 와 동일한 메시지 포맷
 */
async function listSince(userId, sinceTs, opts = {}) {
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit) || 100));
  const maxBack = opts.maxBack || 24 * 60 * 60 * 1000; // 첫 폴링 시 백트래킹 한계: 24h

  let sinceMs;
  if (sinceTs instanceof Date) sinceMs = sinceTs.getTime();
  else if (typeof sinceTs === 'number') sinceMs = sinceTs;
  else sinceMs = Date.now() - maxBack;

  // 너무 오래된 데이터 백트래킹 금지 — 단일 폴링 최대 maxBack
  const minAllowed = Date.now() - maxBack;
  if (sinceMs < minAllowed) sinceMs = minAllowed;

  const afterSec = Math.floor(sinceMs / 1000);
  const { gmail } = await getGmailClient(userId);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${afterSec}`,
    maxResults: limit,
  });
  const ids = (listRes.data.messages || []).map(m => m.id);
  if (!ids.length) return [];

  let myEmail = '';
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    myEmail = (profile.data.emailAddress || '').toLowerCase();
  } catch (_) {}

  const detailed = await Promise.all(
    ids.map(id =>
      gmail.users.messages
        .get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        })
        .then(r => r.data)
        .catch(() => null)
    )
  );

  return detailed.filter(Boolean).map(m => {
    const headers = m.payload?.headers || [];
    const from = _hdr(headers, 'From');
    const to = _hdr(headers, 'To');
    const subject = _hdr(headers, 'Subject') || '(제목 없음)';
    const date = m.internalDate ? new Date(parseInt(m.internalDate)) : null;
    const fromAddr = _extractAddr(from);
    const toAddrs = (to || '').split(',').map(_extractAddr).filter(Boolean);
    const direction = myEmail && fromAddr === myEmail ? 'outbound' : 'inbound';
    return {
      id: m.id,
      threadId: m.threadId,
      from,
      fromAddr,
      to,
      toAddrs,
      subject,
      snippet: m.snippet || '',
      date,
      direction,
      gmail_url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    };
  });
}

module.exports = {
  listByEmail,
  listSince,
  getOwnEmail,
  getGmailClient,
  classifyError,
  sendMessage,
  sendMessageWithAttachments,
  // Phase 5-A: 단위 테스트용 (raw 메시지 구조 검증)
  _buildRawMessageWithAttachments,
};
