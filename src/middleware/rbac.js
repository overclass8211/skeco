'use strict';
const {
  verifyToken,
  getRoleInfo,
  getRequiredLevel,
  blacklistHas,
} = require('../services/authService');
const pool = require('../db');

// JWT 검증 + 블랙리스트 확인 + req.user 주입
async function authenticate(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    const msg =
      err.name === 'TokenExpiredError'
        ? '세션이 만료되었습니다. 다시 로그인하세요.'
        : '유효하지 않은 인증 토큰입니다.';
    return res
      .status(401)
      .json({ success: false, error: msg, expired: err.name === 'TokenExpiredError' });
  }

  // ⑤ 블랙리스트 확인 (로그아웃 / 강제만료)
  if (decoded.jti) {
    // 인메모리 캐시 먼저 확인 (빠름)
    if (blacklistHas(decoded.jti)) {
      return res
        .status(401)
        .json({ success: false, error: '만료된 세션입니다. 다시 로그인하세요.', revoked: true });
    }
    // DB 확인 (서버 재시작 후 메모리 캐시 없는 경우 대비)
    try {
      const [[bl]] = await pool.query(
        'SELECT jti FROM token_blacklist WHERE jti = ? AND expires_at > NOW()',
        [decoded.jti]
      );
      if (bl) {
        const { blacklistAdd } = require('../services/authService');
        blacklistAdd(decoded.jti); // 캐시 재등록
        return res
          .status(401)
          .json({ success: false, error: '만료된 세션입니다. 다시 로그인하세요.', revoked: true });
      }
    } catch (_) {
      /* DB 오류 시 통과 — 가용성 우선 */
    }
  }

  req.user = decoded;
  next();
}

// 최소 역할 레벨 검사
function requireLevel(minLevel) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    if (!req.user) return res.status(401).json({ success: false, error: '인증 필요' });
    const roleInfo = getRoleInfo(req.user.role);
    if (roleInfo.level < minLevel)
      return res.status(403).json({ success: false, error: '접근 권한이 없습니다.' });
    next();
  };
}

// API 경로별 자동 레벨 검사
function autoLevel(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  if (!req.user) return next();
  const required = getRequiredLevel(req.path);
  const current = getRoleInfo(req.user.role).level;
  if (current < required)
    return res.status(403).json({ success: false, error: '접근 권한이 없습니다.' });
  next();
}

module.exports = { authenticate, requireLevel, autoLevel };
