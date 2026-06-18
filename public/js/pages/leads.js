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

        <select class="filter-select" id="leads-stage">
          <option value="" data-label="common.all">전체 단계</option>
          <option value="lead" data-label="stages.lead">리드 발굴</option>
          <option value="review" data-label="stages.review">검토/미팅</option>
          <option value="proposal" data-label="stages.proposal">제안/견적</option>
          <option value="bidding" data-label="stages.bidding">입찰</option>
          <option value="negotiation" data-label="stages.negotiation">협상/계약</option>
          <option value="won" data-label="stages.won">수주</option>
          <option value="lost" data-label="stages.lost">실주</option>
          <option value="dropped" data-label="stages.dropped">드롭</option>
        </select>

        <select class="filter-select" id="leads-business-type">
          <option value="" data-label="common.all">전체 사업유형</option>
          <option value="태양광" data-label="business.solar">태양광</option>
          <option value="풍력" data-label="business.wind">풍력</option>
          <option value="ESS" data-label="business.ess">ESS</option>
          <option value="수소" data-label="business.hydrogen">수소</option>
          <option value="기타" data-label="business.other">기타</option>
        </select>

        <select class="filter-select" id="leads-region">
          <option value="" data-label="region.all">국내/해외</option>
          <option value="국내" data-label="region.domestic">국내</option>
          <option value="해외" data-label="region.overseas">해외</option>
        </select>

        <select class="filter-select" id="leads-assigned">
          <option value="" data-label="common.all_assignees">전체 담당자</option>
        </select>

        <div class="filter-date-group">
          <select class="filter-select" id="leads-date-field" style="width:90px">
            <option value="close" data-label="leads.expected_close_date">마감일</option>
            <option value="updated" data-label="common.updated_at">수정일</option>
            <option value="created" data-label="common.created_at">등록일</option>
          </select>
          <input type="date" class="filter-date" id="leads-date-from" data-title-label="common.start_date" title="시작일">
          <span class="text-muted" style="font-size:11px">~</span>
          <input type="date" class="filter-date" id="leads-date-to" data-title-label="common.end_date" title="종료일">
          <button class="btn btn-ghost btn-sm" id="leads-date-clear" data-title-label="common.clear_date" title="날짜 초기화" style="display:none">✕</button>
        </div>

        <button class="btn btn-primary" id="leads-open-form-btn" data-label="leads.new_button">+ 리드 등록</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span data-label="leads.list_title">영업 리드 목록</span> <span class="text-muted fs-12" id="leads-count"></span></div>
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
    const sel = document.getElementById('leads-assigned');
    sel.innerHTML =
      '<option value="">전체 담당자</option>' +
      this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

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

    // 드롭다운 필터들
    const selectMap = {
      'leads-stage': 'stage',
      'leads-business-type': 'business_type',
      'leads-region': 'region',
      'leads-assigned': 'assigned_to',
      'leads-date-field': 'date_field',
    };
    Object.entries(selectMap).forEach(([id, key]) => {
      document.getElementById(id).addEventListener('change', e => {
        this.filters[key] = e.target.value;
        this.loadData();
      });
    });

    // 날짜 range
    document.getElementById('leads-date-from').addEventListener('change', e => {
      this.filters.date_from = e.target.value;
      document.getElementById('leads-date-clear').style.display =
        this.filters.date_from || this.filters.date_to ? '' : 'none';
      this.loadData();
    });
    document.getElementById('leads-date-to').addEventListener('change', e => {
      this.filters.date_to = e.target.value;
      document.getElementById('leads-date-clear').style.display =
        this.filters.date_from || this.filters.date_to ? '' : 'none';
      this.loadData();
    });
    document.getElementById('leads-date-clear').addEventListener('click', () => {
      this.filters.date_from = '';
      this.filters.date_to = '';
      document.getElementById('leads-date-from').value = '';
      document.getElementById('leads-date-to').value = '';
      document.getElementById('leads-date-clear').style.display = 'none';
      this.loadData();
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
          document.getElementById('leads-stage').value = '';
        },
      ]);
    if (this.filters.business_type)
      chips.push([
        '유형',
        this.filters.business_type,
        () => {
          this.filters.business_type = '';
          document.getElementById('leads-business-type').value = '';
        },
      ]);
    if (this.filters.region)
      chips.push([
        '구분',
        this.filters.region,
        () => {
          this.filters.region = '';
          document.getElementById('leads-region').value = '';
        },
      ]);
    if (this.filters.assigned_to) {
      const member = this.team.find(t => String(t.id) === String(this.filters.assigned_to));
      chips.push([
        '담당자',
        member?.name || this.filters.assigned_to,
        () => {
          this.filters.assigned_to = '';
          document.getElementById('leads-assigned').value = '';
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
          document.getElementById('leads-date-from').value = '';
          document.getElementById('leads-date-to').value = '';
          document.getElementById('leads-date-clear').style.display = 'none';
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
    document.getElementById('leads-count').textContent = `(총 ${leads.length}건)`;
    // v6.0.0: 카드뷰 분기 (목록 vs 카드)
    this._allLeads = leads;
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
          : '<div class="empty"><div class="empty-icon">📋</div>등록된 리드가 없습니다</div>';
      document.getElementById('leads-table-wrap').innerHTML = html;
      // primary 버튼 클릭 핸들러 (preset='leads' 일 때만)
      if (!hasFilter) {
        document
          .getElementById('empty-leads-new')
          ?.addEventListener('click', () => App.openLeadForm?.());
      }
      return;
    }

    // v6.0.0: 단계 진척률 (5개 모듈 통일 — StageProgress 컴포넌트)
    // 정상 흐름: lead → review → proposal → bidding → negotiation → won (6단계)
    // 종료: lost (실주), dropped (중단)
    const LEAD_STAGES = [
      { key: 'lead', label: '리드 발굴', color: '#6b7280' },
      { key: 'review', label: '검토/미팅', color: '#3b82f6' },
      { key: 'proposal', label: '제안/견적', color: '#8b5cf6' },
      { key: 'bidding', label: '입찰', color: '#0891b2' },
      { key: 'negotiation', label: '협상', color: '#f59e0b' },
      { key: 'won', label: '수주', color: '#16a34a' },
    ];
    const LEAD_TERMINAL_LOST = { key: 'lost', label: '실주', color: '#dc2626' };
    const LEAD_TERMINAL_DROPPED = { key: 'dropped', label: '중단', color: '#9ca3af' };

    const stageBadge = stage => {
      if (typeof StageProgress === 'undefined') {
        // fallback — 컴포넌트 없으면 기존 badge
        const map = {
          lead: 'gray',
          review: 'gray',
          proposal: 'blue',
          bidding: 'amber',
          negotiation: 'green',
          won: 'green',
          lost: 'gray',
          dropped: 'red',
        };
        return `<span class="badge badge-${map[stage]}">${STAGES[stage].label}</span>`;
      }
      let terminal = null;
      let cur = stage;
      if (stage === 'lost') {
        terminal = LEAD_TERMINAL_LOST;
        cur = 'lost';
      } else if (stage === 'dropped') {
        terminal = LEAD_TERMINAL_DROPPED;
        cur = 'dropped';
      }
      return StageProgress.render({
        stages: LEAD_STAGES,
        current: cur,
        size: 'sm',
        terminal,
      });
    };

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
            <th class="text-right" data-label="leads.capacity_mw">규모(MW)</th>
            <th class="text-right" data-label="leads.expected_amount">예상금액</th>
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
              <td>${stageBadge(l.stage)}</td>
              <td><span class="badge ${l.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(l.region)}</span></td>
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

  // ── v6.0.0: 카드뷰 렌더링 (5개 모듈 통일) ──────────────────
  _renderCardList(leads) {
    const wrap = document.getElementById('leads-table-wrap');
    if (!wrap) return;
    const stageBadge = stage => {
      if (typeof StageProgress === 'undefined') return esc(STAGES[stage]?.label || stage);
      const STAGES_ARR = [
        { key: 'lead', label: '리드 발굴', color: '#6b7280' },
        { key: 'review', label: '검토/미팅', color: '#3b82f6' },
        { key: 'proposal', label: '제안/견적', color: '#8b5cf6' },
        { key: 'bidding', label: '입찰', color: '#0891b2' },
        { key: 'negotiation', label: '협상', color: '#f59e0b' },
        { key: 'won', label: '수주', color: '#16a34a' },
      ];
      let terminal = null;
      let cur = stage;
      if (stage === 'lost') {
        terminal = { key: 'lost', label: '실주', color: '#dc2626' };
        cur = 'lost';
      } else if (stage === 'dropped') {
        terminal = { key: 'dropped', label: '중단', color: '#9ca3af' };
        cur = 'dropped';
      }
      return StageProgress.render({ stages: STAGES_ARR, current: cur, size: 'sm', terminal });
    };
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
          ${l.capacity_mw ? `<div class="list-card-meta-row" title="규모">⚡ ${esc(l.capacity_mw)} MW</div>` : ''}
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
      lead: '리드발굴',
      review: '검토/미팅',
      proposal: '제안/견적',
      bidding: '입찰',
      negotiation: '협상/계약',
      won: '수주완료',
      lost: '실주',
      dropped: '드롭',
    };
    const headers = [
      '고객사',
      '프로젝트명',
      '사업유형',
      '규모(MW)',
      '예상금액',
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
      title: '📥 영업리드 붙여넣기 등록',
      endpoint: '/leads/bulk',
      payloadKey: 'leads',
      columns: [
        { key: 'customer_name', label: '고객사', required: true, maxLength: 200 },
        { key: 'project_name', label: '프로젝트명', required: true, maxLength: 200 },
        { key: 'business_type', label: '사업유형', default: '태양광', maxLength: 50 },
        {
          key: 'capacity_mw',
          label: '규모(MW)',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseFloat(String(v).replace(/[,₩$¥]/g, ''));
            return isNaN(n) ? null : n;
          },
        },
        {
          key: 'expected_amount',
          label: '예상금액',
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
    API.downloadExport(path, '영업리드_' + new Date().toISOString().slice(0, 10), 'xlsx');
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
      '영업리드_' + new Date().toISOString().slice(0, 10)
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
