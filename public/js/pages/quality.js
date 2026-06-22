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
  _filter: { status: 'unresolved', type: '', severity: '', priority: '', q: '', customer_id: '', mine: false, sla: '' },
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
  // 워크플로우 — 고객지원(A/S) 동일 상태
  _ST: {
    received: '접수',
    registered: '등록',
    assigned: '할당',
    in_progress: '처리중',
    on_hold: '보류',
    resolved: '조치완료',
    dropped: '드롭',
  },
  _CLOSED: ['resolved', 'dropped'],
  _PRIO: { urgent: '긴급', high: '높음', normal: '보통', low: '낮음' },
  _CHAN: { audit: '고객감사', email: '이메일', visit: '방문', phone: '전화', portal: '포털', etc: '기타' },
  _members: [],

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
        .ql-st-received{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .ql-st-registered{background:rgba(35,87,232,.12);color:#2357E8}
        .ql-st-assigned{background:rgba(35,87,232,.12);color:#2357E8}
        .ql-st-in_progress{background:rgba(245,156,0,.14);color:#b45309}
        .ql-st-on_hold{background:rgba(120,120,120,.14);color:#666}
        .ql-st-resolved{background:rgba(23,168,90,.12);color:#17A85A}
        .ql-st-dropped{background:var(--surface-2,rgba(0,0,0,.05));color:var(--text-3)}
        /* 처리 이력 타임라인 */
        .ql-hist{list-style:none;margin:0;padding:0;font-size:12px}
        .ql-hist li{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--text-2)}
        .ql-hist .t{color:var(--text-3);white-space:nowrap;font-variant-numeric:tabular-nums}
        .ql-files{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}
        .ql-files li{display:flex;align-items:center;gap:8px;padding:4px 0}
        .ql-files a{color:var(--text-1);text-decoration:none}
        .ql-files a:hover{text-decoration:underline}
        .ql-8d{border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface-2,rgba(0,0,0,.02))}
        .ql-8d>summary{font-size:12.5px;font-weight:700;color:var(--text-1);cursor:pointer}
        .ql-bell-btn{position:relative}
        .ql-bell-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:var(--oci-red);color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
        .ql-notif{list-style:none;margin:0;padding:0}
        .ql-notif li{display:flex;gap:8px;align-items:flex-start;padding:9px 4px;border-bottom:1px solid var(--border);cursor:pointer}
        .ql-notif li.unread{background:rgba(230,51,41,.04)}
        .ql-notif li:hover{background:var(--surface-2,rgba(0,0,0,.03))}
        .ql-notif .t{font-size:11px;color:var(--text-3);white-space:nowrap}
        .ql-notif-dot{width:7px;height:7px;border-radius:50%;background:var(--oci-red);margin-top:5px;flex-shrink:0}
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
        <button class="btn btn-ghost ql-bell-btn" id="ql-bell" title="내 알림 (이관·할당)">🔔<span class="ql-bell-badge" id="ql-bell-badge" hidden></span></button>
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
    // 담당자 목록 (이관·할당 셀렉트) — App.team 우선, 없으면 빈 배열
    this._members =
      (typeof App !== 'undefined' && Array.isArray(App.team) && App.team.length && App.team) || [];
    document.getElementById('ql-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]');
      if (b) this._setView(b.dataset.view);
    });
    document.getElementById('ql-new').addEventListener('click', () => this._openForm());
    document.getElementById('ql-export').addEventListener('click', () => this._exportCsv());
    document.getElementById('ql-bell').addEventListener('click', () => this._openNotifModal());
    this._renderFilters();
    await this._load();
    this._loadNotifs();
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

  // ── 필터 (뷰별) — 검색·내담당은 인라인, 컬럼 필터는 우상단 FilterPopover ──
  _renderFilters() {
    const el = document.getElementById('ql-filters');
    const custOptions = [{ value: '', label: '고객사 전체' }].concat(
      this._customers.map(c => ({ value: String(c.id), label: c.name }))
    );

    if (this._view === 'cases') {
      const f = this._filter;
      el.innerHTML = `
        <input type="text" id="qf-q" placeholder="제목·케이스번호 검색" value="${esc(f.q)}">
        <label class="ql-chk"><input type="checkbox" id="qf-mine"${f.mine ? ' checked' : ''}> 내 담당만</label>
        <span style="margin-left:auto">${FilterPopover.renderButton('qf-flt')}</span>
      `;
      this._bindSearch('qf-q', v => (f.q = v));
      document.getElementById('qf-mine').addEventListener('change', e => {
        f.mine = e.target.checked;
        this._load();
      });
      FilterPopover.attach({
        buttonId: 'qf-flt',
        fields: [
          { key: 'status', label: '상태', type: 'select', options: [{ value: 'unresolved', label: '미해결(전체)' }, ...Object.entries(this._ST).map(([k, v]) => ({ value: k, label: v })), { value: '', label: '전체' }] },
          { key: 'type', label: '유형', type: 'select', options: [{ value: '', label: '전체' }, ...this._TYPES.map(t => ({ value: t, label: t }))] },
          { key: 'severity', label: '심각도', type: 'select', options: [{ value: '', label: '전체' }, ...Object.entries(this._SEV).map(([k, v]) => ({ value: k, label: v }))] },
          { key: 'priority', label: '우선순위', type: 'select', options: [{ value: '', label: '전체' }, ...Object.entries(this._PRIO).map(([k, v]) => ({ value: k, label: v }))] },
          { key: 'customer_id', label: '고객사', type: 'select', options: custOptions },
          { key: 'sla', label: 'SLA', type: 'select', options: [{ value: '', label: '전체' }, { value: 'overdue', label: 'SLA 초과만' }] },
        ],
        values: { status: f.status, type: f.type, severity: f.severity, priority: f.priority || '', customer_id: f.customer_id, sla: f.sla },
        onApply: v => {
          Object.assign(f, v);
          this._load();
        },
      });
    } else {
      const f = this._docFilter;
      el.innerHTML = `
        <input type="text" id="df-q" placeholder="문서번호·소재 검색" value="${esc(f.q)}">
        <span style="margin-left:auto">${FilterPopover.renderButton('df-flt')}</span>
      `;
      this._bindSearch('df-q', v => (f.q = v));
      FilterPopover.attach({
        buttonId: 'df-flt',
        fields: [
          { key: 'status', label: '만료 상태', type: 'select', options: [{ value: '', label: '전체' }, { value: 'attention', label: '주의(만료·임박)' }, { value: 'expired', label: '만료' }, { value: 'expiring', label: '임박(≤30일)' }] },
          { key: 'doc_type', label: '문서유형', type: 'select', options: [{ value: '', label: '전체' }, ...this._DOC_TYPES.map(t => ({ value: t, label: t }))] },
          { key: 'customer_id', label: '고객사', type: 'select', options: custOptions },
        ],
        values: { status: f.status, doc_type: f.doc_type, customer_id: f.customer_id },
        onApply: v => {
          Object.assign(f, v);
          this._load();
        },
      });
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
      if (f.priority) qs.set('priority', f.priority);
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

  // 고객360 으로 이동 — 기본 '공급 자격(qualification)' 탭 (품질 케이스·문서가 있는 화면)
  _gotoCustomer(customerId, tab) {
    try {
      localStorage.setItem('c360_last', String(customerId));
    } catch (_) {
      /* noop */
    }
    location.hash = '#customer360/' + customerId + '/' + (tab || 'qualification');
  },

  // ── 인앱 알림 (이관·할당) ────────────────────────────────────
  async _loadNotifs() {
    try {
      const r = await API.get('/quality/notifications');
      this._notifs = r.data || [];
      this._notifUnread = r.unread || 0;
    } catch (_) {
      this._notifs = [];
      this._notifUnread = 0;
    }
    const badge = document.getElementById('ql-bell-badge');
    if (badge) {
      if (this._notifUnread > 0) {
        badge.textContent = this._notifUnread > 99 ? '99+' : String(this._notifUnread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  },
  _openNotifModal() {
    if (typeof Modal === 'undefined') return;
    const rows = this._notifs || [];
    const body = rows.length
      ? `<ul class="ql-notif">${rows
          .map(
            n => `<li data-nid="${n.id}" data-case="${n.case_id}" data-caseno="${esc(n.case_no || '')}" class="${n.is_read ? '' : 'unread'}">
              ${n.is_read ? '' : '<span class="ql-notif-dot"></span>'}
              <div style="flex:1;min-width:0">
                <div>${esc(n.message)}</div>
                <div class="t">${esc(n.created_at || '')}</div>
              </div></li>`
          )
          .join('')}</ul>`
      : '<div class="ql-empty" style="padding:24px">새 알림이 없습니다.</div>';
    Modal.open({
      title: '내 알림 — 이관·할당',
      width: 480,
      body: `${body}<div class="ql-actions">${rows.some(n => !n.is_read) ? '<button class="btn btn-ghost" id="qn-readall">모두 읽음</button>' : ''}<button class="btn btn-primary" id="qn-close">닫기</button></div>`,
    });
    const ov = document.getElementById('modal-overlay');
    ov.querySelector('#qn-close').addEventListener('click', () => Modal.close());
    ov.querySelector('#qn-readall')?.addEventListener('click', async () => {
      try {
        await API.post('/quality/notifications/read-all', {});
      } catch (_) {
        /* noop */
      }
      await this._loadNotifs();
      Modal.close();
    });
    ov.querySelectorAll('.ql-notif li[data-nid]').forEach(li =>
      li.addEventListener('click', () => this._openNotifCase(li.dataset))
    );
  },
  async _openNotifCase(ds) {
    const nid = Number(ds.nid);
    const caseId = Number(ds.case);
    const caseNo = ds.caseno;
    try {
      await API.post(`/quality/notifications/${nid}/read`, {});
    } catch (_) {
      /* noop */
    }
    Modal.close();
    // 케이스번호로 검색해 확실히 로드 후 상세 열기
    this._view = 'cases';
    this._filter = { ...this._filter, status: '', sla: '', priority: '', q: caseNo };
    this._renderFilters();
    await this._load();
    await this._loadNotifs();
    if (this._cases.find(c => c.id === caseId)) this._openDetail(caseId);
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
    const selOpts = (mapObj, cur) =>
      Object.entries(mapObj).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const typeOpt = this._TYPES.map(t => `<option value="${t}"${t === c.type ? ' selected' : ''}>${t}</option>`).join('');
    const me = (typeof App !== 'undefined' && App.currentUser && App.currentUser.id) || null;
    const claimBtn = me && c.owner_id !== me ? '<button class="btn btn-ghost" id="qd-claim">내가 담당</button>' : '';
    const slaLine =
      this._CLOSED.includes(c.status) || c.due_date === null || c.due_date === undefined
        ? ''
        : `<div class="ql-fld"><span>처리기한(SLA)</span><input type="text" value="${this._fmtDate(c.due_date)} (${
            c.days_left < 0 ? '초과 ' + -c.days_left + '일' : 'D-' + c.days_left
          })" disabled></div>`;
    Modal.open({
      title: `${esc(c.case_no)} — 품질 케이스`,
      width: 620,
      body: `
        <div class="ql-form">
          <div class="ql-fld"><span>고객사</span><input type="text" value="${esc(c.customer_name)}" disabled></div>
          <div class="ql-fld"><span>소재</span><input type="text" value="${esc(c.material_name ? c.material_name.split(' · ')[0] : '-')}" disabled></div>
          <div class="ql-fld full"><span>제목</span><input type="text" id="qd-title" value="${esc(c.title)}"></div>
          <div class="ql-fld full"><span>접수내용 (고객 제기 원문·상세)</span><textarea id="qd-description" rows="3" placeholder="접수된 이슈 상세 내용">${esc(c.description || '')}</textarea></div>
          <div class="ql-fld"><span>유형</span><select id="qd-type">${typeOpt}</select></div>
          <div class="ql-fld"><span>심각도</span><select id="qd-sev">${selOpts(this._SEV, c.severity)}</select></div>
          <div class="ql-fld"><span>처리우선순위</span><select id="qd-prio">${selOpts(this._PRIO, c.priority || 'normal')}</select></div>
          <div class="ql-fld"><span>상태</span><select id="qd-status">${selOpts(this._ST, c.status)}</select></div>
          <div class="ql-fld"><span>접수경로</span><select id="qd-channel"><option value="">-</option>${selOpts(this._CHAN, c.channel || '')}</select></div>
          <div class="ql-fld"><span>처리기한 지정</span><input type="date" id="qd-due" value="${esc(c.due_date_set || '')}"></div>
          <div class="ql-fld"><span>접수자</span><input type="text" value="${esc(c.created_by_name || '-')}" disabled></div>
          <div class="ql-fld"><span>담당(처리)</span><input type="text" value="${esc(c.owner_name || '미배정')}" disabled></div>
          ${slaLine}
          <div class="ql-fld full"><span>접수처리내용</span><textarea id="qd-resolution" rows="3" placeholder="조치 내용·진행 경과">${esc(c.resolution || '')}</textarea></div>
          ${this._restricted ? '' : `<div class="ql-fld full"><span>비고(원인·분석)</span><textarea id="qd-notes" rows="2">${esc(c.notes || '')}</textarea></div>`}
          <div class="ql-fld full"><details class="ql-8d"${c.root_cause || c.preventive_action || c.defect_code ? ' open' : ''}>
            <summary>8D / CAPA 분석 — 근본원인·시정·재발방지·효과검증</summary>
            <div class="ql-form" style="margin-top:10px">
              <div class="ql-fld"><span>불량/결함코드</span><input type="text" id="qd-defect-code" value="${esc(c.defect_code || '')}" placeholder="예: ETCH-PURITY"></div>
              <div class="ql-fld"><span>Lot 번호</span><input type="text" id="qd-lot" value="${esc(c.lot_no || '')}"></div>
              <div class="ql-fld"><span>불량수량</span><input type="number" step="0.01" id="qd-defect-qty" value="${c.defect_qty ?? ''}"></div>
              <div class="ql-fld"><span>수량 단위</span><input type="text" id="qd-defect-unit" value="${esc(c.defect_unit || '')}" placeholder="ea/kg/L"></div>
              <div class="ql-fld"><span>고객 클레임번호</span><input type="text" id="qd-cust-ref" value="${esc(c.customer_ref_no || '')}"></div>
              <div class="ql-fld"><span>효과검증 완료일</span><input type="date" id="qd-verified-at" value="${esc(c.verified_at || '')}"></div>
              <div class="ql-fld full"><label class="ql-chk"><input type="checkbox" id="qd-recurring"${c.is_recurring ? ' checked' : ''}> 재발 건 (동일 이슈 반복)</label></div>
              <div class="ql-fld full"><span>근본원인 (RCA)</span><textarea id="qd-root" rows="2" placeholder="5Why·특성요인 분석 결과">${esc(c.root_cause || '')}</textarea></div>
              <div class="ql-fld full"><span>시정조치 (즉시)</span><textarea id="qd-correction" rows="2" placeholder="당장의 봉쇄·교체·재작업">${esc(c.correction || '')}</textarea></div>
              <div class="ql-fld full"><span>재발방지 (CAPA)</span><textarea id="qd-preventive" rows="2" placeholder="공정·관리 표준 개정 등 근본 대책">${esc(c.preventive_action || '')}</textarea></div>
              <div class="ql-fld full"><span>효과검증</span><textarea id="qd-verification" rows="2" placeholder="대책 적용 후 결과 확인">${esc(c.verification || '')}</textarea></div>
            </div>
          </details></div>
          <div class="ql-fld full"><span>첨부 (불량사진·8D·분석리포트)</span>
            <div id="qd-files"><div class="ql-sub">불러오는 중…</div></div>
            <input type="file" id="qd-file-input" multiple style="margin-top:6px;font-size:12px">
          </div>
          <div class="ql-fld full"><span>처리 이력</span><div id="qd-history"><div class="ql-sub">불러오는 중…</div></div></div>
        </div>
        <div class="ql-actions">
          <button class="btn btn-ghost" id="qd-open360">고객360에서 열기</button>
          <button class="btn btn-ghost" id="qd-transfer">이관</button>
          ${claimBtn}
          <button class="btn btn-primary" id="qd-save">저장</button>
        </div>`,
    });
    const ov = document.getElementById('modal-overlay');
    ov.querySelector('#qd-open360').addEventListener('click', () => {
      Modal.close();
      this._gotoCustomer(c.customer_id);
    });
    ov.querySelector('#qd-transfer').addEventListener('click', () => this._openTransferModal(c));
    const claim = ov.querySelector('#qd-claim');
    if (claim) claim.addEventListener('click', () => this._save(id, { owner_id: me }));
    ov.querySelector('#qd-save').addEventListener('click', () => {
      const payload = {
        title: ov.querySelector('#qd-title').value.trim(),
        description: ov.querySelector('#qd-description').value,
        type: ov.querySelector('#qd-type').value,
        severity: ov.querySelector('#qd-sev').value,
        priority: ov.querySelector('#qd-prio').value,
        status: ov.querySelector('#qd-status').value,
        channel: ov.querySelector('#qd-channel').value || '',
        due_date: ov.querySelector('#qd-due').value || '',
        resolution: ov.querySelector('#qd-resolution').value,
      };
      const notesEl = ov.querySelector('#qd-notes');
      if (notesEl) payload.notes = notesEl.value;
      // 8D/CAPA 도메인
      Object.assign(payload, {
        defect_code: ov.querySelector('#qd-defect-code').value || '',
        lot_no: ov.querySelector('#qd-lot').value || '',
        defect_qty: ov.querySelector('#qd-defect-qty').value || '',
        defect_unit: ov.querySelector('#qd-defect-unit').value || '',
        customer_ref_no: ov.querySelector('#qd-cust-ref').value || '',
        verified_at: ov.querySelector('#qd-verified-at').value || '',
        is_recurring: ov.querySelector('#qd-recurring').checked ? 1 : 0,
        root_cause: ov.querySelector('#qd-root').value || '',
        correction: ov.querySelector('#qd-correction').value || '',
        preventive_action: ov.querySelector('#qd-preventive').value || '',
        verification: ov.querySelector('#qd-verification').value || '',
      });
      this._save(id, payload);
    });
    // 첨부 업로드
    ov.querySelector('#qd-file-input').addEventListener('change', e => this._uploadQFiles(id, e.target.files));
    // 첨부·이력 비동기 로드
    this._loadQFiles(id);
    this._loadQHistory(id);
  },

  async _loadQFiles(id) {
    const host = document.getElementById('qd-files');
    if (!host) return;
    try {
      const r = await API.get(`/quality/cases/${id}/files`);
      const rows = r.data || [];
      host.innerHTML = rows.length
        ? `<ul class="ql-files">${rows
            .map(
              f => `<li>📎 <a href="/api/quality/cases/${id}/files/${f.id}" target="_blank" rel="noopener">${esc(f.file_name)}</a>
                <span class="ql-sub">${f.uploaded_by_name ? esc(f.uploaded_by_name) + ' · ' : ''}${esc(f.created_at || '')}</span>
                <button class="lc-mini" data-qfile-del="${f.id}" style="color:var(--oci-red);margin-left:auto">삭제</button></li>`
            )
            .join('')}</ul>`
        : '<div class="ql-sub">첨부 없음</div>';
      host.querySelectorAll('[data-qfile-del]').forEach(b =>
        b.addEventListener('click', () => this._delQFile(id, Number(b.dataset.qfileDel)))
      );
    } catch (_) {
      host.innerHTML = '<div class="ql-sub">첨부를 불러오지 못했습니다.</div>';
    }
  },
  async _uploadQFiles(id, fileList) {
    if (!fileList || !fileList.length) return;
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    try {
      await API._upload(`/quality/cases/${id}/files`, fd);
      if (typeof Toast !== 'undefined') Toast.success?.('첨부 업로드 완료');
      this._loadQFiles(id);
      this._loadQHistory(id);
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('업로드 실패: ' + (e.message || e));
    }
  },
  async _delQFile(id, fileId) {
    if (!confirm('첨부를 삭제하시겠습니까?')) return;
    try {
      await API.del(`/quality/cases/${id}/files/${fileId}`);
      this._loadQFiles(id);
    } catch (_) {
      /* Toast */
    }
  },
  async _loadQHistory(id) {
    const host = document.getElementById('qd-history');
    if (!host) return;
    const fieldLabel = { status: '상태', owner_id: '담당/이관', created: '접수', file: '첨부' };
    const valLabel = (field, v) => {
      if (v === null || v === undefined || v === '') return '-';
      if (field === 'status') return this._ST[v] || v;
      if (field === 'owner_id') {
        const m = (this._members || []).find(x => String(x.id) === String(v));
        return m ? m.name : '#' + v;
      }
      return v;
    };
    try {
      const r = await API.get(`/quality/cases/${id}/history`);
      const rows = r.data || [];
      host.innerHTML = rows.length
        ? `<ul class="ql-hist">${rows
            .map(h => {
              const who = h.changed_by_name ? esc(h.changed_by_name) : '시스템';
              const change =
                h.field === 'created'
                  ? '접수됨'
                  : `${fieldLabel[h.field] || h.field}: ${esc(valLabel(h.field, h.from_value))} → <b>${esc(valLabel(h.field, h.to_value))}</b>`;
              return `<li><span class="t">${esc(h.changed_at || '')}</span><span>${change}${h.note ? ' · ' + esc(h.note) : ''} <span class="ql-sub">(${who})</span></span></li>`;
            })
            .join('')}</ul>`
        : '<div class="ql-sub">이력 없음</div>';
    } catch (_) {
      host.innerHTML = '<div class="ql-sub">이력을 불러오지 못했습니다.</div>';
    }
  },
  _openTransferModal(c) {
    if (typeof Modal === 'undefined') return;
    const memOpts = ['<option value="">미배정</option>']
      .concat(
        (this._members || []).map(
          m => `<option value="${m.id}"${String(m.id) === String(c.owner_id) ? ' selected' : ''}>${esc(m.name)}</option>`
        )
      )
      .join('');
    Modal.open({
      title: `${esc(c.case_no)} — 이관 (담당 변경)`,
      width: 440,
      body: `<div class="ql-form">
          <div class="ql-fld full"><span>현재 담당</span><input type="text" value="${esc(c.owner_name || '미배정')}" disabled></div>
          <div class="ql-fld full"><span>이관 대상</span><select id="qt-owner">${memOpts}</select></div>
          <div class="ql-fld full"><span>이관 사유</span><textarea id="qt-note" rows="2" placeholder="예: 생산팀 원인분석 필요"></textarea></div>
        </div>
        <div class="ql-actions"><button class="btn btn-ghost" id="qt-cancel">취소</button><button class="btn btn-primary" id="qt-save">이관</button></div>`,
    });
    const ov = document.getElementById('modal-overlay');
    ov.querySelector('#qt-cancel').addEventListener('click', () => Modal.close());
    ov.querySelector('#qt-save').addEventListener('click', async () => {
      const owner_id = ov.querySelector('#qt-owner').value || null;
      const note = ov.querySelector('#qt-note').value || null;
      try {
        await API.patch(`/quality/cases/${c.id}/transfer`, { owner_id, note });
        if (typeof Toast !== 'undefined') Toast.success?.('이관 완료');
        Modal.close();
        await this._load();
      } catch (e) {
        if (typeof Toast !== 'undefined') Toast.error?.('이관 실패: ' + (e.message || e));
      }
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
    const prioOpt = Object.entries(this._PRIO).map(([k, v]) => `<option value="${k}"${k === 'normal' ? ' selected' : ''}>${v}</option>`).join('');
    const chanOpt = ['<option value="">접수경로 -</option>'].concat(Object.entries(this._CHAN).map(([k, v]) => `<option value="${k}">${v}</option>`)).join('');
    const today = new Date().toISOString().slice(0, 10);
    Modal.open({
      title: '새 품질 케이스',
      width: 560,
      body: `
        <div class="ql-form">
          <div class="ql-fld"><span>고객사 *</span><select id="qn-cust">${custOpts}</select></div>
          <div class="ql-fld"><span>유형</span><select id="qn-type">${typeOpt}</select></div>
          <div class="ql-fld"><span>심각도</span><select id="qn-sev">${sevOpt}</select></div>
          <div class="ql-fld"><span>처리우선순위</span><select id="qn-prio">${prioOpt}</select></div>
          <div class="ql-fld"><span>접수경로</span><select id="qn-channel">${chanOpt}</select></div>
          <div class="ql-fld"><span>발생일</span><input type="date" id="qn-opened" value="${today}"></div>
          <div class="ql-fld full"><span>제목 *</span><input type="text" id="qn-title" placeholder="예: 식각가스 VOC — 평택 P4 순도 편차"></div>
          <div class="ql-fld full"><span>접수내용 (고객 제기 원문·상세)</span><textarea id="qn-description" rows="3" placeholder="접수된 이슈 상세 내용"></textarea></div>
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
          description: ov.querySelector('#qn-description').value || null,
          priority: ov.querySelector('#qn-prio').value,
          channel: ov.querySelector('#qn-channel').value || null,
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
