'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const otplib = require('otplib');
const config = require('../../config');
const { encrypt, decrypt } = require('../utils/crypto');

const ACCESS_SECRET = config.jwtSecret;
const ACCESS_EXPIRES = config.jwtExpires; // 기본 15m
const REFRESH_DAYS = 7; // Refresh Token 유효 일수
// 참고: REFRESH_SECRET 은 현재 사용 안 함 (refresh token 은 opaque + DB hash 비교 방식)

// 역할 정의
const ROLES = {
  manager: { level: 1, label: '매니저', color: '#6c757d' },
  team_lead: { level: 2, label: '팀장', color: '#3788d8' },
  executive: { level: 3, label: '경영진', color: '#fd7e14' },
  admin: { level: 4, label: 'IT운영관리자', color: '#8B5CF6' },
  superadmin: { level: 5, label: '시스템담당자', color: '#e63946' },
};

const ROLE_PAGES = {
  manager: [
    'customer360',
    'dashboard',
    'pipeline',
    'leads',
    'customers',
    'calendar',
    'support',
    'quality', // 전사 품질관리 (Quality Inbox) — 전원 조회
    'quotes',
    'proposals',
    'contracts',
    'meeting',
    'meeting-list',
    'board',
    'settings',
  ],
  team_lead: [
    'customer360',
    'dashboard',
    'pipeline',
    'forecast', // 매출 포캐스트 (재무 민감 — team_lead 이상)
    'fcstsc', // 반도체 수급 FCST (재무 민감 — team_lead 이상)
    'leads',
    'customers',
    'calendar',
    'support',
    'quality', // 전사 품질관리
    'quotes',
    'proposals',
    'contracts',
    'revenue', // 매출관리 (P2 — 재무 민감, team_lead 이상)
    'payments', // v8.0.0 SFR-011 수금관리 — team_lead 이상 (재무 민감 정보)
    'team',
    'reports',
    'report-builder',
    'meeting',
    'meeting-list',
    'board',
    'settings',
    'projects',
    'cost',
  ],
  executive: [
    'exec360',
    'customer360',
    'dashboard',
    'pipeline',
    'forecast',
    'fcstsc', // 반도체 수급 FCST (재무 민감 — team_lead 이상)
    'leads',
    'customers',
    'calendar',
    'support',
    'quality', // 전사 품질관리
    'quotes',
    'proposals',
    'contracts',
    'revenue', // 매출관리 (P2)
    'payments', // v8.0.0 SFR-011 수금관리
    'team',
    'reports',
    'report-builder',
    'meeting',
    'meeting-list',
    'board',
    'settings',
    'projects',
    'cost',
    'admin',
  ],
  admin: [
    'exec360',
    'customer360',
    'dashboard',
    'pipeline',
    'forecast',
    'fcstsc', // 반도체 수급 FCST (재무 민감 — team_lead 이상)
    'leads',
    'customers',
    'calendar',
    'support',
    'quality', // 전사 품질관리
    'quotes',
    'proposals',
    'contracts',
    'revenue', // 매출관리 (P2)
    'payments', // v8.0.0 SFR-011 수금관리
    'team',
    'reports',
    'report-builder',
    'meeting',
    'meeting-list',
    'board',
    'settings',
    'projects',
    'cost',
    'admin',
  ],
  superadmin: ['*'],
};

const API_LEVEL_MAP = {
  '/admin/team-members': 4, // admin(IT운영관리자) 이상
  '/admin/menu-config': 4, // 메뉴 구조 변경은 admin 이상만
  '/admin/labels': 4, // 워드 사전 관리는 admin 이상만
  '/admin/logo': 4, // 로고 관리는 admin 이상만
  '/admin/supplier-info': 4, // Phase 7: 공급사 기본 정보 (admin 이상만 수정)
  '/admin': 3, // executive 이상
  '/team': 2, // team_lead 이상
  '/reports': 2,
  '/report-builder': 2, // 리포트 빌더는 team_lead 이상만
  '/products': 2, // 원가관리(상품/원자재) — team_lead 이상 (마진 정보 보호)
};

