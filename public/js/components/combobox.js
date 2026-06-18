'use strict';
// =============================================================
// Combobox — 재사용 가능한 자동완성 입력 컴포넌트
//
// 🎯 목적:
//   기존 <input> 을 자동완성 가능한 Combobox 로 변환
//   캘린더 일정 모달 / 리드 모달 / 회의록 등에서 재사용
//
// 📦 사용:
//   Combobox.attach({
//     inputEl: document.getElementById('cal-customer'),
//     fetchFn: async (q) => {
//       const r = await API.customers.autocomplete(q, 10);
//       return r.data || [];
//     },
//     renderItem: (item, q) => `<div>${highlightMatch(item.name, q)}</div>`,
//     onSelect: (item) => { ... },
//     onCustomCreate: (query) => { ... },
//     minChars: 2,
//     debounceMs: 250,
//     allowCustom: true,
//     customLabel: '+ 새 고객사 "X" 등록',
//   });
//
// 🛡 사이드이펙 방지:
//   - 기존 input 의 value/name/id 등 속성 보존
//   - 자유 텍스트 입력도 여전히 가능 (선택 안 한 경우 placeholder 동작)
//   - destroy() 호출 시 모든 이벤트 리스너 + DOM 정리
// =============================================================

const Combobox = {
  /**
   * @param {Object} opts
   * @param {HTMLInputElement} opts.inputEl     - 대상 input 요소
   * @param {Function} opts.fetchFn             - 검색 함수: (q: string) => Promise<Array>
   * @param {Function} opts.renderItem          - 항목 렌더: (item, query) => HTMLString
   * @param {Function} opts.onSelect            - 선택 콜백: (item) => void
   * @param {Function} [opts.onCustomCreate]    - 신규 등록 콜백: (query) => void
   * @param {number}   [opts.minChars=2]
   * @param {number}   [opts.debounceMs=250]
   * @param {boolean}  [opts.allowCustom=true]
   * @param {string}   [opts.customLabel='+ 새 항목 등록']
   * @returns {{ destroy: Function, clear: Function }}
   */
  attach(opts) {
    const {
      inputEl,
      fetchFn,
      renderItem,
      onSelect,
      onCustomCreate,
      minChars = 2,
      debounceMs = 250,
      allowCustom = true,
      customLabel = '+ 새 항목 등록',
    } = opts;

    if (!inputEl) {
      console.warn('[Combobox] inputEl required');
      return { destroy: () => {}, clear: () => {} };
    }

    // ── 드롭다운 컨테이너 ─────────────────────────────────
    // 🚨 핵심: document.body 에 직접 append + position:fixed
    //   ↳ 모달의 .modal-body { overflow-y:auto } 클리핑 회피
    //   ↳ 어떤 부모의 transform/contain 도 영향 없음
    const dropdown = document.createElement('div');
    dropdown.className = 'combobox-dropdown';
    dropdown.style.display = 'none';
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '1200'; // modal-overlay(1000) 위
    dropdown.setAttribute('role', 'listbox');
    document.body.appendChild(dropdown);

    // input 을 감싸는 wrapper (선택 시 외부 클릭 검지용)
    const wrapper = document.createElement('div');
    wrapper.className = 'combobox-wrapper';
    inputEl.parentNode.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputEl);

    // 입력 위치를 따라 드롭다운 좌표 갱신
    function reposition() {
      const r = inputEl.getBoundingClientRect();
      dropdown.style.left = `${r.left}px`;
      dropdown.style.top = `${r.bottom + 2}px`;
      dropdown.style.width = `${r.width}px`;
    }

    // ── 상태 ──────────────────────────────────────────────
    let items = [];
    let highlightedIdx = -1;
    let debounceTimer = null;
    let currentQuery = '';
    const lastFetchAbort = null;
    let isOpen = false;

    // ── 유틸 ──────────────────────────────────────────────
    function highlightMatch(text, q) {
      if (!q || !text) return _esc(text || '');
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return _esc(text).replace(re, '<strong class="combobox-match">$1</strong>');
    }

    function _esc(s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ── 드롭다운 렌더링 ────────────────────────────────────
    function render() {
      if (items.length === 0 && !allowCustom) {
        close();
        return;
      }
      const itemsHtml = items
        .map(
          (item, idx) => `
          <div class="combobox-item ${idx === highlightedIdx ? 'is-highlighted' : ''}"
               role="option" data-idx="${idx}"
               aria-selected="${idx === highlightedIdx}">
            ${renderItem(item, currentQuery, { highlightMatch })}
          </div>
        `
        )
        .join('');

      const customHtml =
        allowCustom && currentQuery && onCustomCreate
          ? `
          <div class="combobox-custom-item ${highlightedIdx === items.length ? 'is-highlighted' : ''}"
               role="option" data-idx="${items.length}">
            ${customLabel.replace('"X"', `"<strong>${_esc(currentQuery)}</strong>"`)}
          </div>
        `
          : '';

      const emptyHtml =
        items.length === 0 && allowCustom
          ? `<div class="combobox-empty">🔍 "${_esc(currentQuery)}" 매칭 없음</div>`
          : '';

      dropdown.innerHTML = emptyHtml + itemsHtml + customHtml;
      dropdown.style.display = 'block';
      reposition(); // 표시 직전 좌표 갱신 (모달 스크롤 대응)
      isOpen = true;
    }

    function close() {
      dropdown.style.display = 'none';
      isOpen = false;
      highlightedIdx = -1;
    }

    // ── 검색 ──────────────────────────────────────────────
    async function search(q) {
      currentQuery = q;
      if (q.length < minChars) {
        close();
        return;
      }
      // 이전 요청 취소
      if (lastFetchAbort) {
        try {
          lastFetchAbort.abort?.();
        } catch (_) {}
      }
      try {
        const result = await fetchFn(q);
        if (currentQuery !== q) return; // 입력 바뀜 → 무시
        items = Array.isArray(result) ? result : [];
        highlightedIdx = items.length > 0 ? 0 : allowCustom ? 0 : -1;
        render();
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('[Combobox] fetch failed:', err);
          items = [];
          render();
        }
      }
    }

    // ── 이벤트: input ─────────────────────────────────────
    function onInput() {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(q), debounceMs);
    }

    // ── 이벤트: 키보드 ────────────────────────────────────
    function onKeyDown(e) {
      const totalItems = items.length + (allowCustom && currentQuery && onCustomCreate ? 1 : 0);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen && inputEl.value.trim().length >= minChars) {
          search(inputEl.value.trim());
          return;
        }
        highlightedIdx = Math.min(totalItems - 1, highlightedIdx + 1);
        render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIdx = Math.max(0, highlightedIdx - 1);
        render();
      } else if (e.key === 'Enter') {
        if (isOpen && highlightedIdx >= 0) {
          e.preventDefault();
          selectByIdx(highlightedIdx);
        }
      } else if (e.key === 'Escape') {
        // 드롭다운이 열려 있으면 ESC 로 드롭다운만 닫고 상위(모달)로 전파 차단.
        // 닫혀 있으면 전파를 허용해 상위 모달의 ESC 닫기와 자연스럽게 연결.
        if (isOpen) {
          e.stopPropagation();
          close();
        }
      } else if (e.key === 'Tab') {
        if (isOpen && highlightedIdx >= 0) {
          selectByIdx(highlightedIdx);
        }
      }
    }

    // ── 선택 처리 ─────────────────────────────────────────
    function selectByIdx(idx) {
      if (idx < items.length) {
        // 기존 항목 선택
        const item = items[idx];
        inputEl.value = item.name || item.label || '';
        close();
        onSelect && onSelect(item);
      } else if (allowCustom && onCustomCreate) {
        // 신규 등록
        const q = currentQuery;
        close();
        onCustomCreate(q);
      }
    }

    // ── 이벤트: 드롭다운 클릭 ─────────────────────────────
    function onDropdownClick(e) {
      const itemEl = e.target.closest('[data-idx]');
      if (!itemEl) return;
      const idx = parseInt(itemEl.dataset.idx, 10);
      selectByIdx(idx);
    }

    function onDropdownMouseover(e) {
      const itemEl = e.target.closest('[data-idx]');
      if (!itemEl) return;
      highlightedIdx = parseInt(itemEl.dataset.idx, 10);
      // 강조 클래스만 갱신 (전체 re-render 회피 위해 직접 조작)
      dropdown.querySelectorAll('[data-idx]').forEach(el => {
        el.classList.toggle('is-highlighted', parseInt(el.dataset.idx) === highlightedIdx);
      });
    }

    // ── 외부 클릭 닫기 ────────────────────────────────────
    // 드롭다운은 body 직속이라 wrapper 밖이지만, 드롭다운 내부 클릭은 제외
    function onDocClick(e) {
      if (wrapper.contains(e.target)) return;
      if (dropdown.contains(e.target)) return;
      close();
    }

    // ── 스크롤/리사이즈 시 좌표 갱신 ──────────────────────
    // 모달 내부 스크롤 대응 위해 capture phase 로 모든 스크롤 이벤트 수신
    function onWindowChange() {
      if (isOpen) reposition();
    }

    // ── focus 시 재오픈 ──────────────────────────────────
    // 🐛 fix: minChars:0 일 때 클릭만으로 dropdown 열리도록 강제 search
    //   (기존: items.length>0 일 때만 render → 첫 클릭 시 영원히 안 보임)
    function onFocus() {
      const q = inputEl.value.trim();
      if (q.length < minChars) return;
      if (items.length > 0) {
        render();
      } else if (minChars === 0) {
        // 첫 focus + 아직 데이터 없음 + minChars 0 → 강제로 search 트리거
        search('');
      }
    }

    // ── 이벤트 바인딩 ─────────────────────────────────────
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    inputEl.addEventListener('focus', onFocus);
    dropdown.addEventListener('click', onDropdownClick);
    dropdown.addEventListener('mouseover', onDropdownMouseover);
    document.addEventListener('click', onDocClick);
    // capture=true → 자식 스크롤(모달 내부 등) 도 감지
    window.addEventListener('scroll', onWindowChange, true);
    window.addEventListener('resize', onWindowChange);

    // ARIA
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-autocomplete', 'list');
    inputEl.setAttribute('aria-expanded', 'false');

    // ── 정리 함수 ─────────────────────────────────────────
    function destroy() {
      clearTimeout(debounceTimer);
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('keydown', onKeyDown);
      inputEl.removeEventListener('focus', onFocus);
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('scroll', onWindowChange, true);
      window.removeEventListener('resize', onWindowChange);
      // input 을 wrapper 밖으로 이동 + wrapper 제거
      if (wrapper.parentNode) {
        wrapper.parentNode.insertBefore(inputEl, wrapper);
        wrapper.remove();
      }
      // body 직속 dropdown 제거
      if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    }

    function clear() {
      inputEl.value = '';
      items = [];
      highlightedIdx = -1;
      currentQuery = '';
      close();
    }

    return { destroy, clear };
  },
};

window.Combobox = Combobox;
