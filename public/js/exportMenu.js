// =============================================================
// ExportMenu — 통합 익스포트 드롭다운 컴포넌트
//
// 사용법:
//   <button class="btn btn-secondary btn-sm"
//           data-action="export-menu"
//           data-export-path="/leads/export?stage=won"
//           data-export-name="영업리드_won">
//     ⤓ 내보내기
//   </button>
//
// 클릭 시 드롭다운 표시 → Excel / CSV / JSON 선택 → 다운로드
//
// 또는 코드로:
//   ExportMenu.open(triggerEl, '/leads/export', '영업리드');
// =============================================================
'use strict';

const ExportMenu = {
  _menuEl: null,
  _initialized: false,
  // open() 호출 직후 일정 시간 동안은 outside-click 닫힘 무시
  // (open() 을 트리거한 같은 click 이벤트가 document 까지 bubble 되면서
  //  바로 닫혀 "깜박이며 사라짐" 현상이 발생하던 버그 방지)
  _suppressUntil: 0,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    // 전역 이벤트 위임 — data-action="export-menu" 가진 버튼
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="export-menu"]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        this.open(btn, btn.dataset.exportPath, btn.dataset.exportName);
        return;
      }
      // 메뉴 항목 클릭
      const item = e.target.closest('.export-menu-item');
      if (item) {
        const fmt = item.dataset.format;
        const path = this._menuEl?.dataset.exportPath;
        const name = this._menuEl?.dataset.exportName;
        if (path && name && fmt) {
          API.downloadExport(path, name, fmt);
          Toast?.info?.(`${fmt.toUpperCase()} 다운로드 시작...`);
        }
        this.close();
        return;
      }
      // 메뉴 바깥 클릭 → 닫기 (단, open 직후 짧은 시간은 무시)
      if (this._menuEl && !e.target.closest('.export-menu-pop')) {
        if (Date.now() < this._suppressUntil) return;
        this.close();
      }
    });

    // Esc → 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._menuEl) this.close();
    });
  },

  open(triggerEl, path, name) {
    this.init();
    if (!path || !name) {
      Toast?.error?.('익스포트 경로/파일명이 지정되지 않았습니다.');
      return;
    }
    // 동기적 정리 — 잔여 메뉴 즉시 제거 (테스트 race 방지)
    document.querySelectorAll('.export-menu-pop').forEach(el => el.remove());
    this._menuEl = null;

    // open() 을 트리거한 click 이벤트가 document 로 bubble 되어
    // 새로 만든 메뉴를 즉시 닫는 race 방지 — 250ms 동안 outside-click 무시
    this._suppressUntil = Date.now() + 250;

    const menu = document.createElement('div');
    menu.className = 'export-menu-pop';
    menu.dataset.exportPath = path;
    menu.dataset.exportName = name;
    menu.innerHTML = `
      <button class="export-menu-item" data-format="xlsx">
        <span class="export-menu-icon">📊</span>
        <div>
          <div class="export-menu-label">Excel (xlsx)</div>
          <div class="export-menu-desc">Microsoft Excel · 한국 표준</div>
        </div>
      </button>
      <button class="export-menu-item" data-format="csv">
        <span class="export-menu-icon">📋</span>
        <div>
          <div class="export-menu-label">CSV</div>
          <div class="export-menu-desc">BI · Tableau · 분석 도구</div>
        </div>
      </button>
      <button class="export-menu-item" data-format="json">
        <span class="export-menu-icon">{ }</span>
        <div>
          <div class="export-menu-label">JSON</div>
          <div class="export-menu-desc">개발자 · API 통합</div>
        </div>
      </button>
    `;
    document.body.appendChild(menu);
    this._menuEl = menu;

    // 위치 계산 — trigger 바로 아래
    const rect = triggerEl.getBoundingClientRect();
    const menuWidth = 240;
    let left = rect.left;
    // 뷰포트 우측 초과 시 왼쪽 정렬로
    if (left + menuWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.right - menuWidth);
    }
    menu.style.left = left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';

    // 다음 프레임에 visible 전환 (transition)
    requestAnimationFrame(() => menu.classList.add('is-open'));
  },

  close() {
    if (!this._menuEl) return;
    this._menuEl.classList.remove('is-open');
    const el = this._menuEl;
    this._menuEl = null;
    setTimeout(() => el.remove(), 150);
  },
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ExportMenu.init());
  } else {
    ExportMenu.init();
  }
}
