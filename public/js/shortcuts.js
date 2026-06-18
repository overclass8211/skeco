// =============================================================
// Keyboard Shortcuts — 글로벌 단축키 + 시퀀스 키 + 도움말 모달
//
// 단일 키:
//   N      — 새 리드 추가
//   /      — 검색 열기 (Cmd+K 대안)
//   ?      — 단축키 도움말 모달
//
// 시퀀스 (G + key, 1.2초 내):
//   G D    — 대시보드
//   G L    — 영업 리드
//   G C    — 고객사
//   G P    — 파이프라인
//   G M    — 회의록 목록
//   G K    — 캘린더
//
// 무시 조건 (단축키 비활성화):
//   • 입력 필드(input, textarea, contenteditable) 에 포커스
//   • 열린 모달이 있을 때 (Modal.isOpen)
//   • Ctrl/Cmd/Alt + 다른 키 조합 (브라우저 단축키 보존)
// =============================================================
'use strict';

const Shortcuts = {
  _initialized: false,
  _sequenceKey: null, // G 누르면 'G' 저장
  _sequenceTimer: null,
  _hintEl: null,

  // 시퀀스 매핑 — G 이후 키 → 페이지
  G_MAP: {
    d: 'dashboard',
    l: 'leads',
    c: 'customers',
    p: 'pipeline',
    m: 'meeting-list',
    k: 'calendar',
    r: 'reports',
    t: 'team',
    b: 'board',
    o: 'orders',
  },

  // 도움말 목록 (UI 렌더용)
  HELP_GROUPS: [
    {
      title: '글로벌',
      items: [
        { keys: ['N'], label: '새 리드 추가' },
        { keys: ['/'], label: '검색 열기' },
        { keys: ['⌘', 'K'], label: '검색 열기 (대안)' },
        { keys: ['?'], label: '이 도움말 표시' },
        { keys: ['Esc'], label: '모달/패널 닫기' },
      ],
    },
    {
      title: '페이지 이동 (G 누른 후)',
      items: [
        { keys: ['G', 'D'], label: '대시보드' },
        { keys: ['G', 'L'], label: '영업 리드' },
        { keys: ['G', 'C'], label: '고객사' },
        { keys: ['G', 'P'], label: '파이프라인' },
        { keys: ['G', 'M'], label: '회의록 목록' },
        { keys: ['G', 'K'], label: '캘린더' },
        { keys: ['G', 'R'], label: '리포트' },
        { keys: ['G', 'T'], label: '팀 현황' },
        { keys: ['G', 'B'], label: '게시판' },
        { keys: ['G', 'O'], label: '주문관리' },
      ],
    },
  ],

  // ─── 초기화 ──────────────────────────────────────────────
  init() {
    if (this._initialized) return;
    this._initialized = true;
    document.addEventListener('keydown', e => this._onKey(e));
  },

  _onKey(e) {
    // 한글 IME 조합 중에는 무시 (key 가 'Process')
    if (e.isComposing || e.key === 'Process') return;

    // 입력 필드 포커스 검사
    const ae = document.activeElement;
    const inField =
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable);
    if (inField) return;

    // 모달 열림 — 글로벌 단축키 비활성 (Esc 만 모달에서 처리)
    if (this._isAnyModalOpen()) return;

    // 수정자 키 조합 — Cmd+K 등은 별도 처리 (search.js)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key;

    // 시퀀스 진행 중 (G 다음 키)
    if (this._sequenceKey === 'G') {
      const target = this.G_MAP[key.toLowerCase()];
      this._clearSequence();
      if (target && typeof App !== 'undefined' && App.navigate && App.pages?.[target]) {
        e.preventDefault();
        App.navigate(target);
      }
      return;
    }

    // 단일 키 매핑
    if (key === '?') {
      e.preventDefault();
      this.showHelp();
      return;
    }
    if (key === '/') {
      e.preventDefault();
      if (typeof SearchModal !== 'undefined') SearchModal.show();
      return;
    }
    if (key.toLowerCase() === 'n') {
      e.preventDefault();
      this._actionNewLead();
      return;
    }
    if (key.toLowerCase() === 'g') {
      e.preventDefault();
      this._startSequence('G');
      return;
    }
  },

  _startSequence(key) {
    this._sequenceKey = key;
    this._showHint('G ' + Object.keys(this.G_MAP).join(' / ').toUpperCase() + '  (1.2초 내)');
    clearTimeout(this._sequenceTimer);
    this._sequenceTimer = setTimeout(() => this._clearSequence(), 1200);
  },

  _clearSequence() {
    this._sequenceKey = null;
    clearTimeout(this._sequenceTimer);
    this._hideHint();
  },

  // 시퀀스 힌트 — 화면 우하단에 잠깐 표시
  _showHint(text) {
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.className = 'shortcut-hint';
      document.body.appendChild(this._hintEl);
    }
    this._hintEl.textContent = text;
    this._hintEl.classList.add('is-show');
  },
  _hideHint() {
    if (this._hintEl) this._hintEl.classList.remove('is-show');
  },

  // ─── 모달 열림 감지 ─────────────────────────────────────
  _isAnyModalOpen() {
    // 1) Modal 유틸의 활성 모달 (.modal-overlay.active 가 표준)
    if (
      document.querySelector('.modal-overlay.active, .modal-overlay.show, .modal-overlay.is-open')
    )
      return true;
    // 2) 검색 모달
    const search = document.getElementById('global-search-modal');
    if (search && search.style.display !== 'none' && search.style.display !== '') return true;
    // 3) 헬스맵 사이드패널
    if (document.querySelector('.hm-side-panel.is-open')) return true;
    return false;
  },

  // ─── 동작 — 새 리드 ──────────────────────────────────────
  _actionNewLead() {
    if (typeof App === 'undefined') return;
    // 리드 페이지 아니면 먼저 이동
    if (App.currentPage !== 'leads') {
      App.navigate('leads').then(() => {
        setTimeout(() => App.openLeadForm?.(), 200);
      });
    } else {
      App.openLeadForm?.();
    }
  },

  // ─── 도움말 모달 ──────────────────────────────────────────
  showHelp() {
    const body = this.HELP_GROUPS.map(
      g => `
      <div class="shortcut-group">
        <div class="shortcut-group-title">${this._esc(g.title)}</div>
        <div class="shortcut-list">
          ${g.items
            .map(
              it => `
            <div class="shortcut-row">
              <div class="shortcut-keys">
                ${it.keys.map(k => `<kbd>${this._esc(k)}</kbd>`).join('<span class="shortcut-sep">+</span>')}
              </div>
              <div class="shortcut-label">${this._esc(it.label)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
    ).join('');

    Modal.open({
      title: '⌨️ 키보드 단축키',
      width: 540,
      body: `
        <div class="shortcut-help">
          ${body}
          <div class="shortcut-help-foot">
            💡 입력 필드 안에서는 단축키가 동작하지 않습니다. ESC 로 포커스 해제 후 사용하세요.
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="sc-onboarding-open" title="5단계 시작 가이드 다시 보기">🎓 온보딩 가이드</button>
        <button class="btn btn-primary" id="sc-help-ok">확인</button>
      `,
      bind: {
        '#sc-help-ok': () => Modal.close(),
        '#sc-onboarding-open': () => {
          Modal.close();
          if (typeof Onboarding !== 'undefined') Onboarding.reset();
        },
      },
    });
  },

  // 유틸
  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};

// 페이지 로드 직후 즉시 활성화
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Shortcuts.init());
  } else {
    Shortcuts.init();
  }
}
