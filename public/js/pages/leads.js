// ============================================================
// Leads Page (테이블 + CRUD + Copy & Paste)
// ============================================================
const LeadsPage = {
  filters: {
    search: '',
    stage: '',
    region: '',
    assigned_to: '',
    business_type: '',
    date_from: '',
    date_to: '',
    date_field: 'close',
  },
  team: [],
  _selectedIds: new Set(), // 체크박스 선택된 리드 ID
  _allLeads: [], // 현재 렌더링된 리드 목록 (복사용)
  _pasteHandler: null, // Ctrl+V 핸들러 (페이지 언마운트 시 제거)
  // v6.0.0: 뷰 모드 (목록/카드) — localStorage 동기화
  _view: localStorage.getItem('leads_view') || 'list',

  async render() {
    const html = `
      <!-- v6.0.0: KPI 바 (5개 모듈 통일) -->
      <div id="leads-kpi-bar"></div>
      <div class="filter-bar">
        <input type="text" class="search-input" id="leads-search" data-placeholder-label="leads.search_placeholder" placeholder="고객사, 프로젝트명, 메모 검색...">
        <span style="flex:1"></span>
        <button class="btn btn-primary" id="leads-open-form-btn" data-label="leads.new_button">+ 영업딜 등록</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span data-label="leads.list_title">영업딜 목록</span> <span class="text-muted fs-12" id="leads-count"></span></div>
          <div style="display:flex;align-items:center;gap:8px">
            <div id="leads-active-filters" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center"></div>
            <!-- Copy & Paste 툴바 -->
            <div class="cp-toolbar" id="cp-toolbar" style="display:none">
              <span class="cp-sel-count" id="cp-sel-count" data-label="common.selected_count">0건 선택</span>
              <button class="btn btn-ghost btn-sm" id="cp-copy-btn" title="선택된 행을 클립보드에 복사 (Excel/Word에 붙여넣기 가능)" data-label="common.copy">
                📋 복사
              </button>
              <button class="btn btn-ghost btn-sm" id="leads-clear-sel-btn" data-label="common.clear_selection">선택 해제</button>
            </div>
            <button class="btn btn-ghost btn-sm" id="cp-paste-btn"
              data-feature="data.bulk_paste"
              title="Excel·Word·이메일에서 복사한 표 데이터를 붙여넣기로 일괄 등록"
              data-label="common.paste_register">
              📥 붙여넣기 등록
            </button>
            <button class="btn btn-ghost btn-sm" id="leads-export-btn"
              data-feature="data.excel_exp"
              title="현재 필터 결과를 엑셀 파일로 다운로드"
              data-label="common.excel_export">
              📤 엑셀 다운로드
            </button>
            <label class="btn btn-ghost btn-sm" data-feature="data.excel_imp"
              title="엑셀 파일로 일괄 등록" style="cursor:pointer;margin:0">
              <span data-label="common.excel_import">📂 엑셀 가져오기</span>
              <input type="file" id="leads-import-input" accept=".xlsx,.xls" style="display:none">
            </label>
            <!-- 컬럼 필터 (공용 FilterPopover) -->
            ${FilterPopover.renderButton('leads-flt')}
            <!-- v6.0.0: 5개 모듈 통일 뷰 토글 -->
            ${ViewToggle.render({ currentView: this._view })}
          </div>
        </div>
        <div class="card-body no-pad" id="leads-table-wrap">
          <div class="loading" data-label="common.loading">로딩중...</div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // v6.0.0: KPI 대시보드 로드 (best-effort)
    this._loadKpiBar();

    const team = await API.team.list();
    this.team = team.data;

    // v6.0.0: ViewToggle 바인딩 (목록/카드 전환)
    if (typeof ViewToggle !== 'undefined') {
      const toggleEl = document.querySelector('#content .view-toggle');
      if (toggleEl) {
        ViewToggle.bind(
          toggleEl,
          view => {
            this._view = view;
            // 현재 데이터 재렌더
            if (this._allLeads && this._allLeads.length >= 0) {
              this.renderTable(this._allLeads);
            }
          },
          'leads_view'
        );
      }
    }

    // toolbar / header buttons
    document
      .getElementById('leads-open-form-btn')
      ?.addEventListener('click', () => App.openLeadForm());
    document.getElementById('cp-copy-btn')?.addEventListener('click', () => this.copySelected());
    document
      .getElementById('leads-clear-sel-btn')
      ?.addEventListener('click', () => this._clearSelection());
    document.getElementById('cp-paste-btn')?.addEventListener('click', () => this.openPasteModal());
    document
      .getElementById('leads-export-btn')
      ?.addEventListener('click', e => this._openExportMenu(e.currentTarget));
    document
      .getElementById('leads-import-input')
      ?.addEventListener('change', e => this.importExcel(e.target));

    // 검색어
    document.getElementById('leads-search').addEventListener(
      'input',
      debounce(e => {
        this.filters.search = e.target.value;
        this.loadData();
      }, 300)
    );

    // 컬럼 필터 — 공용 FilterPopover (우상단)
    const stageOpts = [
      { value: '', label: '전체 단계' },
      { value: 'lead', label: '발굴/니즈파악' },
      { value: 'review', label: '샘플 평가' },
      { value: 'proposal', label: 'Spec-in/승인' },
      { value: 'bidding', label: '가격 협의' },
      { value: 'negotiation', label: '공급계약' },
      { value: 'won', label: '양산/정기수주' },
      { value: 'lost', label: '실주' },
      { value: 'dropped', label: '드롭' },
    ];
    const bizOpts = [{ value: '', label: '전체 사업유형' }].concat(
      ['식각가스', '프리커서', 'Wet Chemical', '디스플레이소재', '포토소재', '통합서비스'].map(b => ({ value: b, label: b }))
    );
    this._flt = FilterPopover.attach({
      buttonId: 'leads-flt',
      fields: [
        { key: 'stage', label: '단계', type: 'select', options: stageOpts },
        { key: 'business_type', label: '사업유형', type: 'select', options: bizOpts },
        { key: 'region', label: '구분', type: 'select', options: [{ value: '', label: '국내/해외' }, { value: '국내', label: '국내' }, { value: '해외', label: '해외' }] },
        { key: 'assigned_to', label: '담당자', type: 'select', options: [{ value: '', label: '전체 담당자' }, ...this.team.map(t => ({ value: String(t.id), label: t.name }))] },
        { key: 'date_field', label: '날짜 기준', type: 'select', options: [{ value: 'close', label: '마감일' }, { value: 'updated', label: '수정일' }, { value: 'created', label: '등록일' }] },
        { key: '', label: '기간', type: 'daterange', fromKey: 'date_from', toKey: 'date_to' },
      ],
      values: {
        stage: this.filters.stage || '',
        business_type: this.filters.business_type || '',
        region: this.filters.region || '',
        assigned_to: this.filters.assigned_to || '',
        date_field: this.filters.date_field || 'close',
        date_from: this.filters.date_from || '',
        date_to: this.filters.date_to || '',
      },
      onApply: v => {
        Object.assign(this.filters, v);
        this.loadData();
      },
    });

    // Ctrl+V 전역 붙여넣기 핸들러 등록
    this._bindPasteShortcut();

    await this.loadData();
  },

  // ── Ctrl+V 단축키 등록 ──────────────────────────────────────
  // ── v6.0.0: 상단 KPI 바 (5개 모듈 통일) ──────────────────
  async _loadKpiBar() {
    if (typeof KpiBar === 'undefined') return;
    KpiBar.renderLoading('#leads-kpi-bar', 4);
    try {
      const res = await API.leads.dashboard();
      const d = res?.data || {};
      KpiBar.render({
        containerSel: '#leads-kpi-bar',
        cards: [
          { icon: '🎯', label: '진행 중', value: d.active, color: '#3b82f6', sub: '활성 영업딜' },
          { icon: '🔥', label: '마감 임박', value: d.deadline_7d, color: '#dc2626', sub: 'D-7 이내 입찰' },
          { icon: '🏆', label: '수주', value: d.won, color: '#16a34a', sub: '계약 완료' },
          { icon: '💰', label: '파이프라인', value: d.pipeline_amount, color: '#7c3aed', sub: '활성 딜 합계' },
        ],
      });
    } catch (e) {
      console.warn('[leads] KPI 로드 실패:', e.message);
      document.getElementById('leads-kpi-bar').innerHTML = '';
    }
  },

  _bindPasteShortcut() {
    if (this._pasteHandler) document.removeEventListener('keydown', this._pasteHandler);
    this._pasteHandler = e => {
      // 입력 필드에 포커스된 경우는 무시
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
      const result = await API.leads.list(this.filters);
      this._allLeads = result.data;
      this.renderTable(result.data);
      this.renderActiveFilters();
    } catch (err) {
      console.error(err);
    }
  },

  renderActiveFilters() {
    const wrap = document.getElementById('leads-active-filters');
    if (!wrap) return;
    const chips = [];
    const dateFieldLabel = { close: '마감일', updated: '수정일', created: '등록일' };
    if (this.filters.search)
      chips.push([
        '검색',
        this.filters.search,
        () => {
          this.filters.search = '';
          document.getElementById('leads-search').value = '';
        },
      ]);
    if (this.filters.stage)
      chips.push([
        '단계',
        STAGES[this.filters.stage]?.label || this.filters.stage,
        () => {
          this.filters.stage = '';
          this._flt?.setValues({ stage: '' });
        },
      ]);
    if (this.filters.business_type)
      chips.push([
        '유형',
        this.filters.business_type,
        () => {
          this.filters.business_type = '';
          this._flt?.setValues({ business_type: '' });
        },
      ]);
    if (this.filters.region)
      chips.push([
        '구분',
        this.filters.region,
        () => {
          this.filters.region = '';
          this._flt?.setValues({ region: '' });
        },
      ]);
    if (this.filters.assigned_to) {
      const member = this.team.find(t => String(t.id) === String(this.filters.assigned_to));
      chips.push([
        '담당자',
        member?.name || this.filters.assigned_to,
        () => {
          this.filters.assigned_to = '';
          this._flt?.setValues({ assigned_to: '' });
        },
      ]);
    }
    if (this.filters.date_from || this.filters.date_to) {
      const label = `${dateFieldLabel[this.filters.date_field]}: ${this.filters.date_from || '∞'} ~ ${this.filters.date_to || '∞'}`;
      chips.push([
        '기간',
        label,
        () => {
          this.filters.date_from = '';
          this.filters.date_to = '';
          this._flt?.setValues({ date_from: '', date_to: '' });
        },
      ]);
    }
    if (!chips.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = chips
      .map(
        (c, i) =>
          `<span class="filter-chip" data-filter-idx="${i}">${c[0]}: <strong>${esc(c[1])}</strong> ✕</span>`
      )
      .join('');
    this._filterChipCallbacks = chips.map(c => c[2]);

    wrap.addEventListener(
      'click',
      e => {
        const chip = e.target.closest('.filter-chip[data-filter-idx]');
        if (chip) this._removeFilter(parseInt(chip.dataset.filterIdx));
      },
      { once: true }
    );
  },

  _removeFilter(idx) {
    if (this._filterChipCallbacks?.[idx]) {
      this._filterChipCallbacks[idx]();
      this.loadData();
    }
  },

  // ── 테이블 렌더링 (체크박스 컬럼 추가) ──────────────────────
  renderTable(leads) {
    // v6.0.0: 카드뷰 분기 (목록 vs 카드)
    this._allLeads = leads;
    // 영업딜 목록이 화면에 없으면(상세 페이지 등) 캐시만 갱신하고 DOM 렌더는 skip
    const countEl = document.getElementById('leads-count');
    if (!countEl) return;
    countEl.textContent = `(총 ${leads.length}건)`;
    if (this._view === 'card' && leads.length > 0) {
      return this._renderCardList(leads);
    }

    if (!leads.length) {
      // 필터가 적용된 상태에서 0건 vs 진짜 데이터 0건 구분
      const f = this.filters || {};
      const hasFilter = f.stage || f.region || f.assigned_to || f.business_type || f.search;
      const presetKey = hasFilter ? 'filter' : 'leads';
      const html =
        typeof EmptyState !== 'undefined'
          ? EmptyState.preset(presetKey)
          : '<div class="empty"><div class="empty-icon">📋</div>등록된 영업딜이 없습니다</div>';
      document.getElementById('leads-table-wrap').innerHTML = html;
      // primary 버튼 클릭 핸들러 (preset='leads' 일 때만)
      if (!hasFilter) {
        document
          .getElementById('empty-leads-new')
          ?.addEventListener('click', () => App.openLeadForm?.());
      }
      return;
    }

    // 단계 표시 — 단조로운 단일 진행도 도넛 아이콘 (클릭 시 드롭다운으로 변경)
    const stageBadge = stage => this._stageDonut(stage, 18);

    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th class="cp-check-col" style="width:36px">
              <input type="checkbox" class="cp-checkbox" id="cp-check-all" title="전체 선택">
            </th>
            <th data-label="leads.customer_name">고객사</th>
            <th data-label="leads.project_name">프로젝트명</th>
            <th data-label="leads.business_type">사업유형</th>
            <th class="text-right" data-label="leads.capacity_mw">예상 물량</th>
            <th class="text-right" data-label="leads.expected_amount">예상 매출</th>
            <th data-label="leads.stage">상태</th>
            <th>구분</th>
            <th data-label="leads.assigned_to">담당자</th>
            <th data-label="leads.expected_close_date">예상 마감일</th>
            <th data-label="leads.last_activity">최종 활동</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${leads
            .map(l => {
              // v6.0.0: 읽음/안읽음 시각화
              const rrBadge =
                typeof ReadReceipts !== 'undefined' ? ReadReceipts.renderTitleBadge(l) : '';
              const rrStyle =
                typeof ReadReceipts !== 'undefined' ? ReadReceipts.rowStyleAttr(l) : '';
              const rrTooltip =
                typeof ReadReceipts !== 'undefined' ? ReadReceipts.tooltipAttr(l) : '';
              return `
            <tr class="clickable${this._selectedIds.has(l.id) ? ' cp-selected' : ''}"
                data-lead-id="${l.id}" style="${rrStyle}"${rrTooltip}>
              <td class="cp-check-col" data-stop-propagation="1">
                <input type="checkbox" class="cp-checkbox" data-id="${l.id}"
                  ${this._selectedIds.has(l.id) ? 'checked' : ''}>
              </td>
              <td><strong>${rrBadge}${esc(l.customer_name)}</strong></td>
              <td>${esc(l.project_name)}</td>
              <td><span class="badge ${BUSINESS_COLORS[l.business_type] || 'badge-gray'}">${esc(l.business_type)}</span></td>
              <td class="text-right mono">${l.capacity_mw ? parseFloat(l.capacity_mw).toFixed(0) : '-'}</td>
              <td class="text-right mono">${Fmt.amount(l.expected_amount, l.currency)}</td>
              <td data-stop-propagation="1">
                <span class="lead-stage-trigger" data-lead-id="${l.id}" data-stage="${esc(l.stage)}"
                      style="cursor:pointer;display:inline-flex;align-items:center;gap:4px" title="${esc(this._stageLabel(l.stage))} · 클릭하여 단계 변경">
                  ${stageBadge(l.stage)}
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-3)"><path d="m6 9 6 6 6-6"/></svg>
                </span>
              </td>
              <td><span class="badge ${l.region === '해외' || l.region === 'overseas' ? 'badge-purple' : 'badge-blue'}">${l.region === '해외' || l.region === 'overseas' ? '해외' : '국내'}</span></td>
              <td>${esc(l.assigned_name || '-')}</td>
              <td>${Fmt.date(l.expected_close_date)}</td>
              <td class="text-muted fs-11">${Fmt.relTime(l.updated_at)}</td>
              <td data-stop-propagation="1">
                <button class="btn btn-ghost btn-sm" data-action="edit-lead" data-lid="${l.id}">편집</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
    const wrap = document.getElementById('leads-table-wrap');
    wrap.innerHTML = html;
    this._updateSelectionUI();

    wrap.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');
      if (stopEl) {
        e.stopPropagation();
      }

      const actionBtn = e.target.closest('[data-action="edit-lead"]');
      if (actionBtn) {
        this.editLead(parseInt(actionBtn.dataset.lid));
        return;
      }

      // 단계 셀 클릭 → 인라인 단계 선택 드롭다운
      const stageTrig = e.target.closest('.lead-stage-trigger');
      if (stageTrig) {
        this._openStagePopover(stageTrig, parseInt(stageTrig.dataset.leadId), stageTrig.dataset.stage);
        return;
      }

      const cb = e.target.closest('.cp-checkbox[data-id]');
      if (cb) {
        this._toggleRow(parseInt(cb.dataset.id), cb.checked);
        return;
      }

      const hdrCb = e.target.closest('#cp-check-all');
      if (hdrCb) {
        this._toggleAll(hdrCb.checked);
        return;
      }

      if (!stopEl) {
        const tr = e.target.closest('tr[data-lead-id]');
        if (tr) App.openLeadDetail(parseInt(tr.dataset.leadId));
      }
    });
  },

  // ── 단계 진행도 도넛 아이콘 (단조로운 단일 써클) ─────────────
  //   정상 단계는 진행 비율(0→1)만큼 링이 채워지고, 종료 단계는 꽉 찬 링.
  _STAGE_ORDER: ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won'],
  _STAGE_COLOR: {
    lead: '#9ca3af',
    review: '#3b82f6',
    proposal: '#06b6d4',
    bidding: '#8b5cf6',
    negotiation: '#f59e0b',
    won: '#16a34a',
    lost: '#dc2626',
    dropped: '#9ca3af',
  },
  _stageLabel(stageKey) {
    return (typeof STAGES !== 'undefined' && STAGES[stageKey] && STAGES[stageKey].label) || stageKey || '';
  },
  _stageDonut(stageKey, size = 18) {
    const stroke = Math.max(2, Math.round(size / 6));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const cx = size / 2;
    const color = this._STAGE_COLOR[stageKey] || '#9ca3af';
    const idx = this._STAGE_ORDER.indexOf(stageKey);
    let frac = idx >= 0 ? idx / (this._STAGE_ORDER.length - 1) : 1; // 정상=진행률, 종료=꽉참
    frac = Math.max(0.1, Math.min(1, frac)); // 최소 가시성
    const dash = `${(frac * c).toFixed(2)} ${c.toFixed(2)}`;
    const k = size / 18;
    const check =
      stageKey === 'won'
        ? `<path d="M${(5.6 * k).toFixed(1)} ${(9.4 * k).toFixed(1)} L${(8.1 * k).toFixed(1)} ${(11.8 * k).toFixed(1)} L${(12.6 * k).toFixed(1)} ${(6.6 * k).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(stroke * 0.8).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`
        : '';
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;flex-shrink:0" aria-hidden="true">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
      ${check}
    </svg>`;
  },

  // ── 인라인 단계 선택 드롭다운 (테이블 단계 셀 클릭) ──────────
  _closeStagePop() {
    document.querySelectorAll('.lead-stage-pop').forEach(el => el.remove());
    if (this._stagePopOutside) {
      document.removeEventListener('click', this._stagePopOutside, true);
      this._stagePopOutside = null;
    }
  },
  _openStagePopover(triggerEl, leadId, current) {
    this._closeStagePop();
    // STAGES(서버 동기화) 를 sort_order 순으로 — 없으면 기본 8단계
    const entries = Object.entries(STAGES || {})
      .map(([k, v]) => ({ key: k, label: v.label, role: v.role, order: v.sort_order || 0 }))
      .sort((a, b) => a.order - b.order);
    const menu = document.createElement('div');
    menu.className = 'lead-stage-pop';
    menu.style.cssText =
      'position:fixed;z-index:9600;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);padding:6px';
    menu.innerHTML = entries
      .map(
        s => `<button class="lead-stage-opt" data-stage="${s.key}"
          style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;background:none;cursor:pointer;text-align:left;border-radius:6px;font-size:13px;color:var(--text-1)">
          ${this._stageDonut(s.key, 16)}
          <span style="flex:1">${esc(s.label)}</span>
          ${s.key === current ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--oci-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}
        </button>`
      )
      .join('');
    document.body.appendChild(menu);
    const rect = triggerEl.getBoundingClientRect();
    let left = rect.left;
    if (left + 200 > window.innerWidth - 12) left = window.innerWidth - 212;
    menu.style.left = Math.max(12, left) + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.querySelectorAll('.lead-stage-opt').forEach(b => {
      b.addEventListener('mouseenter', () => (b.style.background = 'var(--surface-2)'));
      b.addEventListener('mouseleave', () => (b.style.background = 'none'));
      b.addEventListener('click', () => {
        const next = b.dataset.stage;
        this._closeStagePop();
        if (next && next !== current) this._changeStage(leadId, next);
      });
    });
    this._stagePopOutside = ev => {
      if (!menu.contains(ev.target) && ev.target !== triggerEl && !triggerEl.contains(ev.target)) this._closeStagePop();
    };
    setTimeout(() => document.addEventListener('click', this._stagePopOutside, true), 0);
  },
  async _changeStage(leadId, stage) {
    try {
      await API.patch(`/leads/${leadId}/stage`, { stage });
      Toast.success(`단계 변경: ${STAGES[stage]?.label || stage}`);
      if (window.App && typeof App._syncAfterLeadChange === 'function') App._syncAfterLeadChange();
      await this.loadData();
    } catch (_) {
      /* Toast 는 API 가 처리 */
    }
  },

  // ── v6.0.0: 카드뷰 렌더링 (5개 모듈 통일) ──────────────────
  _renderCardList(leads) {
    const wrap = document.getElementById('leads-table-wrap');
    if (!wrap) return;
    const stageBadge = stage =>
      `<span style="display:inline-flex;align-items:center;gap:6px">${this._stageDonut(stage, 16)}<span>${esc(this._stageLabel(stage))}</span></span>`;
    const fmtAmt = amt => {
      if (!amt) return '-';
      const n = Number(amt);
      if (n >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1).replace(/\.0$/, '') + '억';
      if (n >= 10000) return (n / 10000).toFixed(0) + '만';
      return n.toLocaleString('ko-KR');
    };
    const fmtDate = s => {
      if (!s) return '-';
      const d = new Date(s);
      if (isNaN(d)) return s;
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
    };
    wrap.innerHTML = `<div class="list-card-grid">
      ${leads
        .map(
          l => `<div class="list-card" data-lead-id="${l.id}">
        <div class="list-card-header">
          <span class="list-card-no">${esc(l.business_type || '-')}${l.region ? ' · ' + esc(l.region) : ''}</span>
          ${l.expected_amount ? `<span class="list-card-amount">${esc(fmtAmt(l.expected_amount))}</span>` : ''}
        </div>
        <div class="list-card-title">
          <a href="#" data-lead-id="${l.id}">${esc(l.project_name || '(프로젝트명 미입력)')}</a>
        </div>
        <div class="list-card-meta">
          <div class="list-card-meta-row" title="고객사">🏢 <strong>${esc(l.customer_name || '-')}</strong></div>
          ${l.capacity_mw ? `<div class="list-card-meta-row" title="예상 물량">📦 ${esc(l.capacity_mw)}</div>` : ''}
          ${l.expected_close_date ? `<div class="list-card-meta-row" title="예상 종료">📅 ${esc(fmtDate(l.expected_close_date))}</div>` : ''}
        </div>
        <div class="list-card-stage">${stageBadge(l.stage)}</div>
        <div class="list-card-footer">
          <span>${esc(l.assigned_name || '담당자 미정')}</span>
          <span>${esc(fmtDate(l.updated_at || l.created_at))}</span>
        </div>
      </div>`
        )
        .join('')}
    </div>`;
    // 카드 클릭 → 상세 모달
    wrap.querySelectorAll('.list-card[data-lead-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('a')) e.preventDefault();
        const id = parseInt(el.dataset.leadId, 10);
        if (id && typeof App !== 'undefined' && App.openLeadDetail) {
          App.openLeadDetail(id);
        }
      });
    });
  },

  // ── 체크박스 선택 관리 ───────────────────────────────────────
  _toggleAll(checked) {
    this._allLeads.forEach(l => {
      if (checked) this._selectedIds.add(l.id);
      else this._selectedIds.delete(l.id);
    });
    document.querySelectorAll('.cp-checkbox[data-id]').forEach(cb => (cb.checked = checked));
    document
      .querySelectorAll('tr[data-lead-id]')
      .forEach(tr => tr.classList.toggle('cp-selected', checked));
    this._updateSelectionUI();
  },

  _toggleRow(id, checked) {
    if (checked) this._selectedIds.add(id);
    else this._selectedIds.delete(id);
    const tr = document.querySelector(`tr[data-lead-id="${id}"]`);
    if (tr) tr.classList.toggle('cp-selected', checked);
    // 전체 선택 체크박스 상태 동기화
    const all = document.getElementById('cp-check-all');
    if (all) all.checked = this._selectedIds.size === this._allLeads.length;
    this._updateSelectionUI();
  },

  _clearSelection() {
    this._selectedIds.clear();
    document.querySelectorAll('.cp-checkbox').forEach(cb => (cb.checked = false));
    document.querySelectorAll('tr[data-lead-id]').forEach(tr => tr.classList.remove('cp-selected'));
    this._updateSelectionUI();
  },

  _updateSelectionUI() {
    const n = this._selectedIds.size;
    const toolbar = document.getElementById('cp-toolbar');
    const count = document.getElementById('cp-sel-count');
    if (toolbar) toolbar.style.display = n > 0 ? 'flex' : 'none';
    if (count) count.textContent = `${n}건 선택`;
  },

  // ── 복사(Copy) ───────────────────────────────────────────────
  // 선택된 행을 TSV 형식으로 클립보드에 복사 (Excel·Word·이메일에 바로 붙여넣기 가능)
  copySelected() {
    const selected = this._allLeads.filter(l => this._selectedIds.has(l.id));
    if (!selected.length) {
      Toast.info('복사할 항목을 선택하세요');
      return;
    }

    const STAGE_LABELS = {
      lead: '발굴/니즈파악',
      review: '샘플 평가',
      proposal: 'Spec-in/승인',
      bidding: '가격 협의',
      negotiation: '공급계약',
      won: '양산/정기수주',
      lost: '실주',
      dropped: '드롭',
    };
    const headers = [
      '고객사',
      '프로젝트명',
      '사업유형',
      '예상 물량',
      '예상 매출',
      '통화',
      '단계',
      '구분',
      '담당자',
      '예상마감일',
      '메모',
    ];
    const rows = selected.map(l =>
      [
        l.customer_name || '',
        l.project_name || '',
        l.business_type || '',
        l.capacity_mw !== null && l.capacity_mw !== undefined ? l.capacity_mw : '',
        l.expected_amount !== null && l.expected_amount !== undefined ? l.expected_amount : '',
        l.currency || 'KRW',
        STAGE_LABELS[l.stage] || l.stage || '',
        l.region || '',
        l.assigned_name || '',
        l.expected_close_date ? String(l.expected_close_date).slice(0, 10) : '',
        l.notes || '',
      ].map(v => String(v).replace(/\t/g, ' '))
    ); // 탭 문자 이스케이프

    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    navigator.clipboard
      .writeText(tsv)
      .then(() => {
        Toast.success(`${selected.length}건 복사 완료 — Excel·Word에 Ctrl+V로 붙여넣기 하세요`);
      })
      .catch(() => {
        // clipboard API 실패 시 textarea 방법으로 대체
        const ta = document.createElement('textarea');
        ta.value = tsv;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        Toast.success(`${selected.length}건 복사 완료`);
      });
  },

  // ── 붙여넣기(Paste) 모달 ────────────────────────────────────
  // ── 붙여넣기 등록 (공통 BulkPaste 컴포넌트 사용 — v6.0.0) ──────
  openPasteModal() {
    if (typeof BulkPaste === 'undefined') {
      Toast.error('BulkPaste 컴포넌트 로드 실패');
      return;
    }
    // stage 한글 → 영문 매핑
    const STAGE_REVERSE = {
      리드발굴: 'lead',
      '리드 발굴': 'lead',
      lead: 'lead',
      검토: 'review',
      '검토/미팅': 'review',
      review: 'review',
      제안: 'proposal',
      '제안/견적': 'proposal',
      proposal: 'proposal',
      입찰: 'bidding',
      bidding: 'bidding',
      협상: 'negotiation',
      '협상/계약': 'negotiation',
      negotiation: 'negotiation',
      수주: 'won',
      수주완료: 'won',
      won: 'won',
      실주: 'lost',
      lost: 'lost',
      드롭: 'dropped',
      dropped: 'dropped',
    };
    const VALID_STAGES = [
      'lead',
      'review',
      'proposal',
      'bidding',
      'negotiation',
      'won',
      'lost',
      'dropped',
    ];
    const team = this.team || [];

    BulkPaste.open({
      entityType: 'lead',
      title: '📥 영업딜 붙여넣기 등록',
      endpoint: '/leads/bulk',
      payloadKey: 'leads',
      columns: [
        { key: 'customer_name', label: '고객사', required: true, maxLength: 200 },
        { key: 'project_name', label: '프로젝트명', required: true, maxLength: 200 },
        { key: 'business_type', label: '사업유형', default: '식각가스', maxLength: 50 },
        {
          key: 'capacity_mw',
          label: '예상 물량',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseFloat(String(v).replace(/[,₩$¥]/g, ''));
            return isNaN(n) ? null : n;
          },
        },
        {
          key: 'expected_amount',
          label: '예상 매출',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseFloat(String(v).replace(/[,₩$¥]/g, ''));
            return isNaN(n) ? null : n;
          },
        },
        {
          key: 'currency',
          label: '통화',
          default: 'KRW',
          enum: ['KRW', 'USD', 'EUR', 'JPY', 'CNY'],
        },
        {
          key: 'stage',
          label: '단계',
          default: 'lead',
          transform: v => STAGE_REVERSE[String(v).toLowerCase().trim()] || v,
          enum: VALID_STAGES,
        },
        { key: 'region', label: '구분', default: '국내', enum: ['국내', '해외'] },
        // 담당자 이름 (별도 column key) — beforeSubmit 에서 id 로 매핑
        { key: 'assigned_name', label: '담당자', maxLength: 100 },
        { key: 'expected_close_date', label: '예상마감일', validate: 'date' },
        { key: 'notes', label: '메모', maxLength: 2000 },
      ],
      headerAliases: {
        고객사: 'customer_name',
        고객: 'customer_name',
        customer: 'customer_name',
        customer_name: 'customer_name',
        프로젝트명: 'project_name',
        프로젝트: 'project_name',
        project: 'project_name',
        project_name: 'project_name',
        사업유형: 'business_type',
        유형: 'business_type',
        type: 'business_type',
        business_type: 'business_type',
        '규모(mw)': 'capacity_mw',
        규모: 'capacity_mw',
        mw: 'capacity_mw',
        capacity: 'capacity_mw',
        용량: 'capacity_mw',
        capacity_mw: 'capacity_mw',
        '예상 매출': 'expected_amount',
        예상매출: 'expected_amount',
        예상금액: 'expected_amount',
        금액: 'expected_amount',
        amount: 'expected_amount',
        expected_amount: 'expected_amount',
        통화: 'currency',
        currency: 'currency',
        단계: 'stage',
        stage: 'stage',
        상태: 'stage',
        구분: 'region',
        지역: 'region',
        region: 'region',
        담당자: 'assigned_name',
        담당: 'assigned_name',
        assigned: 'assigned_name',
        assigned_name: 'assigned_name',
        마감일: 'expected_close_date',
        예상마감일: 'expected_close_date',
        예상마감: 'expected_close_date',
        마감: 'expected_close_date',
        close_date: 'expected_close_date',
        expected_close_date: 'expected_close_date',
        메모: 'notes',
        비고: 'notes',
        notes: 'notes',
      },
      duplicateField: 'project_name',
      // assigned_name → assigned_to(id) 매핑
      beforeSubmit: rows =>
        rows.map(r => {
          const member = team.find(t => t.name === r.assigned_name);
          // assigned_name 은 서버 스키마에 없으므로 제거, assigned_to 로 변환
          const { assigned_name: _, ...rest } = r;
          return { ...rest, assigned_to: member?.id || null };
        }),
      onSuccess: async () => {
        await this.loadData();
      },
    });
  },

  // ── (v6.0.0) 붙여넣기 파싱/등록은 BulkPaste 컴포넌트로 이관 ──────
  // 기존 _parsePasteInput / _importParsed 는 BulkPaste.open() 안에서 처리됨

  editLead(id) {
    App.openLeadForm(id);
  },

  // ── 엑셀 내보내기 ────────────────────────────────────────────
  exportExcel() {
    // 레거시 호환 — 기본 xlsx
    const path = this._buildExportPath();
    API.downloadExport(path, '영업딜_' + new Date().toISOString().slice(0, 10), 'xlsx');
  },

  _buildExportPath() {
    const f = this.filters;
    const qs = new URLSearchParams();
    if (f.stage) qs.set('stage', f.stage);
    if (f.region) qs.set('region', f.region);
    if (f.assigned_to) qs.set('assigned_to', f.assigned_to);
    if (f.business_type) qs.set('business_type', f.business_type);
    if (f.search) qs.set('search', f.search);
    return '/leads/export' + (qs.toString() ? '?' + qs.toString() : '');
  },

  _openExportMenu(triggerEl) {
    if (typeof ExportMenu === 'undefined') return this.exportExcel();
    ExportMenu.open(
      triggerEl,
      this._buildExportPath(),
      '영업딜_' + new Date().toISOString().slice(0, 10)
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
      const res = await fetch('/api/leads/import', { method: 'POST', headers, body: fd });
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
};
