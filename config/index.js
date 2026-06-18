'use strict';
require('dotenv').config({ override: true });

const env = process.env.NODE_ENV || 'development';

const base = {
  env,
  port:      parseInt(process.env.PORT,       10) || 3000,
  httpsPort: parseInt(process.env.HTTPS_PORT, 10) || 3443,

  // ── JWT 보안 ─────────────────────────────────────────────
  jwtSecret:            process.env.JWT_SECRET             || 'oci-crm-access-secret-CHANGE-ME',
  jwtExpires:           process.env.ACCESS_TOKEN_EXPIRES   || '15m',   // ② Access Token 짧은 만료
  refreshSecret:        process.env.REFRESH_TOKEN_SECRET   || 'oci-crm-refresh-secret-CHANGE-ME',
  refreshTokenExpires:  process.env.REFRESH_TOKEN_EXPIRES  || '7d',    // ③ Refresh Token

  // ── SSL / HTTPS ──────────────────────────────────────────
  sslKeyPath:  process.env.SSL_KEY_PATH  || '',
  sslCertPath: process.env.SSL_CERT_PATH || '',

  encryptionKey: process.env.ENCRYPTION_KEY || '',
  geminiKey:  process.env.GEMINI_API_KEY || '',
  // 카카오 JavaScript 키 (공개 가능, 클라이언트 노출 OK)
  kakaoMapKey: process.env.KAKAO_MAP_KEY || '',
  // 한국수출입은행 환율 API 키 (없으면 frankfurter fallback)
  eximApiKey:  process.env.EXIM_API_KEY  || '',
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [],
  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'oci_crm',
  },
};

const overrides = {
  development: {
    db: { ...base.db, connectionLimit: 5 },
    logLevel: 'debug',
  },
  test: {
    db: { ...base.db, connectionLimit: 3 },
    logLevel: 'error',   // 테스트 시 콘솔 노이즈 억제
    rateLimit: { skip: true },
  },
  production: {
    db: { ...base.db, connectionLimit: 20 },
    logLevel: 'warn',
    rateLimit: { skip: false },
  },
};

const config = { ...base, ...(overrides[env] || overrides.development) };

module.exports = config;
