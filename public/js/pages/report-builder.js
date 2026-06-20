'use strict';
// =============================================================
// 리포트 빌더 (Phase 1 MVP) — public/js/pages/report-builder.js
//
// 기능:
//   - 좌측 필드 카탈로그 (차원 / 지표) — HTML5 native drag&drop
//   - 4 drop zones: Row(행) / Column(열) / Filter / Measure(지표)
//   - 자동 차트 추천 (Bar / Pie / Line / Stacked Bar)
//   - 본인 리포트 저장 / 조회 / 수정 / 삭제
//
// 데이터 소스: leads 단일 (Phase 1)
// 권한: team_lead(level 2) 이상만 — RBAC 미들웨어에서 처리
// =============================================================

const ReportBuilderPage = {
  // ─── 상태 ──────────────────────────────────────────────
  _state: {
    fields: null, // 서버에서 fetch 한 필드 카탈로그
    config: {
      datasource: 'leads',
      rows: [],
      columns: [],
      filters: [],
      measures: [],
      chartType: 'auto',
    },
    savedReports: [], // 본인 저장 리포트 목록
    currentId: null, // 현재 편집 중인 저장 리포트 ID
    chart: null, // Chart.js 인스턴스
    queryResult: null, // 마지막 쿼리 결과
    // Phase 2-A: 사이드바 패널 상태
    savedPanelOpen: false, // 우측 저장 리포트 패널 열림 여부
    savedSearchQuery: '', // 검색어 (이름/설명 필터)
    _searchDebounce: null, // 검색 디바운스 타이머
    // 차트 다중 measure 버그 fix: pie/stacked-bar 시 어떤 지표를 차트에 표시할지
    chartMeasureIndex: 0, // 0 = 첫 번째 measure (기본값)
    // 차트 정규화 버그 fix: 단위 다른 measure 들을 0~100% 비율로 환산하여 비교 가능
    chartNormalize: false,
    // 필터 값 캐시: 'datasource.field' → string[] (distinct 값) / null (pending) / undefined (미사용)
    valueCache: {},
  },

  // ─── 진입점 ────────────────────────────────────────────
  async render() {
    const root = document.getElementById('content');
    if (!root) return;

    root.innerHTML = this._html();

    try {
      // 필드 카탈로그 + 저장 리포트 목록 병렬 fetch
      const [fieldsRes, savedRes] = await Promise.all([
        API.reportBuilder.fields(),
        API.reportBuilder.listSaved().catch(() => ({ data: [] })),
      ]);
      this._state.fields = fieldsRes.data;
      this._state.savedReports = savedRes.data || [];
      this._renderFieldsPanel();
      this._renderSavedList();
      this._updateSavedCountBadge();
      this._bindEvents();
      // Phase 2-A: 저장된 리포트 있으면 자동 펼침 (사용자 결정)
      if (this._state.savedReports.length > 0) {
        this._toggleSavedPanel(true);
      }
      // ★ Reports 페이지에서 ?edit=<id> 로 진입 시 해당 리포트 자동 불러오기
      const editMatch = (location.hash || '').match(/[?&]edit=(\d+)/);
      if (editMatch) {
        const editId = parseInt(editMatch[1], 10);
        if (editId) {
          await this._loadSavedById(editId);
          // 자동 펼침
          if (!this._state.savedPanelOpen) this._toggleSavedPanel(true);
          return;
        }
      }

      // 초기 미리보기 — 기본 차원 1개 + count
      this._state.config.rows = ['stage'];
      this._state.config.measures = ['count'];
      this._renderDropZones();
      await this._runQuery();
    } catch (err) {
      Toast.error('필드 카탈로그 로드 실패: ' + (err.message || ''));
    }
  },

  // ─── 레이아웃 HTML ────────────────────────────────────
  _html() {
    return `
      <div class="rb-container">
        <!-- 상단 툴바 -->
        <div class="rb-toolbar">
          <div class="rb-toolbar-left">
            <h2 style="margin:0;font-size:18px;font-weight:600">📊 리포트 빌더</h2>
            <span class="rb-hint">필드를 드래그하여 영역에 놓으세요</span>
          </div>
          <div class="rb-toolbar-right">
            <button class="btn btn-ghost btn-sm" id="rb-load-btn" title="저장된 리포트 목록 토글">📂 내 리포트 <span id="rb-saved-count-badge" style="display:none"></span></button>
            <!-- ⤓ 내보내기 드롭다운 — Excel / PDF -->
            <div class="rb-export-wrap" style="position:relative;display:inline-block">
              <button class="btn btn-ghost btn-sm" id="rb-export-btn" title="현재 리포트를 파일로 내보내기">⤓ 내보내기 ▾</button>
              <div class="rb-export-menu" id="rb-export-menu" style="display:none;position:absolute;top:calc(100% + 4px);right:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:1100;min-width:160px;overflow:hidden">
                <button class="rb-export-item" data-export-format="xlsx" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13px;color:var(--text-1);text-align:left">📊 Excel (.xlsx)</button>
                <button class="rb-export-item" data-export-format="pdf" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13px;color:var(--text-1);text-align:left;border-top:1px solid var(--border)">📄 PDF (차트 + 표)</button>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" id="rb-reset-btn">🔄 초기화</button>
            <button class="btn btn-primary btn-sm" id="rb-save-btn">💾 저장</button>
          </div>
        </div>

        <!-- 본문 (Phase 2-A: 저장 패널 토글 가능 — rb-body--with-panel 클래스로 4-컬럼 grid) -->
        <div class="rb-body" id="rb-body">
          <!-- 좌측: 필드 카탈로그 -->
          <aside class="rb-sidebar" id="rb-fields-panel">
            <div class="rb-loading">필드 로딩 중...</div>
          </aside>

          <!-- 중앙: drop zones -->
          <main class="rb-main">
            <div class="rb-dropzones">
              <div class="rb-zone" data-zone="rows">
                <div class="rb-zone-title">📋 행 (Row)</div>
                <div class="rb-zone-body" id="rb-zone-rows"></div>
                <div class="rb-zone-hint">차원을 드래그 (1개)</div>
              </div>
              <div class="rb-zone" data-zone="columns">
                <div class="rb-zone-title">📊 열 (Column)</div>
                <div class="rb-zone-body" id="rb-zone-columns"></div>
                <div class="rb-zone-hint">차원을 드래그 (선택, 1개)</div>
              </div>
              <div class="rb-zone" data-zone="filters">
                <div class="rb-zone-title">🔍 필터 (Filter)</div>
                <div class="rb-zone-body" id="rb-zone-filters"></div>
                <div class="rb-zone-hint">차원을 드래그 (여러 개)</div>
              </div>
              <div class="rb-zone" data-zone="measures">
                <div class="rb-zone-title">📈 지표 (Measure)</div>
                <div class="rb-zone-body" id="rb-zone-measures"></div>
                <div class="rb-zone-hint">지표를 드래그 (최대 3개)</div>
              </div>
            </div>

            <!-- 차트 미리보기 -->
            <div class="rb-preview">
              <div class="rb-preview-header">
                <h3 style="margin:0;font-size:14px;font-weight:600">📉 미리보기</h3>
                <select id="rb-chart-type" class="form-input" style="width:auto;font-size:12px">
                  <option value="auto">🪄 자동</option>
                  <option value="bar">막대 (Bar)</option>
                  <option value="pie">원형 (Pie)</option>
                  <option value="line">선형 (Line)</option>
                  <option value="stacked-bar">누적 막대 (Stacked Bar)</option>
                </select>
                <!-- 다중 measure + pie/stacked-bar 차트 시 어떤 지표를 차트에 표시할지 선택 -->
                <select id="rb-measure-select" class="form-input" style="display:none;width:auto;font-size:12px" title="차트에 표시할 지표 선택"></select>
                <!-- 다중 measure + bar/line 시 단위 차이로 인한 시각화 문제 해결: 정규화 토글 (0~100%) -->
                <label id="rb-normalize-wrap" style="display:none;align-items:center;gap:4px;font-size:11px;color:var(--text-2);cursor:pointer" title="각 지표를 최대값 기준 0~100% 로 정규화 — 단위가 다른 지표 시각 비교에 유용">
                  <input type="checkbox" id="rb-normalize-toggle" style="cursor:pointer">
                  <span>정규화 (0~100%)</span>
                </label>
              </div>
              <div class="rb-chart-wrapper">
                <canvas id="rb-chart"></canvas>
              </div>
              <div id="rb-data-table" class="rb-data-table"></div>
            </div>
          </main>

          <!-- Phase 2-A: 저장된 리포트 사이드 패널 (토글 가능) -->
          <aside class="rb-saved-panel" id="rb-saved-panel" style="display:none">
            <div class="rb-saved-header">
              <div class="rb-saved-title">📂 내 리포트 <span class="rb-saved-count" id="rb-saved-count"></span></div>
              <button class="rb-saved-close" id="rb-saved-close" title="패널 닫기" aria-label="패널 닫기">×</button>
            </div>
            <div class="rb-saved-search">
              <input type="text" id="rb-saved-search-input" placeholder="🔍 이름/설명 검색..." autocomplete="off" />
            </div>
            <div class="rb-saved-list" id="rb-saved-list"></div>
          </aside>
        </div>
      </div>
    `;
  },

  // ─── 좌측 필드 패널 렌더 ──────────────────────────────
  _renderFieldsPanel() {
    const panel = document.getElementById('rb-fields-panel');
    if (!panel || !this._state.fields) return;

    const { dimensions, measures, datasources } = this._state.fields;
    const currentDs = this._state.config.datasource || 'leads';

    // Phase 2-B-1: 데이터 소스 드롭다운 (선택 가능)
    const dsOptions = (datasources || [{ key: 'leads', label: '영업 리드' }])
      .map(
        d =>
          `<option value="${esc(d.key)}" ${d.key === currentDs ? 'selected' : ''}>${esc(d.label)}</option>`
      )
      .join('');

    panel.innerHTML = `
      <div class="rb-section">
        <div class="rb-section-title">📁 데이터 소스</div>
        <select class="form-input rb-datasource-select" id="rb-datasource-select" style="width:100%;font-size:12px;padding:6px 8px">
          ${dsOptions}
        </select>
      </div>
      <div class="rb-section">
        <div class="rb-section-title">📐 차원 (Dimensions)</div>
        ${dimensions
          .map(
            d => `
          <div class="rb-field rb-field-dim" draggable="true" data-field-key="${esc(d.key)}" data-field-type="dimension">
            <span class="rb-field-icon">${d.dataType === 'date' ? '📅' : '🏷'}</span>
            <span class="rb-field-label">${esc(d.label)}</span>
          </div>
        `
          )
          .join('')}
      </div>
      <div class="rb-section">
        <div class="rb-section-title">📊 지표 (Measures)</div>
        ${measures
          .map(
            m => `
          <div class="rb-field rb-field-measure" draggable="true" data-field-key="${esc(m.key)}" data-field-type="measure">
            <span class="rb-field-icon">🔢</span>
            <span class="rb-field-label">${esc(m.label)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    // Phase 2-B-1: 데이터 소스 변경 핸들러
    const dsSelect = document.getElementById('rb-datasource-select');
    if (dsSelect) {
      dsSelect.onchange = () => this._onDatasourceChange(dsSelect.value);
    }

    // 드래그 시작
    panel.querySelectorAll('.rb-field').forEach(el => {
      el.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(
          'text/plain',
          JSON.stringify({
            key: el.dataset.fieldKey,
            type: el.dataset.fieldType,
          })
        );
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
  },

  // ─── Phase 2-B-1: 데이터 소스 변경 ──────────────────────
  // 다른 데이터 소스는 차원/지표 키가 호환 안 됨 → config 초기화
  // 편집 중인 저장 리포트도 해제 (다른 datasource 로 저장하려면 새 리포트)
  async _onDatasourceChange(newDs) {
    if (!newDs || newDs === this._state.config.datasource) return;
    try {
      // 차원/지표 카탈로그 새로 fetch
      const r = await API.reportBuilder.fields(newDs);
      this._state.fields = r.data;
      this._state.config = {
        datasource: newDs,
        rows: [],
        columns: [],
        filters: [],
        measures: [],
        chartType: 'auto',
      };
      this._state.currentId = null; // 다른 datasource — 다른 리포트로 취급
      this._state.valueCache = {}; // 다른 datasource — 필터 값 캐시 무효화
      const ctype = document.getElementById('rb-chart-type');
      if (ctype) ctype.value = 'auto';
      this._renderFieldsPanel();
      this._renderDropZones();
      this._clearChart();
      const tbl = document.getElementById('rb-data-table');
      if (tbl) tbl.innerHTML = '';
      this._renderSavedList(); // active 표시 해제
      Toast.success(
        `데이터 소스를 "${this._state.fields.datasources.find(d => d.key === newDs)?.label || newDs}" 로 변경`
      );
    } catch (err) {
      Toast.error('데이터 소스 전환 실패: ' + (err.message || ''));
    }
  },

  // ─── 드롭존 렌더 ───────────────────────────────────────
  _renderDropZones() {
    const fieldsMap = this._fieldsByKey();
    const cfg = this._state.config;

    // Row
    document.getElementById('rb-zone-rows').innerHTML = cfg.rows
      .map(k => this._chipHtml(k, fieldsMap[k], 'rows'))
      .join('');
    document.getElementById('rb-zone-columns').innerHTML = cfg.columns
      .map(k => this._chipHtml(k, fieldsMap[k], 'columns'))
      .join('');
    document.getElementById('rb-zone-measures').innerHTML = cfg.measures
      .map(k => this._chipHtml(k, fieldsMap[k], 'measures'))
      .join('');

    // Filter — 차원 필터: 단순 값 선택 (연산자 제거, op='eq' 자동 고정)
    // 사용자 의도: 기호 연산자 (=, ≠, >, < 등) 불필요. 실제 차원 값을 드롭다운으로 선택만.
    // Combobox 활용 — 클릭 즉시 dropdown 표시 + 자유 입력도 허용
    document.getElementById('rb-zone-filters').innerHTML = cfg.filters
      .map((f, idx) => {
        const fld = fieldsMap[f.field];
        if (!fld) return '';
        return `
        <div class="rb-chip rb-chip-filter" data-zone="filters" data-idx="${idx}">
          <span class="rb-chip-label">${esc(fld.label)} =</span>
          <input class="rb-chip-value" data-idx="${idx}" data-field="${esc(f.field)}" type="text"
                 value="${esc(f.value || '')}" placeholder="🔽 클릭하여 값 선택" autocomplete="off" />
          <button class="rb-chip-remove" data-zone="filters" data-idx="${idx}" title="제거">✕</button>
        </div>
      `;
      })
      .join('');

    // 각 필터 input 에 Combobox 부착 — 클릭 즉시 드롭다운 + 자유 입력 허용
    if (typeof Combobox !== 'undefined') {
      if (!this._state.valueCache) this._state.valueCache = {};
      cfg.filters.forEach((f, idx) => {
        const input = document.querySelector(`.rb-chip-value[data-idx="${idx}"]`);
        if (!input) return;
        const dsKey = this._state.config.datasource || 'leads';
        const cacheKey = `${dsKey}.${f.field}`;
        Combobox.attach({
          inputEl: input,
          // minChars:0 → 클릭만으로 (또는 빈 입력) 드롭다운 표시
          minChars: 0,
          debounceMs: 100,
          allowCustom: true,
          customLabel: '+ "X" 그대로 사용 (자유 입력)',
          fetchFn: async q => {
            // 캐시 활용 — 첫 호출만 백엔드 fetch, 이후는 클라이언트 필터링
            let values = this._state.valueCache[cacheKey];
            if (!Array.isArray(values)) {
              try {
                const r = await API.reportBuilder.values(dsKey, f.field, 500);
                values = r.data || [];
                this._state.valueCache[cacheKey] = values;
              } catch (_) {
                values = [];
                this._state.valueCache[cacheKey] = values;
              }
            }
            const ql = String(q || '').toLowerCase();
            return values.filter(v => !ql || String(v).toLowerCase().includes(ql)).slice(0, 50); // 너무 많으면 자르기
          },
          renderItem: (item, q, { highlightMatch }) => `
            <div class="combobox-item-content">
              <div class="combobox-item-title">${highlightMatch(String(item), q)}</div>
            </div>
          `,
          onSelect: item => {
            const val = String(item);
            input.value = val;
            this._state.config.filters[idx].value = val;
            this._runQuery();
          },
          onCustomCreate: query => {
            input.value = query;
            this._state.config.filters[idx].value = query;
            this._runQuery();
          },
        });
      });
    }

    // 칩 제거 이벤트
    document.querySelectorAll('.rb-chip-remove').forEach(btn => {
      btn.onclick = () => this._removeField(btn.dataset.zone, parseInt(btn.dataset.idx));
    });

    // 필터 변경 이벤트
    document.querySelectorAll('.rb-chip-op').forEach(sel => {
      sel.onchange = () => {
        const idx = parseInt(sel.dataset.idx);
        this._state.config.filters[idx].op = sel.value;
        this._runQuery();
      };
    });
    document.querySelectorAll('.rb-chip-value').forEach(inp => {
      let debTimer = null;
      inp.oninput = () => {
        const idx = parseInt(inp.dataset.idx);
        this._state.config.filters[idx].value = inp.value;
        clearTimeout(debTimer);
        debTimer = setTimeout(() => this._runQuery(), 500);
      };
    });
  },

  _chipHtml(key, fld, zone) {
    if (!fld) return '';
    const idx = this._state.config[zone].indexOf(key);
    return `
      <div class="rb-chip rb-chip-${zone}">
        <span class="rb-chip-label">${esc(fld.label)}</span>
        <button class="rb-chip-remove" data-zone="${zone}" data-idx="${idx}" title="제거">✕</button>
      </div>
    `;
  },

  _opLabel(op) {
    return { eq: '=', ne: '≠', like: '포함', gt: '>', lt: '<', gte: '≥', lte: '≤' }[op] || op;
  },

  // ─── 필드 맵 (key → meta) ─────────────────────────────
  _fieldsByKey() {
    if (!this._state.fields) return {};
    const map = {};
    this._state.fields.dimensions.forEach(d => {
      map[d.key] = { ...d, type: 'dimension' };
    });
    this._state.fields.measures.forEach(m => {
      map[m.key] = { ...m, type: 'measure' };
    });
    return map;
  },

  // ─── 이벤트 바인딩 ─────────────────────────────────────
  _bindEvents() {
    // 4개 drop zone
    ['rows', 'columns', 'filters', 'measures'].forEach(zone => {
      const el = document.querySelector(`.rb-zone[data-zone="${zone}"]`);
      if (!el) return;
      el.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.classList.add('drag-over');
      };
      el.ondragleave = () => el.classList.remove('drag-over');
      el.ondrop = e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        try {
          const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
          this._handleDrop(zone, payload);
        } catch (_) {
          /* invalid payload */
        }
      };
    });

    // 차트 타입 변경
    document.getElementById('rb-chart-type').onchange = e => {
      this._state.config.chartType = e.target.value;
      this._runQuery();
    };

    // 툴바
    document.getElementById('rb-save-btn').onclick = () => this._openSaveModal();
    // Phase 2-A: 모달 → 사이드바 패널 토글로 변경
    document.getElementById('rb-load-btn').onclick = () => this._toggleSavedPanel();
    document.getElementById('rb-reset-btn').onclick = () => this._reset();

    // ⤓ 내보내기 드롭다운 (Excel / PDF)
    const exportBtn = document.getElementById('rb-export-btn');
    const exportMenu = document.getElementById('rb-export-menu');
    if (exportBtn && exportMenu) {
      exportBtn.onclick = e => {
        e.stopPropagation();
        exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
      };
      exportMenu.querySelectorAll('.rb-export-item').forEach(item => {
        item.onclick = e => {
          e.stopPropagation();
          exportMenu.style.display = 'none';
          const format = item.dataset.exportFormat;
          if (format === 'pdf') this._exportPdf();
          else this._exportData(format);
        };
      });
      // 바깥 클릭 시 닫기
      document.addEventListener('click', () => {
        exportMenu.style.display = 'none';
      });
    }

    // Phase 2-A: 사이드바 닫기 버튼
    document
      .getElementById('rb-saved-close')
      ?.addEventListener('click', () => this._toggleSavedPanel(false));

    // Phase 2-A: 검색 디바운스
    const searchInput = document.getElementById('rb-saved-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        clearTimeout(this._state._searchDebounce);
        this._state._searchDebounce = setTimeout(() => {
          this._state.savedSearchQuery = e.target.value;
          this._renderSavedList();
        }, 200);
      });
    }
  },

  // ─── 드롭 처리 ─────────────────────────────────────────
  _handleDrop(zone, payload) {
    const cfg = this._state.config;
    const { key, type } = payload;

    // 타입 매칭 검증
    if (zone === 'measures' && type !== 'measure') {
      Toast.warn('지표 영역에는 측정값만 놓을 수 있습니다');
      return;
    }
    if (zone !== 'measures' && type !== 'dimension') {
      Toast.warn('이 영역에는 차원만 놓을 수 있습니다');
      return;
    }

    if (zone === 'rows') {
      cfg.rows = [key]; // 1개만
    } else if (zone === 'columns') {
      cfg.columns = [key]; // 1개만
    } else if (zone === 'measures') {
      if (cfg.measures.includes(key)) return;
      if (cfg.measures.length >= 3) {
        Toast.warn('지표는 최대 3개까지 추가할 수 있습니다');
        return;
      }
      cfg.measures.push(key);
    } else if (zone === 'filters') {
      // 동일 필드 중복 방지
      if (cfg.filters.find(f => f.field === key)) {
        Toast.warn('이미 추가된 필터입니다');
        return;
      }
      cfg.filters.push({ field: key, op: 'eq', value: '' });
    }

    this._renderDropZones();
    this._runQuery();
  },

  _removeField(zone, idx) {
    const cfg = this._state.config;
    if (zone === 'rows' || zone === 'columns') {
      cfg[zone] = [];
    } else if (zone === 'measures') {
      cfg.measures.splice(idx, 1);
    } else if (zone === 'filters') {
      cfg.filters.splice(idx, 1);
    }
    this._renderDropZones();
    this._runQuery();
  },

  // ─── 쿼리 실행 ─────────────────────────────────────────
  async _runQuery() {
    const cfg = this._state.config;
    // 빈 필터(value 없음) 제외
    const queryConfig = {
      ...cfg,
      filters: cfg.filters.filter(f => f.value !== '' && f.value !== null),
    };

    if (queryConfig.rows.length === 0 && queryConfig.measures.length === 0) {
      this._clearChart();
      document.getElementById('rb-data-table').innerHTML =
        '<div class="rb-empty">행(Row) 또는 지표(Measure)를 추가하세요</div>';
      return;
    }

    try {
      const r = await API.reportBuilder.query(queryConfig);
      this._state.queryResult = r.data;
      this._renderChart(r.data);
      this._renderDataTable(r.data);
    } catch (err) {
      Toast.error('쿼리 실패: ' + (err.message || ''));
      this._clearChart();
    }
  },

  // ─── 차트 렌더링 ───────────────────────────────────────
  _renderChart(result) {
    const canvas = document.getElementById('rb-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (this._state.chart) {
      this._state.chart.destroy();
      this._state.chart = null;
    }

    const { rows, config } = result;
    if (!rows || rows.length === 0) {
      document.getElementById('rb-data-table').innerHTML =
        '<div class="rb-empty">조회된 데이터가 없습니다</div>';
      return;
    }

    const chartType = config.chartType;
    const fieldsMap = this._fieldsByKey();
    const measureKeys = config.measures;
    const colKey = config.columns[0];

    // 다중 measure 시 사용자가 선택한 인덱스 (pie/stacked-bar 차트에 사용)
    // 범위 보정: measures 변경으로 인덱스가 초과된 경우 0 으로 리셋
    if (this._state.chartMeasureIndex >= measureKeys.length) {
      this._state.chartMeasureIndex = 0;
    }
    const selectedMIdx = Math.max(
      0,
      Math.min(this._state.chartMeasureIndex, measureKeys.length - 1)
    );
    const selectedM = measureKeys[selectedMIdx];

    // 측정값 선택 드롭다운 갱신 — pie/stacked-bar + 다중 measure 일 때만 표시
    this._updateMeasureSelector(chartType, measureKeys, fieldsMap);

    // ── chart.js 설정 ─────────────────────────────────
    const colors = [
      '#E63329',
      '#1A73E8',
      '#34A853',
      '#FBBC04',
      '#9C27B0',
      '#FF6B35',
      '#00BCD4',
      '#8BC34A',
      '#FF5722',
      '#673AB7',
    ];

    let chartConfig;

    if (chartType === 'pie') {
      // Pie: rows = labels, 선택된 measure = values (multi-measure 시 사용자 선택)
      const labels = rows.map(r => String(r.row_key || '(없음)'));
      const data = rows.map(r => Number(r[selectedM] || 0));
      chartConfig = {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            { label: fieldsMap[selectedM]?.label || selectedM, data, backgroundColor: colors },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: this._customLegend('right') },
        },
      };
    } else if (chartType === 'line') {
      const labels = rows.map(r => String(r.row_key || ''));
      // 다축/정규화 적용 (multi-measure 단위 차이 해결)
      const { datasets: lineDs, scales: lineScales } = this._buildMultiMeasureDatasets(
        measureKeys,
        fieldsMap,
        rows,
        colors,
        'line'
      );
      chartConfig = {
        type: 'line',
        data: { labels, datasets: lineDs },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: this._customLegend('top'),
            tooltip: this._chartInteractionAndTooltip().tooltip,
          },
          interaction: this._chartInteractionAndTooltip().interaction,
          scales: lineScales,
        },
      };
    } else if (chartType === 'stacked-bar' && colKey) {
      // pivot: row_key → 행, col_key → 스택, 선택된 measure (multi-measure 시 사용자 선택)
      const rowKeys = [...new Set(rows.map(r => String(r.row_key)))];
      const colKeys = [...new Set(rows.map(r => String(r.col_key)))];
      const m = selectedM;
      const pivot = {};
      for (const rk of rowKeys) pivot[rk] = {};
      for (const r of rows) pivot[String(r.row_key)][String(r.col_key)] = Number(r[m] || 0);
      chartConfig = {
        type: 'bar',
        data: {
          labels: rowKeys,
          datasets: colKeys.map((ck, i) => ({
            label: ck,
            data: rowKeys.map(rk => pivot[rk][ck] || 0),
            backgroundColor: colors[i % colors.length],
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: this._customLegend('top'),
            tooltip: this._chartInteractionAndTooltip().tooltip,
          },
          interaction: this._chartInteractionAndTooltip().interaction,
          scales: { x: { stacked: true }, y: { stacked: true } },
        },
      };
    } else {
      // bar (default) — 다축/정규화 적용 (multi-measure 단위 차이 해결)
      const labels = rows.map(r => String(r.row_key || ''));
      const { datasets: barDs, scales: barScales } = this._buildMultiMeasureDatasets(
        measureKeys,
        fieldsMap,
        rows,
        colors,
        'bar'
      );
      chartConfig = {
        type: 'bar',
        data: { labels, datasets: barDs },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: this._customLegend('top'),
            tooltip: this._chartInteractionAndTooltip().tooltip,
          },
          interaction: this._chartInteractionAndTooltip().interaction,
          scales: barScales,
        },
      };
    }

    // 정규화 토글 표시 여부 갱신 (bar/line + measures ≥ 2 일 때만)
    this._updateNormalizeToggle(chartType, measureKeys);

    this._state.chart = new Chart(ctx, chartConfig);
  },

  // 다축 자동 분리 + 정규화 (bar/line 차트 공통)
  // - measures 1개: 단일 축 (y)
  // - measures 2개: y(좌, m0) + y1(우, m1) 분리
  // - measures 3+개: y(좌, m0) + y1(우, m1, m2...) — 나머지는 우측 그룹화
  // - 정규화 ON: 모든 measure 를 max 값 기준 0~100% 환산 → 단일 y 축 사용
  _buildMultiMeasureDatasets(measureKeys, fieldsMap, rows, colors, chartKind) {
    const normalize = this._state.chartNormalize === true;
    const isLine = chartKind === 'line';

    // 정규화: 각 measure 의 max 값으로 데이터 환산 (0~100 범위)
    // 원본 값(_originalValues)을 dataset 에 보존 → tooltip 에서 "실제값" 함께 표시
    if (normalize && measureKeys.length > 0) {
      const datasets = measureKeys.map((m, i) => {
        const vals = rows.map(r => Number(r[m] || 0));
        const max = Math.max(...vals, 0) || 1;
        const data = vals.map(v => (v / max) * 100);
        const base = {
          label: `${fieldsMap[m]?.label || m} (정규화)`,
          data,
          _originalValues: vals, // tooltip 에서 "실제값: ..." 표시용
        };
        return isLine
          ? {
              ...base,
              borderColor: colors[i],
              backgroundColor: colors[i] + '33',
              tension: 0.3,
              pointRadius: 4,
              pointHoverRadius: 7,
              borderWidth: 2,
            }
          : { ...base, backgroundColor: colors[i] };
      });
      return {
        datasets,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: v => v + '%' },
            title: { display: true, text: '정규화 (%)' },
          },
        },
      };
    }

    // 다축 자동 분리 (measures ≥ 2 일 때만)
    const useMultiAxis = measureKeys.length >= 2;
    const datasets = measureKeys.map((m, i) => {
      const data = rows.map(r => Number(r[m] || 0));
      const yAxisID = useMultiAxis && i >= 1 ? 'y1' : 'y';
      const base = {
        label: fieldsMap[m]?.label || m,
        data,
        yAxisID,
      };
      return isLine
        ? {
            ...base,
            borderColor: colors[i],
            backgroundColor: colors[i] + '33',
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 7,
            borderWidth: 2,
          }
        : { ...base, backgroundColor: colors[i] };
    });

    const scales = {
      y: {
        type: 'linear',
        position: 'left',
        title: useMultiAxis
          ? { display: true, text: fieldsMap[measureKeys[0]]?.label || measureKeys[0] }
          : { display: false },
      },
    };
    if (useMultiAxis) {
      scales.y1 = {
        type: 'linear',
        position: 'right',
        grid: { drawOnChartArea: false }, // 우측 grid 안 그림 (시각적 혼란 방지)
        title: {
          display: true,
          text: measureKeys
            .slice(1)
            .map(m => fieldsMap[m]?.label || m)
            .join(' / '),
        },
      };
    }
    return { datasets, scales };
  },

  // ─── 범례 음영 처리 (취소선 → 회색 음영) ───────────────────
  // Chart.js 기본 동작: 범례 클릭 → 시리즈 hide + 라벨에 취소선
  // 사용자 요청: 취소선 대신 회색 음영으로 활성/비활성 시각 구분
  // 적용 방식: generateLabels 에서 hidden=false 강제 + fillStyle 회색화
  //           onClick 은 기본 토글 동작 유지 (커스텀 generateLabels 만 변경)
  _customLegend(position = 'top') {
    return {
      position,
      labels: {
        usePointStyle: false,
        generateLabels: function (chart) {
          // Chart.js 기본 generateLabels 호출 → 그 결과 가공
          const defaults = chart.legend.options.labels;
          const defaultGen = Chart.defaults.plugins.legend.labels.generateLabels;
          const original = defaultGen.call(defaults, chart);
          return original.map(item => {
            const meta = chart.getDatasetMeta(item.datasetIndex);
            const isHidden = meta.hidden === true;
            return {
              ...item,
              hidden: false, // ← 취소선 안 그리도록 강제
              fillStyle: isHidden ? '#cccccc' : item.fillStyle,
              strokeStyle: isHidden ? '#bbbbbb' : item.strokeStyle,
              // 라벨 텍스트는 그대로 — 색상만 회색으로 변경하여 음영 표현
              fontColor: isHidden ? '#9ca3af' : undefined,
            };
          });
        },
      },
      onClick: function (e, legendItem, legend) {
        // 토글 동작 (Chart.js 표준 방식 유지)
        const idx = legendItem.datasetIndex;
        const ci = legend.chart;
        const meta = ci.getDatasetMeta(idx);
        meta.hidden = meta.hidden === null ? !ci.data.datasets[idx].hidden : !meta.hidden;
        ci.update();
      },
    };
  },

  // ─── 차트 tooltip + interaction 헬퍼 ────────────────────────
  // hover 영역 확대 + 천단위 콤마 + 정규화 시 원본 값 함께 표시
  // bar/line 공통 사용 (pie/stacked-bar 는 단일 measure 라 기본 동작으로 충분)
  _chartInteractionAndTooltip() {
    return {
      interaction: {
        // 'index' = x축 위치 기준 모든 시리즈를 한 번에 표시 (사용자 친화적)
        // intersect:false = 도트 정확히 hit 안 해도 가까이 가면 tooltip 표시
        mode: 'index',
        intersect: false,
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        callbacks: {
          // 값 포맷: ko-KR 천단위 콤마 + 정규화 시 원본 값 부가 표시
          label: function (context) {
            const ds = context.dataset;
            const idx = context.dataIndex;
            const label = ds.label || '';
            const value = context.parsed.y;
            if (value === null || value === undefined) return label;
            // 정규화 모드: % 표시 + 원본 값 (캐시된 _originalValues) 함께
            if (ds._originalValues && Array.isArray(ds._originalValues)) {
              const orig = ds._originalValues[idx];
              const origFmt =
                typeof orig === 'number'
                  ? orig.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
                  : orig;
              return `${label}: ${value.toFixed(1)}% (실제값: ${origFmt})`;
            }
            // 일반 모드: 천단위 콤마
            const fmt =
              typeof value === 'number'
                ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
                : value;
            return `${label}: ${fmt}`;
          },
        },
      },
    };
  },

  // 정규화 토글 표시/숨김 (bar/line + measures ≥ 2 일 때만)
  _updateNormalizeToggle(chartType, measureKeys) {
    const wrap = document.getElementById('rb-normalize-wrap');
    const cb = document.getElementById('rb-normalize-toggle');
    if (!wrap || !cb) return;
    const eligible = (chartType === 'bar' || chartType === 'line') && measureKeys.length >= 2;
    wrap.style.display = eligible ? 'inline-flex' : 'none';
    // 이벤트 매번 재할당 (idempotent)
    cb.checked = this._state.chartNormalize === true;
    cb.onchange = () => {
      this._state.chartNormalize = cb.checked;
      if (this._state.queryResult) this._renderChart(this._state.queryResult);
    };
  },

  _clearChart() {
    if (this._state.chart) {
      this._state.chart.destroy();
      this._state.chart = null;
    }
  },

  // 차트 다중 measure 버그 fix: pie/stacked-bar + measures ≥ 2 시만 드롭다운 표시
  // bar/line 은 이미 datasets 가 measures 별로 자동 생성됨 → 드롭다운 불필요
  _updateMeasureSelector(chartType, measureKeys, fieldsMap) {
    const sel = document.getElementById('rb-measure-select');
    if (!sel) return;
    const needsSelector =
      (chartType === 'pie' || chartType === 'stacked-bar') && measureKeys.length >= 2;
    if (!needsSelector) {
      sel.style.display = 'none';
      return;
    }
    // 옵션 갱신 (현재 selectedIdx 보존)
    const currentIdx = this._state.chartMeasureIndex;
    sel.innerHTML = measureKeys
      .map(
        (m, i) =>
          `<option value="${i}" ${i === currentIdx ? 'selected' : ''}>📐 ${esc(fieldsMap[m]?.label || m)}</option>`
      )
      .join('');
    sel.style.display = '';
    // 이벤트 (매번 onchange 재할당으로 idempotent — 동일 select 에 누적 안 됨)
    sel.onchange = () => {
      this._state.chartMeasureIndex = parseInt(sel.value, 10) || 0;
      if (this._state.queryResult) this._renderChart(this._state.queryResult);
    };
  },

  // ─── 데이터 테이블 (차트 하단) ─────────────────────────
  _renderDataTable(result) {
    const el = document.getElementById('rb-data-table');
    if (!el) return;
    const { rows } = result;
    if (!rows || rows.length === 0) {
      el.innerHTML = '<div class="rb-empty">데이터 없음</div>';
      return;
    }
    const columns = Object.keys(rows[0]);
    el.innerHTML = `
      <details class="rb-table-details">
        <summary>📋 데이터 테이블 (${rows.length}건)</summary>
        <table class="data-table" style="margin-top:8px">
          <thead>
            <tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows
              .slice(0, 50)
              .map(
                r => `
              <tr>${columns.map(c => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        ${rows.length > 50 ? `<div style="padding:8px;color:var(--text-3);font-size:11px">...총 ${rows.length}건 중 50건 표시</div>` : ''}
      </details>
    `;
  },

  // ─── 저장 모달 ────────────────────────────────────────
  // 🛡 안전 우선 설계: 편집 중인 리포트가 있어도 기본값은 "새 리포트로 저장"
  //    사용자가 명시적으로 라디오 변경 시만 update (덮어쓰기)
  //    → 무심코 [저장] 클릭해서 기존 리포트 덮어쓰는 사고 방지
  _openSaveModal() {
    const cfg = this._state.config;
    if (cfg.rows.length === 0 && cfg.measures.length === 0) {
      Toast.warn('저장할 내용이 없습니다 — 행 또는 지표를 추가하세요');
      return;
    }
    const hasCurrent = !!this._state.currentId;
    const currentName = hasCurrent
      ? this._state.savedReports.find(r => r.id === this._state.currentId)?.name || '현재 리포트'
      : '';

    // 모드 선택 라디오 (편집 중인 리포트 있을 때만 표시)
    const modeSelector = hasCurrent
      ? `
      <div class="rb-save-mode" style="grid-column:1 / -1;padding:10px 12px;background:var(--surface-2);border-radius:6px;font-size:12px">
        <div style="margin-bottom:6px;color:var(--text-2)">
          ⓘ 현재 편집 중: <strong>"${esc(currentName)}"</strong>
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0">
          <input type="radio" name="rb-save-mode" value="new" checked />
          <span>새 리포트로 저장 <span style="color:var(--text-3)">(기본, 안전)</span></span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0">
          <input type="radio" name="rb-save-mode" value="update" />
          <span>"${esc(currentName)}" 수정 <span style="color:var(--oci-red)">(덮어쓰기)</span></span>
        </label>
      </div>
    `
      : '';

    Modal.open({
      title: '💾 리포트 저장',
      width: 480,
      body: `
        <div class="form-grid" style="grid-template-columns:90px 1fr;gap:10px 12px;align-items:center">
          ${modeSelector}
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="rb-save-name" maxlength="150" placeholder="예: 단계별 수주액 추이" />
          <label class="form-label">설명</label>
          <textarea class="form-input" id="rb-save-desc" maxlength="500" rows="2" placeholder="(선택)"></textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="rb-save-cancel">취소</button>
        <button class="btn btn-primary" id="rb-save-ok">저장</button>
      `,
      bind: {
        '#rb-save-cancel': () => Modal.close(),
        '#rb-save-ok': async () => {
          const name = document.getElementById('rb-save-name').value.trim();
          const description = document.getElementById('rb-save-desc').value.trim();
          if (!name) {
            Toast.warn('이름을 입력하세요');
            return;
          }

          // 라디오에서 'update' 선택 시만 덮어쓰기 (없으면 기본 'new')
          const modeEl = document.querySelector('input[name="rb-save-mode"]:checked');
          const isUpdate = hasCurrent && modeEl && modeEl.value === 'update';

          try {
            const data = { name, description, config_json: this._state.config };
            let savedId;
            if (isUpdate) {
              await API.reportBuilder.update(this._state.currentId, data);
              savedId = this._state.currentId;
              Toast.success(`"${name}" 수정되었습니다`);
            } else {
              const r = await API.reportBuilder.save(data);
              this._state.currentId = r.data.id;
              savedId = r.data.id;
              Toast.success(`"${name}" 새 리포트로 저장되었습니다`);
            }
            Modal.close();
            await this._refreshSaved();
            this._renderSavedList(); // 편집중 ⭐ 표시 갱신

            // ★ returnTo=reports 흐름 — 저장 후 자동으로 리포트 페이지에 위젯으로 추가
            // hash 의 returnTo 파라미터 확인 (예: #report-builder?returnTo=reports)
            const m = (location.hash || '').match(/[?&]returnTo=([^&]+)/);
            const returnTo = m ? decodeURIComponent(m[1]) : null;
            if (returnTo === 'reports' && savedId) {
              try {
                await API.reports.widgets.add({ report_id: savedId });
                Toast.success('리포트 페이지에 위젯으로 추가되었습니다');
              } catch (_) {
                /* 이미 위젯에 있으면 silent skip */
              }
              // hash 정리 후 reports 페이지로 이동
              location.hash = '#reports';
              if (typeof App !== 'undefined' && App.navigate) App.navigate('reports');
            }
          } catch (err) {
            Toast.error('저장 실패: ' + (err.message || ''));
          }
        },
      },
      onOpen: () => {
        // 모드 변경 시 저장 버튼 라벨 업데이트 (시각적 피드백)
        if (!hasCurrent) return;
        const updateLabel = () => {
          const modeEl = document.querySelector('input[name="rb-save-mode"]:checked');
          const okBtn = document.getElementById('rb-save-ok');
          if (!okBtn || !modeEl) return;
          okBtn.textContent = modeEl.value === 'update' ? '수정 (덮어쓰기)' : '새 리포트로 저장';
        };
        document.querySelectorAll('input[name="rb-save-mode"]').forEach(r => {
          r.addEventListener('change', updateLabel);
        });
        updateLabel();
      },
    });
  },

  // ─── 불러오기 모달 ────────────────────────────────────
  _openLoadModal() {
    const rows = this._state.savedReports;
    Modal.open({
      title: '📂 내 리포트',
      width: 560,
      body:
        rows.length === 0
          ? `
        <div style="padding:30px;text-align:center;color:var(--text-3)">
          저장된 리포트가 없습니다.<br>
          좌측에서 리포트를 구성한 후 💾 저장 버튼을 눌러보세요.
        </div>
      `
          : `
        <table class="data-table">
          <thead>
            <tr>
              <th>이름</th>
              <th style="width:180px">최근 수정</th>
              <th style="width:140px;text-align:right">작업</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                r => `
              <tr>
                <td>
                  <strong>${esc(r.name)}</strong>
                  ${r.description ? `<div style="font-size:11px;color:var(--text-3)">${esc(r.description)}</div>` : ''}
                </td>
                <td style="font-size:12px;color:var(--text-2)">${new Date(r.updated_at).toLocaleString('ko-KR')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-rb-load="${r.id}">📂 불러오기</button>
                  <button class="btn btn-ghost btn-sm" data-rb-del="${r.id}" style="color:var(--oci-red)">🗑</button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `,
      footer: `<button class="btn btn-ghost" id="rb-load-close">닫기</button>`,
      bind: {
        '#rb-load-close': () => Modal.close(),
      },
    });

    // 동적 이벤트 — Modal.open 후
    setTimeout(() => {
      document.querySelectorAll('[data-rb-load]').forEach(btn => {
        btn.onclick = async () => {
          const id = parseInt(btn.dataset.rbLoad);
          try {
            const r = await API.reportBuilder.getSaved(id);
            const tpl = r.data;
            const cfg =
              typeof tpl.config_json === 'string' ? JSON.parse(tpl.config_json) : tpl.config_json;
            this._state.config = {
              datasource: cfg.datasource || 'leads',
              rows: cfg.rows || [],
              columns: cfg.columns || [],
              filters: cfg.filters || [],
              measures: cfg.measures || [],
              chartType: cfg.chartType || 'auto',
            };
            this._state.currentId = tpl.id;
            document.getElementById('rb-chart-type').value = this._state.config.chartType;
            this._renderDropZones();
            await this._runQuery();
            Modal.close();
            Toast.success(`"${tpl.name}" 불러오기 완료`);
          } catch (err) {
            Toast.error('불러오기 실패: ' + (err.message || ''));
          }
        };
      });
      document.querySelectorAll('[data-rb-del]').forEach(btn => {
        btn.onclick = async () => {
          const id = parseInt(btn.dataset.rbDel);
          if (!confirm('이 리포트를 삭제하시겠습니까?')) return;
          try {
            await API.reportBuilder.delete(id);
            Toast.success('삭제되었습니다');
            if (this._state.currentId === id) this._state.currentId = null;
            await this._refreshSaved();
            Modal.close();
            this._openLoadModal();
          } catch (err) {
            Toast.error('삭제 실패: ' + (err.message || ''));
          }
        };
      });
    }, 50);
  },

  async _refreshSaved() {
    try {
      const r = await API.reportBuilder.listSaved();
      this._state.savedReports = r.data || [];
      this._renderSavedList();
      this._updateSavedCountBadge();
    } catch (_) {
      /* ignore */
    }
  },

  // ─── Phase 2-A: 사이드바 패널 토글 ────────────────────
  _toggleSavedPanel(forceState) {
    const panel = document.getElementById('rb-saved-panel');
    const body = document.getElementById('rb-body');
    if (!panel || !body) return;
    const next = typeof forceState === 'boolean' ? forceState : !this._state.savedPanelOpen;
    this._state.savedPanelOpen = next;
    if (next) {
      panel.style.display = 'flex';
      body.classList.add('rb-body--with-panel');
    } else {
      panel.style.display = 'none';
      body.classList.remove('rb-body--with-panel');
    }
  },

  _updateSavedCountBadge() {
    const badge = document.getElementById('rb-saved-count-badge');
    const headerCount = document.getElementById('rb-saved-count');
    const n = this._state.savedReports.length;
    if (badge) {
      if (n > 0) {
        badge.style.display = '';
        badge.textContent = `(${n})`;
        badge.style.cssText =
          'display:inline;background:var(--surface-2);padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;color:var(--text-2)';
      } else {
        badge.style.display = 'none';
      }
    }
    if (headerCount) headerCount.textContent = n > 0 ? `(${n})` : '';
  },

  // ─── Phase 2-A: 사이드바 카드 렌더링 ───────────────────
  _renderSavedList() {
    const list = document.getElementById('rb-saved-list');
    if (!list) return;
    const q = (this._state.savedSearchQuery || '').toLowerCase().trim();
    const reports = q
      ? this._state.savedReports.filter(
          r =>
            (r.name || '').toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q)
        )
      : this._state.savedReports;

    if (this._state.savedReports.length === 0) {
      list.innerHTML = `
        <div class="rb-saved-empty">
          <div class="rb-saved-empty-icon">📭</div>
          <div>아직 저장된 리포트가 없습니다.</div>
          <div style="font-size:11px;margin-top:6px">상단의 <strong>💾 저장</strong> 버튼으로<br>현재 구성을 저장해보세요.</div>
        </div>
      `;
      return;
    }
    if (reports.length === 0) {
      list.innerHTML = `
        <div class="rb-saved-empty">
          <div class="rb-saved-empty-icon">🔍</div>
          <div>"${esc(q)}" 검색 결과 없음</div>
        </div>
      `;
      return;
    }

    list.innerHTML = reports.map(r => this._savedCardHtml(r)).join('');

    // 카드 이벤트 바인딩
    list.querySelectorAll('[data-rb-saved-card]').forEach(card => {
      const id = parseInt(card.dataset.rbSavedCard, 10);
      // 카드 본체 클릭 = 불러오기
      card.addEventListener('click', e => {
        if (e.target.closest('[data-rb-card-action]')) return; // 액션 버튼은 별도 처리
        this._loadSavedById(id);
      });
    });
    list.querySelectorAll('[data-rb-card-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.rbCardAction;
        if (action === 'load') this._loadSavedById(id);
        else if (action === 'rename') this._openRenameModal(id);
        else if (action === 'delete') this._deleteSavedById(id);
      });
    });
  },

  _savedCardHtml(r) {
    const isActive = this._state.currentId === r.id;
    const cfg = (() => {
      try {
        return typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json || {};
      } catch (_) {
        return {};
      }
    })();
    const fieldsMap = this._fieldsByKey();
    // Phase 2-B-1: 카드의 datasource 와 현재 data source 비교 표시
    const cardDs = cfg.datasource || 'leads';
    const cardDsLabel =
      (this._state.fields?.datasources || []).find(d => d.key === cardDs)?.label ||
      (cardDs === 'leads' ? '영업 리드' : cardDs);
    // 필드 라벨: 카드 datasource 와 현재 datasource 가 같으면 fieldsMap, 다르면 fallback (key)
    const sameDs = cardDs === (this._state.config.datasource || 'leads');
    const rowsLabel = (cfg.rows || [])
      .map(k => (sameDs ? fieldsMap[k]?.label : null) || k)
      .join(', ');
    const measLabel = (cfg.measures || [])
      .map(k => (sameDs ? fieldsMap[k]?.label : null) || k)
      .join(', ');
    const meta = [];
    if (rowsLabel) meta.push(`<span>📋 ${esc(rowsLabel)}</span>`);
    if (measLabel) meta.push(`<span>📐 ${esc(measLabel)}</span>`);

    return `
      <div class="rb-saved-card ${isActive ? 'rb-saved-card--active' : ''}" data-rb-saved-card="${r.id}" role="button" tabindex="0" title="클릭하여 불러오기">
        <div class="rb-saved-card-title">
          ${esc(r.name)}
          ${isActive ? '<span class="rb-saved-card-active-badge">편집중</span>' : ''}
        </div>
        ${r.description ? `<div class="rb-saved-card-desc">${esc(r.description)}</div>` : ''}
        <div class="rb-saved-card-ds-chip" title="데이터 소스">${this._dsIcon(cardDs)} ${esc(cardDsLabel)}</div>
        ${meta.length ? `<div class="rb-saved-card-meta">${meta.join('')}</div>` : ''}
        <div class="rb-saved-card-time">${esc(this._relativeTime(r.updated_at))}</div>
        <div class="rb-saved-card-actions">
          <button data-rb-card-action="load" data-id="${r.id}" title="불러오기">📂 열기</button>
          <button data-rb-card-action="rename" data-id="${r.id}" title="이름/설명 변경">✏️</button>
          <button class="rb-del-btn" data-rb-card-action="delete" data-id="${r.id}" title="삭제">🗑</button>
        </div>
      </div>
    `;
  },

  _relativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '방금 전';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}일 전`;
    return d.toLocaleDateString('ko-KR');
  },

  // Phase 2-B-3: 데이터 소스별 아이콘 매핑 (확장 가능)
  _dsIcon(dsKey) {
    const ICONS = { leads: '📋', projects: '🏗', customers: '🏢', activities: '📌', support: '🎫' };
    return ICONS[dsKey] || '📊';
  },

  // ─── Phase 2-A: 카드 액션 — 불러오기/삭제/이름변경 ─────
  async _loadSavedById(id) {
    try {
      const r = await API.reportBuilder.getSaved(id);
      const tpl = r.data;
      const cfg =
        typeof tpl.config_json === 'string' ? JSON.parse(tpl.config_json) : tpl.config_json;
      const targetDs = cfg.datasource || 'leads';

      // Phase 2-B-1: 다른 데이터 소스 리포트면 fields 카탈로그 먼저 재로드
      if (targetDs !== (this._state.config.datasource || 'leads')) {
        const fr = await API.reportBuilder.fields(targetDs);
        this._state.fields = fr.data;
        this._renderFieldsPanel(); // 좌측 패널 갱신 (드롭다운 + 필드 목록)
      }

      this._state.config = {
        datasource: targetDs,
        rows: cfg.rows || [],
        columns: cfg.columns || [],
        filters: cfg.filters || [],
        measures: cfg.measures || [],
        chartType: cfg.chartType || 'auto',
      };
      this._state.currentId = tpl.id;
      const ctype = document.getElementById('rb-chart-type');
      if (ctype) ctype.value = this._state.config.chartType;
      this._renderDropZones();
      await this._runQuery();
      this._renderSavedList(); // active 표시 갱신
      Toast.success(`"${tpl.name}" 불러오기 완료`);
    } catch (err) {
      Toast.error('불러오기 실패: ' + (err.message || ''));
    }
  },

  async _deleteSavedById(id) {
    const r = this._state.savedReports.find(x => x.id === id);
    if (!confirm(`"${r?.name || '리포트'}" 을(를) 삭제하시겠습니까?`)) return;
    try {
      await API.reportBuilder.delete(id);
      if (this._state.currentId === id) this._state.currentId = null;
      Toast.success('삭제되었습니다');
      await this._refreshSaved();
    } catch (err) {
      Toast.error('삭제 실패: ' + (err.message || ''));
    }
  },

  _openRenameModal(id) {
    const r = this._state.savedReports.find(x => x.id === id);
    if (!r) return;
    Modal.open({
      title: '✏️ 리포트 이름 변경',
      width: 440,
      body: `
        <div class="form-grid" style="grid-template-columns:90px 1fr;gap:10px 12px;align-items:center">
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="rb-rename-name" maxlength="150" value="${esc(r.name || '')}" />
          <label class="form-label">설명</label>
          <textarea class="form-input" id="rb-rename-desc" maxlength="500" rows="2">${esc(r.description || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="rb-rename-cancel">취소</button>
        <button class="btn btn-primary" id="rb-rename-ok">저장</button>
      `,
      bind: {
        '#rb-rename-cancel': () => Modal.close(),
        '#rb-rename-ok': async () => {
          const name = document.getElementById('rb-rename-name').value.trim();
          const description = document.getElementById('rb-rename-desc').value.trim();
          if (!name) {
            Toast.warn('이름을 입력하세요');
            return;
          }
          try {
            // config_json 그대로 보내야 백엔드가 보존 — listSaved 응답에 config_json 포함
            const cfgJson =
              typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json || {};
            await API.reportBuilder.update(id, { name, description, config_json: cfgJson });
            Toast.success('이름이 변경되었습니다');
            Modal.close();
            await this._refreshSaved();
          } catch (err) {
            Toast.error('저장 실패: ' + (err.message || ''));
          }
        },
      },
    });
  },

  // ─── 초기화 ───────────────────────────────────────────
  _reset() {
    if (!confirm('현재 구성을 초기화하시겠습니까?')) return;
    this._state.config = {
      datasource: 'leads',
      rows: [],
      columns: [],
      filters: [],
      measures: [],
      chartType: 'auto',
    };
    this._state.currentId = null;
    document.getElementById('rb-chart-type').value = 'auto';
    this._renderDropZones();
    this._clearChart();
    document.getElementById('rb-data-table').innerHTML = '';
  },

  // ─── 내보내기: Excel ────────────────────────────────────
  // POST /report-builder/export?format=xlsx → blob 다운로드 (API 클라이언트가 처리)
  async _exportData(format) {
    const cfg = this._state.config;
    if (cfg.rows.length === 0 && cfg.measures.length === 0) {
      Toast.warn('내보낼 내용이 없습니다 — 행 또는 지표를 추가하세요');
      return;
    }
    try {
      // 파일명 — 편집 중인 저장 리포트 이름 또는 기본
      const savedName = this._state.savedReports.find(r => r.id === this._state.currentId)?.name;
      const name = savedName || `report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
      Toast.info?.(`${format.toUpperCase()} 다운로드 시작...`);
      const r = await API.reportBuilder.export(cfg, format, name);
      Toast.success(`"${r.filename}" 다운로드 완료`);
    } catch (err) {
      Toast.error('내보내기 실패: ' + (err.message || ''));
    }
  },

  // ─── 내보내기: PDF (html2canvas + jspdf) ────────────────
  // 🐛 한국어 깨짐 fix: jsPDF 기본 폰트는 latin-1 만 지원 → html2canvas 로 DOM 캡처
  // 임시 DOM 에 한국어 헤더/차트/테이블/푸터를 그려놓고 통째로 이미지화 → PDF 삽입
  // → 한국어 글꼴 깨짐 0건 보장 (이미지화되므로)
  async _exportPdf() {
    const cfg = this._state.config;
    if (cfg.rows.length === 0 && cfg.measures.length === 0) {
      Toast.warn('내보낼 내용이 없습니다 — 행 또는 지표를 추가하세요');
      return;
    }
    if (!this._state.queryResult || !this._state.chart) {
      Toast.warn('먼저 차트가 표시된 상태여야 합니다');
      return;
    }
    const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDFCtor || typeof window.html2canvas !== 'function') {
      Toast.error('PDF 라이브러리가 로드되지 않았습니다. 페이지 새로고침 후 다시 시도하세요.');
      return;
    }

    let tempDiv = null;
    try {
      Toast.info?.('PDF 생성 중...');

      // ── 메타 정보 ─────────────────────────────────────
      const savedName = this._state.savedReports.find(r => r.id === this._state.currentId)?.name;
      const reportName = savedName || `리포트 ${new Date().toLocaleDateString('ko-KR')}`;
      const dsLabel =
        (this._state.fields?.datasources || []).find(d => d.key === cfg.datasource)?.label ||
        cfg.datasource;
      const generatedAt = new Date().toLocaleString('ko-KR');
      const fieldsMap = this._fieldsByKey();
      const { rows: data } = this._state.queryResult;

      // ── 차트 이미지 (Chart.js → Base64 PNG) ──────────────
      const chartImg = this._state.chart.toBase64Image();

      // ── 테이블 HTML 생성 ─────────────────────────────────
      const tableHeaders = [];
      if (cfg.rows[0]) tableHeaders.push(fieldsMap[cfg.rows[0]]?.label || cfg.rows[0]);
      if (cfg.columns[0]) tableHeaders.push(fieldsMap[cfg.columns[0]]?.label || cfg.columns[0]);
      cfg.measures.forEach(m => tableHeaders.push(fieldsMap[m]?.label || m));

      const tableRows = data.slice(0, 30).map(r => {
        const row = [];
        if (cfg.rows[0]) row.push(String(r.row_key ?? ''));
        if (cfg.columns[0]) row.push(String(r.col_key ?? ''));
        cfg.measures.forEach(m => {
          const v = Number(r[m] || 0);
          row.push(v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
        });
        return row;
      });

      // ── 임시 DOM 생성 (화면 밖에 그려서 html2canvas 캡처) ─
      // 🐛 한국어/영어 혼합 텍스트 겹침 fix:
      //   - 단일 한국어 폰트 사용 (영어도 자동 처리) → fallback 전환 시 너비 측정 오류 방지
      //   - letter-spacing 0 + word-spacing 0.08em 명시 → 공백 흡수 방지
      //   - 공백을 \u00A0 (NBSP) 로 일부 치환 → html2canvas 공백 collapse 회피
      //   - text-rendering: geometricPrecision → 글자 측정 정확도 ↑
      const _esc = s => esc(String(s));
      // 공백 보존을 위해 일부 텍스트의 공백을 NBSP 로 치환
      const _preserveSpaces = s => _esc(s).replace(/ /g, '\u00A0');
      tempDiv = document.createElement('div');
      tempDiv.style.cssText = `
        position: fixed;
        left: -10000px;
        top: 0;
        width: 1100px;
        padding: 30px 40px;
        background: #ffffff;
        color: #1f2937;
        font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
        font-size: 13px;
        line-height: 1.6;
        letter-spacing: 0;
        word-spacing: 0.08em;
        text-rendering: geometricPrecision;
        box-sizing: border-box;
      `;
      tempDiv.innerHTML = `
        <div style="border-bottom:2px solid #E63329;padding-bottom:12px;margin-bottom:18px">
          <h1 style="margin:0 0 6px;color:#E63329;font-size:22px;font-weight:700;letter-spacing:0;word-spacing:0.1em;white-space:nowrap">
            ${_preserveSpaces('SK ecoplant materials 리포트')}\u00A0—\u00A0${_preserveSpaces(reportName)}
          </h1>
          <div style="font-size:12px;color:#666;letter-spacing:0;word-spacing:0.06em">
            ${_preserveSpaces('데이터 소스:')}\u00A0<strong>${_preserveSpaces(dsLabel)}</strong>
            \u00A0\u00A0|\u00A0\u00A0 ${_preserveSpaces('생성:')}\u00A0${_preserveSpaces(generatedAt)}
            \u00A0\u00A0|\u00A0\u00A0 ${_preserveSpaces('데이터 건수:')}\u00A0<strong>${data.length}${_preserveSpaces('건')}</strong>
          </div>
        </div>
        <div style="text-align:center;margin-bottom:20px">
          <img src="${chartImg}" style="max-width:100%;max-height:400px;display:inline-block" alt="차트" />
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:#E63329;color:#ffffff">
              ${tableHeaders.map(h => `<th style="padding:8px 10px;text-align:center;font-weight:600;border:1px solid #c52a23;letter-spacing:0">${_preserveSpaces(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${tableRows
              .map(
                (row, i) => `
              <tr style="background:${i % 2 ? '#f9fafb' : '#ffffff'}">
                ${row.map(cell => `<td style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb;letter-spacing:0">${_preserveSpaces(cell)}</td>`).join('')}
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        ${
          data.length > 30
            ? `
          <div style="font-size:10px;color:#888;margin-top:8px;text-align:right;letter-spacing:0">
            ${_preserveSpaces(`…총 ${data.length}건 중 30건 표시 (전체 데이터는 Excel 로 내보내기)`)}
          </div>
        `
            : ''
        }
        <div style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;text-align:center;letter-spacing:0;word-spacing:0.05em">
          ${_preserveSpaces('SK ecoplant materials Report Builder')}\u00A0·\u00A0${_preserveSpaces(generatedAt)}
        </div>
      `;
      document.body.appendChild(tempDiv);

      // 폰트 로드 + 레이아웃 안정화 대기
      await new Promise(r => setTimeout(r, 100));
      // 브라우저가 폰트 로드 완료 신호 보낼 때까지 (현대 브라우저 지원)
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      // ── html2canvas 캡처 (글자 정밀 렌더링 옵션) ─────────
      const canvas = await window.html2canvas(tempDiv, {
        scale: 2, // 고해상도 (Retina)
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        letterRendering: true, // 🐛 fix: 글자별 렌더링 → 한국어/영어 혼합 공백 보존
        allowTaint: false,
        windowWidth: 1100, // 명시적 viewport width
      });
      const imgData = canvas.toDataURL('image/png');

      // ── PDF 생성 + 이미지 삽입 ───────────────────────────
      // A4 가로: 297 x 210mm — 캡처 이미지 가로/세로 비율에 맞춰 자동 조정
      const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth(); // 297
      const pageHeight = doc.internal.pageSize.getHeight(); // 210
      const margin = 10;
      const maxImgWidth = pageWidth - margin * 2; // 277
      const maxImgHeight = pageHeight - margin * 2; // 190

      // 이미지 원본 비율 유지하면서 최대 영역에 맞춤
      const imgRatio = canvas.width / canvas.height;
      let imgW = maxImgWidth;
      let imgH = imgW / imgRatio;
      if (imgH > maxImgHeight) {
        imgH = maxImgHeight;
        imgW = imgH * imgRatio;
      }
      const x = (pageWidth - imgW) / 2;
      const y = margin;
      doc.addImage(imgData, 'PNG', x, y, imgW, imgH);

      const filename = `${reportName.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
      doc.save(filename);
      Toast.success(`"${filename}" 다운로드 완료`);
    } catch (err) {
      Toast.error('PDF 생성 실패: ' + (err.message || ''));
      console.error('[PDF Export]', err);
    } finally {
      // 임시 DOM 정리 (메모리 누수 방지)
      if (tempDiv && tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
    }
  },
};

window.ReportBuilderPage = ReportBuilderPage;
