'use strict';
// =============================================================
// Customer360View — 고객 360뷰 (모든 접점 통합 요약)
//
// 사용:
//   Customer360View.render('#my-container', 'customer', 42);
//   - parentType: 'customer' (현재 고객사만 지원)
//   - parentId: 고객 ID
//   반환: { count }  (전체 접점 건수 합계 — 탭 배지용)
//
// 데이터: GET /api/customers/:id/360view (단일 호출 집계)
// =============================================================
const Customer360View = (() => {
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
    if (!v) return '0';
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }

  // 큰 금액 축약 (억/만)
  function _fmtMoneyShort(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
    if (v >= 10000) return Math.round(v / 10000).toLocaleString('ko-KR') + '만';
    return _fmtKRW(v);
  }

  function _fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  // 파이프라인 단계 라벨 (leads.stage)
  const STAGE_LABEL = {
    lead: '발굴',
    review: '샘플 평가',
    proposal: 'Spec-in',
    bidding: '가격 협의',
    negotiation: '공급계약',
    contract: '계약',
    won: '양산/수주',
    lost: '실주',
    hold: '보류',
    drop: '드롭',
  };

  // 타임라인 타입별 색
  const TYPE_COLOR = {
    activity: '#2563eb',
    quote: '#ca8a04',
    proposal: '#ea580c',
    contract: '#16a34a',
    payment: '#0891b2',
    support: '#64748b',
  };

  // KPI 타일
  function _tile(icon, label, main, sub, accent) {
    return `<div style="flex:1;min-width:120px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${icon} ${esc(label)}</div>
      <div style="font-size:20px;font-weight:800;color:${accent || 'var(--text-1)'};line-height:1.1">${main}</div>
      <div style="font-size:11px;color:var(--text-2);margin-top:4px;min-height:14px">${sub || ''}</div>
    </div>`;
  }

  function _summaryGrid(s) {
    const red = 'var(--oci-red)';
    return `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      ${_tile('🤝', '진행 딜', `${s.deals.count}<span style="font-size:12px;font-weight:600;color:var(--text-3)">건</span>`, `예상 ${_fmtMoneyShort(s.deals.total_expected)}`, red)}
      ${_tile('💰', '견적', `${s.quotes.count}<span style="font-size:12px;font-weight:600;color:var(--text-3)">건</span>`, `${_fmtMoneyShort(s.quotes.total_amount)}`)}
      ${_tile('📄', '제안', `${s.proposals.count}<span style="font-size:12px;font-weight:600;color:var(--text-3)">건</span>`, `예상 ${_fmtMoneyShort(s.proposals.total_expected)}`)}
      ${_tile('📜', '계약', `${s.contracts.count}<span style="font-size:12px;font-weight:600;color:var(--text-3)">건</span>`, `진행 ${s.contracts.active_count} · ${_fmtMoneyShort(s.contracts.total_amount)}`, '#16a34a')}
      ${_tile('💳', '수금', `${_fmtMoneyShort(s.payments.recognized_total)}`, `예정 ${_fmtMoneyShort(s.payments.scheduled_total)}${s.payments.overdue_count ? ` · <span style="color:#dc2626">연체 ${s.payments.overdue_count}</span>` : ''}`, '#0891b2')}
      ${_tile('🎫', '고객지원', `${s.support.count}<span style="font-size:12px;font-weight:600;color:var(--text-3)">건</span>`, s.support.open_count ? `<span style="color:#dc2626">미해결 ${s.support.open_count}</span>` : '미해결 0', '#64748b')}
    </div>`;
  }

  function _pipeline(rows) {
    if (!rows.length) return '';
    const total = rows.reduce((a, r) => a + r.count, 0) || 1;
    const bar = rows
      .map(r => {
        const pct = Math.round((r.count / total) * 100);
        const color = TYPE_COLOR.quote;
        return `<div title="${esc(STAGE_LABEL[r.stage] || r.stage)} ${r.count}건" style="width:${pct}%;background:${color};opacity:.85;height:100%"></div>`;
      })
      .join('');
    const legend = rows
      .map(
        r =>
          `<span style="font-size:11px;color:var(--text-2);margin-right:12px">
            <b>${esc(STAGE_LABEL[r.stage] || r.stage)}</b> ${r.count}건${r.amount ? ` (${_fmtMoneyShort(r.amount)})` : ''}
          </span>`
      )
      .join('');
    return `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">📊 영업 파이프라인 분포</div>
      <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;border:1px solid var(--border);margin-bottom:6px">${bar}</div>
      <div>${legend}</div>
    </div>`;
  }

  function _timeline(items) {
    if (!items.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">
        최근 활동 기록 없음
      </div>`;
    }
    return `<div style="font-size:12px;font-weight:700;margin-bottom:8px">🕒 최근 통합 타임라인</div>
    <div style="position:relative;padding-left:6px">
      ${items
        .map(e => {
          const color = TYPE_COLOR[e.type] || 'var(--text-3)';
          const amt = e.amount ? `<span style="font-family:monospace;font-size:11px;color:var(--text-2)">${_fmtMoneyShort(e.amount)}</span>` : '';
          const st = e.status ? `<span class="badge" style="font-size:10px;background:#f1f3f5;color:var(--text-2)">${esc(e.status)}</span>` : '';
          return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--surface-3)">
            <div style="flex:0 0 auto;width:22px;text-align:center">${e.icon || '•'}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.title)}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px;display:flex;gap:8px;align-items:center">
                <span style="color:${color};font-weight:600">${esc(e.type)}</span>
                <span>${_fmtDate(e.date)}</span> ${amt} ${st}
              </div>
            </div>
          </div>`;
        })
        .join('')}
    </div>`;
  }

  async function render(containerSel, parentType, parentId) {
    const container =
      typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
    if (!container) {
      console.warn('[Customer360View] container not found:', containerSel);
      return { count: 0 };
    }
    if (!parentId) {
      container.innerHTML = '';
      return { count: 0 };
    }
    if (parentType !== 'customer') {
      console.warn('[Customer360View] unsupported parentType:', parentType);
    }

    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">⏳ 360뷰 집계 중...</div>`;

    try {
      const res = await API.customers.view360(parentId);
      const d = res?.data || {};
      const s = d.summary || {};
      // 안전 기본값
      const safe = {
        deals: s.deals || { count: 0, total_expected: 0 },
        quotes: s.quotes || { count: 0, total_amount: 0 },
        proposals: s.proposals || { count: 0, total_expected: 0 },
        contracts: s.contracts || { count: 0, total_amount: 0, active_count: 0 },
        payments: s.payments || { count: 0, scheduled_total: 0, recognized_total: 0, overdue_count: 0 },
        support: s.support || { count: 0, open_count: 0 },
        activities: s.activities || { count: 0 },
      };
      const count =
        safe.deals.count +
        safe.quotes.count +
        safe.proposals.count +
        safe.contracts.count +
        safe.payments.count +
        safe.support.count;

      container.innerHTML = `
        ${_summaryGrid(safe)}
        ${_pipeline(d.pipeline || [])}
        ${_timeline(d.timeline || [])}
      `;

      return { count };
    } catch (err) {
      console.error('[Customer360View] failed:', err);
      container.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        360뷰 조회 실패: ${esc(err?.message || err)}
      </div>`;
      return { count: 0 };
    }
  }

  return { render };
})();
