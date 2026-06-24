'use strict';
// =============================================================
// FcstMngPage — 수급 FCST 데이터 관리 (Phase 4, 실무자용 인라인 편집)
//   [생산 Capa] 탭: 제품 × 월 — Nameplate·가동률 편집, 유효Capa 자동
//   [수요·판가] 탭: 고객×제품 × 월 — 수요량·판가 편집 (공급·매출은 대시보드서 자동 산출)
//   입력값만 저장 → 공급/매출은 백엔드 산출 (일관성 보장)
// =============================================================
const FcstMngPage = {
  _year: null,
  _tab: 'capa', // capa | demand
  _capa: [], // production_capacity rows
  _demand: [], // production_forecasts(수요) rows

  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  _months() {
    return Array.from({ length: 12 }, (_, i) => `${this._year}-${String(i + 1).padStart(2, '0')}`);
  },

  async render() {
    if (!this._year) this._year = new Date().getFullYear();
    const yearOpts = [this._year + 1, this._year, this._year - 1].filter((v, i, a) => a.indexOf(v) === i);

    document.getElementById('content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <h2 style="font-size:18px;font-weight:700;margin:0">수급 FCST 데이터 관리</h2>
          <span style="font-size:12px;color:var(--text-3)">실무자 입력 — 공급량·기대매출은 대시보드에서 자동 산출</span>
        </div>
        <select class="filter-select" id="fm-year">
          ${yearOpts.map(y => `<option value="${y}" ${y === this._year ? 'selected' : ''}>${y}년</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:16px">
        <button class="fm-tab ${this._tab === 'capa' ? 'on' : ''}" data-tab="capa">생산 Capa</button>
        <button class="fm-tab ${this._tab === 'demand' ? 'on' : ''}" data-tab="demand">수요 · 판가</button>
      </div>

      <div id="fm-hint" style="font-size:12px;color:var(--text-3);margin-bottom:8px"></div>
      <div id="fm-body" style="overflow-x:auto;border:1px solid var(--border);border-radius:8px"></div>
    `;

    this._injectStyleOnce();
    document.getElementById('fm-year').addEventListener('change', (e) => {
      this._year = parseInt(e.target.value, 10);
      this._load();
    });
    document.querySelectorAll('.fm-tab').forEach((b) => {
      b.addEventListener('click', () => {
        this._tab = b.dataset.tab;
        document.querySelectorAll('.fm-tab').forEach((x) => x.classList.toggle('on', x === b));
        this._renderBody();
      });
    });
    await this._load();
  },

  _injectStyleOnce() {
    if (document.getElementById('fm-style')) return;
    const st = document.createElement('style');
    st.id = 'fm-style';
    st.textContent = `
      .fm-tab{padding:8px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)}
      .fm-tab.on{color:var(--oci-red);border-bottom-color:var(--oci-red);font-weight:700}
      #fm-body table{border-collapse:collapse;font-size:12.5px;min-width:900px;width:100%}
      #fm-body th,#fm-body td{padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap;text-align:center}
      #fm-body th{color:var(--text-3);font-weight:600;font-size:11.5px;background:var(--surface);position:sticky;top:0}
      #fm-body th:first-child,#fm-body td:first-child{text-align:left;position:sticky;left:0;background:var(--surface);z-index:1}
      #fm-body input{width:60px;padding:4px 5px;border:1px solid var(--border);border-radius:5px;font-size:12px;text-align:right;background:var(--surface);color:var(--text-1)}
      #fm-body input:focus{outline:none;border-color:var(--oci-red)}
      #fm-body input.saved{border-color:#1D9E75;background:rgba(29,158,117,0.08)}
      .fm-badge{font-size:10px;padding:1px 6px;border-radius:5px;margin-left:6px}
    `;
    document.head.appendChild(st);
  },

  async _load() {
    try {
      const [capR, demR] = await Promise.all([
        API.forecastSC.capacity({ year: this._year }),
        API.forecastSC.demand({ year: this._year }),
      ]);
      this._capa = capR.data || [];
      this._demand = demR.data || [];
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error('데이터 로드 실패: ' + (e.message || e));
      return;
    }
    this._renderBody();
  },

  _renderBody() {
    const hint = document.getElementById('fm-hint');
    if (this._tab === 'capa') {
      hint.textContent = '가동률(0~1)·Nameplate를 입력하면 유효Capa = Nameplate × 가동률 로 자동 반영됩니다.';
      this._renderCapa();
    } else {
      hint.textContent = '수요량(L)·판가($/L)를 입력하세요. 판가 수정은 해당 고객·제품의 12개월 전체에 적용됩니다.';
      this._renderDemand();
    }
  },

  // ── 생산 Capa 그리드 ──────────────────────────────────────────
  _renderCapa() {
    const months = this._months();
    const mLabels = months.map((m) => `${parseInt(m.slice(5), 10)}월`);
    // 제품별 그룹: { nameplate, byPeriod: {period: {id, util}} }
    const groups = {};
    for (const r of this._capa) {
      if (!groups[r.product_name]) groups[r.product_name] = { nameplate: Number(r.nameplate) || 0, byPeriod: {} };
      groups[r.product_name].byPeriod[r.period] = { id: r.id, util: Number(r.utilization) || 0 };
    }
    const names = Object.keys(groups);
    const rows = names.map((name) => {
      const g = groups[name];
      const cells = months.map((p) => {
        const cell = g.byPeriod[p];
        const v = cell ? cell.util : '';
        return `<td><input type="number" step="0.01" min="0" max="1" value="${v}" data-cap-util data-product="${this._esc(name)}" data-period="${p}"></td>`;
      }).join('');
      return `<tr>
        <td>${this._esc(name)}</td>
        <td><input type="number" step="100" min="0" value="${g.nameplate}" data-cap-nameplate data-product="${this._esc(name)}" style="width:80px"></td>
        ${cells}
      </tr>`;
    }).join('');
    document.getElementById('fm-body').innerHTML = `<table>
      <thead><tr><th>제품</th><th>Nameplate(L)</th>${mLabels.map((m) => `<th>${m}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="14" style="padding:18px;color:var(--text-3)">데이터 없음</td></tr>`}</tbody>
    </table>`;
    this._bindCapa();
  },

  _bindCapa() {
    const body = document.getElementById('fm-body');
    body.querySelectorAll('input[data-cap-util]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const product = inp.dataset.product;
        const period = inp.dataset.period;
        const util = Math.max(0, Math.min(1, Number(inp.value) || 0));
        inp.value = util;
        const npInput = body.querySelector(`input[data-cap-nameplate][data-product="${CSS.escape(product)}"]`);
        const nameplate = Number(npInput?.value) || 0;
        await this._save(inp, () => API.forecastSC.capacitySave({ product_name: product, period, nameplate, utilization: util }));
      });
    });
    body.querySelectorAll('input[data-cap-nameplate]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const product = inp.dataset.product;
        const nameplate = Number(inp.value) || 0;
        const utils = body.querySelectorAll(`input[data-cap-util][data-product="${CSS.escape(product)}"]`);
        try {
          for (const u of utils) {
            const period = u.dataset.period;
            const util = Math.max(0, Math.min(1, Number(u.value) || 0));
            await API.forecastSC.capacitySave({ product_name: product, period, nameplate, utilization: util });
          }
          this._flash(inp);
          if (typeof Toast !== 'undefined') Toast.success(`${product} Nameplate 적용 (12개월)`);
        } catch (e) {
          if (typeof Toast !== 'undefined') Toast.error('저장 실패: ' + (e.message || e));
        }
      });
    });
  },

  // ── 수요·판가 그리드 ──────────────────────────────────────────
  _renderDemand() {
    const months = this._months();
    const mLabels = months.map((m) => `${parseInt(m.slice(5), 10)}월`);
    // 고객|제품 그룹: { price, source, region, byPeriod: {period: {id, qty}} }
    const groups = {};
    for (const r of this._demand) {
      const key = `${r.customer_name}|||${r.product_name}`;
      if (!groups[key]) groups[key] = { price: Number(r.unit_price) || 0, source: r.demand_source, region: r.region, byPeriod: {} };
      groups[key].byPeriod[r.period] = { id: r.id, qty: Number(r.demand_qty) || 0 };
    }
    const keys = Object.keys(groups);
    const rows = keys.map((key) => {
      const [cust, prod] = key.split('|||');
      const g = groups[key];
      const badge = g.source === 'market_intel'
        ? `<span class="fm-badge" style="background:#E6F1FB;color:#185FA5">MI</span>`
        : `<span class="fm-badge" style="background:var(--bg);color:var(--text-3)">수기</span>`;
      const cells = months.map((p) => {
        const cell = g.byPeriod[p];
        const v = cell ? cell.qty : '';
        const id = cell ? cell.id : '';
        return `<td><input type="number" step="10" min="0" value="${v}" data-dem-qty data-id="${id}" ${id ? '' : 'disabled'}></td>`;
      }).join('');
      return `<tr>
        <td>${this._esc(cust)} · ${this._esc(prod)} ${badge}</td>
        <td><input type="number" step="10" min="0" value="${g.price}" data-dem-price data-key="${this._esc(key)}" style="width:72px"></td>
        ${cells}
      </tr>`;
    }).join('');
    document.getElementById('fm-body').innerHTML = `<table>
      <thead><tr><th>고객 · 제품</th><th>판가($/L)</th>${mLabels.map((m) => `<th>${m}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="14" style="padding:18px;color:var(--text-3)">데이터 없음</td></tr>`}</tbody>
    </table>`;
    this._bindDemand(groups);
  },

  _bindDemand(groups) {
    const body = document.getElementById('fm-body');
    body.querySelectorAll('input[data-dem-qty]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const id = inp.dataset.id;
        if (!id) return;
        const qty = Number(inp.value) || 0;
        await this._save(inp, () => API.forecastSC.demandUpdate(id, { forecast_qty: qty }));
      });
    });
    body.querySelectorAll('input[data-dem-price]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const key = inp.dataset.key;
        const price = Number(inp.value) || 0;
        const g = groups[key];
        if (!g) return;
        try {
          for (const p of Object.keys(g.byPeriod)) {
            await API.forecastSC.demandUpdate(g.byPeriod[p].id, { unit_price: price });
          }
          this._flash(inp);
          if (typeof Toast !== 'undefined') Toast.success('판가 적용 (12개월)');
        } catch (e) {
          if (typeof Toast !== 'undefined') Toast.error('저장 실패: ' + (e.message || e));
        }
      });
    });
  },

  // 단건 저장 + 저장표시
  async _save(inp, fn) {
    try {
      await fn();
      this._flash(inp);
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error('저장 실패: ' + (e.message || e));
    }
  },
  _flash(inp) {
    inp.classList.add('saved');
    setTimeout(() => inp.classList.remove('saved'), 900);
  },
};
