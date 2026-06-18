// ============================================================
// Projects Page (테이블 + Copy & Paste)
// ============================================================
const ProjectsPage = {
  _allProjects: [],
  _selectedIds: new Set(),
  // v6.0.0: 붙여넣기 파싱/등록 공통 BulkPaste 컴포넌트로 이관
  _pasteHandler: null,

  async render() {
    // 단계·상태 관리는 관리자(admin·superadmin) 전용 — 버튼 노출 게이트 (백엔드 adminOnly 와 일치)
    const isProjAdmin = ['admin', 'superadmin'].includes(App.currentUser?.role);
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input type="text" class="search-input" data-placeholder-label="projects.search_placeholder" placeholder="프로젝트 검색..." id="proj-search">
        <button class="btn btn-primary" id="proj-open-form-btn" data-label="projects.new_button">+ 프로젝트 등록</button>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span data-label="projects.list_title">프로젝트 목록</span> <span class="text-muted fs-12" id="proj-count"></span></div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cp-toolbar" id="cp-toolbar-proj" style="display:none">
              <span class="cp-sel-count" id="cp-sel-count-proj" data-label="common.selected_count">0건 선택</span>
              <button class="btn btn-ghost btn-sm" id="proj-copy-btn" title="Excel·Word에 붙여넣기 가능한 형식으로 복사" data-label="common.copy">📋 복사</button>
              <button class="btn btn-ghost btn-sm" id="proj-clear-sel-btn" data-label="common.clear_selection">선택 해제</button>
            </div>
            ${
              isProjAdmin
                ? `<button class="btn btn-ghost btn-sm" id="proj-manage-btn"
                     title="프로젝트 단계·상태 정의 관리 (관리자 전용)">
                     ⚙️ 단계·상태 관리
                   </button>`
                : ''
            }
            <button class="btn btn-ghost btn-sm" id="proj-cols-btn"
              title="목록에 표시할 컬럼 선택 (이 브라우저에 저장)">
              ⚙️ 컬럼
            </button>
            <button class="btn btn-ghost btn-sm" id="proj-paste-modal-btn"
              data-feature="data.bulk_paste"
              title="Excel·Word·이메일에서 복사한 데이터를 붙여넣기로 일괄 등록"
              data-label="common.paste_register">
              📥 붙여넣기 등록
            </button>
            <button class="btn btn-ghost btn-sm" id="proj-export-btn"
              data-feature="data.excel_exp"
              title="현재 목록을 엑셀 파일로 다운로드" data-label="common.excel_export">
              📤 엑셀 다운로드
            </button>
            <label class="btn btn-ghost btn-sm" data-feature="data.excel_imp"
              title="엑셀 파일로 일괄 등록" style="cursor:pointer;margin:0">
              <span data-label="common.excel_import">📂 엑셀 가져오기</span>
              <input type="file" id="proj-import-input" accept=".xlsx,.xls" style="display:none">
            </label>
          </div>
        </div>
        <div class="card-body no-pad" id="projects-table-wrap">
          <div class="loading" data-label="common.loading">로딩중...</div>
        </div>
      </div>
    `;

    document.getElementById('proj-search').addEventListener(
      'input',
      debounce(e => {
        const q = e.target.value.toLowerCase();
        const filtered = this._allProjects.filter(
          p =>
            p.name?.toLowerCase().includes(q) ||
            p.customer_name?.toLowerCase().includes(q) ||
            p.project_code?.toLowerCase().includes(q)
        );
        this.renderTable(filtered);
      }, 300)
    );

    document.getElementById('proj-open-form-btn')?.addEventListener('click', () => this.openForm());
    document
      .getElementById('proj-manage-btn')
      ?.addEventListener('click', () => this._openStageStatusManager());
    document
      .getElementById('proj-cols-btn')
      ?.addEventListener('click', () => this._openColumnSettings());
    document.getElementById('proj-copy-btn')?.addEventListener('click', () => this.copySelected());
    document
      .getElementById('proj-clear-sel-btn')
      ?.addEventListener('click', () => this._clearSelection());
    document
      .getElementById('proj-paste-modal-btn')
      ?.addEventListener('click', () => this.openPasteModal());
    document
      .getElementById('proj-export-btn')
      ?.addEventListener('click', e => this._openExportMenu(e.currentTarget));
    document
      .getElementById('proj-import-input')
      ?.addEventListener('change', e => this.importExcel(e.target));

    this._bindPasteShortcut();
    await this.loadData();
  },

  _bindPasteShortcut() {
    if (this._pasteHandler) document.removeEventListener('keydown', this._pasteHandler);
    this._pasteHandler = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        this.openPasteModal();
      }
    };
    document.addEventListener('keydown', this._pasteHandler);
  },

  async loadData() {
    try {
      const [result, stagesRes] = await Promise.all([
        API.projects.list(),
        // 단계 목록(진척바 렌더용) — 실패해도 목록은 표시
        API.get('/projects/stages').catch(() => ({ data: [] })),
      ]);
      this._stages = stagesRes.data || [];
      this._allProjects = result.data;
      this.renderTable(result.data);
    } catch (err) {
      console.error(err);
    }
  },

  // ── Phase 4: 목록 단계 진척바 + D-day (관리자 한눈 파악) ──────
  _stageBar(p) {
    const stages = (this._stages || []).filter(s => s.is_active);
    if (!stages.length) return '';
    const done = p.status === '완료';
    const curIdx = stages.findIndex(s => s.stage_key === p.stage);
    const seg = stages
      .map((s, i) => {
        const bg =
          done || (curIdx >= 0 && i < curIdx)
            ? '#1D9E75' // 완료(초록)
            : i === curIdx
              ? '#F59C00' // 현재(주황)
              : '#E5E7EB'; // 예정(회색)
        return `<span style="flex:1;height:5px;border-radius:3px;background:${bg}"></span>`;
      })
      .join('');
    // D-day — 종료(예정)일 기준
    let dday = '';
    if (done) {
      dday = '<span style="color:#0F7A3F">완료</span>';
    } else if (p.end_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round(
        (new Date(String(p.end_date).slice(0, 10)).getTime() - today.getTime()) / 86400000
      );
      dday =
        diff < 0
          ? `<span style="color:#E24B4A;font-weight:600">${-diff}일 지연</span>`
          : `<span style="color:${diff <= 7 ? '#BA7517' : 'var(--text-3)'}">D-${diff}</span>`;
    }
    return `
      <div style="display:flex;gap:2px;margin-top:5px;max-width:170px">${seg}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">${esc(p.stage_label || '미설정')}${dday ? ' · ' + dday : ''}</div>`;
  },

  // ── 목록 컬럼 사용자 설정 (핵심 고정 + 선택 컬럼, localStorage / 백엔드·DB 무변) ──────
  _getEnabledOptCols() {
    try {
      const raw = localStorage.getItem('oci_proj_columns');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) {
      return new Set();
    }
  },

  _setEnabledOptCols(keys) {
    try {
      localStorage.setItem('oci_proj_columns', JSON.stringify(keys));
    } catch (_) {
      /* localStorage 접근 제한 — 무시 (이번 세션만 미적용) */
    }
  },

  // ── 컬럼 표시 순서 (헤더 드래그로 재배치 — 사용자별 localStorage) ──
  _getColumnOrder() {
    try {
      const raw = localStorage.getItem('oci_proj_col_order');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  },
  _setColumnOrder(keys) {
    try {
      localStorage.setItem('oci_proj_col_order', JSON.stringify(keys));
    } catch (_) {
      /* localStorage 접근 제한 — 무시 */
    }
  },
  // 활성 컬럼을 저장된 순서로 정렬 (저장 순서에 없는 컬럼은 기본 순서로 뒤에 유지 — stable sort)
  _applyColumnOrder(columns) {
    const order = this._getColumnOrder();
    if (!order.length) return columns;
    const rank = k => {
      const i = order.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return columns
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i)
      .map(x => x.c);
  },

  // 현재 검색 필터가 적용된 목록 (컬럼 설정 적용 후 재렌더용)
  _currentFilteredList() {
    const q = (document.getElementById('proj-search')?.value || '').toLowerCase();
    if (!q) return this._allProjects;
    return this._allProjects.filter(
      p =>
        p.name?.toLowerCase().includes(q) ||
        p.customer_name?.toLowerCase().includes(q) ||
        p.project_code?.toLowerCase().includes(q)
    );
  },

  // 전체 컬럼 정의 (배열 순서 = 표시 순서). locked=핵심(항상 표시), 그 외=선택(기본 OFF)
  _buildColumns(statusBadge) {
    const collabNames = p => {
      try {
        return (JSON.parse(p.collaborators || '[]') || [])
          .map(c => esc(c.name))
          .filter(Boolean)
          .join(', ');
      } catch (_) {
        return '';
      }
    };
    return [
      { key: 'name', label: '프로젝트명', labelKey: 'projects.name', locked: true,
        cell: p => `<td><strong>${esc(p.name)}</strong>${p.project_code ? `<div class="mono" style="font-size:11px;color:var(--text-3)">${esc(p.project_code)}</div>` : ''}</td>` },
      { key: 'code', label: '코드',
        cell: p => `<td class="mono" style="font-size:12px;color:var(--text-2)">${esc(p.project_code || '-')}</td>` },
      { key: 'customer_name', label: '고객사', labelKey: 'projects.customer_name', locked: true,
        cell: p => `<td>${esc(p.customer_name || '-')}</td>` },
      { key: 'customer_contact', label: '담당고객',
        cell: p => `<td>${esc(p.customer_contact || '-')}</td>` },
      { key: 'lead_name', label: '관련 영업리드',
        cell: p => `<td>${esc(p.lead_name || '-')}</td>` },
      { key: 'contract', label: '연결 계약',
        cell: p => `<td>${p.contract_id ? `<span class="mono" style="font-size:12px;color:var(--text-2)">계약 #${esc(String(p.contract_id))}</span>` : '-'}</td>` },
      { key: 'project_type', label: '유형', labelKey: 'projects.business_type', locked: true,
        cell: p => `<td><span class="badge badge-blue">${esc(p.project_type || '-')}</span></td>` },
      { key: 'contract_amount', label: '계약금액', labelKey: 'projects.contract_amount', locked: true, align: 'right',
        cell: p => `<td class="text-right mono">${Fmt.amount(p.contract_amount)}</td>` },
      { key: 'estimated_cost', label: '산정 원가', labelKey: 'projects.estimated_cost', locked: true, align: 'right',
        cell: p => `<td class="text-right mono">${Fmt.amount(p.estimated_cost)}</td>` },
      { key: 'margin_pct', label: '마진율', labelKey: 'projects.margin_pct', locked: true, align: 'right',
        cell: p => {
          const m = parseFloat(p.margin_pct);
          const c = m >= 20 ? 'var(--green)' : m >= 15 ? 'var(--amber)' : 'var(--red)';
          return `<td class="text-right" style="color:${c};font-weight:600">${m ? m.toFixed(2) + '%' : '-'}</td>`;
        } },
      { key: 'status', label: '상태', labelKey: 'projects.status', locked: true,
        cell: p => `<td><span class="badge badge-${p.status_color || statusBadge[p.status] || 'gray'}">${esc(p.status_label || p.status)}</span>${this._stageBar(p)}</td>` },
      { key: 'stage', label: '단계',
        cell: p => `<td><span class="badge badge-gray">${esc(p.stage_label || '-')}</span></td>` },
      { key: 'due_date', label: '납기일', labelKey: 'projects.due_date', locked: true,
        cell: p => `<td>${Fmt.date(p.due_date)}</td>` },
      { key: 'start_date', label: '착수일',
        cell: p => `<td>${Fmt.date(p.start_date)}</td>` },
      { key: 'end_date', label: '종료예정일',
        cell: p => `<td>${Fmt.date(p.end_date)}</td>` },
      { key: 'assigned_name', label: '담당', labelKey: 'projects.manager', locked: true,
        cell: p => `<td>${esc(p.assigned_name || '-')}</td>` },
      { key: 'pm', label: 'PM',
        cell: p => `<td>${esc(p.pm_name || '-')}</td>` },
      { key: 'headcount', label: '투입인원', align: 'right',
        cell: p => `<td class="text-right">${p.headcount ? esc(String(p.headcount)) + '명' : '-'}</td>` },
      { key: 'collaborators', label: '협업담당',
        cell: p => `<td>${collabNames(p) || '-'}</td>` },
      { key: 'notes', label: '메모',
        cell: p => `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.notes || '')}">${esc(p.notes || '-')}</td>` },
    ];
  },

  // ⚙️ 목록 컬럼 설정 모달 — 선택 컬럼 켜고/끄기 (즉시 반영 + localStorage 저장)
  _openColumnSettings() {
    const enabled = this._getEnabledOptCols();
    const optCols = this._buildColumns({}).filter(c => !c.locked);
    Modal.open({
      title: '⚙️ 목록 컬럼 설정',
      body: `
        <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">핵심 컬럼은 항상 표시됩니다. 추가로 보고 싶은 컬럼을 선택하세요. <span style="color:var(--text-2)">(이 브라우저에 저장)</span></div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 18px">
          ${optCols
            .map(
              c => `
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" class="proj-col-opt" value="${esc(c.key)}" ${enabled.has(c.key) ? 'checked' : ''}>
              ${esc(c.label)}
            </label>`
            )
            .join('')}
        </div>`,
      footer: `
        <button class="btn btn-ghost" id="proj-col-reset">기본값 복원</button>
        <button class="btn btn-ghost" id="proj-col-cancel">취소</button>
        <button class="btn btn-primary" id="proj-col-apply">적용</button>`,
      bind: {
        '#proj-col-reset': () => {
          this._setEnabledOptCols([]);
          this._setColumnOrder([]); // 표시 순서도 기본값으로 복원
          Modal.close();
          this.renderTable(this._currentFilteredList());
          Toast.success('기본 컬럼으로 복원했습니다');
        },
        '#proj-col-cancel': () => Modal.close(),
        '#proj-col-apply': () => {
          const keys = [...document.querySelectorAll('.proj-col-opt:checked')].map(c => c.value);
          this._setEnabledOptCols(keys);
          Modal.close();
          this.renderTable(this._currentFilteredList());
          Toast.success('컬럼 설정을 적용했습니다');
        },
      },
    });
  },

  // ── 프로젝트 단계·상태 관리 (목록 [⚙️ 단계·상태 관리] 버튼 → 모달, admin·superadmin 전용) ──
  //   Modal 은 단일 #modal-box(중첩 불가) → 추가/편집 폼을 모달 내부 #pm-panel 에 인라인 스왑
  //   백엔드 /projects/stages·/projects/statuses 의 adminOnly 가 실제 권한을 강제(이중 방어)
  _openStageStatusManager(tab = 'stages') {
    if (!['admin', 'superadmin'].includes(App.currentUser?.role)) {
      Toast.error('단계·상태 관리는 관리자(admin·superadmin)만 가능합니다');
      return;
    }
    this._pmTab = tab;
    Modal.open({
      title: '⚙️ 프로젝트 단계·상태 관리',
      wide: true,
      width: 1000,
      confirmOnClose: false,
      body: `
        <div style="display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:14px">
          <button class="pm-tab" data-pm="stages" style="border:0;background:none;padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;margin-bottom:-2px">🏗 단계</button>
          <button class="pm-tab" data-pm="statuses" style="border:0;background:none;padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;margin-bottom:-2px">🏷 상태</button>
        </div>
        <div id="pm-panel" style="min-height:260px"><div class="loading" style="padding:30px;text-align:center">로딩 중...</div></div>`,
      footer: `<button class="btn btn-ghost" id="pm-close">닫기</button>`,
      bind: {
        '#pm-close': () => Modal.close(),
        '.pm-tab': e => {
          this._pmTab = e.currentTarget.dataset.pm;
          this._pmRenderList();
        },
      },
      onOpen: () => this._pmRenderList(),
    });
  },

  _pmRenderList() {
    document.querySelectorAll('.pm-tab').forEach(b => {
      const on = b.dataset.pm === this._pmTab;
      b.style.borderBottomColor = on ? 'var(--oci-red)' : 'transparent';
      b.style.fontWeight = on ? '700' : '500';
      b.style.color = on ? 'var(--text-1)' : 'var(--text-3)';
    });
    if (this._pmTab === 'statuses') this._pmStatusList();
    else this._pmStageList();
  },

  _pmEndpoint(type) {
    return type === 'stage' ? '/projects/stages' : '/projects/statuses';
  },

  // 단계/상태별 projects 사용 건수 표시 (비치명적)
  async _pmLoadUsage(items, field) {
    try {
      const r = await API.get('/projects?limit=500');
      const counts = {};
      (r.data || []).forEach(p => {
        const v = p[field];
        if (v) counts[v] = (counts[v] || 0) + 1;
      });
      items.forEach(s => {
        const key = field === 'stage' ? s.stage_key : s.status_key;
        const el = document.querySelector(`.pm-usage[data-k="${key}"]`);
        if (el) el.textContent = (counts[key] || 0) + '건';
      });
    } catch (_) {
      /* usage 표시 실패는 무시 */
    }
  },

  _pmBindRows(panel, list, type) {
    panel
      .querySelector('#pm-add')
      ?.addEventListener('click', () =>
        type === 'stage' ? this._pmStageForm(null) : this._pmStatusForm(null)
      );
    panel.querySelectorAll('[data-pm-edit]').forEach(b =>
      b.addEventListener('click', () => {
        const it = list.find(s => s.id === parseInt(b.dataset.pmEdit));
        if (type === 'stage') this._pmStageForm(it);
        else this._pmStatusForm(it);
      })
    );
    panel
      .querySelectorAll('[data-pm-toggle]')
      .forEach(b =>
        b.addEventListener('click', () => this._pmToggle(parseInt(b.dataset.pmToggle), type))
      );
    panel
      .querySelectorAll('[data-pm-del]')
      .forEach(b => b.addEventListener('click', () => this._pmDelete(parseInt(b.dataset.pmDel), type)));
    panel.querySelectorAll('[data-pm-up],[data-pm-down]').forEach(b =>
      b.addEventListener('click', () =>
        this._pmMove(parseInt(b.dataset.pmUp || b.dataset.pmDown), b.dataset.pmUp ? -1 : 1, list, type)
      )
    );
  },

  async _pmToggle(id, type) {
    try {
      const r = await API.get(`${this._pmEndpoint(type)}?include=all`);
      const it = (r.data || []).find(s => s.id === id);
      if (!it) return;
      await API.put(`${this._pmEndpoint(type)}/${id}`, { is_active: it.is_active ? 0 : 1 });
      Toast.success(it.is_active ? '비활성화됨' : '활성화됨');
      this._pmRenderList();
    } catch (e) {
      Toast.error('처리 실패: ' + e.message);
    }
  },

  async _pmDelete(id, type) {
    const label = type === 'stage' ? '단계' : '상태';
    if (!confirm(`이 ${label}를 삭제하시겠습니까?\n사용 중이면 삭제할 수 없습니다.`)) return;
    try {
      await API.delete(`${this._pmEndpoint(type)}/${id}`);
      Toast.success(`${label}가 삭제되었습니다`);
      this._pmRenderList();
    } catch (e) {
      Toast.error(e.message + '\n비활성화를 사용하세요.');
    }
  },

  async _pmMove(id, dir, list, type) {
    const sorted = list.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = sorted.findIndex(s => s.id === id);
    const t = idx + dir;
    if (t < 0 || t >= sorted.length) {
      Toast.info('더 이동할 수 없습니다');
      return;
    }
    const cur = sorted[idx];
    const tgt = sorted[t];
    try {
      await API.post(`${this._pmEndpoint(type)}/reorder`, {
        order: [
          { id: cur.id, sort_order: tgt.sort_order },
          { id: tgt.id, sort_order: cur.sort_order },
        ],
      });
      this._pmRenderList();
    } catch (e) {
      Toast.error('순서 변경 실패: ' + e.message);
    }
  },

  _pmActionsCell(s) {
    return `
      <td class="text-right" style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-pm-up="${s.id}" title="위로" style="padding:2px 6px">↑</button>
        <button class="btn btn-ghost btn-sm" data-pm-down="${s.id}" title="아래로" style="padding:2px 6px">↓</button>
        <button class="btn btn-ghost btn-sm" data-pm-edit="${s.id}">편집</button>
        <button class="btn btn-ghost btn-sm" data-pm-toggle="${s.id}">${s.is_active ? '비활성' : '활성'}</button>
        <button class="btn btn-ghost btn-sm" data-pm-del="${s.id}" style="color:var(--oci-red)">🗑</button>
      </td>`;
  },
  _pmActiveCell(s) {
    return `<td class="text-center">${s.is_active ? '<span class="badge badge-green" style="font-size:10px">활성</span>' : '<span class="badge badge-gray" style="font-size:10px">비활성</span>'}</td>`;
  },

  // ── 단계 ──────────────────────────────────────────────────
  async _pmStageList() {
    const panel = document.getElementById('pm-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="loading" style="padding:30px;text-align:center">로딩 중...</div>';
    try {
      const r = await API.get('/projects/stages?include=all');
      const list = (r.data || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text-3)">단계 전환 워크플로우 정의 · <b>📎</b> = 증빙 필수 · ⚠️ key 변경 불가</div>
          <button class="btn btn-primary btn-sm" id="pm-add">+ 단계 추가</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th style="width:46px;text-align:center">순서</th><th style="width:96px">key</th><th>표시 이름</th>
            <th style="width:120px">색상</th><th style="width:52px;text-align:center">📎</th>
            <th style="width:56px;text-align:center">사용</th><th style="width:56px;text-align:center">활성</th>
            <th style="width:172px;text-align:right">관리</th>
          </tr></thead>
          <tbody>${list
            .map(
              s => `
            <tr style="${s.is_active ? '' : 'opacity:.55'}">
              <td class="text-center mono">${s.sort_order}</td>
              <td><code style="font-size:11px;color:var(--text-3)">${esc(s.stage_key)}</code></td>
              <td><strong>${esc(s.label)}</strong></td>
              <td><div style="display:flex;align-items:center;gap:6px"><span style="width:16px;height:16px;border-radius:4px;background:${esc(s.color)};border:1px solid rgba(0,0,0,.1)"></span><span class="mono" style="font-size:11px">${esc(s.color)}</span></div></td>
              <td class="text-center">${s.requires_file ? '📎' : '<span style="color:var(--text-3)">–</span>'}</td>
              <td class="text-center"><span class="pm-usage" data-k="${esc(s.stage_key)}" style="font-size:11px;color:var(--text-3)">…</span></td>
              ${this._pmActiveCell(s)}
              ${this._pmActionsCell(s)}
            </tr>`
            )
            .join('')}</tbody>
        </table>`;
      this._pmLoadUsage(list, 'stage');
      this._pmBindRows(panel, list, 'stage');
    } catch (e) {
      panel.innerHTML = `<div style="color:var(--oci-red);padding:30px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  _pmStageForm(stage) {
    const panel = document.getElementById('pm-panel');
    const isEdit = !!stage;
    panel.innerHTML = `
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">${isEdit ? '단계 편집 — ' + esc(stage.label) : '🏗 새 단계 추가'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:560px">
        ${
          isEdit
            ? `<div><label class="form-label">key (변경 불가)</label><input class="form-control mono" disabled value="${esc(stage.stage_key)}" style="background:#f1f5f9;color:#94a3b8"></div>`
            : `<div><label class="form-label">key <span style="color:var(--oci-red)">*</span></label><input class="form-control mono" id="pm-f-key" placeholder="install (영문 소문자/숫자/_)"><small style="color:var(--text-3);font-size:11px">DB 영구 식별자. 생성 후 변경 불가.</small></div>`
        }
        <div><label class="form-label">표시 이름 <span style="color:var(--oci-red)">*</span></label><input class="form-control" id="pm-f-label" maxlength="100" value="${esc(stage?.label || '')}" placeholder="예: 설치"></div>
        <div><label class="form-label">순서</label><input class="form-control" id="pm-f-order" type="number" step="1" value="${stage?.sort_order ?? 50}"></div>
        <div><label class="form-label">색상</label><input class="form-control" id="pm-f-color" type="color" value="${stage?.color || '#93B4F9'}" style="height:38px;padding:2px 6px"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1"><input type="checkbox" id="pm-f-reqfile" ${stage?.requires_file ? 'checked' : ''}> 📎 증빙 파일 필수 (도달 기록 시 산출물 1건 이상 강제)</label>
        ${isEdit ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1"><input type="checkbox" id="pm-f-active" ${stage.is_active ? 'checked' : ''}> 활성 (해제 시 단계 선택지에서 숨김)</label>` : ''}
        <div style="grid-column:1/-1"><label class="form-label">예상 산출물 <span style="font-size:11px;color:var(--text-3)">(줄당 1개 — 마일스톤 편집 시 음영 안내로 표시)</span></label><textarea class="form-control" id="pm-f-guide" rows="4" placeholder="계약서&#10;착수보고서&#10;WBS" style="font-size:13px">${esc(stage?.deliverable_guide || '')}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <button class="btn btn-ghost" id="pm-f-cancel">취소</button>
        <button class="btn btn-primary" id="pm-f-save">${isEdit ? '저장' : '추가'}</button>
      </div>`;
    panel.querySelector('#pm-f-cancel').addEventListener('click', () => this._pmRenderList());
    panel.querySelector('#pm-f-save').addEventListener('click', () => this._pmStageSave(stage));
  },

  async _pmStageSave(existing) {
    const el = id => document.getElementById(id);
    const label = el('pm-f-label').value.trim();
    if (!label) return Toast.error('표시 이름을 입력하세요');
    const isEdit = !!existing;
    const body = {
      label,
      sort_order: parseInt(el('pm-f-order').value) || 0,
      color: el('pm-f-color').value,
      requires_file: el('pm-f-reqfile').checked ? 1 : 0,
      deliverable_guide: el('pm-f-guide')?.value || '',
    };
    if (isEdit) body.is_active = el('pm-f-active').checked ? 1 : 0;
    else {
      const key = (el('pm-f-key').value || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{1,30}$/.test(key)) return Toast.error('key는 영문 소문자/숫자/_ (1~30자)');
      body.stage_key = key;
    }
    try {
      if (isEdit) await API.put(`/projects/stages/${existing.id}`, body);
      else await API.post('/projects/stages', body);
      Toast.success(isEdit ? '단계가 수정되었습니다' : '새 단계가 추가되었습니다');
      this._pmRenderList();
    } catch (e) {
      Toast.error((isEdit ? '수정' : '추가') + ' 실패: ' + e.message);
    }
  },

  // ── 상태 ──────────────────────────────────────────────────
  async _pmStatusList() {
    const panel = document.getElementById('pm-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="loading" style="padding:30px;text-align:center">로딩 중...</div>';
    try {
      const r = await API.get('/projects/statuses?include=all');
      const list = (r.data || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text-3)">목록·편집의 상태 값 정의 · <b>🏁</b> = 완료류(마지막 단계 도달 시 자동) · ⚠️ key 변경 불가</div>
          <button class="btn btn-primary btn-sm" id="pm-add">+ 상태 추가</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th style="width:46px;text-align:center">순서</th><th style="width:96px">key</th><th>표시 이름</th>
            <th style="width:120px">배지</th><th style="width:52px;text-align:center">🏁</th>
            <th style="width:56px;text-align:center">사용</th><th style="width:56px;text-align:center">활성</th>
            <th style="width:172px;text-align:right">관리</th>
          </tr></thead>
          <tbody>${list
            .map(
              s => `
            <tr style="${s.is_active ? '' : 'opacity:.55'}">
              <td class="text-center mono">${s.sort_order}</td>
              <td><code style="font-size:11px;color:var(--text-3)">${esc(s.status_key)}</code></td>
              <td><strong>${esc(s.label)}</strong></td>
              <td><span class="badge badge-${esc(s.color)}">${esc(s.label)}</span></td>
              <td class="text-center">${s.is_final ? '🏁' : '<span style="color:var(--text-3)">–</span>'}</td>
              <td class="text-center"><span class="pm-usage" data-k="${esc(s.status_key)}" style="font-size:11px;color:var(--text-3)">…</span></td>
              ${this._pmActiveCell(s)}
              ${this._pmActionsCell(s)}
            </tr>`
            )
            .join('')}</tbody>
        </table>`;
      this._pmLoadUsage(list, 'status');
      this._pmBindRows(panel, list, 'status');
    } catch (e) {
      panel.innerHTML = `<div style="color:var(--oci-red);padding:30px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  _pmStatusForm(status) {
    const panel = document.getElementById('pm-panel');
    const isEdit = !!status;
    const COLORS = [
      ['blue', '파랑'],
      ['green', '초록'],
      ['amber', '주황'],
      ['red', '빨강'],
      ['gray', '회색'],
    ];
    panel.innerHTML = `
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">${isEdit ? '상태 편집 — ' + esc(status.label) : '🏷 새 상태 추가'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:560px">
        ${isEdit ? `<div><label class="form-label">key (변경 불가)</label><input class="form-control mono" disabled value="${esc(status.status_key)}" style="background:#f1f5f9;color:#94a3b8"></div>` : ''}
        <div${isEdit ? '' : ' style="grid-column:1/-1"'}><label class="form-label">표시 이름 <span style="color:var(--oci-red)">*</span></label><input class="form-control" id="pm-f-label" maxlength="50" value="${esc(status?.label || '')}" placeholder="예: 보류">${isEdit ? '' : '<small style="color:var(--text-3);font-size:11px">표시 이름이 식별자(key)가 됩니다. 이후 이름은 변경 가능, key는 고정.</small>'}</div>
        <div><label class="form-label">순서</label><input class="form-control" id="pm-f-order" type="number" step="1" value="${status?.sort_order ?? 50}"></div>
        <div><label class="form-label">배지 색상</label><select class="form-control" id="pm-f-color">${COLORS.map(c => `<option value="${c[0]}" ${(status?.color || 'gray') === c[0] ? 'selected' : ''}>${c[1]} (${c[0]})</option>`).join('')}</select></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1"><input type="checkbox" id="pm-f-final" ${status?.is_final ? 'checked' : ''}> 🏁 완료 상태 (마지막 단계 도달 시 이 상태로 자동 변경)</label>
        ${isEdit ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="pm-f-active" ${status.is_active ? 'checked' : ''}> 활성 (해제 시 상태 선택지에서 숨김)</label>` : ''}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <button class="btn btn-ghost" id="pm-f-cancel">취소</button>
        <button class="btn btn-primary" id="pm-f-save">${isEdit ? '저장' : '추가'}</button>
      </div>`;
    panel.querySelector('#pm-f-cancel').addEventListener('click', () => this._pmRenderList());
    panel.querySelector('#pm-f-save').addEventListener('click', () => this._pmStatusSave(status));
  },

  async _pmStatusSave(existing) {
    const el = id => document.getElementById(id);
    const label = el('pm-f-label').value.trim();
    if (!label) return Toast.error('표시 이름을 입력하세요');
    const isEdit = !!existing;
    const body = {
      label,
      sort_order: parseInt(el('pm-f-order').value) || 0,
      color: el('pm-f-color').value,
      is_final: el('pm-f-final').checked ? 1 : 0,
    };
    if (isEdit) body.is_active = el('pm-f-active').checked ? 1 : 0;
    try {
      if (isEdit) await API.put(`/projects/statuses/${existing.id}`, body);
      else await API.post('/projects/statuses', body);
      Toast.success(isEdit ? '상태가 수정되었습니다' : '새 상태가 추가되었습니다');
      this._pmRenderList();
    } catch (e) {
      Toast.error((isEdit ? '수정' : '추가') + ' 실패: ' + e.message);
    }
  },

  renderTable(projects) {
    const countEl = document.getElementById('proj-count');
    if (countEl) countEl.textContent = `(총 ${projects.length}건)`;

    if (!projects.length) {
      const hasFilter = !!document.getElementById('proj-search')?.value;
      const presetKey = hasFilter ? 'filter' : 'projects';
      const html =
        typeof EmptyState !== 'undefined'
          ? EmptyState.preset(presetKey)
          : '<div class="empty"><div class="empty-icon">📁</div>등록된 프로젝트가 없습니다</div>';
      document.getElementById('projects-table-wrap').innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-projects-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    const statusBadge = {
      진행중: 'blue',
      제조중: 'blue',
      납기지연: 'amber',
      완료: 'green',
      취소: 'gray',
    };
    // 컬럼 레지스트리 — 핵심(고정) + 선택(사용자 설정, localStorage). 활성 컬럼만 렌더
    const enabled = this._getEnabledOptCols();
    const columns = this._applyColumnOrder(
      this._buildColumns(statusBadge).filter(c => c.locked || enabled.has(c.key))
    );
    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th class="cp-check-col">
              <input type="checkbox" class="cp-checkbox" id="cp-check-all-proj" title="전체 선택">
            </th>
            ${columns
              .map(c => {
                const cls = c.align === 'right' ? ' class="text-right"' : '';
                const lbl = c.labelKey ? ` data-label="${c.labelKey}"` : '';
                return `<th data-col-key="${esc(c.key)}"${cls}${lbl} style="cursor:move" title="드래그하여 컬럼 순서 변경">${esc(c.label)}</th>`;
              })
              .join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${projects
            .map(
              p => `
              <tr data-proj-id="${p.id}" class="${this._selectedIds.has(p.id) ? 'cp-selected' : ''}">
                <td class="cp-check-col" data-stop-propagation="1">
                  <input type="checkbox" class="cp-checkbox" data-id="${p.id}"
                    ${this._selectedIds.has(p.id) ? 'checked' : ''}>
                </td>
                ${columns.map(c => c.cell(p)).join('')}
                <td><button class="btn btn-ghost btn-sm" data-action="edit-proj" data-pid="${p.id}">편집</button></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    const wrap = document.getElementById('projects-table-wrap');
    wrap.innerHTML = html;
    this._updateSelectionUI();

    // 컬럼 헤더 드래그로 순서 변경 (Sortable.js — 데이터 컬럼 th 만 이동, 사용자별 localStorage 저장)
    const headRow = wrap.querySelector('thead tr');
    if (headRow && typeof Sortable !== 'undefined') {
      this._colSortable?.destroy?.();
      this._colSortable = Sortable.create(headRow, {
        draggable: 'th[data-col-key]',
        animation: 150,
        forceFallback: true, // 네이티브 DnD 대신 마우스 폴백 — 브라우저 일관 동작 + 테스트 안정
        onEnd: () => {
          const keys = [...headRow.querySelectorAll('th[data-col-key]')].map(
            th => th.dataset.colKey
          );
          this._setColumnOrder(keys);
          this.renderTable(this._currentFilteredList());
        },
      });
    }

    wrap.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');
      if (stopEl) {
        e.stopPropagation();
      }

      const actionBtn = e.target.closest('[data-action="edit-proj"]');
      if (actionBtn) {
        this.openForm(parseInt(actionBtn.dataset.pid));
        return;
      }

      const cb = e.target.closest('.cp-checkbox[data-id]');
      if (cb) {
        this._toggleRow(parseInt(cb.dataset.id), cb.checked);
        return;
      }

      const hdrCb = e.target.closest('#cp-check-all-proj');
      if (hdrCb) {
        this._toggleAll(hdrCb.checked);
        return;
      }

      // 행 클릭 → 상세 (단계 스텝퍼 + 전환 이력) — Phase 3
      const row = e.target.closest('tr[data-proj-id]');
      if (row) this.openDetail(parseInt(row.dataset.projId));
    });
  },

  // ── 체크박스 선택 ────────────────────────────────────────────
  _toggleAll(checked) {
    this._allProjects.forEach(p => {
      if (checked) this._selectedIds.add(p.id);
      else this._selectedIds.delete(p.id);
    });
    document.querySelectorAll('.cp-checkbox[data-id]').forEach(cb => (cb.checked = checked));
    document
      .querySelectorAll('tr[data-proj-id]')
      .forEach(tr => tr.classList.toggle('cp-selected', checked));
    this._updateSelectionUI();
  },

  _toggleRow(id, checked) {
    if (checked) this._selectedIds.add(id);
    else this._selectedIds.delete(id);
    const tr = document.querySelector(`tr[data-proj-id="${id}"]`);
    if (tr) {
      tr.classList.toggle('cp-selected', checked);
      const cb = tr.querySelector('.cp-checkbox[data-id]');
      if (cb) cb.checked = checked;
    }
    const all = document.getElementById('cp-check-all-proj');
    if (all)
      all.checked =
        this._selectedIds.size === this._allProjects.length && this._allProjects.length > 0;
    this._updateSelectionUI();
  },

  _clearSelection() {
    this._selectedIds.clear();
    document.querySelectorAll('.cp-checkbox').forEach(cb => (cb.checked = false));
    document.querySelectorAll('tr[data-proj-id]').forEach(tr => tr.classList.remove('cp-selected'));
    this._updateSelectionUI();
  },

  _updateSelectionUI() {
    const n = this._selectedIds.size;
    const toolbar = document.getElementById('cp-toolbar-proj');
    const count = document.getElementById('cp-sel-count-proj');
    if (toolbar) toolbar.style.display = n > 0 ? 'flex' : 'none';
    if (count) count.textContent = `${n}건 선택`;
  },

  // ── 복사 ────────────────────────────────────────────────────
  copySelected() {
    const selected = this._allProjects.filter(p => this._selectedIds.has(p.id));
    if (!selected.length) {
      Toast.info('복사할 항목을 선택하세요');
      return;
    }
    const headers = [
      '프로젝트명',
      '고객사',
      '유형',
      '계약금액(억)',
      '산정원가(억)',
      '마진율(%)',
      '상태',
      '납기일',
      '담당자',
      '메모',
    ];
    const rows = selected.map(p =>
      [
        p.name || '',
        p.customer_name || '',
        p.project_type || '',
        p.contract_amount !== null && p.contract_amount !== undefined ? p.contract_amount : '',
        p.estimated_cost !== null && p.estimated_cost !== undefined ? p.estimated_cost : '',
        p.margin_pct !== null && p.margin_pct !== undefined
          ? parseFloat(p.margin_pct).toFixed(2)
          : '',
        p.status || '',
        p.due_date ? String(p.due_date).slice(0, 10) : '',
        p.assigned_name || '',
        p.notes || '',
      ].map(v => String(v).replace(/\t/g, ' '))
    );
    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    navigator.clipboard
      .writeText(tsv)
      .then(() =>
        Toast.success(`${selected.length}건 복사 완료 — Excel·Word에 Ctrl+V로 붙여넣기 하세요`)
      )
      .catch(() => {
        const ta = Object.assign(document.createElement('textarea'), {
          value: tsv,
          style: 'position:fixed;opacity:0',
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        Toast.success(`${selected.length}건 복사 완료`);
      });
  },

  // ── 붙여넣기 모달 ────────────────────────────────────────────
  // ── 붙여넣기 등록 (공통 BulkPaste 컴포넌트 사용 — v6.0.0) ──────
  openPasteModal() {
    if (typeof BulkPaste === 'undefined') {
      Toast.error('BulkPaste 컴포넌트 로드 실패');
      return;
    }
    BulkPaste.open({
      entityType: 'project',
      title: '📥 프로젝트 붙여넣기 등록',
      endpoint: '/projects/bulk',
      payloadKey: 'projects',
      columns: [
        { key: 'name', label: '프로젝트명', required: true, maxLength: 200 },
        { key: 'customer_name', label: '고객사', maxLength: 200 },
        { key: 'project_type', label: '유형', default: '식각가스', maxLength: 50 },
        {
          key: 'contract_amount',
          label: '계약금액',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const s = String(v);
            const isEok = /억/.test(s);
            const n = parseFloat(s.replace(/[,₩$¥억\s]/g, ''));
            if (isNaN(n)) return null;
            return isEok ? Math.round(n * 1e8) : n;
          },
        },
        {
          key: 'estimated_cost',
          label: '산정원가',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const s = String(v);
            const isEok = /억/.test(s);
            const n = parseFloat(s.replace(/[,₩$¥억\s]/g, ''));
            if (isNaN(n)) return null;
            return isEok ? Math.round(n * 1e8) : n;
          },
        },
        { key: 'status', label: '상태', default: '진행중', maxLength: 30 },
        { key: 'due_date', label: '납기일', validate: 'date' },
        { key: 'assigned_to', label: '담당자', maxLength: 100 },
        { key: 'notes', label: '메모', maxLength: 2000 },
      ],
      headerAliases: {
        프로젝트명: 'name',
        프로젝트: 'name',
        project: 'name',
        project_name: 'name',
        name: 'name',
        고객사: 'customer_name',
        customer: 'customer_name',
        customer_name: 'customer_name',
        유형: 'project_type',
        사업유형: 'project_type',
        type: 'project_type',
        project_type: 'project_type',
        계약금액: 'contract_amount',
        '계약금액(억)': 'contract_amount',
        금액: 'contract_amount',
        amount: 'contract_amount',
        contract: 'contract_amount',
        contract_amount: 'contract_amount',
        원가: 'estimated_cost',
        산정원가: 'estimated_cost',
        '산정원가(억)': 'estimated_cost',
        cost: 'estimated_cost',
        estimated_cost: 'estimated_cost',
        상태: 'status',
        status: 'status',
        납기일: 'due_date',
        납기: 'due_date',
        due: 'due_date',
        due_date: 'due_date',
        담당자: 'assigned_to',
        담당: 'assigned_to',
        assigned: 'assigned_to',
        assigned_to: 'assigned_to',
        메모: 'notes',
        비고: 'notes',
        notes: 'notes',
      },
      duplicateField: 'name',
      onSuccess: async () => {
        await this.loadData();
      },
    });
  },

  // ── (v6.0.0) 붙여넣기 파싱/등록은 BulkPaste 컴포넌트로 이관 ──────

  // ── 엑셀 내보내기 ────────────────────────────────────────────
  exportExcel() {
    const path = this._buildExportPath();
    API.downloadExport(path, '프로젝트_' + new Date().toISOString().slice(0, 10), 'xlsx');
  },

  _buildExportPath() {
    const search = document.getElementById('proj-search')?.value || '';
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    return '/projects/export' + (qs.toString() ? '?' + qs.toString() : '');
  },

  _openExportMenu(triggerEl) {
    if (typeof ExportMenu === 'undefined') return this.exportExcel();
    ExportMenu.open(
      triggerEl,
      this._buildExportPath(),
      '프로젝트_' + new Date().toISOString().slice(0, 10)
    );
  },

  // ── 엑셀 가져오기 ────────────────────────────────────────────
  async importExcel(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const headers = {};
    const uid = localStorage.getItem('current_user_id');
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch('/api/projects/import', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (data.success) {
        const errMsg = data.errors?.length ? ` (${data.errors.length}건 오류)` : '';
        Toast.success(`${data.inserted}건 등록 완료${errMsg}`);
        await this.loadData();
      } else {
        Toast.error(data.message || '가져오기 실패');
      }
    } catch (e) {
      Toast.error('서버 오류: ' + (e.message || ''));
    }
  },

  // ── 기존 편집/저장/삭제 ──────────────────────────────────────
  async openForm(id = null) {
    let project = { contract_amount: '', estimated_cost: '' };
    if (id) {
      const result = await API.projects.list();
      project = result.data.find(p => p.id === id) || project;
    }
    const [team, stagesRes, statusesRes] = await Promise.all([
      API.team.list(),
      API.get('/projects/stages').catch(() => ({ data: [] })),
      API.get('/projects/statuses').catch(() => ({ data: [] })),
    ]);
    const stages = stagesRes.data || [];
    // 상태 옵션 — 관리자 설정(project_statuses). 비어있으면 기존 5종 폴백
    let statusList = statusesRes.data || [];
    if (!statusList.length) {
      statusList = ['진행중', '제조중', '납기지연', '완료', '취소'].map(s => ({ status_key: s, label: s }));
    }
    // 현재 값이 목록에 없으면(비활성/삭제됨) 선택 유지용으로 추가
    if (project.status && !statusList.some(s => s.status_key === project.status)) {
      statusList = [...statusList, { status_key: project.status, label: project.status }];
    }
    const teamOpts = sel =>
      team.data
        .map(
          t =>
            `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)} (${t.role})</option>`
        )
        .join('');
    // 협업담당 — 저장된 JSON [{id,name}] → 선택 상태 복원
    let collabIds = [];
    try {
      collabIds = (JSON.parse(project.collaborators || '[]') || []).map(c => c.id);
    } catch (_) {
      collabIds = [];
    }
    const dt = v => (v ? String(v).split('T')[0] : '');
    Modal.open({
      title: id ? '프로젝트 편집' : '신규 프로젝트 등록',
      body: `
        <div class="form-grid">
          <div class="form-field">
            <label class="form-label">프로젝트 코드</label>
            <input class="form-control mono" id="p-code" placeholder="비우면 자동 채번 (PRJ-${new Date().getFullYear()}-NNNN)" value="${esc(project.project_code || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">관련 영업리드 <span style="font-size:11px;color:var(--text-3)">(2글자+ 검색 → 자동 채움)</span></label>
            <input class="form-control" id="p-lead" placeholder="고객사/프로젝트명 검색" autocomplete="off"
                   value="${esc(project.lead_id ? '리드 #' + project.lead_id : '')}">
            <input type="hidden" id="p-lead-id" value="${esc(project.lead_id || '')}">
            <div id="p-contract-info" style="font-size:11px;color:var(--text-3);margin-top:2px"></div>
            <input type="hidden" id="p-contract-id" value="${esc(project.contract_id || '')}">
          </div>
          <div class="form-field full">
            <label class="form-label required">프로젝트명</label>
            <input class="form-control" id="p-name" value="${esc(project.name || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">고객사</label>
            <input class="form-control" id="p-customer" value="${esc(project.customer_name || '')}" autocomplete="off">
            <input type="hidden" id="p-customer-id" value="${esc(project.customer_id || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">담당고객 <span style="font-size:11px;color:var(--text-3)">(고객측 담당자)</span></label>
            <input class="form-control" id="p-customer-contact" placeholder="예: 김담당 과장" value="${esc(project.customer_contact || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">유형</label>
            <select class="form-control" id="p-type">
              <option ${project.project_type === '식각가스' ? 'selected' : ''}>식각가스</option>
              <option ${project.project_type === '프리커서' ? 'selected' : ''}>프리커서</option>
              <option ${project.project_type === 'Wet Chemical' ? 'selected' : ''}>Wet Chemical</option>
              <option ${project.project_type === '디스플레이소재' ? 'selected' : ''}>디스플레이소재</option>
              <option ${project.project_type === '포토소재' ? 'selected' : ''}>포토소재</option>
              <option ${project.project_type === '통합서비스' ? 'selected' : ''}>통합서비스</option>
              ${
                project.project_type && !['식각가스', '프리커서', 'Wet Chemical', '디스플레이소재', '포토소재', '통합서비스'].includes(project.project_type)
                  ? `<option selected>${esc(project.project_type)}</option>`
                  : ''
              }
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">프로젝트 단계</label>
            <select class="form-control" id="p-stage">
              ${stages.map(s => `<option value="${esc(s.stage_key)}" ${project.stage === s.stage_key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">계약금액 <span style="font-size:11px;color:var(--text-3)">(원 단위)</span></label>
            <input class="form-control mono" id="p-amount" type="number" step="1" placeholder="예: 1840000000"
                   value="${project.contract_amount || ''}">
            <div id="p-amount-preview" style="font-size:11px;color:var(--oci-blue);margin-top:2px"></div>
          </div>
          <div class="form-field">
            <label class="form-label">산정 원가 <span style="font-size:11px;color:var(--text-3)">(원 단위)</span></label>
            <input class="form-control mono" id="p-cost" type="number" step="1" placeholder="예: 1420000000"
                   value="${project.estimated_cost || ''}">
            <div id="p-cost-preview" style="font-size:11px;color:var(--oci-blue);margin-top:2px"></div>
          </div>
          <div class="form-field">
            <label class="form-label">착수일</label>
            <input class="form-control" id="p-start" type="date" value="${dt(project.start_date)}">
          </div>
          <div class="form-field">
            <label class="form-label">종료(예정)일</label>
            <input class="form-control" id="p-end" type="date" value="${dt(project.end_date)}">
          </div>
          <div class="form-field">
            <label class="form-label">상태</label>
            <select class="form-control" id="p-status">
              ${statusList
                .map(
                  s =>
                    `<option value="${esc(s.status_key)}" ${project.status === s.status_key ? 'selected' : ''}>${esc(s.label || s.status_key)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">납기일</label>
            <input class="form-control" id="p-due" type="date" value="${dt(project.due_date)}">
          </div>
          <div class="form-field">
            <label class="form-label">담당영업</label>
            <select class="form-control" id="p-assigned">
              <option value="">선택</option>
              ${teamOpts(project.assigned_to)}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">프로젝트 PM</label>
            <select class="form-control" id="p-pm">
              <option value="">선택</option>
              ${teamOpts(project.pm_user_id)}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">협업담당 <span style="font-size:11px;color:var(--text-3)">(Ctrl+클릭 다중 선택)</span></label>
            <select class="form-control" id="p-collab" multiple size="3">
              ${team.data.map(t => `<option value="${t.id}" data-name="${esc(t.name)}" ${collabIds.includes(t.id) ? 'selected' : ''}>${esc(t.name)} (${t.role})</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">투입인원 (명)</label>
            <input class="form-control" id="p-headcount" type="number" min="0" step="1" value="${project.headcount ?? ''}">
          </div>
          <div class="form-field full">
            <label class="form-label">메모</label>
            <textarea class="form-control" id="p-notes">${esc(project.notes || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        ${id ? '<button class="btn btn-danger" id="proj-delete-btn">삭제</button>' : ''}
        <button class="btn btn-ghost" id="proj-form-cancel-btn">취소</button>
        <button class="btn btn-primary" id="proj-form-save-btn">저장</button>
      `,
      bind: {
        ...(id ? { '#proj-delete-btn': () => this.deleteProject(id) } : {}),
        '#proj-form-cancel-btn': () => Modal.close(),
        '#proj-form-save-btn': () => this.save(id || null),
      },
      onOpen: () => {
        // 입력값 → KRW 단위 변환 미리보기 실시간 업데이트
        const setupPreview = (inputId, previewId) => {
          const inp = document.getElementById(inputId);
          const prv = document.getElementById(previewId);
          if (!inp || !prv) return;
          const update = () => {
            const v = parseFloat(inp.value);
            prv.textContent = Number.isFinite(v) && v > 0 ? '≈ ' + Fmt.amount(v, 'KRW') : '';
          };
          inp.addEventListener('input', update);
          update();
        };
        setupPreview('p-amount', 'p-amount-preview');
        setupPreview('p-cost', 'p-cost-preview');

        // ─── 고객사 자동완성 (Combobox) ─────────────────
        // 사이드이펙 방지:
        //  - hidden #p-customer-id 는 save() 의 body 객체에 포함되지 않음 (변경 0)
        //  - Combobox 미로드 시 일반 input 동작 (graceful degradation)
        //  - 자유 입력 허용 (신규 고객사 등록은 별도 메뉴)
        const custInput = document.getElementById('p-customer');
        const custHidden = document.getElementById('p-customer-id');
        if (custInput && typeof Combobox !== 'undefined') {
          // 사용자가 input 텍스트 직접 수정 시 hidden id 동기화 해제
          custInput.addEventListener('input', () => {
            if (custHidden) custHidden.value = '';
          });
          Combobox.attach({
            inputEl: custInput,
            fetchFn: async q => {
              try {
                const r = await API.customers.autocomplete(q, 10);
                return r.data || [];
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, q, { highlightMatch }) => {
              const meta = [];
              if (item.industry) meta.push(esc(item.industry));
              if (item.region) meta.push(esc(item.region));
              if (item.active_deals_count > 0) {
                meta.push(
                  `<span style="color:var(--oci-red);font-weight:600">진행 ${item.active_deals_count}건</span>`
                );
              }
              const myBadge = item.is_my_customer
                ? `<span style="font-size:9px;background:var(--oci-red-light);color:var(--oci-red);padding:1px 5px;border-radius:3px;font-weight:600;margin-left:4px">본인담당</span>`
                : '';
              return `
                <div class="combobox-item-content">
                  <div class="combobox-item-title">🏢 ${highlightMatch(item.name, q)}${myBadge}</div>
                  ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
                </div>
              `;
            },
            onSelect: item => {
              custInput.value = item.name;
              if (custHidden) custHidden.value = item.id;
            },
            onCustomCreate: query => {
              custInput.value = query;
              if (custHidden) custHidden.value = '';
            },
            minChars: 2,
            debounceMs: 250,
            allowCustom: true,
            customLabel: '+ "X" 그대로 등록 (신규 고객사)',
          });
        }

        // ─── 관련 영업리드 Combobox — 선택 시 메타 자동 채움 (Phase 2) ───
        //   Won(수주) 리드 우선 정렬 — 프로젝트의 원천은 수주 완료 리드
        const leadInput = document.getElementById('p-lead');
        const leadHidden = document.getElementById('p-lead-id');
        const contractHidden = document.getElementById('p-contract-id');
        const contractInfo = document.getElementById('p-contract-info');
        if (leadInput && typeof Combobox !== 'undefined') {
          leadInput.addEventListener('input', () => {
            if (leadHidden) leadHidden.value = '';
          });
          Combobox.attach({
            inputEl: leadInput,
            minChars: 2,
            debounceMs: 250,
            allowCustom: false,
            fetchFn: async q => {
              try {
                const r = await API.leads.autocomplete(q, 15);
                const rows = r.data || [];
                return rows.sort((a, b) => (b.stage === 'won') - (a.stage === 'won'));
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, q, { highlightMatch }) => {
              const wonBadge =
                item.stage === 'won'
                  ? '<span style="font-size:9px;background:#ECFDF5;color:#0F7A3F;padding:1px 5px;border-radius:3px;font-weight:600;margin-left:4px">수주</span>'
                  : '';
              const meta = [];
              if (item.business_type) meta.push(esc(item.business_type));
              if (item.expected_amount) meta.push(Fmt.amount(item.expected_amount));
              return `
                <div class="combobox-item-content">
                  <div class="combobox-item-title">📈 ${highlightMatch(item.customer_name || '', q)} — ${highlightMatch(item.project_name || '', q)}${wonBadge}</div>
                  ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
                </div>`;
            },
            onSelect: async item => {
              leadInput.value = `${item.customer_name || ''} — ${item.project_name || ''}`;
              if (leadHidden) leadHidden.value = item.id;
              // ── 메타 자동 채움 (리드 → 프로젝트) ──
              const setVal = (elId, v) => {
                const el = document.getElementById(elId);
                if (el && v !== undefined && v !== null && v !== '') el.value = v;
                return el;
              };
              setVal('p-customer', item.customer_name);
              const ch = document.getElementById('p-customer-id');
              if (ch) ch.value = item.customer_id || '';
              const nameI = document.getElementById('p-name');
              if (nameI && !nameI.value.trim()) nameI.value = item.project_name || '';
              const amtI = setVal('p-amount', item.expected_amount);
              if (amtI) amtI.dispatchEvent(new Event('input')); // 억 단위 미리보기 갱신
              const typeS = document.getElementById('p-type');
              if (typeS && item.business_type) {
                if (![...typeS.options].some(o => o.value === item.business_type)) {
                  typeS.add(new Option(item.business_type, item.business_type));
                }
                typeS.value = item.business_type;
              }
              if (item.assigned_to) setVal('p-assigned', String(item.assigned_to));
              // ── 연결 계약 자동 탐색 (수금관리 연계) ──
              if (contractInfo) contractInfo.textContent = '🔍 연결 계약 확인 중...';
              try {
                const r = await API.get(`/contracts?lead_id=${item.id}&limit=1`);
                const c = (r.data || [])[0];
                if (c) {
                  if (contractHidden) contractHidden.value = c.id;
                  if (contractInfo)
                    contractInfo.innerHTML = `🔗 계약 자동 연결: <b>${esc(c.contract_no || c.title || '#' + c.id)}</b> <span style="color:var(--text-3)">(수금관리 연계)</span>`;
                } else {
                  if (contractHidden) contractHidden.value = '';
                  if (contractInfo) contractInfo.textContent = '연결된 계약 없음';
                }
              } catch (_) {
                if (contractInfo) contractInfo.textContent = '';
              }
            },
          });
        }
      },
    });
  },

  async save(id) {
    const val = elId => document.getElementById(elId)?.value;
    // 협업담당 multi-select → [{id,name}] JSON
    const collabSel = document.getElementById('p-collab');
    const collaborators = collabSel
      ? [...collabSel.selectedOptions].map(o => ({
          id: parseInt(o.value, 10),
          name: o.dataset.name || o.text,
        }))
      : [];
    const body = {
      name: document.getElementById('p-name').value.trim(),
      customer_name: document.getElementById('p-customer').value.trim(),
      project_type: document.getElementById('p-type').value,
      contract_amount: parseFloat(document.getElementById('p-amount').value) || null,
      estimated_cost: parseFloat(document.getElementById('p-cost').value) || null,
      status: document.getElementById('p-status').value,
      due_date: document.getElementById('p-due').value || null,
      assigned_to: document.getElementById('p-assigned').value || null,
      notes: document.getElementById('p-notes').value,
      // ── Phase 2 확장 메타 ──
      project_code: (val('p-code') || '').trim() || null,
      lead_id: parseInt(val('p-lead-id'), 10) || null,
      customer_id: parseInt(val('p-customer-id'), 10) || null,
      contract_id: parseInt(val('p-contract-id'), 10) || null,
      start_date: val('p-start') || null,
      end_date: val('p-end') || null,
      stage: val('p-stage') || null,
      pm_user_id: parseInt(val('p-pm'), 10) || null,
      collaborators,
      headcount: parseInt(val('p-headcount'), 10) || null,
      customer_contact: (val('p-customer-contact') || '').trim() || null,
    };
    if (!body.name) return Toast.error('프로젝트명을 입력해주세요');
    try {
      if (id) await API.projects.update(id, body);
      else await API.projects.create(body);
      Toast.success(id ? '프로젝트가 수정되었습니다' : '프로젝트가 등록되었습니다');
      Modal.close();
      this.loadData();
    } catch (_) {}
  },

  deleteProject(id) {
    Modal.confirm('이 프로젝트를 삭제하시겠습니까?', async () => {
      await API.projects.delete(id);
      Toast.success('삭제되었습니다');
      this.loadData();
    });
  },

  // ── Phase 3: 상세 — 단계 스텝퍼 + 전환 + 이력 ────────────────
  _authHeaders() {
    const headers = {};
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const uid = localStorage.getItem('current_user_id');
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  },

  async openDetail(id) {
    // 프로젝트 상세는 필수 — 실패 시 중단
    let p;
    try {
      const pr = await API.get(`/projects/${id}`);
      p = pr.data;
    } catch (_) {
      Toast.error('프로젝트 상세 로드 실패');
      return;
    }
    if (!p) return;

    // 마일스톤 (단계별 목표일·실제 도달일) — 단계 정의 + 계획/실적 일체 (LEFT JOIN)
    // 비치명적: 실패해도 상세는 표시
    let milestones = [];
    try {
      const mr = await API.get(`/projects/${id}/milestones`);
      milestones = mr.data || [];
    } catch (_) {
      /* 마일스톤 로드 실패는 비치명적 (상세는 표시) */
    }

    // 수금 연계(선택) — 연결 계약이 있으면 미수금 집계 (백엔드 무변 — contract_id 필터)
    let payInfo = null;
    if (p.contract_id) {
      try {
        const payRes = await API.get(`/payments?contract_id=${p.contract_id}`);
        const rows = payRes.data || [];
        if (rows.length) {
          const sum = k => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
          const scheduled = sum('scheduled_amount');
          const paid = sum('paid_amount');
          payInfo = {
            count: rows.length,
            scheduled,
            paid,
            outstanding: Math.max(0, scheduled - paid),
          };
        }
      } catch (_) {
        payInfo = null;
      }
    }

    // ── 마일스톤(계획 vs 실제) — project_milestones 기반 ─────────────
    // 목표일·실제 도달일을 단계별로 직접 관리. "실제일 입력 = 도달" → 현재 위치 자동 도출.
    const todayMs = (() => {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return t.getTime();
    })();
    const ymd = v => (v ? String(v).slice(0, 10) : null);
    // 목표일·실제도달일 Gap(일): 양수=지연, 음수=빠름, 0=정시. 둘 중 하나라도 없으면 null.
    const gapOf = (plan, actual) => {
      const pl = ymd(plan);
      const ac = ymd(actual);
      if (!pl || !ac) return null;
      return Math.round((new Date(ac).getTime() - new Date(pl).getTime()) / 86400000);
    };
    // 작은 상태 알약(pill)
    const pill = (bg, c, t) =>
      `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${bg};color:${c}">${t}</span>`;
    // 단계 상태 알약: 도달(Gap 3-state) | 경과/D-day(목표만) | 미설정
    const gapBadge = (plan, actual) => {
      const d = gapOf(plan, actual);
      if (d !== null)
        return d > 0
          ? pill('#FEE2E2', '#B91C1C', `${d}일 지연`)
          : d < 0
            ? pill('#DBEAFE', '#1D4ED8', `${-d}일 빠름`)
            : pill('#DCFCE7', '#15803D', '정시 도달');
      if (ymd(actual)) return pill('#DCFCE7', '#15803D', '도달');
      if (ymd(plan)) {
        // 미도달 — 목표일까지 남은/지난 일수
        const dd = Math.round((new Date(ymd(plan)).getTime() - todayMs) / 86400000);
        return dd < 0
          ? pill('#FEF3C7', '#92400E', `${-dd}일 경과`)
          : pill('#F1F5F9', '#64748B', `D-${dd}`);
      }
      return pill('#F8FAFC', '#94A3B8', '미설정');
    };
    // 현재 위치 = 실제 도달일이 없는 첫 단계 (모두 도달 시 마지막을 현재로)
    let curIdx = milestones.findIndex(m => !m.actual_date);
    if (curIdx === -1) curIdx = milestones.length;
    const reachedCount = milestones.filter(m => m.actual_date).length;
    const curStageLabel = milestones[Math.min(curIdx, milestones.length - 1)]?.label || '';
    // 단계 노드 = 클릭 시 목표일·실제 도달일 입력 (마일스톤 단일화)
    const milestoneHtml = milestones
      .map((m, i) => {
        const plan = ymd(m.plan_date);
        const isDone = !!m.actual_date; // 실제 도달일 입력 = 도달
        const isCur = i === curIdx; // 도달 안 된 첫 단계 = 현재
        const dotBg = isDone ? '#1D9E75' : isCur ? '#F59C00' : '#fff';
        const dotBorder = isDone ? '#1D9E75' : isCur ? '#F59C00' : '#CBD5E1';
        const dotMark = isDone ? '✓' : isCur ? '●' : '';
        const labelColor = isCur || isDone ? 'var(--text-1)' : 'var(--text-3)';
        return `
        <div class="pd-ms-node" data-ms-stage="${esc(m.stage_key)}" title="클릭: 목표일·실제 도달일 입력"
             style="flex:1;min-width:74px;text-align:center;cursor:pointer;padding:2px 1px;border-radius:8px">
          <div style="width:28px;height:28px;border-radius:50%;background:${dotBg};border:2px solid ${dotBorder};margin:0 auto 7px;display:flex;align-items:center;justify-content:center;color:${isDone || isCur ? '#fff' : '#CBD5E1'};font-size:13px;font-weight:700;position:relative;z-index:1;${isCur ? 'box-shadow:0 0 0 4px #F59C0026' : ''}">${dotMark}</div>
          <div style="font-size:12.5px;font-weight:${isCur ? '700' : '500'};color:${labelColor};line-height:1.3">${esc(m.label)}${m.requires_file ? ' 📎' : ''}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">${plan ? plan : '<span style="color:#CBD5E1">목표 미설정</span>'}</div>
          <div style="margin-top:4px">${gapBadge(m.plan_date, m.actual_date)}</div>
        </div>`;
      })
      .join('');
    // 진행 연결선(완료 초록) 비율 — 도달 단계 수 기준
    const N = milestones.length;
    const lineInset = N > 1 ? 100 / (2 * N) : 50;
    const reachedIdx = Math.max(0, Math.min(curIdx, N - 1));
    const filledPct = N > 1 ? (reachedIdx / (N - 1)) * (100 - 2 * lineInset) : 0;

    // 일정 Gap 요약 — 목표일·실제 도달일이 모두 있는 단계의 편차(일) 집계
    const gaps = milestones.map(m => gapOf(m.plan_date, m.actual_date)).filter(d => d !== null);
    let gapCard = '';
    if (gaps.length) {
      const net = gaps.reduce((x, y) => x + y, 0);
      const totalDelay = gaps.filter(g => g > 0).reduce((x, y) => x + y, 0);
      const avg = net / gaps.length;
      const netTxt =
        net > 0
          ? `평균 ${avg.toFixed(1)}일 지연`
          : net < 0
            ? `평균 ${Math.abs(avg).toFixed(1)}일 빠름`
            : '평균 정시';
      gapCard = `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:#F9FAFB;border:1px solid var(--border);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12px">
        <span style="font-weight:700">📊 일정 Gap</span>
        <span>비교 단계 <b>${gaps.length}</b></span>
        <span>누적 지연 <b style="color:#B91C1C">${totalDelay}일</b></span>
        <span style="color:${net > 0 ? '#B91C1C' : '#15803D'};font-weight:600">${netTxt}</span>
        <span style="color:var(--text-3);margin-left:auto">목표일·실제 도달일 입력 단계 기준</span>
      </div>`;
    }

    // 단계별 일정 테이블 — 목표일 vs 실제 도달일 vs Gap (클릭으로 상시 변경)
    const schedHtml = milestones.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--text-3);border-bottom:1px solid var(--border)">
            <th style="padding:6px 8px;font-weight:600">단계</th>
            <th style="padding:6px 8px;font-weight:600">목표일</th>
            <th style="padding:6px 8px;font-weight:600">실제 도달일</th>
            <th style="padding:6px 8px;font-weight:600">Gap</th>
            <th style="padding:6px 8px;font-weight:600;text-align:right">산출물</th>
          </tr></thead>
          <tbody>${milestones
            .map(m => {
              const plan = ymd(m.plan_date);
              const actual = ymd(m.actual_date);
              return `<tr data-ms-row="${esc(m.stage_key)}" style="border-bottom:1px solid var(--border);cursor:pointer" title="클릭: 목표일·실제 도달일 수정">
                <td style="padding:6px 8px;font-weight:600">${esc(m.label)}${m.requires_file ? ' 📎' : ''}</td>
                <td style="padding:6px 8px;color:${plan ? 'var(--text-2)' : '#CBD5E1'}">${plan || '—'}</td>
                <td style="padding:6px 8px;color:${actual ? '#15803D' : '#CBD5E1'}">${actual || '—'}</td>
                <td style="padding:6px 8px">${gapBadge(m.plan_date, m.actual_date)}</td>
                <td style="padding:6px 8px;text-align:right">${Number(m.file_count) > 0 ? `<span style="font-size:11px;color:var(--text-2);font-weight:600">📎 ${m.file_count}건</span>` : `<span style="font-size:11px;color:#CBD5E1">없음</span>`}</td>
              </tr>`;
            })
            .join('')}</tbody>
        </table>`
      : '<div style="padding:14px;color:var(--text-3);font-size:12px;text-align:center">등록된 단계가 없습니다</div>';

    const won = v => (v ? '₩' + Number(v).toLocaleString('ko-KR') : '-');
    // 메타 정보 항목 (라벨 위 · 값 아래 — 가독성)
    const meta = (label, val) =>
      `<div><div style="font-size:11px;color:var(--text-3);margin-bottom:2px">${label}</div><div style="font-size:13px;color:var(--text-1)">${val}</div></div>`;
    // 연결 상세로 이동하는 링크 값 — id 있을 때만 링크, 없으면 일반 텍스트(graceful)
    const linkVal = (text, attr, id) =>
      id
        ? `<a href="#" data-${attr}="${id}" style="color:#1664E5;text-decoration:none;border-bottom:1px dotted #93B4F9;cursor:pointer">${esc(text)}</a>`
        : esc(text || '-');
    // 수금 연계 카드 — 연결 계약의 수금 계획/실적 요약 (영업리드→수주→계약→수금 흐름의 마지막 고리)
    const payCard = payInfo
      ? `<div style="display:flex;align-items:center;gap:12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;margin-bottom:16px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:#1664E5">🔗 수금 연계</span>
          <span style="font-size:12px;color:var(--text-2)">계약 #${p.contract_id} · 수금계획 ${won(payInfo.scheduled)} · 완료 ${won(payInfo.paid)}</span>
          ${
            payInfo.outstanding > 0
              ? `<span style="font-size:12px;font-weight:700;color:#E63329">미수금 ${won(payInfo.outstanding)}</span>`
              : '<span style="font-size:12px;font-weight:600;color:#0F7A3F">전액 수금 ✓</span>'
          }
          <button class="btn btn-sm" id="pd-go-pay" style="margin-left:auto;font-size:12px;background:#fff;color:#1664E5;border:1px solid #BFDBFE">수금관리에서 보기 →</button>
        </div>`
      : p.contract_id
        ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:16px">🔗 연결 계약 #${p.contract_id} <span style="color:var(--text-3)">(등록된 수금 계획 없음)</span></div>`
        : '';
    Modal.open({
      title: `${p.project_code ? esc(p.project_code) + ' · ' : ''}${esc(p.name)}`,
      confirmOnClose: false,
      body: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px 18px;background:#F9FAFB;border:1px solid var(--border);border-radius:10px;padding:13px 16px;margin-bottom:16px">
          ${meta('고객사', linkVal(p.customer_name, 'go-customer', p.customer_id))}
          ${meta('관련 영업리드', linkVal(p.lead_name || (p.lead_id ? '리드 #' + p.lead_id : null), 'go-lead', p.lead_id))}
          ${meta('계약금액', `<b style="font-size:15px">${won(p.contract_amount)}</b>`)}
          ${meta('기간', `${p.start_date ? String(p.start_date).slice(0, 10) : '-'} ~ ${p.end_date ? String(p.end_date).slice(0, 10) : '-'}`)}
          ${meta('담당영업', esc(p.assigned_name || '-'))}
          ${meta('PM', esc(p.pm_name || '-'))}
          ${p.headcount ? meta('투입인원', p.headcount + '명') : ''}
          ${p.customer_contact ? meta('담당고객', esc(p.customer_contact)) : ''}
        </div>
        ${payCard}
        ${
          milestones.length
            ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                 <div style="font-size:15px;font-weight:700">진행 단계${curStageLabel ? ` <span style="font-size:12px;font-weight:600;color:#92400E;background:#FEF3C7;padding:2px 9px;border-radius:10px;margin-left:4px">현재 · ${esc(curStageLabel)}</span>` : ''} <span style="font-size:12px;font-weight:400;color:var(--text-3)">${reachedCount}/${milestones.length} 도달</span></div>
                 <div style="font-size:11px;color:var(--text-3)">노드·행 클릭 → <b style="font-weight:600">목표일·실제 도달일</b> 입력 · 배지 = 목표 대비 편차 (🔵 빠름 · 🟢 정시 · 🔴 지연) · 📎 증빙 필수</div>
               </div>
               ${gapCard}
               <div style="position:relative;padding-top:4px;margin-bottom:18px">
                 <div style="position:absolute;top:18px;left:${lineInset}%;right:${lineInset}%;height:3px;background:#E5E7EB;border-radius:2px"></div>
                 <div style="position:absolute;top:18px;left:${lineInset}%;width:${filledPct}%;height:3px;background:#1D9E75;border-radius:2px"></div>
                 <div style="display:flex;gap:2px;position:relative">${milestoneHtml}</div>
               </div>`
            : ''
        }
        <div style="font-size:14px;font-weight:700;margin:4px 0 8px">단계별 일정 <span style="font-size:12px;font-weight:400;color:var(--text-3)">목표 vs 실제 도달</span></div>
        <div id="pd-sched" style="max-height:300px;overflow-y:auto">${schedHtml}</div>
      `,
      footer: `
        <button class="btn btn-ghost" id="pd-edit">✏️ 편집</button>
        <button class="btn btn-secondary" id="pd-close">닫기</button>
      `,
      bind: {
        '#pd-close': () => Modal.close(),
        '#pd-edit': () => {
          Modal.close();
          this.openForm(id);
        },
        '#pd-go-pay': () => {
          Modal.close();
          location.hash = '#payments';
        },
        // 고객사 클릭 → 고객사 상세 모달로 이동
        '[data-go-customer]': e => {
          e.preventDefault();
          const cid = parseInt(e.currentTarget.dataset.goCustomer, 10);
          if (!cid || typeof App === 'undefined' || !App.openDetail) return;
          Modal.close();
          App.openDetail('customers', cid);
        },
        // 관련 영업리드 클릭 → 리드 상세로 이동
        '[data-go-lead]': e => {
          e.preventDefault();
          const lid = parseInt(e.currentTarget.dataset.goLead, 10);
          if (!lid || typeof App === 'undefined' || !App.openDetail) return;
          Modal.close();
          App.openDetail('leads', lid);
        },
        // 단계 노드 클릭 → 목표일·실제 도달일 편집
        '[data-ms-stage]': e => {
          const key = e.currentTarget.dataset.msStage;
          const m = milestones.find(x => x.stage_key === key);
          if (m) this._openMilestoneEditor(p, m);
        },
        // 일정표 행 클릭 → 편집 (목표일·실제 도달일·산출물)
        '[data-ms-row]': e => {
          const key = e.currentTarget.dataset.msRow;
          const m = milestones.find(x => x.stage_key === key);
          if (m) this._openMilestoneEditor(p, m);
        },
      },
    });
  },

  // 마일스톤 편집 서브 모달 — 단계별 목표일·실제 도달일 + 산출물(다중) 상시 관리
  async _openMilestoneEditor(p, m) {
    const _z = n => String(n).padStart(2, '0');
    const _d = new Date();
    const todayStr = `${_d.getFullYear()}-${_z(_d.getMonth() + 1)}-${_z(_d.getDate())}`;
    const planVal = m.plan_date ? String(m.plan_date).slice(0, 10) : '';
    const actualVal = m.actual_date ? String(m.actual_date).slice(0, 10) : '';
    const stage = encodeURIComponent(m.stage_key);

    // 단계별 예상 산출물 가이드 (음영 안내 칩)
    const guideItems = String(m.deliverable_guide || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    const guideHtml = guideItems.length
      ? `<div style="font-size:11px;color:var(--text-3);margin-bottom:8px;line-height:1.7">📋 예상 산출물 ${guideItems
          .map(
            g =>
              `<span style="display:inline-block;background:#F1F5F9;color:#94A3B8;border-radius:6px;padding:1px 7px;margin:0 3px 3px 0">${esc(g)}</span>`
          )
          .join('')}</div>`
      : '';

    // 기존 산출물 파일 목록 (모달 열기 전 로드 — 정적 렌더로 바인딩 단순화)
    let files = [];
    try {
      const fr = await fetch(`/api/projects/${p.id}/milestones/${stage}/files`, {
        headers: this._authHeaders(),
      });
      if (fr.ok) files = (await fr.json()).data || [];
    } catch (_) {
      /* 비치명적 */
    }
    const fileRow = f => `
      <div data-ms-file-row="${f.id}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:5px;font-size:12px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 ${esc(f.file_name)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-ms-dlfile="${f.id}" data-ms-fname="${esc(f.file_name)}" style="font-size:11px" title="다운로드">⤓</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ms-delfile="${f.id}" style="font-size:11px;color:var(--oci-red)" title="삭제">🗑</button>
      </div>`;
    const emptyFiles =
      '<div style="font-size:12px;color:#CBD5E1;padding:4px 0">등록된 산출물 없음</div>';
    const filesListHtml = files.length ? files.map(fileRow).join('') : emptyFiles;

    Modal.open({
      title: `마일스톤 — ${esc(m.label)}`,
      compact: true,
      width: 560,
      confirmOnClose: false,
      body: `
        <div style="font-size:13px;margin-bottom:14px">
          <b>${esc(p.project_code || p.name)}</b> · <b style="color:var(--oci-red)">${esc(m.label)}</b> 단계의 <b>목표일</b>·<b>실제 도달일</b>·<b>산출물</b>을 관리합니다.
        </div>
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <div class="form-field" style="flex:1;min-width:180px">
            <label class="form-label">목표일 <span style="font-size:11px;color:var(--text-3)">(계획)</span></label>
            <input class="form-control" id="ms-plan" type="date" value="${planVal}">
          </div>
          <div class="form-field" style="flex:1;min-width:180px">
            <label class="form-label">실제 도달일 <span style="font-size:11px;color:var(--text-3)">(완료 시점 · 비우면 미도달)</span></label>
            <div style="display:flex;gap:6px;align-items:center">
              <input class="form-control" id="ms-actual" type="date" value="${actualVal}" style="flex:1">
              <button type="button" class="btn btn-ghost btn-sm" id="ms-today" style="white-space:nowrap;font-size:11px">오늘</button>
            </div>
          </div>
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label class="form-label">산출물 ${m.requires_file ? '<span style="font-size:11px;color:var(--oci-red)">(도달 기록 시 1건 이상 필수)</span>' : '<span style="font-size:11px;color:var(--text-3)">(증빙 파일 · 다중 첨부)</span>'}</label>
          ${guideHtml}
          <div id="ms-files-list" style="margin-bottom:8px">${filesListHtml}</div>
          <input class="form-control" id="ms-files-input" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.hwp" style="font-size:12px">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">선택한 파일은 [저장] 시 업로드됩니다.</div>
        </div>
        <div class="form-field">
          <label class="form-label">메모</label>
          <textarea class="form-control" id="ms-note" rows="2" placeholder="특이사항 (선택)">${esc(m.note || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="ms-cancel">취소</button>
        <button class="btn btn-primary" id="ms-save">저장</button>
      `,
      bind: {
        '#ms-cancel': () => {
          Modal.close();
          this.openDetail(p.id);
        },
        '#ms-today': () => {
          const el = document.getElementById('ms-actual');
          if (el) el.value = todayStr;
        },
        // 산출물 다운로드
        '[data-ms-dlfile]': async e => {
          const fid = e.currentTarget.dataset.msDlfile;
          const name = e.currentTarget.dataset.msFname || 'file';
          try {
            const res = await fetch(`/api/projects/${p.id}/milestones/${stage}/files/${fid}`, {
              headers: this._authHeaders(),
            });
            if (!res.ok) throw new Error('다운로드 실패');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            a.click();
            URL.revokeObjectURL(url);
          } catch (err) {
            Toast.error(err.message || '다운로드 실패');
          }
        },
        // 산출물 즉시 삭제
        '[data-ms-delfile]': async e => {
          const fid = e.currentTarget.dataset.msDelfile;
          const row = e.currentTarget.closest('[data-ms-file-row]');
          try {
            const res = await fetch(`/api/projects/${p.id}/milestones/${stage}/files/${fid}`, {
              method: 'DELETE',
              headers: this._authHeaders(),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || '삭제 실패');
            if (row) row.remove();
            const list = document.getElementById('ms-files-list');
            if (list && !list.querySelector('[data-ms-file-row]')) list.innerHTML = emptyFiles;
            Toast.success('산출물이 삭제되었습니다');
          } catch (err) {
            Toast.error(err.message || '삭제 실패');
          }
        },
        '#ms-save': async () => {
          const plan = document.getElementById('ms-plan')?.value || '';
          const actual = document.getElementById('ms-actual')?.value || '';
          const note = document.getElementById('ms-note')?.value || '';
          const input = document.getElementById('ms-files-input');
          const selected = input?.files?.length || 0;
          const existing = document.querySelectorAll('#ms-files-list [data-ms-file-row]').length;
          // requires_file 게이트: 도달(실제일) 기록 시 산출물 1건 이상 (기존 + 신규 선택)
          if (m.requires_file && actual && existing + selected === 0)
            return Toast.error(`"${m.label}" 단계는 도달(실제일) 기록 시 산출물이 1건 이상 필요합니다`);
          try {
            // 1) 선택한 산출물 업로드 (있으면)
            if (selected) {
              const fd = new FormData();
              for (const f of input.files) fd.append('files', f);
              const ur = await fetch(`/api/projects/${p.id}/milestones/${stage}/files`, {
                method: 'POST',
                headers: this._authHeaders(),
                body: fd,
              });
              const ud = await ur.json();
              if (!ud.success) throw new Error(ud.error || '산출물 업로드 실패');
            }
            // 2) 목표일/실제일/메모 저장 (JSON)
            const res = await fetch(`/api/projects/${p.id}/milestones/${stage}`, {
              method: 'PUT',
              headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan_date: plan, actual_date: actual, note }),
            });
            const data = await res.json();
            if (!data.success) {
              if (data.requires_file) return Toast.error(data.error || '증빙 산출물이 필요합니다');
              throw new Error(data.error || '저장 실패');
            }
            Toast.success(
              `"${m.label}" 일정이 저장되었습니다${data.data?.status_synced ? ' (상태: 완료 동기화)' : ''}`
            );
            this.loadData();
            this.openDetail(p.id);
          } catch (err) {
            Toast.error(err.message || '저장 실패');
          }
        },
      },
    });
  },
};
