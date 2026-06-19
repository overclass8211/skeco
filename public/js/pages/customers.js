// ============================================================
// Customers Page — 고객사 등록 (직접입력 / 명함 OCR) + AI 인텔리전스
//                + Copy & Paste (그리드 복붙) 기능
// ============================================================
const CustomersPage = {
  data: [],
  selectedCustomer: null,
  _ocrFiles: [],
  _ocrResults: [],
  _activeRegTab: 'direct',
  _view: localStorage.getItem('customers_view') || 'list',

  // v6.0.0 Phase 2A: 라이브 카메라 연속 촬영 상태
  _liveCam: {
    stream: null, // MediaStream
    blobs: [], // 촬영된 Blob[]
    urls: [], // 썸네일 ObjectURL[]
    observer: null, // 모달 close 감시 MutationObserver
    busy: false, // 셔터 연타 방지
    MAX: 20, // 최대 촬영 장수
  },

  // Copy & Paste 상태 (v6.0.0 — 공통 BulkPaste 컴포넌트로 이관, _parsedCustomers deprecated)
  _selectedIds: new Set(),
  _allData: [],
  _pasteHandler: null,

  async render() {
    document.getElementById('content').innerHTML = `
      <!-- v6.0.0: KPI 바 (5개 모듈 통일) -->
      <div id="cust-kpi-bar"></div>
      <div class="filter-bar">
        <input class="search-input" id="cust-search" data-placeholder-label="customers.search_placeholder" placeholder="고객사명, 담당자 검색...">
        <select class="filter-select" id="cust-region">
          <option value="" data-label="common.all">전체 지역</option>
          <option value="국내" data-label="region.domestic">국내</option>
          <option value="해외" data-label="region.overseas">해외</option>
        </select>
        <select class="filter-select" id="cust-industry">
          <option value="" data-label="common.all">전체 산업군</option>
        </select>

        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost btn-sm" id="cp-paste-btn-cust"
                  data-feature="data.bulk_paste"
                  title="Excel·Word에서 복사한 표를 붙여넣기로 일괄 등록 (Ctrl+V)" data-label="common.paste_register">
            붙여넣기 등록
          </button>
          <button class="btn btn-ghost btn-sm" id="cust-cols-btn" type="button"
            title="표에 표시할 컬럼 선택">
            표시 컬럼
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;vertical-align:-1px"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" id="cust-excel-btn" type="button"
            title="엑셀 다운로드 / 가져오기">
            엑셀
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;vertical-align:-1px"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <input type="file" id="cust-excel-import-input" accept=".xlsx,.xls" style="display:none">
          ${ViewToggle.render({ currentView: this._view })}
          <button class="btn btn-primary" id="cust-register-btn" data-label="customers.new_button">
            + 고객사 등록
          </button>
        </div>
      </div>

      <div id="customers-view-container" style="margin-bottom:12px">
        <div class="loading" style="padding:40px;text-align:center" data-label="common.loading">로딩...</div>
      </div>

      <!-- 고객사 인텔리전스 패널 -->
      <div id="cust-intel-panel" style="display:none">
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <span id="intel-company-name"></span> — AI 고객사 인텔리전스
            </div>
            <div style="display:flex;gap:6px">
              <button class="ai-gen-btn" id="intel-refresh-btn">재생성</button>
              <button class="btn btn-ghost btn-sm" id="intel-close-btn">✕</button>
            </div>
          </div>
          <div id="intel-content" class="card-body" style="min-height:120px;font-size:13px;line-height:1.7">
            <span class="ai-cursor">▋</span>
          </div>
        </div>
      </div>
    `;
    // v6.0.0: KPI 대시보드 로드 (best-effort, 실패해도 페이지 동작)
    this._loadKpiBar();

    // bind render() buttons
    document
      .getElementById('cp-paste-btn-cust')
      ?.addEventListener('click', () => this.openPasteModal());
    document
      .getElementById('cust-excel-btn')
      ?.addEventListener('click', e => this._openExcelMenu(e.currentTarget));
    document
      .getElementById('cust-cols-btn')
      ?.addEventListener('click', e => this._openColumnsMenu(e.currentTarget));
    document
      .getElementById('cust-register-btn')
      ?.addEventListener('click', () => this.openRegisterModal('direct'));
    document
      .getElementById('cust-excel-import-input')
      ?.addEventListener('change', e => this.importExcel(e.target));
    document.querySelector('#cust-intel-panel')?.addEventListener('click', e => {
      if (e.target.id === 'intel-close-btn') this.closeIntel();
    });
    // view toggle delegation
    document.querySelector('.view-toggle')?.addEventListener('click', e => {
      const btn = e.target.closest('.view-toggle-btn');
      if (btn) this.switchView(btn.dataset.view);
    });
    // filter inputs
    document.getElementById('cust-search')?.addEventListener('input', () => this.applyFilter());
    document.getElementById('cust-region')?.addEventListener('change', () => this.applyFilter());
    document.getElementById('cust-industry')?.addEventListener('change', () => this.applyFilter());

    this._bindPasteShortcut();
    await this.loadData();
  },

  async loadData() {
    // 분할 상세 화면이 #content 를 점유 중이면(목록 컨테이너 없음) 목록 페이지를 먼저 복원
    if (!document.getElementById('customers-view-container')) {
      return this.render();
    }
    try {
      // 전체 로드 — 목록/검색/필터/그룹/KPI 가 모두 클라이언트(this.data) 기준이라
      // 기본 50건(page1)만 받으면 이름 정렬상 뒤쪽 고객사가 검색에도 안 잡힘(고객사 "사라짐" 착시).
      // LIMIT_MAX(9999) 내 전량 로드로 해소. (수천 단위 초과 시 서버사이드 검색 전환 검토)
      const res = await API.customers.list({ limit: 9999 });
      this.data = res.data;
      this._allData = res.data;

      // 산업군 드롭다운 동적 생성
      const industryEl = document.getElementById('cust-industry');
      if (industryEl) {
        const industries = [...new Set(this.data.map(c => c.industry).filter(Boolean))].sort();
        industryEl.innerHTML =
          '<option value="">전체 산업군</option>' +
          industries.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
      }

      this.applyFilter();
    } catch (err) {
      console.error(err);
    }
  },

  applyFilter() {
    const search = (document.getElementById('cust-search')?.value || '').toLowerCase();
    const region = document.getElementById('cust-region')?.value || '';
    const industry = document.getElementById('cust-industry')?.value || '';
    const filtered = this.data.filter(
      c =>
        (!search ||
          c.name.toLowerCase().includes(search) ||
          (c.contact_person || '').toLowerCase().includes(search)) &&
        (!region || c.region === region) &&
        (!industry || c.industry === industry)
    );
    this._selectedIds.clear();
    this.renderView(filtered);
  },

  switchView(view) {
    if (view === this._view) return;
    this._view = view;
    localStorage.setItem('customers_view', view);
    document.querySelectorAll('.view-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    this._selectedIds.clear();
    this.applyFilter();
  },

  renderView(data) {
    if (this._view === 'card') this.renderCards(data);
    else this.renderTable(data);
  },

  // 동일 회사명으로 그룹화 — 대표 1행만 보이고 소속 사람들을 chip으로 표시
  _groupByName(data) {
    const map = new Map();
    data.forEach(c => {
      if (!map.has(c.name)) map.set(c.name, []);
      map.get(c.name).push(c);
    });
    return data.map(c => {
      const group = map.get(c.name);
      // 같은 name 그룹의 첫 번째 행만 노출, 나머지는 hidden 처리
      const isPrimary = group[0].id === c.id;
      return { ...c, _group: group, _isPrimary: isPrimary, _groupCount: group.length };
    });
  },

  renderTable(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      const hasFilter =
        document.getElementById('cust-search')?.value ||
        document.getElementById('cust-region')?.value ||
        document.getElementById('cust-industry')?.value;
      const presetKey = hasFilter ? 'filter' : 'customers';
      const html =
        typeof EmptyState !== 'undefined'
          ? `<div class="card"><div class="card-body">${EmptyState.preset(presetKey)}</div></div>`
          : '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      container.innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-customers-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    const grouped = this._groupByName(data);
    const visible = grouped.filter(c => c._isPrimary); // 같은 name은 대표 1행만
    container.innerHTML = `
      <div class="card">
        <div class="card-header" style="min-height:42px">
          <div id="cp-toolbar-cust" style="display:none" class="cp-toolbar">
            <span class="cp-sel-count" id="cp-sel-count-cust">0개 선택</span>
            <button class="btn btn-sm" data-action="copy-selected">복사</button>
            <button class="btn btn-sm" data-action="clear-selection">선택 해제</button>
          </div>
          <div id="cp-toolbar-cust-empty" style="font-size:13px;color:var(--text-2)">
            고객사 목록
          </div>
        </div>
        <div class="card-body no-pad">
          <table class="data-table">
            <thead>
              <tr>
                <th class="cp-check-col">
                  <input type="checkbox" class="cp-checkbox" id="cp-check-all-cust">
                </th>
                <th data-label="customers.customer_name">고객사명</th><th data-col="region" data-label="customers.region">지역</th><th data-col="country">국가</th><th data-col="industry" data-label="customers.industry">산업</th>
                <th data-col="contact" data-label="customers.contact_person">담당자</th><th data-col="phone" data-label="customers.contact_phone">연락처</th><th data-col="email" data-label="customers.contact_email">이메일</th><th data-label="common.actions">액션</th>
              </tr>
            </thead>
            <tbody>
              ${visible
                .map(
                  c => `
                <tr class="clickable${this._selectedIds.has(c.id) ? ' cp-selected' : ''}"
                    data-cust-id="${c.id}"
                    data-cust-name="${esc(c.name).replace(/"/g, '&quot;')}">
                  <td class="cp-check-col" data-stop-propagation="1">
                    <input type="checkbox" class="cp-checkbox cp-row-check"
                           data-id="${c.id}"
                           ${this._selectedIds.has(c.id) ? 'checked' : ''}>
                  </td>
                  <td>
                    <strong>${esc(c.name)}</strong>
                    ${
                      c._groupCount > 1
                        ? `<span class="badge badge-purple" style="font-size:10px;margin-left:6px"
                           title="동일 회사명 ${c._groupCount}명 등록">${c._groupCount}명</span>`
                        : ''
                    }
                  </td>
                  <td data-col="region"><span class="badge ${c.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(c.region)}</span></td>
                  <td data-col="country">${esc(c.country || '-')}</td>
                  <td data-col="industry">${esc(c.industry || '-')}</td>
                  <td data-col="contact">
                    ${
                      c._groupCount > 1
                        ? `
                      <div data-stop-propagation="1" style="display:flex;flex-wrap:wrap;gap:4px">
                        ${c._group
                          .map(
                            m => `
                          <span class="cust-member-chip" data-cust-id="${m.id}"
                                title="${esc(m.email || '')} ${esc(m.phone || '')}"
                                style="cursor:pointer;font-size:11px;background:var(--surface-2);
                                       padding:2px 8px;border-radius:10px;border:1px solid var(--border)">
                            ${esc(m.contact_person || '담당자 미정')}
                          </span>
                        `
                          )
                          .join('')}
                      </div>
                    `
                        : esc(c.contact_person || '-')
                    }
                  </td>
                  <td class="mono" data-col="phone">${esc(c.phone || '-')}</td>
                  <td class="mono" data-col="email" style="font-size:11px">${esc(c.email || '-')}</td>
                  <td data-stop-propagation="1" style="white-space:nowrap">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <button class="ai-gen-btn"
                        data-action="ai-brief" data-feature="ai.intelligence"
                        data-id="${c.id}" data-name="${esc(c.name).replace(/"/g, '&quot;')}">
                        AI 브리핑
                      </button>
                      ${this._briefBadgeHtml(c.id)}
                    </div>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    this._updateSelectionUI();
    this._applyColVisibility();

    // event delegation for table
    container.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');
      if (stopEl) {
        e.stopPropagation();
      }

      // toolbar buttons
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'copy-selected') {
          this.copySelected();
          return;
        }
        if (action === 'clear-selection') {
          this._clearSelection();
          return;
        }
        if (action === 'ai-brief') {
          // 통합 모달 열고 핵심 브리핑 탭 자동 활성 + 자동 생성
          const id = parseInt(actionBtn.dataset.id);
          this.showCustomerDetail(id);
          setTimeout(() => {
            const briefTab = document.querySelector('.cust-rtab[data-rtab="brief"]');
            if (briefTab) briefTab.click();
            const genBtn = document.getElementById('cm-brief-gen');
            if (genBtn) genBtn.click();
          }, 80);
          return;
        }
      }

      // 멤버 chip 클릭 → 해당 고객 모달
      const chip = e.target.closest('.cust-member-chip');
      if (chip) {
        e.stopPropagation();
        this.showCustomerDetail(parseInt(chip.dataset.custId));
        return;
      }

      // checkbox row toggle
      const cb = e.target.closest('.cp-row-check');
      if (cb) {
        this._toggleRow(parseInt(cb.dataset.id), cb.checked);
        return;
      }

      // header checkbox toggle-all
      const hdrCb = e.target.closest('#cp-check-all-cust');
      if (hdrCb) {
        this._toggleAll(hdrCb.checked);
        return;
      }

      // row click → 통합 모달 (정보·수정 + 딜 + 브리핑 + 그룹)
      if (!stopEl) {
        const tr = e.target.closest('tr[data-cust-id]');
        if (tr) this.showCustomerDetail(parseInt(tr.dataset.custId));
      }
    });
  },

  renderCards(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      const hasFilter =
        document.getElementById('cust-search')?.value ||
        document.getElementById('cust-region')?.value ||
        document.getElementById('cust-industry')?.value;
      const presetKey = hasFilter ? 'filter' : 'customers';
      const html =
        typeof EmptyState !== 'undefined'
          ? `<div class="card"><div class="card-body">${EmptyState.preset(presetKey)}</div></div>`
          : '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      container.innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-customers-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    // 회사명 첫글자로 아바타 색상 분산
    const palette = [
      '#1664E5',
      '#E63329',
      '#00A86B',
      '#F59C00',
      '#7C4DFF',
      '#0F7A3F',
      '#B5261E',
      '#1A73E8',
    ];
    const avatarColor = name => palette[(name?.charCodeAt(0) || 0) % palette.length];

    container.innerHTML = `
      <div class="cust-card-grid">
        ${data
          .map(
            c => `
          <div class="cust-card" data-cust-id="${c.id}" data-cust-name="${esc(c.name).replace(/"/g, '&quot;')}">
            <div class="cust-card-header">
              <div class="cust-avatar" style="background:${avatarColor(c.name)}">
                ${esc((c.name || '?').charAt(0))}
              </div>
              <div class="cust-card-title">
                <div class="cust-card-name">${esc(c.name)}</div>
                <div class="cust-card-sub">${esc(c.industry || '미분류')}</div>
              </div>
              <span class="badge ${c.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(c.region)}</span>
            </div>
            <div class="cust-card-body">
              <div class="cust-card-row">
                <span class="cust-card-icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.5 8a5.5 5.5 0 0111 0 .5.5 0 01-.5.5H5a.5.5 0 01-.5-.5zM10 13a3 3 0 01-3-3h6a3 3 0 01-3 3z" clip-rule="evenodd"/></svg></span>
                <span>${esc(c.country || '-')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg></span>
                <span>${esc(c.contact_person || '담당자 미등록')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg></span>
                <span class="mono">${esc(c.phone || '-')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg></span>
                <span class="mono" style="font-size:11px">${esc(c.email || '-')}</span>
              </div>
            </div>
            <div class="cust-card-footer" data-stop-propagation="1">
              ${(() => {
                const info = this._getBriefedInfo(c.id);
                return info
                  ? `<div class="brief-done-chip" data-brief-card-id="${c.id}">${info.label}</div>`
                  : `<div data-brief-card-id="${c.id}" style="display:none"></div>`;
              })()}
              <!-- v6.0.0: 모듈별 카운트 통계 바 (옵션 C) — 클릭 시 모달 해당 탭 -->
              <!-- "관련딜"은 모달 [🤝 관련 딜] 탭과 동일한 customer_name 매칭 기준 -->
              <div class="cust-card-stats" data-stop-propagation="1">
                ${this._renderStatChip(c.id, 'deals',     '관련딜', c.related_deals_cnt)}
                ${this._renderStatChip(c.id, 'quotes',    '견적',   c.quotes_cnt)}
                ${this._renderStatChip(c.id, 'proposals', '제안',   c.proposals_cnt)}
                ${this._renderStatChip(c.id, 'contracts', '계약',   c.contracts_cnt)}
              </div>
              <button class="ai-gen-btn" style="width:100%;justify-content:center"
                data-action="ai-brief" data-id="${c.id}" data-name="${esc(c.name).replace(/"/g, '&quot;')}">
                AI 브리핑 생성
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    // event delegation for cards
    container.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'ai-brief') {
          // 통합 모달 열고 핵심 브리핑 탭 자동 활성 + 자동 생성
          const id = parseInt(actionBtn.dataset.id);
          this.showCustomerDetail(id);
          setTimeout(() => {
            const briefTab = document.querySelector('.cust-rtab[data-rtab="brief"]');
            if (briefTab) briefTab.click();
            const genBtn = document.getElementById('cm-brief-gen');
            if (genBtn) genBtn.click();
          }, 80);
          return;
        }
        // v6.0.0: 통계 칩 클릭 → 모달 + 해당 탭 자동 활성
        if (action === 'open-tab') {
          const id = parseInt(actionBtn.dataset.id);
          const mtab = actionBtn.dataset.mtab;
          this.showCustomerDetail(id);
          setTimeout(() => {
            // 분할뷰: 관련 딜 메인탭 → 해당 서브탭 활성
            document.querySelector('.cust-rtab[data-rtab="deals"]')?.click();
            const sub = mtab === 'deals' ? 'dealslist' : mtab;
            document.querySelector(`.cust-subtab[data-sub="${sub}"]`)?.click();
          }, 80);
          return;
        }
      }

      if (!stopEl) {
        const card = e.target.closest('.cust-card[data-cust-id]');
        if (card) this.showCustomerDetail(parseInt(card.dataset.custId));
      }
    });
  },

  // ── v6.0.0: 상단 KPI 바 (5개 모듈 통일) ──────────────────
  async _loadKpiBar() {
    if (typeof KpiBar === 'undefined') return;
    KpiBar.renderLoading('#cust-kpi-bar', 4);
    try {
      const res = await API.customers.dashboard();
      const d = res?.data || {};
      KpiBar.render({
        containerSel: '#cust-kpi-bar',
        cards: [
          { icon: '🏢', label: '전체 고객사', value: d.total, color: '#6b7280', sub: '등록된 모든 고객사' },
          { icon: '✅', label: '활성', value: d.active_30d, color: '#16a34a', sub: '최근 30일 활동' },
          { icon: '🆕', label: '신규', value: d.new_30d, color: '#3b82f6', sub: '30일 내 등록' },
          { icon: '💤', label: '휴면', value: d.dormant_90d, color: '#f59e0b', sub: '90일+ 활동 없음' },
        ],
      });
    } catch (e) {
      console.warn('[customers] KPI 로드 실패:', e.message);
      document.getElementById('cust-kpi-bar').innerHTML = '';
    }
  },

  // ── v6.0.0: 카드 푸터 통계 칩 (옵션 C) ───────────────────
  // 4개 모듈(딜/견적/제안/계약) 카운트를 한 줄에 표시 + 클릭 시 모달 해당 탭
  // 0건은 회색, N건은 컬러로 강조
  _renderStatChip(custId, mtab, label, count) {
    const n = Number(count) || 0;
    const display = n > 99 ? '99+' : String(n);
    const cls = n > 0 ? 'cust-stat-chip active' : 'cust-stat-chip zero';
    return `<button type="button" class="${cls}"
              data-action="open-tab" data-id="${custId}" data-mtab="${mtab}"
              title="${esc(label)} ${n}건 — 클릭하면 ${esc(label)} 탭으로 이동">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-count">${display}</span>
    </button>`;
  },

  // ── AI 브리핑 완료 상태 관리 ─────────────────────────────
  _markBriefed(id) {
    localStorage.setItem(`oci_brief_${id}`, new Date().toISOString());
    this._refreshBriefBadge(id);
  },

  _getBriefedInfo(id) {
    const ts = localStorage.getItem(`oci_brief_${id}`);
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return { label: '방금 완료', cls: 'brief-badge-fresh' };
    if (diffMins < 60) return { label: `${diffMins}분 전`, cls: 'brief-badge-fresh' };
    if (diffDays === 0) return { label: '오늘 완료', cls: 'brief-badge-today' };
    if (diffDays === 1) return { label: '어제', cls: 'brief-badge-old' };
    if (diffDays < 7) return { label: `${diffDays}일 전`, cls: 'brief-badge-old' };
    return {
      label: d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
      cls: 'brief-badge-old',
    };
  },

  _briefBadgeHtml(id) {
    const info = this._getBriefedInfo(id);
    return info
      ? `<span class="brief-done-badge ${info.cls}" data-brief-id="${id}">${info.label}</span>`
      : `<span class="brief-done-badge" data-brief-id="${id}" style="display:none"></span>`;
  },

  _refreshBriefBadge(id) {
    const info = this._getBriefedInfo(id);
    // 테이블 배지
    document.querySelectorAll(`[data-brief-id="${id}"]`).forEach(el => {
      if (info) {
        el.className = `brief-done-badge ${info.cls}`;
        el.textContent = `${info.label}`;
        el.style.display = '';
      }
    });
    // 카드 배지
    document.querySelectorAll(`[data-brief-card-id="${id}"]`).forEach(el => {
      if (info) {
        el.className = 'brief-done-chip';
        el.textContent = `${info.label}`;
        el.style.display = '';
      }
    });
  },

  // ── Copy & Paste 핵심 메서드 ──────────────────────────────

  _bindPasteShortcut() {
    if (this._pasteHandler) document.removeEventListener('keydown', this._pasteHandler);
    this._pasteHandler = e => {
      if (e.ctrlKey && e.key === 'v') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        this.openPasteModal();
      }
    };
    document.addEventListener('keydown', this._pasteHandler);
  },

  _toggleAll(checked) {
    document.querySelectorAll('.cp-row-check').forEach(cb => {
      const id = parseInt(cb.dataset.id);
      cb.checked = checked;
      const row = cb.closest('tr');
      if (checked) {
        this._selectedIds.add(id);
        row?.classList.add('cp-selected');
      } else {
        this._selectedIds.delete(id);
        row?.classList.remove('cp-selected');
      }
    });
    this._updateSelectionUI();
  },

  _toggleRow(id, checked) {
    if (checked) this._selectedIds.add(id);
    else this._selectedIds.delete(id);
    const row = document.querySelector(`tr[data-cust-id="${id}"]`);
    row?.classList.toggle('cp-selected', checked);

    // 전체선택 체크박스 동기화
    const allCbs = document.querySelectorAll('.cp-row-check');
    const allChecked = allCbs.length > 0 && [...allCbs].every(cb => cb.checked);
    const headerCb = document.getElementById('cp-check-all-cust');
    if (headerCb) headerCb.checked = allChecked;

    this._updateSelectionUI();
  },

  _clearSelection() {
    this._selectedIds.clear();
    document.querySelectorAll('.cp-row-check').forEach(cb => {
      cb.checked = false;
    });
    document.querySelectorAll('tr.cp-selected').forEach(r => r.classList.remove('cp-selected'));
    const hdr = document.getElementById('cp-check-all-cust');
    if (hdr) hdr.checked = false;
    this._updateSelectionUI();
  },

  _updateSelectionUI() {
    const cnt = this._selectedIds.size;
    const toolbar = document.getElementById('cp-toolbar-cust');
    const empty = document.getElementById('cp-toolbar-cust-empty');
    const countEl = document.getElementById('cp-sel-count-cust');
    if (toolbar) toolbar.style.display = cnt ? 'flex' : 'none';
    if (empty) empty.style.display = cnt ? 'none' : '';
    if (countEl) countEl.textContent = `${cnt}개 선택`;
  },

  copySelected() {
    if (!this._selectedIds.size) {
      Toast.warn('선택된 행이 없습니다');
      return;
    }
    const HEADERS = ['고객사명', '지역', '국가', '산업군', '담당자', '연락처', '이메일', '주소'];
    const rows = this._allData.filter(c => this._selectedIds.has(c.id));
    const lines = [HEADERS.join('\t')];
    rows.forEach(c => {
      lines.push(
        [
          c.name || '',
          c.region || '',
          c.country || '',
          c.industry || '',
          c.contact_person || '',
          c.phone || '',
          c.email || '',
          c.address || '',
        ].join('\t')
      );
    });
    const tsv = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(tsv)
        .then(() => Toast.success(`${rows.length}개 행이 클립보드에 복사되었습니다`))
        .catch(() => this._copyFallback(tsv));
    } else {
      this._copyFallback(tsv);
    }
  },

  _copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.success('클립보드에 복사되었습니다');
  },

  // ── 붙여넣기 등록 (공통 BulkPaste 컴포넌트 사용 — v6.0.0) ──────
  // 6대 제약: 중복 검증 / 필수값 검증 / 실패행 사유 / 부분성공 / 보안방어 / 행 수 제약
  openPasteModal() {
    if (typeof BulkPaste === 'undefined') {
      Toast.error('BulkPaste 컴포넌트 로드 실패');
      return;
    }
    BulkPaste.open({
      entityType: 'customer',
      title: '고객사 붙여넣기 등록',
      endpoint: '/customers/bulk',
      payloadKey: 'customers',
      columns: [
        { key: 'name', label: '고객사명', required: true, maxLength: 200 },
        {
          key: 'business_no',
          label: '사업자번호',
          maxLength: 13,
          // 입력값을 표시 포맷으로 변환 (서버에서 재검증)
          transform: v => {
            if (!v) return null;
            const n = String(v).replace(/[^0-9]/g, '');
            if (n.length !== 10) return v; // 검증은 서버에 위임
            return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
          },
        },
        { key: 'region', label: '지역', enum: ['국내', '해외'], default: '국내' },
        { key: 'country', label: '국가', maxLength: 50 },
        { key: 'industry', label: '산업군', maxLength: 100 },
        { key: 'contact_person', label: '담당자', maxLength: 100 },
        { key: 'phone', label: '연락처', validate: 'phone', maxLength: 30 },
        { key: 'email', label: '이메일', validate: 'email', maxLength: 200 },
        { key: 'address', label: '주소', maxLength: 500 },
      ],
      headerAliases: {
        고객사명: 'name',
        고객사: 'name',
        회사명: 'name',
        company: 'name',
        name: 'name',
        // v6.0.0: 사업자등록번호
        사업자번호: 'business_no',
        사업자등록번호: 'business_no',
        business_no: 'business_no',
        brn: 'business_no',
        지역: 'region',
        region: 'region',
        국가: 'country',
        country: 'country',
        산업군: 'industry',
        산업: 'industry',
        industry: 'industry',
        담당자: 'contact_person',
        담당자명: 'contact_person',
        contact_person: 'contact_person',
        연락처: 'phone',
        전화번호: 'phone',
        전화: 'phone',
        phone: 'phone',
        이메일: 'email',
        email: 'email',
        주소: 'address',
        address: 'address',
      },
      duplicateField: 'business_no',
      onSuccess: async () => {
        await this.loadData();
        if (window.App?.refreshCommon) await App.refreshCommon();
      },
    });
  },

  // ── 엑셀 내보내기 ────────────────────────────────────────────
  exportExcel() {
    const path = this._buildExportPath();
    API.downloadExport(path, '고객사_' + new Date().toISOString().slice(0, 10), 'xlsx');
  },

  _buildExportPath() {
    const search = document.getElementById('cust-search')?.value || '';
    const region = document.getElementById('cust-region')?.value || '';
    const industry = document.getElementById('cust-industry')?.value || '';
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (region) qs.set('region', region);
    if (industry) qs.set('industry', industry);
    return '/customers/export' + (qs.toString() ? '?' + qs.toString() : '');
  },

  // ── 표시 컬럼 설정 ───────────────────────────────────────────
  // 테이블 뷰 컬럼 토글. 고객사명/액션은 항상 표시(고정).
  COLS: [
    { key: 'region', label: '지역' },
    { key: 'country', label: '국가' },
    { key: 'industry', label: '산업' },
    { key: 'contact', label: '담당자' },
    { key: 'phone', label: '연락처' },
    { key: 'email', label: '이메일' },
  ],
  _hiddenCols() {
    try {
      return new Set(JSON.parse(localStorage.getItem('cust_cols_hidden') || '[]'));
    } catch (_) {
      return new Set();
    }
  },
  _applyColVisibility() {
    const hidden = this._hiddenCols();
    this.COLS.forEach(col => {
      const show = !hidden.has(col.key);
      document
        .querySelectorAll(`#customers-view-container [data-col="${col.key}"]`)
        .forEach(el => {
          el.style.display = show ? '' : 'none';
        });
    });
  },

  // ── 공통 팝오버 메뉴 (엑셀/컬럼 공용) ─────────────────────────
  _closePopMenu() {
    document.querySelectorAll('.cust-pop-menu').forEach(el => el.remove());
    if (this._popMenuOutside) {
      document.removeEventListener('click', this._popMenuOutside, true);
      this._popMenuOutside = null;
    }
  },
  _openPopMenu(triggerEl, innerHtml, onItemClick) {
    this._closePopMenu();
    const menu = document.createElement('div');
    menu.className = 'cust-pop-menu';
    menu.innerHTML = innerHtml;
    document.body.appendChild(menu);
    const rect = triggerEl.getBoundingClientRect();
    const w = menu.offsetWidth || 200;
    let left = rect.right - w;
    if (left < 12) left = 12;
    menu.style.left = left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    requestAnimationFrame(() => menu.classList.add('is-open'));
    if (typeof onItemClick === 'function') {
      menu.addEventListener('click', e => onItemClick(e, menu));
    }
    // 바깥 클릭 닫기 (트리거 클릭 버블 무시 위해 다음 tick 등록)
    this._popMenuOutside = e => {
      if (!menu.contains(e.target) && e.target !== triggerEl && !triggerEl.contains(e.target)) {
        this._closePopMenu();
      }
    };
    setTimeout(() => document.addEventListener('click', this._popMenuOutside, true), 0);
    return menu;
  },

  _openExcelMenu(triggerEl) {
    const path = this._buildExportPath();
    const name = '고객사_' + new Date().toISOString().slice(0, 10);
    this._openPopMenu(
      triggerEl,
      `
      <button class="cust-pop-item" data-act="xlsx" data-feature="data.excel_exp">엑셀 다운로드 (.xlsx)</button>
      <button class="cust-pop-item" data-act="csv" data-feature="data.excel_exp">CSV 다운로드</button>
      <div class="cust-pop-sep"></div>
      <button class="cust-pop-item" data-act="import" data-feature="data.excel_imp">엑셀 가져오기…</button>
    `,
      e => {
        const item = e.target.closest('.cust-pop-item');
        if (!item) return;
        const act = item.dataset.act;
        this._closePopMenu();
        if (act === 'xlsx') API.downloadExport(path, name, 'xlsx');
        else if (act === 'csv') API.downloadExport(path, name, 'csv');
        else if (act === 'import') document.getElementById('cust-excel-import-input')?.click();
      }
    );
  },

  _openColumnsMenu(triggerEl) {
    const hidden = this._hiddenCols();
    const rows = this.COLS.map(
      c => `
      <label class="cust-pop-check">
        <input type="checkbox" data-col-key="${c.key}" ${hidden.has(c.key) ? '' : 'checked'}>
        <span>${c.label}</span>
      </label>`
    ).join('');
    this._openPopMenu(
      triggerEl,
      `<div class="cust-pop-title">표시할 컬럼</div>${rows}`,
      e => {
        const cb = e.target.closest('input[data-col-key]');
        if (!cb) return;
        const key = cb.getAttribute('data-col-key');
        const h = this._hiddenCols();
        if (cb.checked) h.delete(key);
        else h.add(key);
        localStorage.setItem('cust_cols_hidden', JSON.stringify([...h]));
        this._applyColVisibility();
      }
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
      const res = await fetch('/api/customers/import', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (data.success) {
        const parts = [];
        if (data.inserted) parts.push(`${data.inserted}개 등록 완료`);
        if (data.duplicates) parts.push(`${data.duplicates}개 중복 건너뜀`);
        const failed = (data.errors || []).filter(e => !e.reason?.startsWith('중복')).length;
        if (failed) parts.push(`${failed}개 오류`);
        if (data.inserted) Toast.success(parts.join(' · '));
        else Toast.warn(parts.join(' · ') || '등록된 항목이 없습니다');
        await this.loadData();
        await App.refreshCommon();
      } else {
        Toast.error(data.message || '가져오기 실패');
      }
    } catch (e) {
      Toast.error('서버 오류: ' + (e.message || ''));
    }
  },

  // ── [통합] 고객 상세 모달 — 정보/수정 + 관련 딜 + 핵심 브리핑 + 그룹 ──
  // ── 고객사 상세 (분할 화면: 좌 정보 | 드래그 divider | 우 3탭) ──
  //   콘텐츠 영역 전체를 점유. 뒤로가기 시 목록 복원(loadData 가드).
  //   기존 로더/헬퍼/ID 재사용 (Customer360View, Linked*, _saveCustomerEdit 등).
  showCustomerDetail(id) {
    const cust = this._allData.find(c => c.id === id) || this.data.find(c => c.id === id);
    if (!cust) {
      Toast.error('고객 정보를 찾을 수 없습니다');
      return;
    }
    const leftPct = Math.min(72, Math.max(28, parseFloat(localStorage.getItem('cust_split_pct')) || 48));
    const ph = '<div class="loading" style="padding:28px;text-align:center;color:var(--text-3);font-size:12px">불러오는 중...</div>';

    document.getElementById('content').innerHTML = `
      <style>
        .cust-detail-head{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:12px}
        .cust-detail-title{font-size:17px;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cust-detail-actions{display:flex;gap:8px}
        .cust-split{display:flex;align-items:stretch;height:calc(100vh - var(--topbar-h) - 96px);min-height:460px}
        .cust-split-left{flex:0 0 ${leftPct}%;overflow-y:auto;padding:2px 16px 16px 0}
        .cust-split-gutter{flex:0 0 11px;cursor:col-resize;position:relative}
        .cust-split-gutter::before{content:'';position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--border);transition:background .12s}
        .cust-split-gutter:hover::before,.cust-split-gutter.dragging::before{background:var(--oci-red)}
        .cust-split-right{flex:1 1 auto;overflow-y:auto;padding:2px 0 16px 16px;min-width:280px}
        .cust-rtabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:14px;position:sticky;top:0;background:var(--surface);z-index:1}
        .cust-rtab{padding:9px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-3);border-bottom:2px solid transparent;margin-bottom:-1px}
        .cust-rtab.active{color:var(--oci-red);border-bottom-color:var(--oci-red)}
        .cust-subtabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
        .cust-subtab{padding:5px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);cursor:pointer;font-size:12px;color:var(--text-2)}
        .cust-subtab.active{background:var(--oci-red-light);border-color:var(--oci-red);color:var(--oci-red-dark);font-weight:600}
        .cust-rtab .badge,.cust-subtab .badge{font-size:10px}
      </style>
      <div class="cust-detail-head">
        <button class="btn btn-ghost btn-sm" id="cm-back">‹ 목록</button>
        <div class="cust-detail-title">${esc(cust.name)}</div>
        <div class="cust-detail-actions">
          <button class="btn btn-ghost btn-sm" id="cm-email-btn">이메일</button>
          <button class="btn btn-ghost btn-sm" id="cm-delete-btn" style="color:var(--oci-red)">삭제</button>
          <button class="btn btn-primary btn-sm" id="cm-save-btn">저장</button>
        </div>
      </div>

      <div class="cust-split" id="cust-split">
        <div class="cust-split-left" id="cust-split-left">
          <form id="cm-edit-form" class="form-grid">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">고객사명 <span style="color:var(--oci-red)">*</span></label>
                <input class="form-input" name="name" id="cm-name-input" required value="${esc(cust.name || '')}">
              </div>
              <div class="form-row">
                <label class="form-label" title="고객사명이 바뀌어도 동일 식별자로 인식됩니다">사업자등록번호</label>
                <input class="form-input" name="business_no" id="cm-brn-input" value="${esc(cust.business_no || '')}" placeholder="000-00-00000" maxlength="13" autocomplete="off">
                <div id="cm-brn-hint" style="font-size:11px;color:var(--text-3);margin-top:4px;min-height:14px"></div>
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-row"><label class="form-label">산업군</label><input class="form-input" name="industry" value="${esc(cust.industry || '')}"></div>
              <div class="form-row"></div>
            </div>
            <div class="form-row-3">
              <div class="form-row"><label class="form-label">지역</label>
                <select class="form-input" name="region">
                  <option value="국내" ${cust.region === '국내' ? 'selected' : ''}>국내</option>
                  <option value="해외" ${cust.region === '해외' ? 'selected' : ''}>해외</option>
                </select>
              </div>
              <div class="form-row"><label class="form-label">국가</label><input class="form-input" name="country" value="${esc(cust.country || '')}"></div>
              <div class="form-row"><label class="form-label">담당자</label><input class="form-input" name="contact_person" value="${esc(cust.contact_person || '')}"></div>
            </div>
            <div class="form-row-2">
              <div class="form-row"><label class="form-label">연락처</label><input class="form-input" name="phone" value="${esc(cust.phone || '')}"></div>
              <div class="form-row"><label class="form-label">이메일</label><input class="form-input" name="email" type="email" value="${esc(cust.email || '')}"></div>
            </div>
            <div class="form-row">
              <label class="form-label">주소</label>
              <div style="display:flex;gap:6px">
                <input class="form-input" name="address" id="cm-addr-input" value="${esc(cust.address || '')}" readonly style="flex:1;cursor:pointer;background:var(--surface)" placeholder="클릭하면 주소 검색이 열립니다" title="클릭하여 주소 검색">
                <button type="button" class="btn btn-ghost btn-sm" id="cm-addr-search" style="white-space:nowrap">주소 검색</button>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">위치</label>
              <div id="cm-kakao-map" style="width:100%;height:240px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px">지도 로딩 중...</div>
            </div>
          </form>
          <div class="card" style="margin-top:16px;margin-bottom:0">
            <div class="card-header">
              <div class="card-title">최근 Gmail 대화</div>
              <button class="btn btn-ghost btn-sm" id="cust-gmail-refresh" title="새로고침" style="display:none">새로고침</button>
            </div>
            <div class="card-body no-pad" id="cust-gmail-body">
              <div class="loading" style="padding:14px;text-align:center;font-size:12px;color:var(--text-3)">Gmail 대화 로딩 중...</div>
            </div>
          </div>
        </div>

        <div class="cust-split-gutter" id="cust-split-gutter" role="separator" aria-orientation="vertical" title="드래그하여 폭 조절"></div>

        <div class="cust-split-right" id="cust-split-right">
          <div class="cust-rtabs">
            <button class="cust-rtab active" data-rtab="deals">관련 딜 <span id="cm-deals-cnt" class="badge badge-blue">…</span></button>
            <button class="cust-rtab" data-rtab="brief">핵심 브리핑</button>
            <button class="cust-rtab" data-rtab="group">소속 고객 <span id="cm-group-cnt" class="badge badge-blue">…</span></button>
          </div>

          <div class="cust-rpane" data-rpane="deals">
            <div class="cust-subtabs">
              <button class="cust-subtab active" data-sub="dealslist">딜</button>
              <button class="cust-subtab" data-sub="quotes" data-feature="crm.quotes">견적 <span id="cm-quotes-cnt" class="badge badge-blue">…</span></button>
              <button class="cust-subtab" data-sub="proposals" data-feature="crm.proposals">제안 <span id="cm-proposals-cnt" class="badge badge-blue">…</span></button>
              <button class="cust-subtab" data-sub="contracts" data-feature="crm.contracts">계약 <span id="cm-contracts-cnt" class="badge badge-blue">…</span></button>
              <button class="cust-subtab" data-sub="payments" data-feature="crm.payments">수금 <span id="cm-payments-cnt" class="badge badge-blue">…</span></button>
              <button class="cust-subtab" data-sub="support" data-feature="crm.support">지원 <span id="cm-support-cnt" class="badge badge-blue">…</span></button>
            </div>
            <div class="cust-subpane" data-sub="dealslist"><div id="cm-deals-list">${ph}</div></div>
            <div class="cust-subpane" data-sub="quotes" hidden><div id="lq-customer">${ph}</div></div>
            <div class="cust-subpane" data-sub="proposals" hidden><div id="lp-customer">${ph}</div></div>
            <div class="cust-subpane" data-sub="contracts" hidden><div id="lc-customer">${ph}</div></div>
            <div class="cust-subpane" data-sub="payments" hidden><div id="lpay-customer">${ph}</div></div>
            <div class="cust-subpane" data-sub="support" hidden><div id="ls-customer">${ph}</div></div>
          </div>

          <div class="cust-rpane" data-rpane="brief" hidden>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div style="font-size:12px;color:var(--text-3)">AI가 영업 이력·활동을 분석해 핵심만 추출합니다 (약 5초)</div>
              <button class="ai-gen-btn btn-sm" id="cm-brief-gen">브리핑 생성</button>
            </div>
            <div id="cm-brief-content" style="min-height:120px">
              <div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">위 버튼을 눌러 핵심 브리핑을 생성하세요.</div>
            </div>
          </div>

          <div class="cust-rpane" data-rpane="group" hidden>
            <div id="cm-group-list">${ph}</div>
          </div>
        </div>
      </div>
    `;

    // ── 뒤로/저장/삭제/이메일 ──
    document.getElementById('cm-back').addEventListener('click', () => this.render());
    document.getElementById('cm-save-btn').addEventListener('click', () => this._saveCustomerEdit(id));
    document.getElementById('cm-delete-btn').addEventListener('click', () => this._deleteCustomer(id, cust.name));
    document.getElementById('cm-email-btn')?.addEventListener('click', () => {
      if (typeof Email !== 'undefined') Email.open({ customer: cust, defaultCategory: 'customer' });
    });
    document.getElementById('cm-brief-gen').addEventListener('click', () => this._generateBrief(id));

    // ── 우측 메인 탭 전환 (관련딜/브리핑/소속) ──
    document.querySelectorAll('.cust-rtab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.cust-rtab').forEach(b => b.classList.toggle('active', b === t));
        document.querySelectorAll('.cust-rpane').forEach(p => {
          p.hidden = p.dataset.rpane !== t.dataset.rtab;
        });
      });
    });
    // ── 관련 딜 서브탭 (딜/견적/제안/계약/수금/지원/360) ──
    document.querySelectorAll('.cust-subtab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.cust-subtab').forEach(b => b.classList.toggle('active', b === t));
        document.querySelectorAll('.cust-subpane').forEach(p => {
          p.hidden = p.dataset.sub !== t.dataset.sub;
        });
      });
    });

    // ── 드래그 divider (순수 JS, localStorage 폭 기억) ──
    const gutter = document.getElementById('cust-split-gutter');
    const splitEl = document.getElementById('cust-split');
    const leftEl = document.getElementById('cust-split-left');
    gutter.addEventListener('mousedown', e => {
      e.preventDefault();
      gutter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = ev => {
        const rect = splitEl.getBoundingClientRect();
        let pct = ((ev.clientX - rect.left) / rect.width) * 100;
        pct = Math.min(72, Math.max(28, pct));
        leftEl.style.flexBasis = pct + '%';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        gutter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('cust_split_pct', parseFloat(leftEl.style.flexBasis) || leftPct);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // ── 사업자등록번호 자동 포맷 + blur 매칭 ──
    const brnInput = document.getElementById('cm-brn-input');
    if (brnInput) {
      brnInput.addEventListener('input', () => {
        const n = brnInput.value.replace(/[^0-9]/g, '').slice(0, 10);
        let f = n;
        if (n.length > 5) f = `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
        else if (n.length > 3) f = `${n.slice(0, 3)}-${n.slice(3)}`;
        brnInput.value = f;
      });
      brnInput.addEventListener('blur', () => this._matchBusinessNo(id, brnInput.value));
    }

    // ── 주소 검색 + 지도 + Gmail + 기능플래그(서브탭 숨김) ──
    document.getElementById('cm-addr-search').addEventListener('click', () => this._openPostcodeSearch());
    // 주소 입력란 클릭 시 주소검색 자동 활성화 (readonly → 클릭=검색)
    document.getElementById('cm-addr-input')?.addEventListener('click', () => this._openPostcodeSearch());
    this._initKakaoMap(cust.address);
    this._loadGmailForCustomer(id);
    if (typeof Features !== 'undefined' && Features.apply) Features.apply();

    // ── 비동기 로더 (기존과 동일 — ID 보존) ──
    this._loadModalDeals(id);
    this._loadModalGroup(id);
    this._loadCachedBrief(id);
    const setCnt = (cid, n) => { const b = document.getElementById(cid); if (b) b.textContent = String(n || 0); };
    if (typeof LinkedContracts !== 'undefined')
      LinkedContracts.render('#lc-customer', 'customer', id).then(r => setCnt('cm-contracts-cnt', r?.count)).catch(() => setCnt('cm-contracts-cnt', 0));
    if (typeof LinkedQuotes !== 'undefined')
      LinkedQuotes.render('#lq-customer', 'customer', id).then(r => setCnt('cm-quotes-cnt', r?.count)).catch(() => setCnt('cm-quotes-cnt', 0));
    if (typeof LinkedProposals !== 'undefined')
      LinkedProposals.render('#lp-customer', 'customer', id).then(r => setCnt('cm-proposals-cnt', r?.count)).catch(() => setCnt('cm-proposals-cnt', 0));
    if (typeof LinkedSupport !== 'undefined')
      LinkedSupport.render('#ls-customer', 'customer', id).then(r => setCnt('cm-support-cnt', r?.count)).catch(() => setCnt('cm-support-cnt', 0));
    if (typeof LinkedPayments !== 'undefined')
      LinkedPayments.render('#lpay-customer', 'customer', id).then(r => setCnt('cm-payments-cnt', r?.count)).catch(() => setCnt('cm-payments-cnt', 0));
  },

  // ── 카카오 우편번호 SDK 동적 로드 ─────────────────────────
  _loadDaumPostcode() {
    return new Promise((resolve, reject) => {
      if (window.daum && window.daum.Postcode) return resolve();
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('우편번호 서비스 로드 실패'));
      document.head.appendChild(s);
    });
  },

  async _openPostcodeSearch() {
    try {
      await this._loadDaumPostcode();

      // ⚠️ open() 새 창 방식은 우리 서버의 CSP frame-ancestors='none' 에 막힘
      //    → embed() 로 직접 div 안에 띄움
      // 기존 오버레이 제거
      document.getElementById('cm-postcode-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'cm-postcode-overlay';
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:10010;
        display:flex; align-items:center; justify-content:center;`;
      overlay.innerHTML = `
        <div style="background:var(--surface); color:var(--text-1); width:min(540px,92vw); height:min(560px,86vh);
                    border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.3); overflow:hidden;
                    display:flex; flex-direction:column">
          <div style="display:flex; justify-content:space-between; align-items:center;
                      padding:10px 14px; border-bottom:1px solid var(--border); background:var(--surface-2)">
            <div style="font-size:14px; font-weight:600">주소 검색</div>
            <button id="cm-postcode-close" style="border:none; background:none; cursor:pointer;
                    font-size:18px; color:var(--text-3)">×</button>
          </div>
          <div id="cm-postcode-box" style="flex:1; overflow:auto"></div>
        </div>`;
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.querySelector('#cm-postcode-close').addEventListener('click', close);
      overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
      });

      new daum.Postcode({
        oncomplete: data => {
          const addr = data.roadAddress || data.jibunAddress || data.address || '';
          const extra = data.buildingName ? ' (' + data.buildingName + ')' : '';
          const full = addr + extra;
          const input = document.getElementById('cm-addr-input');
          if (input) input.value = full;
          close();
          this._renderKakaoMap(full);
        },
        width: '100%',
        height: '100%',
      }).embed(overlay.querySelector('#cm-postcode-box'));
    } catch (e) {
      Toast.error(e.message);
    }
  },

  // ── 카카오맵 SDK 동적 로드 (Geocoder 포함) ────────────────
  _loadKakaoMapSDK() {
    if (this._kakaoMapPromise) return this._kakaoMapPromise;
    this._kakaoMapPromise = (async () => {
      // 공개 설정에서 키 조회
      let key = window.__OCI_KAKAO_KEY__;
      if (key === undefined) {
        try {
          const r = await fetch('/api/config/public');
          const j = await r.json();
          key = j?.data?.kakaoMapKey || '';
          window.__OCI_KAKAO_KEY__ = key;
        } catch {
          key = '';
        }
      }
      if (!key) throw new Error('NO_KEY');

      if (window.kakao && window.kakao.maps && window.kakao.maps.services) return window.kakao;

      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src =
          'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' +
          encodeURIComponent(key) +
          '&libraries=services&autoload=false';
        s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
        s.onerror = () => reject(new Error('카카오맵 SDK 로드 실패'));
        document.head.appendChild(s);
      });
    })();
    return this._kakaoMapPromise;
  },

  // 지도에 마커+InfoWindow 렌더
  _renderMapAt(wrap, kakao, lat, lng, originalAddr) {
    const coords = new kakao.maps.LatLng(lat, lng);
    wrap.innerHTML = '';
    const map = new kakao.maps.Map(wrap, { center: coords, level: 3 });
    const marker = new kakao.maps.Marker({ position: coords, map });
    new kakao.maps.InfoWindow({
      content: `<div style="padding:6px 10px;font-size:12px;white-space:nowrap">${String(originalAddr).replace(/</g, '&lt;')}</div>`,
    }).open(map, marker);
  },

  _renderMapFailFallback(wrap, address, authIssue) {
    // authIssue: 지오코더가 결과 없이 status=null/ERROR (도메인 미등록 등 인증 거부 시그니처)
    const head = authIssue
      ? `카카오 지도 도메인 인증이 필요합니다.<br>
         <span style="font-size:11px">카카오 개발자 콘솔 → 내 앱 → 플랫폼 → Web 사이트 도메인에<br>현재 접속 도메인(<span class="mono">${esc(location.origin)}</span>)을 등록하세요.</span>`
      : '주소를 좌표로 변환하지 못했습니다.';
    wrap.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:30px">
      ${head}<br>
      <a href="https://map.kakao.com/link/search/${encodeURIComponent(address)}"
         target="_blank" rel="noopener" style="color:var(--oci-blue);text-decoration:underline;margin-top:8px;display:inline-block">
        카카오맵에서 보기 →
      </a>
    </div>`;
  },

  // ── 📧 Gmail 대화 lazy load (App._renderGmailCard 재사용) ──
  async _loadGmailForCustomer(customerId) {
    const body = document.getElementById('cust-gmail-body');
    if (!body || typeof App === 'undefined' || !App._renderGmailCard) return;
    try {
      const r = await API.gmail.matchCustomer(customerId, 8);
      App._renderGmailCard(body, r, () => this._loadGmailForCustomer(customerId));
    } catch (err) {
      App._renderGmailCard(
        body,
        {
          success: false,
          error: err.message || 'Gmail 조회 실패',
          code: err.code,
          feature: err.feature,
        },
        () => this._loadGmailForCustomer(customerId)
      );
    }
  },

  async _initKakaoMap(address) {
    const wrap = document.getElementById('cm-kakao-map');
    if (!wrap) return;
    if (!address) {
      wrap.innerHTML = `<div style="text-align:center;color:var(--text-4);font-size:13px">
        주소가 등록되지 않았습니다.<br><span style="font-size:11px">위의 주소 검색 버튼으로 등록하세요.</span>
      </div>`;
      return;
    }
    await this._renderKakaoMap(address);
  },

  // 주소를 Geocoder가 인식하기 쉽도록 정규화
  // - 앞의 5자리 우편번호 제거 ("06258 서울시..." → "서울시...")
  // - 괄호 안 부가정보 제거 ("(도곡동)", "(부영빌딩 6층)")
  // - 층/호수 등 끝 부분 제거 fallback 후보 생성
  _normalizeAddress(addr) {
    if (!addr) return [];
    let a = String(addr).trim();
    // 우편번호 (5자리)
    a = a.replace(/^\d{5}\s+/, '');
    // 괄호 안 모든 내용
    const noParen = a
      .replace(/\([^)]*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 끝에 붙은 층/호/동 (예: "...빌딩 6층")
    const noFloor = noParen.replace(/\s+\S+(층|호|동)\s*$/, '').trim();
    // 마지막 토큰 1개씩 제거한 후보들
    const tokens = noFloor.split(/\s+/);
    const candidates = [a, noParen, noFloor];
    for (let i = tokens.length; i >= 3; i--) {
      candidates.push(tokens.slice(0, i).join(' '));
    }
    // 중복 제거 + 빈값 제외
    return [...new Set(candidates)].filter(Boolean);
  },

  async _renderKakaoMap(address) {
    const wrap = document.getElementById('cm-kakao-map');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:var(--text-3);font-size:13px">지도 로딩 중...</div>';
    try {
      const kakao = await this._loadKakaoMapSDK();
      const geocoder = new kakao.maps.services.Geocoder();
      const candidates = this._normalizeAddress(address);
      const OK = kakao.maps.services.Status.OK;
      // status 가 OK/ZERO_RESULT 가 아니면(=null/ERROR) 도메인 인증 거부로 간주
      const ZERO = kakao.maps.services.Status.ZERO_RESULT;
      let authIssue = false;
      const noteAuth = status => {
        if (status !== OK && status !== ZERO) authIssue = true;
      };
      const ok = (result, status) => status === OK && result && result.length && result[0].y;

      // 후보 주소들을 순차적으로 시도 (Geocoder가 첫 매칭 반환)
      const trySearch = idx => {
        if (idx >= candidates.length) {
          // 모든 후보 실패 → 키워드 검색 fallback (Places)
          if (kakao.maps.services.Places) {
            const places = new kakao.maps.services.Places();
            places.keywordSearch(candidates[0], (result, status) => {
              noteAuth(status);
              if (ok(result, status)) {
                this._renderMapAt(wrap, kakao, parseFloat(result[0].y), parseFloat(result[0].x), address);
              } else {
                this._renderMapFailFallback(wrap, address, authIssue);
              }
            });
          } else {
            this._renderMapFailFallback(wrap, address, authIssue);
          }
          return;
        }
        geocoder.addressSearch(candidates[idx], (result, status) => {
          noteAuth(status);
          if (ok(result, status)) {
            this._renderMapAt(wrap, kakao, parseFloat(result[0].y), parseFloat(result[0].x), address);
          } else {
            trySearch(idx + 1);
          }
        });
      };
      trySearch(0);
    } catch (e) {
      // 키 없음 → 외부 링크 placeholder
      const fallback =
        e.message === 'NO_KEY'
          ? `<div style="text-align:center;font-size:13px;color:var(--text-3);padding:20px">
            <div style="margin-bottom:8px">카카오맵 키가 설정되지 않았습니다</div>
            <a href="https://map.kakao.com/link/search/${encodeURIComponent(address)}"
               target="_blank" rel="noopener" style="color:var(--oci-blue);text-decoration:underline">
              카카오맵에서 "${address.replace(/</g, '&lt;').slice(0, 40)}" 보기 →
            </a>
            <div style="margin-top:8px;font-size:11px;color:var(--text-4)">
              .env 파일의 KAKAO_MAP_KEY 를 설정하면 임베드 지도가 표시됩니다
            </div>
          </div>`
          : `<div style="color:var(--oci-red);padding:10px;font-size:13px">지도 오류: ${e.message}</div>`;
      wrap.innerHTML = fallback;
    }
  },

  async _loadModalDeals(id) {
    const wrap = document.getElementById('cm-deals-list');
    try {
      const r = await API.get(`/customers/${id}/deals`);
      const deals = r.data || [];
      document.getElementById('cm-deals-cnt').textContent = deals.length;
      if (!deals.length) {
        wrap.innerHTML = `<div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">관련 딜이 없습니다</div>`;
        return;
      }
      const stageMap = {
        lead: '발굴',
        review: '샘플 평가',
        proposal: 'Spec-in',
        bidding: '가격 협의',
        negotiation: '공급계약',
        won: '양산/수주',
        lost: '실주',
        dropped: '드롭',
      };
      wrap.innerHTML = `
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>프로젝트</th><th>유형</th><th>단계</th>
            <th class="text-right">예상 매출</th><th>최근 업데이트</th>
          </tr></thead>
          <tbody>
            ${deals
              .map(
                d => `
              <tr class="cm-deal-row" data-lead-id="${d.id}" style="cursor:pointer">
                <td><strong>${esc(d.project_name || '-')}</strong></td>
                <td>${esc(d.business_type || '-')}</td>
                <td><span class="badge">${stageMap[d.stage] || esc(d.stage || '-')}</span></td>
                <td class="text-right mono">${d.expected_amount ? Number(d.expected_amount).toLocaleString() + ' ' + (d.currency || '') : '-'}</td>
                <td style="font-size:11px;color:var(--text-3)">${d.updated_at ? new Date(d.updated_at).toLocaleDateString('ko-KR') : '-'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      wrap.querySelectorAll('.cm-deal-row').forEach(tr => {
        tr.addEventListener('click', () => {
          const leadId = parseInt(tr.dataset.leadId);
          if (!leadId) return;
          Modal.close();
          // 파이프라인으로 이동 후 해당 리드 상세 모달 열기
          // (WebSocket stage_change 핸들러와 동일 패턴 — app.js 의 검증된 동작)
          setTimeout(() => {
            App.navigate('pipeline').then(() => {
              App.openLeadDetail(leadId);
            });
          }, 100);
        });
      });
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  async _loadModalGroup(id) {
    const wrap = document.getElementById('cm-group-list');
    try {
      const r = await API.get(`/customers/${id}/group`);
      const members = r.data || [];
      document.getElementById('cm-group-cnt').textContent = members.length;
      if (members.length <= 1) {
        wrap.innerHTML = `<div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">
          이 회사명으로 등록된 고객은 1명입니다 (현재 표시 중).
        </div>`;
        return;
      }
      wrap.innerHTML = `
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">
          동일 회사명으로 ${members.length}명이 등록되어 있습니다. 클릭하면 해당 고객 모달로 이동합니다.
        </div>
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>담당자</th><th>이메일</th><th>연락처</th><th>지역</th><th>산업</th>
          </tr></thead>
          <tbody>
            ${members
              .map(
                m => `
              <tr class="cm-grp-row ${m.id === id ? 'cp-selected' : ''}" data-cust-id="${m.id}" style="cursor:pointer">
                <td><strong>${esc(m.contact_person || '-')}</strong>${m.id === id ? ' <span class="badge badge-blue" style="font-size:10px">현재</span>' : ''}</td>
                <td class="mono" style="font-size:11px">${esc(m.email || '-')}</td>
                <td class="mono">${esc(m.phone || '-')}</td>
                <td>${esc(m.region || '-')}</td>
                <td>${esc(m.industry || '-')}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      wrap.querySelectorAll('.cm-grp-row').forEach(tr => {
        tr.addEventListener('click', () => {
          const targetId = parseInt(tr.dataset.custId);
          if (targetId === id) return;
          Modal.close();
          setTimeout(() => this.showCustomerDetail(targetId), 100);
        });
      });
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  // 모달 열림 시 — DB 캐시된 최신 브리핑 자동 표시 (없으면 안내 유지)
  async _loadCachedBrief(id) {
    try {
      const r = await API.get(`/customers/${id}/brief`);
      if (r.data) {
        this._renderBriefData(id, r.data);
      }
    } catch (_) {
      /* 캐시 없으면 무시 */
    }
  },

  // 브리핑 데이터 → 화면 렌더 (캐시 로드, 신규 생성 공통)
  _renderBriefData(id, d) {
    const wrap = document.getElementById('cm-brief-content');
    if (!wrap) return;
    const s = d.stats || {};
    const genAtFmt = d.generated_at ? this._fmtDateTime(d.generated_at) : '';
    const genBy = d.generated_by_name || '';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:11px;color:var(--text-3)">
        <span>${d.cached ? '저장된 브리핑' : '신규 생성됨'}</span>
        ${
          genAtFmt
            ? `<span title="${esc(new Date(d.generated_at).toLocaleString())}">
          ${esc(genAtFmt)} ${genBy ? '· ' + esc(genBy) : ''}
        </span>`
            : ''
        }
      </div>
      <div style="background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.06));
                  border-left:3px solid var(--oci-blue);padding:14px 16px;border-radius:8px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:600;line-height:1.5">${esc(d.headline || '')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;font-size:11px">
        <div class="stat-mini"><div style="color:var(--text-3)">총 딜</div><div style="font-size:18px;font-weight:700">${s.deals || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">진행</div><div style="font-size:18px;font-weight:700;color:var(--oci-blue)">${s.open || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">수주</div><div style="font-size:18px;font-weight:700;color:#17A85A">${s.won || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">누적 금액</div><div style="font-size:14px;font-weight:700">${(s.total_amount || 0).toLocaleString()}</div></div>
      </div>
      <div style="font-size:13px;font-weight:600;margin:8px 0">핵심 포인트</div>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.8;font-size:13px">
        ${(d.key_points || []).map(k => `<li>${esc(k)}</li>`).join('')}
      </ul>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
        <div style="flex:1;min-width:200px;background:rgba(23,168,90,.08);border-left:3px solid #17A85A;padding:10px 12px;border-radius:6px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번 주 즉시 실행</div>
          <div style="font-size:13px;font-weight:600">${esc(d.next_action || '-')}</div>
        </div>
        ${
          d.risk
            ? `
        <div style="flex:1;min-width:200px;background:rgba(230,51,41,.08);border-left:3px solid var(--oci-red);padding:10px 12px;border-radius:6px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">리스크</div>
          <div style="font-size:13px;font-weight:600">${esc(d.risk)}</div>
        </div>`
            : ''
        }
      </div>

      <!-- 변경 이력 영역 -->
      <details id="cm-brief-history-wrap" style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
        <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2)">
          변경 이력 보기
        </summary>
        <div id="cm-brief-history-list" style="margin-top:10px;font-size:12px">
          <div class="loading" style="padding:10px;color:var(--text-3)">이력 불러오는 중...</div>
        </div>
      </details>
    `;
    this._markBriefed(id);

    // 이력 영역은 펼칠 때 lazy 로드
    const detailsEl = document.getElementById('cm-brief-history-wrap');
    if (detailsEl) {
      detailsEl.addEventListener('toggle', () => {
        if (detailsEl.open && !detailsEl.dataset.loaded) {
          this._loadBriefHistory(id);
          detailsEl.dataset.loaded = '1';
        }
      });
    }

    // 버튼 라벨 갱신
    const btn = document.getElementById('cm-brief-gen');
    if (btn) btn.innerHTML = '다시 생성';
  },

  async _loadBriefHistory(id) {
    const wrap = document.getElementById('cm-brief-history-list');
    if (!wrap) return;
    try {
      const r = await API.get(`/customers/${id}/brief/history`);
      const list = r.data || [];
      if (list.length <= 1) {
        wrap.innerHTML = `<div style="color:var(--text-3);padding:8px">이전 이력이 없습니다 (현재 브리핑이 최초입니다).</div>`;
        return;
      }
      wrap.innerHTML = `
        <div style="color:var(--text-3);margin-bottom:8px">총 ${list.length}건의 브리핑 이력 (최신순)</div>
        <div style="border-left:2px solid var(--border);padding-left:14px">
          ${list
            .map((h, idx) => {
              const isLatest = idx === 0;
              const time = this._fmtDateTime(h.generated_at);
              const fullTime = new Date(h.generated_at).toLocaleString('ko-KR');
              return `
              <div class="cm-brief-hist-item" style="position:relative;margin-bottom:14px;padding-left:6px">
                <div style="position:absolute;left:-21px;top:4px;width:10px;height:10px;border-radius:50%;
                            background:${isLatest ? 'var(--oci-blue)' : 'var(--text-4)'};border:2px solid var(--surface)"></div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
                  <span style="font-weight:600">${esc(h.headline || '(요약 없음)')}</span>
                  <span style="font-size:11px;color:var(--text-3);white-space:nowrap" title="${esc(fullTime)}">
                    ${esc(time)}${h.generated_by_name ? ' · ' + esc(h.generated_by_name) : ''}
                    ${isLatest ? ' <span class="badge badge-blue" style="font-size:9px;margin-left:4px">최신</span>' : ''}
                  </span>
                </div>
                <div style="color:var(--text-3);font-size:11px">
                  ${esc(h.next_action || '-')}${h.risk ? ' · 리스크: ' + esc(h.risk) : ''}
                </div>
                <div style="font-size:10px;color:var(--text-4);margin-top:2px">
                  딜 ${h.stats?.deals || 0} · 수주 ${h.stats?.won || 0} · 누적 ${(h.stats?.total_amount || 0).toLocaleString()}
                </div>
              </div>`;
            })
            .join('')}
        </div>
      `;
    } catch (e) {
      wrap.innerHTML = `<div style="color:var(--oci-red);padding:8px">이력 로드 실패: ${esc(e.message)}</div>`;
    }
  },

  // 상대 시간 + 절대 시간 포맷 (방금/N분 전/N시간 전/MM-DD HH:mm)
  _fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diffMs = Date.now() - d.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const day = Math.floor(h / 24);
    if (day < 7) return `${day}일 전`;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  async _generateBrief(id) {
    const wrap = document.getElementById('cm-brief-content');
    const btn = document.getElementById('cm-brief-gen');
    btn.disabled = true;
    btn.innerHTML = '생성 중...';
    wrap.innerHTML = `<div class="loading" style="padding:30px;text-align:center">AI가 분석 중...</div>`;
    try {
      const r = await API.post(`/customers/${id}/brief`, {});
      this._renderBriefData(id, r.data);
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">생성 실패: ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '다시 생성';
    }
  },

  async _saveCustomerEdit(id) {
    const form = document.getElementById('cm-edit-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => (body[k] = String(v).trim() || null));
    try {
      await API.put(`/customers/${id}`, body);
      Toast.success('수정되었습니다');
      Modal.close();
      this.loadData();
    } catch (e) {
      // BRN 충돌 / 형식 오류 — 친화적 메시지
      const msg = e.message || '';
      if (/사업자등록번호|business_no|BRN/i.test(msg)) {
        Toast.error(msg);
      } else {
        Toast.error('수정 실패: ' + msg);
      }
    }
  },

  // v6.0.0: 사업자등록번호 입력 후 blur — 매칭 + 검증 + 안내
  async _matchBusinessNo(currentId, rawBrn) {
    const hint = document.getElementById('cm-brn-hint');
    const nameInput = document.getElementById('cm-name-input');
    if (!hint) return;

    const cleaned = String(rawBrn || '').replace(/[^0-9]/g, '');
    if (!cleaned) {
      hint.innerHTML = '';
      return;
    }
    if (cleaned.length !== 10) {
      hint.innerHTML = '<span style="color:var(--oci-red)">⚠ 10자리 숫자를 입력하세요</span>';
      return;
    }

    try {
      const params = new URLSearchParams({
        business_no: cleaned,
        name: nameInput?.value || '',
      });
      const res = await API.get(`/customers/match-by-brn?${params}`);
      const d = res?.data || {};

      if (!d.valid) {
        hint.innerHTML =
          '<span style="color:var(--oci-red)">⚠ 사업자등록번호 체크섬 오류 — 번호를 다시 확인해주세요</span>';
        return;
      }

      // 매칭 안 됨 — 신규 BRN
      if (!d.found) {
        hint.innerHTML = '<span style="color:#16a34a">✓ 검증 완료 (신규 등록 가능)</span>';
        return;
      }

      // 자기 자신과 매칭 — 변경 없음
      if (currentId && Number(d.customer?.id) === Number(currentId)) {
        hint.innerHTML = '<span style="color:#16a34a">✓ 현재 고객사와 동일</span>';
        return;
      }

      // 다른 고객사와 매칭됨
      if (d.nameChanged) {
        hint.innerHTML = `<span style="color:#d97706">⚠ 동일 BRN 의 고객사 발견 (기존: <strong>${esc(d.customer.name)}</strong>) — 이름 변경 추정</span>`;
        // 모달로 사용자 선택
        this._showBrnConflictModal(d.customer, nameInput.value);
      } else {
        hint.innerHTML = `<span style="color:var(--oci-red)">⚠ 이미 등록된 고객사 (${esc(d.customer.name)} · ID:${d.customer.id})</span>`;
      }
    } catch (e) {
      hint.innerHTML = `<span style="color:var(--oci-red)">매칭 오류: ${esc(e.message || '서버 오류')}</span>`;
    }
  },

  // BRN 동일 + 이름 다름 → 사용자 선택 모달
  _showBrnConflictModal(existingCustomer, newName) {
    Modal.open({
      title: '동일 사업자번호의 고객사 발견',
      width: 540,
      body: `
        <div style="font-size:13px;color:var(--text-2);line-height:1.7;margin-bottom:14px">
          입력하신 사업자등록번호로 이미 등록된 고객사가 있습니다.<br>
          <span style="color:var(--text-3);font-size:12px">
            고객사 이름이 변경되었을 가능성이 있습니다 — 처리 방식을 선택해주세요.
          </span>
        </div>
        <div style="background:var(--surface-2);padding:14px;border-radius:6px;margin-bottom:10px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">기존 고객사</div>
          <div style="font-weight:600;font-size:15px;margin-bottom:6px">${esc(existingCustomer.name)}</div>
          <div style="font-size:12px;color:var(--text-2)">
            연락처 ${esc(existingCustomer.phone || '-')} ·
            담당자 ${esc(existingCustomer.contact_person || '-')} ·
            지역 ${esc(existingCustomer.region || '-')}
          </div>
        </div>
        <div style="background:#fef3c7;padding:14px;border-radius:6px;margin-bottom:10px">
          <div style="font-size:11px;color:#92400e;margin-bottom:4px">새로 입력한 이름</div>
          <div style="font-weight:600;font-size:15px;color:#92400e">${esc(newName || '(미입력)')}</div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="bc-cancel">취소</button>
        <button class="btn btn-secondary" id="bc-open">기존 고객사 열기</button>
        <button class="btn btn-primary" id="bc-update">이름 변경 적용</button>
      `,
      bind: {
        '#bc-cancel': () => Modal.close(),
        '#bc-open': () => {
          Modal.close();
          // 기존 모달 닫고 → 매칭된 고객사 열기
          Modal.close();
          this.openCustomerModal(existingCustomer.id);
        },
        '#bc-update': () => this._acceptNameChange(existingCustomer.id, newName),
      },
    });
  },

  // 이름 변경 수락 → 백엔드 호출 + history 저장
  async _acceptNameChange(customerId, newName) {
    if (!newName || !newName.trim()) {
      Toast.warn('새 이름을 입력하세요');
      return;
    }
    try {
      const res = await API.post(`/customers/${customerId}/accept-name-change`, {
        newName: newName.trim(),
        source: 'manual',
      });
      if (res?.changed) {
        Toast.success(`이름 변경 완료 (${res.data.oldName} → ${res.data.newName})`);
      } else {
        Toast.info('이름 변경 없음');
      }
      Modal.close();
      Modal.close();
      await this.loadData();
      // 변경된 기존 고객사 열기
      this.openCustomerModal(customerId);
    } catch (e) {
      Toast.error('이름 변경 실패: ' + (e.message || ''));
    }
  },

  async _deleteCustomer(id, name) {
    if (!confirm(`정말 "${name}" 고객을 삭제하시겠습니까?\n관련 데이터는 영향받지 않습니다.`))
      return;
    try {
      await API.delete(`/customers/${id}`);
      Toast.success('삭제되었습니다');
      Modal.close();
      this.loadData();
    } catch (e) {
      Toast.error('삭제 실패: ' + e.message);
    }
  },

  // ── 고객사 인텔리전스 스트리밍 (레거시 호환) ──────────────
  async showIntel(id, name) {
    this.selectedCustomer = { id, name };
    const panel = document.getElementById('cust-intel-panel');
    panel.style.display = '';
    document.getElementById('intel-company-name').textContent = name;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btn = document.getElementById('intel-refresh-btn');
    btn.onclick = () => this.showIntel(id, name);

    await this._streamIntelligence(id);
  },

  closeIntel() {
    document.getElementById('cust-intel-panel').style.display = 'none';
    this.selectedCustomer = null;
  },

  async _streamIntelligence(id) {
    const contentEl = document.getElementById('intel-content');
    contentEl.innerHTML = '<span class="ai-cursor">▋</span>';

    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const res = await fetch(`/api/customers/${id}/intelligence`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            reader.cancel();
            break;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              contentEl.innerHTML = `<span style="color:var(--oci-red)">${esc(parsed.error)}</span>`;
              return;
            }
            if (parsed.text) {
              fullText += parsed.text;
              contentEl.innerHTML =
                AI.renderMarkdown(fullText) + '<span class="ai-cursor">▋</span>';
              contentEl.parentElement.scrollTop = contentEl.parentElement.scrollHeight;
            }
          } catch (_) {
            /* malformed SSE JSON line, skip */
          }
        }
      }
      if (fullText) {
        contentEl.innerHTML = AI.renderMarkdown(fullText);
        this._markBriefed(id); // ✅ 인라인 인텔리전스 완료 마킹
      }
    } catch (err) {
      contentEl.innerHTML = `<span style="color:var(--oci-red)">${esc(err.message)}</span>`;
    }
  },

  // ── 통합 등록 모달 (직접 입력 / 명함 업로드) ──────────────
  // options.autoCapture: PWA 쇼트컷(?action=scan-card) 진입 시 라이브 카메라 모드 활성
  openRegisterModal(defaultTab = 'direct', options = {}) {
    this._ocrFiles = [];
    this._ocrResults = [];
    this._activeRegTab = defaultTab;

    // v6.0.0 Phase 2A: PWA shortcut 진입 시 → 라이브 카메라 연속 촬영 모드
    // getUserMedia 가능한 환경(HTTPS + 모바일/지원 브라우저) 이면 라이브 뷰파인더,
    // 아니면 기존 HTML5 input + capture="environment" 폴백
    if (options.autoCapture) {
      return this._openLiveCaptureModal();
    }

    Modal.open({
      title: '고객사 등록',
      width: 680,
      body: `
        <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:-8px -8px 20px">
          <button id="rtab-btn-direct" data-reg-tab="direct"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab === 'direct' ? 'var(--oci-red)' : 'var(--text-3)'};
                   border-bottom-color:${defaultTab === 'direct' ? 'var(--oci-red)' : 'transparent'}">
            직접 입력
          </button>
          ${
            typeof Features === 'undefined' || Features.isEnabled('ai.ocr')
              ? `
          <button id="rtab-btn-ocr" data-reg-tab="ocr"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab === 'ocr' ? 'var(--oci-red)' : 'var(--text-3)'};
                   border-bottom-color:${defaultTab === 'ocr' ? 'var(--oci-red)' : 'transparent'}">
            명함 업로드
          </button>`
              : ''
          }
        </div>

        <!-- 직접 입력 탭 -->
        <div id="rtab-content-direct" ${defaultTab !== 'direct' ? 'style="display:none"' : ''}>
          <form id="cust-form" class="form-grid">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">고객사명 <span style="color:var(--oci-red)">*</span></label>
                <input class="form-input" name="name" id="reg-name-input"
                       placeholder="회사명 입력" required>
              </div>
              <div class="form-row">
                <label class="form-label" title="고객사명이 바뀌어도 동일 식별자로 인식됩니다">
                  사업자등록번호
                </label>
                <input class="form-input" name="business_no" id="reg-brn-input"
                       placeholder="000-00-00000" maxlength="13" autocomplete="off">
                <div id="reg-brn-hint" style="font-size:11px;color:var(--text-3);margin-top:4px;min-height:14px"></div>
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">산업군</label>
                <input class="form-input" name="industry" placeholder="발전, 에너지, 건설...">
              </div>
              <div class="form-row"></div>
            </div>
            <div class="form-row-3">
              <div class="form-row">
                <label class="form-label">지역</label>
                <select class="form-input" name="region">
                  <option value="국내">국내</option>
                  <option value="해외">해외</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">국가</label>
                <input class="form-input" name="country" placeholder="대한민국">
              </div>
              <div class="form-row">
                <label class="form-label">담당자명</label>
                <input class="form-input" name="contact_person">
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">전화번호</label>
                <input class="form-input" name="phone">
              </div>
              <div class="form-row">
                <label class="form-label">이메일</label>
                <input type="email" class="form-input" name="email">
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">주소</label>
              <input class="form-input" name="address">
            </div>
          </form>
        </div>

        <!-- 명함 업로드 탭 -->
        <div id="rtab-content-ocr" ${defaultTab !== 'ocr' ? 'style="display:none"' : ''}>
          <p style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6">
            명함 이미지(JPG/PNG)를 드래그&드롭하거나 클릭해서 선택하세요.<br>
            Google Vision AI로 텍스트를 인식하고 고객사 정보를 자동 추출합니다.
          </p>

          <div id="card-dropzone">
            <div style="margin-bottom:10px;color:var(--text-3)"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M14 10h4M14 14h4M5 16c.6-1.5 2-2 3-2s2.4.5 3 2"/></svg></div>
            <div style="font-size:14px;font-weight:600;color:var(--text-1)">명함 파일을 여기에 드롭하거나 클릭해서 선택</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:6px">JPG, PNG 지원 · 최대 20장</div>
            <input type="file" id="card-file-input" accept="image/*" multiple style="display:none">
          </div>

          <div id="card-file-list" style="margin-top:12px"></div>
          <div id="card-ocr-results" style="margin-top:8px"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="reg-modal-close-btn">닫기</button>
        <button class="btn btn-primary" id="rtab-footer-direct"
                ${defaultTab !== 'direct' ? 'style="display:none"' : ''}>
          등록
        </button>
        <button class="btn btn-primary" id="card-ocr-start-btn" style="display:none">
          AI 인식 시작
        </button>
        <button class="btn btn-primary" id="card-save-all-btn" style="display:none">
          전체 저장
        </button>
      `,
      bind: {
        '#reg-modal-close-btn': () => Modal.close(),
        '#rtab-footer-direct': () => this.save(),
        '#card-ocr-start-btn': () => this._runOCR(),
        '#card-save-all-btn': () => this._saveAllOCR(),
      },
    });
    setTimeout(() => this._bindRegTabButtons(), 0);
  },

  _bindRegTabButtons() {
    document.querySelectorAll('[data-reg-tab]').forEach(btn => {
      btn.addEventListener('click', () => this._switchRegTab(btn.dataset.regTab));
    });
    const dropzone = document.getElementById('card-dropzone');
    if (dropzone) {
      dropzone.addEventListener('click', () => document.getElementById('card-file-input')?.click());
      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
      dropzone.addEventListener('drop', e => this._handleDrop(e));
    }
    const fileInput = document.getElementById('card-file-input');
    if (fileInput) fileInput.addEventListener('change', () => this._handleFiles(fileInput.files));

    // v6.0.0: 신규 등록 폼 — 사업자등록번호 자동 포맷 + blur 매칭
    const regBrn = document.getElementById('reg-brn-input');
    if (regBrn) {
      regBrn.addEventListener('input', () => {
        const n = regBrn.value.replace(/[^0-9]/g, '').slice(0, 10);
        let formatted = n;
        if (n.length > 5) formatted = `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
        else if (n.length > 3) formatted = `${n.slice(0, 3)}-${n.slice(3)}`;
        regBrn.value = formatted;
      });
      regBrn.addEventListener('blur', () => this._matchBusinessNoForReg(regBrn.value));
    }
  },

  // 신규 등록 폼용 BRN 매칭 (currentId 없음)
  async _matchBusinessNoForReg(rawBrn) {
    const hint = document.getElementById('reg-brn-hint');
    const nameInput = document.getElementById('reg-name-input');
    if (!hint) return;
    const cleaned = String(rawBrn || '').replace(/[^0-9]/g, '');
    if (!cleaned) {
      hint.innerHTML = '';
      return;
    }
    if (cleaned.length !== 10) {
      hint.innerHTML = '<span style="color:var(--oci-red)">⚠ 10자리 숫자를 입력하세요</span>';
      return;
    }
    try {
      const params = new URLSearchParams({
        business_no: cleaned,
        name: nameInput?.value || '',
      });
      const res = await API.get(`/customers/match-by-brn?${params}`);
      const d = res?.data || {};
      if (!d.valid) {
        hint.innerHTML =
          '<span style="color:var(--oci-red)">⚠ 체크섬 오류 — 번호를 다시 확인해주세요</span>';
        return;
      }
      if (!d.found) {
        hint.innerHTML = '<span style="color:#16a34a">✓ 검증 완료 (신규 등록 가능)</span>';
        return;
      }
      if (d.nameChanged) {
        hint.innerHTML = `<span style="color:#d97706">⚠ 동일 BRN — 기존 이름: <strong>${esc(d.customer.name)}</strong></span>`;
        this._showBrnConflictModal(d.customer, nameInput.value);
      } else {
        hint.innerHTML = `<span style="color:var(--oci-red)">⚠ 이미 등록된 고객사 (${esc(d.customer.name)})</span>`;
      }
    } catch (e) {
      hint.innerHTML = `<span style="color:var(--oci-red)">매칭 오류: ${esc(e.message || '서버 오류')}</span>`;
    }
  },

  _switchRegTab(tab) {
    this._activeRegTab = tab;

    const tabs = ['direct', 'ocr'];
    tabs.forEach(t => {
      const btn = document.getElementById(`rtab-btn-${t}`);
      const content = document.getElementById(`rtab-content-${t}`);
      const isActive = t === tab;
      if (btn) {
        btn.style.color = isActive ? 'var(--oci-red)' : 'var(--text-3)';
        btn.style.borderBottomColor = isActive ? 'var(--oci-red)' : 'transparent';
      }
      if (content) content.style.display = isActive ? '' : 'none';
    });

    // Footer 버튼 전환
    const footerDirect = document.getElementById('rtab-footer-direct');
    const ocrStart = document.getElementById('card-ocr-start-btn');
    const ocrSave = document.getElementById('card-save-all-btn');

    if (tab === 'direct') {
      if (footerDirect) footerDirect.style.display = '';
      if (ocrStart) ocrStart.style.display = 'none';
      if (ocrSave) ocrSave.style.display = 'none';
    } else {
      if (footerDirect) footerDirect.style.display = 'none';
      // OCR start/save show based on file selection / results
    }
  },

  async save() {
    const fd = new FormData(document.getElementById('cust-form'));
    const body = {};
    fd.forEach((v, k) => {
      body[k] = v || null;
    });
    if (!body.name) return Toast.error('고객사명을 입력하세요');

    // 인라인 경고 초기화
    const existingBanner = document.getElementById('dup-warn-banner');
    if (existingBanner) existingBanner.remove();

    try {
      await API.customers.create(body);
      Toast.success('고객사가 등록되었습니다');
      Modal.close();
      await this.loadData();
      await App.refreshCommon();
    } catch (err) {
      // 중복 409 처리 — 모달 안에 인라인 배너로 표시
      if (err?.status === 409 || err?.duplicate) {
        const msg = err?.message || '이미 등록된 고객사입니다';
        const banner = document.createElement('div');
        banner.id = 'dup-warn-banner';
        banner.style.cssText = `
          background:#fff3cd;border:1.5px solid #ffc107;border-radius:6px;
          padding:10px 14px;margin-bottom:14px;font-size:13px;color:#856404;
          display:flex;align-items:flex-start;gap:8px;line-height:1.5;
        `;
        banner.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
          <div><strong>중복 고객사 감지</strong><br>${esc(msg)}</div>`;
        const form = document.getElementById('cust-form');
        if (form) form.prepend(banner);
      } else {
        Toast.error('등록 중 오류가 발생했습니다');
        console.error(err);
      }
    }
  },

  // ── 명함 파일 처리 ────────────────────────────────────────
  _handleDrop(e) {
    e.preventDefault();
    document.getElementById('card-dropzone').classList.remove('drag-over');
    this._handleFiles(e.dataTransfer.files);
  },

  _handleFiles(files) {
    this._ocrFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const listEl = document.getElementById('card-file-list');
    if (!this._ocrFiles.length) {
      listEl.innerHTML =
        '<div style="color:var(--oci-red);font-size:12px">이미지 파일이 없습니다</div>';
      return;
    }
    listEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
        <strong>${this._ocrFiles.length}장</strong> 선택됨
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${this._ocrFiles
          .map(
            f => `
          <div style="display:flex;align-items:center;gap:4px;background:var(--surface-2);
                      border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">
            ${esc(f.name)}
            <span style="color:var(--text-3)">(${(f.size / 1024).toFixed(0)}KB)</span>
          </div>
        `
          )
          .join('')}
      </div>`;

    const startBtn = document.getElementById('card-ocr-start-btn');
    if (startBtn) startBtn.style.display = '';
  },

  // v6.0.0 Phase 2A fix: 배치 분할 처리 (5장씩) — 다음 문제들 동시 해결:
  //   1) Nginx client_max_body_size 초과 (20장 = ~100MB → 1MB 기본 한계)
  //   2) 요청 timeout (Gemini 20장 순차 60s+)
  //   3) HTML 에러 응답 → "Unexpected token <" JSON parse 에러
  //   4) 모바일 메모리 부족 (대용량 FormData 직렬화)
  // + 진행률 표시 (사용자 안내) + 한 배치 실패해도 나머지 계속
  async _runOCR() {
    const BATCH_SIZE = 5;
    const startBtn = document.getElementById('card-ocr-start-btn');
    const resultsEl = document.getElementById('card-ocr-results');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = '인식 중...';
    }

    const total = this._ocrFiles.length;
    const batches = [];
    for (let i = 0; i < total; i += BATCH_SIZE) {
      batches.push(this._ocrFiles.slice(i, i + BATCH_SIZE));
    }

    const renderProgress = (batchIdx, doneCount, batchStatus = '') => {
      const pct = Math.round((doneCount / total) * 100);
      resultsEl.innerHTML = `
        <div style="padding:20px;text-align:center">
          <div style="font-size:14px;font-weight:600;color:var(--text-1);margin-bottom:10px">
            AI 명함 인식 중...
          </div>
          <div style="font-size:13px;color:var(--text-2);margin-bottom:14px">
            배치 ${batchIdx} / ${batches.length} (${doneCount}/${total}장 완료)
            ${batchStatus ? `<br><span style="color:var(--text-3);font-size:11px">${esc(batchStatus)}</span>` : ''}
          </div>
          <div style="width:100%;max-width:300px;margin:0 auto;height:8px;background:var(--surface-2);
                      border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:var(--oci-red);transition:width .3s"></div>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">${pct}%</div>
        </div>`;
    };
    renderProgress(0, 0, '준비 중...');

    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const ocrHeaders = {};
    if (token) ocrHeaders['Authorization'] = `Bearer ${token}`;

    const allResults = [];
    let doneCount = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      renderProgress(bi + 1, doneCount, `${batch.length}장 업로드 중...`);

      const formData = new FormData();
      batch.forEach(f => formData.append('cards', f));

      try {
        const res = await fetch('/api/customers/ocr', {
          method: 'POST',
          body: formData,
          headers: ocrHeaders,
        });

        // ⚠️ HTML 응답 감지 (Nginx 413, Express 기본 에러 핸들러 등) → 친화적 메시지
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          let hint = '';
          if (res.status === 413) hint = '파일 크기가 너무 큽니다. 사진 해상도를 낮추거나 적게 촬영하세요.';
          else if (res.status === 504 || res.status === 502) hint = 'AI 처리 시간 초과. 잠시 후 다시 시도하세요.';
          else hint = `서버 응답 형식 오류 (HTTP ${res.status})`;
          throw new Error(hint);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `배치 ${bi + 1} 인식 실패`);
        }
        // 배치 결과 누적
        const batchResults = Array.isArray(data.data) ? data.data : [];
        allResults.push(...batchResults);
        doneCount += batch.length;
        renderProgress(bi + 1, doneCount, `${bi + 1}번째 배치 완료`);
      } catch (err) {
        console.error(`[OCR batch ${bi + 1}] failed:`, err);
        // 배치 실패 시 — 해당 배치 파일들을 에러 레코드로 표시하고 다음 배치 계속
        const msg = err?.message || '알 수 없는 오류';
        batch.forEach(f => {
          allResults.push({ filename: f.name || `(이미지)`, error: msg, parsed: {} });
        });
        doneCount += batch.length;
        renderProgress(bi + 1, doneCount, `배치 ${bi + 1} 실패 — 다음 배치 계속...`);
      }
    }

    // 모든 결과 합쳐서 표시
    this._ocrResults = allResults;
    if (!allResults.length) {
      resultsEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">인식 결과가 없습니다</div>`;
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = 'AI 인식 시작';
      }
      return;
    }
    this._renderOCRResults();
    const saveBtn = document.getElementById('card-save-all-btn');
    if (saveBtn) saveBtn.style.display = '';
    if (startBtn) startBtn.style.display = 'none';

    // 부분 실패 알림
    const failedCount = allResults.filter(r => r.error).length;
    if (failedCount > 0 && failedCount < allResults.length) {
      Toast.warn(`${failedCount}장 인식 실패 (나머지 ${allResults.length - failedCount}장 정상)`);
    }
  },

  _renderOCRResults() {
    const el = document.getElementById('card-ocr-results');
    if (!this._ocrResults.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:12px">인식 결과가 없습니다</div>';
      return;
    }
    el.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-1)">
        인식 결과 — 필드를 확인/수정 후 저장하세요
      </div>
      ${this._ocrResults
        .map(
          (r, i) => `
        <div class="ocr-result-card">
          <div style="background:var(--surface-2);padding:8px 12px;font-size:12px;font-weight:600;
                      color:var(--text-2);display:flex;justify-content:space-between;align-items:center;
                      border-bottom:1px solid var(--border)">
            <span>${esc(r.filename)}</span>
            ${
              r.error
                ? `<span style="color:var(--oci-red)">인식 실패</span>`
                : `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400">
                   <input type="checkbox" class="ocr-check" data-idx="${i}" checked> 저장 포함
                 </label>`
            }
          </div>
          ${
            r.error
              ? `<div style="padding:12px;color:var(--oci-red);font-size:12px">${esc(r.error)}</div>`
              : `<div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px" id="ocr-form-${i}">
                ${[
                  ['name', '고객사명 *'],
                  ['contact_person', '담당자'],
                  ['industry', '산업군'],
                  ['phone', '전화번호'],
                  ['email', '이메일'],
                  ['country', '국가'],
                  ['address', '주소', 'grid-column:1/-1'],
                ]
                  .map(
                    ([field, label, style = '']) => `
                  <div ${style ? `style="${style}"` : ''}>
                    <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">${label}</div>
                    <input class="form-input" style="font-size:12px;padding:5px 8px"
                           id="ocr-${i}-${field}"
                           value="${esc(r.parsed[field] || '')}"
                           placeholder="${label}">
                  </div>
                `
                  )
                  .join('')}
                <div>
                  <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">지역</div>
                  <select class="form-input" style="font-size:12px;padding:5px 8px" id="ocr-${i}-region">
                    <option value="국내" ${r.parsed.region !== '해외' ? 'selected' : ''}>국내</option>
                    <option value="해외" ${r.parsed.region === '해외' ? 'selected' : ''}>해외</option>
                  </select>
                </div>
              </div>`
          }
        </div>
      `
        )
        .join('')}
    `;
  },

  _collectOCRForm(i) {
    const get = f => (document.getElementById(`ocr-${i}-${f}`)?.value || '').trim() || null;
    return {
      name: get('name'),
      contact_person: get('contact_person'),
      industry: get('industry'),
      phone: get('phone'),
      email: get('email'),
      country: get('country'),
      address: get('address'),
      region: document.getElementById(`ocr-${i}-region`)?.value || '국내',
    };
  },

  async _saveAllOCR() {
    const checks = document.querySelectorAll('.ocr-check:checked');
    if (!checks.length) {
      Toast.error('저장할 항목을 선택하세요');
      return;
    }

    const saveBtn = document.getElementById('card-save-all-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }

    let saved = 0;
    let duped = 0;
    let failed = 0;
    for (const chk of checks) {
      const i = parseInt(chk.dataset.idx);
      const body = this._collectOCRForm(i);
      if (!body.name) {
        failed++;
        continue;
      }
      try {
        await API.customers.create(body);
        saved++;
      } catch (err) {
        if (err?.status === 409 || err?.duplicate) duped++;
        else failed++;
      }
    }

    Modal.close();
    const parts = [];
    if (saved) parts.push(`${saved}개 등록 완료`);
    if (duped) parts.push(`${duped}개 중복 건너뜀`);
    if (failed) parts.push(`${failed}개 오류`);
    const msg = parts.join(' · ') || '등록된 항목 없음';

    if (saved) Toast.success(msg);
    else if (duped) Toast.warn(`중복 방지: ${msg}`);
    else Toast.error(msg);

    await this.loadData();
    await App.refreshCommon();
  },

  // =============================================================
  // v6.0.0 Phase 2A — 라이브 카메라 연속 촬영 모드
  //
  // getUserMedia 로 카메라 스트림 → 사용자가 N장 연속 촬영 →
  // canvas 캡처 → Blob 누적 → 완료 시 일괄 OCR (기존 _runOCR 흐름 재사용)
  //
  // 호환성: HTTPS + Android Chrome 47+ / iOS Safari 11.3+
  // 폴백: getUserMedia 거부/미지원 시 → HTML5 input capture="environment"
  // =============================================================

  _openLiveCaptureModal() {
    // 상태 초기화
    this._liveCam.blobs = [];
    this._liveCam.urls.forEach(u => URL.revokeObjectURL(u));
    this._liveCam.urls = [];
    this._liveCam.busy = false;

    Modal.open({
      title: '명함 촬영',
      width: 680,
      confirmOnClose: false, // 촬영 중 dirty 컨펌 불필요
      body: `
        <div id="lc-wrap" style="display:flex;flex-direction:column;gap:12px">
          <!-- 카메라 미리보기 -->
          <div id="lc-stage" style="position:relative;background:#0d0d0d;border-radius:8px;
                                    overflow:hidden;aspect-ratio:4/3;max-height:55vh">
            <video id="lc-video" autoplay playsinline muted
                   style="width:100%;height:100%;object-fit:cover;background:#000"></video>
            <!-- 명함 가이드 프레임 -->
            <div style="position:absolute;inset:8%;border:2px dashed rgba(255,255,255,0.55);
                        border-radius:8px;pointer-events:none"></div>
            <!-- 우상단 카운터 -->
            <div id="lc-counter" style="position:absolute;top:10px;right:10px;
                                        background:rgba(0,0,0,0.7);color:#fff;padding:6px 12px;
                                        border-radius:20px;font-size:12px;font-weight:600">
              0 / ${this._liveCam.MAX}
            </div>
            <!-- 권한 거부/오류 안내 -->
            <div id="lc-error" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.82);
                                      color:#fff;padding:24px;display:flex;flex-direction:column;
                                      justify-content:center;align-items:center;text-align:center;
                                      gap:12px;font-size:13px;line-height:1.5"></div>
          </div>

          <!-- 셔터 버튼 (큰 탭 영역) -->
          <button id="lc-shutter" type="button"
                  style="display:flex;align-items:center;justify-content:center;gap:8px;
                         padding:18px;background:var(--oci-red);color:#fff;border:none;
                         border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;
                         transition:transform .08s,opacity .15s">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span>촬영하기</span>
          </button>

          <!-- 누적 썸네일 그리드 -->
          <div id="lc-thumbs" style="display:none;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));
                                     gap:6px;max-height:140px;overflow-y:auto;
                                     padding:8px;background:var(--surface-2);border-radius:6px"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="lc-fallback-btn" title="권한 거부 / 카메라 미지원 시">
          파일에서 선택
        </button>
        <button class="btn btn-ghost" id="lc-close-btn">취소</button>
        <button class="btn btn-primary" id="lc-done-btn" disabled>
          완료 (AI 인식)
        </button>
      `,
      bind: {
        '#lc-shutter': () => this._captureOne(),
        '#lc-fallback-btn': () => this._fallbackToFileInput(),
        '#lc-close-btn': () => Modal.close(),
        '#lc-done-btn': () => this._finishLiveCap(),
      },
    });

    // 모달 닫힘 감시 (× 버튼 / overlay / Esc) → 카메라 스트림 정리
    this._watchModalCloseForCam();
    // 다음 tick 에 카메라 시작 (DOM 마운트 후)
    setTimeout(() => this._startLiveCam(), 50);
  },

  async _startLiveCam() {
    const errEl = document.getElementById('lc-error');
    const stageEl = document.getElementById('lc-stage');
    const shutter = document.getElementById('lc-shutter');

    // getUserMedia 지원 여부 사전 검사
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._showCamError('이 브라우저는 카메라 API 를 지원하지 않습니다.', true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // 후면 카메라 우선
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      this._liveCam.stream = stream;
      const video = document.getElementById('lc-video');
      if (video) {
        video.srcObject = stream;
        // 일부 모바일 브라우저는 user gesture 가 있어야 play() 성공 — 안전하게 catch
        video.play().catch(e => console.warn('[LiveCam] video.play 경고:', e?.message));
      }
      if (errEl) errEl.style.display = 'none';
      if (stageEl) stageEl.style.display = '';
      if (shutter) shutter.style.opacity = '1';
    } catch (err) {
      console.warn('[LiveCam] getUserMedia 실패:', err?.name, err?.message);
      const isPerm = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      this._showCamError(
        isPerm
          ? '카메라 권한이 거부되었습니다.\n브라우저 설정에서 카메라 권한을 허용해주세요.'
          : '카메라를 시작할 수 없습니다.\n파일에서 선택을 사용하세요.',
        true
      );
    }
  },

  _showCamError(msg, showFallbackCta = false) {
    const errEl = document.getElementById('lc-error');
    const shutter = document.getElementById('lc-shutter');
    if (errEl) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `
        <div style="color:rgba(255,255,255,0.7)"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/><path d="m2 2 20 20"/></svg></div>
        <div style="white-space:pre-line">${esc(msg)}</div>
        ${
          showFallbackCta
            ? '<button class="btn btn-primary btn-sm" id="lc-fallback-inline">파일에서 선택</button>'
            : ''
        }
      `;
      const fb = document.getElementById('lc-fallback-inline');
      if (fb) fb.addEventListener('click', () => this._fallbackToFileInput());
    }
    if (shutter) {
      shutter.disabled = true;
      shutter.style.opacity = '0.5';
    }
  },

  _captureOne() {
    if (this._liveCam.busy) return;
    if (this._liveCam.blobs.length >= this._liveCam.MAX) {
      Toast.warn(`최대 ${this._liveCam.MAX}장까지만 촬영 가능합니다`);
      return;
    }
    const video = document.getElementById('lc-video');
    if (!video || !video.videoWidth) {
      Toast.warn('카메라가 아직 준비되지 않았습니다');
      return;
    }

    this._liveCam.busy = true;
    const shutter = document.getElementById('lc-shutter');
    if (shutter) {
      shutter.style.transform = 'scale(0.96)';
      setTimeout(() => {
        shutter.style.transform = '';
      }, 100);
    }

    // canvas 캡처
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      blob => {
        if (!blob) {
          Toast.error('이미지 캡처 실패');
          this._liveCam.busy = false;
          return;
        }
        this._liveCam.blobs.push(blob);
        const url = URL.createObjectURL(blob);
        this._liveCam.urls.push(url);
        this._renderLiveCapThumbs();
        this._updateLiveCapUI();
        this._liveCam.busy = false;
      },
      'image/jpeg',
      0.85
    );
  },

  _renderLiveCapThumbs() {
    const wrap = document.getElementById('lc-thumbs');
    if (!wrap) return;
    if (!this._liveCam.urls.length) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    wrap.style.display = 'grid';
    wrap.innerHTML = this._liveCam.urls
      .map(
        (url, i) => `
        <div style="position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;border:1px solid var(--border)">
          <img src="${url}" style="width:100%;height:100%;object-fit:cover" alt="capture ${i + 1}">
          <button type="button" class="lc-remove-btn" data-idx="${i}"
                  style="position:absolute;top:2px;right:2px;width:20px;height:20px;
                         background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;
                         font-size:13px;line-height:1;cursor:pointer;padding:0">×</button>
          <div style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,0.7);color:#fff;
                      font-size:10px;padding:1px 5px;border-radius:8px">${i + 1}</div>
        </div>`
      )
      .join('');
    // 삭제 버튼 바인딩
    wrap.querySelectorAll('.lc-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        this._removeLiveCap(idx);
      });
    });
  },

  _removeLiveCap(idx) {
    if (idx < 0 || idx >= this._liveCam.blobs.length) return;
    URL.revokeObjectURL(this._liveCam.urls[idx]);
    this._liveCam.blobs.splice(idx, 1);
    this._liveCam.urls.splice(idx, 1);
    this._renderLiveCapThumbs();
    this._updateLiveCapUI();
  },

  _updateLiveCapUI() {
    const n = this._liveCam.blobs.length;
    const counter = document.getElementById('lc-counter');
    if (counter) counter.textContent = `${n} / ${this._liveCam.MAX}`;
    const done = document.getElementById('lc-done-btn');
    if (done) {
      done.disabled = n === 0;
      done.textContent = n > 0 ? `완료 (${n}장 AI 인식)` : '완료 (AI 인식)';
    }
  },

  _stopLiveCam() {
    if (this._liveCam.stream) {
      this._liveCam.stream.getTracks().forEach(t => {
        try {
          t.stop();
        } catch (_) {
          /* ignore */
        }
      });
      this._liveCam.stream = null;
    }
    if (this._liveCam.observer) {
      try {
        this._liveCam.observer.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._liveCam.observer = null;
    }
    // ObjectURL 정리
    this._liveCam.urls.forEach(u => {
      try {
        URL.revokeObjectURL(u);
      } catch (_) {
        /* ignore */
      }
    });
    this._liveCam.urls = [];
    this._liveCam.blobs = [];
    this._liveCam.busy = false;
  },

  // 모달이 어떤 경로로 닫히든 (× / overlay / Esc) → 카메라 스트림 정리
  _watchModalCloseForCam() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    if (this._liveCam.observer) {
      this._liveCam.observer.disconnect();
    }
    this._liveCam.observer = new MutationObserver(() => {
      if (!overlay.classList.contains('active')) {
        this._stopLiveCam();
      }
    });
    this._liveCam.observer.observe(overlay, {
      attributes: true,
      attributeFilter: ['class'],
    });
  },

  _finishLiveCap() {
    if (!this._liveCam.blobs.length) {
      Toast.warn('촬영된 명함이 없습니다');
      return;
    }
    // Blob[] → File[] 변환 (filename 부여) — 기존 _runOCR 흐름 재사용
    const ts = Date.now();
    this._ocrFiles = this._liveCam.blobs.map(
      (blob, i) => new File([blob], `card_${ts}_${i + 1}.jpg`, { type: 'image/jpeg' })
    );
    // 카메라 정리 → 기존 OCR 결과 모달로 전환
    this._stopLiveCam();
    Modal.close();
    // 결과 표시용 모달 다시 열기 (직접입력 탭 없이 OCR 결과 위주)
    this._openOcrResultsModal();
  },

  // 라이브 캡처 → OCR 실행 → 결과 편집 모달
  _openOcrResultsModal() {
    Modal.open({
      title: '명함 AI 인식 결과',
      width: 720,
      confirmOnClose: true,
      body: `
        <div id="card-ocr-results" style="min-height:140px">
          <div class="loading" style="padding:30px;text-align:center;color:var(--text-3)">
            ${this._ocrFiles.length}장의 명함을 AI 가 분석 중입니다...
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="lc-result-cancel">취소</button>
        <button class="btn btn-primary" id="card-save-all-btn" style="display:none">
          전체 저장
        </button>
      `,
      bind: {
        '#lc-result-cancel': () => Modal.close(),
        '#card-save-all-btn': () => this._saveAllOCR(),
      },
    });
    // 즉시 OCR 시작
    setTimeout(() => this._runOCR(), 30);
  },

  // getUserMedia 실패/거부 시 폴백 — HTML5 input capture
  _fallbackToFileInput() {
    this._stopLiveCam();
    Modal.close();
    // 기존 OCR 탭 모달 열기 (capture 속성 포함)
    this.openRegisterModal('ocr');
    // capture 속성 동적 추가 + 자동 클릭
    setTimeout(() => {
      const input = document.getElementById('card-file-input');
      if (input) {
        input.setAttribute('capture', 'environment');
        try {
          input.click();
        } catch (e) {
          console.warn('[LiveCam fallback] input.click 실패:', e?.message);
        }
      }
    }, 200);
  },
};
