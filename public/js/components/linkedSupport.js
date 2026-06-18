'use strict';
// =============================================================
// LinkedSupport — 연결된 고객지원(A/S) 티켓 목록 공통 컴포넌트  [P1-E]
//
// 사용:
//   LinkedSupport.render('#my-container', 'customer', 42);
//   - parentType: 'customer' | 'lead'
//   - parentId: 부모 엔티티 ID
//   목록 응답(TICKET_SELECT)이 status_label/color·priority_label/color 를 JOIN 으로 포함 → 별도 설정 조회 불필요
// =============================================================
const LinkedSupport = (() => {
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  function _badge(label, color) {
    if (!label) return '-';
    return `<span class="badge badge-${esc(color || 'gray')}" style="font-size:10px">${esc(label)}</span>`;
  }

  function _fetchFn(parentType, parentId) {
    if (parentType === 'customer') return API.support.list({ customer_id: parentId, limit: 50 });
    if (parentType === 'lead') return API.support.list({ lead_id: parentId, limit: 50 });
    throw new Error(`unsupported parentType: ${parentType}`);
  }

  function _renderTable(rows) {
    if (!rows.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        연결된 고객지원(A/S) 건 없음
      </div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:118px">티켓번호</th>
        <th>제목</th>
        <th style="width:74px">유형</th>
        <th style="width:74px">우선순위</th>
        <th style="width:74px">상태</th>
        <th style="width:92px">접수일</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            t => `<tr class="ls-row" data-id="${t.id}" style="cursor:pointer">
          <td style="font-family:monospace;font-size:11px">${esc(t.ticket_no)}</td>
          <td>${esc(t.title)}</td>
          <td style="font-size:11px">${esc(t.type_label || '-')}</td>
          <td>${_badge(t.priority_label, t.priority_color)}</td>
          <td>${_badge(t.status_label, t.status_color)}</td>
          <td style="font-size:11px">${_fmtDate(t.created_at)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  function _bindRowClicks(container) {
    container.querySelectorAll('.ls-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.id, 10);
        if (!id) return;
        // 열린 고객사 모달 먼저 닫기 → 모달 중첩 방지
        if (typeof Modal !== 'undefined' && Modal.close) Modal.close();
        if (typeof window.navigate === 'function') {
          window.navigate('support');
          // navigate 후 페이지 render(설정+목록 비동기) 완료 대기 → 상세 모달 열기
          let tries = 30;
          const tryOpen = () => {
            const ready = document.getElementById('sup-list');
            if (
              ready &&
              typeof SupportPage !== 'undefined' &&
              SupportPage.openDetail &&
              SupportPage._settings
            ) {
              SupportPage.openDetail(id);
              return;
            }
            if (--tries > 0) setTimeout(tryOpen, 100);
            else console.warn('[LinkedSupport] openDetail 호출 timeout');
          };
          setTimeout(tryOpen, 100);
        } else {
          window.location.hash = '#support';
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
      console.warn('[LinkedSupport] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }

    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">⏳ 연결된 고객지원 조회 중...</div>`;

    try {
      const res = await _fetchFn(parentType, parentId);
      const rows = res?.data || [];
      const count = rows.length;

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">🎫 연결된 고객지원 ${count > 0 ? `(${count}건)` : ''}</strong>
          ${count > 0 ? '<span style="font-size:10px;color:var(--text-3)">행 클릭 시 고객지원 페이지로 이동</span>' : ''}
        </div>
        ${_renderTable(rows)}
      `;
      _bindRowClicks(container);

      return { count };
    } catch (err) {
      console.error('[LinkedSupport] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        연결된 고객지원 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
