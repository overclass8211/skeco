'use strict';
// =============================================================
// FcstScPage — 반도체 수급 FCST 대시보드 (Phase 3)
//   메인: 월별 수요량·공급량(L) vs 기대매출 그래프 (이중축)
//   위젯: 충족률 / 제품 믹스 / 고객 Top — 표시/숨김 토글(localStorage)
//   로데이터: 접기형 테이블 (FCST 월별 스프레드, 지표 토글)
//   통화: $ / ₩ 전환
//   데이터: /api/forecast-sc (monthly·summary·demand)
// =============================================================
const FcstScPage = {
  FX: 1380, // USD→KRW 환산(MVP 고정 — 후속: 시스템 설정)
  _year: null,
  _cur: 'USD', // 'USD' | 'KRW'
  _metric: 'demand', // 로데이터 지표: demand | supply | revenue
  _monthly: null,
  _summary: null,
  _rows: [],
  _widgets: { fulfill: true, mix: false, cust: false },
  _charts: {},

  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  _cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  },

  // ── 통화 환산 헬퍼 (매출 raw$ → 표시단위) ───────────────────
  _revVal(rawUsd) {
    // USD: 백만달러(M$) / KRW: 억원
    return this._cur === 'USD'
      ? Math.round((Number(rawUsd) || 0) / 1e6)
      : Math.round(((Number(rawUsd) || 0) * this.FX) / 1e8);
  },
  _revUnit() {
    return this._cur === 'USD' ? 'M$' : '억원';
  },
  // KPI 매출 풀 표기
  _revKpi(rawUsd) {
    return this._cur === 'USD'
      ? '$' + this._revVal(rawUsd).toLocaleString('ko-KR') + 'M'
      : '₩' + this._revVal(rawUsd).toLocaleString('ko-KR') + '억';
  },

  async render() {
    if (!this._year) this._year = new Date().getFullYear();
    // 위젯 표시 설정 복원
    try {
      const saved = JSON.parse(localStorage.getItem('fcstsc.widgets') || 'null');
      if (saved) this._widgets = { ...this._widgets, ...saved };
    } catch (_) { /* noop */ }

    const yearOpts = [this._year + 1, this._year, this._year - 1].filter((v, i, a) => a.indexOf(v) === i);

    document.getElementById('content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <h2 style="font-size:18px;font-weight:700;margin:0">반도체 수급 FCST</h2>
          <span style="font-size:12px;color:var(--text-3)">MI 수요 → 생산 Capa → FCST 매출 · 출하 = MIN(수요, 유효Capa)</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="filter-select" id="fsc-year">
            ${yearOpts.map(y => `<option value="${y}" ${y === this._year ? 'selected' : ''}>${y}년</option>`).join('')}
          </select>
          <div class="fsc-seg" id="fsc-cur" style="display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden">
            <button data-cur="USD" class="${this._cur === 'USD' ? 'on' : ''}">$ USD</button>
            <button data-cur="KRW" class="${this._cur === 'KRW' ? 'on' : ''}">₩ 원</button>
          </div>
        </div>
      </div>

      <div id="fsc-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px"></div>

      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);border-radius:8px;padding:9px 12px;margin-bottom:14px">
        <span style="font-size:12px;color:var(--text-3)">위젯 표시</span>
        <label style="font-size:13px;display:inline-flex;align-items:center;gap:5px;color:var(--text-3)"><input type="checkbox" checked disabled> 메인 그래프</label>
        <label style="font-size:13px;display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="fsc-wtoggle" data-w="fulfill" ${this._widgets.fulfill ? 'checked' : ''}> 충족률 추이</label>
        <label style="font-size:13px;display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="fsc-wtoggle" data-w="mix" ${this._widgets.mix ? 'checked' : ''}> 제품 믹스</label>
        <label style="font-size:13px;display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="fsc-wtoggle" data-w="cust" ${this._widgets.cust ? 'checked' : ''}> 고객 Top</label>
      </div>

      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--text-2);margin-bottom:10px">
        <span style="display:inline-flex;align-items:center;gap:7px"><i style="width:13px;height:13px;border-radius:3px;background:#378ADD;display:inline-block"></i>수요량(L)</span>
        <span style="display:inline-flex;align-items:center;gap:7px"><i style="width:13px;height:13px;border-radius:3px;background:#1D9E75;display:inline-block"></i>공급량(L)</span>
        <span style="display:inline-flex;align-items:center;gap:7px"><i style="width:22px;border-top:3px solid var(--oci-red);display:inline-block"></i>기대매출(<span id="fsc-rev-unit">M$</span>)</span>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">
        <div style="position:relative;height:300px"><canvas id="fsc-main"></canvas></div>
      </div>

      <div id="fsc-w-fulfill" style="margin-bottom:16px;${this._widgets.fulfill ? '' : 'display:none'}">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;font-weight:600">월별 수요 충족률 (%)</div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px"><div style="position:relative;height:130px"><canvas id="fsc-fulfill"></canvas></div></div>
      </div>
      <div id="fsc-w-mix" style="margin-bottom:16px;${this._widgets.mix ? '' : 'display:none'}">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;font-weight:600">제품별 연간 수요 믹스 (L)</div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px"><div style="position:relative;height:170px"><canvas id="fsc-mix"></canvas></div></div>
      </div>
      <div id="fsc-w-cust" style="margin-bottom:16px;${this._widgets.cust ? '' : 'display:none'}">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;font-weight:600">고객 Top — 연간 기대매출</div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px"><div style="position:relative;height:170px"><canvas id="fsc-cust"></canvas></div></div>
      </div>

      <button id="fsc-fold" style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;padding:11px 13px;font-size:14px;cursor:pointer;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-1)">
        <span id="fsc-fold-ic">▶</span> 로데이터 보기 — FCST 월별 스프레드 (고객 × 제품)
      </button>
      <div id="fsc-table-box" style="display:none;border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px">
        <div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-3)">지표</span>
          <div class="fsc-seg" id="fsc-metric" style="display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden">
            <button data-m="demand" class="on">수요량</button>
            <button data-m="supply">공급량</button>
            <button data-m="revenue">기대매출</button>
          </div>
        </div>
        <div id="fsc-table" style="overflow-x:auto"></div>
      </div>
    `;

    this._injectStyleOnce();
    this._bind();
    await this._load();
  },

  _injectStyleOnce() {
    if (document.getElementById('fsc-style')) return;
    const st = document.createElement('style');
    st.id = 'fsc-style';
    st.textContent = `
      .fsc-seg button{border:none;background:transparent;padding:6px 13px;font-size:13px;cursor:pointer;color:var(--text-3)}
      .fsc-seg button.on{background:var(--bg);color:var(--text-1);font-weight:600}
      #fsc-table table{border-collapse:collapse;font-size:12.5px;min-width:780px;width:100%}
      #fsc-table th,#fsc-table td{padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap;text-align:right}
      #fsc-table th{color:var(--text-3);font-weight:600;font-size:11.5px;background:var(--surface)}
      #fsc-table th:first-child,#fsc-table td:first-child{text-align:left;position:sticky;left:0;background:var(--surface)}
      .fsc-badge{font-size:10.5px;padding:2px 7px;border-radius:5px}
    `;
    document.head.appendChild(st);
  },

  _bind() {
    document.getElementById('fsc-year').addEventListener('change', (e) => {
      this._year = parseInt(e.target.value, 10);
      this._load();
    });
    document.querySelectorAll('#fsc-cur button').forEach((b) => {
      b.addEventListener('click', () => {
        this._cur = b.dataset.cur;
        document.querySelectorAll('#fsc-cur button').forEach((x) => x.classList.toggle('on', x === b));
        document.getElementById('fsc-rev-unit').textContent = this._revUnit();
        this._renderKpis();
        this._renderMain();
        this._renderCust();
        if (this._metric === 'revenue') this._renderTable();
      });
    });
    document.querySelectorAll('.fsc-wtoggle').forEach((c) => {
      c.addEventListener('change', () => {
        const w = c.dataset.w;
        this._widgets[w] = c.checked;
        localStorage.setItem('fcstsc.widgets', JSON.stringify(this._widgets));
        const box = document.getElementById('fsc-w-' + w);
        if (box) box.style.display = c.checked ? '' : 'none';
        if (c.checked) {
          if (w === 'fulfill') this._renderFulfill();
          if (w === 'mix') this._renderMix();
          if (w === 'cust') this._renderCust();
        }
      });
    });
    document.querySelectorAll('#fsc-metric button').forEach((b) => {
      b.addEventListener('click', () => {
        this._metric = b.dataset.m;
        document.querySelectorAll('#fsc-metric button').forEach((x) => x.classList.toggle('on', x === b));
        this._renderTable();
      });
    });
    document.getElementById('fsc-fold').addEventListener('click', () => {
      const box = document.getElementById('fsc-table-box');
      const open = box.style.display === 'none';
      box.style.display = open ? '' : 'none';
      document.getElementById('fsc-fold-ic').textContent = open ? '▼' : '▶';
      if (open) this._renderTable();
    });
  },

  async _load() {
    try {
      const [sumR, monR, demR] = await Promise.all([
        API.forecastSC.summary(this._year),
        API.forecastSC.monthly(this._year),
        API.forecastSC.demand({ year: this._year }),
      ]);
      this._summary = sumR.data || {};
      this._monthly = monR.data || {};
      this._rows = demR.data || [];
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error('수급 FCST 로드 실패: ' + (e.message || e));
      return;
    }
    this._renderKpis();
    this._renderMain();
    if (this._widgets.fulfill) this._renderFulfill();
    if (this._widgets.mix) this._renderMix();
    if (this._widgets.cust) this._renderCust();
    const box = document.getElementById('fsc-table-box');
    if (box && box.style.display !== 'none') this._renderTable();
  },

  _renderKpis() {
    const s = this._summary || {};
    const cards = [
      { lbl: '연간 FCST 매출', val: this._revKpi(s.annual_revenue), sub: '출하 × 판가' },
      { lbl: '연간 소재 수요', val: (Math.round(s.annual_demand || 0)).toLocaleString('ko-KR') + ' L', sub: 'MI 집계' },
      { lbl: '연간 출하량', val: (Math.round(s.annual_supply || 0)).toLocaleString('ko-KR') + ' L', sub: 'Capa 제약 반영' },
      { lbl: '수요 충족률', val: (s.fulfillment_rate || 0) + '%', sub: '출하 / 수요' },
    ];
    document.getElementById('fsc-kpis').innerHTML = cards.map(c => `
      <div style="background:var(--bg);border-radius:8px;padding:13px 14px">
        <div style="font-size:12.5px;color:var(--text-3)">${c.lbl}</div>
        <div style="font-size:22px;font-weight:700;margin-top:5px;color:var(--text-1)">${this._esc(c.val)}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">${c.sub}</div>
      </div>`).join('');
  },

  _renderMain() {
    const m = this._monthly || {};
    const ctx = document.getElementById('fsc-main');
    if (!ctx || typeof Chart === 'undefined') return;
    if (this._charts.main) this._charts.main.destroy();
    const grid = this._cssVar('--border', 'rgba(0,0,0,0.08)');
    const txt = this._cssVar('--text-3', '#86909C');
    const red = this._cssVar('--oci-red', '#EA002C');
    const revData = (m.revenue || []).map(v => this._revVal(v));
    this._charts.main = new Chart(ctx, {
      data: {
        labels: m.months || [],
        datasets: [
          { type: 'bar', label: '수요량', data: m.demand || [], backgroundColor: 'rgba(55,138,221,0.55)', yAxisID: 'y', order: 3 },
          { type: 'bar', label: '공급량', data: m.supply || [], backgroundColor: 'rgba(29,158,117,0.75)', yAxisID: 'y', order: 2 },
          { type: 'line', label: '기대매출', data: revData, borderColor: red, backgroundColor: red, borderWidth: 2.5, tension: 0.35, pointRadius: 2, yAxisID: 'y1', order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => c.dataset.yAxisID === 'y1'
                ? `기대매출: ${c.parsed.y.toLocaleString('ko-KR')} ${this._revUnit()}`
                : `${c.dataset.label}: ${c.parsed.y.toLocaleString('ko-KR')} L`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: txt, font: { size: 11 } } },
          y: { position: 'left', grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: v => (v / 1000) + 'K' }, title: { display: true, text: '수량(L)', color: txt, font: { size: 10 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: this._cssVar('--oci-red', '#EA002C'), font: { size: 10 } }, title: { display: true, text: this._revUnit(), color: this._cssVar('--oci-red', '#EA002C'), font: { size: 10 } } },
        },
      },
    });
  },

  _renderFulfill() {
    const m = this._monthly || {};
    const ctx = document.getElementById('fsc-fulfill');
    if (!ctx || typeof Chart === 'undefined') return;
    if (this._charts.fulfill) this._charts.fulfill.destroy();
    const txt = this._cssVar('--text-3', '#86909C');
    this._charts.fulfill = new Chart(ctx, {
      type: 'line',
      data: { labels: m.months || [], datasets: [{ data: m.fulfillment || [], borderColor: '#BA7517', backgroundColor: 'rgba(186,117,23,0.12)', borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '%' } } }, scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 } } }, y: { min: 80, max: 100, grid: { color: this._cssVar('--border', 'rgba(0,0,0,0.06)') }, ticks: { color: txt, font: { size: 10 }, callback: v => v + '%' } } } },
    });
  },

  _aggByProduct() {
    const map = {};
    for (const r of this._rows) map[r.product_name] = (map[r.product_name] || 0) + Number(r.demand_qty || 0);
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  },
  _aggByCustomer() {
    const map = {};
    for (const r of this._rows) map[r.customer_name] = (map[r.customer_name] || 0) + Number(r.expected_revenue || 0);
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  },

  _renderMix() {
    const ctx = document.getElementById('fsc-mix');
    if (!ctx || typeof Chart === 'undefined') return;
    if (this._charts.mix) this._charts.mix.destroy();
    const data = this._aggByProduct();
    this._charts.mix = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => d[1]), backgroundColor: ['#378ADD', '#1D9E75', '#BA7517', '#D4537E', '#7F77DD', '#888780'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: this._cssVar('--text-2', '#4E5969'), font: { size: 11 }, boxWidth: 12 } } } },
    });
  },

  _renderCust() {
    const ctx = document.getElementById('fsc-cust');
    if (!ctx || typeof Chart === 'undefined') return;
    if (this._charts.cust) this._charts.cust.destroy();
    const data = this._aggByCustomer();
    const txt = this._cssVar('--text-3', '#86909C');
    this._charts.cust = new Chart(ctx, {
      type: 'bar',
      data: { labels: data.map(d => d[0]), datasets: [{ data: data.map(d => this._revVal(d[1])), backgroundColor: '#185FA5' }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.x.toLocaleString('ko-KR') + ' ' + this._revUnit() } } }, scales: { x: { grid: { color: this._cssVar('--border', 'rgba(0,0,0,0.06)') }, ticks: { color: txt, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: txt, font: { size: 11 } } } } },
    });
  },

  // 로데이터 피벗 (고객·제품 × 12개월, 선택 지표)
  _renderTable() {
    const el = document.getElementById('fsc-table');
    if (!el) return;
    const months = this._monthly?.months || Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    const field = this._metric === 'supply' ? 'supply_qty' : this._metric === 'revenue' ? 'expected_revenue' : 'demand_qty';
    const isRev = this._metric === 'revenue';
    // 그룹: 고객|제품 → [12개월]
    const groups = {};
    for (const r of this._rows) {
      const key = `${r.customer_name}|||${r.product_name}|||${r.demand_source}|||${r.region || ''}`;
      if (!groups[key]) groups[key] = Array(12).fill(0);
      const mi = parseInt(String(r.period).slice(5, 7), 10) - 1;
      if (mi >= 0 && mi < 12) groups[key][mi] += Number(r[field] || 0);
    }
    const fmt = (v) => isRev ? this._revVal(v).toLocaleString('ko-KR') : Math.round(v).toLocaleString('ko-KR');
    const unit = isRev ? this._revUnit() : 'L';
    const rows = Object.entries(groups).map(([key, arr]) => {
      const [cust, prod, src] = key.split('|||');
      const badge = src === 'market_intel'
        ? `<span class="fsc-badge" style="background:#E6F1FB;color:#185FA5">MI</span>`
        : `<span class="fsc-badge" style="background:var(--bg);color:var(--text-3)">수기</span>`;
      return `<tr>
        <td>${this._esc(cust)} · ${this._esc(prod)} ${badge}</td>
        ${arr.map(v => `<td>${fmt(v)}</td>`).join('')}
      </tr>`;
    }).join('');
    el.innerHTML = `<table>
      <thead><tr><th>고객 · 제품 (${unit})</th>${months.map(m => `<th>${this._esc(m)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="13" style="text-align:center;color:var(--text-3);padding:18px">데이터 없음</td></tr>`}</tbody>
    </table>`;
  },
};
