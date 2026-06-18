'use strict';
// =============================================================
// KpiBar — KPI 카드 바 공통 컴포넌트 (v6.0.0)
//
// 5개 모듈(고객사/리드/견적/제안/계약) 상단 KPI 대시보드 통일
//
// 사용:
//   KpiBar.render({
//     containerSel: '#kpi-container',
//     cards: [
//       { icon: '⛔', label: '만료 경과', value: 2, color: '#dc2626',
//         sub: '계약 갱신/종료 필요', onClick: () => {...} },
//       ...
//     ]
//   });
//
// 디자인 원칙 (미니멀):
//   - 좌측 4px 컬러 accent bar
//   - 큰 숫자 (28px, 700 weight, tabular-nums)
//   - 아이콘 + 라벨(12px) 헤더
//   - 서브 설명(11px, text-3)
//   - 호버 시 translateY(-2px) + 그림자
// =============================================================
const KpiBar = (() => {
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _fmtValue(v) {
    const n = Number(v) || 0;
    // 1000+ 는 K, 1M+ 는 M (단순)
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString('ko-KR');
  }

  /**
   * 카드 단일 HTML
   * @param {Object} card
   * @param {string} card.icon — 이모지/심볼
   * @param {string} card.label — 라벨 (12px)
   * @param {string|number} card.value — 큰 숫자
   * @param {string} card.color — 좌측 accent + 큰 숫자 색 (예: '#dc2626')
   * @param {string} [card.sub] — 서브 설명 (11px)
   * @param {number} [card.idx] — 이벤트 위임용 인덱스
   */
  function _cardHtml(card, idx) {
    const color = card.color || '#6b7280';
    return `<div class="kpi-card" data-kpi-idx="${idx}" role="button" tabindex="0"
        title="${esc(card.label)} — ${esc(card.value)}">
      <div class="kpi-card-accent" style="background:${color}"></div>
      <div class="kpi-card-body">
        <div class="kpi-card-header">
          <span class="kpi-icon" aria-hidden="true">${card.icon || ''}</span>
          <span class="kpi-label">${esc(card.label)}</span>
        </div>
        <div class="kpi-card-value" style="color:${color}">${esc(_fmtValue(card.value))}</div>
        ${card.sub ? `<div class="kpi-card-sub">${esc(card.sub)}</div>` : ''}
      </div>
    </div>`;
  }

  /**
   * 컨테이너에 KPI 바 렌더 + 이벤트 바인딩
   * @param {Object} opts
   * @param {string|HTMLElement} opts.containerSel — 컨테이너 (selector 또는 element)
   * @param {Array} opts.cards — 카드 정의 배열
   */
  function render({ containerSel, cards }) {
    const container =
      typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
    if (!container) {
      console.warn('[KpiBar] container not found:', containerSel);
      return;
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `<div class="kpi-bar">
      ${cards.map((c, i) => _cardHtml(c, i)).join('')}
    </div>`;

    // 이벤트 위임 — 각 카드의 onClick 콜백
    container.querySelectorAll('.kpi-card[data-kpi-idx]').forEach(el => {
      const idx = parseInt(el.dataset.kpiIdx, 10);
      const card = cards[idx];
      if (!card || typeof card.onClick !== 'function') return;
      el.addEventListener('click', () => card.onClick(card));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.onClick(card);
        }
      });
    });
  }

  /**
   * 로딩 상태 렌더 (skeleton)
   * @param {string|HTMLElement} containerSel
   * @param {number} [count=4] — skeleton 카드 개수
   */
  function renderLoading(containerSel, count = 4) {
    const container =
      typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
    if (!container) return;
    const skeletons = Array.from(
      { length: count },
      () => `<div class="kpi-card kpi-card-skeleton">
        <div class="kpi-card-accent" style="background:#e5e7eb"></div>
        <div class="kpi-card-body">
          <div class="kpi-skel kpi-skel-label"></div>
          <div class="kpi-skel kpi-skel-value"></div>
        </div>
      </div>`
    ).join('');
    container.innerHTML = `<div class="kpi-bar">${skeletons}</div>`;
  }

  return { render, renderLoading };
})();
