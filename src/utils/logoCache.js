'use strict';
// =============================================================
// Logo URL 캐시 — server.js GET / 에서 동적 로고 주입용
//
// 목적:
//   - GET / 요청마다 DB 조회 부담 회피 (60초 TTL)
//   - 업로드/삭제 시 캐시 즉시 invalidate (logo.js 에서 호출)
//
// 안전 fallback:
//   - DB 조회 실패 시 기본 SVG URL 반환
// =============================================================

const pool = require('../db');

const DEFAULT_LOGO_URL = '/assets/default-logo.svg';
const TTL_MS = 60 * 1000;

const _cache = { url: null, ts: 0 };

async function getCurrentLogoUrl() {
  if (_cache.url && Date.now() - _cache.ts < TTL_MS) {
    return _cache.url;
  }
  try {
    const [[row]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'logo_path' LIMIT 1`
    );
    _cache.url = row?.setting_value || DEFAULT_LOGO_URL;
    _cache.ts = Date.now();
  } catch (_) {
    _cache.url = DEFAULT_LOGO_URL;
    _cache.ts = Date.now();
  }
  return _cache.url;
}

function invalidate() {
  _cache.ts = 0;
}

module.exports = { getCurrentLogoUrl, invalidate, DEFAULT_LOGO_URL };
