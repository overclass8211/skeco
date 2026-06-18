'use strict';
// =============================================================
// LinkedProposals — 연결된 제안 목록 공통 컴포넌트 (v6.0.0)
//
// 사용:
//   LinkedProposals.render('#my-container', 'customer', 42);
//   - parentType: 'customer'  (현재는 고객사만 지원, 확장 가능)
//   - parentId: 부모 엔티티 ID
// =============================================================
const LinkedProposals = (() => {
  // ── 상태 메타 (proposals.js 와 동기화) ─────────────
  const STATUS_LABELS = {
    draft: '초안',
    review: '검토',
    submitted: '제출',
    accepted: '수락',
    rejected: '거절',
    expired: '만료',
  };
  const STATUS_COLORS = {
    draft: '#6b7280',
    review: '#3b82f6',
    submitted: '#0891b2',
    accepted: '#16a34a',
    rejected: '#dc2626',
    expired: '#9ca3af',
  };

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

  function _statusBadge(status) {
    const label = STATUS_LABELS[status] || status || '-';
    const color = STATUS_COLORS[status] || '#6b7280';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${color};color:#fff">${esc(label)}</span>`;
  }

  function _fetchFn(parentType, parentId) {
    if (parentType === 'customer') return API.customers.proposals(parentId);
    throw new Error(`unsupported parentType: ${parentType}`);
  }

  function _renderTable(proposals) {
    if (!proposals.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        연결된 제안 없음
      </div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:120px">제안번호</th>
        <th>제안명</th>
        <th style="width:110px">제안일</th>
        <th style="width:110px">마감일</th>
        <th style="width:120px;text-align:right">예상금액</th>
        <th style="width:80px">상태</th>
      </tr></thead>
      <tbody>
        ${proposals
          .map(
            p => `<tr class="lp-row" data-id="${p.id}" style="cursor:pointer">
          <td style="font-family:monospace;font-size:11px">${esc(p.proposal_no)}</td>
          <td>${esc(p.proposal_title)}</td>
          <td style="font-size:11px">${_fmtDate(p.proposal_date)}</td>
          <td style="font-size:11px">${_fmtDate(p.due_date)}</td>
          <td style="text-align:right;font-family:monospace">${p.expected_amount ? _fmtKRW(p.expected_amount) + ' ' + (p.currency || 'KRW') : '-'}</td>
          <td>${_statusBadge(p.status)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  function _bindRowClicks(container) {
    container.querySelectorAll('.lp-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.id, 10);
        if (!id) return;
        // v6.0.0: 현재 열린 고객사 모달 먼저 닫기 → 모달 중첩 방지
        if (typeof Modal !== 'undefined' && Modal.close) Modal.close();
        if (typeof window.navigate === 'function') {
          window.navigate('proposals');
          // 페이지 마운트 완료 (pr-list-wrap) 대기 + 재시도 (race condition 방지)
          let tries = 30;
          const tryOpen = () => {
            const ready = document.getElementById('pr-list-wrap');
            if (ready && typeof ProposalsPage !== 'undefined' && ProposalsPage._openModal) {
              ProposalsPage._openModal(id);
              return;
            }
            if (--tries > 0) setTimeout(tryOpen, 100);
            else console.warn('[LinkedProposals] _openModal 호출 timeout');
          };
          setTimeout(tryOpen, 100);
        } else {
          window.location.hash = '#proposals';
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
      console.warn('[LinkedProposals] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }

    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">⏳ 연결된 제안 조회 중...</div>`;

    try {
      const res = await _fetchFn(parentType, parentId);
      const proposals = res?.data || [];
      const count = proposals.length;

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">📄 연결된 제안 ${count > 0 ? `(${count}건)` : ''}</strong>
          ${count > 0 ? '<span style="font-size:10px;color:var(--text-3)">행 클릭 시 제안 페이지로 이동</span>' : ''}
        </div>
        ${_renderTable(proposals)}
      `;
      _bindRowClicks(container);

      return { count };
    } catch (err) {
      console.error('[LinkedProposals] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        연결된 제안 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
