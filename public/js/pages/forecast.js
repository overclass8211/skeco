'use strict';
// =============================================================
// ForecastPage — 매출 포캐스트 (파이프라인 기반 가중 예측, Phase A)
//   GET /api/forecast 로 월별 추이 + 요약 + 상세 렌더
// =============================================================
const ForecastPage = {
  _chart: null,
  _data: null,
  _detailMode: 'detail', // 'detail' | 'summary'
  filters: {
    year: null,
    base_month: '',
    compare: 'yoy',
    assignee: '',
    business_type: '',
    region: '',
    dept: '',
    q: '',
  },

  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  _won(mil) {
    return '₩' + (Math.round(Number(mil) || 0) * 1000000).toLocaleString('ko-KR');
  },
  _mil(v) {
    return (Math.round(Number(v) || 0)).toLocaleString('ko-KR');
  },

  async render() {
    this._prodLoaded = false;
    const now = new Date();
    if (!this.filters.year) this.filters.year = now.getFullYear();
    if (!this.filters.base_month) {
      this.filters.base_month = `${this.filters.year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const BIZ = ['식각가스', '프리커서', 'Wet Chemical', '디스플레이소재', '포토소재', '통합서비스'];
    const yearOpts = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
    const monthOpts = Array.from({ length: 12 }, (_, i) => `${this.filters.year}-${String(i + 1).padStart(2, '0')}`);

    document.getElementById('content').innerHTML = `
      <div class="fcst-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <h2 style="font-size:18px;font-weight:700;margin:0">파이프라인 기반 예상 매출 FCST</h2>
          <span style="font-size:12px;color:var(--text-3)">단위: 백만원</span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" id="fcst-export">⬇ 내보내기</button>
          <button class="btn btn-sm" id="fcst-settings">⚙ 확률 설정</button>
        </div>
      </div>

      <div class="fcst-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:16px">
        <button class="fcst-tab active" data-tab="trend" style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid var(--oci-red);margin-bottom:-2px;color:var(--oci-red)">📈 예측 추이</button>
        <button class="fcst-tab" data-tab="prod" style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">🏭 생산예측 (마케팅)</button>
      </div>

      <div id="fcst-tab-trend">
      <div class="fcst-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <select class="filter-select" id="fcst-year">
          ${yearOpts.map(y => `<option value="${y}" ${y === this.filters.year ? 'selected' : ''}>${y}년</option>`).join('')}
        </select>
        <select class="filter-select" id="fcst-base-month">
          ${monthOpts.map(m => `<option value="${m}" ${m === this.filters.base_month ? 'selected' : ''}>기준월 · ${m}</option>`).join('')}
        </select>
        <select class="filter-select" id="fcst-compare">
          <option value="yoy">비교 · 전년 동월</option>
          <option value="none">비교 · 없음</option>
        </select>
        <select class="filter-select" id="fcst-assignee"><option value="">담당자 · 전체</option></select>
        <select class="filter-select" id="fcst-biz">
          <option value="">사업구분 · 전체</option>
          ${BIZ.map(b => `<option value="${b}">${b}</option>`).join('')}
        </select>
        <select class="filter-select" id="fcst-dept"><option value="">부서 · 전체</option></select>
        <select class="filter-select" id="fcst-region">
          <option value="">지역 · 전체</option>
          <option value="국내">국내</option>
          <option value="해외">해외</option>
        </select>
        <input class="search-input" id="fcst-q" placeholder="프로젝트명·고객사 검색" style="width:180px">
        <button class="btn btn-sm" id="fcst-reset">초기화</button>
        <button class="btn btn-primary btn-sm" id="fcst-search">조회</button>
      </div>

      <div id="fcst-kpis" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px"></div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>월별 FCST 추이</span>
          <div style="display:flex;gap:14px;font-size:11px;color:var(--text-2)">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#1664E5;vertical-align:middle"></span> 예상매출</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#16a34a;vertical-align:middle"></span> 확정매출</span>
            <span><span style="display:inline-block;width:16px;border-top:3px dashed #F58220;vertical-align:middle"></span> Weighted FCST</span>
            <span><span style="display:inline-block;width:16px;border-top:3px dashed #B0B6BF;vertical-align:middle"></span> 전년 예상</span>
          </div>
        </div>
        <div style="position:relative;height:320px;padding:12px"><canvas id="fcst-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>파이프라인 예상 매출 상세 <span id="fcst-detail-cnt" style="color:var(--text-3);font-size:12px"></span></span>
          <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <button class="fcst-toggle" data-mode="summary" style="border:none;background:none;padding:5px 12px;font-size:12px;cursor:pointer">요약 보기</button>
            <button class="fcst-toggle" data-mode="detail" style="border:none;background:var(--oci-red);color:#fff;padding:5px 12px;font-size:12px;cursor:pointer">상세 보기</button>
          </div>
        </div>
        <div id="fcst-table" style="padding:4px 12px 12px"><div class="loading" style="padding:24px;text-align:center;color:var(--text-3)">불러오는 중...</div></div>
      </div>
      </div>

      <div id="fcst-tab-prod" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div style="display:flex;gap:8px;align-items:center">
            <select class="filter-select" id="prod-period"><option value="">전체 기간</option></select>
            <select class="filter-select" id="prod-status">
              <option value="">전체 상태</option>
              <option value="예측">예측</option>
              <option value="수주전환">수주전환</option>
              <option value="취소">취소</option>
            </select>
            <input class="search-input" id="prod-q" placeholder="고객사·품목 검색" style="width:180px">
            <button class="btn btn-sm" id="prod-search">조회</button>
          </div>
          <button class="btn btn-primary btn-sm" id="prod-add">+ 생산예측 추가</button>
        </div>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:10px">마케팅이 입력한 고객×품목×월 생산예측입니다. <b>수주 전환</b> 시 파이프라인(수주)으로 편입되어 예측 추이에 자동 반영됩니다.</p>
        <div class="card"><div id="prod-table" style="padding:4px 12px 12px"><div class="loading" style="padding:24px;text-align:center;color:var(--text-3)">불러오는 중...</div></div></div>
      </div>
    `;

    await this._populateFilters();
    this._bindEvents();
    await this._load();
  },

  async _populateFilters() {
    try {
      const r = await API.team.list();
      const members = r?.data || [];
      const aSel = document.getElementById('fcst-assignee');
      const dSel = document.getElementById('fcst-dept');
      members.forEach(m => {
        aSel.insertAdjacentHTML('beforeend', `<option value="${m.id}">${this._esc(m.name)}</option>`);
      });
      [...new Set(members.map(m => m.team).filter(Boolean))].forEach(t => {
        dSel.insertAdjacentHTML('beforeend', `<option value="${this._esc(t)}">${this._esc(t)}</option>`);
      });
    } catch (e) {
      console.warn('[Forecast] 필터 로드 실패', e);
    }
    // 생산예측 기간 옵션 (해당 연도 12개월)
    const pSel = document.getElementById('prod-period');
    if (pSel) {
      for (let i = 1; i <= 12; i++) {
        const m = `${this.filters.year}-${String(i).padStart(2, '0')}`;
        pSel.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`);
      }
    }
  },

  // ── 생산예측 (Phase B) ──────────────────────────────────────
  async _loadProduction() {
    const el = document.getElementById('prod-table');
    const params = {
      period: document.getElementById('prod-period')?.value || '',
      status: document.getElementById('prod-status')?.value || '',
      q: document.getElementById('prod-q')?.value.trim() || '',
    };
    try {
      const r = await API.productionForecasts.list(params);
      this._prodData = r?.data || [];
      this._renderProduction();
    } catch (e) {
      el.innerHTML = `<div style="padding:20px;color:#dc2626">조회 실패: ${this._esc(e?.message || e)}</div>`;
    }
  },

  _renderProduction() {
    const el = document.getElementById('prod-table');
    const d = this._prodData || [];
    if (!d.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:12px">생산예측이 없습니다. [+ 생산예측 추가]로 등록하세요.</div>`;
      return;
    }
    const statusBadge = s => {
      const c = s === '수주전환' ? ['#dcfce7', '#16a34a'] : s === '취소' ? ['#f1f5f9', '#64748b'] : ['#FDEEDF', '#D96A0E'];
      return `<span style="background:${c[0]};color:${c[1]};font-size:11px;padding:2px 8px;border-radius:5px">${this._esc(s)}</span>`;
    };
    el.innerHTML = `<table class="data-table" style="font-size:12.5px;width:100%">
      <thead><tr>
        <th>기간</th><th>고객사</th><th>품목</th><th>사업구분</th>
        <th style="text-align:right">수량</th><th style="text-align:right">단가(원)</th>
        <th style="text-align:right">예상매출</th><th>상태</th><th style="text-align:right">액션</th>
      </tr></thead>
      <tbody>${d.map(r => `<tr>
        <td>${this._esc(r.period)}</td>
        <td>${this._esc(r.customer_name)}</td>
        <td>${this._esc(r.product_name)}</td>
        <td style="color:var(--text-2)">${this._esc(r.business_type || '-')}</td>
        <td style="text-align:right">${(Number(r.forecast_qty) || 0).toLocaleString('ko-KR')} ${this._esc(r.unit || '')}</td>
        <td style="text-align:right;font-family:monospace">${(Number(r.unit_price) || 0).toLocaleString('ko-KR')}</td>
        <td style="text-align:right;font-family:monospace;font-weight:600">${this._won(Number(r.expected_revenue) / 1000000)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${r.status === '수주전환'
            ? '<span style="font-size:11px;color:var(--text-3)">전환완료</span>'
            : `<button class="btn btn-xs prod-convert" data-id="${r.id}" style="font-size:11px;padding:2px 8px">수주 전환</button>
               <button class="btn btn-xs prod-del" data-id="${r.id}" style="font-size:11px;padding:2px 6px;color:#dc2626">삭제</button>`}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
    el.querySelectorAll('.prod-convert').forEach(b =>
      b.addEventListener('click', () => this._convert(parseInt(b.dataset.id, 10)))
    );
    el.querySelectorAll('.prod-del').forEach(b =>
      b.addEventListener('click', () => this._deleteProd(parseInt(b.dataset.id, 10)))
    );
  },

  _openProdForm() {
    if (typeof Modal === 'undefined') return;
    const BIZ = ['식각가스', '프리커서', 'Wet Chemical', '디스플레이소재', '포토소재', '통합서비스'];
    const months = Array.from({ length: 12 }, (_, i) => `${this.filters.year}-${String(i + 1).padStart(2, '0')}`);
    Modal.open({
      title: '🏭 생산예측 추가',
      width: 460,
      body: `<div style="padding:4px">
        <div class="form-row"><label class="form-label">고객사 *</label><input class="form-input" id="pf-cust" placeholder="예: 삼성전자"></div>
        <div class="form-row"><label class="form-label">품목 *</label><input class="form-input" id="pf-prod" placeholder="예: 식각가스 C4F6"></div>
        <div class="form-row-2" style="display:flex;gap:10px">
          <div class="form-row" style="flex:1"><label class="form-label">사업구분</label>
            <select class="form-input" id="pf-biz">${BIZ.map(b => `<option>${b}</option>`).join('')}</select></div>
          <div class="form-row" style="flex:1"><label class="form-label">기간(월) *</label>
            <select class="form-input" id="pf-period">${months.map(m => `<option>${m}</option>`).join('')}</select></div>
        </div>
        <div class="form-row-2" style="display:flex;gap:10px">
          <div class="form-row" style="flex:1"><label class="form-label">수량</label><input type="number" class="form-input" id="pf-qty" value="0"></div>
          <div class="form-row" style="flex:1"><label class="form-label">단위</label><input class="form-input" id="pf-unit" value="kg"></div>
        </div>
        <div class="form-row"><label class="form-label">단가(원)</label><input type="number" class="form-input" id="pf-price" value="0"></div>
        <div style="background:var(--surface-2);border-radius:6px;padding:8px 12px;margin:8px 0;font-size:13px">예상매출: <b id="pf-rev" style="color:var(--oci-red)">₩0</b></div>
        <div style="text-align:right"><button class="btn btn-primary btn-sm" id="pf-save">저장</button></div>
      </div>`,
    });
    const calc = () => {
      const rev = (parseFloat(document.getElementById('pf-qty').value) || 0) * (parseFloat(document.getElementById('pf-price').value) || 0);
      document.getElementById('pf-rev').textContent = '₩' + Math.round(rev).toLocaleString('ko-KR');
    };
    document.getElementById('pf-qty').addEventListener('input', calc);
    document.getElementById('pf-price').addEventListener('input', calc);
    document.getElementById('pf-save').addEventListener('click', async () => {
      const body = {
        customer_name: document.getElementById('pf-cust').value.trim(),
        product_name: document.getElementById('pf-prod').value.trim(),
        business_type: document.getElementById('pf-biz').value,
        period: document.getElementById('pf-period').value,
        forecast_qty: parseFloat(document.getElementById('pf-qty').value) || 0,
        unit: document.getElementById('pf-unit').value.trim() || 'kg',
        unit_price: parseFloat(document.getElementById('pf-price').value) || 0,
      };
      if (!body.customer_name || !body.product_name) {
        if (typeof Toast !== 'undefined') Toast.error('고객사·품목은 필수입니다');
        return;
      }
      try {
        await API.productionForecasts.create(body);
        if (typeof Toast !== 'undefined') Toast.success('생산예측 추가됨');
        if (typeof Modal !== 'undefined') Modal.close();
        this._loadProduction();
      } catch (e) {
        if (typeof Toast !== 'undefined') Toast.error(e?.message || '저장 실패');
      }
    });
  },

  async _convert(id) {
    if (!confirm('이 생산예측을 수주(파이프라인)로 전환할까요?')) return;
    try {
      await API.productionForecasts.convert(id);
      if (typeof Toast !== 'undefined') Toast.success('수주 전환 완료 — 예측 추이에 반영됩니다');
      this._loadProduction();
      this._load(); // 예측 추이 재계산
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error(e?.message || '전환 실패');
    }
  },

  async _deleteProd(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await API.productionForecasts.remove(id);
      this._loadProduction();
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error(e?.message || '삭제 실패');
    }
  },

  _bindEvents() {
    document.getElementById('fcst-search').addEventListener('click', () => this._applyAndLoad());
    document.getElementById('fcst-reset').addEventListener('click', () => this._reset());
    document.getElementById('fcst-export').addEventListener('click', () => this._export());
    document.getElementById('fcst-settings').addEventListener('click', () => this._openSettings());
    document.getElementById('fcst-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._applyAndLoad();
    });
    document.querySelectorAll('.fcst-toggle').forEach(b => {
      b.addEventListener('click', () => {
        this._detailMode = b.dataset.mode;
        document.querySelectorAll('.fcst-toggle').forEach(x => {
          const on = x.dataset.mode === this._detailMode;
          x.style.background = on ? 'var(--oci-red)' : 'none';
          x.style.color = on ? '#fff' : 'var(--text-2)';
        });
        this._renderTable();
      });
    });

    // 탭 전환 (예측 추이 / 생산예측)
    document.querySelectorAll('.fcst-tab').forEach(t => {
      t.addEventListener('click', () => {
        const tab = t.dataset.tab;
        document.querySelectorAll('.fcst-tab').forEach(x => {
          const on = x.dataset.tab === tab;
          x.style.color = on ? 'var(--oci-red)' : 'var(--text-3)';
          x.style.borderBottomColor = on ? 'var(--oci-red)' : 'transparent';
          x.style.fontWeight = on ? '600' : '500';
        });
        document.getElementById('fcst-tab-trend').style.display = tab === 'trend' ? '' : 'none';
        document.getElementById('fcst-tab-prod').style.display = tab === 'prod' ? '' : 'none';
        if (tab === 'prod' && !this._prodLoaded) {
          this._prodLoaded = true;
          this._loadProduction();
        }
      });
    });
    document.getElementById('prod-search').addEventListener('click', () => this._loadProduction());
    document.getElementById('prod-add').addEventListener('click', () => this._openProdForm());
    document.getElementById('prod-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._loadProduction();
    });
  },

  _applyAndLoad() {
    this.filters.year = parseInt(document.getElementById('fcst-year').value, 10);
    this.filters.base_month = document.getElementById('fcst-base-month').value;
    this.filters.compare = document.getElementById('fcst-compare').value;
    this.filters.assignee = document.getElementById('fcst-assignee').value;
    this.filters.business_type = document.getElementById('fcst-biz').value;
    this.filters.dept = document.getElementById('fcst-dept').value;
    this.filters.region = document.getElementById('fcst-region').value;
    this.filters.q = document.getElementById('fcst-q').value.trim();
    this._load();
  },

  _reset() {
    this.render();
  },

  async _load() {
    try {
      const r = await API.forecast.get(this.filters);
      this._data = r?.data || null;
      this._renderKpis();
      this._renderChart();
      this._renderTable();
    } catch (e) {
      console.error('[Forecast] load failed', e);
      document.getElementById('fcst-table').innerHTML =
        `<div style="padding:20px;color:#dc2626">조회 실패: ${this._esc(e?.message || e)}</div>`;
    }
  },

  _renderKpis() {
    const s = this._data?.summary || {};
    const el = document.getElementById('fcst-kpis');
    const tile = (label, val, sub, color) =>
      `<div style="flex:1;min-width:150px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${label}</div>
        <div style="font-size:20px;font-weight:800;color:${color || 'var(--text-1)'}">${this._mil(val)}<span style="font-size:11px;font-weight:600;color:var(--text-3)"> 백만</span></div>
        <div style="font-size:11px;color:var(--text-2);margin-top:3px;min-height:14px">${sub || ''}</div>
      </div>`;
    const yoy = s.yoy_pct === null || s.yoy_pct === undefined
      ? '전년 비교 데이터 없음'
      : `전년比 <span style="color:${s.yoy_pct >= 0 ? '#16a34a' : '#dc2626'}">${s.yoy_pct >= 0 ? '▲' : '▼'} ${Math.abs(s.yoy_pct)}%</span>`;
    el.innerHTML =
      tile(`기준월 예상매출 (${this._data?.base_month || ''})`, s.base_expected, `Weighted ${this._mil(s.base_weighted)} 백만`, 'var(--oci-red)') +
      tile('연간 예상매출', s.year_expected, yoy) +
      tile('연간 Weighted FCST', s.year_weighted, `확정 ${this._mil(s.year_committed)} 백만`, '#F58220') +
      tile('파이프라인 딜', s.deal_count, '진행+수주 건수', '#1664E5');
  },

  _renderChart() {
    const m = this._data?.monthly || [];
    const ctx = document.getElementById('fcst-chart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (this._chart) this._chart.destroy();
    const labels = m.map(x => `${parseInt(x.month.slice(5), 10)}월`);
    const base = this._data?.base_month;
    this._chart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '예상매출', data: m.map(x => x.expected), backgroundColor: m.map(x => (x.month === base ? '#0C44A0' : '#1664E5')), borderRadius: 4, order: 3 },
          { type: 'bar', label: '확정매출', data: m.map(x => x.committed), backgroundColor: '#16a34a', borderRadius: 4, order: 3 },
          { type: 'line', label: 'Weighted FCST', data: m.map(x => x.weighted), borderColor: '#F58220', backgroundColor: '#F58220', borderDash: [6, 4], borderWidth: 2.5, pointRadius: 3, tension: 0.3, order: 1 },
          { type: 'line', label: '전년 예상', data: m.map(x => x.prev_expected), borderColor: '#B0B6BF', backgroundColor: '#B0B6BF', borderDash: [4, 4], borderWidth: 2, pointRadius: 2, tension: 0.3, order: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toLocaleString('ko-KR')} 백만원` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { autoSkip: false, color: '#86909C', font: { size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#86909C', font: { size: 11 }, callback: v => v.toLocaleString('ko-KR') } },
        },
      },
    });
  },

  _statusBadge(role, label) {
    const map = { won: ['#dcfce7', '#16a34a'], lost: ['#f1f5f9', '#64748b'], dropped: ['#f1f5f9', '#64748b'] };
    const c = map[role] || ['#FDE7EB', '#C00020'];
    return `<span style="background:${c[0]};color:${c[1]};font-size:11px;padding:2px 8px;border-radius:5px">${this._esc(label)}</span>`;
  },

  _renderTable() {
    const el = document.getElementById('fcst-table');
    const cntEl = document.getElementById('fcst-detail-cnt');
    const d = this._data?.details || [];
    if (cntEl) cntEl.textContent = d.length ? `(${d.length}건)` : '';
    if (!d.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:12px">조건에 맞는 파이프라인 딜이 없습니다</div>`;
      return;
    }
    if (this._detailMode === 'summary') {
      const g = {};
      d.forEach(r => {
        g[r.business_type] = g[r.business_type] || { exp: 0, w: 0, n: 0 };
        g[r.business_type].exp += r.expected_amount;
        g[r.business_type].w += r.weighted;
        g[r.business_type].n += 1;
      });
      el.innerHTML = `<table class="data-table" style="font-size:12.5px;width:100%">
        <thead><tr><th>사업구분</th><th style="text-align:right">딜</th><th style="text-align:right">예상매출</th><th style="text-align:right">Weighted FCST</th></tr></thead>
        <tbody>${Object.entries(g).map(([k, v]) =>
          `<tr><td>${this._esc(k)}</td><td style="text-align:right">${v.n}</td><td style="text-align:right;font-family:monospace">${this._won(v.exp)}</td><td style="text-align:right;font-family:monospace;color:#C0631A">${this._won(v.w)}</td></tr>`
        ).join('')}</tbody>
      </table>`;
      return;
    }
    el.innerHTML = `<table class="data-table" style="font-size:12.5px;width:100%">
      <thead><tr>
        <th>영업딜</th><th>고객사</th><th>사업구분</th><th>지역</th><th>담당</th>
        <th style="text-align:right">예상매출</th><th style="text-align:right">확률</th>
        <th style="text-align:right">Weighted</th><th>완료월</th><th>상태</th>
      </tr></thead>
      <tbody>${d.map(r => `<tr class="fcst-deal-row" data-lead-id="${r.lead_id}" style="cursor:pointer" title="클릭 시 영업딜 상세">
        <td>${this._esc(r.project_name)}</td>
        <td>${this._esc(r.customer)}</td>
        <td style="color:var(--text-2)">${this._esc(r.business_type)}</td>
        <td style="color:var(--text-2)">${this._esc(r.region)}</td>
        <td style="color:var(--text-2)">${this._esc(r.assignee)}</td>
        <td style="text-align:right;font-family:monospace">${this._won(r.expected_amount)}</td>
        <td style="text-align:right">${r.probability}%</td>
        <td style="text-align:right;font-family:monospace;color:#C0631A;font-weight:600">${this._won(r.weighted)}</td>
        <td style="color:var(--text-2)">${this._esc(r.expected_close_month)}</td>
        <td>${this._statusBadge(r.stage_role, r.status)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    // 행 클릭 → 영업딜(리드) 상세 모달 재사용 (편집 내장)
    el.querySelectorAll('.fcst-deal-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.leadId, 10);
        if (id && typeof App !== 'undefined' && App.openLeadDetail) App.openLeadDetail(id);
      });
      tr.addEventListener('mouseenter', () => { tr.style.background = '#f9fafb'; });
      tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
    });
  },

  // 외부(딜 편집 등) 변경 후 현재 화면 동기화용 — App._syncAfterLeadChange 가 호출
  loadData() {
    return this._load();
  },

  _export() {
    const d = this._data?.details || [];
    if (!d.length) {
      if (typeof Toast !== 'undefined') Toast.error('내보낼 데이터가 없습니다');
      return;
    }
    const head = ['프로젝트명', '고객사', '사업구분', '지역', '담당', '예상매출(백만)', '확률(%)', 'Weighted(백만)', '완료월', '상태'];
    const rows = d.map(r => [r.project_name, r.customer, r.business_type, r.region, r.assignee, r.expected_amount, r.probability, r.weighted, r.expected_close_month, r.status]);
    const csv = [head, ...rows].map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `매출포캐스트_${this._data?.base_month || ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async _openSettings() {
    if (typeof Modal === 'undefined') return;
    let rows;
    try {
      const r = await API.forecast.probabilities();
      rows = (r?.data || []).filter(s => s.role === 'active' || s.role === 'won');
    } catch (_e) {
      if (typeof Toast !== 'undefined') Toast.error('확률 로드 실패');
      return;
    }
    Modal.open({
      title: '⚙ 단계별 수주확률 설정',
      width: 420,
      body: `<div style="padding:4px">
        <p style="font-size:12px;color:var(--text-3);margin-bottom:12px">Weighted FCST 계산에 쓰이는 단계 기본 확률입니다.</p>
        ${rows.map(s => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="flex:1;font-size:13px">${this._esc(s.label)}</span>
          <input type="number" min="0" max="100" value="${s.win_probability ?? 0}" data-stage="${s.stage_key}" class="form-input fcst-prob" style="width:90px;text-align:right"> <span style="font-size:12px;color:var(--text-3)">%</span>
        </div>`).join('')}
        <div style="text-align:right;margin-top:14px"><button class="btn btn-primary btn-sm" id="fcst-prob-save">저장</button></div>
      </div>`,
    });
    document.getElementById('fcst-prob-save').addEventListener('click', async () => {
      const items = [...document.querySelectorAll('.fcst-prob')].map(i => ({
        stage_key: i.dataset.stage,
        win_probability: parseInt(i.value, 10) || 0,
      }));
      try {
        await API.forecast.saveProbabilities(items);
        if (typeof Toast !== 'undefined') Toast.success('확률 저장 완료');
        if (typeof Modal !== 'undefined') Modal.close();
        this._load();
      } catch (e) {
        if (typeof Toast !== 'undefined') Toast.error(e?.message || '저장 실패');
      }
    });
  },
};
