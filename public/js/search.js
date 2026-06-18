// =============================================================
// Global Search — Cmd+K / Ctrl+K
//   - 모든 페이지 어디서나 단축키로 검색 모달 호출
//   - 카테고리별 결과 그룹 (리드/고객/프로젝트/회의록/활동)
//   - 키보드: ↑↓ 이동, Enter 이동, Esc 닫기
//   - 250ms 디바운스 + 검색어 하이라이트 + 최근 검색 5개
// =============================================================
'use strict';

const SearchModal = {
  // ─── 상태 ──────────────────────────────────────────────
  open: false,
  query: '',
  results: null, // { query, total, results: {leads, customers, ...} }
  flatList: [], // 키보드 네비게이션용 평면 목록
  focusIndex: -1,
  loading: false,
  searchTimer: null,
  abortCtrl: null,
  recentKey: 'oci_search_recent',
  recentMax: 5,

  // ─── 카테고리 메타 ─────────────────────────────────────
  CAT_META: {
    leads: { icon: '📋', label: '영업 리드', order: 1 },
    customers: { icon: '🏢', label: '고객사', order: 2 },
    projects: { icon: '🏗️', label: '프로젝트', order: 3 },
    meetings: { icon: '🎙️', label: '회의록', order: 4 },
    activities: { icon: '⚡', label: '활동', order: 5 },
  },

  // ─── 초기화 (단축키 + DOM 등록) ─────────────────────────
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._injectHTML();
    this._bindKeyboard();
  },

  _injectHTML() {
    // 모달 컨테이너만 한 번 등록 — 내용은 매번 갱신
    if (document.getElementById('global-search-modal')) return;
    const div = document.createElement('div');
    div.id = 'global-search-modal';
    div.className = 'gsearch-overlay';
    div.style.display = 'none';
    div.innerHTML = `
      <div class="gsearch-modal" role="dialog" aria-label="전체 검색">
        <div class="gsearch-input-wrap">
          <span class="gsearch-icon">🔍</span>
          <input id="gsearch-input" type="text"
                 placeholder="리드, 고객, 회의록, 프로젝트, 활동 검색..."
                 autocomplete="off" spellcheck="false">
          <span class="gsearch-shortcut" id="gsearch-shortcut-hint"></span>
        </div>
        <div class="gsearch-body" id="gsearch-body">
          <div class="gsearch-empty">검색어를 입력하세요</div>
        </div>
        <div class="gsearch-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>Enter</kbd> 열기</span>
          <span><kbd>Esc</kbd> 닫기</span>
        </div>
      </div>
    `;
    document.body.appendChild(div);

    // 오버레이 클릭 시 닫기 (모달 내부 클릭은 차단)
    div.addEventListener('click', e => {
      if (e.target === div) this.close();
    });

    // 단축키 힌트 (Mac/Win 자동 감지)
    const hint = document.getElementById('gsearch-shortcut-hint');
    if (hint) hint.textContent = this._isMac() ? '⌘K' : 'Ctrl+K';

    // 입력 핸들러
    const input = document.getElementById('gsearch-input');
    input.addEventListener('input', e => this._onInput(e.target.value));
    input.addEventListener('keydown', e => this._onInputKey(e));
  },

  _bindKeyboard() {
    document.addEventListener('keydown', e => {
      // Cmd+K (Mac) / Ctrl+K (Win) — 어디서든 검색 열기
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // 기능 토글 OFF 시 단축키 무시
        if (typeof Features !== 'undefined' && !Features.isEnabled('crm.search')) return;
        // 입력 필드에서도 작동 (브라우저 기본 동작 차단)
        e.preventDefault();
        this.toggle();
      }
      // Esc — 검색 모달 닫기
      else if (e.key === 'Escape' && this.open) {
        e.preventDefault();
        this.close();
      }
    });
  },

  _isMac() {
    return /Mac|iPhone|iPad/i.test(navigator.platform);
  },

  // ─── Public API ────────────────────────────────────────
  toggle() {
    this.open ? this.close() : this.show();
  },

  show(initialQuery = '') {
    this.init();
    const modal = document.getElementById('global-search-modal');
    const input = document.getElementById('gsearch-input');
    if (!modal || !input) return;
    modal.style.display = 'flex';
    this.open = true;
    input.value = initialQuery;
    this.query = initialQuery;
    if (initialQuery) {
      this._performSearch(initialQuery);
    } else {
      this._renderInitial();
    }
    // 다음 프레임에 포커스 (display:flex 적용 후)
    requestAnimationFrame(() => input.focus());
  },

  close() {
    const modal = document.getElementById('global-search-modal');
    if (!modal) return;
    modal.style.display = 'none';
    this.open = false;
    this.query = '';
    this.results = null;
    this.flatList = [];
    this.focusIndex = -1;
    if (this.abortCtrl) {
      this.abortCtrl.abort();
      this.abortCtrl = null;
    }
    clearTimeout(this.searchTimer);
  },

  // ─── 입력 처리 ─────────────────────────────────────────
  _onInput(value) {
    const v = (value || '').trim();
    this.query = v;
    this.focusIndex = -1;
    clearTimeout(this.searchTimer);

    if (!v) {
      this._renderInitial();
      return;
    }
    if (v.length < 2) {
      this._renderHint('2글자 이상 입력하세요');
      return;
    }
    // 250ms 디바운스
    this.searchTimer = setTimeout(() => this._performSearch(v), 250);
  },

  _onInputKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveFocus(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._activateFocused();
    }
  },

  _moveFocus(delta) {
    if (!this.flatList.length) return;
    let next = this.focusIndex + delta;
    if (next < 0) next = this.flatList.length - 1;
    if (next >= this.flatList.length) next = 0;
    this.focusIndex = next;
    this._refreshFocusState();
  },

  _refreshFocusState() {
    document.querySelectorAll('.gsearch-item').forEach((el, i) => {
      el.classList.toggle('is-focused', i === this.focusIndex);
      if (i === this.focusIndex) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  },

  _activateFocused() {
    if (this.focusIndex < 0 || !this.flatList[this.focusIndex]) {
      // 포커스 없으면 첫 결과 활성화
      if (this.flatList.length > 0) this._navigateTo(this.flatList[0]);
      return;
    }
    this._navigateTo(this.flatList[this.focusIndex]);
  },

  _navigateTo(item) {
    if (!item) return;
    this._addRecent(this.query);
    this.close();

    // App.openDetail 이 사용 가능하면 우선 사용 — 페이지 이동 + 상세 모달 자동 처리
    if (typeof App !== 'undefined' && typeof App.openDetail === 'function') {
      App.openDetail(item.type, item.id, {
        leadId: item.meta?.leadId,
        projectId: item.meta?.projectId,
      });
      return;
    }

    // Fallback — App.openDetail 미정의 시 단순 hash 이동
    if (item.route) {
      const hashOnly = item.route.startsWith('#') ? item.route.slice(1) : item.route;
      const page = hashOnly.split('?')[0];
      if (page && typeof App !== 'undefined' && App.navigate && App.pages?.[page]) {
        App.navigate(page);
      } else {
        window.location.hash = hashOnly;
      }
    }
  },

  // ─── 검색 실행 ─────────────────────────────────────────
  async _performSearch(q) {
    this.loading = true;
    this._renderLoading();

    // 이전 요청 취소
    if (this.abortCtrl) this.abortCtrl.abort();
    this.abortCtrl = new AbortController();

    try {
      API._checkFeature('crm.search');
      const r = await API.get(`/search?q=${encodeURIComponent(q)}`);
      // 입력이 바뀌었으면 결과 무시
      if (this.query !== q) return;
      this.results = r.data;
      this._renderResults();
    } catch (e) {
      if (e.name === 'AbortError') return;
      // Graceful Degradation — 기능 비활성화 시 친절한 안내
      if (e.code === 'FEATURE_DISABLED') {
        this._renderError('🔍 검색 기능이 비활성화되어 있습니다. 관리자에게 문의하세요.');
      } else {
        this._renderError(e.message || '검색 실패');
      }
    } finally {
      this.loading = false;
    }
  },

  // ─── 렌더링 ────────────────────────────────────────────
  _renderInitial() {
    const body = document.getElementById('gsearch-body');
    if (!body) return;
    const recent = this._getRecent();
    if (!recent.length) {
      body.innerHTML = `
        <div class="gsearch-empty">
          <div style="font-size:32px;opacity:.3;margin-bottom:8px">🔍</div>
          <div>검색어를 입력하세요</div>
          <div class="gsearch-empty-hint">리드 · 고객 · 회의록 · 프로젝트 · 활동을 모두 검색합니다</div>
        </div>
      `;
      this.flatList = [];
      return;
    }
    body.innerHTML = `
      <div class="gsearch-section">
        <div class="gsearch-section-header">최근 검색</div>
        <div class="gsearch-section-body">
          ${recent
            .map(
              q => `
            <div class="gsearch-recent" data-recent="${this._esc(q)}">
              <span class="gsearch-recent-icon">🕒</span>
              <span class="gsearch-recent-text">${this._esc(q)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
    body.querySelectorAll('.gsearch-recent').forEach(el => {
      el.addEventListener('click', () => {
        const q = el.dataset.recent;
        const input = document.getElementById('gsearch-input');
        if (input) input.value = q;
        this.query = q;
        this._performSearch(q);
      });
    });
    this.flatList = [];
  },

  _renderHint(msg) {
    const body = document.getElementById('gsearch-body');
    if (!body) return;
    body.innerHTML = `<div class="gsearch-empty">${this._esc(msg)}</div>`;
    this.flatList = [];
  },

  _renderLoading() {
    const body = document.getElementById('gsearch-body');
    if (!body) return;
    body.innerHTML = `<div class="gsearch-empty"><div class="gsearch-spinner"></div>검색 중...</div>`;
  },

  _renderError(msg) {
    const body = document.getElementById('gsearch-body');
    if (!body) return;
    body.innerHTML = `<div class="gsearch-empty" style="color:var(--oci-red)">⚠ ${this._esc(msg)}</div>`;
  },

  _renderResults() {
    const body = document.getElementById('gsearch-body');
    if (!body || !this.results) return;

    const { query, total, results } = this.results;

    if (total === 0) {
      body.innerHTML = `
        <div class="gsearch-empty">
          <div style="font-size:32px;opacity:.3;margin-bottom:8px">🤷</div>
          <div>"${this._esc(query)}" 에 대한 결과 없음</div>
        </div>
      `;
      this.flatList = [];
      return;
    }

    // 카테고리 순서대로 정렬
    const orderedTypes = Object.keys(this.CAT_META)
      .filter(t => results[t]?.length > 0)
      .sort((a, b) => this.CAT_META[a].order - this.CAT_META[b].order);

    const sections = [];
    const flat = [];
    for (const type of orderedTypes) {
      const items = results[type];
      const meta = this.CAT_META[type];
      sections.push(`
        <div class="gsearch-section">
          <div class="gsearch-section-header">
            <span>${meta.icon} ${meta.label}</span>
            <span class="gsearch-section-count">${items.length}</span>
          </div>
          <div class="gsearch-section-body">
            ${items
              .map(item => {
                const idx = flat.length;
                flat.push(item);
                return this._renderItem(item, idx, query);
              })
              .join('')}
          </div>
        </div>
      `);
    }

    body.innerHTML = `
      <div class="gsearch-meta-row">
        <span>${total}개 결과</span>
      </div>
      ${sections.join('')}
    `;

    this.flatList = flat;
    this.focusIndex = flat.length > 0 ? 0 : -1;
    this._refreshFocusState();

    // 항목 클릭 핸들러
    body.querySelectorAll('.gsearch-item').forEach((el, i) => {
      el.addEventListener('click', () => this._navigateTo(flat[i]));
      el.addEventListener('mouseenter', () => {
        this.focusIndex = i;
        this._refreshFocusState();
      });
    });
  },

  _renderItem(item, idx, query) {
    const title = this._highlight(item.title || '(제목 없음)', query);
    const subtitle = item.subtitle ? this._highlight(item.subtitle, query) : '';
    const snippet = item.snippet ? this._highlight(item.snippet, query) : '';
    const meta = this._renderMeta(item);
    return `
      <div class="gsearch-item" data-index="${idx}" data-type="${this._esc(item.type)}">
        <div class="gsearch-item-main">
          <div class="gsearch-item-title">${title}</div>
          ${subtitle ? `<div class="gsearch-item-subtitle">${subtitle}</div>` : ''}
          ${snippet ? `<div class="gsearch-item-snippet">${snippet}</div>` : ''}
        </div>
        ${meta ? `<div class="gsearch-item-meta">${meta}</div>` : ''}
      </div>
    `;
  },

  _renderMeta(item) {
    if (!item.meta) return '';
    const m = item.meta;
    const chips = [];
    if (item.type === 'leads') {
      if (m.stage)
        chips.push(`<span class="gsearch-chip stage-${m.stage}">${this._esc(m.stage)}</span>`);
      if (m.business) chips.push(`<span class="gsearch-chip">${this._esc(m.business)}</span>`);
    } else if (item.type === 'customers') {
      if (m.region) chips.push(`<span class="gsearch-chip">${this._esc(m.region)}</span>`);
      if (m.country) chips.push(`<span class="gsearch-chip">${this._esc(m.country)}</span>`);
    } else if (item.type === 'projects') {
      if (m.status)
        chips.push(`<span class="gsearch-chip status-${m.status}">${this._esc(m.status)}</span>`);
    } else if (item.type === 'meetings') {
      if (m.date) chips.push(`<span class="gsearch-chip">${this._esc(m.date)}</span>`);
    } else if (item.type === 'activities') {
      if (m.type) chips.push(`<span class="gsearch-chip">${this._esc(m.type)}</span>`);
    }
    return chips.join('');
  },

  // ─── 유틸 ──────────────────────────────────────────────
  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 검색어 하이라이트 — 이스케이프 후 <mark> 로 감쌈 (XSS 안전)
  _highlight(text, query) {
    const escText = this._esc(text);
    if (!query) return escText;
    const escQuery = query
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (!escQuery) return escText;
    try {
      const re = new RegExp(`(${escQuery})`, 'gi');
      return escText.replace(re, '<mark>$1</mark>');
    } catch {
      return escText;
    }
  },

  // ─── 최근 검색 (localStorage) ──────────────────────────
  _getRecent() {
    try {
      const raw = localStorage.getItem(this.recentKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, this.recentMax) : [];
    } catch {
      return [];
    }
  },
  _addRecent(q) {
    if (!q) return;
    try {
      const list = this._getRecent().filter(x => x !== q);
      list.unshift(q);
      localStorage.setItem(this.recentKey, JSON.stringify(list.slice(0, this.recentMax)));
    } catch {
      /* ignore */
    }
  },
};

// 페이지 로드 직후 단축키 즉시 활성화
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SearchModal.init());
  } else {
    SearchModal.init();
  }
}
