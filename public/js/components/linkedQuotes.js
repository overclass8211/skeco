'use strict';
// =============================================================
// LinkedQuotes — 연결된 견적 목록 공통 컴포넌트 (v6.0.0)
//
// 사용:
//   LinkedQuotes.render('#my-container', 'customer', 42);
//   - parentType: 'customer'  (현재는 고객사만 지원, 확장 가능)
//   - parentId: 부모 엔티티 ID
// =============================================================
const LinkedQuotes = (() => {
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _fmtKRW(n) {
    const v = Number(n);
    if (!v) return '-';
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }

  function _fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  function _fetchFn(parentType, parentId) {
    if (parentType === 'customer') return API.customers.quotes(parentId);
    throw new Error(`unsupported parentType: ${parentType}`);
  }

  function _renderTable(quotes) {
    if (!quotes.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        연결된 견적 없음
      </div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:120px">견적번호</th>
        <th>견적명</th>
        <th style="width:80px">리비전</th>
        <th style="width:110px">견적일</th>
        <th style="width:120px;text-align:right">합계</th>
      </tr></thead>
      <tbody>
        ${quotes
          .map(
            q => `<tr class="lq-row" data-id="${q.id}" style="cursor:pointer">
          <td style="font-family:monospace;font-size:11px">${esc(q.quote_no)}</td>
          <td>${esc(q.name)}</td>
          <td style="text-align:center;font-size:11px">
            ${q.revision_no > 1 ? `<span class="badge badge-blue" style="font-size:10px">Rev ${q.revision_no}</span>` : '-'}
          </td>
          <td style="font-size:11px">${_fmtDate(q.quote_date)}</td>
          <td style="text-align:right;font-family:monospace">${q.total_amount ? _fmtKRW(q.total_amount) + ' ' + (q.currency || 'KRW') : '-'}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  function _bindRowClicks(container) {
    container.querySelectorAll('.lq-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.id, 10);
        if (!id) return;
        // v6.0.0: 현재 열린 고객사 모달 먼저 닫기 → 모달 중첩 방지
        if (typeof Modal !== 'undefined' && Modal.close) Modal.close();
        if (typeof window.navigate === 'function') {
          window.navigate('quotes');
          // 페이지 마운트 완료 신호 (qt-list-wrap DOM 존재) 대기 + 재시도
          // navigate 후 페이지 render + _reload 가 비동기라 setTimeout 단일 호출은
          // race condition 발생 → 100ms 간격으로 최대 30회 (3s) 재시도
          let tries = 30;
          const tryOpen = () => {
            const ready = document.getElementById('qt-list-wrap');
            if (ready && typeof QuotesPage !== 'undefined' && QuotesPage._openModal) {
              QuotesPage._openModal(id);
              return;
            }
            if (--tries > 0) setTimeout(tryOpen, 100);
            else console.warn('[LinkedQuotes] _openModal 호출 timeout');
          };
          setTimeout(tryOpen, 100);
        } else {
          window.location.hash = '#quotes';
        }
      });
      tr.addEventListener('mouseenter', () => {
        tr.style.background = '#f9fafb';
      });
      tr.addEventListener('mouseleave', () => {
        tr.style.background = '';
      });
    });
  }

  async function render(containerSel, parentType, parentId) {
    const container =
      typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
    if (!container) {
      console.warn('[LinkedQuotes] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }

    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">⏳ 연결된 견적 조회 중...</div>`;

    try {
      const res = await _fetchFn(parentType, parentId);
      const quotes = res?.data || [];
      const count = quotes.length;

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">💰 연결된 견적 ${count > 0 ? `(${count}건)` : ''}</strong>
          ${count > 0 ? '<span style="font-size:10px;color:var(--text-3)">행 클릭 시 견적 페이지로 이동</span>' : ''}
        </div>
        ${_renderTable(quotes)}
      `;
      _bindRowClicks(container);

      return { count };
    } catch (err) {
      console.error('[LinkedQuotes] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        연결된 견적 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
