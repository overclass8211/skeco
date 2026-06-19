'use strict';
// =============================================================
// Customer360Page — 고객·제품 360뷰 (라이프사이클 개선판)
//
// 별도 메인메뉴. 고객사 선택 → 라이프사이클 조망 대시보드:
//   헤더(Health/가중매출/리스크) + "지금 이 계정은" 내러티브
//   [라이프사이클] 소재별 발굴→샘플→평가→Spec-in→양산→납품 보드
//                 + 수요→생산(CAPA)→수주 흐름 + 품질 + AI 추천 액션
//   [영업기회] [활동] [AI 브리핑]
// 편집: 소재 추가/수정, 월 Forecast 입력 (manager+)
// 데이터: /api/customer360/customers, /:id, POST/PUT materials, POST forecasts
// =============================================================
const Customer360Page = {
  _customers: [],
  _custId: null,
  _data: null,
  _tab: 'lifecycle',

  _STAGES: [
    ['discovery', '발굴'],
    ['sample', '샘플'],
    ['evaluation', '평가'],
    ['specin', 'Spec-in'],
    ['massprod', '양산'],
    ['delivery', '납품'],
  ],
  _FC_MONTHS: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
  _fcData: null,
  _cmpVer: null,

  _ic: {
    deal: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    proposal: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  },
  _svg(name, size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${this._ic[name] || this._ic.activity}</svg>`;
  },
  _won(v) {
    return Fmt.amount(Number(v) || 0, 'KRW');
  },
  _qty(v, unit) {
    return (Math.round(Number(v) || 0)).toLocaleString('ko-KR') + (unit || '');
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
        .c360-head{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:12px}
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
        .c360-narr{background:var(--oci-red-light,rgba(230,51,41,.06));border-radius:8px;padding:10px 14px;font-size:13px;color:var(--text-1);margin-bottom:16px;line-height:1.6;display:flex;gap:8px;align-items:flex-start}
        .c360-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
        .c360-tab{padding:9px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-3);border-bottom:2px solid transparent;margin-bottom:-1px}
        .c360-tab.active{color:var(--oci-red);border-bottom-color:var(--oci-red)}
        .c360-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:18px}
        .c360-kpi{border:1px solid var(--border);border-radius:9px;padding:10px 12px;background:var(--surface)}
        .c360-kpi .h{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2);margin-bottom:4px}
        .c360-kpi .v{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
        .c360-kpi .s{font-size:11px;color:var(--text-3);margin-top:1px}
        .c360-sec{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin:18px 0 10px}
        .c360-sec .btn-add{margin-left:auto;font-size:12px;font-weight:500}
        .lc-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin-bottom:11px}
        .lc-top{display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap}
        .lc-name{font-weight:700;font-size:14px}
        .pill{font-size:11px;padding:2px 8px;border-radius:6px}
        .pill-info{background:rgba(35,87,232,.1);color:#2357E8}
        .pill-mut{background:var(--surface-2);color:var(--text-2)}
        .pill-danger{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .pill-warn{background:rgba(245,156,0,.14);color:#b45309}
        .lc-edit{margin-left:auto;display:flex;gap:6px}
        .lc-mini{border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px;padding:2px 6px;border-radius:6px}
        .lc-mini:hover{background:var(--surface-2);color:var(--text-1)}
        .lc-track{display:flex;align-items:flex-start;position:relative;margin:12px 0 12px}
        .lc-step{flex:1;text-align:center;font-size:11px;position:relative;color:var(--text-3)}
        .lc-dot{width:18px;height:18px;border-radius:50%;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;font-size:10px;border:1.5px solid var(--border);background:var(--surface);color:var(--text-3)}
        .lc-done .lc-dot{background:#17A85A;border-color:#17A85A;color:#fff}
        .lc-now .lc-dot{background:#2357E8;border-color:#2357E8;color:#fff}
        .lc-now{color:#2357E8;font-weight:700}
        .lc-line{position:absolute;top:9px;left:-50%;width:100%;height:1.5px;background:var(--border);z-index:0}
        .lc-step .lc-dot{position:relative;z-index:1}
        .lc-mrow{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-2)}
        .lc-mrow b{font-weight:700;color:var(--text-1)}
        .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
        .flow-box{flex:1;min-width:110px;border-radius:8px;padding:12px 14px;background:var(--surface-2)}
        .flow-box .l{font-size:11px;color:var(--text-2)}
        .flow-box .v{font-size:20px;font-weight:700}
        .c360-act{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:8px}
        .c360-act .ai{color:#2357E8;flex-shrink:0;margin-top:1px}
        .stage-pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--text-2);margin:1px 2px}
        .c360-tl{position:relative;border-left:2px solid var(--border);margin-left:8px;padding-left:18px}
        .c360-tl-item{position:relative;margin-bottom:16px}
        .c360-tl-dot{position:absolute;left:-27px;top:0;width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-2)}
        .c360-tl-title{font-size:13px;font-weight:600}
        .c360-tl-meta{font-size:11px;color:var(--text-3);margin-top:2px}
        .c360-brief{border:1px solid var(--border);border-radius:10px;padding:18px;background:var(--surface)}
        .c360-brief-head{font-size:15px;font-weight:700;line-height:1.5;background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.06));border-left:3px solid var(--oci-blue);padding:12px 14px;border-radius:8px;margin-bottom:14px}
      </style>
      <div class="c360-bar">
        <h2>고객·제품 360뷰</h2>
        <div class="c360-pick">
          <input id="c360-search" placeholder="고객사 검색…" autocomplete="off">
          <select id="c360-select"><option value="">고객사 선택…</option></select>
        </div>
      </div>
      <div id="c360-body">
        <div class="c360-empty">고객사를 선택하면 소재 라이프사이클 360뷰가 표시됩니다.</div>
      </div>
    `;

    document.getElementById('c360-search')?.addEventListener('input', e => this._filterOptions(e.target.value));
    document.getElementById('c360-select')?.addEventListener('change', e => {
      if (e.target.value) this._select(Number(e.target.value));
    });

    await this._loadCustomers();
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
      /* Toast 처리 */
    }
  },

  _renderOptions(list) {
    const sel = document.getElementById('c360-select');
    if (!sel) return;
    const cur = this._custId ? String(this._custId) : sel.value;
    sel.innerHTML =
      '<option value="">고객사 선택…</option>' +
      list
        .map(c => `<option value="${c.id}">${esc(c.name)}${c.pipeline_amount ? ' · ' + this._won(c.pipeline_amount) : ''}</option>`)
        .join('');
    if (cur) sel.value = cur;
  },

  _filterOptions(q) {
    const s = (q || '').trim().toLowerCase();
    const filtered = !s
      ? this._customers
      : this._customers.filter(c => c.name.toLowerCase().includes(s) || (c.industry || '').toLowerCase().includes(s));
    this._renderOptions(filtered);
  },

  async _select(id) {
    this._custId = id;
    this._fcData = null;
    this._cmpVer = null;
    this._samples = null;
    this._quality = null;
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

  async _reload() {
    if (this._custId) await this._select(this._custId);
  },

  _gradeColor(g) {
    if (g === 'A+' || g === 'A') return '#0F7A3F';
    if (g === 'B+' || g === 'B') return '#2357E8';
    if (g === 'C') return '#F59C00';
    return '#E63329';
  },

  _narrative() {
    const lc = this._data.lifecycle;
    const parts = [];
    const specin = lc.materials.find(m => m.lifecycle_stage === 'specin');
    if (specin) parts.push(`${esc(specin.material_name.split(' · ')[0])} <b>양산 승인 임박</b>`);
    const short = lc.materials.find(m => m.capa_short);
    if (short) parts.push(`${esc(short.material_name.split(' · ')[0])} <b>CAPA 부족 위험</b>`);
    const openQ = lc.quality.filter(q => q.status !== 'resolved').length;
    if (openQ) parts.push(`품질 이슈 <b>${openQ}건</b>`);
    if (!parts.length) parts.push('주요 리스크 없음 · 라이프사이클 정상 진행');
    return parts.join(' · ');
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
      <div class="c360-narr">${this._svg('bulb', 16)}<span>${this._narrative()}</span></div>
      <div class="c360-tabs">
        ${[
          ['lifecycle', '라이프사이클'],
          ['forecast', '포캐스트'],
          ['samples', '샘플/평가'],
          ['quality', '품질'],
          ['org', '조직'],
          ['deals', '영업기회'],
          ['timeline', '활동'],
          ['brief', 'AI 브리핑'],
        ]
          .map(([k, l]) => `<button class="c360-tab ${this._tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`)
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
      lifecycle: () => this._tabLifecycle(),
      forecast: () => this._tabForecast(),
      samples: () => this._tabSamples(),
      quality: () => this._tabQuality(),
      org: () => this._tabOrg(),
      deals: () => this._tabDeals(),
      timeline: () => this._tabTimeline(),
      brief: () => this._tabBrief(),
    };
    el.innerHTML = (m[this._tab] || m.lifecycle)();
    this._bindTab(el);
  },

  _bindTab(el) {
    if (this._tab === 'deals') {
      el.querySelectorAll('tr[data-lead-id]').forEach(tr =>
        tr.addEventListener('click', () => {
          const id = Number(tr.dataset.leadId);
          if (window.App && typeof App.openLeadDetail === 'function') App.openLeadDetail(id);
        })
      );
    }
    if (this._tab === 'forecast') {
      if (!this._fcData) this._loadForecast();
      else this._bindForecast(el);
    }
    if (this._tab === 'samples') {
      if (!this._samples) this._loadSamples();
      else this._bindSamples(el);
    }
    if (this._tab === 'quality') {
      if (!this._quality) this._loadQuality();
      else this._bindQuality(el);
    }
    if (this._tab === 'org') this._bindOrg(el);
    if (this._tab === 'lifecycle') {
      el.querySelector('#c360-add-mat')?.addEventListener('click', () => this._openMaterialModal(null));
      el.querySelectorAll('[data-edit-mat]').forEach(b =>
        b.addEventListener('click', () => {
          const mat = this._data.lifecycle.materials.find(m => m.id === Number(b.dataset.editMat));
          this._openMaterialModal(mat);
        })
      );
      el.querySelectorAll('[data-fc-mat]').forEach(b =>
        b.addEventListener('click', () => {
          const mat = this._data.lifecycle.materials.find(m => m.id === Number(b.dataset.fcMat));
          this._openForecastModal(mat);
        })
      );
    }
  },

  _kpi(icon, label, value, sub) {
    return `<div class="c360-kpi">
      <div class="h">${this._svg(icon, 13)} ${esc(label)}</div>
      <div class="v">${value}</div>
      ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
    </div>`;
  },

  _ribbon(stageIndex) {
    return `<div class="lc-track">
      ${this._STAGES.map(([, label], i) => {
        const cls = i < stageIndex ? 'lc-done' : i === stageIndex ? 'lc-now' : '';
        const inner = i < stageIndex ? this._svg('check', 11) : '';
        return `<div class="lc-step ${cls}">
          ${i > 0 ? '<div class="lc-line"></div>' : ''}
          <div class="lc-dot">${inner}</div>${label}
        </div>`;
      }).join('')}
    </div>`;
  },

  _tabLifecycle() {
    const s = this._data.summary;
    const lc = this._data.lifecycle;
    const f = lc.demand_flow;
    const kpis = `<div class="c360-kpis">
      ${this._kpi('deal', '진행 딜', `${s.deals.count}건`, this._won(s.deals.total_expected))}
      ${this._kpi('quote', '견적', `${s.quotes.count}건`, this._won(s.quotes.total_amount))}
      ${this._kpi('proposal', '제안', `${s.proposals.count}건`, this._won(s.proposals.total_expected))}
      ${this._kpi('contract', '계약', `${s.contracts.count}건`, this._won(s.contracts.total_amount))}
    </div>`;

    const board = lc.materials.length
      ? lc.materials.map(m => this._matCard(m)).join('')
      : '<div class="c360-empty">등록된 소재가 없습니다. “소재 추가”로 시작하세요.</div>';

    const flow = `
      <div class="flow">
        <div class="flow-box"><div class="l">분기 예상 수요</div><div class="v">${this._qty(f.demand, f.unit)}</div></div>
        <span style="color:var(--text-3)">→</span>
        <div class="flow-box"><div class="l">생산 가능</div><div class="v">${this._qty(f.capacity, f.unit)}</div></div>
        <span style="color:var(--text-3)">→</span>
        <div class="flow-box" style="background:${f.gap > 0 ? 'rgba(230,51,41,.08)' : 'var(--surface-2)'}">
          <div class="l" style="${f.gap > 0 ? 'color:var(--oci-red)' : ''}">부족 CAPA</div>
          <div class="v" style="${f.gap > 0 ? 'color:var(--oci-red)' : ''}">${this._qty(f.gap, f.unit)}</div>
        </div>
        <span style="color:var(--text-3)">→</span>
        <div class="flow-box" style="background:rgba(23,168,90,.08)"><div class="l" style="color:#17A85A">예상 수주</div><div class="v" style="color:#17A85A">${this._won(f.expected_order)}</div></div>
      </div>`;

    const quality = lc.quality.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>케이스</th><th>소재</th><th>유형</th><th>심각도</th><th>상태</th><th>제목</th></tr></thead><tbody>
          ${lc.quality
            .map(q => {
              const mat = lc.materials.find(m => m.id === q.material_id);
              const sevCls = q.severity === 'high' ? 'pill-danger' : q.severity === 'medium' ? 'pill-warn' : 'pill-mut';
              return `<tr><td class="mono">${esc(q.case_no)}</td><td>${esc(mat ? mat.material_name.split(' · ')[0] : '-')}</td>
                <td>${esc(q.type)}</td><td><span class="pill ${sevCls}">${esc(q.severity)}</span></td>
                <td>${esc(q.status)}</td><td>${esc(q.title)}</td></tr>`;
            })
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">품질 이슈 없음</div>';

    const actions = lc.actions.length
      ? lc.actions.map(a => `<div class="c360-act"><span class="ai">${this._svg('bulb', 16)}</span><span>${esc(a.text)}</span></div>`).join('')
      : '<div class="c360-empty" style="padding:24px">추천 액션 없음</div>';

    return `
      ${kpis}
      <div class="c360-sec">소재별 라이프사이클
        <button class="btn btn-primary btn-sm btn-add" id="c360-add-mat">+ 소재 추가</button>
      </div>
      ${board}
      <div class="c360-sec">수요 → 생산 → 수주 (3개월)</div>
      ${flow}
      <div class="c360-sec">품질 이슈</div>
      ${quality}
      <div class="c360-sec">AI 추천 다음 액션</div>
      ${actions}
    `;
  },

  _matCard(m) {
    const stagePill = m.lifecycle_stage === 'massprod' || m.lifecycle_stage === 'specin' ? 'pill-info' : 'pill-mut';
    const badges = [];
    if (m.capa_short) badges.push(`<span class="pill pill-danger">CAPA 부족</span>`);
    if (m.open_quality) badges.push(`<span class="pill pill-warn">품질 ${m.open_quality}건</span>`);
    return `<div class="lc-card">
      <div class="lc-top">
        <span class="lc-name">${esc(m.material_name)}</span>
        <span class="pill ${stagePill}">${esc(m.lifecycle_label)}</span>
        ${badges.join('')}
        <span class="lc-edit">
          <button class="lc-mini" data-fc-mat="${m.id}" title="월 수요 입력">수요 입력</button>
          <button class="lc-mini" data-edit-mat="${m.id}" title="소재 수정">수정</button>
        </span>
      </div>
      ${this._ribbon(m.lifecycle_index)}
      <div class="lc-mrow">
        <span>월 수요 <b>${m.monthly_demand ? this._qty(m.monthly_demand, m.demand_unit) : '미정'}</b></span>
        <span>예상 양산 <b>${m.expected_mp_date ? String(m.expected_mp_date).slice(0, 7) : '미정'}</b></span>
        <span>분기 수주확률 <b>${m.win_probability !== null && m.win_probability !== undefined ? m.win_probability + '%' : '-'}</b></span>
        <span>분기 예상수주 <b>${this._won(m.quarter_expected_order)}</b></span>
        ${m.fab_line ? `<span>${esc(m.fab_line)}</span>` : ''}
      </div>
    </div>`;
  },

  _tabDeals() {
    const deals = this._data.deals;
    if (!deals.length) return '<div class="c360-empty">영업기회가 없습니다.</div>';
    return `<table class="data-table">
      <thead><tr><th>프로젝트</th><th>사업유형</th><th>단계</th><th class="text-right">예상매출</th><th class="text-right">확률</th><th class="text-right">가중</th><th>마감</th><th>담당</th></tr></thead>
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
        <div class="c360-tl-meta">${e.date ? String(e.date).slice(0, 10) : ''}${e.amount ? ' · ' + this._won(e.amount) : ''}${e.status ? ' · ' + esc(e.status) : ''}</div>
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
          ? `<div class="c360-sec" style="margin-top:0">핵심 포인트</div>
             <ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;font-size:13px">${kp.map(k => `<li>${esc(k)}</li>`).join('')}</ul>`
          : ''
      }
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${b.next_action ? `<div style="flex:1;min-width:200px;background:rgba(23,168,90,.08);border-left:3px solid #17A85A;padding:10px 12px;border-radius:6px"><div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번 주 즉시 실행</div><div style="font-size:13px;font-weight:600">${esc(b.next_action)}</div></div>` : ''}
        ${b.risk ? `<div style="flex:1;min-width:200px;background:rgba(230,51,41,.08);border-left:3px solid var(--oci-red);padding:10px 12px;border-radius:6px"><div style="font-size:11px;color:var(--text-3);margin-bottom:4px">리스크</div><div style="font-size:13px;font-weight:600">${esc(b.risk)}</div></div>` : ''}
      </div>
    </div>`;
  },

  // ── 포캐스트 탭 (고객/내부 분리 + 버전관리) ──────────────────
  _tabForecast() {
    if (!this._fcData) return '<div id="c360-fc"><div class="c360-empty">포캐스트 불러오는 중…</div></div>';
    return `<div id="c360-fc">${this._renderForecast()}</div>`;
  },

  async _loadForecast() {
    try {
      const res = await API.get(`/customer360/${this._custId}/forecast`);
      this._fcData = res.data;
    } catch (_) {
      this._fcData = { months: this._FC_MONTHS, materials: [], totals: {}, versions: [] };
    }
    const host = document.getElementById('c360-fc');
    if (host) {
      host.innerHTML = this._renderForecast();
      this._bindForecast(host.parentElement || document);
    }
  },

  _renderForecast() {
    const f = this._fcData;
    const months = f.months;
    const verOpts = f.versions
      .map(v => `<option value="${v.id}" ${this._cmpVer && this._cmpVer.version.id === v.id ? 'selected' : ''}>${esc(v.label)} (${String(v.created_at).slice(0, 10)})</option>`)
      .join('');
    const cmp = this._cmpVer ? this._cmpVer.totals : null;

    const totalRows = months
      .map(mn => {
        const t = f.totals[mn] || { customer: 0, internal: 0, capacity: 0, expected: 0 };
        const delta = cmp ? Math.round((t.customer || 0) - (cmp[mn]?.customer || 0)) : null;
        const dtxt =
          delta === null
            ? ''
            : `<td class="text-right" style="color:${delta > 0 ? '#0F7A3F' : delta < 0 ? 'var(--oci-red)' : 'var(--text-3)'}">${delta > 0 ? '+' : ''}${this._qty(delta)}</td>`;
        return `<tr>
          <td>${mn}</td>
          <td class="text-right">${this._qty(t.customer)}</td>
          <td class="text-right">${this._qty(t.internal)}</td>
          <td class="text-right">${this._qty(t.capacity)}</td>
          <td class="text-right">${this._won(t.expected)}</td>
          ${dtxt}
        </tr>`;
      })
      .join('');

    const matBlocks = f.materials.length
      ? f.materials
          .map(m => {
            const rows = months
              .map(mn => {
                const r = m.rows[mn] || {};
                const gap = r.gap;
                return `<tr>
                <td>${mn}</td>
                <td class="text-right">${this._qty(r.customer_forecast)}</td>
                <td class="text-right">${this._qty(r.internal_forecast)}</td>
                <td class="text-right">${r.production_capacity === null ? '-' : this._qty(r.production_capacity)}</td>
                <td class="text-right" style="${gap !== null && gap < 0 ? 'color:var(--oci-red)' : ''}">${gap === null ? '-' : (gap > 0 ? '+' : '') + this._qty(gap)}</td>
                <td class="text-right">${this._won(r.expected_revenue)}</td>
              </tr>`;
              })
              .join('');
            return `<div class="lc-card">
              <div class="lc-top">
                <span class="lc-name">${esc(m.material_name)}</span>
                <span class="pill pill-mut">${esc(m.unit || '')}</span>
                <span class="lc-edit"><button class="lc-mini" data-fc-edit="${m.id}">수요 입력/수정</button></span>
              </div>
              <table class="data-table" style="font-size:12px;margin-top:6px">
                <thead><tr><th>월</th><th class="text-right">고객 Forecast</th><th class="text-right">내부 보정</th><th class="text-right">생산가능</th><th class="text-right">차이</th><th class="text-right">예상매출</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
          })
          .join('')
      : '<div class="c360-empty">등록된 소재가 없습니다. 라이프사이클 탭에서 소재를 추가하세요.</div>';

    return `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-size:12px;color:var(--text-2)">버전 비교</span>
        <select id="fc-ver" style="height:32px;border:1px solid var(--border);border-radius:7px;padding:0 8px;font-size:12px;background:var(--surface);color:var(--text-1)">
          <option value="">현재 (비교 안 함)</option>
          ${verOpts}
        </select>
        <button class="btn btn-ghost btn-sm" id="fc-sync-capa" style="margin-left:auto" title="생산예측 모듈의 수량을 생산가능(CAPA)으로 반영">생산예측 연동(CAPA)</button>
        <button class="btn btn-primary btn-sm" id="fc-snapshot">현재 스냅샷 저장</button>
      </div>
      <div class="c360-sec" style="margin-top:0">월별 합계 ${cmp ? `<span style="font-size:11px;color:var(--text-3);font-weight:500">· Δ고객 = 현재 − ${esc(this._cmpVer.version.label)}</span>` : ''}</div>
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>월</th><th class="text-right">고객 합계</th><th class="text-right">내부 보정</th><th class="text-right">생산가능</th><th class="text-right">예상매출</th>${cmp ? '<th class="text-right">Δ고객</th>' : ''}</tr></thead>
        <tbody>${totalRows}</tbody>
      </table>
      <div class="c360-sec">소재별 상세 (고객 Forecast vs 내부 보정)</div>
      ${matBlocks}
    `;
  },

  _bindForecast(scope) {
    const root = scope || document;
    root.querySelector('#fc-snapshot')?.addEventListener('click', () => this._saveSnapshot());
    root.querySelector('#fc-sync-capa')?.addEventListener('click', () => this._syncCapa());
    root.querySelector('#fc-ver')?.addEventListener('change', e => this._onVersionChange(e.target.value));
    root.querySelectorAll('[data-fc-edit]').forEach(b =>
      b.addEventListener('click', () => {
        const mat = this._fcData.materials.find(m => m.id === Number(b.dataset.fcEdit));
        // 라이프사이클 소재 구조와 호환되도록 unit 매핑
        this._openForecastModal({ id: mat.id, material_name: mat.material_name, demand_unit: mat.unit });
      })
    );
  },

  async _syncCapa() {
    try {
      const res = await API.post(`/customer360/${this._custId}/forecast/sync-capa`, {});
      Toast.success(`생산예측 연동 완료 — ${res.data.updated}건 CAPA 반영`);
      this._fcData = null;
      this._cmpVer = null;
      await this._loadForecast();
    } catch (_) {
      /* Toast */
    }
  },

  async _onVersionChange(vid) {
    if (!vid) {
      this._cmpVer = null;
    } else {
      try {
        const res = await API.get(`/customer360/forecast/versions/${vid}`);
        this._cmpVer = res.data;
      } catch (_) {
        this._cmpVer = null;
      }
    }
    const host = document.getElementById('c360-fc');
    if (host) {
      host.innerHTML = this._renderForecast();
      this._bindForecast(host.parentElement || document);
    }
  },

  _saveSnapshot() {
    Modal.open({
      title: '포캐스트 스냅샷 저장',
      width: 460,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">버전 라벨 *</label>
            <input class="form-input" id="snap-label" placeholder="예: 2026-07 영업 보정본"></div>
          <div class="form-row"><label class="form-label">유형</label>
            <select class="form-input" id="snap-type">
              <option value="baseline">기준(baseline)</option>
              <option value="customer">고객 제출</option>
              <option value="internal">내부 보정</option>
              <option value="production">생산 검토</option>
            </select></div>
          <div class="form-row"><label class="form-label">메모</label>
            <input class="form-input" id="snap-note" placeholder="선택"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="snap-cancel">취소</button><button class="btn btn-primary" id="snap-save">저장</button>`,
      bind: {
        '#snap-cancel': () => Modal.close(),
        '#snap-save': async () => {
          const label = (document.getElementById('snap-label')?.value || '').trim();
          if (!label) {
            Toast.error('버전 라벨을 입력하세요');
            return;
          }
          try {
            await API.post(`/customer360/${this._custId}/forecast/versions`, {
              label,
              version_type: document.getElementById('snap-type')?.value || 'baseline',
              note: document.getElementById('snap-note')?.value || null,
            });
            Toast.success('스냅샷 저장 완료');
            Modal.close();
            this._fcData = null;
            this._tab = 'forecast';
            await this._loadForecast();
            // 탭 본문 재렌더 보장
            this._renderTab();
          } catch (_) {
            /* Toast 처리 */
          }
        },
      },
    });
  },

  // ── 샘플/평가 탭 ─────────────────────────────────────────
  _SMP_STATUS: {
    requested: '요청', sent: '발송', evaluating: '평가중', passed: '승인', conditional: '조건부', failed: '불합격',
  },
  _matOptions(selId) {
    const mats = (this._data && this._data.lifecycle && this._data.lifecycle.materials) || [];
    return (
      '<option value="">(소재 미지정)</option>' +
      mats
        .map(m => `<option value="${m.id}" ${selId === m.id ? 'selected' : ''}>${esc(m.material_name)}</option>`)
        .join('')
    );
  },
  _tabSamples() {
    if (!this._samples) return '<div id="c360-smp"><div class="c360-empty">불러오는 중…</div></div>';
    return `<div id="c360-smp">${this._renderSamples()}</div>`;
  },
  async _loadSamples() {
    try {
      const res = await API.get(`/customer360/${this._custId}/samples`);
      this._samples = res.data || [];
    } catch (_) {
      this._samples = [];
    }
    const host = document.getElementById('c360-smp');
    if (host) {
      host.innerHTML = this._renderSamples();
      this._bindSamples(host.parentElement || document);
    }
  },
  _renderSamples() {
    const list = this._samples;
    const table = list.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr>
          <th>샘플번호</th><th>소재</th><th>목적</th><th>Lot</th><th>발송일</th><th>상태</th><th>결과</th><th></th>
        </tr></thead><tbody>
        ${list
          .map(s => {
            const st = this._SMP_STATUS[s.status] || s.status;
            const cls = s.status === 'passed' ? 'pill-info' : s.status === 'failed' ? 'pill-danger' : s.status === 'conditional' ? 'pill-warn' : 'pill-mut';
            return `<tr>
            <td class="mono">${esc(s.sample_no)}</td>
            <td>${esc(s.material_name ? s.material_name.split(' · ')[0] : '-')}</td>
            <td>${esc(s.purpose || '-')}</td>
            <td class="mono">${esc(s.lot_no || '-')}</td>
            <td>${s.sent_at ? String(s.sent_at).slice(0, 10) : '-'}</td>
            <td><span class="pill ${cls}">${esc(st)}</span></td>
            <td>${esc(s.result || '-')}</td>
            <td style="text-align:right"><button class="lc-mini" data-smp-edit="${s.id}">수정</button></td>
          </tr>`;
          })
          .join('')}
        </tbody></table>`
      : '<div class="c360-empty">등록된 샘플 요청이 없습니다.</div>';
    return `<div class="c360-sec" style="margin-top:0">샘플/평가 이력
        <button class="btn btn-primary btn-sm btn-add" id="smp-add">+ 샘플 등록</button>
      </div>${table}`;
  },
  _bindSamples(scope) {
    const root = scope || document;
    root.querySelector('#smp-add')?.addEventListener('click', () => this._openSampleModal(null));
    root.querySelectorAll('[data-smp-edit]').forEach(b =>
      b.addEventListener('click', () => this._openSampleModal(this._samples.find(s => s.id === Number(b.dataset.smpEdit))))
    );
  },
  _openSampleModal(s) {
    const stOpts = Object.entries(this._SMP_STATUS)
      .map(([k, l]) => `<option value="${k}" ${s && s.status === k ? 'selected' : ''}>${l}</option>`)
      .join('');
    Modal.open({
      title: s ? '샘플 수정' : '샘플 등록',
      width: 520,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">소재</label>
            <select class="form-input" id="s-mat">${this._matOptions(s ? s.customer_material_id : null)}</select></div>
          <div class="form-row"><label class="form-label">목적 *</label>
            <input class="form-input" id="s-purpose" value="${s ? esc(s.purpose || '') : ''}" placeholder="고객 평가용 초도 샘플"></div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">Lot No</label><input class="form-input" id="s-lot" value="${s ? esc(s.lot_no || '') : ''}"></div>
            <div class="form-row"><label class="form-label">발송일</label><input class="form-input" id="s-sent" type="date" value="${s && s.sent_at ? String(s.sent_at).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">상태</label><select class="form-input" id="s-status">${stOpts}</select></div>
          </div>
          <div class="form-row"><label class="form-label">결과/비고</label><input class="form-input" id="s-result" value="${s ? esc(s.result || '') : ''}"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="s-cancel">취소</button><button class="btn btn-primary" id="s-save">저장</button>`,
      bind: { '#s-cancel': () => Modal.close(), '#s-save': () => this._saveSample(s) },
    });
  },
  async _saveSample(s) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const payload = {
      customer_material_id: v('s-mat') || null,
      purpose: v('s-purpose'),
      lot_no: v('s-lot') || null,
      sent_at: v('s-sent') || null,
      status: v('s-status'),
      result: v('s-result') || null,
    };
    if (!payload.purpose && !payload.customer_material_id) {
      Toast.error('목적 또는 소재를 입력하세요');
      return;
    }
    try {
      if (s) await API.put(`/customer360/samples/${s.id}`, payload);
      else await API.post(`/customer360/${this._custId}/samples`, payload);
      Toast.success(s ? '샘플 수정 완료' : '샘플 등록 완료');
      Modal.close();
      this._samples = null;
      await this._select(this._custId);
      this._tab = 'samples';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 품질 탭 ───────────────────────────────────────────────
  _Q_STATUS: { open: '미해결', in_progress: '처리중', resolved: '완료' },
  _tabQuality() {
    if (!this._quality) return '<div id="c360-q"><div class="c360-empty">불러오는 중…</div></div>';
    return `<div id="c360-q">${this._renderQuality()}</div>`;
  },
  async _loadQuality() {
    try {
      const res = await API.get(`/customer360/${this._custId}/quality`);
      this._quality = res.data || [];
    } catch (_) {
      this._quality = [];
    }
    const host = document.getElementById('c360-q');
    if (host) {
      host.innerHTML = this._renderQuality();
      this._bindQuality(host.parentElement || document);
    }
  },
  _renderQuality() {
    const list = this._quality;
    const table = list.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr>
          <th>케이스</th><th>소재</th><th>유형</th><th>심각도</th><th>상태</th><th>제목</th><th>발생일</th><th></th>
        </tr></thead><tbody>
        ${list
          .map(q => {
            const sevCls = q.severity === 'high' ? 'pill-danger' : q.severity === 'medium' ? 'pill-warn' : 'pill-mut';
            const stCls = q.status === 'resolved' ? 'pill-info' : q.status === 'in_progress' ? 'pill-warn' : 'pill-danger';
            return `<tr>
            <td class="mono">${esc(q.case_no)}</td>
            <td>${esc(q.material_name ? q.material_name.split(' · ')[0] : '-')}</td>
            <td>${esc(q.type)}</td>
            <td><span class="pill ${sevCls}">${esc(q.severity)}</span></td>
            <td><span class="pill ${stCls}">${esc(this._Q_STATUS[q.status] || q.status)}</span></td>
            <td>${esc(q.title)}</td>
            <td>${q.opened_at ? String(q.opened_at).slice(0, 10) : '-'}</td>
            <td style="text-align:right"><button class="lc-mini" data-q-edit="${q.id}">수정</button></td>
          </tr>`;
          })
          .join('')}
        </tbody></table>`
      : '<div class="c360-empty">등록된 품질 케이스가 없습니다.</div>';
    return `<div class="c360-sec" style="margin-top:0">품질 케이스 (VOC/NCR/Audit)
        <button class="btn btn-primary btn-sm btn-add" id="q-add">+ 케이스 등록</button>
      </div>${table}`;
  },
  _bindQuality(scope) {
    const root = scope || document;
    root.querySelector('#q-add')?.addEventListener('click', () => this._openQualityModal(null));
    root.querySelectorAll('[data-q-edit]').forEach(b =>
      b.addEventListener('click', () => this._openQualityModal(this._quality.find(q => q.id === Number(b.dataset.qEdit))))
    );
  },
  _openQualityModal(q) {
    const sel = (cur, arr) => arr.map(o => `<option value="${o}" ${cur === o ? 'selected' : ''}>${o}</option>`).join('');
    const stOpts = Object.entries(this._Q_STATUS)
      .map(([k, l]) => `<option value="${k}" ${q && q.status === k ? 'selected' : ''}>${l}</option>`)
      .join('');
    Modal.open({
      title: q ? '품질 케이스 수정' : '품질 케이스 등록',
      width: 520,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">제목 *</label>
            <input class="form-input" id="q-title" value="${q ? esc(q.title) : ''}" placeholder="순도 편차 클레임"></div>
          <div class="form-row"><label class="form-label">소재</label>
            <select class="form-input" id="q-mat">${this._matOptions(q ? q.customer_material_id : null)}</select></div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">유형</label><select class="form-input" id="q-type">${sel(q ? q.type : 'VOC', ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'])}</select></div>
            <div class="form-row"><label class="form-label">심각도</label><select class="form-input" id="q-sev">${sel(q ? q.severity : 'medium', ['high', 'medium', 'low'])}</select></div>
            <div class="form-row"><label class="form-label">상태</label><select class="form-input" id="q-status">${stOpts}</select></div>
          </div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">발생일</label><input class="form-input" id="q-opened" type="date" value="${q && q.opened_at ? String(q.opened_at).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">비고</label><input class="form-input" id="q-notes" value="${q ? esc(q.notes || '') : ''}"></div>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="q-cancel">취소</button><button class="btn btn-primary" id="q-save">저장</button>`,
      bind: { '#q-cancel': () => Modal.close(), '#q-save': () => this._saveQuality(q) },
    });
  },
  async _saveQuality(q) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const title = v('q-title');
    if (!title) {
      Toast.error('제목을 입력하세요');
      return;
    }
    const payload = {
      title,
      customer_material_id: v('q-mat') || null,
      type: v('q-type'),
      severity: v('q-sev'),
      status: v('q-status'),
      opened_at: v('q-opened') || null,
      notes: v('q-notes') || null,
    };
    try {
      if (q) await API.put(`/customer360/quality/${q.id}`, payload);
      else await API.post(`/customer360/${this._custId}/quality`, payload);
      Toast.success(q ? '케이스 수정 완료' : '케이스 등록 완료');
      Modal.close();
      this._quality = null;
      await this._select(this._custId);
      this._tab = 'quality';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 조직 탭 (사업장 / 담당자) ────────────────────────────
  _ROLES: ['구매', '기술', '품질', 'SCM', '기타'],
  _tabOrg() {
    const org = this._data.organization || { sites: [], contacts: [] };
    const sites = org.sites.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>사업장</th><th>라인</th><th>공정</th><th>지역</th><th></th></tr></thead><tbody>
          ${org.sites
            .map(s => `<tr><td><strong>${esc(s.site_name)}</strong></td><td>${esc(s.line || '-')}</td><td>${esc(s.process || '-')}</td><td>${esc(s.region || '-')}</td>
              <td style="text-align:right"><button class="lc-mini" data-site-edit="${s.id}">수정</button><button class="lc-mini" data-site-del="${s.id}" style="color:var(--oci-red)">삭제</button></td></tr>`)
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">등록된 사업장이 없습니다.</div>';
    const contacts = org.contacts.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>이름</th><th>역할</th><th>부서</th><th>이메일</th><th>연락처</th><th></th></tr></thead><tbody>
          ${org.contacts
            .map(c => `<tr><td><strong>${esc(c.name)}</strong>${c.is_primary ? ' <span class="pill pill-info">주</span>' : ''}</td><td>${esc(c.role || '-')}</td><td>${esc(c.dept || '-')}</td><td class="mono" style="font-size:11px">${esc(c.email || '-')}</td><td class="mono">${esc(c.phone || '-')}</td>
              <td style="text-align:right"><button class="lc-mini" data-ct-edit="${c.id}">수정</button><button class="lc-mini" data-ct-del="${c.id}" style="color:var(--oci-red)">삭제</button></td></tr>`)
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">등록된 담당자가 없습니다.</div>';
    return `
      <div class="c360-sec" style="margin-top:0">사업장 / Fab / 라인
        <button class="btn btn-primary btn-sm btn-add" id="site-add">+ 사업장</button>
      </div>${sites}
      <div class="c360-sec">담당자 (구매/기술/품질/SCM)
        <button class="btn btn-primary btn-sm btn-add" id="ct-add">+ 담당자</button>
      </div>${contacts}`;
  },
  _bindOrg(scope) {
    const root = scope || document;
    const org = this._data.organization || { sites: [], contacts: [] };
    root.querySelector('#site-add')?.addEventListener('click', () => this._openSiteModal(null));
    root.querySelector('#ct-add')?.addEventListener('click', () => this._openContactModal(null));
    root.querySelectorAll('[data-site-edit]').forEach(b =>
      b.addEventListener('click', () => this._openSiteModal(org.sites.find(s => s.id === Number(b.dataset.siteEdit))))
    );
    root.querySelectorAll('[data-site-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteOrg('sites', Number(b.dataset.siteDel)))
    );
    root.querySelectorAll('[data-ct-edit]').forEach(b =>
      b.addEventListener('click', () => this._openContactModal(org.contacts.find(c => c.id === Number(b.dataset.ctEdit))))
    );
    root.querySelectorAll('[data-ct-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteOrg('contacts', Number(b.dataset.ctDel)))
    );
  },
  async _deleteOrg(kind, id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await API.del(`/customer360/${kind}/${id}`);
      Toast.success('삭제 완료');
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },
  _openSiteModal(s) {
    Modal.open({
      title: s ? '사업장 수정' : '사업장 추가',
      width: 480,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">사업장명 *</label><input class="form-input" id="st-name" value="${s ? esc(s.site_name) : ''}" placeholder="평택"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">라인</label><input class="form-input" id="st-line" value="${s ? esc(s.line || '') : ''}" placeholder="P3"></div>
            <div class="form-row"><label class="form-label">공정</label><input class="form-input" id="st-proc" value="${s ? esc(s.process || '') : ''}" placeholder="식각/증착"></div>
          </div>
          <div class="form-row"><label class="form-label">지역</label><input class="form-input" id="st-region" value="${s ? esc(s.region || '') : ''}"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="st-cancel">취소</button><button class="btn btn-primary" id="st-save">저장</button>`,
      bind: { '#st-cancel': () => Modal.close(), '#st-save': () => this._saveSite(s) },
    });
  },
  async _saveSite(s) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('st-name');
    if (!name) {
      Toast.error('사업장명을 입력하세요');
      return;
    }
    const payload = { site_name: name, line: v('st-line') || null, process: v('st-proc') || null, region: v('st-region') || null };
    try {
      if (s) await API.put(`/customer360/sites/${s.id}`, payload);
      else await API.post(`/customer360/${this._custId}/sites`, payload);
      Toast.success('저장 완료');
      Modal.close();
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },
  _openContactModal(c) {
    const roleOpts = this._ROLES.map(r => `<option value="${r}" ${c && c.role === r ? 'selected' : ''}>${r}</option>`).join('');
    Modal.open({
      title: c ? '담당자 수정' : '담당자 추가',
      width: 480,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">이름 *</label><input class="form-input" id="ct-name" value="${c ? esc(c.name) : ''}"></div>
            <div class="form-row"><label class="form-label">역할</label><select class="form-input" id="ct-role">${roleOpts}</select></div>
          </div>
          <div class="form-row"><label class="form-label">부서</label><input class="form-input" id="ct-dept" value="${c ? esc(c.dept || '') : ''}"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">이메일</label><input class="form-input" id="ct-email" value="${c ? esc(c.email || '') : ''}"></div>
            <div class="form-row"><label class="form-label">연락처</label><input class="form-input" id="ct-phone" value="${c ? esc(c.phone || '') : ''}"></div>
          </div>
          <label class="form-label" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ct-primary" ${c && c.is_primary ? 'checked' : ''}> 대표 담당자</label>
        </div>`,
      footer: `<button class="btn btn-ghost" id="ct-cancel">취소</button><button class="btn btn-primary" id="ct-save">저장</button>`,
      bind: { '#ct-cancel': () => Modal.close(), '#ct-save': () => this._saveContact(c) },
    });
  },
  async _saveContact(c) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('ct-name');
    if (!name) {
      Toast.error('이름을 입력하세요');
      return;
    }
    const payload = {
      name,
      role: v('ct-role'),
      dept: v('ct-dept') || null,
      email: v('ct-email') || null,
      phone: v('ct-phone') || null,
      is_primary: document.getElementById('ct-primary')?.checked ? 1 : 0,
    };
    try {
      if (c) await API.put(`/customer360/contacts/${c.id}`, payload);
      else await API.post(`/customer360/${this._custId}/contacts`, payload);
      Toast.success('저장 완료');
      Modal.close();
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 편집 모달 ─────────────────────────────────────────────
  _openMaterialModal(mat) {
    const isEdit = !!mat;
    const stageOpts = this._STAGES.map(
      ([k, l]) => `<option value="${k}" ${mat && mat.lifecycle_stage === k ? 'selected' : ''}>${l}</option>`
    ).join('');
    Modal.open({
      title: isEdit ? '소재 수정' : '소재 추가',
      width: 520,
      compact: true,
      body: `
        <div class="form-grid">
          <div class="form-row"><label class="form-label">소재명 *</label>
            <input class="form-input" id="m-name" value="${mat ? esc(mat.material_name) : ''}" placeholder="예: 식각가스 C4F6"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">사업유형</label>
              <input class="form-input" id="m-biz" value="${mat ? esc(mat.business_type || '') : ''}" placeholder="식각가스/프리커서…"></div>
            <div class="form-row"><label class="form-label">Fab/라인/공정</label>
              <input class="form-input" id="m-fab" value="${mat ? esc(mat.fab_line || '') : ''}" placeholder="평택 P3 식각"></div>
          </div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">라이프사이클 단계</label>
              <select class="form-input" id="m-stage">${stageOpts}</select></div>
            <div class="form-row"><label class="form-label">월 수요</label>
              <input class="form-input" id="m-demand" type="number" value="${mat && mat.monthly_demand ? mat.monthly_demand : ''}"></div>
            <div class="form-row"><label class="form-label">단위</label>
              <input class="form-input" id="m-unit" value="${mat ? esc(mat.demand_unit || 'kg') : 'kg'}"></div>
          </div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">예상 양산일</label>
              <input class="form-input" id="m-mp" type="date" value="${mat && mat.expected_mp_date ? String(mat.expected_mp_date).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">수주확률(%)</label>
              <input class="form-input" id="m-prob" type="number" min="0" max="100" value="${mat && mat.win_probability !== null && mat.win_probability !== undefined ? mat.win_probability : ''}"></div>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="m-cancel">취소</button><button class="btn btn-primary" id="m-save">저장</button>`,
      bind: {
        '#m-cancel': () => Modal.close(),
        '#m-save': () => this._saveMaterial(mat),
      },
    });
  },

  async _saveMaterial(mat) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('m-name');
    if (!name) {
      Toast.error('소재명을 입력하세요');
      return;
    }
    const payload = {
      material_name: name,
      business_type: v('m-biz') || null,
      fab_line: v('m-fab') || null,
      lifecycle_stage: v('m-stage'),
      monthly_demand: v('m-demand') || null,
      demand_unit: v('m-unit') || 'kg',
      expected_mp_date: v('m-mp') || null,
      win_probability: v('m-prob') || null,
    };
    try {
      if (mat) await API.put(`/customer360/materials/${mat.id}`, payload);
      else await API.post('/customer360/materials', { ...payload, customer_id: this._custId });
      Toast.success(mat ? '소재 수정 완료' : '소재 추가 완료');
      Modal.close();
      await this._reload();
    } catch (_) {
      /* Toast 처리 */
    }
  },

  _openForecastModal(mat) {
    const months = this._FC_MONTHS;
    const rows = months
      .map(
        mn => `<tr>
          <td style="padding:4px 6px;font-weight:600">${mn}</td>
          <td><input class="form-input" data-fc="cust" data-mn="${mn}" type="number" placeholder="고객 수요" style="height:32px"></td>
          <td><input class="form-input" data-fc="capa" data-mn="${mn}" type="number" placeholder="생산가능" style="height:32px"></td>
          <td><input class="form-input" data-fc="rev" data-mn="${mn}" type="number" placeholder="예상매출(원)" style="height:32px"></td>
        </tr>`
      )
      .join('');
    Modal.open({
      title: `월 수요/생산 입력 — ${mat.material_name.split(' · ')[0]}`,
      width: 560,
      compact: true,
      body: `<table style="width:100%;font-size:12px"><thead><tr>
          <th style="text-align:left;padding:4px 6px">월</th><th>고객 수요(${esc(mat.demand_unit || '')})</th><th>생산가능</th><th>예상매출(원)</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:11px;color:var(--text-3);margin-top:8px">입력한 월만 저장됩니다(빈 행은 건너뜀).</div>`,
      footer: `<button class="btn btn-ghost" id="fc-cancel">취소</button><button class="btn btn-primary" id="fc-save">저장</button>`,
      bind: {
        '#fc-cancel': () => Modal.close(),
        '#fc-save': () => this._saveForecast(mat),
      },
    });
  },

  async _saveForecast(mat) {
    const months = this._FC_MONTHS;
    const get = (type, mn) =>
      document.querySelector(`[data-fc="${type}"][data-mn="${mn}"]`)?.value || '';
    let saved = 0;
    try {
      for (const mn of months) {
        const cust = get('cust', mn);
        const capa = get('capa', mn);
        const rev = get('rev', mn);
        if (!cust && !capa && !rev) continue;
        await API.post('/customer360/forecasts', {
          customer_material_id: mat.id,
          customer_id: this._custId,
          month: mn,
          customer_forecast: cust || 0,
          internal_forecast: cust || 0,
          production_capacity: capa || null,
          win_probability: mat.win_probability ?? null,
          expected_revenue: rev || 0,
          unit: mat.demand_unit || 'kg',
        });
        saved += 1;
      }
      if (!saved) {
        Toast.warn('입력된 값이 없습니다');
        return;
      }
      Toast.success(`${saved}개월 수요 저장 완료`);
      Modal.close();
      this._fcData = null;
      await this._reload();
    } catch (_) {
      /* Toast 처리 */
    }
  },
};
