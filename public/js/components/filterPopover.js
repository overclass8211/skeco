'use strict';
// =============================================================
// FilterPopover — 공용 컬럼 최적화 필터 (v6.1.0)
//
// 목록형 페이지(품질·고객사·영업딜·견적·제안·계약·A/S) UI 통일.
//   - 테이블 우상단 "필터" 버튼 → 버튼 아래 플로팅 드롭다운 패널(오버레이)
//   - 컬럼별 컨트롤(select / daterange / text) 구성형
//   - 초기화 / 적용, 바깥 클릭·Esc 닫힘, 활성 필터 개수 배지
//
// 사용:
//   el.innerHTML = FilterPopover.renderButton('q-flt');   // 우상단 버튼
//   FilterPopover.attach({
//     buttonId: 'q-flt',
//     fields: [
//       { key:'status',   label:'상태',   type:'select', options:[{value:'',label:'전체'},...] },
//       { key:'owner_id', label:'담당',   type:'select', options:[...] },
//       { key:'',         label:'접수기간', type:'daterange', fromKey:'from', toKey:'to' },
//       { key:'q',        label:'검색',   type:'text', placeholder:'제목·번호' },
//     ],
//     values: { status:'', owner_id:'' },   // 현재 적용값
//     onApply: values => { ... },           // {status, owner_id, from, to, q}
//     onReset: () => { ... },
//   });
// =============================================================
const FilterPopover = (() => {
  const esc = s =>
    String(s === null || s === undefined ? '' : s).replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );

  // 우상단 필터 버튼 (활성 개수 배지 포함)
  function renderButton(id) {
    return `<button class="flt-btn" id="${esc(id)}" type="button" title="필터">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3 4.5h14a1 1 0 0 1 .8 1.6L12 13v3.2a1 1 0 0 1-1.4.9l-2-1a1 1 0 0 1-.6-.9V13L2.2 6.1A1 1 0 0 1 3 4.5z"/></svg>
      <span>필터</span><span class="flt-badge" hidden></span>
    </button>`;
  }

  // 필드 → 컨트롤 HTML
  function fieldHtml(f, v) {
    if (f.type === 'select') {
      const opts = (f.options || [])
        .map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      return `<div class="flt-field"><label>${esc(f.label)}</label><select data-fk="${esc(f.key)}">${opts}</select></div>`;
    }
    if (f.type === 'daterange') {
      return `<div class="flt-field"><label>${esc(f.label)}</label><div class="flt-dr">
        <input type="date" data-fk="${esc(f.fromKey || 'from')}" value="${esc(v?.from || '')}">
        <span>~</span>
        <input type="date" data-fk="${esc(f.toKey || 'to')}" value="${esc(v?.to || '')}"></div></div>`;
    }
    // text
    return `<div class="flt-field"><label>${esc(f.label)}</label><input type="text" data-fk="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" value="${esc(v ?? '')}"></div>`;
  }

  function attach(opts) {
    const btn = document.getElementById(opts.buttonId);
    if (!btn) {
      console.warn('[FilterPopover] button not found:', opts.buttonId);
      return null;
    }
    const fields = opts.fields || [];
    const values = { ...(opts.values || {}) };

    // 버튼을 relative 래퍼로 감싸 패널 앵커링 (1회)
    let wrap = btn.closest('.flt-wrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'flt-wrap';
      btn.parentNode.insertBefore(wrap, btn);
      wrap.appendChild(btn);
    }
    let panel = wrap.querySelector('.flt-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'flt-panel';
      panel.hidden = true;
      wrap.appendChild(panel);
    }

    const activeCount = () =>
      fields.reduce((n, f) => {
        if (f.type === 'daterange')
          return n + (values[f.fromKey || 'from'] || values[f.toKey || 'to'] ? 1 : 0);
        if (f.type === 'select') {
          const neutral = (f.options && f.options[0] && f.options[0].value) || '';
          return n + (values[f.key] && String(values[f.key]) !== String(neutral) ? 1 : 0);
        }
        return n + (values[f.key] ? 1 : 0);
      }, 0);
    const refreshBadge = () => {
      const b = btn.querySelector('.flt-badge');
      const c = activeCount();
      if (!b) return;
      if (c > 0) {
        b.textContent = String(c);
        b.hidden = false;
        btn.classList.add('on');
      } else {
        b.hidden = true;
        btn.classList.remove('on');
      }
    };

    const renderPanel = () => {
      panel.innerHTML = `
        <div class="flt-grid">${fields.map(f => fieldHtml(f, f.type === 'daterange' ? { from: values[f.fromKey || 'from'], to: values[f.toKey || 'to'] } : values[f.key])).join('')}</div>
        <div class="flt-actions"><button class="flt-reset" type="button">초기화</button><button class="flt-apply" type="button">적용</button></div>`;
      panel.querySelector('.flt-apply').addEventListener('click', () => {
        panel.querySelectorAll('[data-fk]').forEach(el => {
          values[el.dataset.fk] = el.value || '';
        });
        refreshBadge();
        close();
        opts.onApply && opts.onApply({ ...values });
      });
      panel.querySelector('.flt-reset').addEventListener('click', () => {
        fields.forEach(f => {
          if (f.type === 'daterange') {
            values[f.fromKey || 'from'] = '';
            values[f.toKey || 'to'] = '';
          } else values[f.key] = '';
        });
        renderPanel();
        refreshBadge();
        opts.onReset ? opts.onReset() : opts.onApply && opts.onApply({ ...values });
      });
      // Enter 적용
      panel.querySelectorAll('input[type=text]').forEach(inp =>
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') panel.querySelector('.flt-apply').click();
        })
      );
    };

    function open() {
      renderPanel();
      panel.hidden = false;
      btn.classList.add('open');
      setTimeout(() => panel.querySelector('select,input')?.focus(), 0);
    }
    function close() {
      panel.hidden = true;
      btn.classList.remove('open');
    }
    function toggle(e) {
      e && e.stopPropagation();
      if (panel.hidden) open();
      else close();
    }

    btn.addEventListener('click', toggle);
    // 바깥 클릭 / Esc — 1회 바인딩
    if (!FilterPopover._outsideBound) {
      FilterPopover._outsideBound = true;
      document.addEventListener('click', e => {
        document.querySelectorAll('.flt-panel:not([hidden])').forEach(p => {
          if (!e.target.closest('.flt-wrap')) {
            p.hidden = true;
            p.closest('.flt-wrap')?.querySelector('.flt-btn')?.classList.remove('open');
          }
        });
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
          document.querySelectorAll('.flt-panel:not([hidden])').forEach(p => {
            p.hidden = true;
            p.closest('.flt-wrap')?.querySelector('.flt-btn')?.classList.remove('open');
          });
      });
    }

    refreshBadge();
    // 외부에서 값/옵션 갱신 시 사용
    return {
      setValues(v) {
        Object.assign(values, v || {});
        refreshBadge();
      },
      getValues: () => ({ ...values }),
      close,
    };
  }

  return { renderButton, attach };
})();
