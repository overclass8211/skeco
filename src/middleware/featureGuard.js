'use strict';
// =============================================================
// featureGuard — 기능 플래그 기반 API 차단 미들웨어
//
// 🎯 목적:
//   dev_features 테이블의 토글이 OFF 면 해당 API 를 403 으로 차단.
//   기존 UI 레벨 숨김만으로는 우회 가능했던 보안 갭 해소.
//
// 사용법:
//   const { requireFeature } = require('../middleware/featureGuard');
//   router.get('/messages', requireFeature('gmail.read'), handler);
//
// 안전 옵션:
//   warnOnly: true  →  로그만 남기고 통과 (점진 도입용)
//
// 성능:
//   5초 in-memory 캐시 (TTL). 토글 변경 시 invalidate() 호출.
//   캐시 조회 실패 시 통과 (안전 fallback — 잠금보다 우선).
//
// ⚠️ 적용 금지 라우트 (자기 발 묶기 위험):
//   - /api/auth/*   (인증 자체)
//   - /api/admin/*  (관리 페널 — 잠그면 복구 불가)
//   - 핵심 CRUD (leads/customers/projects/calendar/dashboard)
// =============================================================

const pool = require('../db');

// In-memory cache (5초 TTL)
const _cache = { flags: {}, ts: 0 };
const CACHE_TTL_MS = 5000;

async function _refreshCache() {
  try {
    const [rows] = await pool.query('SELECT feature_key, is_enabled FROM dev_features');
    const map = {};
    rows.forEach(r => {
      map[r.feature_key] = !!r.is_enabled;
    });
    _cache.flags = map;
    _cache.ts = Date.now();
  } catch (err) {
    // DB 조회 실패 시 캐시 유지 (즉, 직전 상태로 동작)
    console.error('[featureGuard] cache refresh failed:', err.message);
  }
}

/**
 * 기능 플래그 조회 (캐시 사용)
 * @param {string} featureKey
 * @returns {Promise<boolean | undefined>}  undefined = 해당 key 없음 (안전상 통과)
 */
async function isFeatureEnabled(featureKey) {
  if (Date.now() - _cache.ts > CACHE_TTL_MS) {
    await _refreshCache();
  }
  // undefined 인 경우 = 매니페스트에 없는 key (개발자 오타 가능성)
  // 안전상 true 반환 (잠금보다 통과 우선)
  return _cache.flags[featureKey] !== false;
}

/**
 * Express 미들웨어 팩토리
 * @param {string} featureKey  매니페스트의 feature_key (예: 'gmail.read')
 * @param {object} [options]
 * @param {boolean} [options.warnOnly]  true 면 로그만 남기고 통과 (점진 도입)
 * @returns {import('express').RequestHandler}
 */
function requireFeature(featureKey, options = {}) {
  const warnOnly = !!options.warnOnly;

  return async function featureGuardMiddleware(req, res, next) {
    try {
      const enabled = await isFeatureEnabled(featureKey);
      if (enabled) {
        return next();
      }

      // OFF 상태
      const who = req.user?.id || req.user?.username || 'anonymous';
      if (warnOnly) {
        console.warn(
          `[featureGuard:warn] OFF feature accessed: ${featureKey} ` +
            `(${req.method} ${req.path}) by ${who}`
        );
        return next();
      }

      console.warn(
        `[featureGuard:block] ${featureKey} OFF — blocked ${req.method} ${req.path} by ${who}`
      );
      return res.status(403).json({
        success: false,
        error: '이 기능은 현재 비활성화 상태입니다. 관리자에게 문의하세요.',
        feature: featureKey,
        code: 'FEATURE_DISABLED',
      });
    } catch (err) {
      // 미들웨어 자체 에러 시 안전 fallback: 통과
      console.error(`[featureGuard] error for ${featureKey}:`, err.message);
      return next();
    }
  };
}

/**
 * 토글 변경 시 캐시 무효화 (admin.js PUT /dev/features/:key 에서 호출)
 */
function invalidate() {
  _cache.ts = 0;
}

module.exports = {
  requireFeature,
  isFeatureEnabled,
  invalidate,
};
