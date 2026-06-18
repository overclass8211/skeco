'use strict';
// =============================================================
// LinkedContracts — 연결된 계약 목록 공통 컴포넌트 (v6.0.0 Step 2)
//
// 🎯 목적:
//   고객사/리드/제안/견적 상세 모달에서 "🔗 연결된 계약" 섹션을
//   동일한 UX 로 표시하는 재사용 가능한 컴포넌트.
//
// 📦 사용:
//   LinkedContracts.render('#my-container', 'customer', 42);
//   - parentType: 'customer' | 'lead' | 'proposal' | 'quote'
//   - parentId: 부모 엔티티의 ID (number)
//
// 🔒 안전:
//   - 컨테이너 없으면 silently skip
//   - API 실패 시 친절한 에러 메시지 (모달 닫지 않음)
//   - 빈 결과 시 "연결된 계약 없음" 안내
//   - XSS escape 처리 (계약명/고객명에 < > 포함 가능)
// =============================================================
const LinkedContracts = (() => {
  // ── 상태 메타 (contracts.js 와 동기화 — 4단계) ─────────────
  const STATUS_LABELS = {
    draft: '초안',
    review: '검토',
    approved: '승인',
    completed: '계약완료',
  };
  const STATUS_COLORS = {
    draft: '#6b7280',
    review: '#3b82f6',
    approved: '#16a34a',
    completed: '#0891b2',
  };

  const TYPE_LABELS = {
    NDA: 'NDA',
    MSA: 'MSA',
    SLA: 'SLA',
    SOW: 'SOW',
    service: '용역',
    purchase: '구매',
    license: '라이선스',
    employment: '고용',
    etc: '기타',
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

  // parentType → API 메서드 매핑
  function _fetchFn(parentType, parentId) {
    if (parentType === 'customer') return API.customers.contracts(parentId);
    if (parentType === 'lead') return API.leads.contracts(parentId);
    if (parentType === 'proposal') return API.proposals.contracts(parentId);
    if (parentType === 'quote') return API.quotes.contracts(parentId);
    throw new Error(`unsupported parentType: ${parentType}`);
  }

  function _renderTable(contracts) {
    if (!contracts.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        연결된 계약 없음
      </div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:120px">계약번호</th>
        <th style="width:70px">유형</th>
        <th>계약명</th>
        <th style="width:100px">고객사</th>
        <th style="width:100px;text-align:right">금액</th>
        <th style="width:100px">종료일</th>
        <th style="width:80px">상태</th>
      </tr></thead>
      <tbody>
        ${contracts
          .map(
            c => `<tr class="lc-row" data-id="${c.id}" style="cursor:pointer">
          <td style="font-family:monospace;font-size:11px">${esc(c.contract_no)}</td>
          <td><span class="badge badge-gray" style="font-size:10px">${esc(TYPE_LABELS[c.contract_type] || c.contract_type || '-')}</span></td>
          <td>${esc(c.title)}</td>
          <td style="font-size:11px">${esc(c.customer_name || '-')}</td>
          <td style="text-align:right;font-family:monospace">${c.contract_amount ? _fmtKRW(c.contract_amount) + ' ' + (c.currency || 'KRW') : '-'}</td>
          <td style="font-size:11px">${_fmtDate(c.end_date)}</td>
          <td>${_statusBadge(c.status)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  function _bindRowClicks(container) {
    container.querySelectorAll('.lc-row').forEach(tr => {
      tr.addEventListener('click', () => {
        // 계약 페이지로 이동 — 단순화: hash 라우팅 사용
        const contractId = parseInt(tr.dataset.id, 10);
        if (!contractId) return;
        // v6.0.0: 현재 열린 고객사 모달 먼저 닫기 → 모달 중첩 방지
        if (typeof Modal !== 'undefined' && Modal.close) Modal.close();
        if (typeof window.navigate === 'function') {
          // app.js navigate() 가 있으면 사용
          window.navigate('contracts');
          // 페이지 마운트 완료 (ct-list-wrap) 대기 + 재시도 (race condition 방지)
          let tries = 30;
          const tryOpen = () => {
            const ready = document.getElementById('ct-list-wrap');
            if (ready && typeof ContractsPage !== 'undefined' && ContractsPage._openModal) {
              ContractsPage._openModal(contractId);
              return;
            }
            if (--tries > 0) setTimeout(tryOpen, 100);
            else console.warn('[LinkedContracts] _openModal 호출 timeout');
          };
          setTimeout(tryOpen, 100);
        } else {
          // fallback: location hash
          window.location.hash = '#contracts';
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

  /**
   * @param {string|HTMLElement} containerSel - 렌더 대상 컨테이너 (selector 또는 element)
   * @param {string} parentType - 'customer' | 'lead' | 'proposal' | 'quote'
   * @param {number} parentId
   * @returns {Promise<{count: number}>} - 렌더된 계약 개수
   */
  async function render(containerSel, parentType, parentId) {
    const container =
      typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
    if (!container) {
      console.warn('[LinkedContracts] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }

    // 로딩 상태
    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">⏳ 연결된 계약 조회 중...</div>`;

    try {
      const res = await _fetchFn(parentType, parentId);
      const contracts = res?.data || [];
      const count = contracts.length;

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">🔗 연결된 계약 ${count > 0 ? `(${count}건)` : ''}</strong>
          ${count > 0 ? '<span style="font-size:10px;color:var(--text-3)">행 클릭 시 계약 페이지로 이동</span>' : ''}
        </div>
        ${_renderTable(contracts)}
      `;
      _bindRowClicks(container);

      return { count };
    } catch (err) {
      console.error('[LinkedContracts] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        연결된 계약 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
