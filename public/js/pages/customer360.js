'use strict';
// =============================================================
// Customer360Page — 고객·제품 360뷰 (MVP 1차)
//
// 별도 메인메뉴. 고객사 선택 → 통합 대시보드(헤더 + 5탭):
//   요약 / 소재·제품 / 영업기회 / 활동 타임라인 / AI 브리핑
// 데이터: GET /api/customer360/customers, GET /api/customer360/:id
// (반도체 소재 특화 탭 — 포캐스트/샘플평가/품질 — 은 상세 단계에서 확장)
// =============================================================
const Customer360Page = {
  _customers: [],
  _custId: null,
  _data: null,
  _tab: 'summary',

  // ── 라인 SVG 아이콘 ──
  _ic: {
    deal: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    proposal: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    support: '<path d="M3 11a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-1v-7"/><path d="M3 11v5a2 2 0 0 0 2 2h1v-7"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  },
  _svg(name, size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${this._ic[name] || ''}</svg>`;
  },
  _won(v) {
    return Fmt.amount(Number(v) || 0, 'KRW');
  },

  async render() {
    document.getElementById('content').innerHTML = `
      <style>
        .c360-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
        .c360-bar h2{font-size:18px;font-weight:700;margin:0}
        .c360-pick{margin-left:auto;display:flex;gap:8px;align-items:center}
        .c360-pick input,.c360-pick select{height:34px;border:1px solid var(--border);border-radius:7px;padding:0 10px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .c360-pick select{min-width:230px}
        .c360-empty{padding:60px 20px;text-align:center;color:var(--text-3)}
        .c360-head{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:14px}
        .c360-grade{width:54px;height:54px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0}
        .c360-head-main{flex:1;min-width:180px}
        .c360-head-name{font-size:18px;font-weight:700}
        .c360-head-sub{font-size:12px;color:var(--text-3);margin-top:2px}
        .c360-head-metrics{display:flex;gap:22px;flex-wrap:wrap}
        .c360-metric .v{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
        .c360-metric .l{font-size:11px;color:var(--text-3)}
        .c360-risks{display:flex;gap:6px;flex-wrap:wrap}
        .c360-risk{font-size:11px;padding:3px 9px;border-radius:999px;font-weight:600}
        .c360-risk.high{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .c360-risk.medium{background:rgba(245,156,0,.12);color:#b45309}
        .c360-risk.low{background:var(--surface-2);color:var(--text-2)}
        .c360-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
        .c360-tab{padding:9px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-3);border-bottom:2px solid transparent;margin-bottom:-1px}
        .c360-tab.active{color:var(--oci-red);border-bottom-color:var(--oci-red)}
        .c360-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px}
        .c360-kpi{border:1px solid var(--border);border-radius:9px;padding:12px 14px;background:var(--surface)}
        .c360-kpi .h{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);margin-bottom:6px}
        .c360-kpi .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
        .c360-kpi .s{font-size:11px;color:var(--text-3);margin-top:2px}
        .c360-sec-title{font-size:13px;font-weight:700;margin:6px 0 10px}
        .c360-pipe{display:flex;flex-direction:column;gap:8px}
        .c360-pipe-row{display:flex;align-items:center;gap:10px;font-size:12px}
        .c360-pipe-row .nm{width:88px;flex-shrink:0;color:var(--text-2)}
        .c360-pipe-bar{flex:1;height:18px;background:var(--surface-2);border-radius:5px;overflow:hidden}
        .c360-pipe-bar > div{height:100%;border-radius:5px}
        .c360-pipe-row .amt{width:120px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-2)}
        .c360-tl{position:relative;border-left:2px solid var(--border);margin-left:8px;padding-left:18px}
        .c360-tl-item{position:relative;margin-bottom:16px}
        .c360-tl-dot{position:absolute;left:-27px;top:0;width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-2)}
        .c360-tl-title{font-size:13px;font-weight:600}
        .c360-tl-meta{font-size:11px;color:var(--text-3);margin-top:2px}
        .c360-brief{border:1px solid var(--border);border-radius:10px;padding:18px;background:var(--surface)}
        .c360-brief-head{font-size:15px;font-weight:700;line-height:1.5;background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.06));border-left:3px solid var(--oci-blue);padding:12px 14px;border-radius:8px;margin-bottom:14px}
        .stage-pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--text-2);margin:1px 2px}
      </style>
      <div class="c360-bar">
        <h2>고객·제품 360뷰</h2>
        <div class="c360-pick">
          <input id="c360-search" placeholder="고객사 검색…" autocomplete="off">
          <select id="c360-select"><option value="">고객사 선택…</option></select>
        </div>
      </div>
      <div id="c360-body">
        <div class="c360-empty">고객사를 선택하면 통합 360뷰가 표시됩니다.</div>
      </div>
    `;

    document.getElementById('c360-search')?.addEventListener('input', e => this._filterOptions(e.target.value));
    document.getElementById('c360-select')?.addEventListener('change', e => {
      if (e.target.value) this._select(Number(e.target.value));
    });

    await this._loadCustomers();
    // 마지막 선택 복원
    const last = Number(localStorage.getItem('c360_last') || 0);
    if (last && this._customers.some(c => c.id === last)) {
      const sel = document.getElementById('c360-select');
      if (sel) sel.value = String(last);
      await this._select(last);
    }
  },

  async _loadCustomers() {
    try {
      const res = await API.get('/customer360/customers');
      this._customers = res.data || [];
      this._renderOptions(this._customers);
    } catch (_) {
      /* Toast 는 API 가 처리 */
    }
  },

  _renderOptions(list) {
    const sel = document.getElementById('c360-select');
    if (!sel) return;
    const cur = this._custId ? String(this._custId) : sel.value;
    sel.innerHTML =
      '<option value="">고객사 선택…</option>' +
      list
        .map(
          c =>
            `<option value="${c.id}">${esc(c.name)}${c.pipeline_amount ? ' · ' + this._won(c.pipeline_amount) : ''}</option>`
        )
        .join('');
    if (cur) sel.value = cur;
  },

  _filterOptions(q) {
    const s = (q || '').trim().toLowerCase();
    const filtered = !s
      ? this._customers
      : this._customers.filter(
          c => c.name.toLowerCase().includes(s) || (c.industry || '').toLowerCase().includes(s)
        );
    this._renderOptions(filtered);
  },

  async _select(id) {
    this._custId = id;
    localStorage.setItem('c360_last', String(id));
    const body = document.getElementById('c360-body');
    if (body) body.innerHTML = `<div class="c360-empty">불러오는 중…</div>`;
    try {
      const res = await API.get('/customer360/' + id);
      this._data = res.data;
      this._renderDashboard();
    } catch (_) {
      if (body) body.innerHTML = `<div class="c360-empty">데이터를 불러오지 못했습니다.</div>`;
    }
  },

  _gradeColor(g) {
    if (g === 'A+' || g === 'A') return '#0F7A3F';
    if (g === 'B+' || g === 'B') return '#2357E8';
    if (g === 'C') return '#F59C00';
    return '#E63329';
  },

  _renderDashboard() {
    const d = this._data;
    const h = d.header;
    const c = d.customer;
    const sub = [c.industry, c.region, c.country].filter(Boolean).join(' · ');
    const body = document.getElementById('c360-body');
    if (!body) return;
    body.innerHTML = `
      <div class="c360-head">
        <div class="c360-grade" style="background:${this._gradeColor(h.health_grade)}">${h.health_grade}</div>
        <div class="c360-head-main">
          <div class="c360-head-name">${esc(c.name)}</div>
          <div class="c360-head-sub">${esc(sub || '-')}</div>
        </div>
        <div class="c360-head-metrics">
          <div class="c360-metric"><div class="v">${this._won(h.weighted_expected)}</div><div class="l">가중 예상매출</div></div>
          <div class="c360-metric"><div class="v">${h.active_count}건</div><div class="l">진행 딜</div></div>
          <div class="c360-metric"><div class="v">${h.won_count}건</div><div class="l">수주</div></div>
          <div class="c360-metric"><div class="v">${this._won(h.contract_amount)}</div><div class="l">계약액</div></div>
        </div>
        <div class="c360-risks">
          ${
            h.risks.length
              ? h.risks.map(r => `<span class="c360-risk ${r.level}">${esc(r.label)}</span>`).join('')
              : '<span class="c360-risk low">리스크 없음</span>'
          }
        </div>
      </div>
      <div class="c360-tabs">
        ${[
          ['summary', '요약'],
          ['materials', '소재·제품'],
          ['deals', '영업기회'],
          ['timeline', '활동 타임라인'],
          ['brief', 'AI 브리핑'],
        ]
          .map(
            ([k, l]) => `<button class="c360-tab ${this._tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`
          )
          .join('')}
      </div>
      <div id="c360-tab-body"></div>
    `;
    body.querySelectorAll('.c360-tab').forEach(btn =>
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        body.querySelectorAll('.c360-tab').forEach(b => b.classList.toggle('active', b === btn));
        this._renderTab();
      })
    );
    this._renderTab();
  },

  _renderTab() {
    const el = document.getElementById('c360-tab-body');
    if (!el) return;
    const m = {
      summary: () => this._tabSummary(),
      materials: () => this._tabMaterials(),
      deals: () => this._tabDeals(),
      timeline: () => this._tabTimeline(),
      brief: () => this._tabBrief(),
    };
    el.innerHTML = (m[this._tab] || m.summary)();
    if (this._tab === 'deals') {
      el.querySelectorAll('tr[data-lead-id]').forEach(tr =>
        tr.addEventListener('click', () => {
          const id = Number(tr.dataset.leadId);
          if (window.App && typeof App.openLeadDetail === 'function') App.openLeadDetail(id);
        })
      );
    }
  },

  _kpi(icon, label, value, sub) {
    return `<div class="c360-kpi">
      <div class="h">${this._svg(icon, 14)} ${esc(label)}</div>
      <div class="v">${value}</div>
      ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
    </div>`;
  },

  _tabSummary() {
    const s = this._data.summary;
    const pipe = this._data.pipeline;
    const maxAmt = Math.max(1, ...pipe.map(p => p.amount));
    const roleColor = { won: '#0F7A3F', lost: '#9CA3AF', dropped: '#E63329', active: '#2357E8' };
    return `
      <div class="c360-kpis">
        ${this._kpi('deal', '진행 딜', `${s.deals.count}건`, this._won(s.deals.total_expected))}
        ${this._kpi('quote', '견적', `${s.quotes.count}건`, this._won(s.quotes.total_amount))}
        ${this._kpi('proposal', '제안', `${s.proposals.count}건`, this._won(s.proposals.total_expected))}
        ${this._kpi('contract', '계약', `${s.contracts.count}건`, `진행 ${s.contracts.active_count} · ${this._won(s.contracts.total_amount)}`)}
        ${this._kpi('support', '미해결 지원', `${s.support.open_count}건`, `전체 ${s.support.count}`)}
        ${this._kpi('activity', '활동', `${s.activities.count}건`, '누적 접점')}
      </div>
      <div class="c360-sec-title">영업 파이프라인 분포</div>
      ${
        pipe.length
          ? `<div class="c360-pipe">${pipe
              .map(
                p => `<div class="c360-pipe-row">
            <span class="nm">${esc(p.stage)}</span>
            <span class="c360-pipe-bar"><div style="width:${Math.round((p.amount / maxAmt) * 100)}%;background:${roleColor[p.role] || '#2357E8'}"></div></span>
            <span class="amt">${p.count}건 · ${this._won(p.amount)}</span>
          </div>`
              )
              .join('')}</div>`
          : '<div class="c360-empty">파이프라인 데이터가 없습니다.</div>'
      }`;
  },

  _tabMaterials() {
    const mats = this._data.materials;
    if (!mats.length) return '<div class="c360-empty">등록된 소재/제품 딜이 없습니다.</div>';
    return `
      <table class="data-table">
        <thead><tr>
          <th>사업유형</th><th class="text-right">딜</th><th class="text-right">예상매출</th>
          <th class="text-right">가중</th><th>단계 분포</th><th class="text-right">수주</th>
        </tr></thead>
        <tbody>
          ${mats
            .map(
              m => `<tr>
            <td><strong>${esc(m.business_type)}</strong></td>
            <td class="text-right">${m.count}</td>
            <td class="text-right">${this._won(m.total_expected)}</td>
            <td class="text-right">${this._won(m.weighted)}</td>
            <td>${Object.entries(m.stages)
              .map(([k, v]) => `<span class="stage-pill">${esc(k)} ${v}</span>`)
              .join('')}</td>
            <td class="text-right">${m.won}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  },

  _tabDeals() {
    const deals = this._data.deals;
    if (!deals.length) return '<div class="c360-empty">영업기회가 없습니다.</div>';
    return `
      <table class="data-table">
        <thead><tr>
          <th>프로젝트</th><th>사업유형</th><th>단계</th>
          <th class="text-right">예상매출</th><th class="text-right">확률</th>
          <th class="text-right">가중</th><th>마감</th><th>담당</th>
        </tr></thead>
        <tbody>
          ${deals
            .map(
              dl => `<tr class="clickable" data-lead-id="${dl.id}">
            <td><strong>${esc(dl.project_name || '-')}</strong></td>
            <td>${esc(dl.business_type || '-')}</td>
            <td><span class="stage-pill">${esc(dl.stage_label)}</span></td>
            <td class="text-right">${this._won(dl.expected_amount)}</td>
            <td class="text-right">${dl.probability}%</td>
            <td class="text-right">${this._won(dl.weighted)}</td>
            <td>${dl.expected_close_date ? String(dl.expected_close_date).slice(0, 10) : '-'}</td>
            <td>${esc(dl.owner_name || '-')}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  },

  _tabTimeline() {
    const tl = this._data.timeline;
    if (!tl.length) return '<div class="c360-empty">최근 활동 기록이 없습니다.</div>';
    const iconByType = { activity: 'activity', quote: 'quote', proposal: 'proposal', contract: 'contract' };
    return `<div class="c360-tl">
      ${tl
        .map(
          e => `<div class="c360-tl-item">
        <span class="c360-tl-dot">${this._svg(iconByType[e.type] || 'activity', 14)}</span>
        <div class="c360-tl-title">${esc(e.title || '-')}</div>
        <div class="c360-tl-meta">${e.date ? String(e.date).slice(0, 10) : ''}${
            e.amount ? ' · ' + this._won(e.amount) : ''
          }${e.status ? ' · ' + esc(e.status) : ''}</div>
      </div>`
        )
        .join('')}
    </div>`;
  },

  _tabBrief() {
    const b = this._data.brief;
    if (!b) {
      return `<div class="c360-empty">생성된 AI 브리핑이 없습니다.<br>
        <span style="font-size:12px">고객사 상세에서 AI 브리핑을 생성하면 여기에 표시됩니다.</span></div>`;
    }
    const kp = Array.isArray(b.key_points) ? b.key_points : [];
    return `<div class="c360-brief">
      ${b.headline ? `<div class="c360-brief-head">${esc(b.headline)}</div>` : ''}
      ${
        kp.length
          ? `<div class="c360-sec-title">핵심 포인트</div>
             <ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;font-size:13px">
               ${kp.map(k => `<li>${esc(k)}</li>`).join('')}
             </ul>`
          : ''
      }
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${
          b.next_action
            ? `<div style="flex:1;min-width:200px;background:rgba(23,168,90,.08);border-left:3px solid #17A85A;padding:10px 12px;border-radius:6px">
                 <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번 주 즉시 실행</div>
                 <div style="font-size:13px;font-weight:600">${esc(b.next_action)}</div>
               </div>`
            : ''
        }
        ${
          b.risk
            ? `<div style="flex:1;min-width:200px;background:rgba(230,51,41,.08);border-left:3px solid var(--oci-red);padding:10px 12px;border-radius:6px">
                 <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">리스크</div>
                 <div style="font-size:13px;font-weight:600">${esc(b.risk)}</div>
               </div>`
            : ''
        }
      </div>
      ${
        b.generated_at
          ? `<div style="font-size:11px;color:var(--text-3);margin-top:12px">생성: ${String(b.generated_at).replace('T', ' ').slice(0, 16)}</div>`
          : ''
      }
    </div>`;
  },
};
