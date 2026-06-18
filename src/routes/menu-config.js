'use strict';
// =============================================================
// /api/admin/menu-config — 사이드바 메뉴 구조 관리 (admin+ 전용)
//   GET    /         전체 설정 조회
//   PUT    /         일괄 저장 (sections + items)
//   POST   /reset    기본값으로 복원
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { DEFAULT_SECTIONS, DEFAULT_ITEMS } = require('../data/menuDefaults');

// ── 조회 ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [sections] = await pool.query(
      `SELECT section_key, section_label, display_order, is_visible, is_system
       FROM menu_sections
       ORDER BY display_order ASC, section_key ASC`
    );
    const [items] = await pool.query(
      `SELECT menu_key, section_key, display_order, is_visible, label_override, is_system
       FROM menu_items
       ORDER BY section_key ASC, display_order ASC`
    );
    res.json({ success: true, data: { sections, items } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 저장 ─────────────────────────────────────────────────
// 입력: { sections: [{section_key, section_label, display_order, is_visible}, ...],
//        items:    [{menu_key, section_key, display_order, is_visible, label_override}, ...] }
// 시스템 플래그(is_system=1) 항목/섹션은 라벨/가시성 변경 거부, 순서만 적용.
router.put('/', async (req, res) => {
  const { sections, items } = req.body || {};
  if (!Array.isArray(sections) || !Array.isArray(items)) {
    return res.status(400).json({ success: false, error: 'sections/items 배열이 필요합니다.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 섹션 업데이트
    for (const s of sections) {
      if (!s.section_key) continue;
      // 현재 시스템 플래그 확인 (클라이언트가 보낸 is_system 신뢰 X)
      const [[row]] = await conn.query(
        'SELECT is_system FROM menu_sections WHERE section_key = ?',
        [s.section_key]
      );
      if (!row) continue;
      if (row.is_system) {
        // 시스템 섹션: 순서만 변경 가능 (라벨/가시성 변경 거부)
        await conn.query(`UPDATE menu_sections SET display_order = ? WHERE section_key = ?`, [
          Number(s.display_order) || 0,
          s.section_key,
        ]);
      } else {
        await conn.query(
          `UPDATE menu_sections SET
             section_label = ?,
             display_order = ?,
             is_visible    = ?
           WHERE section_key = ?`,
          [
            (s.section_label || '').toString().slice(0, 100) || s.section_key,
            Number(s.display_order) || 0,
            s.is_visible ? 1 : 0,
            s.section_key,
          ]
        );
      }
    }

    // 항목 업데이트
    for (const it of items) {
      if (!it.menu_key) continue;
      const [[row]] = await conn.query('SELECT is_system FROM menu_items WHERE menu_key = ?', [
        it.menu_key,
      ]);
      if (!row) continue;
      if (row.is_system) {
        // 시스템 항목: 섹션 이동·순서만 변경 가능, hide / 라벨 변경 거부
        await conn.query(
          `UPDATE menu_items SET
             section_key   = ?,
             display_order = ?,
             updated_by    = ?
           WHERE menu_key = ?`,
          [
            it.section_key || 'system',
            Number(it.display_order) || 0,
            req.user?.id || null,
            it.menu_key,
          ]
        );
      } else {
        const label = it.label_override ? String(it.label_override).slice(0, 100) : null;
        await conn.query(
          `UPDATE menu_items SET
             section_key    = ?,
             display_order  = ?,
             is_visible     = ?,
             label_override = ?,
             updated_by     = ?
           WHERE menu_key = ?`,
          [
            it.section_key || 'main',
            Number(it.display_order) || 0,
            it.is_visible ? 1 : 0,
            label,
            req.user?.id || null,
            it.menu_key,
          ]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── 기본값 복원 ────────────────────────────────────────────────
// 모든 섹션/항목을 menuDefaults 로 되돌림 (라벨·가시성·순서 모두 초기화).
// 시드와 동일한 INSERT...ON DUPLICATE KEY UPDATE 패턴으로 멱등성 보장.
router.post('/reset', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const s of DEFAULT_SECTIONS) {
      await conn.query(
        `INSERT INTO menu_sections (section_key, section_label, display_order, is_visible, is_system)
         VALUES (?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           section_label = VALUES(section_label),
           display_order = VALUES(display_order),
           is_visible    = 1,
           is_system     = VALUES(is_system)`,
        [s.section_key, s.section_label, s.display_order, s.is_system]
      );
    }
    for (const it of DEFAULT_ITEMS) {
      await conn.query(
        `INSERT INTO menu_items (menu_key, section_key, display_order, is_visible, label_override, is_system)
         VALUES (?, ?, ?, 1, NULL, ?)
         ON DUPLICATE KEY UPDATE
           section_key    = VALUES(section_key),
           display_order  = VALUES(display_order),
           is_visible     = 1,
           label_override = NULL,
           is_system      = VALUES(is_system)`,
        [it.menu_key, it.section_key, it.display_order, it.is_system]
      );
    }
    await conn.commit();
    res.json({ success: true, message: '메뉴 구조가 기본값으로 복원되었습니다.' });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

module.exports = router;