// ── 패스워드 ────────────────────────────────────────────────
function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── Access Token ────────────────────────────────────────────
// ④ 중요 정보(email, full_name) 제거 — id·username·role·jti만 포함
function signToken(user, jti) {
  const tokenJti = jti || crypto.randomUUID();
  return {
    token: jwt.sign(
      { id: user.id, username: user.username, role: user.role, jti: tokenJti },
      ACCESS_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    ),
    jti: tokenJti,
  };
}

function verifyToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

// ── Refresh Token ③ ─────────────────────────────────────────
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex'); // 128자 랜덤 문자열
}

function signRefreshToken(_userId, _jti) {
  // DB 저장용 — JWT가 아닌 opaque token (서명/검증은 DB hash 비교)
  // 인자(_userId, _jti)는 인터페이스 유지용 (현재 미사용)
  const raw = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  return { raw, expiresAt };
}

// bcrypt.hash/compare 가 이미 Promise 반환 — 그대로 위임
function hashRefreshToken(raw) {
  return bcrypt.hash(raw, 10); // 빠른 해시 (salt rounds 낮춤)
}

function verifyRefreshToken(raw, hash) {
  return bcrypt.compare(raw, hash);
}

// ── 토큰 블랙리스트 (인메모리 캐시 + DB) ────────────────────
// ⑤ 로그아웃/강제만료: 만료 전 access token 즉시 무효화
const _blacklistCache = new Set(); // 메모리 캐시 (재시작 시 초기화 → DB 보조)

function blacklistAdd(jti) {
  _blacklistCache.add(jti);
}

function blacklistHas(jti) {
  return _blacklistCache.has(jti);
}

// 서버 시작 시 DB에서 미만료 블랙리스트 복원 (재시작 대비)
async function loadBlacklistFromDB(pool) {
  try {
    const [rows] = await pool.query('SELECT jti FROM token_blacklist WHERE expires_at > NOW()');
    rows.forEach(r => _blacklistCache.add(r.jti));
    // 만료된 항목 정리
    await pool.query('DELETE FROM token_blacklist WHERE expires_at <= NOW()');
    await pool.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW() AND revoked = 0');
  } catch (_) {
    /* 테이블 미생성 시 무시 */
  }
}

// ── OTP (secret은 AES-256-GCM으로 암호화하여 DB 저장) ────────
function generateOtpSecret() {
  return otplib.generateSecret();
}
function encryptOtpSecret(s) {
  return encrypt(s);
} // DB 저장 전 호출
function decryptOtpSecret(s) {
  return decrypt(s);
} // DB에서 읽은 후 호출

function generateOtpUri(secret, user) {
  // secret은 복호화된 원문이어야 함
  return otplib.generateURI({
    strategy: 'totp',
    label: user,
    issuer: 'SK ecoplant materials',
    secret,
  });
}
function verifyOtp(token, secret) {
  // secret은 복호화된 원문이어야 함
  const r = otplib.verifySync({ strategy: 'totp', token, secret });
  return r === true || (r && r.valid === true);
}

// ── RBAC ─────────────────────────────────────────────────────
function getRoleInfo(role) {
  return ROLES[role] || ROLES.manager;
}
function canAccessPage(role, page) {
  const pages = ROLE_PAGES[role] || ROLE_PAGES.manager;
  return pages.includes('*') || pages.includes(page);
}
function getRequiredLevel(apiPath) {
  for (const [prefix, level] of Object.entries(API_LEVEL_MAP)) {
    if (apiPath.startsWith(prefix)) return level;
  }
  return 1;
}

module.exports = {
  ROLES,
  ROLE_PAGES,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  signRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
  blacklistAdd,
  blacklistHas,
  loadBlacklistFromDB,
  generateOtpSecret,
  encryptOtpSecret,
  decryptOtpSecret,
  generateOtpUri,
  verifyOtp,
  getRoleInfo,
  canAccessPage,
  getRequiredLevel,
};
