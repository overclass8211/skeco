'use strict';
// =============================================================
// /api/menu — 사이드바 메뉴 조회 (인증된 사용자 누구나)
//   GET /sidebar     is_visible=1 인 항목만 반환 + 사용자 role 로 RBAC 필터
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { ROLE_PAGES } = require('../services/authService');

// ROLE_PAGES 에 매핑되지 않는 menu_key — 역할 무관 표시 (feature flag 로 별도 제어)
//   orders        : ERP 연계 (data-feature="erp.integration")
//   ai-assistant  : AI 어시스턴트 (data-action="ai-open", page 아님)
const ALWAYS_VISIBLE = new Set(['orders', 'ai-assistant']);

router.get('/sidebar', async (req, res) => {
  try {
    const role = req.user?.role || 'manager';
    const allowed = ROLE_PAGES[role] || ROLE_PAGES.manager;
    const allAccess = allowed.includes('*');

    const [sections] = await pool.query(
      `SELECT section_key, section_label, display_order
       FROM menu_sections
       WHERE is_visible = 1
       ORDER BY display_order ASC, section_key ASC`
    );
    const [allItems] = await pool.query(
      `SELECT menu_key, section_key, display_order, label_override
       FROM menu_items
       WHERE is_visible = 1
       ORDER BY section_key ASC, display_order ASC`
    );

    // RBAC 필터링 — 권한 없는 항목은 응답에서 제외
    // (프론트 applyRbacToNav 의 inline display:none 과 충돌하지 않도록)
    const items = allItems.filter(it => {
      // 개발자 옵션은 superadmin 전용
      if (it.menu_key === 'dev') return role === 'superadmin';
      // 역할 무관 표시 항목 (feature flag 로 별도 제어)
      if (ALWAYS_VISIBLE.has(it.menu_key)) return true;
      // 그 외: ROLE_PAGES 기준
      return allAccess || allowed.includes(it.menu_key);
    });

    res.json({ success: true, data: { sections, items } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
