'use strict';
// =============================================================
// Menu Defaults — 사이드바 기본 구조
// initTables.js (시드) + menu-config.js (리셋) 양쪽에서 공유
// =============================================================

const DEFAULT_SECTIONS = [
  { section_key: 'main', section_label: '메인', display_order: 1, is_system: 0 },
  { section_key: 'erp', section_label: 'ERP', display_order: 2, is_system: 0 },
  { section_key: 'sales', section_label: '영업관리', display_order: 3, is_system: 0 },
  { section_key: 'cs', section_label: '고객지원', display_order: 4, is_system: 0 },
  { section_key: 'analysis', section_label: '분석', display_order: 5, is_system: 0 },
  { section_key: 'comm', section_label: '소통', display_order: 6, is_system: 0 },
  { section_key: 'ai', section_label: 'AI 기능', display_order: 7, is_system: 0 },
  // system 섹션은 관리자/설정/개발자옵션 등 시스템 필수 메뉴 — hide 불가
  { section_key: 'system', section_label: '시스템', display_order: 8, is_system: 1 },
];

const DEFAULT_ITEMS = [
  { menu_key: 'dashboard', section_key: 'main', display_order: 1, is_system: 0 },
  { menu_key: 'pipeline', section_key: 'main', display_order: 2, is_system: 0 },
  { menu_key: 'forecast', section_key: 'main', display_order: 3, is_system: 0 }, // 매출 포캐스트 (Phase A)
  { menu_key: 'fcstsc', section_key: 'main', display_order: 6, is_system: 0 }, // 반도체 수급 FCST (Phase 3)
  { menu_key: 'fcstmng', section_key: 'main', display_order: 7, is_system: 0 }, // 수급 FCST 관리 (Phase 4)
  { menu_key: 'orders', section_key: 'erp', display_order: 1, is_system: 0 },
  { menu_key: 'cost', section_key: 'erp', display_order: 2, is_system: 0 },
  { menu_key: 'leads', section_key: 'sales', display_order: 1, is_system: 0 },
  { menu_key: 'projects', section_key: 'sales', display_order: 2, is_system: 0 },
  { menu_key: 'customers', section_key: 'sales', display_order: 3, is_system: 0 },
  { menu_key: 'calendar', section_key: 'sales', display_order: 4, is_system: 0 },
  { menu_key: 'quotes', section_key: 'sales', display_order: 5, is_system: 0 },
  { menu_key: 'proposals', section_key: 'sales', display_order: 6, is_system: 0 },
  { menu_key: 'contracts', section_key: 'sales', display_order: 7, is_system: 0 },
  { menu_key: 'payments', section_key: 'sales', display_order: 8, is_system: 0 }, // v8.0.0 SFR-011 수금관리
  { menu_key: 'revenue', section_key: 'sales', display_order: 9, is_system: 0 }, // P2 매출관리
  { menu_key: 'support', section_key: 'cs', display_order: 1, is_system: 0 }, // 고객지원(A/S) P1
  { menu_key: 'quality', section_key: 'cs', display_order: 2, is_system: 0 }, // 전사 품질관리 (Quality Inbox)
  { menu_key: 'team', section_key: 'analysis', display_order: 1, is_system: 0 },
  { menu_key: 'reports', section_key: 'analysis', display_order: 2, is_system: 0 },
  { menu_key: 'report-builder', section_key: 'analysis', display_order: 3, is_system: 0 },
  { menu_key: 'board', section_key: 'comm', display_order: 1, is_system: 0 },
  { menu_key: 'ai-assistant', section_key: 'ai', display_order: 1, is_system: 0 },
  { menu_key: 'meeting', section_key: 'ai', display_order: 2, is_system: 0 },
  { menu_key: 'meeting-list', section_key: 'ai', display_order: 3, is_system: 0 },
  // 시스템 섹션 항목 — 관리자가 자기 발 묶지 않도록 hide 불가
  { menu_key: 'admin', section_key: 'system', display_order: 1, is_system: 1 },
  { menu_key: 'settings', section_key: 'system', display_order: 2, is_system: 1 },
  // 'dev'(개발자 옵션): 사이드바 메뉴 제거 → 관리자 콘솔 하위 진입(관리자 페이지 헤더 버튼)으로 이동
  { menu_key: 'customer360', section_key: 'main', display_order: 4, is_system: 0 },
  { menu_key: 'exec360', section_key: 'main', display_order: 5, is_system: 0 },
  // @scaffold:menu-items — 신규 페이지 메뉴 시드 자동 삽입 지점 (scaffold-page.js)
];

module.exports = { DEFAULT_SECTIONS, DEFAULT_ITEMS };
