// =============================================================
// 전사 품질관리 (Quality Inbox)
//   고객사별로 흩어진 품질 케이스(VOC/NCR/Audit/PCN/CoA)를 한곳에서
//   조회·필터·처리. 데이터 원천: quality_cases (고객360과 동일).
//   권한: 전원 조회 / 담당건·팀장+ 편집.
// =============================================================
const QualityPage = {
  _filter: { status: 'unresolved', type: '', severity: '', q: '', customer_id: '', mine: false },
  _cases: [],
  _summary: null,
  _customers: [],
  _restricted: false,

  _TYPES: ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'],
  _SEV: { high: '높음', medium: '보통', low: '낮음' },
  _ST: { open: '미해결', in_progress: '처리중', resolved: '완료' },

  async render() {
    document.getElementById('content').innerHTML = `
      <style>
        .ql-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px}
        .ql-bar h2{font-size:20px;font-weight:700;margin:0}
        .ql-sub{font-size:12px;color:var(--text-3)}
        .ql-bar .spacer{flex:1}
        .ql-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
        .ql-kpi{border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--surface)}
        .ql-kpi .l{font-size:12px;color:var(--text-2);font-weight:600}
        .ql-kpi .v{font-size:26px;font-weight:700;margin-top:4px;color:var(--text-1);font-variant-numeric:tabular-nums}
        .ql-kpi .s{font-size:11px;color:var(--text-3);margin-top:2px}
        .ql-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
        .ql-filters select,.ql-filters input[type=text]{padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .ql-filters input[type=text]{min-width:200px}
        .ql-chk{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--text-2);cursor:pointer}
        .ql-tbl{table-layout:fixed;width:100%;font-size:12.5px}
        .ql-tbl col.c-no{width:11%}.ql-tbl col.c-cust{width:13%}.ql-tbl col.c-title{width:24%}
        .ql-tbl col.c-mat{width:13%}.ql-tbl col.c-sev{width:8%}.ql-tbl col.c-st{width:8%}
        .ql-tbl col.c-own{width:9%}.ql-tbl col.c-age{width:7%}
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
        .ql-age-warn{color:var(--oci-red);font-weight:700}
        .ql-empty{padding:40px;text-align:center;color:var(--text-3)}
        .ql-form{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        .ql-fld{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-2)}
        .ql-fld.full{grid-column:1/-1}
        .ql-fld input,.ql-fld select,.ql-fld textarea{padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .ql-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
      </style>
      <div class="ql-bar">
        <h2>품질관리</h2><span class="ql-sub" id="ql-sub">전사 품질 케이스</span>
        <span class="spacer"></span>
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
    this._renderFilters();
    document.getElementById('ql-new').addEventListener('click', () => this._openForm());
    await this._load();
  },

  _renderFilters() {
    const f = this._filter;
    const opt = (val, label, cur) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    const custOpts = this._customers.map(c => opt(String(c.id), esc(c.name), f.customer_id)).join('');
    const el = document.getElementById('ql-filters');
    el.innerHTML = `
      <select id="qf-status">
        ${opt('unresolved', '미해결+처리중', f.status)}${opt('open', '미해결', f.status)}${opt('in_progress', '처리중', f.status)}${opt('resolved', '완료', f.status)}${opt('', '전체', f.status)}
      </select>
      <select id="qf-type">${opt('', '유형 전체', f.type)}${this._TYPES.map(t => opt(t, t, f.type)).join('')}</select>
      <select id="qf-sev">${opt('', '심각도 전체', f.severity)}${Object.entries(this._SEV).map(([k, v]) => opt(k, v, f.severity)).join('')}</select>
      <select id="qf-cust">${opt('', '고객사 전체', f.customer_id)}${custOpts}</select>
      <input type="text" id="qf-q" placeholder="제목·케이스번호 검색" value="${esc(f.q)}">
      <label class="ql-chk"><input type="checkbox" id="qf-mine"${f.mine ? ' checked' : ''}> 내 담당만</label>
    `;
    const reload = () => {
      f.status = document.getElementById('qf-status').value;
      f.type = document.getElementById('qf-type').value;
      f.severity = document.getElementById('qf-sev').value;
      f.customer_id = document.getElementById('qf-cust').value;
      f.mine = document.getElementById('qf-mine').checked;
      this._load();
    };
    ['qf-status', 'qf-type', 'qf-sev', 'qf-cust'].forEach(id => document.getElementById(id).addEventListener('change', reload));
    document.getElementById('qf-mine').addEventListener('change', reload);
    let t;
    document.getElementById('qf-q').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => {
        f.q = e.target.value.trim();
        this._load();
      }, 300);
    });
  },

  async _load() {
    const f = this._filter;
    const qs = new URLSearchParams();
    if (f.status) qs.set('status', f.status);
    if (f.type) qs.set('type', f.type);
    if (f.severity) qs.set('severity', f.severity);
    if (f.customer_id) qs.set('customer_id', f.customer_id);
    if (f.q) qs.set('q', f.q);
    if (f.mine) qs.set('mine', '1');
    try {
      const [sum, list] = await Promise.all([
        API.get('/quality/summary'),
        API.get('/quality/cases?' + qs.toString()),
      ]);
      this._summary = sum.data;
      this._cases = list.data || [];
      this._restricted = !!list.detail_restricted;
    } catch (_) {
      this._cases = [];
    }
    this._renderKpis();
    this._renderList();
  },

  _renderKpis() {
    const s = this._summary || {};
    const card = (l, v, sub, danger) =>
      `<div class="ql-kpi"><div class="l">${l}</div><div class="v"${danger && v ? ' style="color:var(--oci-red)"' : ''}>${v}</div><div class="s">${sub}</div></div>`;
    document.getElementById('ql-kpis').innerHTML =
      card('미해결', `${s.open_total ?? 0}건`, '처리 대기+진행', true) +
      card('High 심각도', `${s.high_open ?? 0}건`, '미해결 중 긴급', true) +
      card('처리중', `${s.in_progress ?? 0}건`, '담당 배정·진행') +
      card('이번 달 신규', `${s.new_this_month ?? 0}건`, '당월 발생') +
      card('평균 해결일수', s.avg_resolve_days === null || s.avg_resolve_days === undefined ? '-' : `${s.avg_resolve_days}일`, '완료 기준');
  },

  _renderList() {
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
          <td>${esc(c.owner_name || '-')}</td>
          <td class="num ${aged ? 'ql-age-warn' : ''}">${c.opened_at ? (c.age_days ?? '-') + '일' : '-'}</td>
        </tr>`;
      })
      .join('');
    host.innerHTML = `<table class="data-table ql-tbl">
      <colgroup><col class="c-no"><col class="c-cust"><col class="c-title"><col class="c-mat"><col><col class="c-sev"><col class="c-st"><col class="c-own"><col class="c-age"></colgroup>
      <thead><tr>
        <th>케이스번호</th><th>고객사</th><th>제목</th><th>소재</th><th>유형</th>
        <th class="num">심각도</th><th class="num">상태</th><th>담당</th><th class="num">경과</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
    host.querySelectorAll('tbody tr[data-id]').forEach(tr =>
      tr.addEventListener('click', () => this._openDetail(Number(tr.dataset.id)))
    );
  },

  _openDetail(id) {
    const c = this._cases.find(x => x.id === id);
    if (!c || typeof Modal === 'undefined') return;
    const sevOpt = Object.entries(this._SEV).map(([k, v]) => `<option value="${k}"${k === c.severity ? ' selected' : ''}>${v}</option>`).join('');
    const stOpt = Object.entries(this._ST).map(([k, v]) => `<option value="${k}"${k === c.status ? ' selected' : ''}>${v}</option>`).join('');
    const typeOpt = this._TYPES.map(t => `<option value="${t}"${t === c.type ? ' selected' : ''}>${t}</option>`).join('');
    const me = (typeof App !== 'undefined' && App.currentUser && App.currentUser.id) || null;
    const claimBtn = me && c.owner_id !== me ? '<button class="btn btn-ghost" id="qd-claim">내가 담당</button>' : '';
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
      try {
        localStorage.setItem('c360_last', String(c.customer_id));
      } catch (_) {
        /* noop */
      }
      Modal.close();
      location.hash = '#customer360';
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
