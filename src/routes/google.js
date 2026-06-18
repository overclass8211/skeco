const router = require('express').Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');
require('dotenv').config({ override: true });

/** 인증이 필요한 Google 라우트용 미들웨어 (authenticate 전에 마운트되므로 자체 처리) */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, require('../../config').jwtSecret);
    next();
  } catch (_) {
    return res
      .status(401)
      .json({ success: false, error: '세션이 만료되었습니다. 다시 로그인하세요.' });
  }
}

// ── DB 자동 마이그레이션 ──────────────────────────────────────
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    user_id      INT          NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date  BIGINT,
    google_email VARCHAR(255),
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS google_meet_sessions (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT,
    google_event_id  VARCHAR(255),
    meet_link        VARCHAR(500) NOT NULL,
    title            VARCHAR(255),
    scheduled_at     DATETIME,
    duration_min     INT DEFAULT 60,
    meeting_minutes_id INT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

// ── 헬퍼 ─────────────────────────────────────────────────────
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
      `http://localhost:${process.env.PORT || 3001}/api/google/callback`
  );
}

async function getAuthenticatedClient(userId) {
  const [[row]] = await pool.query(
    'SELECT access_token, refresh_token, expiry_date FROM google_oauth_tokens WHERE user_id = ?',
    [userId]
  );
  if (!row || !row.refresh_token)
    throw Object.assign(new Error('Google 계정이 연결되지 않았습니다'), { notConnected: true });

  const oauth2Client = getOAuth2Client();
  // DB에서 읽을 때 복호화
  oauth2Client.setCredentials({
    access_token: decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
    expiry_date: row.expiry_date,
  });

  // 토큰 자동 갱신 시 암호화하여 DB 업데이트
  oauth2Client.on('tokens', async tokens => {
    const updates = [];
    const vals = [];
    if (tokens.access_token) {
      updates.push('access_token=?');
      vals.push(encrypt(tokens.access_token));
    }
    if (tokens.expiry_date) {
      updates.push('expiry_date=?');
      vals.push(tokens.expiry_date);
    }
    if (updates.length) {
      vals.push(userId);
      await pool
        .query(`UPDATE google_oauth_tokens SET ${updates.join(',')} WHERE user_id=?`, vals)
        .catch(() => {});
    }
  });
  return oauth2Client;
}

// ── 설정 확인 헬퍼 ─────────────────────────────────────────────
function checkConfig(res) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(400).json({
      success: false,
      error:
        'Google OAuth가 설정되지 않았습니다. .env 파일에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET을 입력하세요.',
      notConfigured: true,
    });
    return false;
  }
  return true;
}

// ── 1. 연결 상태 확인 ─────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.json({ success: true, data: { connected: false, configured: false } });
    }
    const userId = getUserId(req);
    if (!userId) return res.json({ success: true, data: { connected: false, configured: true } });
    const [[row]] = await pool.query(
      'SELECT google_email, updated_at FROM google_oauth_tokens WHERE user_id = ?',
      [userId]
    );
    res.json({
      success: true,
      data: { connected: !!row, configured: true, email: row?.google_email || null },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 2. OAuth 인증 URL 생성 ─────────────────────────────────────
router.get('/auth-url', requireAuth, (req, res) => {
  if (!checkConfig(res)) return;
  try {
    const userId = getUserId(req);
    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        // Gmail 읽기 (리드/고객 매칭) — Phase G1
        'https://www.googleapis.com/auth/gmail.readonly',
        // Gmail 보내기 (CRM 내부 발송) — Phase G2
        'https://www.googleapis.com/auth/gmail.send',
      ],
      state: String(userId || ''),
    });
    res.json({ success: true, url });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 3. OAuth 콜백 (Google → 서버 → 팝업 완료 페이지) ──────────
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error || !code) {
    return res.send(popupHtml({ success: false, error: error || 'invalid_code' }));
  }

  try {
    if (!checkConfig(res)) return;
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // 이메일 조회
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const uInfo = await oauth2.userinfo.get();
    const email = uInfo.data.email;

    // 저장 전 토큰 암호화 (AES-256-GCM)
    const encAccess = tokens.access_token ? encrypt(tokens.access_token) : null;
    const encRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    // 재연결 시 stale Gmail 동기화 에러도 함께 클리어
    // (이전에 invalid_grant 로 자동 비활성/에러 저장되었을 수 있음 — 토큰이 새것이 되었으니 에러 메시지도 무효)
    await pool.query(
      `INSERT INTO google_oauth_tokens (user_id, access_token, refresh_token, expiry_date, google_email)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         access_token     = VALUES(access_token),
         refresh_token    = COALESCE(VALUES(refresh_token), refresh_token),
         expiry_date      = VALUES(expiry_date),
         google_email     = VALUES(google_email),
         gmail_sync_error = NULL`,
      [userId, encAccess, encRefresh, tokens.expiry_date || null, email]
    );

    res.send(popupHtml({ success: true, email }));
  } catch (err) {
    console.error('[Google OAuth callback]', err.message);
    res.send(popupHtml({ success: false, error: err.message }));
  }
});

