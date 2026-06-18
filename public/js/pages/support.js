// =============================================================
// 고객지원(A/S) 페이지 — 목록/칸반 + 접수 + 상세(상태·조치·댓글·첨부·이력) + 설정형 관리  [P1-C/D]
//   고객/계약 모달 연동 = P1-E
//   상태/유형/우선순위/채널은 설정형(support_settings) — 라벨·색 동적 (⚙️ 설정, 관리자 전용)
//   목록↔칸반 뷰 토글(ViewToggle, localStorage 'sup_view'), 칸반 드래그→상태 전환
// =============================================================
const SupportPage = {
  _settings: null, // { status:[], type:[], priority:[], channel:[] }
  _team: null, // [{id,name,role}] — 접수자/처리담당자 선택 [W1]
  _filter: {
    q: '',
    status: '',
    mine: false,
    assigned_to: '',
    created_by: '',
    type: '',
    priority: '',
    customer_id: '',
    from: '',
    to: '',
    overdue: '', // [SLA] '1' = 기한초과
    due: '', // [SLA] 'today' = 오늘 처리예정
  },
  _t: null,
  _view: 'list', // 'list'(목록) | 'card'(칸반)
  _boardSortables: null,

  async render() {
    try {
      this._view = localStorage.getItem('sup_view') === 'card' ? 'card' : 'list';
    } catch (_) {
      this._view = 'list';
    }
    document.getElementById('content').innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h1 style="margin:0;font-size:20px">고객지원 <span style="font-size:13px;font-weight:400;color:var(--text-3)">A/S 티켓</span></h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" id="sup-notif" title="내 고객지원 알림" style="position:relative">🔔<span id="sup-notif-badge" style="display:none;position:absolute;top:-5px;right:-5px;background:var(--oci-red);color:#fff;font-size:10px;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;padding:0 3px">0</span></button>
          ${['admin', 'superadmin'].includes(App.currentUser?.role) ? '<button class="btn btn-ghost" id="sup-settings" title="상태·유형·우선순위·채널 관리 (관리자)">⚙️ 설정</button>' : ''}
          <button class="btn btn-primary" id="sup-new">+ 접수</button>
        </div>
      </div>
      <div id="sup-kpis" style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 0"></div>
      <div style="display:flex;gap:8px;align-items:center;margin:14px 0;flex-wrap:wrap">
        <input class="form-control" id="sup-q" placeholder="제목·티켓번호·요청자 검색" style="max-width:280px">
        <select class="form-control" id="sup-fl-status" style="max-width:160px"><option value="">전체 상태</option></select>
        <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;white-space:nowrap"><input type="checkbox" id="sup-fl-mine"> 내 담당</label>
        <button class="btn btn-ghost" id="sup-fl-toggle" title="상세 필터">🔎 필터<span id="sup-fl-count" style="display:none;margin-left:5px;background:var(--oci-red);color:#fff;font-size:10px;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;padding:0 4px"></span></button>
        <div id="sup-view-toggle" style="margin-left:auto">${ViewToggle.render({ currentView: this._view, listLabel: '목록', cardLabel: '칸반' })}</div>
      </div>
      <div id="sup-filter-panel" style="display:none;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;background:#fafafa">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">처리담당자</label><select class="form-control" id="sup-fl-assignee" style="max-width:150px"><option value="">전체</option></select></div>
          <div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">접수자</label><select class="form-control" id="sup-fl-creator" style="max-width:150px"><option value="">전체</option></select></div>
          <div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">유형</label><select class="form-control" id="sup-fl-type" style="max-width:130px"><option value="">전체</option></select></div>
          <div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">우선순위</label><select class="form-control" id="sup-fl-priority" style="max-width:130px"><option value="">전체</option></select></div>
          <div style="position:relative"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">고객사</label><input class="form-control" id="sup-fl-customer" placeholder="고객사명" style="max-width:160px" autocomplete="off"><input type="hidden" id="sup-fl-customer-id"></div>
          <div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:3px">접수기간</label><div style="display:flex;gap:4px;align-items:center"><input type="date" class="form-control" id="sup-fl-from" style="max-width:140px"><span style="color:var(--text-3)">~</span><input type="date" class="form-control" id="sup-fl-to" style="max-width:140px"></div></div>
          <div style="display:flex;gap:6px;margin-left:auto"><button class="btn btn-ghost btn-sm" id="sup-fl-reset">초기화</button><button class="btn btn-primary btn-sm" id="sup-fl-apply">적용</button></div>
        </div>
      </div>
      <div id="sup-list"><div class="loading" style="padding:30px;text-align:center;color:var(--text-3)">불러오는 중...</div></div>
    `;
    document.getElementById('sup-new').addEventListener('click', () => this.openForm());
    document
      .getElementById('sup-settings')
      ?.addEventListener('click', () => this.openSettings());
    document
      .getElementById('sup-notif')
      ?.addEventListener('click', () => this.openNotifications());
    document.getElementById('sup-q').addEventListener('input', e => {
      this._filter.q = e.target.value;
      clearTimeout(this._t);
      this._t = setTimeout(() => this.loadList(), 250);
    });
    document.getElementById('sup-fl-status').addEventListener('change', e => {
      this._filter.status = e.target.value;
      this.loadList();
    });
    document.getElementById('sup-fl-mine')?.addEventListener('change', e => {
      this._filter.mine = e.target.checked;
      this.loadList();
    });
    // [F4] 상세 필터 패널 토글/적용/초기화
    document.getElementById('sup-fl-toggle')?.addEventListener('click', () => {
      const p = document.getElementById('sup-filter-panel');
      if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('sup-fl-apply')?.addEventListener('click', () => this._applyFilters());
    document.getElementById('sup-fl-reset')?.addEventListener('click', () => this._resetFilters());
    ViewToggle.bind(
      '#sup-view-toggle',
      view => {
        this._view = view;
        this._applyView();
      },
      'sup_view'
    );
    await this.loadSettings();
    await this.loadTeam();
    this._fillStatusFilter();
    this._fillFilterPanel(); // [F4] 상세 필터 옵션 채움 (담당자/접수자/유형/우선순위 + 고객사 Combobox)
    this._applyView(); // 초기 뷰 반영 (상태필터 표시여부 + 목록/칸반 렌더)
    this.loadNotifications(); // 🔔 미읽음 배지
    this._checkDue(); // [SLA-3] 진입 시 기한 도래 알림 (하루 1회, 중복 방지)
  },
  // [SLA-3] 진입 시 내 담당 기한 도래/초과 알림 생성 → 🔔 배지 갱신
  async _checkDue() {
    try {
      const r = await API.support.checkDue();
      if (r && r.created) this.loadNotifications();
    } catch (_) {
      /* 무시 */
    }
  },

  async loadTeam() {
    if (this._team) return this._team;
    try {
      this._team = (await API.team.list()).data || [];
    } catch (_) {
      this._team = [];
    }
    return this._team;
  },
  _teamOptions(selectedId) {
    const sel =
      selectedId !== null && selectedId !== undefined && selectedId !== '' ? String(selectedId) : '';
    return (
      '<option value="">미지정</option>' +
      (this._team || [])
        .map(
          m =>
            `<option value="${m.id}" ${String(m.id) === sel ? 'selected' : ''}>${esc(m.name)}${m.role ? ' (' + esc(m.role) + ')' : ''}</option>`
        )
        .join('')
    );
  },
  // [F3] 관련담당자(watchers) — 멀티셀렉트 옵션 / 파싱 / 수집 / 표시
  _watcherOptions(selectedIds) {
    const sel = new Set((selectedIds || []).map(String));
    return (this._team || [])
      .map(
        m =>
          `<option value="${m.id}" ${sel.has(String(m.id)) ? 'selected' : ''}>${esc(m.name)}${m.role ? ' (' + esc(m.role) + ')' : ''}</option>`
      )
      .join('');
  },
  _parseWatchers(raw) {
    if (!raw) return [];
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(arr) ? arr.filter(w => w && w.id) : [];
    } catch (_) {
      return [];
    }
  },
  // [W3] 허용 다음 상태(JSON 배열) 파싱
  _parseAllowed(raw) {
    if (!raw) return [];
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch (_) {
      return [];
    }
  },
  // [W3] 상태 전이 허용 여부 (from→to). from 의 allowed_next 미설정 시 모두 허용
  _canTransition(fromKey, toKey) {
    if (!fromKey || fromKey === toKey) return true;
    const st = (this._settings?.status || []).find(s => s.item_key === fromKey);
    const allowed = this._parseAllowed(st?.allowed_next);
    return allowed.length === 0 || allowed.includes(toKey);
  },
  _collectWatchers(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions)
      .map(o => ({
        id: parseInt(o.value, 10),
        name: (this._team || []).find(m => String(m.id) === o.value)?.name || o.textContent,
      }))
      .filter(w => w.id);
  },
  _watcherNames(raw) {
    const ws = this._parseWatchers(raw);
    return ws.length ? ws.map(w => esc(w.name || w.id)).join(', ') : '-';
  },
  _today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  // ── 인앱 알림 (할당/완료 → 담당자/접수자) [W2] ──
  async loadNotifications() {
    const badge = document.getElementById('sup-notif-badge');
    if (!badge) return;
    try {
      const res = await API.support.notifications();
      const u = res.unread || 0;
      badge.textContent = u > 99 ? '99+' : String(u);
      badge.style.display = u > 0 ? '' : 'none';
    } catch (_) {
      badge.style.display = 'none';
    }
  },
  _notifRow(n) {
    return `
      <div data-notif-id="${n.id}" data-notif-ticket="${n.ticket_id}" style="padding:9px 10px;border-bottom:1px solid var(--border);cursor:pointer;${n.is_read ? 'opacity:.55' : ''}">
        <div style="font-size:13px">${esc(n.message)}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">
          ${esc(n.ticket_no || '')}${n.title ? ' · ' + esc(n.title) : ''} · ${Fmt.date(n.created_at)}${n.is_read ? '' : ' · <span style="color:var(--oci-red)">● 새 알림</span>'}
        </div>
      </div>`;
  },
  async openNotifications() {
    let rows;
    try {
      rows = (await API.support.notifications()).data || [];
    } catch (e) {
      return Toast.error('알림 조회 실패: ' + (e?.message || e));
    }
    Modal.open({
      title: '🔔 고객지원 알림',
      width: 480,
      body: `<div id="sup-notif-list" style="max-height:60vh;overflow-y:auto">${
        rows.length
          ? rows.map(n => this._notifRow(n)).join('')
          : '<div style="padding:28px;text-align:center;color:var(--text-3)">알림이 없습니다</div>'
      }</div>`,
      footer: `<button class="btn btn-ghost" id="sup-notif-readall">모두 읽음</button><button class="btn btn-primary" id="sup-notif-close">닫기</button>`,
      bind: {
        '#sup-notif-close': () => Modal.close(),
        '#sup-notif-readall': () => this._markAllNotif(),
      },
      onOpen: () => {
        document.querySelectorAll('#sup-notif-list [data-notif-ticket]').forEach(el =>
          el.addEventListener('click', () => {
            const nid = el.dataset.notifId;
            const tid = parseInt(el.dataset.notifTicket, 10);
            API.support.markNotificationRead(nid).catch(() => {});
            Modal.close();
            this.loadNotifications();
            if (tid) this.openDetail(tid);
          })
        );
      },
    });
  },
  async _markAllNotif() {
    try {
      await API.support.markAllNotificationsRead();
      Toast.success('모두 읽음 처리되었습니다');
      Modal.close();
      this.loadNotifications();
    } catch (e) {
      Toast.error('실패: ' + (e?.message || e));
    }
  },

  _applyView() {
    // 칸반에서는 상태필터 숨김 (컬럼 자체가 상태)
    const fl = document.getElementById('sup-fl-status');
    if (fl) fl.style.display = this._view === 'card' ? 'none' : '';
    this.loadList();
  },

  async loadSettings() {
    if (this._settings) return this._settings;
    try {
      this._settings = (await API.support.settings()).data || {
        status: [],
        type: [],
        priority: [],
        channel: [],
      };
    } catch (_) {
      this._settings = { status: [], type: [], priority: [], channel: [] };
    }
    return this._settings;
  },
  _label(kind, key) {
    const it = (this._settings?.[kind] || []).find(s => s.item_key === key);
    return it ? it.label : key || '-';
  },
  _color(kind, key) {
    const it = (this._settings?.[kind] || []).find(s => s.item_key === key);
    return it ? it.color || 'gray' : 'gray';
  },
  _badge(kind, key) {
    if (!key) return '-';
    return `<span class="badge badge-${esc(this._color(kind, key))}">${esc(this._label(kind, key))}</span>`;
  },
  _fillStatusFilter() {
    const sel = document.getElementById('sup-fl-status');
    if (!sel) return;
    sel.innerHTML =
      '<option value="">전체 상태</option>' +
      (this._settings.status || [])
        .map(s => `<option value="${esc(s.item_key)}">${esc(s.label)}</option>`)
        .join('');
    sel.value = this._filter.status || ''; // 재빌드 시 선택값 보존
  },
  // [F4] 상세 필터 패널 — 옵션 채움 + 고객사 Combobox 연결
  _fillFilterPanel() {
    const setOpts = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };
    const teamOpts =
      '<option value="">전체</option>' +
      (this._team || []).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    setOpts('sup-fl-assignee', teamOpts);
    setOpts('sup-fl-creator', teamOpts);
    setOpts(
      'sup-fl-type',
      '<option value="">전체</option>' +
        (this._settings?.type || [])
          .map(s => `<option value="${esc(s.item_key)}">${esc(s.label)}</option>`)
          .join('')
    );
    setOpts(
      'sup-fl-priority',
      '<option value="">전체</option>' +
        (this._settings?.priority || [])
          .map(s => `<option value="${esc(s.item_key)}">${esc(s.label)}</option>`)
          .join('')
    );
    this._attachCustomer('sup-fl-customer', 'sup-fl-customer-id'); // 고객사 Combobox (폼과 동일)
  },
  _applyFilters() {
    const v = id => (document.getElementById(id)?.value || '').trim();
    this._filter.assigned_to = v('sup-fl-assignee');
    this._filter.created_by = v('sup-fl-creator');
    this._filter.type = v('sup-fl-type');
    this._filter.priority = v('sup-fl-priority');
    this._filter.customer_id = v('sup-fl-customer-id');
    this._filter.from = v('sup-fl-from');
    this._filter.to = v('sup-fl-to');
    this._updateFilterCount();
    this.loadList();
  },
  _resetFilters() {
    [
      'sup-fl-assignee',
      'sup-fl-creator',
      'sup-fl-type',
      'sup-fl-priority',
      'sup-fl-customer',
      'sup-fl-customer-id',
      'sup-fl-from',
      'sup-fl-to',
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    Object.assign(this._filter, {
      assigned_to: '',
      created_by: '',
      type: '',
      priority: '',
      customer_id: '',
      from: '',
      to: '',
    });
    this._updateFilterCount();
    this.loadList();
  },
  _updateFilterCount() {
    const f = this._filter;
    const n = ['assigned_to', 'created_by', 'type', 'priority', 'customer_id', 'from', 'to'].filter(
      k => f[k]
    ).length;
    const badge = document.getElementById('sup-fl-count');
    if (badge) {
      badge.textContent = String(n);
      badge.style.display = n > 0 ? '' : 'none';
    }
  },

  // ── [SLA] 대시보드 KPI 카드 (미해결/오늘예정/기한초과/내담당/미배정) ──
  async loadDashboard() {
    const wrap = document.getElementById('sup-kpis');
    if (!wrap) return;
    try {
      const d = (await API.support.dashboard()).data || {};
      this._renderKpis(wrap, d);
    } catch (_) {
      wrap.innerHTML = '';
    }
  },
  _renderKpis(wrap, d) {
    const f = this._filter;
    const card = (key, label, value, color, active, clickable) =>
      `<div ${clickable ? `data-kpi="${key}"` : ''} style="flex:1;min-width:108px;background:#fff;border:1px solid ${active ? 'var(--oci-red)' : 'var(--border)'};border-left:3px solid ${color};border-radius:8px;padding:9px 12px;${clickable ? 'cursor:pointer;' : ''}${active ? 'box-shadow:0 0 0 2px rgba(230,51,41,.12)' : ''}">
        <div style="font-size:11px;color:var(--text-3)">${label}</div>
        <div style="font-size:20px;font-weight:700;color:${color}">${value}</div>
      </div>`;
    wrap.innerHTML =
      card('open', '미해결', d.open || 0, '#2563eb', false, false) +
      card('due', '오늘 예정', d.due_today || 0, '#d97706', f.due === 'today', true) +
      card('overdue', '기한초과', d.overdue || 0, '#dc2626', f.overdue === '1', true) +
      card('mine', '내 담당', d.mine_open || 0, '#0891b2', !!f.mine, true) +
      card('unassigned', '미배정', d.unassigned || 0, '#6b7280', false, false);
    wrap
      .querySelectorAll('[data-kpi]')
      .forEach(el => el.addEventListener('click', () => this._kpiClick(el.dataset.kpi)));
  },
  _kpiClick(kind) {
    const f = this._filter;
    if (kind === 'overdue') {
      f.overdue = f.overdue === '1' ? '' : '1';
      f.due = '';
    } else if (kind === 'due') {
      f.due = f.due === 'today' ? '' : 'today';
      f.overdue = '';
    } else if (kind === 'mine') {
      f.mine = !f.mine;
      const cb = document.getElementById('sup-fl-mine');
      if (cb) cb.checked = f.mine;
    }
    this.loadList();
  },
  // 처리예정일(due_at) → D-Day 배지 (종결/미설정 시 없음)
  _dueBadge(t) {
    if (!t.due_at) return '';
    const isFinal = (this._settings?.status || []).find(s => s.item_key === t.status)?.is_final;
    if (isFinal) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(t.due_at);
    if (isNaN(due)) return '';
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due - today) / 86400000);
    let color = 'gray';
    let label = `D-${diff}`;
    if (diff < 0) {
      color = 'red';
      label = `D+${-diff}`;
    } else if (diff === 0) {
      color = 'amber';
      label = 'D-DAY';
    } else if (diff <= 3) {
      color = 'amber';
    }
    return `<span class="badge badge-${color}" style="font-size:10px">${label}</span>`;
  },

  async loadList() {
    const wrap = document.getElementById('sup-list');
    if (!wrap) return;
    const board = this._view === 'card';
    const mineId = this._filter.mine && App.currentUser?.id ? App.currentUser.id : undefined;
    try {
      const f = this._filter;
      const r = await API.support.list({
        q: f.q,
        status: board ? '' : f.status, // 칸반은 컬럼이 상태 → 상태필터 미적용
        assigned_to: mineId || f.assigned_to || undefined, // 내 담당 우선, 없으면 필터 담당자
        created_by: f.created_by || undefined, // [F4] 접수자
        type: f.type || undefined, // [F4] 유형
        priority: f.priority || undefined, // [F4] 우선순위
        customer_id: f.customer_id || undefined, // [F4] 고객사
        from: f.from || undefined, // [F4] 접수기간 시작
        to: f.to || undefined, // [F4] 접수기간 끝
        overdue: f.overdue || undefined, // [SLA] 기한초과
        due: f.due || undefined, // [SLA] 오늘 처리예정
        limit: board ? 200 : 100,
      });
      const rows = r.data || [];
      if (board) this.renderBoard(wrap, rows);
      else this.renderTable(wrap, rows);
    } catch (e) {
      wrap.innerHTML = `<div style="padding:16px;color:#dc2626">목록 조회 실패: ${esc(e?.message || e)}</div>`;
    }
    this.loadDashboard(); // [SLA] KPI 카드 동기화 (비차단)
  },

  renderTable(wrap, rows) {
    if (!rows.length) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3)">접수된 지원건이 없습니다 — [+ 접수]로 등록하세요</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>티켓번호</th><th>제목</th><th>고객사</th><th>유형</th><th>우선순위</th><th>상태</th><th>담당</th><th>처리예정</th><th>접수일</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              t => `
            <tr data-sup-id="${t.id}" style="cursor:pointer">
              <td class="mono" style="font-size:12px">${esc(t.ticket_no || '-')}</td>
              <td><strong>${esc(t.title)}</strong></td>
              <td>${esc(t.customer_name || '-')}</td>
              <td>${this._badge('type', t.type)}</td>
              <td>${this._badge('priority', t.priority)}</td>
              <td>${this._badge('status', t.status)}</td>
              <td>${esc(t.assigned_name || '-')}</td>
              <td style="white-space:nowrap">${t.due_at ? Fmt.date(t.due_at) + ' ' + this._dueBadge(t) : '-'}</td>
              <td>${Fmt.date(t.created_at)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
    wrap.querySelectorAll('[data-sup-id]').forEach(tr =>
      tr.addEventListener('click', () => this.openDetail(parseInt(tr.dataset.supId, 10)))
    );
  },

  // ── 칸반 보드 (상태별 컬럼 + 드래그로 상태 전환) ── [P1-D]
  renderBoard(wrap, rows) {
    const statuses = this._settings?.status || [];
    const active = statuses.filter(s => s.is_active);
    const activeKeys = active.map(s => s.item_key);
    // 데이터에 있으나 비활성/미정의 상태도 컬럼으로 노출 (티켓 누락 방지)
    const extra = [...new Set(rows.map(t => t.status).filter(k => k && !activeKeys.includes(k)))].map(
      k => statuses.find(s => s.item_key === k) || { item_key: k, label: k, color: 'gray' }
    );
    const columns = [...active, ...extra];
    if (!columns.length) {
      wrap.innerHTML =
        '<div style="padding:30px;text-align:center;color:var(--text-3)">표시할 상태가 없습니다 — ⚙️ 설정에서 상태를 추가하세요</div>';
      return;
    }
    const byStatus = {};
    rows.forEach(t => {
      (byStatus[t.status] = byStatus[t.status] || []).push(t);
    });
    wrap.innerHTML = `
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;align-items:flex-start">
        ${columns
          .map(col => {
            const items = byStatus[col.item_key] || [];
            return `
          <div class="sup-col" data-status="${esc(col.item_key)}" style="min-width:236px;width:236px;flex-shrink:0;background:#F9FAFB;border:1px solid var(--border);border-radius:10px">
            <div style="padding:9px 11px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
              <span class="badge badge-${esc(col.color || 'gray')}">${esc(col.label)}</span>
              <span class="sup-col-count" style="font-size:12px;color:var(--text-3)">${items.length}</span>
            </div>
            <div class="sup-col-body" data-status="${esc(col.item_key)}" style="padding:8px;min-height:80px;max-height:calc(100vh - 290px);overflow-y:auto">
              ${items.map(t => this._boardCard(t)).join('')}
            </div>
          </div>`;
          })
          .join('')}
      </div>`;
    wrap.querySelectorAll('.sup-card').forEach(c =>
      c.addEventListener('click', () => this.openDetail(parseInt(c.dataset.supId, 10)))
    );
    // 드래그(컬럼 간) → 상태 변경
    (this._boardSortables || []).forEach(s => {
      try {
        s.destroy();
      } catch (_) {
        /* 이미 해제됨 */
      }
    });
    this._boardSortables = [];
    if (typeof Sortable !== 'undefined') {
      wrap.querySelectorAll('.sup-col-body').forEach(body => {
        this._boardSortables.push(
          new Sortable(body, {
            group: 'sup-board',
            animation: 150,
            onEnd: evt => {
              const id = parseInt(evt.item.dataset.supId, 10);
              const to = evt.to.dataset.status;
              const from = evt.from.dataset.status;
              if (!to || to === from) return this._refreshBoardCounts();
              // [W3] 전이 규칙 위반 시 원복(재렌더) + 안내
              if (!this._canTransition(from, to)) {
                const fl = (this._settings?.status || []).find(s => s.item_key === from);
                const tl = (this._settings?.status || []).find(s => s.item_key === to);
                Toast.error(`'${fl?.label || from}' → '${tl?.label || to}' 전이는 허용되지 않습니다`);
                return this.loadList(); // 서버 상태로 원복
              }
              this._boardMove(id, to);
            },
          })
        );
      });
    }
  },
  _boardCard(t) {
    return `
      <div class="sup-card" data-sup-id="${t.id}" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.05)">
        <div style="font-size:11px;color:var(--text-3);font-family:monospace">${esc(t.ticket_no || '-')}</div>
        <div style="font-size:13px;font-weight:600;margin:2px 0;line-height:1.3">${esc(t.title)}</div>
        <div style="font-size:11px;color:var(--text-2)">${esc(t.customer_name || '-')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span style="display:flex;gap:4px;align-items:center">${this._badge('priority', t.priority)}${this._dueBadge(t)}</span>
          <span style="font-size:11px;color:var(--text-3)">${esc(t.assigned_name || '미배정')}</span>
        </div>
      </div>`;
  },
  _refreshBoardCounts() {
    document.querySelectorAll('.sup-col').forEach(col => {
      const body = col.querySelector('.sup-col-body');
      const cnt = col.querySelector('.sup-col-count');
      if (body && cnt) cnt.textContent = body.querySelectorAll('.sup-card').length;
    });
  },
  async _boardMove(id, status) {
    this._refreshBoardCounts(); // 카드는 이미 이동됨 → 카운트만 갱신
    try {
      await API.support.update(id, { status });
      Toast.success('상태 변경: ' + this._label('status', status));
    } catch (e) {
      Toast.error('상태 변경 실패: ' + (e?.message || e));
      this.loadList(); // 실패 시 서버 상태로 원복
    }
  },

  // ── 접수 (신규 등록) ──
  openForm() {
    const opts = (kind, withEmpty) =>
      (withEmpty ? '<option value="">선택</option>' : '') +
      (this._settings?.[kind] || [])
        .map(s => `<option value="${esc(s.item_key)}">${esc(s.label)}</option>`)
        .join('');
    Modal.open({
      title: '🎫 고객지원 접수',
      width: 560,
      body: `
        <div class="form-grid">
          <div class="form-field full">
            <label class="form-label">제목 <span style="color:var(--oci-red)">*</span></label>
            <input class="form-control" id="sup-f-title" placeholder="예: 로그인 후 화면 멈춤">
          </div>
          <div class="form-field">
            <label class="form-label">고객사 <span style="font-size:11px;color:var(--text-3)">(2글자+ 검색)</span></label>
            <input class="form-control" id="sup-f-customer" placeholder="고객사 검색" autocomplete="off">
            <input type="hidden" id="sup-f-customer-id">
          </div>
          <div class="form-field">
            <label class="form-label">관련 영업딜 <span style="font-size:11px;color:var(--text-3)">(선택 시 고객사 자동)</span></label>
            <input class="form-control" id="sup-f-lead" placeholder="영업딜 검색" autocomplete="off">
            <input type="hidden" id="sup-f-lead-id">
          </div>
          <div class="form-field">
            <label class="form-label">유형</label>
            <select class="form-control" id="sup-f-type">${opts('type', true)}</select>
          </div>
          <div class="form-field">
            <label class="form-label">우선순위</label>
            <select class="form-control" id="sup-f-priority">${opts('priority', false)}</select>
          </div>
          <div class="form-field">
            <label class="form-label">접수 채널</label>
            <select class="form-control" id="sup-f-channel">${opts('channel', true)}</select>
          </div>
          <div class="form-field">
            <label class="form-label">접수자</label>
            <select class="form-control" id="sup-f-creator">${this._teamOptions(App.currentUser?.id)}</select>
          </div>
          <div class="form-field">
            <label class="form-label">처리담당자</label>
            <select class="form-control" id="sup-f-assignee">${this._teamOptions(null)}</select>
          </div>
          <div class="form-field full">
            <label class="form-label">관련담당자 <span style="font-size:11px;color:var(--text-3)">(유관부서 협업·정보공유 · Ctrl/⌘+클릭으로 복수 선택)</span></label>
            <select class="form-control" id="sup-f-watchers" multiple size="4">${this._watcherOptions([])}</select>
          </div>
          <div class="form-field">
            <label class="form-label">처리요청일 <span style="font-size:11px;color:var(--text-3)">(고객 희망)</span></label>
            <input type="date" class="form-control" id="sup-f-reqdate">
          </div>
          <div class="form-field">
            <label class="form-label">처리예정일</label>
            <input type="date" class="form-control" id="sup-f-due">
          </div>
          <div class="form-field">
            <label class="form-label">요청자 (고객측)</label>
            <input class="form-control" id="sup-f-rname" placeholder="이름">
          </div>
          <div class="form-field">
            <label class="form-label">요청자 연락처</label>
            <input class="form-control" id="sup-f-rphone" placeholder="010-0000-0000">
          </div>
          <div class="form-field full">
            <label class="form-label">내용</label>
            <textarea class="form-control" id="sup-f-desc" rows="3" placeholder="증상/요청 내용"></textarea>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="sup-f-cancel">취소</button><button class="btn btn-primary" id="sup-f-save">접수</button>`,
      bind: {
        '#sup-f-cancel': () => Modal.close(),
        '#sup-f-save': () => this._saveNew(),
      },
      onOpen: () => {
        const pr = document.getElementById('sup-f-priority');
        if (pr) pr.value = 'normal';
        const rq = document.getElementById('sup-f-reqdate');
        if (rq) rq.value = this._today(); // 처리요청일 기본=오늘
        this._attachCustomer('sup-f-customer', 'sup-f-customer-id');
        this._attachLead('sup-f-lead', 'sup-f-lead-id');
      },
    });
  },

  // 영업딜 Combobox — 선택 시 고객사 자동 채움(비어있을 때)
  _attachLead(inputId, hiddenId) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    if (!input || typeof Combobox === 'undefined') return;
    input.addEventListener('input', () => {
      if (hidden) hidden.value = '';
    });
    Combobox.attach({
      inputEl: input,
      fetchFn: async q => {
        try {
          return (await API.leads.autocomplete(q, 10)).data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) =>
        `<div class="combobox-item-content"><div class="combobox-item-title">📇 ${highlightMatch(item.customer_name || '', q)}${item.project_name ? ' - ' + highlightMatch(item.project_name, q) : ''}</div></div>`,
      onSelect: item => {
        input.value = `${item.customer_name || ''}${item.project_name ? ' - ' + item.project_name : ''}`;
        if (hidden) hidden.value = item.id;
        // 고객사 미입력 시 자동 채움
        const custInput = document.getElementById('sup-f-customer');
        const custHidden = document.getElementById('sup-f-customer-id');
        if (item.customer_id && custHidden && !custHidden.value) {
          custHidden.value = item.customer_id;
          if (custInput && item.customer_name) custInput.value = item.customer_name;
        }
      },
      minChars: 2,
      debounceMs: 250,
    });
  },

  _attachCustomer(inputId, hiddenId) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    if (!input || typeof Combobox === 'undefined') return;
    input.addEventListener('input', () => {
      if (hidden) hidden.value = '';
    });
    Combobox.attach({
      inputEl: input,
      fetchFn: async q => {
        try {
          return (await API.customers.autocomplete(q, 10)).data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) =>
        `<div class="combobox-item-content"><div class="combobox-item-title">🏢 ${highlightMatch(item.name, q)}</div></div>`,
      onSelect: item => {
        input.value = item.name;
        if (hidden) hidden.value = item.id;
      },
      minChars: 2,
      debounceMs: 250,
    });
  },

  async _saveNew() {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const title = v('sup-f-title');
    if (!title) return Toast.error('제목을 입력하세요');
    const body = {
      title,
      customer_id: parseInt(v('sup-f-customer-id'), 10) || null,
      lead_id: parseInt(v('sup-f-lead-id'), 10) || null,
      type: v('sup-f-type') || null,
      priority: v('sup-f-priority') || 'normal',
      channel: v('sup-f-channel') || null,
      created_by: parseInt(v('sup-f-creator'), 10) || null,
      assigned_to: parseInt(v('sup-f-assignee'), 10) || null,
      watchers: this._collectWatchers(document.getElementById('sup-f-watchers')),
      requested_at: v('sup-f-reqdate') || null,
      due_at: v('sup-f-due') || null,
      requester_name: v('sup-f-rname') || null,
      requester_phone: v('sup-f-rphone') || null,
      description: v('sup-f-desc') || null,
    };
    try {
      const r = await API.support.create(body);
      Toast.success(`접수되었습니다 (${r.ticket_no || ''})`);
      Modal.close();
      this.loadList();
    } catch (e) {
      Toast.error('접수 실패: ' + (e?.message || e));
    }
  },

  // ── 상세 (메타 + 상태 빠른변경 + 처리/첨부/이력 탭) ──
  async openDetail(id) {
    let t;
    try {
      t = (await API.support.get(id)).data;
    } catch (e) {
      return Toast.error('조회 실패: ' + (e?.message || e));
    }
    if (!t) return Toast.error('지원건을 찾을 수 없습니다');
    this._curId = id;
    this._tabLoaded = { history: false };
    const meta = (label, val) =>
      `<div><div style="font-size:11px;color:var(--text-3)">${label}</div><div style="font-size:13px">${val}</div></div>`;
    // [W3] 현재 상태 + 허용 다음 상태만 노출 (allowed_next 미설정 시 전체)
    const statusOpts = (this._settings?.status || [])
      .filter(s => s.item_key === t.status || this._canTransition(t.status, s.item_key))
      .map(
        s =>
          `<option value="${esc(s.item_key)}" ${s.item_key === t.status ? 'selected' : ''}>${esc(s.label)}</option>`
      )
      .join('');
    const tabBtn = (key, label) =>
      `<button type="button" class="sup-tab" data-tab="${key}" style="background:none;border:none;border-bottom:2px solid transparent;padding:7px 13px;cursor:pointer;font-size:13px;color:var(--text-2)">${label}</button>`;
    Modal.open({
      title: `${esc(t.ticket_no || '지원건')} · ${esc(t.title)}`,
      width: 640,
      confirmOnClose: false,
      body: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px 16px;background:#F9FAFB;border:1px solid var(--border);border-radius:10px;padding:13px 16px;margin-bottom:14px">
          ${meta('고객사', t.customer_id ? `<span data-go-customer="${t.customer_id}" style="color:var(--oci-red);cursor:pointer;text-decoration:underline">${esc(t.customer_name || '고객사')}</span>` : esc(t.customer_name || '-'))}
          ${meta('관련 영업리드', t.lead_id ? `<span data-go-lead="${t.lead_id}" style="color:var(--oci-red);cursor:pointer;text-decoration:underline">${esc(t.lead_name || '영업리드')}</span>` : esc(t.lead_name || '-'))}
          ${meta('유형', this._badge('type', t.type))}
          ${meta('우선순위', this._badge('priority', t.priority))}
          ${meta('채널', esc(this._label('channel', t.channel)))}
          ${meta('요청자', esc(t.requester_name || '-') + (t.requester_phone ? ` · ${esc(t.requester_phone)}` : ''))}
          ${meta('처리담당자', esc(t.assigned_name || '-'))}
          ${meta('접수자', esc(t.created_by_name || '-'))}
          ${meta('관련담당자', this._watcherNames(t.watchers))}
          ${meta('처리요청일', t.requested_at ? Fmt.date(t.requested_at) : '-')}
          ${meta('처리예정일', t.due_at ? Fmt.date(t.due_at) : '-')}
          ${meta('접수일', Fmt.date(t.created_at))}
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <label class="form-label" style="margin:0">상태</label>
          <select class="form-control" id="sup-d-status" style="max-width:150px">${statusOpts}</select>
          <span id="sup-d-status-badge">${this._badge('status', t.status)}</span>
          <label class="form-label" style="margin:0 0 0 8px">담당</label>
          <select class="form-control" id="sup-d-assignee" style="max-width:150px" title="변경 시 재할당(사유 기록)">${this._teamOptions(t.assigned_to)}</select>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <label class="form-label" style="margin:4px 0 0">관련담당자</label>
          <select class="form-control" id="sup-d-watchers" multiple size="3" style="min-width:200px;max-width:280px;flex:1" title="유관부서 협업·정보공유 (Ctrl/⌘+클릭 복수 선택 · [저장] 버튼으로 반영)">${this._watcherOptions(this._parseWatchers(t.watchers).map(w => w.id))}</select>
        </div>
        <div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:12px">
          ${tabBtn('work', '처리')}${tabBtn('files', '첨부 <span id="sup-d-files-cnt"></span>')}${tabBtn('history', '이력')}
        </div>
        <div data-panel="work">
          ${
            t.description
              ? `<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">접수 내용</div><div style="font-size:13px;white-space:pre-wrap;background:#fff;border:1px solid var(--border);border-radius:6px;padding:8px 10px">${esc(t.description)}</div></div>`
              : ''
          }
          <div class="form-field" style="margin-bottom:12px">
            <label class="form-label">조치 내용</label>
            <textarea class="form-control" id="sup-d-resolution" rows="2" placeholder="처리/조치 내용">${esc(t.resolution || '')}</textarea>
          </div>
          <div style="font-size:13px;font-weight:700;margin:6px 0">댓글 <span style="font-size:11px;font-weight:400;color:var(--text-3)">(내부메모 / 고객공개)</span></div>
          <div id="sup-d-comments" style="max-height:200px;overflow-y:auto;margin-bottom:8px"></div>
          <div style="display:flex;gap:6px;align-items:flex-start">
            <textarea class="form-control" id="sup-d-comment" rows="2" placeholder="댓글 입력" style="flex:1"></textarea>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="sup-d-internal"> 내부메모</label>
              <button class="btn btn-sm btn-primary" id="sup-d-add">등록</button>
            </div>
          </div>
        </div>
        <div data-panel="files" style="display:none">
          <div style="margin-bottom:10px">
            <label class="btn btn-sm btn-ghost" style="cursor:pointer">📎 파일 추가
              <input type="file" id="sup-d-file-input" multiple style="display:none">
            </label>
          </div>
          <div id="sup-d-files"><div style="font-size:12px;color:var(--text-3)">불러오는 중...</div></div>
        </div>
        <div data-panel="history" style="display:none">
          <div id="sup-d-history"><div style="font-size:12px;color:var(--text-3)">불러오는 중...</div></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="sup-d-close">닫기</button><button class="btn btn-primary" id="sup-d-save">저장</button>`,
      bind: {
        '#sup-d-close': () => Modal.close(),
        '#sup-d-save': () => this._saveDetail(id),
        '#sup-d-add': () => this._addComment(id),
      },
      onOpen: () => {
        // <select> / 탭버튼 / 파일선택 은 change·click — Modal bind(click only) 밖이라 직접 연결
        document
          .getElementById('sup-d-status')
          ?.addEventListener('change', e => this._changeStatus(id, e.target.value));
        document
          .getElementById('sup-d-assignee')
          ?.addEventListener('change', e => this._changeAssignee(id, e.target.value));
        // [F1] 고객사/영업리드 클릭 → 해당 상세 모달로 이동 (현재 모달 닫고)
        document.querySelector('#modal-box [data-go-customer]')?.addEventListener('click', e => {
          const cid = parseInt(e.currentTarget.dataset.goCustomer, 10);
          Modal.close();
          setTimeout(() => {
            if (typeof CustomersPage !== 'undefined' && CustomersPage.openCustomerModal) {
              CustomersPage.openCustomerModal(cid);
            } else if (typeof App !== 'undefined' && App.navigate) {
              App.navigate('customers');
            }
          }, 80);
        });
        document.querySelector('#modal-box [data-go-lead]')?.addEventListener('click', e => {
          const lid = parseInt(e.currentTarget.dataset.goLead, 10);
          Modal.close();
          setTimeout(() => {
            if (typeof App !== 'undefined' && App.openLeadDetail) App.openLeadDetail(lid);
          }, 80);
        });
        document
          .querySelectorAll('#modal-box .sup-tab')
          .forEach(b => b.addEventListener('click', () => this._supTab(b.dataset.tab)));
        const fi = document.getElementById('sup-d-file-input');
        if (fi) fi.addEventListener('change', () => this._uploadFiles(id, fi.files));
        this._supTab('work');
        this._loadComments(id);
        this._loadFiles(id); // 첨부 개수 배지 + 패널 미리 로드
      },
    });
  },

  // ── 탭 전환 (처리/첨부/이력) ──
  _supTab(name) {
    document.querySelectorAll('#modal-box .sup-tab').forEach(b => {
      const on = b.dataset.tab === name;
      b.style.borderBottomColor = on ? 'var(--oci-red)' : 'transparent';
      b.style.color = on ? 'var(--oci-red)' : 'var(--text-2)';
      b.style.fontWeight = on ? '700' : '400';
    });
    document.querySelectorAll('#modal-box [data-panel]').forEach(p => {
      p.style.display = p.dataset.panel === name ? '' : 'none';
    });
    if (name === 'history' && this._curId && !this._tabLoaded.history) {
      this._tabLoaded.history = true;
      this._loadHistory(this._curId);
    }
  },

  async _loadComments(id) {
    const wrap = document.getElementById('sup-d-comments');
    if (!wrap) return;
    try {
      const rows = (await API.support.comments(id)).data || [];
      wrap.innerHTML = rows.length
        ? rows
            .map(
              c => `
            <div style="border-bottom:1px solid var(--border);padding:6px 2px">
              <div style="font-size:11px;color:var(--text-3)">${esc(c.author_name || '담당자')} · ${Fmt.date(c.created_at)} ${c.is_internal ? '<span style="background:#FEF3C7;color:#92400E;border-radius:4px;padding:0 5px;font-size:10px">내부</span>' : '<span style="background:#DBEAFE;color:#1E40AF;border-radius:4px;padding:0 5px;font-size:10px">공개</span>'}</div>
              <div style="font-size:13px;white-space:pre-wrap">${esc(c.content)}</div>
            </div>`
            )
            .join('')
        : '<div style="font-size:12px;color:var(--text-3);padding:8px 2px">댓글 없음</div>';
    } catch (_) {
      wrap.innerHTML = '<div style="font-size:12px;color:#dc2626">댓글 조회 실패</div>';
    }
  },
  async _addComment(id) {
    const ta = document.getElementById('sup-d-comment');
    const content = (ta?.value || '').trim();
    if (!content) return Toast.error('댓글 내용을 입력하세요');
    try {
      await API.support.addComment(id, {
        content,
        is_internal: document.getElementById('sup-d-internal')?.checked ? 1 : 0,
      });
      ta.value = '';
      const chk = document.getElementById('sup-d-internal');
      if (chk) chk.checked = false;
      this._loadComments(id);
    } catch (e) {
      Toast.error('댓글 등록 실패: ' + (e?.message || e));
    }
  },
  async _changeStatus(id, status) {
    try {
      await API.support.update(id, { status });
      const b = document.getElementById('sup-d-status-badge');
      if (b) b.innerHTML = this._badge('status', status);
      Toast.success('상태가 변경되었습니다');
      // 서버가 이력 1건 추가 → 이력 캐시 무효화 (열려있으면 즉시 갱신)
      if (this._tabLoaded) {
        this._tabLoaded.history = false;
        const hp = document.querySelector('#modal-box [data-panel="history"]');
        if (hp && hp.style.display !== 'none') {
          this._tabLoaded.history = true;
          this._loadHistory(id);
        }
      }
      this.loadList();
    } catch (e) {
      Toast.error('상태 변경 실패: ' + (e?.message || e));
    }
  },
  // 담당자 지정/재할당 (사유 메모 — 이력/알림에 기록) [W2]
  async _changeAssignee(id, toId) {
    const note = (window.prompt('할당/재할당 사유 (선택 — 비워도 됩니다):') || '').trim();
    try {
      await API.support.assign(id, toId ? parseInt(toId, 10) : null, note);
      Toast.success(toId ? '담당자가 지정/변경되었습니다' : '담당자 지정이 해제되었습니다');
      if (this._tabLoaded) {
        this._tabLoaded.history = false;
        const hp = document.querySelector('#modal-box [data-panel="history"]');
        if (hp && hp.style.display !== 'none') {
          this._tabLoaded.history = true;
          this._loadHistory(id);
        }
      }
      this.loadList();
    } catch (e) {
      Toast.error('담당자 변경 실패: ' + (e?.message || e));
    }
  },
  async _saveDetail(id) {
    try {
      await API.support.update(id, {
        resolution: document.getElementById('sup-d-resolution')?.value || '',
        watchers: this._collectWatchers(document.getElementById('sup-d-watchers')),
      });
      Toast.success('저장되었습니다');
      Modal.close();
      this.loadList();
    } catch (e) {
      Toast.error('저장 실패: ' + (e?.message || e));
    }
  },

  // ── 첨부 파일 ──
  _fmtSize(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    if (n < 1024) return n + 'B';
    if (n < 1048576) return Math.round(n / 1024) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
  },
  async _loadFiles(id) {
    const wrap = document.getElementById('sup-d-files');
    const cnt = document.getElementById('sup-d-files-cnt');
    if (!wrap) return;
    try {
      const rows = (await API.support.files(id)).data || [];
      if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : '';
      wrap.innerHTML = rows.length
        ? rows
            .map(
              f => `
            <div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding:6px 2px">
              <span style="flex:1;font-size:13px;cursor:pointer;color:var(--oci-red)" data-dl-file="${f.id}" data-dl-name="${esc(f.file_name)}">📄 ${esc(f.file_name)}</span>
              <span style="font-size:11px;color:var(--text-3)">${this._fmtSize(f.file_size)}${f.uploaded_by_name ? ' · ' + esc(f.uploaded_by_name) : ''} · ${Fmt.date(f.created_at)}</span>
              <button class="btn btn-xs btn-ghost" data-del-file="${f.id}" style="color:#dc2626">삭제</button>
            </div>`
            )
            .join('')
        : '<div style="font-size:12px;color:var(--text-3);padding:8px 2px">첨부 파일 없음</div>';
      wrap.querySelectorAll('[data-dl-file]').forEach(el =>
        el.addEventListener('click', () => this._downloadFile(id, el.dataset.dlFile, el.dataset.dlName))
      );
      wrap.querySelectorAll('[data-del-file]').forEach(el =>
        el.addEventListener('click', () => this._deleteFile(id, el.dataset.delFile))
      );
    } catch (_) {
      wrap.innerHTML = '<div style="font-size:12px;color:#dc2626">첨부 조회 실패</div>';
    }
  },
  async _uploadFiles(id, fileList) {
    if (!fileList || !fileList.length) return;
    const fd = new FormData();
    Array.from(fileList).forEach(f => fd.append('files', f));
    try {
      await API.support.uploadFiles(id, fd);
      Toast.success(`${fileList.length}개 파일 첨부됨`);
      const fi = document.getElementById('sup-d-file-input');
      if (fi) fi.value = '';
      this._loadFiles(id);
    } catch (e) {
      Toast.error('첨부 실패: ' + (e?.message || e));
    }
  },
  async _downloadFile(id, fileId, name) {
    // 헤더 기반 JWT — <a href> 직접 다운로드 불가 → fetch(blob) (proposals 패턴)
    try {
      const token =
        localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
      const userId = localStorage.getItem('current_user_id') || '';
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (userId) headers['X-User-Id'] = userId;
      const resp = await fetch(API.support.downloadFileUrl(id, fileId), {
        headers,
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      Toast.error('다운로드 실패: ' + (e?.message || e));
    }
  },
  async _deleteFile(id, fileId) {
    if (!window.confirm('이 첨부 파일을 삭제할까요?')) return;
    try {
      await API.support.deleteFile(id, fileId);
      Toast.success('삭제되었습니다');
      this._loadFiles(id);
    } catch (e) {
      Toast.error('삭제 실패: ' + (e?.message || e));
    }
  },

  // ── 변경 이력 (감사추적) ──
  _historyLine(h) {
    const who = h.changed_by_name || '시스템';
    let desc;
    if (h.field === 'created') {
      desc = `🎫 접수 생성 <span class="mono" style="font-size:11px">${esc(h.to_value || '')}</span>`;
    } else if (h.field === 'status') {
      desc = `상태 변경 ${this._badge('status', h.from_value)} → ${this._badge('status', h.to_value)}`;
    } else if (h.field === 'assigned_to') {
      desc = h.from_value ? '담당자 변경' : '담당자 지정';
    } else {
      desc = `${esc(h.field)}: ${esc(h.from_value || '-')} → ${esc(h.to_value || '-')}`;
    }
    return `
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:7px 2px;align-items:baseline">
        <div style="font-size:11px;color:var(--text-3);min-width:104px">${Fmt.date(h.changed_at)}</div>
        <div style="flex:1;font-size:13px">${desc}${h.note ? ` <span style="font-size:11px;color:var(--text-3)">(${esc(h.note)})</span>` : ''}</div>
        <div style="font-size:11px;color:var(--text-3)">${esc(who)}</div>
      </div>`;
  },
  async _loadHistory(id) {
    const wrap = document.getElementById('sup-d-history');
    if (!wrap) return;
    try {
      const rows = (await API.support.history(id)).data || [];
      wrap.innerHTML = rows.length
        ? rows.map(h => this._historyLine(h)).join('')
        : '<div style="font-size:12px;color:var(--text-3);padding:8px 2px">변경 이력 없음</div>';
    } catch (_) {
      wrap.innerHTML = '<div style="font-size:12px;color:#dc2626">이력 조회 실패</div>';
    }
  },

  // ── 설정형 관리 (상태/유형/우선순위/채널) — 관리자 전용 ── [P1-D]
  _kindLabel(k) {
    return { status: '상태', type: '유형', priority: '우선순위', channel: '채널' }[k] || k;
  },
  _colorName(c) {
    return { blue: '파랑', green: '초록', amber: '주황', red: '빨강', gray: '회색' }[c] || c;
  },
  openSettings() {
    this._setKind = 'status';
    const tabBtn = (k, label) =>
      `<button type="button" class="set-tab" data-set-tab="${k}" style="background:none;border:none;border-bottom:2px solid transparent;padding:7px 13px;cursor:pointer;font-size:13px;color:var(--text-2)">${label}</button>`;
    Modal.open({
      title: '⚙️ 고객지원 설정',
      width: 700,
      body: `
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">항목을 추가/수정하고 ⠿ 드래그로 순서를 바꿀 수 있습니다. 이미 사용 중인 값은 삭제 대신 <b>활성</b> 체크를 해제(비활성화)하세요.</div>
        <div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:12px">
          ${tabBtn('status', '상태')}${tabBtn('type', '유형')}${tabBtn('priority', '우선순위')}${tabBtn('channel', '채널')}
        </div>
        <div id="sup-set-panel"></div>`,
      footer: `<button class="btn btn-ghost" id="sup-set-close">닫기</button>`,
      bind: { '#sup-set-close': () => Modal.close() },
      onOpen: () => {
        document
          .querySelectorAll('#modal-box .set-tab')
          .forEach(b => b.addEventListener('click', () => this._setTab(b.dataset.setTab)));
        this._setTab('status');
      },
    });
  },
  _setTab(kind) {
    this._setKind = kind;
    document.querySelectorAll('#modal-box .set-tab').forEach(b => {
      const on = b.dataset.setTab === kind;
      b.style.borderBottomColor = on ? 'var(--oci-red)' : 'transparent';
      b.style.color = on ? 'var(--oci-red)' : 'var(--text-2)';
      b.style.fontWeight = on ? '700' : '400';
    });
    this._renderSetKind(kind);
  },
  _setRow(it, kind) {
    const isStatus = kind === 'status';
    const colorOpts = ['blue', 'green', 'amber', 'red', 'gray']
      .map(c => `<option value="${c}" ${it.color === c ? 'selected' : ''}>${this._colorName(c)}</option>`)
      .join('');
    const catMap = { open: '진행', pending: '대기', closed: '종결' };
    const catOpts = ['open', 'pending', 'closed']
      .map(c => `<option value="${c}" ${it.category === c ? 'selected' : ''}>${catMap[c]}</option>`)
      .join('');
    const mainRow = `
      <div class="set-row" data-set-id="${it.id}" style="display:flex;align-items:center;gap:7px;padding:6px 2px;${isStatus ? '' : 'border-bottom:1px solid var(--border);'}${it.is_active ? '' : 'opacity:.5'}">
        <span class="set-handle" style="cursor:grab;color:var(--text-3);user-select:none">⠿</span>
        <input class="form-control set-label" value="${esc(it.label)}" style="flex:1;min-width:70px;height:30px">
        <select class="form-control set-color" style="width:72px;height:30px" title="배지 색">${colorOpts}</select>
        ${
          isStatus
            ? `<select class="form-control set-cat" style="width:68px;height:30px" title="분류">${catOpts}</select>
        <label style="font-size:11px;white-space:nowrap" title="시작 상태"><input type="checkbox" class="set-initial" ${it.is_initial ? 'checked' : ''}>초기</label>
        <label style="font-size:11px;white-space:nowrap" title="종결 상태"><input type="checkbox" class="set-final" ${it.is_final ? 'checked' : ''}>종료</label>`
            : ''
        }
        <label style="font-size:11px;white-space:nowrap" title="비활성 시 신규 선택 불가"><input type="checkbox" class="set-active" ${it.is_active ? 'checked' : ''}>활성</label>
        <button class="btn btn-xs btn-ghost set-del" style="color:#dc2626" title="삭제">🗑</button>
      </div>`;
    if (!isStatus) return mainRow;
    // [W3] status 전용 워크플로우 sub-row — 허용 다음 상태(멀티셀렉트) + 기본 담당자
    const statuses = this._settings?.status || [];
    const allowed = this._parseAllowed(it.allowed_next);
    const allowedOpts = statuses
      .filter(s => s.item_key !== it.item_key)
      .map(
        s =>
          `<option value="${esc(s.item_key)}" ${allowed.includes(s.item_key) ? 'selected' : ''}>${esc(s.label)}</option>`
      )
      .join('');
    const assigneeOpts =
      '<option value="">미지정</option>' +
      (this._team || [])
        .map(
          m =>
            `<option value="${m.id}" ${String(it.default_assignee) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`
        )
        .join('');
    return `
      <div class="set-item" data-set-id="${it.id}">
        ${mainRow}
        <div class="set-wf" data-set-id="${it.id}" style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;padding:3px 2px 9px 26px;border-bottom:1px solid var(--border)${it.is_active ? '' : ';opacity:.5'}">
          <span style="font-size:11px;color:var(--text-3);margin-top:6px">→ 허용 다음 상태 <span style="color:var(--text-3)">(비우면 자유)</span></span>
          <select class="form-control set-allowed" multiple size="3" style="min-width:130px;max-width:210px;height:auto" title="Ctrl/⌘+클릭 복수 — 비우면 모든 전이 허용">${allowedOpts}</select>
          <span style="font-size:11px;color:var(--text-3);margin-top:6px">기본 담당자</span>
          <select class="form-control set-defassignee" style="width:130px;height:30px" title="이 상태 진입 시 미배정이면 자동 배정">${assigneeOpts}</select>
        </div>
      </div>`;
  },
  _renderSetKind(kind) {
    const panel = document.getElementById('sup-set-panel');
    if (!panel) return;
    const items = this._settings?.[kind] || [];
    panel.innerHTML = `
      <div id="sup-set-list">${
        items.map(it => this._setRow(it, kind)).join('') ||
        '<div style="font-size:12px;color:var(--text-3);padding:8px">항목 없음</div>'
      }</div>
      <div style="display:flex;gap:6px;margin-top:12px">
        <input class="form-control" id="sup-set-new" placeholder="새 ${this._kindLabel(kind)} 이름" style="max-width:220px">
        <button class="btn btn-sm btn-primary" id="sup-set-add">+ 추가</button>
      </div>`;
    panel.querySelector('#sup-set-add')?.addEventListener('click', () => this._setAdd(kind));
    panel.querySelector('#sup-set-new')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._setAdd(kind);
    });
    panel.querySelectorAll('.set-row').forEach(row => {
      const id = parseInt(row.dataset.setId, 10);
      row.querySelector('.set-label')?.addEventListener('blur', e => {
        const v = e.target.value.trim();
        if (v) this._setPatch(id, { label: v });
      });
      row.querySelector('.set-color')?.addEventListener('change', e => this._setPatch(id, { color: e.target.value }));
      row.querySelector('.set-active')?.addEventListener('change', e => this._setPatch(id, { is_active: e.target.checked ? 1 : 0 }, true));
      row.querySelector('.set-cat')?.addEventListener('change', e => this._setPatch(id, { category: e.target.value }));
      row.querySelector('.set-initial')?.addEventListener('change', e => this._setPatch(id, { is_initial: e.target.checked ? 1 : 0 }));
      row.querySelector('.set-final')?.addEventListener('change', e => this._setPatch(id, { is_final: e.target.checked ? 1 : 0 }));
      row.querySelector('.set-del')?.addEventListener('click', () => this._setDelete(id, kind));
    });
    // [W3] status 워크플로우 sub-row — 허용 다음 상태 / 기본 담당자 (저장만, 패널 재렌더 없음)
    panel.querySelectorAll('.set-wf').forEach(wf => {
      const id = parseInt(wf.dataset.setId, 10);
      wf.querySelector('.set-allowed')?.addEventListener('change', e => {
        const vals = Array.from(e.target.selectedOptions).map(o => o.value);
        this._setPatch(id, { allowed_next: vals });
      });
      wf.querySelector('.set-defassignee')?.addEventListener('change', e =>
        this._setPatch(id, { default_assignee: e.target.value || null })
      );
    });
    const list = panel.querySelector('#sup-set-list');
    if (list && typeof Sortable !== 'undefined') {
      new Sortable(list, { handle: '.set-handle', animation: 150, onEnd: () => this._setReorder(kind) });
    }
  },
  async _reloadSettings(kind, rerender) {
    this._settings = null;
    await this.loadSettings();
    this._fillStatusFilter();
    if (rerender) this._renderSetKind(kind);
    this.loadList();
  },
  async _setAdd(kind) {
    const inp = document.getElementById('sup-set-new');
    const label = (inp?.value || '').trim();
    if (!label) return Toast.error('이름을 입력하세요');
    try {
      await API.support.settingCreate(kind, { label });
      Toast.success('추가되었습니다');
      if (inp) inp.value = '';
      await this._reloadSettings(kind, true);
    } catch (e) {
      Toast.error('추가 실패: ' + (e?.message || e));
    }
  },
  async _setPatch(id, patch, rerender) {
    try {
      await API.support.settingUpdate(id, patch);
      await this._reloadSettings(this._setKind, !!rerender);
    } catch (e) {
      Toast.error('수정 실패: ' + (e?.message || e));
      this._renderSetKind(this._setKind); // 실패 시 원래 값으로 복원
    }
  },
  async _setDelete(id, kind) {
    if (!window.confirm('이 항목을 삭제할까요?\n(사용 중이면 삭제 불가 — 비활성화를 권장)')) return;
    try {
      await API.support.settingDelete(id);
      Toast.success('삭제되었습니다');
      await this._reloadSettings(kind, true);
    } catch (e) {
      // 409 = 사용 중 → 서버 안내 메시지 노출
      Toast.error(e?.message || '삭제 실패 — 사용 중인 값은 비활성화하세요');
    }
  },
  async _setReorder(kind) {
    const order = Array.from(document.querySelectorAll('#sup-set-list .set-row')).map((r, i) => ({
      id: parseInt(r.dataset.setId, 10),
      sort_order: i + 1,
    }));
    try {
      await API.support.settingReorder(kind, order);
      await this._reloadSettings(kind, false);
    } catch (e) {
      Toast.error('순서 변경 실패: ' + (e?.message || e));
    }
  },
};
