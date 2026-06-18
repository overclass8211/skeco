'use strict';
// =============================================================
// /api/admin/labels  —  워드 사전(Word Repository) 관리 — 다국어 지원
//
// 권한: level 4 (admin) 이상
// 엔드포인트:
//   GET    /?locale=ko       — 전체 라벨 (해당 locale 기본값+현재값)
//   GET    /scope/:scope?locale=ko
//   PUT    /                 — 일괄 저장 [{scope,key,locale,label}]
//   PUT    /:scope/:key      — 단건 저장 (body: {label, locale?})
//   POST   /reset            — 초기화 (body: {scope?, locale?})
//   GET    /audit            — 변경 이력 (최근 200건)
//   GET    /locales          — 지원 언어 목록 + 시스템 locale
//   PUT    /system-locale    — 시스템 기본 언어 변경 (admin)
//
// 별도 퍼블릭: GET /api/labels?locale=ko
//   → 인증된 모든 사용자가 dictionary + 시스템 locale 조회
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const {
  LABEL_DEFAULTS,
  SUPPORTED_LOCALES,
  LOCALE_INFO,
  getDefaultLabel,
} = require('../data/labelDefaults');

// ── 테이블 자가 생성 (idempotent) ─────────────────────────────
pool
  .query(
    `CREATE TABLE IF NOT EXISTS admin_labels (
       scope       VARCHAR(50) NOT NULL,
       key_name    VARCHAR(80) NOT NULL,
       locale      VARCHAR(10) NOT NULL DEFAULT 'ko',
       label       VARCHAR(200) NOT NULL,
       updated_by  INT NULL,
       updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (scope, key_name, locale)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  )
  .catch(() => {});

pool
  .query(
    `CREATE TABLE IF NOT EXISTS admin_label_audit (
       id          BIGINT AUTO_INCREMENT PRIMARY KEY,
       scope       VARCHAR(50) NOT NULL,
       key_name    VARCHAR(80) NOT NULL,
       locale      VARCHAR(10) NOT NULL DEFAULT 'ko',
       old_label   VARCHAR(200),
       new_label   VARCHAR(200),
       changed_by  INT NULL,
       changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_scope_key (scope, key_name),
       INDEX idx_changed_at (changed_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  )
  .catch(() => {});

// 시스템 기본 locale 시드 (system_settings 테이블 활용)
pool
  .query(
    `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('system_locale', 'ko')`
  )
  .catch(() => {});

// ── locale 정규화 ────────────────────────────────────────────
function normalizeLocale(v) {
  const s = String(v || 'ko')
    .toLowerCase()
    .slice(0, 5);
  return SUPPORTED_LOCALES.includes(s) ? s : 'ko';
}

async function getSystemLocale() {
  try {
    const [[row]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'system_locale'`
    );
    return normalizeLocale(row?.setting_value);
  } catch (_) {
    return 'ko';
  }
}

// ── 헬퍼: 기본값 + 현재값 병합 (locale 지정) ─────────────────
async function buildMergedLabels(scope, locale) {
  locale = normalizeLocale(locale);
  const scopes = scope ? [scope] : Object.keys(LABEL_DEFAULTS);

  const cond = ['locale = ?'];
  const params = [locale];
  if (scope) {
    cond.push('scope = ?');
    params.push(scope);
  }

  const [overrides] = await pool.query(
    `SELECT scope, key_name, label, updated_by, updated_at
       FROM admin_labels WHERE ${cond.join(' AND ')}`,
    params
  );
  const overrideMap = {};
  overrides.forEach(o => {
    overrideMap[`${o.scope}.${o.key_name}`] = o;
  });

  const out = {};
  scopes.forEach(s => {
    const entries = LABEL_DEFAULTS[s] || {};
    out[s] = {};
    Object.entries(entries).forEach(([k, def]) => {
      const ov = overrideMap[`${s}.${k}`];
      const defaultLabel = getDefaultLabel(s, k, locale);
      out[s][k] = {
        default: defaultLabel,
        desc: def.desc || '',
        current: ov ? ov.label : defaultLabel,
        overridden: !!ov,
        updated_at: ov ? ov.updated_at : null,
      };
    });
  });
  return out;
}

// ── GET / ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const locale = normalizeLocale(req.query.locale);
    const merged = await buildMergedLabels(null, locale);
    const systemLocale = await getSystemLocale();
    // Fix 3: 브라우저 캐싱 — 라벨은 자주 변경되지 않음 (페이지 전환 시 재요청 부담 ↓)
    // private = 공유 캐시(Nginx 등) 우회, 사용자별 브라우저만 캐싱
    // max-age=300 = 5분간 캐시 (라벨 수정 후 최대 5분 지연 허용 — 운영 영향 미미)
    res.set('Cache-Control', 'private, max-age=300');
    res.json({
      success: true,
      data: {
        scopes: Object.keys(LABEL_DEFAULTS),
        labels: merged,
        locale,
        system_locale: systemLocale,
        locales: SUPPORTED_LOCALES.map(c => ({ code: c, ...LOCALE_INFO[c] })),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /scope/:scope ────────────────────────────────────────
router.get('/scope/:scope', async (req, res) => {
  try {
    const { scope } = req.params;
    if (!LABEL_DEFAULTS[scope]) {
      return res.status(404).json({ success: false, error: `알 수 없는 도메인: ${scope}` });
    }
    const locale = normalizeLocale(req.query.locale);
    const merged = await buildMergedLabels(scope, locale);
    res.json({ success: true, data: merged[scope], locale });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /audit ───────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit) || 200);
    const [rows] = await pool.query(
      `SELECT a.id, a.scope, a.key_name, a.locale,
              a.old_label, a.new_label, a.changed_at,
              tm.name AS changed_by_name, tm.id AS changed_by_id
         FROM admin_label_audit a
         LEFT JOIN team_members tm ON a.changed_by = tm.id
         ORDER BY a.changed_at DESC
         LIMIT ?`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /locales — 지원 언어 + 시스템 locale ─────────────────
router.get('/locales', async (_req, res) => {
  try {
    const systemLocale = await getSystemLocale();
    res.json({
      success: true,
      data: {
        supported: SUPPORTED_LOCALES.map(c => ({ code: c, ...LOCALE_INFO[c] })),
        system_locale: systemLocale,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /system-locale — 시스템 기본 언어 변경 ───────────────
router.put('/system-locale', async (req, res) => {
  try {
    const locale = normalizeLocale(req.body?.locale);
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('system_locale', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [locale]
    );
    res.json({ success: true, system_locale: locale });
  } catch (err) {
    handleError(res, err);
  }
});

// ── upsert 헬퍼 ──────────────────────────────────────────────
async function upsertLabel(conn, { scope, key_name, label, locale, userId }) {
  if (!LABEL_DEFAULTS[scope] || !LABEL_DEFAULTS[scope][key_name]) {
    throw Object.assign(new Error(`알 수 없는 라벨: ${scope}.${key_name}`), { status: 400 });
  }
  locale = normalizeLocale(locale);
  const cleaned = String(label || '')
    .trim()
    .slice(0, 200);
  if (!cleaned) {
    throw Object.assign(new Error('라벨은 비워둘 수 없습니다.'), { status: 400 });
  }
  const [[curr]] = await conn.query(
    'SELECT label FROM admin_labels WHERE scope=? AND key_name=? AND locale=?',
    [scope, key_name, locale]
  );
  const oldLabel = curr ? curr.label : getDefaultLabel(scope, key_name, locale);
  if (oldLabel === cleaned) return { changed: false };

  await conn.query(
    `INSERT INTO admin_labels (scope, key_name, locale, label, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), updated_by = VALUES(updated_by)`,
    [scope, key_name, locale, cleaned, userId || null]
  );
  await conn.query(
    `INSERT INTO admin_label_audit (scope, key_name, locale, old_label, new_label, changed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [scope, key_name, locale, oldLabel, cleaned, userId || null]
  );
  return { changed: true };
}

// ── PUT / (일괄) ─────────────────────────────────────────────
router.put('/', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ success: false, error: 'items 배열이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let changedCount = 0;
    for (const it of items) {
      const r = await upsertLabel(conn, {
        scope: it.scope,
        key_name: it.key,
        label: it.label,
        locale: it.locale || req.body?.locale,
        userId: req.user?.id,
      });
      if (r.changed) changedCount++;
    }
    await conn.commit();
    res.json({ success: true, changed: changedCount, total: items.length });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:scope/:key (단건) ──────────────────────────────────
router.put('/:scope/:key', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await upsertLabel(conn, {
      scope: req.params.scope,
      key_name: req.params.key,
      label: req.body?.label,
      locale: req.body?.locale || req.query?.locale,
      userId: req.user?.id,
    });
    await conn.commit();
    res.json({ success: true, changed: r.changed });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── POST /reset ──────────────────────────────────────────────
// body: { scope?, locale? }
//   scope+locale  : 해당 도메인 + 해당 언어만
//   scope         : 해당 도메인 전 언어
//   locale        : 전체 도메인 + 해당 언어
//   (둘 다 미지정) : 모두 초기화
router.post('/reset', async (req, res) => {
  try {
    const scope = req.body?.scope;
    const locale = req.body?.locale ? normalizeLocale(req.body.locale) : null;
    if (scope && !LABEL_DEFAULTS[scope]) {
      return res.status(400).json({ success: false, error: `알 수 없는 도메인: ${scope}` });
    }
    const where = [];
    const params = [];
    if (scope) {
      where.push('scope = ?');
      params.push(scope);
    }
    if (locale) {
      where.push('locale = ?');
      params.push(locale);
    }
    const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [curr] = await pool.query(
      `SELECT scope, key_name, locale, label FROM admin_labels ${cond}`,
      params
    );
    for (const row of curr) {
      const def = LABEL_DEFAULTS[row.scope]?.[row.key_name];
      if (!def) continue;
      const restored = getDefaultLabel(row.scope, row.key_name, row.locale);
      await pool.query(
        `INSERT INTO admin_label_audit (scope, key_name, locale, old_label, new_label, changed_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        [row.scope, row.key_name, row.locale, row.label, restored, req.user?.id || null]
      );
    }
    await pool.query(`DELETE FROM admin_labels ${cond}`, params);
    res.json({
      success: true,
      reset: curr.length,
      scope: scope || 'ALL',
      locale: locale || 'ALL',
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 퍼블릭 라우터: GET /api/labels?locale=ko ─────────────────
const publicRouter = require('express').Router();

publicRouter.get('/', async (req, res) => {
  try {
    const systemLocale = await getSystemLocale();
    // locale 미지정 시 시스템 locale 사용
    const locale = req.query.locale ? normalizeLocale(req.query.locale) : systemLocale;
    const merged = await buildMergedLabels(null, locale);
    const flat = {};
    Object.entries(merged).forEach(([scope, entries]) => {
      flat[scope] = {};
      Object.entries(entries).forEach(([k, v]) => {
        flat[scope][k] = v.current;
      });
    });
    res.json({
      success: true,
      data: flat,
      locale,
      system_locale: systemLocale,
      locales: SUPPORTED_LOCALES.map(c => ({ code: c, ...LOCALE_INFO[c] })),
      ts: Date.now(),
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
