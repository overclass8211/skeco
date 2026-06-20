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

  // ── 라인 아이콘 레지스트리 ─────────────────────────────────
  // KPI 카드 아이콘을 이모지 대신 통일된 stroke SVG 로 렌더.
  // 호출부(각 페이지)는 기존 이모지 키를 그대로 넘기면 자동 치환된다.
  // (등록되지 않은 값/raw SVG 는 그대로 렌더 — 하위 호환)
  const _P = {
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M2 22h20"/><path d="M10 6h4M10 10h4M10 14h4"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    plus: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  };
  // 이모지/별칭 → 아이콘 키 매핑
  const _ICON_MAP = {
    '🏢': 'building', '✅': 'check', '🆕': 'plus', '💤': 'moon',
    '🎯': 'target', '🔥': 'clock', '🏆': 'trophy', '💰': 'money',
    '✏️': 'edit', '📤': 'send', '📋': 'clipboard', '⛔': 'ban',
  };
  function _icon(raw) {
    if (!raw) return '';
    if (typeof raw === 'string' && raw.indexOf('<svg') === 0) return raw; // raw SVG 그대로
    const key = _ICON_MAP[raw] || (_P[raw] ? raw : null);
    if (!key) return esc(String(raw)); // 미등록 이모지/텍스트는 안전 출력
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${_P[key]}</svg>`;
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
    // 세련된 톤: 큰 숫자는 중성(dark), 색은 소프트 틴트 아이콘 칩에만 — accent 바 제거
    const tint = /^#[0-9a-fA-F]{6}$/.test(color) ? color + '1A' : 'rgba(107,114,128,0.1)';
    const _titleVal = card.valueText !== undefined && card.valueText !== null ? card.valueText : card.value;
    return `<div class="kpi-card" data-kpi-idx="${idx}" role="button" tabindex="0"
        title="${esc(card.label)} — ${esc(_titleVal)}">
      <div class="kpi-card-body">
        <div class="kpi-card-header">
          <span class="kpi-icon" aria-hidden="true" style="color:${color};background:${tint}">${_icon(card.icon)}</span>
          <span class="kpi-label">${esc(card.label)}</span>
        </div>
        <div class="kpi-card-value">${esc(card.valueText !== undefined && card.valueText !== null ? card.valueText : _fmtValue(card.value))}</div>
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
