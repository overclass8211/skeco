'use strict';
const router = require('express').Router();
const QRCode = require('qrcode');
const pool = require('../db');
const config = require('../../config');
const { handleError } = require('../middleware/errorHandler');
const { schema, SCHEMAS } = require('../middleware/validate');
const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  signRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
  blacklistAdd,
  generateOtpSecret,
  encryptOtpSecret,
  decryptOtpSecret,
  generateOtpUri,
  verifyOtp,
  getRoleInfo,
  ROLE_PAGES,
} = require('../services/authService');

// ── Refresh Token 쿠키 옵션 ──────────────────────────────────
const REFRESH_COOKIE = 'oci_refresh';
function refreshCookieOpts(maxAgeMs) {
  return {
    httpOnly: true, // JS 접근 차단
    secure: config.env === 'production', // HTTPS에서만 전송
    sameSite: 'strict', // CSRF 방어
    path: '/api/auth', // 인증 경로에만 첨부
    maxAge: maxAgeMs,
  };
}

// ── 로그인 공통 응답 헬퍼 ────────────────────────────────────
async function issueTokens(res, user, req) {
  // Access Token (짧은 만료, ④ 최소 정보)
  const { token: accessToken, jti } = signToken(user);

  // Refresh Token (opaque, DB 저장)
  const { raw: refreshRaw, expiresAt } = signRefreshToken(user.id, jti);
  const refreshHash = await hashRefreshToken(refreshRaw);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, jti, user_agent, ip, expires_at)
     VALUES (?,?,?,?,?,?)`,
    [user.id, refreshHash, jti, (req.headers['user-agent'] || '').slice(0, 500), req.ip, expiresAt]
  );

  // Refresh Token → HttpOnly 쿠키
  res.cookie(REFRESH_COOKIE, refreshRaw, refreshCookieOpts(expiresAt - Date.now()));

  const roleInfo = getRoleInfo(user.role);
  const pages = ROLE_PAGES[user.role] || ROLE_PAGES.manager;

  return res.json({
    success: true,
    token: accessToken, // 15분 Access Token
    expiresIn: config.jwtExpires,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      roleLabel: roleInfo.label,
      roleColor: roleInfo.color,
      pages,
    },
  });
}

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', schema(SCHEMAS.login), async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, error: '아이디와 비밀번호를 입력하세요.' });

    const [[user]] = await pool.query(
      `SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1`,
      [username, username]
    );
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return res
        .status(401)
        .json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });

    if (user.otp_enabled) return res.json({ success: true, requireOtp: true, userId: user.id });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    return issueTokens(res, user, req);
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /api/auth/login-otp ─────────────────────────────────
router.post('/login-otp', async (req, res) => {
  try {
    const { userId, otpToken } = req.body;
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [
      userId,
    ]);
    if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });
    if (!user.otp_secret)
      return res.status(400).json({ success: false, error: 'OTP 미설정 계정입니다.' });
    const plainSecret = decryptOtpSecret(user.otp_secret); // DB에서 복호화
    if (!verifyOtp(otpToken, plainSecret))
      return res.status(401).json({ success: false, error: 'OTP 코드가 올바르지 않습니다.' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    return issueTokens(res, user, req);
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /api/auth/refresh ③ ─────────────────────────────────
// Refresh Token(쿠키)으로 새 Access Token 발급
router.post('/refresh', async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return res.status(401).json({ success: false, error: 'Refresh token이 없습니다.' });

    // DB에서 유효한 refresh token 조회 (user_id별, 미만료, 미폐기)
    const [rows] = await pool.query(
      `SELECT rt.*, u.id AS uid, u.username, u.role, u.full_name, u.email, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.expires_at > NOW() AND rt.revoked = 0
       ORDER BY rt.created_at DESC LIMIT 20`
    );

    // 해시 비교로 일치하는 토큰 찾기
    let matched = null;
    for (const row of rows) {
      if (await verifyRefreshToken(raw, row.token_hash)) {
        matched = row;
        break;
      }
    }
    if (!matched)
      return res.status(401).json({ success: false, error: '유효하지 않은 Refresh token입니다.' });
    if (!matched.is_active)
      return res.status(401).json({ success: false, error: '비활성화된 계정입니다.' });

    // 기존 refresh token 폐기 (Rotation)
    await pool.query('UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE id=?', [
      matched.id,
    ]);

    // 기존 Access Token JTI 블랙리스트 추가 (구 토큰 즉시 무효화)
    if (matched.jti) {
      blacklistAdd(matched.jti);
      await pool.query(
        `INSERT IGNORE INTO token_blacklist (jti, user_id, expires_at, reason)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 20 MINUTE), 'rotated')`,
        [matched.jti, matched.user_id]
      );
    }

    // 새 토큰 쌍 발급
    const user = {
      id: matched.uid,
      username: matched.username,
      role: matched.role,
      full_name: matched.full_name,
      email: matched.email,
    };
    return issueTokens(res, user, req);
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /api/auth/logout ⑤ ─────────────────────────────────
// 현재 세션 로그아웃 (access token 블랙리스트 + refresh token 폐기)
router.post('/logout', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (token) {
      try {
        const decoded = verifyToken(token);
        if (decoded.jti) {
          // Access Token 즉시 무효화
          blacklistAdd(decoded.jti);
          const exp = decoded.exp
            ? new Date(decoded.exp * 1000)
            : new Date(Date.now() + 15 * 60_000);
          await pool.query(
            `INSERT IGNORE INTO token_blacklist (jti, user_id, expires_at, reason) VALUES (?,?,?,'logout')`,
            [decoded.jti, decoded.id, exp]
          );
          // 해당 JTI의 Refresh Token 폐기
          await pool.query('UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE jti=?', [
            decoded.jti,
          ]);
        }
      } catch (_) {
        /* 만료된 토큰도 로그아웃 허용 */
      }
    }

    // Refresh Token 쿠키로 DB 폐기 (추가 안전망)
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      const [rows] = await pool.query(
        'SELECT id, token_hash FROM refresh_tokens WHERE revoked=0 AND expires_at>NOW() LIMIT 50'
      );
      for (const row of rows) {
        if (await verifyRefreshToken(raw, row.token_hash)) {
          await pool.query('UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE id=?', [
            row.id,
          ]);
          break;
        }
      }
    }

    // 쿠키 삭제
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /api/auth/logout-all ⑤ ─────────────────────────────
// 해당 사용자의 모든 세션 강제 만료
router.post('/logout-all', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: '인증 필요' });

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (_) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰' });
    }

    // 모든 Refresh Token 폐기
    await pool.query(
      'UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE user_id=? AND revoked=0',
      [decoded.id]
    );
    // 현재 Access Token 블랙리스트
    if (decoded.jti) {
      blacklistAdd(decoded.jti);
      const exp = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 15 * 60_000);
      await pool.query(
        `INSERT IGNORE INTO token_blacklist (jti, user_id, expires_at, reason) VALUES (?,?,?,'logout_all')`,
        [decoded.jti, decoded.id, exp]
      );
    }

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ success: true, message: '모든 세션이 종료되었습니다.' });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /api/auth/force-logout/:userId ⑤ ───────────────────
// 관리자: 특정 사용자 강제 만료
router.post('/force-logout/:userId', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: '인증 필요' });

    let caller;
    try {
      caller = verifyToken(token);
    } catch (_) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰' });
    }

    const { getRoleInfo } = require('../services/authService');
    if (getRoleInfo(caller.role).level < 4)
      return res
        .status(403)
        .json({ success: false, error: '관리자(superadmin) 권한이 필요합니다.' });

    const targetId = parseInt(req.params.userId, 10);
    await pool.query(
      'UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE user_id=? AND revoked=0',
      [targetId]
    );

    res.json({ success: true, message: `사용자(${targetId}) 모든 세션 강제 만료 완료` });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: '인증 필요' });

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (_) {
      return res.status(401).json({ success: false, error: '세션 만료' });
    }

    const [[user]] = await pool.query(
      'SELECT id, username, full_name, email, role, last_login FROM users WHERE id=? AND is_active=1',
      [decoded.id]
    );
    if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });

    const roleInfo = getRoleInfo(user.role);
    const pages = ROLE_PAGES[user.role] || ROLE_PAGES.manager;
    res.json({
      success: true,
      data: { ...user, roleLabel: roleInfo.label, roleColor: roleInfo.color, pages },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── OTP ──────────────────────────────────────────────────────
router.post('/setup-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const [[user]] = await pool.query('SELECT * FROM users WHERE id=?', [userId]);
    if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });
    const secret = generateOtpSecret();
    const uri = generateOtpUri(secret, user.username);
    const qrData = await QRCode.toDataURL(uri);
    const encrypted = encryptOtpSecret(secret); // ← AES-256 암호화 후 DB 저장
    await pool.query('UPDATE users SET otp_secret=? WHERE id=?', [encrypted, userId]);
    res.json({ success: true, data: { qrCode: qrData, secret } }); // QR용 원문은 클라이언트에만 반환
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/enable-otp', async (req, res) => {
  try {
    const { userId, otpToken } = req.body;
    const [[user]] = await pool.query('SELECT * FROM users WHERE id=?', [userId]);
    if (!user || !user.otp_secret)
      return res.status(400).json({ success: false, error: 'OTP 설정 먼저 필요' });
    const plainSecret = decryptOtpSecret(user.otp_secret); // ← 복호화 후 검증
    if (!verifyOtp(otpToken, plainSecret))
      return res.status(401).json({ success: false, error: 'OTP 코드가 올바르지 않습니다.' });
    await pool.query('UPDATE users SET otp_enabled=1 WHERE id=?', [userId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/disable-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    await pool.query('UPDATE users SET otp_enabled=0, otp_secret=NULL WHERE id=?', [userId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 사용자 관리 (관리자) ─────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, full_name, email, role, is_active, otp_enabled, last_login, created_at FROM users ORDER BY role DESC, username'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/users', schema(SCHEMAS.createUser), async (req, res) => {
  try {
    const { username, email, full_name, password, role } = req.body;
    const hash = await hashPassword(password);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, full_name, password_hash, role) VALUES (?,?,?,?,?)',
      [username, email || null, full_name || null, hash, role || 'manager']
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res
        .status(409)
        .json({ success: false, error: '이미 사용 중인 아이디 또는 이메일입니다.' });
    handleError(res, err);
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { full_name, email, role, is_active, password } = req.body;
    const updates = [];
    const values = [];
    if (full_name !== undefined) {
      updates.push('full_name=?');
      values.push(full_name);
    }
    if (email !== undefined) {
      updates.push('email=?');
      values.push(email);
    }
    if (role !== undefined) {
      updates.push('role=?');
      values.push(role);
    }
    if (is_active !== undefined) {
      updates.push('is_active=?');
      values.push(is_active ? 1 : 0);
    }
    if (password) {
      updates.push('password_hash=?');
      values.push(await hashPassword(password));
    }
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE users SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active=0 WHERE id=?', [req.params.id]);
    // 비활성화 시 모든 세션도 폐기
    await pool.query(
      'UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE user_id=? AND revoked=0',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /api/auth/features/public ───────────────────────────
// 로그인 페이지에서 토큰 없이 기능 플래그 조회 (인증 불필요)
router.get('/features/public', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT feature_key, is_enabled FROM dev_features');
    const data = {};
    rows.forEach(r => {
      data[r.feature_key] = !!r.is_enabled;
    });
    res.json({ success: true, data });
  } catch (_) {
    res.json({ success: true, data: {} }); // 실패 시 모든 기능 활성화로 처리
  }
});

module.exports = router;
