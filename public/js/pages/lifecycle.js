'use strict';
// =============================================================
// ProcessLifecyclePage — 전사 공정 라이프사이클 보드
//   고객×소재 전 건의 PLM 게이트(MRD~MP) 진척을 한눈에 집계
//   KPI(전체/지연/이번달 도래) + 필터(고객·현재 게이트·지연만) + 행 클릭 → 360 드릴다운
//   데이터: GET /api/customer360/gate-board (무스키마변경)
// =============================================================
const ProcessLifecyclePage = {
  _data: null,
  _f: { q: '', gate: '', delayedOnly: false },

  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  _L(key, fb) {
    return typeof Labels !== 'undefined' ? Labels.get(key, fb) : fb;
  },
  _ymd(d) {
    return d ? String(d).slice(2, 7).replace('-', '/') : '';
  },

  async render() {
    const root = document.getElementById('content');
    root.innerHTML = `<div class="loading" data-label="common.loading_data">데이터 로딩중...</div>`;
    try {
      const res = await API.get('/customer360/gate-board');
      this._data = res.data || res;
    } catch (e) {
      root.innerHTML = `<div class="card"><div class="card-body"><div class="empty"><div class="empty-icon">⚠</div>보드 로드 실패<br><span class="text-muted fs-12 mono">${this._esc(e.message || e)}</span></div></div></div>`;
      return;
    }
    this._paint();
  },

  _filtered() {
    const rows = (this._data && this._data.rows) || [];
    const q = this._f.q.trim().toLowerCase();
    return rows.filter(r => {
      if (this._f.delayedOnly && !r.delayed) return false;
      if (this._f.gate && r.current_gate !== this._f.gate) return false;
      if (q) {
        const hay = `${r.customer_name} ${r.material_name} ${r.business_type || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  },

  // 게이트 진행 스트립(행 단위) — 완료=초록✓ / 현재=빨강 / 예정=회색, 지연은 빨강 링
  _strip(r) {
    return (r.gates || [])
      .map(g => {
        const isCur = g.gate_key === r.current_gate;
        let bg = 'var(--surface-2)';
        let fg = 'var(--text-3)';
        let bd = 'var(--border)';
        if (g.status === 'done') {
          bg = '#0F7A3F';
          fg = '#fff';
          bd = '#0F7A3F';
        } else if (isCur) {
          bg = 'var(--oci-red)';
          fg = '#fff';
          bd = 'var(--oci-red)';
        }
        const ring = g.late ? 'box-shadow:0 0 0 2px var(--oci-red)' : '';
        const dt = g.status === 'done' ? this._ymd(g.actual_date) : this._ymd(g.target_date);
        const sym = g.status === 'done' ? '✓' : '';
        return `<div class="plc-cell" title="${this._esc(g.gate_key)}${isCur ? ' (현재)' : ''}${g.late ? ' · 지연' : ''}${dt ? ' · ' + dt : ''}">
            <span class="plc-dot" style="background:${bg};color:${fg};border-color:${bd};${ring}">${sym || ''}</span>
            <span class="plc-gk">${this._esc(g.gate_key)}</span>
            <span class="plc-dt" style="color:${g.late ? 'var(--oci-red)' : 'var(--text-3)'}">${dt}</span>
          </div>`;
      })
      .join('<span class="plc-conn"></span>');
  },

  _paint() {
    const root = document.getElementById('content');
    const d = this._data || {};
    const k = d.kpis || { total: 0, delayed: 0, due_this_month: 0 };
    const gates = d.gates || [];
    const rows = this._filtered();

    const gateOpts =
      `<option value="">전체 게이트</option>` +
      gates
        .map(
          g =>
            `<option value="${this._esc(g.gate_key)}" ${this._f.gate === g.gate_key ? 'selected' : ''}>${this._esc(g.gate_label || g.gate_key)}</option>`
        )
        .join('');

    const kpiCard = (label, val, color) =>
      `<div class="plc-kpi"><div class="plc-kpi-v" style="color:${color || 'var(--text-1)'}">${val}</div><div class="plc-kpi-l">${label}</div></div>`;

    const body = rows.length
      ? rows
          .map(
            r => `<tr class="plc-row" data-cust="${r.customer_id}" title="${this._esc(r.customer_name)} 360뷰로 이동">
            <td class="plc-c-cust"><strong>${this._esc(r.customer_name)}</strong></td>
            <td class="plc-c-mat">${this._esc(r.material_name)}${r.business_type ? `<span class="plc-biz">${this._esc(r.business_type)}</span>` : ''}</td>
            <td class="plc-c-strip"><div class="plc-strip">${this._strip(r)}</div></td>
            <td class="plc-c-cur"><span class="pill ${r.delayed ? 'pill-danger' : 'pill-info'}">${this._esc(r.current_gate_label || r.current_gate || '-')}</span></td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="4"><div class="empty" style="padding:32px">조건에 맞는 소재가 없습니다</div></td></tr>`;

    root.innerHTML = `
      <style>
        .plc-kpis{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap}
        .plc-kpi{flex:1;min-width:140px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
        .plc-kpi-v{font-size:24px;font-weight:700;line-height:1.1}
        .plc-kpi-l{font-size:12px;color:var(--text-3);margin-top:4px}
        .plc-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
        .plc-toolbar .search-input{max-width:240px}
        .plc-chk{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--text-2);cursor:pointer}
        .plc-board{overflow-x:auto}
        .plc-board table{width:100%;border-collapse:collapse;font-size:13px}
        .plc-board th{text-align:left;font-size:11.5px;color:var(--text-3);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--border)}
        .plc-row{cursor:pointer;border-bottom:1px solid var(--border)}
        .plc-row:hover{background:var(--surface-2)}
        .plc-c-cust{padding:10px;white-space:nowrap}
        .plc-c-mat{padding:10px;min-width:180px}
        .plc-biz{display:block;font-size:11px;color:var(--text-3);margin-top:2px}
        .plc-c-cur{padding:10px;white-space:nowrap}
        .plc-strip{display:flex;align-items:flex-start;gap:0}
        .plc-cell{display:flex;flex-direction:column;align-items:center;min-width:46px;gap:2px}
        .plc-dot{width:22px;height:22px;border-radius:50%;border:1.5px solid;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
        .plc-gk{font-size:9.5px;color:var(--text-2);font-weight:600}
        .plc-dt{font-size:9px}
        .plc-conn{align-self:flex-start;width:14px;height:1.5px;background:var(--border);margin-top:11px}
      </style>
      <div class="plc-kpis">
        ${kpiCard('전체 소재', k.total)}
        ${kpiCard('지연 (예정 경과·미완료)', k.delayed, k.delayed ? 'var(--oci-red)' : '')}
        ${kpiCard('이번달 도래 (현재 게이트)', k.due_this_month, k.due_this_month ? 'var(--oci-red)' : '')}
      </div>
      <div class="card"><div class="card-body">
        <div class="plc-toolbar">
          <input type="text" class="search-input" id="plc-q" placeholder="고객사·소재·사업유형 검색..." value="${this._esc(this._f.q)}">
          <select class="form-input" id="plc-gate" style="max-width:160px">${gateOpts}</select>
          <label class="plc-chk"><input type="checkbox" id="plc-delay" ${this._f.delayedOnly ? 'checked' : ''}> 지연만</label>
          <span class="text-muted fs-12" style="margin-left:auto">${rows.length}건</span>
        </div>
        <div class="plc-board">
          <table>
            <thead><tr><th>고객사</th><th>소재</th><th>게이트 진행 (MRD → MP)</th><th>현재 게이트</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div></div>`;
    this._wire();
  },

  _wire() {
    const q = document.getElementById('plc-q');
    if (q)
      q.addEventListener('input', () => {
        this._f.q = q.value;
        this._paint();
        const el = document.getElementById('plc-q');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    const gate = document.getElementById('plc-gate');
    if (gate)
      gate.addEventListener('change', () => {
        this._f.gate = gate.value;
        this._paint();
      });
    const delay = document.getElementById('plc-delay');
    if (delay)
      delay.addEventListener('change', () => {
        this._f.delayedOnly = delay.checked;
        this._paint();
      });
    document.querySelectorAll('.plc-row[data-cust]').forEach(tr =>
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-cust');
        if (!id) return;
        try {
          localStorage.setItem('c360_last', String(id));
        } catch (_) {
          /* noop */
        }
        location.hash = '#customer360/' + id;
      })
    );
  },
};

if (typeof window !== 'undefined') window.ProcessLifecyclePage = ProcessLifecyclePage;
