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
        <th>프로젝트명</th><th>고객사</th><th>사업구분</th><th>지역</th><th>담당</th>
        <th style="text-align:right">예상매출</th><th style="text-align:right">확률</th>
        <th style="text-align:right">Weighted</th><th>완료월</th><th>상태</th>
      </tr></thead>
      <tbody>${d.map(r => `<tr>
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