/** HTML 안전 escape (XSS 방지 — email/error 가 사용자 입력은 아니지만 방어적 처리) */
function _escHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 팝업 완료 HTML — 외부 JS (/js/google-oauth-callback.js) 가 postMessage + close 처리.
 *  inline script 는 helmet CSP 가 차단하므로 외부 파일 사용. */
function popupHtml({ success, email, error }) {
  const payload = JSON.stringify({
    type: 'google_oauth',
    success,
    email: email || null,
    error: error || null,
  });
  const safeEmail = _escHtml(email);
  const safeError = _escHtml(error);
  const safePayload = _escHtml(payload);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Google 연결</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;color:${success ? '#1a73e8' : '#d93025'}">
  <div style="font-size:48px">${success ? '✅' : '❌'}</div>
  <div style="margin:16px 0;font-size:15px;font-weight:600">${success ? 'Google 계정 연결 완료' : '연결 실패'}</div>
  ${success ? `<div style="font-size:13px;color:#666">${safeEmail}</div>` : `<div style="font-size:12px;color:#999">${safeError}</div>`}
  <div style="margin-top:20px;font-size:12px;color:#999">이 창은 자동으로 닫힙니다...</div>
  <div id="oauth-data" style="display:none" data-payload="${safePayload}"></div>
  <script src="/js/google-oauth-callback.js"></script>
</body></html>`;
}

// ── 4. 연결 해제 ───────────────────────────────────────────────
router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    await pool.query('DELETE FROM google_oauth_tokens WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 5. Google Meet 생성 ────────────────────────────────────────
router.post('/meet/create', requireAuth, async (req, res) => {
  if (!checkConfig(res)) return;
  try {
    const userId = getUserId(req);
    const { title, scheduled_at, duration_min = 60 } = req.body;

    const oauth2Client = await getAuthenticatedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startDt = scheduled_at ? new Date(scheduled_at) : new Date();
    const endDt = new Date(startDt.getTime() + duration_min * 60_000);

    const event = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: title || '영업 미팅',
        start: { dateTime: startDt.toISOString(), timeZone: 'Asia/Seoul' },
        end: { dateTime: endDt.toISOString(), timeZone: 'Asia/Seoul' },
        conferenceData: {
          createRequest: {
            requestId: `oci-crm-${userId}-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const meetLink = event.data.hangoutLink;
    const googleEventId = event.data.id;

    if (!meetLink)
      return res
        .status(500)
        .json({ success: false, error: 'Meet 링크 생성 실패 (Google Workspace 계정 필요)' });

    const [result] = await pool.query(
      `INSERT INTO google_meet_sessions (user_id, google_event_id, meet_link, title, scheduled_at, duration_min)
       VALUES (?,?,?,?,?,?)`,
      [userId, googleEventId, meetLink, title || '영업 미팅', startDt, duration_min]
    );

    res.json({
      success: true,
      data: {
        id: result.insertId,
        meet_link: meetLink,
        google_event_id: googleEventId,
        title: title || '영업 미팅',
        scheduled_at: startDt,
        duration_min,
      },
    });
  } catch (err) {
    if (err.notConnected)
      return res.status(401).json({ success: false, error: err.message, notConnected: true });
    console.error('[Meet create]', err.message);
    handleError(res, err);
  }
});

// ── 6. 최근 Meet 세션 목록 ─────────────────────────────────────
router.get('/meet/list', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const [rows] = await pool.query(
      `SELECT s.id, s.meet_link, s.title, s.scheduled_at, s.duration_min,
              s.google_event_id, s.meeting_minutes_id, s.created_at,
              m.title AS minutes_title
       FROM google_meet_sessions s
       LEFT JOIN meeting_minutes m ON s.meeting_minutes_id = m.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC LIMIT 10`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 7. Meet 세션에 회의록 연결 ─────────────────────────────────
router.patch('/meet/:id/link-minutes', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { meeting_minutes_id } = req.body;
    await pool.query(
      'UPDATE google_meet_sessions SET meeting_minutes_id=? WHERE id=? AND user_id=?',
      [meeting_minutes_id, req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
// 다른 라우터(gmail 등)에서 재사용할 helpers
module.exports.requireAuth = requireAuth;
module.exports.getAuthenticatedClient = getAuthenticatedClient;
module.exports.checkConfig = checkConfig;
