'use strict';
// =============================================================
// LinkedPayments — 연결된 수금(수금일정) 목록 공통 컴포넌트
//
// 사용:
//   LinkedPayments.render('#my-container', 'customer', 42);
//   - parentType: 'customer'
//   - parentId: 고객사 ID
// (LinkedQuotes 패턴 미러링 — 고객사 모달 [💳 수금] 탭용)
// =============================================================
const LinkedPayments = (() => {
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

  // 상태 배지 색 (raw 값 그대로 표시 — 설정형이라 매핑 강요 안 함)
  function _statusBadge(status) {
    if (!status) return '-';
    const s = String(status);
    const done = /완료|paid|수금|입금/i.test(s);
    const over = /지연|연체|overdue/i.test(s);
    const cls = done ? 'badge-green' : over ? 'badge-red' : 'badge-gray';
    return `<span class="badge ${cls}" style="font-size:10px">${esc(s)}</span>`;
  }

  function _fetchFn(parentType, parentId) {
    if (parentType === 'customer') return API.customers.payments(parentId);
    throw new Error(`unsupported parentType: ${parentType}`);
  }

  function _renderTable(rows) {
    if (!rows.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        연결된 수금일정 없음
      </div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th>계약 / 단계</th>
        <th style="width:130px;text-align:right">예정금액</th>
        <th style="width:110px">예정일</th>
        <th style="width:90px;text-align:center">상태</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(r => {
            const amt = r.scheduled_amount || r.supply_amount || 0;
            const sub = [r.contract_name, r.stage_name].filter(Boolean).join(' · ');
            return `<tr class="lpay-row" data-id="${r.id}" style="cursor:pointer">
          <td>${esc(sub || '-')}</td>
          <td style="text-align:right;font-family:monospace">${amt ? _fmtKRW(amt) + ' ' + (r.currency || 'KRW') : '-'}</td>
          <td style="font-size:11px">${_fmtDate(r.due_date)}</td>
          <td style="text-align:center">${_statusBadge(r.status)}</td>
        </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
  }

  function _bindRowClicks(container) {
    container.querySelectorAll('.lpay-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.id, 10);
        if (!id) return;
        // 현재 열린 고객사 모달 먼저 닫기 → 모달 중첩 방지
        if (typeof Modal !== 'undefined' && Modal.close) Modal.close();
        if (typeof window.navigate === 'function') {
          window.navigate('payments');
          // navigate 후 페이지 render 비동기 → 100ms 간격 최대 30회(3s) 재시도
          let tries = 30;
          const tryOpen = () => {
            const ready = document.getElementById('pay-tab-content');
            if (ready && typeof PaymentsPage !== 'undefined' && PaymentsPage._openScheduleDetail) {
              PaymentsPage._openScheduleDetail(id);
              return;
            }
            if (--tries > 0) setTimeout(tryOpen, 100);
            else console.warn('[LinkedPayments] _openScheduleDetail 호출 timeout');
          };
          setTimeout(tryOpen, 100);
        } else {
          window.location.hash = '#payments';
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
      console.warn('[LinkedPayments] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }

    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">⏳ 연결된 수금일정 조회 중...</div>`;

    try {
      const res = await _fetchFn(parentType, parentId);
      const rows = res?.data || [];
      const count = rows.length;

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">💳 연결된 수금일정 ${count > 0 ? `(${count}건)` : ''}</strong>
          ${count > 0 ? '<span style="font-size:10px;color:var(--text-3)">행 클릭 시 수금관리로 이동</span>' : ''}
        </div>
        ${_renderTable(rows)}
      `;
      _bindRowClicks(container);

      return { count };
    } catch (err) {
      console.error('[LinkedPayments] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        연결된 수금일정 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
