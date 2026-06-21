// =============================================================
// 전사 품질관리 (Quality Inbox)
//   고객사별로 흩어진 품질 케이스(VOC/NCR/Audit/PCN/CoA)와
//   품질 문서(CoA/MSDS/CoC) 만료 현황을 한곳에서 조회·필터·처리.
//   데이터 원천: quality_cases / quality_documents (고객360과 동일).
//   권한: 전원 조회 / 담당건·팀장+ 편집.
//   풀 단계: ① 문서 만료 추적 ② SLA(처리기한·초과) ③ 엑셀(CSV) 내보내기
// =============================================================
const QualityPage = {
  _view: 'cases', // 'cases' | 'docs'
  _filter: { status: 'unresolved', type: '', severity: '', q: '', customer_id: '', mine: false, sla: '' },
  _docFilter: { doc_type: '', status: '', q: '', customer_id: '' },
  _cases: [],
  _docs: [],
  _summary: null,
  _customers: [],
  _restricted: false,
  _soonDays: 30,

  _TYPES: ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'],
  _DOC_TYPES: ['CoA', 'MSDS', 'CoC', '기타'],
  _SEV: { high: '높음', medium: '보통', low: '낮음' },
  _ST: { open: '미해결', in_progress: '처리중', resolved: '완료' },

  async render() {
    document.getElementById('content').innerHTML = `
      <style>
        .ql-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px}
        .ql-bar h2{font-size:20px;font-weight:700;margin:0}
        .ql-sub{font-size:12px;color:var(--text-3)}
        .ql-bar .spacer{flex:1}
        .ql-seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
        .ql-seg button{border:0;background:var(--surface);color:var(--text-2);font-size:13px;font-weight:600;padding:7px 14px;cursor:pointer}
        .ql-seg button.on{background:var(--brand);color:#fff}
        .ql-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
        .ql-kpi{border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--surface)}
        .ql-kpi .l{font-size:12px;color:var(--text-2);font-weight:600}
        .ql-kpi .v{font-size:26px;font-weight:700;margin-top:4px;color:var(--text-1);font-variant-numeric:tabular-nums}
        .ql-kpi .s{font-size:11px;color:var(--text-3);margin-top:2px}
        .ql-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
        .ql-filters select,.ql-filters input[type=text]{padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .ql-filters input[type=text]{min-width:200px}
        .ql-chk{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--text-2);cursor:pointer}
        .ql-tbl{table-layout:fixed;width:100%;font-size:12.5px}
        .ql-tbl col.c-no{width:11%}.ql-tbl col.c-cust{width:13%}.ql-tbl col.c-title{width:22%}
        .ql-tbl col.c-mat{width:12%}.ql-tbl col.c-sev{width:7%}.ql-tbl col.c-st{width:7%}
        .ql-tbl col.c-own{width:8%}.ql-tbl col.c-age{width:6%}.ql-tbl col.c-sla{width:9%}
        .ql-tbl col.d-type{width:8%}.ql-tbl col.d-no{width:14%}.ql-tbl col.d-date{width:11%}.ql-tbl col.d-stat{width:11%}
        .ql-tbl th,.ql-tbl td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ql-tbl td.num{text-align:center}
        .ql-tbl tbody tr{cursor:pointer}
        .ql-pill{font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600;display:inline-block}
        .ql-sev-high{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .ql-sev-medium{background:rgba(245,156,0,.14);color:#b45309}
        .ql-sev-low{background:var(--surface-2,rgba(0,0,0,.05));color:var(--text-2)}
        .ql-st-open{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .ql-st-in_progress{background:rgba(245,156,0,.14);color:#b45309}
        .ql-st-resolved{background:rgba(23,168,90,.12);color:#17A85A}
        .ql-d-expired{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .ql-d-expiring{background:rgba(245,156,0,.14);color:#b45309}
        .ql-d-valid{background:rgba(23,168,90,.12);color:#17A85A}
        .ql-d-none{background:var(--surface-2,rgba(0,0,0,.05));color:var(--text-3)}
        .ql-age-warn{color:var(--oci-red);font-weight:700}
        .ql-empty{padding:40px;text-align:center;color:var(--text-3)}
        .ql-form{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        .ql-fld{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-2)}
        .ql-fld.full{grid-column:1/-1}
        .ql-fld input,.ql-fld select,.ql-fld textarea{padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .ql-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
      </style>
      <div class="ql-bar">
        <h2>품질관리</h2><span class="ql-sub" id="ql-sub"></span>
        <span class="spacer"></span>
        <span class="ql-seg" id="ql-seg">
          <button data-view="cases" class="on">품질 케이스</button>
          <button data-view="docs">문서 만료</button>
        </span>
        <button class="btn btn-ghost" id="ql-export" title="현재 목록을 엑셀(CSV)로 내려받기">⬇ 엑셀</button>
        <button class="btn btn-primary" id="ql-new">+ 새 품질 케이스</button>
      </div>
      <div class="ql-kpis" id="ql-kpis"></div>
      <div class="ql-filters" id="ql-filters"></div>
      <div id="ql-list"><div class="ql-empty">불러오는 중…</div></div>
    `;
    // 고객 목록 (필터·신규 폼)
    try {
      const r = await API.get('/customer360/customers');
      this._customers = r.data || [];
    } catch (_) {
      this._customers = [];
    }
    document.getElementById('ql-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]');
      if (b) this._setView(b.dataset.view);
    });
    document.getElementById('ql-new').addEventListener('click', () => this._openForm());
    document.getElementById('ql-export').addEventListener('click', () => this._exportCsv());
    this._renderFilters();
    await this._load();
  },

  _setView(view) {
    if (view === this._view) return;
    this._view = view;
    document.querySelectorAll('#ql-seg button').forEach(b =>
      b.classList.toggle('on', b.dataset.view === view)
    );
    // 케이스 전용 버튼은 문서 뷰에서 숨김
    document.getElementById('ql-new').style.display = view === 'cases' ? '' : 'none';
    this._renderFilters();
    this._load();
  },

  // ── 필터 (뷰별) ──────────────────────────────────────────────
  _renderFilters() {
    const el = document.getElementById('ql-filters');
    const opt = (val, label, cur) =>
      `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    const custOpts = cur =>
      this._customers.map(c => opt(String(c.id), esc(c.name), cur)).join('');

    if (this._view === 'cases') {
      const f = this._filter;
      el.innerHTML = `
        <select id="qf-status">
          ${opt('unresolved', '미해결+처리중', f.status)}${opt('open', '미해결', f.status)}${opt('in_progress', '처리중', f.status)}${opt('resolved', '완료', f.status)}${opt('', '전체', f.status)}
        </select>
        <select id="qf-type">${opt('', '유형 전체', f.type)}${this._TYPES.map(t => opt(t, t, f.type)).join('')}</select>
        <select id="qf-sev">${opt('', '심각도 전체', f.severity)}${Object.entries(this._SEV).map(([k, v]) => opt(k, v, f.severity)).join('')}</select>
        <select id="qf-cust">${opt('', '고객사 전체', f.customer_id)}${custOpts(f.customer_id)}</select>
        <select id="qf-sla">${opt('', 'SLA 전체', f.sla)}${opt('overdue', 'SLA 초과만', f.sla)}</select>
        <input type="text" id="qf-q" placeholder="제목·케이스번호 검색" value="${esc(f.q)}">
        <label class="ql-chk"><input type="checkbox" id="qf-mine"${f.mine ? ' checked' : ''}> 내 담당만</label>
      `;
      const reload = () => {
        f.status = document.getElementById('qf-status').value;
        f.type = document.getElementById('qf-type').value;
        f.severity = document.getElementById('qf-sev').value;
        f.customer_id = document.getElementById('qf-cust').value;
        f.sla = document.getElementById('qf-sla').value;
        f.mine = document.getElementById('qf-mine').checked;
        this._load();
      };
      ['qf-status', 'qf-type', 'qf-sev', 'qf-cust', 'qf-sla'].forEach(id =>
        document.getElementById(id).addEventListener('change', reload)
      );
      document.getElementById('qf-mine').addEventListener('change', reload);
      this._bindSearch('qf-q', v => (f.q = v));
    } else {
      const f = this._docFilter;
      el.innerHTML = `
        <select id="df-status">
          ${opt('', '상태 전체', f.status)}${opt('attention', '주의(만료·임박)', f.status)}${opt('expired', '만료', f.status)}${opt('expiring', '임박(≤30일)', f.status)}
        </select>
        <select id="df-type">${opt('', '문서 전체', f.doc_type)}${this._DOC_TYPES.map(t => opt(t, t, f.doc_type)).join('')}</select>
        <select id="df-cust">${opt('', '고객사 전체', f.customer_id)}${custOpts(f.customer_id)}</select>
        <input type="text" id="df-q" placeholder="문서번호·소재 검색" value="${esc(f.q)}">
      `;
      const reload = () => {
        f.status = document.getElementById('df-status').value;
        f.doc_type = document.getElementById('df-type').value;
        f.customer_id = document.getElementById('df-cust').value;
        this._load();
      };
      ['df-status', 'df-type', 'df-cust'].forEach(id =>
        document.getElementById(id).addEventListener('change', reload)
      );
      this._bindSearch('df-q', v => (f.q = v));
    }
  },

  _bindSearch(id, setFn) {
    let t;
    document.getElementById(id).addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => {
        setFn(e.target.value.trim());
        this._load();
      }, 300);
    });
  },

  // ── 데이터 로드 ──────────────────────────────────────────────
  async _load() {
    try {
      const sum = await API.get('/quality/summary');
      this._summary = sum.data;
      if (this._summary && this._summary.doc_soon_days) this._soonDays = this._summary.doc_soon_days;
    } catch (_) {
      this._summary = this._summary || {};
    }
    if (this._view === 'cases') {
      const f = this._filter;
      const qs = new URLSearchParams();
      if (f.status) qs.set('status', f.status);
      if (f.type) qs.set('type', f.type);
      if (f.severity) qs.set('severity', f.severity);
      if (f.customer_id) qs.set('customer_id', f.customer_id);
      if (f.sla) qs.set('sla', f.sla);
      if (f.q) qs.set('q', f.q);
      if (f.mine) qs.set('mine', '1');
      try {
        const list = await API.get('/quality/cases?' + qs.toString());
        this._cases = list.data || [];
        this._restricted = !!list.detail_restricted;
      } catch (_) {
        this._cases = [];
      }
    } else {
      const f = this._docFilter;
      const qs = new URLSearchParams();
      if (f.status) qs.set('status', f.status);
      if (f.doc_type) qs.set('doc_type', f.doc_type);
      if (f.customer_id) qs.set('customer_id', f.customer_id);
      if (f.q) qs.set('q', f.q);
      try {
        const list = await API.get('/quality/documents?' + qs.toString());
        this._docs = list.data || [];
        if (list.soon_days) this._soonDays = list.soon_days;
      } catch (_) {
        this._docs = [];
      }
    }
    this._renderKpis();
    this._renderList();
  },

  _renderKpis() {
    const s = this._summary || {};
    const card = (l, v, sub, danger) =>
      `<div class="ql-kpi"><div class="l">${l}</div><div class="v"${danger && v && v !== '0건' ? ' style="color:var(--oci-red)"' : ''}>${v}</div><div class="s">${sub}</div></div>`;
    document.getElementById('ql-kpis').innerHTML =
      card('미해결', `${s.open_total ?? 0}건`, '처리 대기+진행', true) +
      card('High 심각도', `${s.high_open ?? 0}건`, '미해결 중 긴급', true) +
      card('SLA 초과', `${s.overdue ?? 0}건`, '처리기한 경과', true) +
      card('문서 만료', `${s.doc_expired ?? 0}건`, 'CoA/MSDS 유효기한 경과', true) +
      card('만료 임박', `${s.doc_expiring ?? 0}건`, `≤${this._soonDays}일`, true) +
      card('평균 해결일수', s.avg_resolve_days === null || s.avg_resolve_days === undefined ? '-' : `${s.avg_resolve_days}일`, '완료 기준');
  },

  _renderList() {
    if (this._view === 'cases') this._renderCaseList();
    else this._renderDocList();
  },

  // ── 날짜·SLA·만료 표시 헬퍼 ──────────────────────────────────
  _fmtDate(v) {
    if (!v) return '-';
    const s = typeof v === 'string' ? v : new Date(v).toISOString();
    return s.slice(0, 10);
  },
  // SLA 배지 (케이스): days_left null → '-', <0 초과, ≤3 임박, else D-N
  _slaBadge(c) {
    if (c.status === 'resolved' || c.days_left === null || c.days_left === undefined) return '-';
    const d = Number(c.days_left);
    if (d < 0) return `<span class="ql-pill ql-d-expired">초과 ${-d}일</span>`;
    if (d <= 3) return `<span class="ql-pill ql-d-expiring">D-${d}</span>`;
    return `<span class="ql-pill ql-d-valid">D-${d}</span>`;
  },
  // 문서 만료 상태/배지
  _docState(d) {
    if (d.days_left === null || d.days_left === undefined || d.valid_until === null)
      return { key: 'none', label: '기한없음' };
    const n = Number(d.days_left);
    if (n < 0) return { key: 'expired', label: `만료 ${-n}일` };
    if (n <= this._soonDays) return { key: 'expiring', label: `D-${n}` };
    return { key: 'valid', label: `D-${n}` };
  },

  _renderCaseList() {
    const sub = document.getElementById('ql-sub');
    if (sub) sub.textContent = `전사 품질 케이스 · ${this._cases.length}건`;
    const host = document.getElementById('ql-list');
    if (!this._cases.length) {
      host.innerHTML = '<div class="ql-empty">조건에 맞는 품질 케이스가 없습니다.</div>';
      return;
    }
    const rows = this._cases
      .map(c => {
        const aged = c.status !== 'resolved' && Number(c.age_days) >= 14;
        return `<tr data-id="${c.id}">
          <td class="mono">${esc(c.case_no)}</td>
          <td>${esc(c.customer_name)}</td>
          <td>${esc(c.title)}</td>
          <td>${esc(c.material_name ? c.material_name.split(' · ')[0] : '-')}</td>
          <td>${esc(c.type)}</td>
          <td class="num"><span class="ql-pill ql-sev-${c.severity}">${this._SEV[c.severity] || c.severity}</span></td>
          <td class="num"><span class="ql-pill ql-st-${c.status}">${this._ST[c.status] || c.status}</span></td>
          <td class="num">${this._slaBadge(c)}</td>
          <td>${esc(c.owner_name || '-')}</td>
          <td class="num ${aged ? 'ql-age-warn' : ''}">${c.opened_at ? (c.age_days ?? '-') + '일' : '-'}</td>
        </tr>`;
      })
      .join('');
    host.innerHTML = `<table class="data-table ql-tbl">
      <colgroup><col class="c-no"><col class="c-cust"><col class="c-title"><col class="c-mat"><col><col class="c-sev"><col class="c-st"><col class="c-sla"><col class="c-own"><col class="c-age"></colgroup>
      <thead><tr>
        <th>케이스번호</th><th>고객사</th><th>제목</th><th>소재</th><th>유형</th>
        <th class="num">심각도</th><th class="num">상태</th><th class="num">SLA</th><th>담당</th><th class="num">경과</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
    host.querySelectorAll('tbody tr[data-id]').forEach(tr =>
      tr.addEventListener('click', () => this._openDetail(Number(tr.dataset.id)))
    );
  },

  _renderDocList() {
    const sub = document.getElementById('ql-sub');
    if (sub) sub.textContent = `품질 문서 만료 현황 · ${this._docs.length}건`;
    const host = document.getElementById('ql-list');
    if (!this._docs.length) {
      host.innerHTML = '<div class="ql-empty">조건에 맞는 품질 문서가 없습니다.</div>';
      return;
    }
    const rows = this._docs
      .map(d => {
        const st = this._docState(d);
        return `<tr data-cust="${d.customer_id}">
          <td>${esc(d.doc_type)}</td>
          <td class="mono">${esc(d.doc_no || '-')}</td>
          <td>${esc(d.customer_name)}</td>
          <td>${esc(d.material_name ? d.material_name.split(' · ')[0] : '-')}</td>
          <td class="num">${this._fmtDate(d.issued_at)}</td>
          <td class="num">${this._fmtDate(d.valid_until)}</td>
          <td class="num"><span class="ql-pill ql-d-${st.key}">${st.label}</span></td>
        </tr>`;
      })
      .join('');
    host.innerHTML = `<table class="data-table ql-tbl">
      <colgroup><col class="d-type"><col class="d-no"><col class="c-cust"><col class="c-mat"><col class="d-date"><col class="d-date"><col class="d-stat"></colgroup>
      <thead><tr>
        <th>문서</th><th>문서번호</th><th>고객사</th><th>소재</th>
        <th class="num">발행일</th><th class="num">유효기한</th><th class="num">상태</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
    host.querySelectorAll('tbody tr[data-cust]').forEach(tr =>
      tr.addEventListener('click', () => this._gotoCustomer(Number(tr.dataset.cust)))
    );
  },

  _gotoCustomer(customerId) {
    try {
      localStorage.setItem('c360_last', String(customerId));
    } catch (_) {
      /* noop */
    }
    location.hash = '#customer360/' + customerId + '/quality';
  },

  // ── 엑셀(CSV) 내보내기 — UTF-8 BOM 으로 한글 깨짐 방지 ────────
  _exportCsv() {
    let headers, rows, name;
    if (this._view === 'cases') {
      headers = ['케이스번호', '고객사', '제목', '소재', '유형', '심각도', '상태', 'SLA기한', '잔여일', '담당', '발생일', '경과일'];
      rows = this._cases.map(c => [
        c.case_no,
        c.customer_name,
        c.title,
        c.material_name ? c.material_name.split(' · ')[0] : '',
        c.type,
        this._SEV[c.severity] || c.severity,
        this._ST[c.status] || c.status,
        this._fmtDate(c.due_date),
        c.status === 'resolved' || c.days_left === null || c.days_left === undefined ? '' : c.days_left,
        c.owner_name || '',
        this._fmtDate(c.opened_at),
        c.age_days ?? '',
      ]);
      name = '품질케이스';
    } else {
      headers = ['문서', '문서번호', '고객사', '소재', '발행일', '유효기한', '잔여일', '상태'];
      rows = this._docs.map(d => {
        const st = this._docState(d);
        return [
          d.doc_type,
          d.doc_no || '',
          d.customer_name,
          d.material_name ? d.material_name.split(' · ')[0] : '',
          this._fmtDate(d.issued_at),
          this._fmtDate(d.valid_until),
          d.days_left === null || d.days_left === undefined ? '' : d.days_left,
          st.label,
        ];
      });
      name = '품질문서만료';
    }
    if (!rows.length) {
      if (typeof Toast !== 'undefined') Toast.error?.('내보낼 데이터가 없습니다');
      return;
    }
    const escCell = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv =
      '﻿' +
      [headers, ...rows].map(r => r.map(escCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${name}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof Toast !== 'undefined') Toast.success?.(`${rows.length}건 내보내기 완료`);
  },

  _openDetail(id) {
    const c = this._cases.find(x => x.id === id);
    if (!c || typeof Modal === 'undefined') return;
    const sevOpt = Object.entries(this._SEV).map(([k, v]) => `<option value="${k}"${k === c.severity ? ' selected' : ''}>${v}</option>`).join('');
    const stOpt = Object.entries(this._ST).map(([k, v]) => `<option value="${k}"${k === c.status ? ' selected' : ''}>${v}</option>`).join('');
    const typeOpt = this._TYPES.map(t => `<option value="${t}"${t === c.type ? ' selected' : ''}>${t}</option>`).join('');
    const me = (typeof App !== 'undefined' && App.currentUser && App.currentUser.id) || null;
    const claimBtn = me && c.owner_id !== me ? '<button class="btn btn-ghost" id="qd-claim">내가 담당</button>' : '';
    const slaLine =
      c.status === 'resolved' || c.due_date === null || c.due_date === undefined
        ? ''
        : `<div class="ql-fld"><span>SLA 기한</span><input type="text" value="${this._fmtDate(c.due_date)} (${
            c.days_left < 0 ? '초과 ' + -c.days_left + '일' : 'D-' + c.days_left
          })" disabled></div>`;
    Modal.open({
      title: `${esc(c.case_no)} — 품질 케이스`,
      width: 560,
      body: `
        <div class="ql-form">
          <div class="ql-fld"><span>고객사</span><input type="text" value="${esc(c.customer_name)}" disabled></div>
          <div class="ql-fld"><span>소재</span><input type="text" value="${esc(c.material_name ? c.material_name.split(' · ')[0] : '-')}" disabled></div>
          <div class="ql-fld full"><span>제목</span><input type="text" id="qd-title" value="${esc(c.title)}"></div>
          <div class="ql-fld"><span>유형</span><select id="qd-type">${typeOpt}</select></div>
          <div class="ql-fld"><span>심각도</span><select id="qd-sev">${sevOpt}</select></div>
          <div class="ql-fld"><span>상태</span><select id="qd-status">${stOpt}</select></div>
          <div class="ql-fld"><span>담당</span><input type="text" value="${esc(c.owner_name || '미배정')}" disabled></div>
          ${slaLine}
          ${this._restricted ? '' : `<div class="ql-fld full"><span>비고(원인·분석)</span><textarea id="qd-notes" rows="3">${esc(c.notes || '')}</textarea></div>`}
        </div>
        <div class="ql-actions">
          <button class="btn btn-ghost" id="qd-open360">고객360에서 열기</button>
          ${claimBtn}
          <button class="btn btn-primary" id="qd-save">저장</button>
        </div>`,
    });
    const ov = document.getElementById('modal-overlay');
    ov.querySelector('#qd-open360').addEventListener('click', () => {
      Modal.close();
      this._gotoCustomer(c.customer_id);
    });
    const claim = ov.querySelector('#qd-claim');
    if (claim) claim.addEventListener('click', () => this._save(id, { owner_id: me }));
    ov.querySelector('#qd-save').addEventListener('click', () => {
      const payload = {
        title: ov.querySelector('#qd-title').value.trim(),
        type: ov.querySelector('#qd-type').value,
        severity: ov.querySelector('#qd-sev').value,
        status: ov.querySelector('#qd-status').value,
      };
      const notesEl = ov.querySelector('#qd-notes');
      if (notesEl) payload.notes = notesEl.value;
      this._save(id, payload);
    });
  },

  async _save(id, payload) {
    try {
      await API.put(`/quality/cases/${id}`, payload);
      if (typeof Toast !== 'undefined') Toast.success?.('품질 케이스 저장 완료');
      Modal.close();
      await this._load();
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('저장 실패: ' + (e.message || e));
    }
  },

  _openForm() {
    if (typeof Modal === 'undefined') return;
    const custOpts = ['<option value="">고객사 선택…</option>']
      .concat(this._customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`))
      .join('');
    const typeOpt = this._TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    const sevOpt = Object.entries(this._SEV).map(([k, v]) => `<option value="${k}"${k === 'medium' ? ' selected' : ''}>${v}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    Modal.open({
      title: '새 품질 케이스',
      width: 560,
      body: `
        <div class="ql-form">
          <div class="ql-fld"><span>고객사 *</span><select id="qn-cust">${custOpts}</select></div>
          <div class="ql-fld"><span>유형</span><select id="qn-type">${typeOpt}</select></div>
          <div class="ql-fld"><span>심각도</span><select id="qn-sev">${sevOpt}</select></div>
          <div class="ql-fld"><span>발생일</span><input type="date" id="qn-opened" value="${today}"></div>
          <div class="ql-fld full"><span>제목 *</span><input type="text" id="qn-title" placeholder="예: 식각가스 VOC — 평택 P4 순도 편차"></div>
          <div class="ql-fld full"><span>비고(원인·분석)</span><textarea id="qn-notes" rows="3"></textarea></div>
        </div>
        <div class="ql-actions">
          <button class="btn btn-ghost" id="qn-cancel">취소</button>
          <button class="btn btn-primary" id="qn-save">등록</button>
        </div>`,
    });
    const ov = document.getElementById('modal-overlay');
    ov.querySelector('#qn-cancel').addEventListener('click', () => Modal.close());
    ov.querySelector('#qn-save').addEventListener('click', async () => {
      const customer_id = ov.querySelector('#qn-cust').value;
      const title = ov.querySelector('#qn-title').value.trim();
      if (!customer_id) return Toast?.error?.('고객사를 선택하세요');
      if (!title) return Toast?.error?.('제목을 입력하세요');
      try {
        await API.post('/quality/cases', {
          customer_id: Number(customer_id),
          type: ov.querySelector('#qn-type').value,
          severity: ov.querySelector('#qn-sev').value,
          opened_at: ov.querySelector('#qn-opened').value || null,
          title,
          notes: ov.querySelector('#qn-notes').value || null,
        });
        if (typeof Toast !== 'undefined') Toast.success?.('품질 케이스 등록 완료');
        Modal.close();
        await this._load();
      } catch (e) {
        if (typeof Toast !== 'undefined') Toast.error?.('등록 실패: ' + (e.message || e));
      }
    });
  },
};
