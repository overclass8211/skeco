'use strict';
// =============================================================
// ViewToggle — 목록/카드 뷰 토글 공통 컴포넌트 (v6.0.0)
//
// 5개 모듈(고객사/리드/견적/제안/계약) UI 통일을 위한 공통 헬퍼
//
// 사용:
//   ViewToggle.render({
//     currentView: 'list',
//     onChange: view => { ... },
//     storageKey: 'customers_view'  // localStorage 동기화 (옵션)
//   });
//
// 반환: <div class="view-toggle">...</div> HTML 문자열
//
// 이벤트 바인딩: ViewToggle.bind(containerEl, onChange)
// =============================================================
const ViewToggle = (() => {
  /**
   * HTML 생성 — list/card 2개 옵션
   * @param {Object} opts
   * @param {'list'|'card'} opts.currentView — 현재 활성 뷰
   * @param {string} [opts.listLabel='목록'] — list 라벨
   * @param {string} [opts.cardLabel='카드'] — card 라벨
   * @returns {string} HTML
   */
  function render({ currentView = 'list', listLabel = '목록', cardLabel = '카드' } = {}) {
    return `<div class="view-toggle" role="tablist" aria-label="보기 모드 전환">
      <button type="button" class="view-toggle-btn ${currentView === 'list' ? 'active' : ''}"
        data-view="list" role="tab" aria-selected="${currentView === 'list'}" title="목록 보기">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z"/>
        </svg>
        <span>${listLabel}</span>
      </button>
      <button type="button" class="view-toggle-btn ${currentView === 'card' ? 'active' : ''}"
        data-view="card" role="tab" aria-selected="${currentView === 'card'}" title="카드 보기">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/>
        </svg>
        <span>${cardLabel}</span>
      </button>
    </div>`;
  }

  /**
   * 클릭 이벤트 바인딩 (Event Delegation)
   * @param {HTMLElement|string} container — 컨테이너 (selector 또는 element)
   * @param {Function} onChange — (view) => void
   * @param {string} [storageKey] — localStorage 동기화 키
   */
  function bind(container, onChange, storageKey = null) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) {
      console.warn('[ViewToggle] container not found:', container);
      return;
    }
    el.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (!view) return;
        // active 클래스 토글
        el.querySelectorAll('.view-toggle-btn').forEach(b => {
          const isActive = b.dataset.view === view;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', String(isActive));
        });
        // localStorage 저장
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, view);
          } catch (_) {}
        }
        // 콜백
        if (typeof onChange === 'function') onChange(view);
      });
    });
  }

  return { render, bind };
})();
