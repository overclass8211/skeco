// ============================================================
// ContractsPage — 계약 모듈 (v6.0.0 슬림화)
// 데이터: /api/contracts  (헤더 + 파일 + history + AI 법무 검토)
//
// 핵심 기능:
//   1. 계약 아카이빙 — CRUD + 히스토리 (4단계 상태)
//   2. 연결: 고객사 / 영업리드 / 견적 / 제안 (선택적)
//   3. 첨부 파일 업로드/다운로드/삭제
//   4. AI 법무 검토 (Gemini 2.5 Pro · 한국법 특화)
//   5. (예정) 전자서명 — 모두싸인 OAuth
// ============================================================
const ContractsPage = (() => {
  let _list = [];
  const _filters = { search: '', status: '', contract_type: '' };
  // v6.0.0: 뷰 모드 (목록/카드) — localStorage 동기화
  let _view = localStorage.getItem('contracts_view') || 'list';

  // ── 상태 메타 (4단계) ──────────────────────────────────────
  const STATUS_LABELS = {
    draft: '초안',
    review: '검토',
    approved: '승인',
    completed: '계약완료',
  };
  const STATUS_COLORS = {
    draft: '#6b7280',
    review: '#3b82f6',
    approved: '#16a34a',
    completed: '#0891b2',
  };
  // v6.0.0 Phase C: 진척률 바 단계 순서 (0=초안 → 3=계약완료)
  const STATUS_ORDER = ['draft', 'review', 'approved', 'completed'];

  // CLM 빠른 액션 (4단계 + 수정 액션)
  // { to, label, kind } — kind: primary/ghost/danger
  const QUICK_ACTIONS = {
    draft: [
      { to: 'review', label: '📋 검토 요청', kind: 'primary' },
      { to: 'completed', label: '✕ 종료', kind: 'danger' },
    ],
    review: [
      { to: 'approved', label: '✅ 승인', kind: 'primary' },
      { to: 'draft', label: '✏ 수정 요청', kind: 'ghost' },
      { to: 'completed', label: '✕ 종료', kind: 'danger' },
    ],
    approved: [
      { to: 'completed', label: '🤝 계약 완료', kind: 'primary' },
      { to: 'review', label: '⬅ 재검토', kind: 'ghost' },
    ],
    completed: [], // 종착점
  };

  const CONTRACT_TYPE_LABELS = {
    NDA: 'NDA (비밀유지)',
    MSA: 'MSA (기본거래)',
    SLA: 'SLA (서비스수준)',
    SOW: 'SOW (작업기술서)',
    service: '용역계약',
    purchase: '구매계약',
    license: '라이선스',
    employment: '고용계약',
    etc: '기타',
  };

  // ── 유틸 ──────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function _fmtKRW(n) {
    const v = Number(n);
    if (!v) return '-';
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }
  function _fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function _fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function _toInputDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function _statusBadge(status) {
    const label = STATUS_LABELS[status] || status || '-';
    const color = STATUS_COLORS[status] || '#6b7280';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${color};color:#fff">${esc(label)}</span>`;
  }

  // ── 페이지 진입점 ─────────────────────────────────────────
  async function render() {
    const container = document.getElementById('content');
    if (!container) {
      console.error('[ContractsPage] #content 컨테이너를 찾을 수 없습니다');
      return;
    }
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="margin:0;font-size:20px">📜 계약 관리</h1>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">계약 아카이빙 + 4단계 상태 + 연결 추적 + AI 법무 검토</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <!-- v6.0.0: 5개 모듈 통일 뷰 토글 -->
          ${ViewToggle.render({ currentView: _view })}
          <button class="btn btn-primary" id="ct-new-btn">+ 새 계약</button>
        </div>
      </div>

      <!-- v6.0.0 Phase C: KPI 대시보드 카드 (만료 임박 + 상태별) -->
      <div id="ct-kpi-wrap" style="margin-bottom:14px"></div>

      <!-- 필터 -->
      <div class="filter-bar" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <input class="form-input" id="ct-search" placeholder="🔎 계약번호/제목/고객사 검색"
          style="flex:1;min-width:240px" value="${esc(_filters.search)}">
        <select class="form-input" id="ct-filter-status" style="width:140px">
          <option value="">전체 상태</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${_filters.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <select class="form-input" id="ct-filter-type" style="width:160px">
          <option value="">전체 유형</option>
          ${Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${_filters.contract_type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="ct-refresh-btn">새로고침</button>
      </div>

      <div id="ct-list-wrap"></div>
    `;

    _bindHeaderEvents();
    // KPI 와 목록 병렬 로딩 (KPI 실패해도 목록은 보여줌)
    _refreshKpi();
    await _refreshList();
  }

  // v6.0.0 Phase C: KPI 카드 fetch + 렌더
  async function _refreshKpi() {
    const wrap = document.getElementById('ct-kpi-wrap');
    if (!wrap) return;
    try {
      const res = await API.contracts.dashboard();
      const d = res?.data || {};
      _renderKpiCards(wrap, d);
    } catch (e) {
      console.warn('[contracts] dashboard fetch failed:', e?.message);
      wrap.innerHTML = '';
    }
  }

  // v6.0.0: 5개 모듈 통일 KpiBar 컴포넌트로 마이그레이션
  function _renderKpiCards(wrap, d) {
    if (typeof KpiBar === 'undefined') {
      wrap.innerHTML = ''; // 안전 fallback
      return;
    }
    const by = d.by_status || {};
    const expiring30 = d.expiring_30 || 0;
    const overdue = d.overdue || 0;
    const setStatusFilter = status => {
      _filters.status = status;
      const sel = document.getElementById('ct-filter-status');
      if (sel) sel.value = status;
      _refreshList();
    };
    KpiBar.render({
      containerSel: wrap,
      cards: [
        {
          icon: overdue > 0 ? '⛔' : '🔥',
          label: overdue > 0 ? '만료 경과' : '만료 임박',
          value: overdue > 0 ? overdue : expiring30,
          sub: overdue > 0 ? '계약 갱신/종료 필요' : '30일 이내 (승인 단계)',
          color: overdue > 0 ? '#dc2626' : '#f59e0b',
          onClick: () => setStatusFilter('approved'),
        },
        {
          icon: '📋',
          label: '검토중',
          value: by.review || 0,
          sub: '법무/내부 검토 단계',
          color: '#3b82f6',
          onClick: () => setStatusFilter('review'),
        },
        {
          icon: '✅',
          label: '진행중',
          value: by.approved || 0,
          sub: '승인 완료 + 발효',
          color: '#16a34a',
          onClick: () => setStatusFilter('approved'),
        },
        {
          icon: '✏️',
          label: '초안',
          value: by.draft || 0,
          sub: '작성중',
          color: '#6b7280',
          onClick: () => setStatusFilter('draft'),
        },
      ],
    });
  }

  // v6.0.0: StageProgress 컴포넌트로 마이그레이션 (5개 모듈 통일)
  // + D-N 일수 표시 (approved 단계 + end_date 있을 때만)
  function _renderProgressBar(status, endDate) {
    // 4단계 정의 (StageProgress 형식)
    const stages = STATUS_ORDER.map(s => ({
      key: s,
      label: STATUS_LABELS[s],
      color: STATUS_COLORS[s],
    }));
    const barHtml =
      typeof StageProgress !== 'undefined'
        ? StageProgress.render({ stages, current: status, size: 'sm' })
        : '';

    // D-N 일수 계산 (approved 단계 + end_date 있을 때만)
    let dayInfo = '';
    if (status === 'approved' && endDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      const diffMs = end.getTime() - today.getTime();
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      let dColor, dLabel;
      if (days < 0) {
        dColor = '#dc2626';
        dLabel = `⛔ ${Math.abs(days)}일 경과`;
      } else if (days <= 30) {
        dColor = '#f59e0b';
        dLabel = `🔥 D-${days}`;
      } else if (days <= 90) {
        dColor = '#0891b2';
        dLabel = `D-${days}`;
      } else {
        dColor = '#6b7280';
        dLabel = `D-${days}`;
      }
      dayInfo = `<div style="font-size:9px;color:${dColor};font-weight:600;margin-top:2px;text-align:center">${dLabel}</div>`;
    }

    return `<div style="display:flex;flex-direction:column;align-items:center;gap:0">${barHtml}${dayInfo}</div>`;
  }

  function _bindHeaderEvents() {
    document.getElementById('ct-new-btn').addEventListener('click', () => _openNewModeChooser());
    document.getElementById('ct-refresh-btn').addEventListener('click', () => _refreshList());

    // v6.0.0: ViewToggle 바인딩 (목록/카드 전환)
    if (typeof ViewToggle !== 'undefined') {
      const toggleEl = document.querySelector('#content .view-toggle');
      if (toggleEl) {
        ViewToggle.bind(
          toggleEl,
          view => {
            _view = view;
            _refreshList(); // 데이터 재렌더
          },
          'contracts_view'
        );
      }
    }

    const searchInput = document.getElementById('ct-search');
    let debounceTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      const val = e.target.value;
      debounceTimer = setTimeout(() => {
        _filters.search = val;
        _refreshList();
      }, 300);
    });
    document.getElementById('ct-filter-status').addEventListener('change', e => {
      _filters.status = e.target.value;
      _refreshList();
    });
    document.getElementById('ct-filter-type').addEventListener('change', e => {
      _filters.contract_type = e.target.value;
      _refreshList();
    });
  }

  // ── 목록 fetch + 렌더 ─────────────────────────────────────
  async function _refreshList() {
    const wrap = document.getElementById('ct-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3)">⏳ 불러오는 중...</div>`;
    try {
      const params = {};
      if (_filters.search) params.search = _filters.search;
      if (_filters.status) params.status = _filters.status;
      if (_filters.contract_type) params.contract_type = _filters.contract_type;
      params.limit = 100;
      const res = await API.contracts.list(params);
      _list = res?.data || [];
      _renderList(wrap);
      // v6.0.0 Phase C: KPI 도 동기화 (CRUD 후 자동 갱신용 — best-effort)
      _refreshKpi();
    } catch (err) {
      wrap.innerHTML = `<div class="error-message" style="padding:20px;color:#d93025">목록 조회 실패: ${esc(err.message || err)}</div>`;
    }
  }

  function _renderList(wrap) {
    if (!_list.length) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:8px;border:1px dashed var(--border)">
        등록된 계약이 없습니다 — 우상단 <strong>[+ 새 계약]</strong> 으로 시작하세요
      </div>`;
      return;
    }
    // v6.0.0: 카드뷰 분기
    if (_view === 'card') {
      return _renderCardList(wrap);
    }
    wrap.innerHTML = `
      <div class="ct-table-scroll">
      <table class="data-table ct-list-table" style="cursor:pointer">
        <thead><tr>
          <th style="width:120px">계약번호</th>
          <th style="width:80px">유형</th>
          <th style="min-width:240px;width:300px">계약명</th>
          <th style="width:140px">고객사</th>
          <th style="width:110px">시작일</th>
          <th style="width:110px">종료일</th>
          <th style="width:130px;text-align:right">금액</th>
          <th style="width:160px">진척 · 상태</th>
          <th style="width:60px;text-align:center">파일</th>
          <th style="width:100px;text-align:center">작업</th>
        </tr></thead>
        <tbody>
          ${_list.map(c => {
            const linkCount =
              (c.customer_id ? 1 : 0) +
              (c.lead_id ? 1 : 0) +
              (c.proposal_id ? 1 : 0) +
              (c.quote_id ? 1 : 0);
            const linkBadge = linkCount > 0
              ? `<span style="display:inline-block;font-size:9px;padding:1px 5px;background:#dbeafe;color:#1e40af;border-radius:8px;margin-left:4px" title="연결: 고객/리드/제안/견적 ${linkCount}건">🔗${linkCount}</span>`
              : '';
            // v6.0.0 Phase A3: 거래처 계약번호가 있으면 보조 정보로 작게 표시
            const extNoBadge = c.external_contract_no
              ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px" title="거래처 계약번호">↪ ${esc(c.external_contract_no)}</div>`
              : '';
            // v6.0.0: 읽음/안읽음 시각화
            const rrBadge = typeof ReadReceipts !== 'undefined' ? ReadReceipts.renderTitleBadge(c) : '';
            const rrStyle = typeof ReadReceipts !== 'undefined' ? ReadReceipts.rowStyleAttr(c) : '';
            const rrTooltip = typeof ReadReceipts !== 'undefined' ? ReadReceipts.tooltipAttr(c) : '';
            return `<tr data-id="${c.id}" class="ct-row" style="${rrStyle}"${rrTooltip}>
              <td style="font-family:monospace;font-size:11px">${esc(c.contract_no)}${extNoBadge}</td>
              <td><span class="badge badge-gray" style="font-size:10px">${esc(CONTRACT_TYPE_LABELS[c.contract_type]?.split(' ')[0] || c.contract_type || '-')}</span></td>
              <td class="ct-name-cell" title="${esc(c.title)}">${rrBadge}<span class="ct-name-link">${esc(c.title)}</span>${linkBadge}</td>
              <td>${esc(c.customer_name || '-')}</td>
              <td style="font-size:11px">${_fmtDate(c.start_date)}</td>
              <td style="font-size:11px">${_fmtDate(c.end_date)}</td>
              <td style="text-align:right;font-family:monospace">${c.contract_amount ? _fmtKRW(c.contract_amount) + ' ' + (c.currency || 'KRW') : '-'}</td>
              <td style="vertical-align:middle">
                ${_renderProgressBar(c.status, c.end_date)}
                <div style="margin-top:3px">${_statusBadge(c.status)}</div>
              </td>
              <td style="text-align:center;color:var(--text-3);font-size:11px">${c.file_count > 0 ? `📎 ${c.file_count}` : '-'}</td>
              <td style="text-align:center;white-space:nowrap">
                <button class="btn btn-ghost btn-sm ct-edit" data-id="${c.id}" type="button" style="font-size:11px;padding:2px 6px">편집</button>
                <button class="btn btn-ghost btn-sm ct-del" data-id="${c.id}" type="button" style="font-size:11px;padding:2px 6px;color:#d93025">삭제</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    `;
    // 행 전체 클릭 → 편집 모달
    wrap.querySelectorAll('.ct-row').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('button')) return; // 버튼 클릭은 별도
        const id = parseInt(tr.dataset.id, 10);
        if (id) _openModal(id);
      });
    });
    wrap.querySelectorAll('.ct-edit').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        _openModal(parseInt(btn.dataset.id, 10));
      });
    });
    wrap.querySelectorAll('.ct-del').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        _doDelete(parseInt(btn.dataset.id, 10));
      });
    });
  }

  // ── v6.0.0: 카드뷰 렌더링 (5개 모듈 통일) ──────────────────
  function _renderCardList(wrap) {
    const fmtKRW = n => {
      const v = Number(n);
      if (!v) return '-';
      return v.toLocaleString('ko-KR');
    };
    const fmtDate = s => {
      if (!s) return '-';
      const d = new Date(s);
      if (isNaN(d)) return s;
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
    };
    wrap.innerHTML = `<div class="list-card-grid">
      ${_list
        .map(
          c => `<div class="list-card" data-contract-id="${c.id}">
        <div class="list-card-header">
          <span class="list-card-no">${esc(c.contract_no || '-')} · ${esc(CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type || '-')}</span>
          ${c.contract_amount ? `<span class="list-card-amount">${esc(fmtKRW(c.contract_amount))}</span>` : ''}
        </div>
        <div class="list-card-title">
          <a href="#" data-act="edit" data-id="${c.id}">${esc(c.title || '(계약명 미입력)')}</a>
        </div>
        <div class="list-card-meta">
          <div class="list-card-meta-row" title="고객사">🏢 <strong>${esc(c.customer_name || '-')}</strong></div>
          ${c.start_date ? `<div class="list-card-meta-row" title="시작일">📅 ${esc(fmtDate(c.start_date))}</div>` : ''}
          ${c.end_date ? `<div class="list-card-meta-row" title="종료일">⏰ ${esc(fmtDate(c.end_date))}</div>` : ''}
        </div>
        <div class="list-card-stage">${_renderProgressBar(c.status, c.end_date)}</div>
        <div class="list-card-footer">
          <span>${esc(STATUS_LABELS[c.status] || c.status || '-')}</span>
          <span>${esc(fmtDate(c.updated_at || c.created_at))}</span>
        </div>
      </div>`
        )
        .join('')}
    </div>`;
    // 카드 클릭 → 편집 모달
    wrap.querySelectorAll('.list-card[data-contract-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('a')) e.preventDefault();
        const id = parseInt(el.dataset.contractId, 10);
        if (id) _openModal(id);
      });
    });
  }

  // ── v6.0.0 Phase A2-1: 등록 모드 선택 모달 ─────────────────
  // "+ 새 계약" 클릭 시 — 사용자가 시작 방식 선택
  //   A. 📎 계약서 받음 — 파일 첨부 → AI 분석 → 자동 채움 (B2B 대표 시나리오)
  //   B. ✏️ 빈 양식 — 직접 입력 (소형, 우리가 작성)
  function _openNewModeChooser() {
    Modal.open({
      title: '➕ 새 계약 등록 — 어떻게 시작하시겠습니까?',
      width: 720,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <!-- 모드 A: 파일 우선 (AI 분석) -->
          <button id="ct-mode-file" type="button"
            style="text-align:left;padding:22px 18px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);
                   border:2px solid #7c3aed;border-radius:10px;cursor:pointer;transition:transform .15s">
            <div style="font-size:32px;line-height:1;margin-bottom:10px">📎</div>
            <div style="font-size:15px;font-weight:700;color:#5b21b6;margin-bottom:6px">
              계약서 받음
            </div>
            <div style="font-size:12px;color:#6b21a8;line-height:1.6;margin-bottom:10px">
              <strong>발주처가 보내준 PDF</strong> 또는 협상 중인 초안을 받았을 때<br>
              <span style="color:#7c3aed">① 파일 첨부 → ② AI 법무 분석 → ③ 정보 자동 채움</span>
            </div>
            <div style="font-size:11px;color:#7c3aed;font-weight:600">
              🤖 Gemini 2.5 Pro · 약 30-60초 · 1회 500-1000원
            </div>
          </button>

          <!-- 모드 B: 빈 양식 (직접 입력) -->
          <button id="ct-mode-blank" type="button"
            style="text-align:left;padding:22px 18px;background:#f9fafb;
                   border:2px solid var(--border);border-radius:10px;cursor:pointer;transition:transform .15s">
            <div style="font-size:32px;line-height:1;margin-bottom:10px">✏️</div>
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">
              빈 양식부터
            </div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.6;margin-bottom:10px">
              <strong>우리가 직접 작성</strong>하거나 간단한 NDA/SOW 등<br>
              <span>① 양식 입력 → ② 저장 → ③ (선택) 파일 첨부</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);font-weight:600">
              ⚡ 즉시 입력 가능 · AI 분석은 나중에
            </div>
          </button>
        </div>

        <div style="margin-top:10px;font-size:10px;color:var(--text-3);text-align:center">
          💡 어떤 모드로 시작하든 등록 후 변경 가능
        </div>
      `,
      footer: `<button class="btn btn-ghost" id="ct-mode-cancel">취소</button>`,
      bind: {
        '#ct-mode-cancel': () => Modal.close(),
      },
      onOpen: () => {
        const fileBtn = document.getElementById('ct-mode-file');
        const blankBtn = document.getElementById('ct-mode-blank');
        const hoverOn = btn => {
          btn.style.transform = 'translateY(-3px)';
          btn.style.boxShadow = '0 6px 14px rgba(0,0,0,0.08)';
        };
        const hoverOff = btn => {
          btn.style.transform = 'translateY(0)';
          btn.style.boxShadow = 'none';
        };
        fileBtn.addEventListener('mouseenter', () => hoverOn(fileBtn));
        fileBtn.addEventListener('mouseleave', () => hoverOff(fileBtn));
        blankBtn.addEventListener('mouseenter', () => hoverOn(blankBtn));
        blankBtn.addEventListener('mouseleave', () => hoverOff(blankBtn));

        // 모드 B (빈 양식) — 기존 빈 모달 흐름 그대로
        blankBtn.addEventListener('click', () => {
          Modal.close();
          setTimeout(() => _openModal(null), 100);
        });

        // 모드 A (파일 우선) — Phase A2-2: 임시 계약 자동 생성 → 편집 모달 진입
        fileBtn.addEventListener('click', async () => {
          Modal.close();
          await _openModalFileFirst();
        });
      },
    });
  }

  // ── v6.0.0 Phase A2-2: 파일 우선 등록 모드 ──────────────────
  // 임시 계약 자동 생성 → 즉시 편집 모달 진입 → 사용자가 파일 첨부 → AI 분석
  // 모달 close 시 미저장 (= placeholder 그대로) 면 자동 정리
  let _tempContractId = null; // 현재 임시 계약 ID 추적 (close 시 정리용)

  async function _openModalFileFirst() {
    // 1. 임시 계약 자동 생성 (placeholder 값 — 사용자가 저장 시 실제 값으로 교체)
    let tempId;
    try {
      Toast.info?.('임시 계약 생성 중...');
      const res = await API.contracts.create({
        title: '(임시)',
        contract_type: 'etc',
        status: 'draft',
        currency: 'KRW',
      });
      tempId = res?.id || res?.data?.id;
      if (!tempId) throw new Error('임시 계약 ID 누락');
      _tempContractId = tempId;
    } catch (err) {
      Toast.error?.('임시 계약 생성 실패: ' + (err.message || err));
      return;
    }
    // 2. 편집 모달 진입 (파일 첨부 우선 모드)
    await _openModal(tempId, { isTempMode: true });
  }

  // 임시 계약 정리 (사용자가 미저장 close 시)
  async function _cleanupTempContractIfNeeded() {
    if (!_tempContractId) return;
    const id = _tempContractId;
    _tempContractId = null;
    try {
      // 사용자가 실제로 값을 입력했는지 확인
      const r = await API.contracts.get(id);
      const c = r?.data;
      if (!c) return;
      const isStillTemp =
        c.title === '(임시)' &&
        !c.customer_name &&
        !c.customer_id &&
        (!c.files || c.files.length === 0);
      if (isStillTemp) {
        await API.contracts.delete(id);
        console.log(`[contracts:cleanup] 임시 계약 ${id} 자동 삭제`);
      } else {
        // 일부 입력했지만 저장 안한 경우 — confirm
        const proceed = confirm(
          `미저장 임시 계약이 있습니다 (#${id}).\n\n` +
            `유지하려면 [취소] (목록에 남음)\n` +
            `삭제하려면 [확인]`
        );
        if (proceed) {
          await API.contracts.delete(id);
          Toast.info?.(`임시 계약 #${id} 삭제됨`);
        }
      }
      await _refreshList();
    } catch (_) {
      /* best-effort */
    }
  }

  // ── 모달 (생성/편집) ──────────────────────────────────────
  async function _openModal(id, opts = {}) {
    const { isTempMode = false } = opts;
    let entity;
    if (id) {
      try {
        const res = await API.contracts.get(id);
        entity = res?.data || {};
      } catch (err) {
        Toast.error?.('조회 실패: ' + (err.message || err));
        return;
      }
    } else {
      // 신규 — 자동채번 미리보기
      try {
        const r = await API.contracts.nextContractNo();
        entity = { contract_no: r?.data?.next_contract_no, status: 'draft' };
      } catch (_) {
        entity = { status: 'draft' };
      }
    }

    // 임시 모드: placeholder 값 화면에서 빈칸으로 표시 (사용자가 실제 입력 유도)
    if (isTempMode && entity.title === '(임시)') {
      entity.title = '';
    }

    const title = id
      ? isTempMode
        ? `📜 새 계약 등록 (파일 첨부 모드) — ${esc(entity.contract_no || '')}`
        : `📜 계약 편집 — ${esc(entity.contract_no || '')}`
      : '📜 새 계약 등록';
    const actions = id && !isTempMode ? (QUICK_ACTIONS[entity.status] || []) : [];

    // 취소/닫기 핸들러 — 임시 모드 시 cleanup 우선
    const cancelHandler = async () => {
      Modal.close();
      if (isTempMode) {
        await _cleanupTempContractIfNeeded();
      }
    };

    Modal.open({
      title,
      width: 1100,
      body: _formHtml(entity, { isTempMode }),
      footer: `
        ${actions.map(a => {
          const cls = a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost';
          return `<button class="btn ${cls} ct-quick-action" data-to="${a.to}" type="button">${esc(a.label)}</button>`;
        }).join('')}
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="ct-cancel-btn">${isTempMode ? '취소 (삭제)' : '취소'}</button>
        <button class="btn btn-primary" id="ct-save-btn">${id ? '💾 저장' : '➕ 등록'}</button>
        ${id ? `<button class="btn btn-secondary" id="ct-share-btn" type="button" style="background:#7c3aed;color:#fff;border:none">🔗 공유 링크</button>` : ''}
      `,
      bind: {
        '#ct-cancel-btn': cancelHandler,
        '#ct-save-btn': () => _doSave(id, { isTempMode }),
      },
      disableOverlayClose: true,
      onOpen: () => {
        // 빠른 액션 버튼 핸들러
        document.querySelectorAll('.ct-quick-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newStatus = btn.dataset.to;
            const label = STATUS_LABELS[newStatus] || newStatus;
            // [P2-C] 체결(completed) 시 프로젝트·매출계획 자동 생성됨을 사전 안내
            const confirmMsg =
              newStatus === 'completed'
                ? `계약을 "${label}" 처리하시겠습니까?\n\n체결 시 프로젝트와 매출계획(청구차수)이 자동 생성됩니다.`
                : `상태를 "${label}" 로 변경하시겠습니까?`;
            if (!confirm(confirmMsg)) return;
            try {
              const res = await API.contracts.setStatus(id, newStatus);
              // [P2-C] 자동 프로비저닝 결과 토스트 (P1 응답 data.provision 연동)
              //   생성된 게 있으면 결합 토스트 한 번(중복 토스트로 덮이지 않도록)
              let msg = `상태 변경 → ${label}`;
              if (newStatus === 'completed') {
                const pv = res?.data?.provision;
                if (pv && (pv.projectCreated || pv.scheduleCreated)) {
                  const made = [];
                  if (pv.projectCreated) made.push('프로젝트');
                  if (pv.scheduleCreated) made.push('매출계획');
                  msg = `🎉 계약 체결 완료 — ${made.join('·')} 자동 생성됨 (매출관리에서 확인)`;
                }
              }
              Toast.success?.(msg);
              await _reopenModalFresh(id);
            } catch (err) {
              Toast.error?.('상태 변경 실패: ' + (err?.error || err?.message || err));
            }
          });
        });
        if (id) _bindFileEvents(id);
        // v6.0.0 fix: Combobox 4개 UI 제거됨 — _attachLinkComboboxes 호출 불필요
        _bindLegalCtaBtn(id); // v6.0.0 Step 3: 메인 AI 법무 검토 CTA
        _bindExtractedMetaCardEvents(); // v6.0.0 Phase A2-3: AI 추출 카드 [✓ 적용] 버튼
        _bindContractNoModeToggle(); // v6.0.0 Phase A3: 자동/수동 채번 토글
        _bindTempIntroToggle(); // v6.0.0 UX: 가이드 카드 접기/dismiss
        _bindLegalSectionToggles(); // v6.0.0 UX: AI 결과 섹션별 접기
        if (id) _bindEsignEvents(id); // v6.0.0 Step 4: 전자서명 섹션 이벤트
        if (id) _bindShareCommentsEvents(id); // v6.0.0 Phase B+D: 공유 + 댓글
        // [P1-E-2] 계약 고객사의 A/S 티켓 (LinkedSupport — customer 기준)
        if (id && entity.customer_id && typeof LinkedSupport !== 'undefined') {
          LinkedSupport.render('#ct-linked-support', 'customer', entity.customer_id);
        }
        // v6.0.0 fix: footer [🔗 공유 링크] 버튼 핸들러
        if (id) {
          const shareBtn = document.getElementById('ct-share-btn');
          if (shareBtn) {
            shareBtn.addEventListener('click', () => _openShareManagerModal(id));
          }
        }
      },
    });
  }

  function _formHtml(e, opts = {}) {
    const { isTempMode = false } = opts;
    return `
      ${isTempMode ? _renderTempModeIntro(e) : ''}
      ${e.id ? _renderLegalCtaSection(e) : ''}
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:8px">
            <span>계약번호</span>
            <span style="display:inline-flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;font-size:11px;font-weight:400">
              <button type="button" class="ct-no-mode-btn" data-mode="auto"
                style="border:0;background:var(--oci-red);color:#fff;padding:2px 8px;cursor:pointer">자동</button>
              <button type="button" class="ct-no-mode-btn" data-mode="manual"
                style="border:0;background:#f5f5f5;color:#666;padding:2px 8px;cursor:pointer">수동</button>
            </span>
          </label>
          <input class="form-input" id="ct-f-contract_no" value="${esc(e.contract_no || '')}"
            readonly style="font-family:monospace;background:#fafafa"
            data-original-no="${esc(e.contract_no || '')}">
          <div class="ct-no-hint" style="font-size:10px;color:var(--text-3);margin-top:4px">
            자동 채번 활성 — 저장 시 확정됩니다
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">유형</label>
          <select class="form-input" id="ct-f-contract_type">
            ${Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${(e.contract_type || 'etc') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">상태</label>
          <select class="form-input" id="ct-f-status">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(e.status || 'draft') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>

        <!-- v6.0.0 Phase A3: 거래처(상대방) 계약번호 (선택, 보조 식별자) -->
        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label">거래처 계약번호 <span style="font-weight:400;color:var(--text-3);font-size:11px">(선택 — 상대방이 발급한 번호)</span></label>
          <input class="form-input" id="ct-f-external_contract_no"
            value="${esc(e.external_contract_no || '')}"
            placeholder="예: ABC-2026-001, KIM-CO-20260101 (양식 자유)"
            maxlength="80" style="font-family:monospace">
        </div>

        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label required">계약명</label>
          <input class="form-input" id="ct-f-title" value="${esc(e.title || '')}" placeholder="예: A사 NDA 계약 (2026년)">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">고객사명</label>
          <input class="form-input" id="ct-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 이름">
        </div>
        <div class="form-row">
          <label class="form-label">통화</label>
          <select class="form-input" id="ct-f-currency">
            <option value="KRW" ${(e.currency || 'KRW') === 'KRW' ? 'selected' : ''}>KRW</option>
            <option value="USD" ${e.currency === 'USD' ? 'selected' : ''}>USD</option>
            <option value="JPY" ${e.currency === 'JPY' ? 'selected' : ''}>JPY</option>
            <option value="EUR" ${e.currency === 'EUR' ? 'selected' : ''}>EUR</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">시작일</label>
          <input class="form-input" id="ct-f-start_date" type="date" value="${e.start_date ? _toInputDate(e.start_date) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">종료일</label>
          <input class="form-input" id="ct-f-end_date" type="date" value="${e.end_date ? _toInputDate(e.end_date) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">계약금액</label>
          <input class="form-input" id="ct-f-contract_amount" type="number" min="0" step="0.01"
            value="${e.contract_amount !== null && e.contract_amount !== undefined ? e.contract_amount : ''}" placeholder="0">
        </div>

        <!-- v6.0.0 Phase C: 검토 기한 (D-Day) -->
        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label">📅 검토 기한 (D-Day) <span style="font-weight:400;color:var(--text-3);font-size:11px">(선택 — 공유받은 검토자에게 표시)</span></label>
          <input class="form-input" id="ct-f-review_deadline" type="date"
            value="${e.review_deadline ? _toInputDate(e.review_deadline) : ''}">
        </div>

        <!-- v6.0.0 fix: 연결 필드는 UI 제거 (hidden 으로 데이터 모델 유지)
             고객사 ID 는 [🏢 상대방 회사 매칭] 모달로만 채워짐, 언어는 default 'ko' -->
        <input type="hidden" id="ct-f-customer_id" value="${e.customer_id || ''}">
        <input type="hidden" id="ct-f-lead_id" value="${e.lead_id || ''}">
        <input type="hidden" id="ct-f-proposal_id" value="${e.proposal_id || ''}">
        <input type="hidden" id="ct-f-quote_id" value="${e.quote_id || ''}">
        <input type="hidden" id="ct-f-language" value="${esc(e.language || 'ko')}">

        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label">비고</label>
          <textarea class="form-input" id="ct-f-notes" rows="3" placeholder="(선택)" style="resize:vertical;font-family:inherit">${esc(e.notes || '')}</textarea>
        </div>
      </div>

      <!-- v6.0.0 Step 4: 전자서명 (Modusign) 섹션 — 편집 모드 + status=approved 또는 이미 요청됨 -->
      ${e.id && (e.status === 'approved' || e.esign_request_id) ? _renderEsignSection(e) : ''}

      <!-- v6.0.0 fix: 공유 링크는 footer 버튼으로 이동, 댓글은 본문 유지 -->
      ${e.id ? _renderCommentsSection(e) : ''}

      ${
        e.id && (e.files || []).length > 0
          ? `<!-- v6.0.0 UX 개선: 파일 추가는 상단 AI 검토 카드에서, 여기는 목록(다운로드/삭제/재검토)만 -->
            <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong style="font-size:13px">📎 첨부 파일 (${(e.files || []).length}건)</strong>
                <span style="font-size:10px;color:var(--text-3)">파일 추가는 ↑ 상단 AI 카드에서</span>
              </div>
              <div style="margin-bottom:10px;padding:6px 10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:11px;color:#075985">
                💡 파일 행의 <strong>🤖 법무</strong> 버튼으로 개별 파일에 대해 AI 법무 검토 재실행 가능
              </div>
              ${_renderFileList(e.files || [], e.id)}

              <!-- 변경 이력 (최근 10건) -->
              ${_renderHistorySection(e.history || [])}
            </div>`
          : e.id
            ? `<!-- 파일 없음 — 변경 이력만 -->
              <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
                ${_renderHistorySection(e.history || [])}
              </div>`
            : '<div style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e">💡 계약 등록 후 파일 첨부 + AI 법무 검토가 가능합니다</div>'
      }
      ${
        e.id && e.customer_id
          ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
              <strong style="font-size:13px">🎫 고객사 A/S 티켓</strong>
              <div style="font-size:10px;color:var(--text-3);margin:2px 0 8px">이 계약 고객사${e.customer_name ? `(${esc(e.customer_name)})` : ''}의 고객지원 내역</div>
              <div id="ct-linked-support"></div>
            </div>`
          : ''
      }
    `;
  }

  // v6.0.0 Phase A2-2: 임시 모드 인트로 (파일 우선 등록 안내)
  // v6.0.0 UX 개선: 미니멀 헤더 + "도움말 보기" 토글 + localStorage "다시 안 보기"
  function _renderTempModeIntro(e) {
    const dontShow = localStorage.getItem('ct_temp_intro_dismissed') === '1';
    // "다시 안 보기" 사용자 → 최소 헤더만 (1줄)
    if (dontShow) {
      return `<div style="padding:8px 14px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;color:#5b21b6">
          📎 임시 계약 <code style="background:#fff;padding:1px 6px;border-radius:3px;font-family:monospace;font-size:11px">${esc(e.contract_no || '')}</code> · 저장 시 확정
        </div>
        <button id="ct-intro-show-btn" type="button" class="btn btn-ghost btn-sm" style="font-size:10px;color:#7c3aed;padding:2px 8px">❔ 가이드 보기</button>
      </div>`;
    }
    const hasFile = Array.isArray(e.files) && e.files.length > 0;
    return `<div id="ct-temp-intro-wrap" style="border:1px solid #c4b5fd;border-radius:8px;padding:10px 14px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <span style="font-size:18px;line-height:1">📎</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;color:#5b21b6">파일 첨부 모드</div>
            <div style="font-size:10px;color:#7c3aed;margin-top:1px">
              임시 <code style="background:#fff;padding:0 4px;border-radius:2px;font-family:monospace">${esc(e.contract_no || '')}</code> · 저장 시 확정 · 취소 시 자동 삭제
            </div>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button id="ct-intro-toggle-btn" type="button" class="btn btn-ghost btn-sm" style="font-size:10px;color:#7c3aed;padding:3px 8px" title="3단계 가이드 보기">
            <span class="ct-intro-toggle-label">▼ 가이드</span>
          </button>
          <button id="ct-intro-dismiss-btn" type="button" class="btn btn-ghost btn-sm" style="font-size:10px;color:#7c3aed;padding:3px 8px" title="다시 안 보기">✕</button>
        </div>
      </div>
      <div id="ct-intro-steps" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #c4b5fd">
        <ol style="margin:0 0 0 20px;padding:0;font-size:11px;color:#6b21a8;line-height:1.7">
          <li>${hasFile ? '✅' : '①'} 아래 카드 [📎 계약서 파일 첨부]</li>
          <li>${hasFile ? '②' : '⬜'} [🤖 AI 법무 검토 시작] → 자동 채움</li>
          <li>⬜ 상대방 매칭 + 수정 → 💾 저장</li>
        </ol>
      </div>
    </div>`;
  }

  // v6.0.0 UX 개선: 임시 모드 인트로 토글/dismiss 핸들러
  function _bindTempIntroToggle() {
    const toggleBtn = document.getElementById('ct-intro-toggle-btn');
    const dismissBtn = document.getElementById('ct-intro-dismiss-btn');
    const showBtn = document.getElementById('ct-intro-show-btn');
    const steps = document.getElementById('ct-intro-steps');
    const label = document.querySelector('.ct-intro-toggle-label');
    if (toggleBtn && steps && label) {
      toggleBtn.addEventListener('click', () => {
        const isHidden = steps.style.display === 'none';
        steps.style.display = isHidden ? '' : 'none';
        label.textContent = isHidden ? '▲ 접기' : '▼ 가이드';
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        localStorage.setItem('ct_temp_intro_dismissed', '1');
        const wrap = document.getElementById('ct-temp-intro-wrap');
        if (wrap) {
          // 미니 헤더로 즉시 교체 (모달 재오픈 없이)
          wrap.outerHTML = `<div style="padding:8px 14px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:12px;color:#5b21b6">📎 임시 계약 · 저장 시 확정</div>
            <button id="ct-intro-show-btn" type="button" class="btn btn-ghost btn-sm" style="font-size:10px;color:#7c3aed;padding:2px 8px">❔ 가이드 보기</button>
          </div>`;
          Toast.info?.('가이드를 숨겼습니다 (모달 재진입 시 ❔ 버튼으로 다시 보기)');
          _bindTempIntroToggle(); // 새 [❔ 보기] 버튼 핸들러 재바인딩
        }
      });
    }
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        localStorage.removeItem('ct_temp_intro_dismissed');
        Toast.info?.('다음 모달 진입 시 가이드 카드가 다시 표시됩니다');
      });
    }
  }

  // Step 3: AI 법무 검토 메인 CTA + 결과 카드 (모달 상단)
  // 파일 없음 → 안내, 파일 있음 + 미검토 → 큰 CTA, 검토 완료 → 결과 카드 + 재검토 버튼
  function _renderLegalCtaSection(e) {
    const files = Array.isArray(e.files) ? e.files : [];
    const analyzableFiles = files.filter(f => _isAnalyzable(f.original_filename));
    const hasReview = !!e.latest_legal_review;
    const hasAnalyzable = analyzableFiles.length > 0;

    // 결과가 있으면 결과 카드 + 재검토 안내 (재검토는 파일 행 [🤖 법무] 버튼으로)
    if (hasReview) {
      const meta = e.latest_legal_review?.extracted_meta;
      return `<div id="ct-legal-review-wrap" style="margin-bottom:16px">
        ${_renderLegalReview(e.latest_legal_review)}
        ${meta ? _renderExtractedMetaCard(meta, e) : ''}
      </div>`;
    }

    // 결과 없음 → 안내 카드 (분석 가능한 파일 유무에 따라 분기)
    return `<div id="ct-legal-review-wrap" style="margin-bottom:16px">
      <div id="ct-legal-cta-card" style="border:2px dashed #7c3aed;border-radius:10px;padding:18px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);text-align:center;transition:background 0.2s">
        <div style="font-size:32px;line-height:1;margin-bottom:8px">🤖</div>
        <div style="font-size:15px;font-weight:700;color:#5b21b6;margin-bottom:6px">
          AI 법무 검토 ${hasAnalyzable ? '준비됨' : '대기'}
        </div>
        ${
          hasAnalyzable
            ? `<div style="font-size:12px;color:#6b21a8;margin-bottom:12px;line-height:1.6">
                Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서<br>
                <strong>독소조항·누락조항·수정안</strong>을 자동 생성하고 계약 정보도 자동 채워줍니다 (약 30-60초)
              </div>
              <button id="ct-legal-cta-btn" type="button"
                style="padding:12px 28px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,0.3);transition:transform .15s">
                🤖 AI 법무 검토 시작 (${analyzableFiles.length}건 파일 사용 가능)
              </button>
              <div style="margin-top:10px;display:flex;justify-content:center;gap:8px;align-items:center">
                <button id="ct-cta-file-add-btn-more" type="button"
                  style="font-size:11px;padding:4px 10px;background:#fff;color:#7c3aed;border:1px solid #c4b5fd;border-radius:5px;cursor:pointer">
                  📎 파일 추가/교체
                </button>
                <span style="font-size:10px;color:#6b21a8">최근 업로드된 분석 가능 파일이 자동 선택됩니다</span>
              </div>`
            : `<!-- v6.0.0 UX 개선: 파일 첨부 UI 를 카드 안에 직접 통합 -->
              <div style="font-size:13px;color:#6b21a8;margin-bottom:14px;line-height:1.6">
                계약서 파일을 첨부하면 AI 가 자동으로 검토하고 정보를 추출합니다
              </div>
              <button id="ct-cta-file-add-btn" type="button"
                style="padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,0.3);transition:transform .15s">
                📎 계약서 파일 첨부
              </button>
              <div style="margin-top:10px;font-size:11px;color:#6b21a8">
                또는 이 영역에 파일을 <strong>드래그&드롭</strong> · 지원: PDF · 이미지(PNG/JPG) · TXT
              </div>`
        }
      </div>
      <input type="file" id="ct-cta-file-input" multiple style="display:none"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md">
    </div>`;
  }

  // ── v6.0.0 Step 4: 전자서명 (Modusign) 섹션 ──────────────
  // 상태별 분기:
  //   1. esign_request_id 없음 → [✍ 서명 요청 시작] (status=approved 필수)
  //   2. status=requested/in_progress → 진행 상황 + [🔔 재전송] [❌ 취소]
  //   3. status=signed → [📄 서명본 PDF 다운로드]
  //   4. status=rejected/expired/cancelled → 결과 표시
  function _renderEsignSection(e) {
    const status = e.esign_status; // null / 'requested' / 'in_progress' / 'signed' / 'rejected' / 'expired' / 'cancelled'
    const docId = e.esign_request_id;
    const signers = (() => {
      if (!e.esign_signers_json) return [];
      try {
        return typeof e.esign_signers_json === 'string'
          ? JSON.parse(e.esign_signers_json)
          : e.esign_signers_json;
      } catch (_) {
        return [];
      }
    })();

    // 색상 + 라벨
    const STATUS_META = {
      requested: { color: '#3b82f6', label: '요청됨', icon: '📨' },
      in_progress: { color: '#0891b2', label: '서명 진행 중', icon: '✍️' },
      signed: { color: '#16a34a', label: '서명 완료', icon: '✅' },
      rejected: { color: '#dc2626', label: '거부됨', icon: '❌' },
      expired: { color: '#6b7280', label: '만료됨', icon: '⏰' },
      cancelled: { color: '#6b7280', label: '취소됨', icon: '✕' },
    };
    const meta = STATUS_META[status] || null;

    // 1. 미요청
    if (!docId) {
      return `<div id="ct-esign-wrap" style="margin-top:16px;padding:16px;background:linear-gradient(135deg,#fff7ed,#fed7aa);border:2px dashed #ea580c;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <div style="font-size:14px;font-weight:700;color:#9a3412">✍ 전자서명 (모두싸인)</div>
            <div style="font-size:11px;color:#c2410c;margin-top:2px">계약 상태가 <strong>승인</strong> 단계이므로 서명 요청을 시작할 수 있습니다</div>
          </div>
          <button id="ct-esign-request-btn" type="button" class="btn btn-primary" style="padding:8px 18px;background:#ea580c;border:none">
            ✍ 서명 요청 시작
          </button>
        </div>
      </div>`;
    }

    // 2-4. 요청 후
    return `<div id="ct-esign-wrap" style="margin-top:16px;padding:16px;background:#fff;border:1px solid ${meta?.color || '#e5e7eb'};border-left:4px solid ${meta?.color || '#6b7280'};border-radius:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:700;color:${meta?.color || '#111'}">
            ${meta?.icon || '📨'} 전자서명: ${esc(meta?.label || status || '-')}
          </div>
          <div style="font-size:10px;color:var(--text-3);margin-top:2px">
            문서 ID: <code style="font-family:monospace;background:#f3f4f6;padding:1px 4px;border-radius:3px">${esc(docId)}</code>
            ${e.esign_requested_at ? ` · 요청: ${_fmtDateTime(e.esign_requested_at)}` : ''}
            ${e.esign_signed_at ? ` · 완료: ${_fmtDateTime(e.esign_signed_at)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${
            status === 'signed'
              ? `<button id="ct-esign-download-btn" type="button" class="btn btn-primary btn-sm">📄 서명본 PDF</button>`
              : ''
          }
          ${
            status === 'requested' || status === 'in_progress'
              ? `<button id="ct-esign-refresh-btn" type="button" class="btn btn-ghost btn-sm">🔄 상태 새로고침</button>
                 <button id="ct-esign-cancel-btn" type="button" class="btn btn-ghost btn-sm" style="color:#dc2626">❌ 취소</button>`
              : ''
          }
        </div>
      </div>

      ${
        signers.length > 0
          ? `<div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--border)">
              <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">서명자 ${signers.length}명</div>
              <ul style="margin:0;padding:0 0 0 18px;font-size:12px">
                ${signers
                  .map(
                    s => `<li style="margin-bottom:4px">
                  <strong>${esc(s.name || '-')}</strong>
                  <span style="color:var(--text-3)">&lt;${esc(s.email || '-')}&gt;</span>
                  ${s.phone ? `<span style="color:var(--text-3);font-size:10px"> · 📱 ${esc(s.phone)}</span>` : ''}
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }
    </div>`;
  }

  // 전자서명 섹션 이벤트 바인딩
  function _bindEsignEvents(contractId) {
    const requestBtn = document.getElementById('ct-esign-request-btn');
    if (requestBtn) {
      requestBtn.addEventListener('click', () => _openEsignRequestModal(contractId));
    }
    const downloadBtn = document.getElementById('ct-esign-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        try {
          const token = localStorage.getItem('oci_token');
          const userId = localStorage.getItem('current_user_id');
          const res = await fetch(API.contracts.esign.signedPdfUrl(contractId), {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(userId ? { 'X-User-Id': userId } : {}),
            },
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `contract_${contractId}_signed.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          Toast.success?.('서명본 PDF 다운로드 완료');
        } catch (err) {
          Toast.error?.('다운로드 실패: ' + (err.message || err));
        }
      });
    }
    const refreshBtn = document.getElementById('ct-esign-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        try {
          await API.contracts.esign.getStatus(contractId);
          Toast.info?.('상태 새로고침 완료');
          await _reopenModalFresh(contractId);
        } catch (err) {
          Toast.error?.('상태 조회 실패: ' + (err.message || err));
          refreshBtn.disabled = false;
        }
      });
    }
    const cancelBtn = document.getElementById('ct-esign-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('전자서명 요청을 취소하시겠습니까?')) return;
        try {
          await API.contracts.esign.cancel(contractId);
          Toast.success?.('서명 요청 취소됨');
          await _reopenModalFresh(contractId);
        } catch (err) {
          Toast.error?.('취소 실패: ' + (err?.error || err?.message || err));
        }
      });
    }
  }

  // 서명 요청 모달 (서명자 입력)
  async function _openEsignRequestModal(contractId) {
    // 먼저 OAuth 연결 상태 확인 (mock 모드면 skip)
    let oauthOk = false;
    let oauthInfo = null;
    try {
      const r = await API.contracts.esign.status();
      oauthInfo = r?.data;
      oauthOk = !!oauthInfo?.connected || !!oauthInfo?.mock;
    } catch (_) {
      // 미연결 또는 기능 비활성
    }

    if (!oauthOk) {
      Toast.error?.(
        '모두싸인 미연결 — [설정] 화면에서 [모두싸인 연결] 후 재시도하세요',
        { duration: 7000 }
      );
      return;
    }

    const body = `<div style="padding:16px">
      ${
        oauthInfo?.mock
          ? `<div style="padding:8px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e;margin-bottom:12px">
              ⚠️ Mock 모드 — 실제 모두싸인 호출이 일어나지 않습니다 (환경변수 미설정)
            </div>`
          : `<div style="padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:11px;color:#075985;margin-bottom:12px">
              연결된 계정: <strong>${esc(oauthInfo?.modusign_email || oauthInfo?.modusign_user_id || '-')}</strong>
            </div>`
      }

      <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">
        서명자를 입력하세요. 최근 업로드된 PDF 파일이 자동으로 사용됩니다.
      </div>

      <div id="ct-esign-signers" style="margin-bottom:10px"></div>

      <button id="ct-esign-add-signer-btn" type="button" class="btn btn-ghost btn-sm" style="margin-bottom:14px">
        + 서명자 추가
      </button>

      <div class="form-row">
        <label class="form-label">메시지 (선택)</label>
        <textarea class="form-input" id="ct-esign-message" rows="2" placeholder="(서명자에게 전달할 메시지)" style="resize:vertical"></textarea>
      </div>
    </div>`;

    const footer = `
      <button class="btn btn-ghost" id="ct-esign-cancel-modal-btn" type="button">취소</button>
      <button class="btn btn-primary" id="ct-esign-submit-btn" type="button" style="background:#ea580c">✍ 서명 요청 시작</button>`;

    const addSignerRow = () => {
      const wrap = document.getElementById('ct-esign-signers');
      if (!wrap) return;
      const div = document.createElement('div');
      div.className = 'ct-esign-signer-row';
      div.style.cssText =
        'display:grid;grid-template-columns:1fr 1.5fr 1fr auto;gap:8px;margin-bottom:6px;align-items:center';
      div.innerHTML = `
        <input class="form-input ct-esign-name" placeholder="이름" style="font-size:12px;padding:6px 10px">
        <input class="form-input ct-esign-email" type="email" placeholder="이메일" style="font-size:12px;padding:6px 10px">
        <input class="form-input ct-esign-phone" placeholder="휴대폰 (선택)" style="font-size:12px;padding:6px 10px">
        <button type="button" class="btn btn-ghost btn-sm ct-esign-del" style="color:#dc2626;font-size:11px">×</button>`;
      wrap.appendChild(div);
      div.querySelector('.ct-esign-del').addEventListener('click', () => div.remove());
    };

    Modal.open({
      title: '✍ 전자서명 요청',
      body,
      footer,
      size: 'md',
      onOpen: () => {
        addSignerRow(); // 첫 행 자동 추가
        document
          .getElementById('ct-esign-add-signer-btn')
          ?.addEventListener('click', addSignerRow);
        document
          .getElementById('ct-esign-cancel-modal-btn')
          ?.addEventListener('click', () => Modal.close());
        document
          .getElementById('ct-esign-submit-btn')
          ?.addEventListener('click', async () => {
            const rows = Array.from(document.querySelectorAll('.ct-esign-signer-row'));
            const signers = rows
              .map(r => ({
                name: r.querySelector('.ct-esign-name')?.value?.trim() || '',
                email: r.querySelector('.ct-esign-email')?.value?.trim() || '',
                phone: r.querySelector('.ct-esign-phone')?.value?.trim() || undefined,
              }))
              .filter(s => s.name && s.email);
            if (!signers.length) {
              Toast.error?.('서명자 1명 이상 입력 필요 (이름 + 이메일)');
              return;
            }
            const message = document.getElementById('ct-esign-message')?.value?.trim() || '';
            const btn = document.getElementById('ct-esign-submit-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 요청 중...';
            try {
              await API.contracts.esign.request(contractId, { signers, message });
              Toast.success?.('전자서명 요청 완료 — 서명자에게 이메일 발송됨');
              Modal.close();
              await _reopenModalFresh(contractId);
            } catch (err) {
              btn.disabled = false;
              btn.innerHTML = '✍ 서명 요청 시작';
              Toast.error?.('요청 실패: ' + (err?.error || err?.message || err));
            }
          });
      },
    });
  }

  // ── v6.0.0 fix: 공유 링크 관리 통합 모달 (목록 + 새 발급) ──────────
  function _openShareManagerModal(contractId) {
    const body = `<div style="padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;color:var(--text-3)">
          검토자에게 안전한 링크 발급 (만료 기한 + 권한별: viewer/commenter/approver)
        </div>
        <button id="ct-share-new-btn" type="button" class="btn btn-primary btn-sm">+ 새 공유 링크</button>
      </div>
      <div id="ct-share-list" style="font-size:12px;min-height:120px"><div class="loading" style="padding:20px;color:var(--text-3);text-align:center">불러오는 중...</div></div>
    </div>`;
    const footer = `<button class="btn btn-ghost" id="ct-share-mgr-close">닫기</button>`;
    Modal.open({
      title: '🔗 공유 링크 관리',
      body,
      footer,
      width: 900,
      bind: { '#ct-share-mgr-close': () => Modal.close() },
      onOpen: () => {
        const newBtn = document.getElementById('ct-share-new-btn');
        if (newBtn) {
          newBtn.addEventListener('click', () => {
            // 새 발급 모달은 현재 모달 닫고 → 발급 모달 → 다시 관리 모달
            Modal.close();
            _openShareCreateModal(contractId, () => _openShareManagerModal(contractId));
          });
        }
        _loadShareLinks(contractId);
      },
    });
  }

  async function _loadShareLinks(contractId) {
    const wrap = document.getElementById('ct-share-list');
    if (!wrap) return;
    try {
      const r = await API.contracts.share.list(contractId);
      const links = r?.data || [];
      if (!links.length) {
        wrap.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3)">등록된 공유 링크가 없습니다 — 우측 [+ 새 공유 링크] 클릭</div>`;
        return;
      }
      wrap.innerHTML = `<table class="data-table" style="font-size:11px">
        <thead><tr>
          <th>발급일</th><th>권한</th><th>수신자</th><th>조회</th><th>만료</th><th>상태</th><th>링크</th><th>작업</th>
        </tr></thead>
        <tbody>${links
          .map(l => {
            const isRevoked = !!l.revoked_at;
            const isExpired = l.expires_at && new Date(l.expires_at) < new Date();
            const statusBadge = isRevoked
              ? '<span class="badge badge-gray">❌ 회수</span>'
              : isExpired
                ? '<span class="badge badge-gray">⏰ 만료</span>'
                : '<span class="badge badge-green">✅ 활성</span>';
            const shareUrl = `${window.location.origin}/contract-share.html?token=${encodeURIComponent(l.token)}`;
            return `<tr>
              <td>${_fmtDate(l.created_at)}</td>
              <td><span class="badge badge-blue">${esc(l.role)}</span></td>
              <td>${l.recipients_count}명</td>
              <td>${l.viewed_count || 0}/${l.recipients_count}</td>
              <td>${l.expires_at ? _fmtDate(l.expires_at) : '-'}</td>
              <td>${statusBadge}</td>
              <td style="font-family:monospace;font-size:10px">
                <button type="button" class="btn btn-ghost btn-sm ct-share-copy-btn" data-url="${esc(shareUrl)}" style="font-size:10px;padding:2px 6px">📋 복사</button>
              </td>
              <td>
                ${!isRevoked ? `<button type="button" class="btn btn-ghost btn-sm ct-share-revoke-btn" data-id="${l.id}" style="font-size:10px;color:#dc2626;padding:2px 6px">회수</button>` : '-'}
              </td>
            </tr>`;
          })
          .join('')}</tbody>
      </table>`;

      // 이벤트 바인딩
      wrap.querySelectorAll('.ct-share-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          navigator.clipboard
            .writeText(btn.dataset.url)
            .then(() => Toast.success?.('링크 복사됨'));
        });
      });
      wrap.querySelectorAll('.ct-share-revoke-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('공유 링크를 회수하시겠습니까?')) return;
          try {
            await API.contracts.share.revoke(contractId, parseInt(btn.dataset.id, 10));
            Toast.success?.('회수 완료');
            _loadShareLinks(contractId);
          } catch (e) {
            Toast.error?.('회수 실패: ' + (e.message || e));
          }
        });
      });
    } catch (e) {
      wrap.innerHTML = _renderFriendlyErrorBox('공유 링크 목록 조회', e);
    }
  }

  // 새 공유 링크 발급 모달 (옵션: onComplete 콜백 — 발급 후 관리 모달 재오픈)
  function _openShareCreateModal(contractId, onComplete) {
    const body = `<div style="padding:16px">
      <div style="margin-bottom:12px;padding:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:11px;color:#075985">
        💡 발급된 링크가 수신자 이메일로 자동 발송됩니다 (Gmail OAuth 연결 시). 검토자는 해당 링크로 read-only 접근 + 권한별 댓글 작성 가능.
      </div>
      <div class="form-row">
        <label class="form-label">권한</label>
        <select class="form-input" id="ct-share-role">
          <option value="viewer">viewer — 읽기 전용</option>
          <option value="commenter" selected>commenter — 댓글 작성 가능</option>
          <option value="approver">approver — 승인/거부 추천 가능</option>
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">만료 (일)</label>
        <input class="form-input" id="ct-share-expires" type="number" min="1" max="365" value="14">
      </div>
      <div class="form-row">
        <label class="form-label">수신자 (이름 + 이메일)</label>
        <div id="ct-share-recipients" style="margin-bottom:6px"></div>
        <button type="button" id="ct-share-add-recipient" class="btn btn-ghost btn-sm" style="font-size:11px">+ 수신자 추가</button>
      </div>
      <div class="form-row">
        <label class="form-label">메모 (선택)</label>
        <input class="form-input" id="ct-share-note" maxlength="500" placeholder="(예: 1차 법무 검토 요청)">
      </div>
    </div>`;
    const footer = `
      <button class="btn btn-ghost" id="ct-share-cancel">취소</button>
      <button class="btn btn-primary" id="ct-share-submit">🔗 발급 + 메일 발송</button>`;

    const addRow = () => {
      const wrap = document.getElementById('ct-share-recipients');
      if (!wrap) return;
      const row = document.createElement('div');
      row.className = 'ct-share-recipient-row';
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1.5fr auto;gap:8px;margin-bottom:6px';
      row.innerHTML = `
        <input class="form-input ct-share-r-name" placeholder="이름" style="font-size:12px;padding:6px 10px">
        <input class="form-input ct-share-r-email" type="email" placeholder="이메일" style="font-size:12px;padding:6px 10px">
        <button type="button" class="btn btn-ghost btn-sm ct-share-r-del" style="color:#dc2626;font-size:11px">×</button>`;
      wrap.appendChild(row);
      row.querySelector('.ct-share-r-del').addEventListener('click', () => row.remove());
    };

    Modal.open({
      title: '🔗 새 공유 링크 발급',
      body,
      footer,
      size: 'md',
      onOpen: () => {
        addRow();
        document.getElementById('ct-share-add-recipient')?.addEventListener('click', addRow);
        document.getElementById('ct-share-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('ct-share-submit')?.addEventListener('click', async () => {
          const role = document.getElementById('ct-share-role').value;
          const expiresDays = parseInt(document.getElementById('ct-share-expires').value, 10) || 14;
          const note = document.getElementById('ct-share-note').value.trim();
          const rows = Array.from(document.querySelectorAll('.ct-share-recipient-row'));
          const recipients = rows
            .map(r => ({
              name: r.querySelector('.ct-share-r-name')?.value.trim() || '',
              email: r.querySelector('.ct-share-r-email')?.value.trim() || '',
            }))
            .filter(r => r.email);
          if (!recipients.length) {
            Toast.error?.('수신자 이메일 1명 이상 입력 필요');
            return;
          }
          const btn = document.getElementById('ct-share-submit');
          btn.disabled = true;
          btn.innerHTML = '⏳ 발급 중...';
          try {
            const r = await API.contracts.share.create(contractId, {
              role,
              expires_days: expiresDays,
              note,
              recipients,
            });
            Toast.success?.(
              `공유 링크 발급 완료 — ${r?.data?.recipients_count || recipients.length}명에게 메일 발송`
            );
            Modal.close();
            // v6.0.0 fix: 콜백 (관리 모달 재오픈) 또는 본문 갱신
            if (typeof onComplete === 'function') onComplete();
            else _loadShareLinks(contractId);
          } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '🔗 발급 + 메일 발송';
            Toast.error?.('발급 실패: ' + (e?.error || e?.message || e));
          }
        });
      },
    });
  }

  // ── v6.0.0 Phase D: 댓글 섹션 ─────────────────────────────
  function _renderCommentsSection(_e) {
    return `<div style="margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:14px;font-weight:700">💬 검토 코멘트</div>
      </div>
      <div id="ct-comments-list" style="font-size:12px;margin-bottom:10px"><div class="loading" style="padding:10px;color:var(--text-3);text-align:center">불러오는 중...</div></div>
      <div style="padding-top:10px;border-top:1px solid var(--border)">
        <div style="display:flex;gap:6px;align-items:flex-start">
          <select id="ct-comment-type" class="form-input" style="width:140px;font-size:12px">
            <option value="general">의견</option>
            <option value="revise">수정 요청</option>
            <option value="approve">승인 추천</option>
            <option value="reject">거부 추천</option>
          </select>
          <textarea id="ct-comment-body" class="form-input" rows="2" placeholder="검토 의견을 입력하세요..." style="flex:1;font-size:12px"></textarea>
          <button id="ct-comment-submit" type="button" class="btn btn-primary btn-sm">💬 등록</button>
        </div>
      </div>
    </div>`;
  }

  async function _loadComments(contractId) {
    const wrap = document.getElementById('ct-comments-list');
    if (!wrap) return;
    try {
      const r = await API.contracts.comments.list(contractId);
      const comments = r?.data || [];
      if (!comments.length) {
        wrap.innerHTML = `<div style="padding:10px;text-align:center;color:var(--text-3)">아직 등록된 댓글이 없습니다</div>`;
        return;
      }
      const TYPE_LABELS = {
        general: { label: '의견', color: '#6b7280' },
        revise: { label: '수정 요청', color: '#d97706' },
        approve: { label: '승인 추천', color: '#16a34a' },
        reject: { label: '거부 추천', color: '#dc2626' },
      };
      wrap.innerHTML = comments
        .map(c => {
          const t = TYPE_LABELS[c.comment_type] || TYPE_LABELS.general;
          const author = c.author_name || c.internal_author_name || c.author_email || '익명';
          return `<div style="padding:10px;background:#fafafa;border-left:3px solid ${t.color};border-radius:4px;margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin-bottom:4px">
              <span><strong>${esc(author)}</strong>
                <span style="display:inline-block;margin-left:6px;padding:1px 6px;background:${t.color};color:#fff;border-radius:8px;font-size:9px">${esc(t.label)}</span>
              </span>
              <span>${_fmtDateTime(c.created_at)}</span>
            </div>
            <div style="font-size:12px;white-space:pre-wrap">${esc(c.body)}</div>
          </div>`;
        })
        .join('');
    } catch (e) {
      wrap.innerHTML = _renderFriendlyErrorBox('댓글 목록 조회', e);
    }
  }

  function _bindShareCommentsEvents(contractId) {
    // v6.0.0 fix: 공유 섹션 footer 버튼화 → 본문 ct-share-new-btn 핸들러 불필요
    // 댓글 등록 핸들러만 유지
    const cBtn = document.getElementById('ct-comment-submit');
    if (cBtn) {
      cBtn.addEventListener('click', async () => {
        const body = document.getElementById('ct-comment-body').value.trim();
        const commentType = document.getElementById('ct-comment-type').value;
        if (!body) {
          Toast.error?.('댓글 내용을 입력하세요');
          return;
        }
        cBtn.disabled = true;
        cBtn.textContent = '⏳';
        try {
          await API.contracts.comments.create(contractId, { body, comment_type: commentType });
          Toast.success?.('댓글 등록됨 — 관련자에게 알림 발송 (30초 디바운싱)');
          document.getElementById('ct-comment-body').value = '';
          _loadComments(contractId);
        } catch (e) {
          _showFriendlyError('댓글 등록', e);
        } finally {
          cBtn.disabled = false;
          cBtn.textContent = '💬 등록';
        }
      });
    }
    _loadComments(contractId);
  }

  // 변경 이력 (Audit Trail) — 최근 10건
  function _renderHistorySection(history) {
    if (!history.length) return '';
    const recent = history.slice(0, 10);
    const ACTION_LABELS = {
      create: '🆕 생성',
      update: '✏ 수정',
      status_change: '🔄 상태 변경',
      file_upload: '📎 파일 추가',
      file_delete: '🗑 파일 삭제',
      legal_review: '🤖 법무 검토',
    };
    return `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:13px">📋 변경 이력 (최근 ${recent.length}건)</strong>
        ${history.length > 10 ? `<span style="font-size:11px;color:var(--text-3)">전체 ${history.length}건 (최근 10건 표시)</span>` : ''}
      </div>
      <table class="data-table" style="font-size:11px">
        <thead><tr>
          <th style="width:140px">시각</th>
          <th style="width:110px">액션</th>
          <th>변경 내용</th>
          <th style="width:100px">담당자</th>
        </tr></thead>
        <tbody>
          ${recent.map(h => `<tr>
            <td style="font-size:10px;color:var(--text-3)">${_fmtDateTime(h.created_at)}</td>
            <td style="font-size:11px">${esc(ACTION_LABELS[h.action_type] || h.action_type)}</td>
            <td style="font-size:11px">${esc(h.description || (h.field_name ? `${h.field_name}: ${h.old_value || '∅'} → ${h.new_value || '∅'}` : '-'))}</td>
            <td style="font-size:11px;color:var(--text-3)">${esc(h.created_by_name || '-')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // AI 분석 가능 형식 (PDF / 이미지 / 텍스트)
  function _isAnalyzable(filename) {
    if (!filename) return false;
    return /\.(pdf|png|jpe?g|webp|txt|md)$/i.test(filename);
  }

  // ── v6.0.0 Phase A2-3: AI 추출 정보 → 사용자 확인 후 적용 카드 ──
  // AI 가 계약서에서 추출한 메타 정보 (extracted_meta) 를 표시하고
  // 사용자가 필드별로 또는 일괄로 폼에 적용할 수 있도록.
  //
  // - 비어있는 폼 필드 → [✓ 적용] 보라 버튼
  // - 이미 채워진 필드 → [⚠️ 덮어쓰기] 주황 버튼
  // - AI 값이 null → "추출 안됨" 회색 표시
  function _renderExtractedMetaCard(meta, _entity) {
    // v6.0.0 fix: meta=null 일 때도 카드 렌더 (추출 실패 안내)
    if (!meta) {
      return `<div id="ct-extracted-meta-card"
        style="border:2px dashed #d97706;border-radius:8px;padding:14px;background:linear-gradient(135deg,#fffbeb,#fef3c7);margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <div style="font-size:14px;font-weight:600;color:#92400e">🤖 AI 추출 결과 — 정보 없음</div>
            <div style="font-size:11px;color:#92400e;margin-top:4px;line-height:1.6">
              계약서 본문에서 자동 채움 정보를 추출하지 못했습니다.<br>
              <strong>아래 폼 필드를 수동으로 입력</strong>하시거나, 더 선명한 PDF/이미지로 [📎 파일 추가/교체] 후 다시 분석해보세요.
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" id="ct-meta-close-btn" type="button" title="닫기" style="color:#92400e">✕</button>
        </div>
      </div>`;
    }
    // 필드 매핑 (data-meta-key → 폼 input ID + 라벨 + 표시 변환)
    const FIELD_MAP = [
      { key: 'title', label: '계약명', formId: 'ct-f-title', icon: '📝' },
      {
        key: 'counterparty_name',
        // v6.0.0 Phase A4: 매칭 모달 분기 안내 (단순 텍스트 입력이 아님)
        label: '상대방 회사 (매칭)',
        formId: 'ct-f-customer_name',
        icon: '🏢',
      },
      {
        key: 'contract_type',
        label: '유형',
        formId: 'ct-f-contract_type',
        icon: '📋',
        // select — 표시 시 라벨로 변환
        display: v => CONTRACT_TYPE_LABELS[v] || v,
      },
      {
        key: 'amount',
        label: '계약금액',
        formId: 'ct-f-contract_amount',
        icon: '💰',
        display: v => Number(v).toLocaleString('ko-KR'),
      },
      { key: 'currency', label: '통화', formId: 'ct-f-currency', icon: '💱' },
      { key: 'start_date', label: '시작일', formId: 'ct-f-start_date', icon: '📅' },
      { key: 'end_date', label: '종료일', formId: 'ct-f-end_date', icon: '📅' },
    ];

    // 비어있는 입력값 (DOM 시점 검사 — 카드는 렌더 시점이라 entity 의 값으로 비교)
    // 단순화: render 시점엔 모두 "적용 가능" 으로 표시, 클릭 시 실제 값 비교 후 분기
    const rows = FIELD_MAP.map(f => {
      const v = meta[f.key];
      if (v === null || v === undefined || v === '') {
        // AI 가 추출 못함
        return `<tr>
          <td style="padding:6px 10px;font-size:12px;color:var(--text-3)">
            ${f.icon} ${esc(f.label)}
          </td>
          <td style="padding:6px 10px;font-size:11px;color:var(--text-3);font-style:italic">
            추출 안됨
          </td>
          <td style="padding:6px 10px;text-align:right;font-size:11px;color:var(--text-3)">
            —
          </td>
        </tr>`;
      }
      const displayVal = f.display ? f.display(v) : v;
      return `<tr data-meta-key="${esc(f.key)}">
        <td style="padding:8px 10px;font-size:12px;font-weight:500">
          ${f.icon} ${esc(f.label)}
        </td>
        <td style="padding:8px 10px;font-size:12px;color:#1f2937">
          <span class="ct-meta-val">${esc(String(displayVal))}</span>
        </td>
        <td style="padding:8px 10px;text-align:right">
          <button class="btn btn-sm ct-meta-apply-btn"
            data-meta-key="${esc(f.key)}"
            data-form-id="${esc(f.formId)}"
            data-value="${esc(String(v))}"
            type="button"
            style="font-size:11px;padding:4px 10px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:600">
            ✓ 적용
          </button>
        </td>
      </tr>`;
    }).join('');

    return `<div id="ct-extracted-meta-card"
      style="border:2px solid #0891b2;border-radius:8px;padding:14px;background:linear-gradient(135deg,#f0fdfa,#ecfeff);margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:600;color:#155e75">🤖 AI 가 추출한 정보 (검토 후 적용)</div>
          <div style="font-size:11px;color:#0e7490;margin-top:2px">
            계약서 본문에서 자동 추출 — 각 항목을 확인 후 [✓ 적용] 클릭 시 폼에 채워집니다
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="ct-meta-close-btn" type="button" title="닫기" style="color:#0e7490">✕</button>
      </div>

      <table style="width:100%;border-collapse:separate;border-spacing:0;background:#fff;border-radius:6px;overflow:hidden">
        <tbody>${rows}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div style="font-size:10px;color:#0e7490">
          ⚠️ AI 추출 결과는 100% 정확하지 않을 수 있습니다 — 적용 후 반드시 검토하세요
        </div>
        <button class="btn btn-primary btn-sm" id="ct-meta-apply-all-btn" type="button"
          style="font-size:11px;padding:5px 12px">
          ✓✓ 모두 적용
        </button>
      </div>
    </div>`;
  }

  // v6.0.0 Phase A3: 계약번호 자동/수동 토글 바인딩
  // - 자동: readonly + 회색 배경 + 자동 채번 미리보기 표시
  // - 수동: editable + 흰색 배경 + 사용자 직접 입력
  function _bindContractNoModeToggle() {
    const input = document.getElementById('ct-f-contract_no');
    if (!input) return;
    const buttons = document.querySelectorAll('.ct-no-mode-btn');
    const hint = input.parentElement?.querySelector('.ct-no-hint');
    if (!buttons.length) return;

    // 초기 상태: data-mode 가 없으면 'auto' 로 세팅
    if (!input.dataset.mode) input.dataset.mode = 'auto';
    _updateContractNoUI(input, hint, input.dataset.mode);

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        // 수동 → 자동 전환 시 원본 값 복원
        if (mode === 'auto' && input.dataset.mode === 'manual') {
          input.value = input.dataset.originalNo || '';
        }
        // 자동 → 수동 전환 시 신규 모드면 입력란 비우기 (사용자가 직접 작성)
        if (mode === 'manual' && input.dataset.mode === 'auto' && !input.dataset.originalNo) {
          input.value = '';
        }
        input.dataset.mode = mode;
        _updateContractNoUI(input, hint, mode);
        // 토글 버튼 시각화
        buttons.forEach(b => {
          const isActive = b.dataset.mode === mode;
          b.style.background = isActive ? 'var(--oci-red)' : '#f5f5f5';
          b.style.color = isActive ? '#fff' : '#666';
        });
        if (mode === 'manual') {
          // 수동 전환 시 입력란에 포커스
          setTimeout(() => input.focus(), 0);
        }
      });
    });
  }

  function _updateContractNoUI(input, hint, mode) {
    if (mode === 'manual') {
      input.removeAttribute('readonly');
      input.style.background = '#fff';
      if (hint) {
        hint.textContent =
          '수동 입력 — 양식 자유 (예: C-2026-9999, ABC-001). 중복 시 저장 거부됩니다';
        hint.style.color = '#d97706';
      }
    } else {
      input.setAttribute('readonly', '');
      input.style.background = '#fafafa';
      if (hint) {
        const orig = input.dataset.originalNo || '';
        hint.textContent = orig
          ? '자동 채번 (기존 번호 유지)'
          : '자동 채번 활성 — 저장 시 확정됩니다';
        hint.style.color = 'var(--text-3)';
      }
    }
  }

  // _renderExtractedMetaCard 의 버튼 이벤트 바인딩 (모달 onOpen 에서 호출)
  function _bindExtractedMetaCardEvents() {
    const card = document.getElementById('ct-extracted-meta-card');
    if (!card) return;

    // 개별 [✓ 적용] 버튼
    card.querySelectorAll('.ct-meta-apply-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const formId = btn.dataset.formId;
        const value = btn.dataset.value;
        const metaKey = btn.dataset.metaKey;
        const formEl = document.getElementById(formId);
        if (!formEl) {
          Toast.error?.(`폼 필드 ${formId} 를 찾을 수 없음`);
          return;
        }

        // v6.0.0 Phase A4: counterparty_name → 정규화 매칭 모달 분기
        // 단순 텍스트 적용 대신, 기존 customers 와 매칭 후 ID 자동 연결
        if (metaKey === 'counterparty_name') {
          await _openCounterpartyMatchModal(value, btn);
          return;
        }

        const existing = (formEl.value || '').trim();
        // 이미 값이 있으면 confirm
        if (existing && existing !== value) {
          if (
            !confirm(
              `이미 입력된 값 "${existing}"\n을(를) AI 추출값 "${value}"\n으로 덮어쓰시겠습니까?`
            )
          ) {
            return;
          }
        }
        // 적용
        formEl.value = value;
        // change 이벤트 트리거 (select 등이 의존할 수 있음)
        formEl.dispatchEvent(new Event('change', { bubbles: true }));
        // 버튼 상태 변경
        _markMetaBtnApplied(btn);
        // 폼 영역으로 시각적 피드백 (잠시 강조)
        formEl.style.transition = 'background-color 0.5s';
        formEl.style.backgroundColor = '#ecfeff';
        setTimeout(() => {
          formEl.style.backgroundColor = '';
        }, 1200);
      });
    });

    // [✓✓ 모두 적용] 버튼
    const allBtn = document.getElementById('ct-meta-apply-all-btn');
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        const buttons = Array.from(card.querySelectorAll('.ct-meta-apply-btn:not(:disabled)'));
        if (!buttons.length) {
          Toast.info?.('이미 모두 적용됨');
          return;
        }
        // 이미 채워진 필드가 있는지 확인 (덮어쓰기 confirm 통합)
        const conflicts = buttons
          .map(btn => {
            const el = document.getElementById(btn.dataset.formId);
            const existing = (el?.value || '').trim();
            return existing ? btn.dataset.formId : null;
          })
          .filter(Boolean);
        if (
          conflicts.length > 0 &&
          !confirm(
            `이미 입력된 ${conflicts.length}개 필드가 있습니다.\n모두 AI 추출값으로 덮어쓰시겠습니까?`
          )
        ) {
          return;
        }
        let applied = 0;
        let counterpartyName = null;
        buttons.forEach(btn => {
          const formEl = document.getElementById(btn.dataset.formId);
          if (!formEl) return;
          formEl.value = btn.dataset.value;
          formEl.dispatchEvent(new Event('change', { bubbles: true }));
          _markMetaBtnApplied(btn);
          applied++;
          // v6.0.0 fix: counterparty_name 도 적용됨 → 백그라운드 매칭 트리거
          if (btn.dataset.metaKey === 'counterparty_name') {
            counterpartyName = btn.dataset.value;
          }
        });
        Toast.success?.(`${applied}개 필드 일괄 적용`);
        // v6.0.0 fix: counterparty 채워졌으면 백그라운드 매칭 시도
        if (counterpartyName) {
          _backgroundMatchCustomer(counterpartyName).catch(() => {});
        }
      });
    }

    // [✕ 닫기] 버튼
    const closeBtn = document.getElementById('ct-meta-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        card.style.display = 'none';
      });
    }
  }

  // v6.0.0 fix: 사용자 친화 에러 메시지 (raw API 메시지 노출 금지)
  // - 콘솔에 상세 로그
  // - Toast 에는 모듈 기준 명확한 안내
  function _showFriendlyError(action, err) {
    const raw = err?.error || err?.message || err?.toString?.() || '알 수 없는 오류';
    const status = err?.status || (raw.match(/HTTP (\d+)/)?.[1] || '');
    console.error(`[contracts] ${action} 실패:`, raw, err);
    let msg = `${action} 중 오류가 발생했습니다`;
    if (status === '404' || /404|Not Found|찾을 수 없습니다/i.test(raw)) {
      msg +=
        ' — 신규 기능 라우트입니다. 서버 업데이트(git pull + pm2 restart)가 필요할 수 있습니다';
    } else if (status === '401' || /401|인증이 필요|로그인이 필요/i.test(raw)) {
      msg += ' — 인증이 만료되었습니다. 다시 로그인 후 시도하세요';
    } else if (status === '403' || /403|권한이 없|기능은 현재 비활성/i.test(raw)) {
      msg += ' — 권한이 없거나 기능이 비활성화 상태입니다 (관리자 확인 필요)';
    } else if (status === '500' || /500|서버 오류|Internal/i.test(raw)) {
      msg += ' — 서버 일시적 오류. 잠시 후 다시 시도하세요';
    } else if (/network|fetch|connect|TypeError/i.test(raw)) {
      msg += ' — 네트워크 연결 확인 또는 페이지 새로고침';
    } else if (raw.length < 100 && !/\{|\[|undefined|null/.test(raw)) {
      msg += `: ${raw}`;
    } else {
      msg += ' — 자세한 내용은 브라우저 콘솔 (F12) 을 확인하세요';
    }
    Toast.error?.(msg, { duration: 7000 });
  }

  // v6.0.0 fix: 카드/섹션 안에 표시하는 친화 에러 HTML
  function _renderFriendlyErrorBox(action, err) {
    const raw = err?.error || err?.message || '';
    const status = err?.status || (raw.match(/HTTP (\d+)/)?.[1] || '');
    console.error(`[contracts] ${action} 실패 (섹션):`, raw, err);
    let detailMsg;
    if (status === '404' || /404|Not Found|찾을 수 없습니다/i.test(raw)) {
      detailMsg = `이 기능은 최근 추가된 신규 라우트입니다.<br>
        <strong>서버 재시작</strong>(git pull + pm2 restart)이 필요할 수 있습니다.<br>
        브라우저는 <strong>Ctrl+Shift+R</strong> 로 캐시 비우기 후 재시도하세요.`;
    } else if (status === '401' || /401|인증/i.test(raw)) {
      detailMsg = `인증이 만료되었습니다. 다시 로그인 후 시도하세요.`;
    } else if (status === '403' || /기능은 현재 비활성/i.test(raw)) {
      detailMsg = `기능이 비활성화 상태입니다. 관리자에게 활성화 요청하세요.`;
    } else {
      detailMsg = `잠시 후 다시 시도하시거나, 페이지 새로고침 (Ctrl+Shift+R) 후 재시도하세요.<br>
        문제가 지속되면 운영 담당자에게 문의 (자세한 내용은 브라우저 콘솔 F12 참고).`;
    }
    return `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:12px;color:#7f1d1d">
      <div style="font-weight:600;margin-bottom:6px">⚠️ ${esc(action)} 기능을 사용할 수 없습니다</div>
      <div style="font-size:11px;color:#991b1b;line-height:1.7">${detailMsg}</div>
    </div>`;
  }

  // v6.0.0 Phase A4: 적용 완료 버튼 시각화 (공통 헬퍼)
  function _markMetaBtnApplied(btn) {
    if (!btn) return;
    btn.innerHTML = '✅ 적용됨';
    btn.disabled = true;
    btn.style.background = '#9ca3af';
    btn.style.cursor = 'default';
    btn.style.opacity = '0.7';
  }

  // v6.0.0 UX 개선: AI 추출 정보를 즉시 폼에 자동 적용 (counterparty_name 제외)
  // - counterparty_name 은 매칭 모달이 필요하므로 사용자 액션 유지
  // - 자동 적용된 필드는 시각적 강조 (1.5초 잠시 노란 배경)
  // - 카드의 해당 [✓ 적용] 버튼도 "적용됨" 상태로 전환
  // - 반환: { applied: N, needsAction: ['counterparty_name'] }
  function _autoApplyExtractedMeta(meta) {
    // v6.0.0 fix (옵션 D): counterparty_name 도 즉시 텍스트 자동 채움
    // + 백그라운드 customers.match 호출 → 정확 매치 시 customer_id 자동 할당
    console.log('[contracts:autoApply] meta=', meta);
    if (!meta) {
      console.warn('[contracts:autoApply] meta is null/undefined — skip');
      return { applied: 0, skipped: 7, needsAction: [], details: { reason: 'null' } };
    }

    // FIELD_MAP (counterparty_name 포함 — 7개)
    const AUTO_FIELDS = [
      { key: 'title', formId: 'ct-f-title' },
      { key: 'counterparty_name', formId: 'ct-f-customer_name' }, // v6.0.0 fix: 텍스트 즉시 채움
      { key: 'contract_type', formId: 'ct-f-contract_type' },
      { key: 'amount', formId: 'ct-f-contract_amount' },
      { key: 'currency', formId: 'ct-f-currency' },
      { key: 'start_date', formId: 'ct-f-start_date' },
      { key: 'end_date', formId: 'ct-f-end_date' },
    ];

    // DOM 준비 대기 (모달 렌더 직후일 수 있음) — 폼 필드가 없으면 100ms 후 재시도 (최대 5회)
    const _doApply = retries => {
      let applied = 0;
      let skipped = 0;
      const appliedList = [];
      const skippedList = [];
      AUTO_FIELDS.forEach(f => {
        const v = meta[f.key];
        if (v === null || v === undefined || v === '') {
          skipped++;
          skippedList.push({ key: f.key, reason: 'no-value' });
          return;
        }
        const el = document.getElementById(f.formId);
        if (!el) {
          skipped++;
          skippedList.push({ key: f.key, reason: 'no-element' });
          return;
        }
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // 시각적 강조 (3초)
        el.style.transition = 'background-color 0.5s';
        el.style.backgroundColor = '#fef3c7';
        setTimeout(() => {
          el.style.backgroundColor = '';
        }, 3000);
        // 카드의 해당 [✓ 적용] 버튼도 "적용됨" 처리
        const cardBtn = document.querySelector(`.ct-meta-apply-btn[data-meta-key="${f.key}"]`);
        if (cardBtn) _markMetaBtnApplied(cardBtn);
        applied++;
        appliedList.push({ key: f.key, value: v, formId: f.formId });
      });

      console.log(`[contracts:autoApply] applied=${applied} skipped=${skipped}`, {
        appliedList,
        skippedList,
      });

      // 모든 필드가 no-element 이면 DOM 미준비 가능성 → 재시도
      const allNoElement =
        skippedList.length > 0 &&
        skippedList.every(s => s.reason === 'no-element' || s.reason === 'no-value');
      const hasValues = AUTO_FIELDS.some(f => meta[f.key] !== null && meta[f.key] !== undefined);
      if (applied === 0 && allNoElement && hasValues && retries < 5) {
        console.log(`[contracts:autoApply] DOM not ready — retry ${retries + 1}/5`);
        setTimeout(() => _doApply(retries + 1), 100);
      }

      return { applied, skipped, appliedList, skippedList };
    };

    const result = _doApply(0);

    // v6.0.0 fix: counterparty_name 채움 후 → 백그라운드 customers.match 호출
    // 정확 매치 1건 → customer_id 자동 할당 + Toast
    // 매치 없음 → customer_id null 유지 (사용자가 명시적 [✓ 적용] 클릭 시 매칭 모달)
    if (meta.counterparty_name) {
      _backgroundMatchCustomer(meta.counterparty_name).catch(e =>
        console.warn('[contracts:autoApply] 백그라운드 매칭 실패:', e?.message)
      );
    }

    return { applied: result.applied, skipped: result.skipped, needsAction: [], details: result };
  }

  // v6.0.0 fix: 백그라운드 고객사 매칭 (자동 customer_id 할당)
  async function _backgroundMatchCustomer(name) {
    if (!name || !API?.customers?.match) return;
    try {
      const r = await API.customers.match(name);
      const exact = Array.isArray(r?.data?.exact) ? r.data.exact : [];
      const partial = Array.isArray(r?.data?.partial) ? r.data.partial : [];
      const idField = document.getElementById('ct-f-customer_id');

      if (exact.length === 1) {
        // 정확 매치 1건 → 자동 customer_id 할당
        const matched = exact[0];
        if (idField) idField.value = String(matched.id);
        Toast.success?.(
          `🏢 고객사 자동 연결: ${matched.name} (#${matched.id})`,
          { duration: 5000 }
        );
      } else if (exact.length > 1) {
        // 여러 정확 매치 → 사용자 선택 필요 (모달 자동 오픈)
        Toast.info?.(
          `🏢 정확 일치 ${exact.length}건 발견 — 카드 [✓ 적용]으로 선택하세요`,
          { duration: 6000 }
        );
      } else if (partial.length > 0) {
        // 유사 매치만 있음 → 사용자 확인 필요
        Toast.info?.(
          `🏢 유사 고객사 ${partial.length}건 발견 — 카드 [✓ 적용]으로 매칭/신규 등록`,
          { duration: 6000 }
        );
      } else {
        // 매치 없음 → 텍스트만 유지 (사용자가 원하면 매칭 모달에서 신규 등록)
        Toast.info?.(
          `🆕 "${name}" — 기존 고객사 없음 (필요 시 [✓ 적용]으로 신규 등록)`,
          { duration: 5000 }
        );
      }
    } catch (e) {
      console.warn('[contracts:bgMatch] 실패:', e?.message);
    }
  }

  // v6.0.0 Phase A4: AI 추출 상대방 회사명 → 매칭 모달
  // 1) API.customers.match 호출 → exact/partial 후보 표시
  // 2) 사용자가 후보 선택 시 → ct-f-customer_id + ct-f-customer_name + ct-f-customer-search 자동 채움
  // 3) 매칭 없거나 사용자가 [신규 등록] 선택 시 → 빠른 등록 미니 폼
  async function _openCounterpartyMatchModal(rawName, sourceBtn) {
    if (!rawName) return;
    if (typeof Modal === 'undefined' || typeof Modal.open !== 'function') {
      Toast.error?.('Modal 컴포넌트를 찾을 수 없습니다');
      return;
    }
    let matchResp;
    try {
      matchResp = await API.customers.match(rawName);
    } catch (e) {
      Toast.error?.('고객사 매칭 조회 실패: ' + (e.message || e));
      return;
    }
    const data = matchResp?.data || {};
    const exact = Array.isArray(data.exact) ? data.exact : [];
    const partial = Array.isArray(data.partial) ? data.partial : [];
    const normalized = data.normalized_query || rawName;

    const renderCandidate = (c, type) => {
      const isExact = type === 'exact';
      const bg = isExact ? '#dcfce7' : '#fef3c7';
      const border = isExact ? '#16a34a' : '#d97706';
      const icon = isExact ? '✅' : '⚠️';
      const label = isExact ? '정확 일치' : '유사';
      return `<div class="ct-match-card" data-cid="${c.id}" data-cname="${esc(c.name)}"
        style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:${bg};border:1px solid ${border};border-radius:6px;margin-bottom:6px;cursor:pointer">
        <div>
          <div style="font-weight:600;font-size:13px;color:#111">${icon} ${esc(c.name)}
            <span style="font-size:10px;padding:1px 6px;background:${border};color:#fff;border-radius:8px;margin-left:6px">${label}</span>
          </div>
          <div style="font-size:11px;color:#374151;margin-top:2px">
            ${c.industry ? esc(c.industry) + ' · ' : ''}${c.region ? esc(c.region) + ' · ' : ''}${c.contact_person ? '👤 ' + esc(c.contact_person) : ''}
          </div>
        </div>
        <button class="btn btn-primary btn-sm ct-match-select-btn" type="button"
          data-cid="${c.id}" data-cname="${esc(c.name)}"
          style="font-size:11px;padding:5px 12px">선택</button>
      </div>`;
    };

    const allCandidates = [
      ...exact.map(c => renderCandidate(c, 'exact')),
      ...partial.map(c => renderCandidate(c, 'partial')),
    ].join('');

    const body = `
      <div style="padding:16px">
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 12px;margin-bottom:14px">
          <div style="font-size:11px;color:#0369a1;margin-bottom:2px">AI 추출 회사명</div>
          <div style="font-weight:600;font-size:14px;color:#0c4a6e">${esc(rawName)}</div>
          ${
            normalized !== rawName
              ? `<div style="font-size:10px;color:#0369a1;margin-top:4px">정규화: <code style="background:#fff;padding:1px 4px;border-radius:3px">${esc(normalized)}</code> (법인 접미사 제거 후 검색)</div>`
              : ''
          }
        </div>

        ${
          allCandidates
            ? `<div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px">📋 기존 고객사 매칭 결과 ${exact.length + partial.length}건</div>
               <div style="max-height:280px;overflow-y:auto;margin-bottom:14px">${allCandidates}</div>`
            : `<div style="text-align:center;padding:24px;color:#6b7280;font-size:13px;background:#f9fafb;border-radius:6px;margin-bottom:14px">
                 🔍 매칭되는 기존 고객사가 없습니다
               </div>`
        }

        <div style="border-top:1px dashed var(--border);padding-top:12px;margin-top:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">매칭이 없거나 새로운 고객사라면</div>
          <button class="btn btn-secondary" id="ct-match-create-btn" type="button" style="width:100%">
            ➕ "${esc(rawName)}" 을(를) 신규 고객사로 등록
          </button>
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-ghost" id="ct-match-cancel-btn" type="button">취소</button>`;

    Modal.open({
      title: '🏢 상대방 회사 매칭',
      body,
      footer,
      size: 'md',
      bind: {
        '#ct-match-cancel-btn': () => Modal.close(),
      },
      onOpen: () => {
        // 후보 선택
        document.querySelectorAll('.ct-match-select-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const cid = parseInt(btn.dataset.cid, 10);
            const cname = btn.dataset.cname;
            _applyCustomerMatch(cid, cname, sourceBtn);
            Modal.close();
          });
        });
        // 카드 전체 클릭도 선택으로 동작
        document.querySelectorAll('.ct-match-card').forEach(card => {
          card.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            const cid = parseInt(card.dataset.cid, 10);
            const cname = card.dataset.cname;
            _applyCustomerMatch(cid, cname, sourceBtn);
            Modal.close();
          });
        });
        // 신규 등록
        const createBtn = document.getElementById('ct-match-create-btn');
        if (createBtn) {
          createBtn.addEventListener('click', async () => {
            createBtn.disabled = true;
            createBtn.innerHTML = '⏳ 등록 중...';
            try {
              const res = await API.customers.create({ name: rawName, region: '국내' });
              const newId = res?.data?.id || res?.id;
              if (!newId) throw new Error('생성된 ID 응답 없음');
              Toast.success?.(`신규 고객사 "${rawName}" 등록 완료 (#${newId})`);
              _applyCustomerMatch(newId, rawName, sourceBtn);
              Modal.close();
            } catch (e) {
              createBtn.disabled = false;
              createBtn.innerHTML = `➕ "${esc(rawName)}" 을(를) 신규 고객사로 등록`;
              Toast.error?.('신규 등록 실패: ' + (e.message || e));
            }
          });
        }
      },
    });
  }

  // v6.0.0 Phase A4: 매칭된 customer_id 를 폼에 적용 (3개 필드 동기화)
  function _applyCustomerMatch(customerId, customerName, sourceBtn) {
    if (!customerId || !customerName) return;
    // 1) hidden customer_id
    const idField = document.getElementById('ct-f-customer_id');
    if (idField) idField.value = String(customerId);
    // 2) display customer_name (텍스트 input)
    const nameField = document.getElementById('ct-f-customer_name');
    if (nameField) {
      nameField.value = customerName;
      nameField.style.transition = 'background-color 0.5s';
      nameField.style.backgroundColor = '#ecfeff';
      setTimeout(() => {
        nameField.style.backgroundColor = '';
      }, 1200);
    }
    // 3) Combobox 검색 input (있으면)
    const searchField = document.getElementById('ct-f-customer-search');
    if (searchField) searchField.value = customerName;

    // 4) 소스 버튼 (AI 추출 카드의 적용 버튼) 상태 변경
    _markMetaBtnApplied(sourceBtn);

    Toast.success?.(`고객사 연결: ${customerName} (#${customerId})`);
  }

  // AI 법무 검토 결과 카드 (색상 코드 + 4섹션)
  function _renderLegalReview(d) {
    if (!d) return '';
    const score = Math.max(0, Math.min(100, parseInt(d.review_score, 10) || 0));
    const risk = d.risk_level || 'medium';
    const riskColors = { high: '#dc2626', medium: '#ca8a04', low: '#16a34a' };
    const riskLabels = { high: '높은 위험', medium: '중간 위험', low: '낮은 위험' };
    const riskColor = riskColors[risk] || '#6b7280';
    const riskLabel = riskLabels[risk] || risk;

    const toxic = Array.isArray(d.toxic_clauses) ? d.toxic_clauses : [];
    const missing = Array.isArray(d.missing_clauses) ? d.missing_clauses : [];
    const improve = Array.isArray(d.improvement_suggestions) ? d.improvement_suggestions : [];
    const lc = d.legal_compliance || {};
    const sevColors = { high: '#dc2626', medium: '#ca8a04', low: '#6b7280' };
    const sevLabels = { high: '높음', medium: '중간', low: '낮음' };

    const lawRow = (name, key) => {
      const row = lc[key] || {};
      const ok = row.compliant === true;
      const issues = Array.isArray(row.issues) ? row.issues : [];
      const color = ok ? '#16a34a' : '#dc2626';
      const icon = ok ? '✅' : '⚠️';
      return `<div style="padding:8px 12px;background:${ok ? '#f0fdf4' : '#fef2f2'};border:1px solid ${ok ? '#bbf7d0' : '#fecaca'};border-radius:6px;margin-bottom:6px">
        <div style="font-weight:600;color:${color};font-size:12px">${icon} ${esc(name)} ${ok ? '부합' : '위반 가능성'}</div>
        ${issues.length > 0 ? `<ul style="margin:4px 0 0 18px;font-size:11px;color:#374151">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div>`;
    };

    return `<div class="ct-legal-card" style="border:2px solid ${riskColor};border-radius:8px;padding:14px;background:#fafafa;margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:14px;font-weight:600">🤖 AI 법무 검토 결과</div>
          ${d.target_filename ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px">${esc(d.target_filename)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" id="ct-legal-close-btn" type="button" title="닫기">✕</button>
      </div>

      <!-- 점수 + 위험도 -->
      <div style="display:grid;grid-template-columns:120px 1fr;gap:14px;margin-bottom:14px">
        <div style="text-align:center;padding:12px;background:#fff;border:2px solid ${riskColor};border-radius:8px">
          <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">안전성 점수</div>
          <div style="font-size:28px;font-weight:700;color:${riskColor}">${score}<span style="font-size:14px;opacity:0.6">/100</span></div>
          <div style="margin-top:6px;display:inline-block;padding:2px 10px;background:${riskColor};color:#fff;border-radius:10px;font-size:11px;font-weight:600">${esc(riskLabel)}</div>
        </div>
        <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">위험 항목 요약</div>
          <div style="display:flex;gap:14px;font-size:13px">
            <div>🔴 독소조항 <strong>${toxic.length}</strong>건</div>
            <div>🟡 누락조항 <strong>${missing.length}</strong>건</div>
            <div>💡 개선 제안 <strong>${improve.length}</strong>건</div>
          </div>
          ${d.generated_at ? `<div style="margin-top:8px;font-size:10px;color:var(--text-3)">생성: ${_fmtDateTime(d.generated_at)}</div>` : ''}
        </div>
      </div>

      <!-- v6.0.0 fix: 순서 변경 — 종합평가 펼침(맨 위), 나머지 접기 -->
      ${_renderLegalSection('overall', '📝', '종합 평가', d.overall_assessment ? 1 : 0, '7c3aed', true, `
        <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.6">${esc(d.overall_assessment || '')}</div>`)}

      ${_renderLegalSection('toxic', '🔴', '독소조항', toxic.length, 'dc2626', false, `
        <ul style="margin:0;padding-left:0;list-style:none">
          ${toxic.map(c => `<li style="margin-bottom:10px;padding:10px;background:#fef2f2;border-left:3px solid ${sevColors[c.severity] || '#dc2626'};border-radius:4px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong style="font-size:12px">${esc(c.clause_type)} ${c.location ? `<span style="font-weight:400;color:var(--text-3);font-size:11px">— ${esc(c.location)}</span>` : ''}</strong>
              <span style="font-size:10px;padding:1px 8px;background:${sevColors[c.severity] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[c.severity] || c.severity)}</span>
            </div>
            ${c.original_text ? `<div style="font-size:11px;color:#7f1d1d;margin:4px 0;padding:6px 8px;background:#fee;border-radius:4px;font-family:serif">"${esc(c.original_text)}"</div>` : ''}
            ${c.why_problematic ? `<div style="font-size:11px;color:#374151;margin:4px 0">⚠️ ${esc(c.why_problematic)}</div>` : ''}
            ${c.suggested_fix ? `<div style="font-size:11px;color:#065f46;margin-top:4px;padding:6px 8px;background:#f0fdf4;border-radius:4px">💡 <strong>수정안:</strong> ${esc(c.suggested_fix)}</div>` : ''}
          </li>`).join('')}
        </ul>`)}

      ${_renderLegalSection('missing', '🟡', '누락 조항', missing.length, 'ca8a04', false, `
        <ul style="margin:0;padding-left:0;list-style:none">
          ${missing.map(m => `<li style="margin-bottom:8px;padding:8px 10px;background:#fffbeb;border-left:3px solid ${sevColors[m.importance] || '#ca8a04'};border-radius:4px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong style="font-size:12px">${esc(m.clause_type)}</strong>
              <span style="font-size:10px;padding:1px 8px;background:${sevColors[m.importance] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[m.importance] || m.importance)}</span>
            </div>
            ${m.suggested_addition ? `<div style="font-size:11px;color:#374151">${esc(m.suggested_addition)}</div>` : ''}
          </li>`).join('')}
        </ul>`)}

      ${_renderLegalSection('compliance', '🇰🇷', '한국 법규 부합', 3, '0891b2', false, `
        ${lawRow('공정거래법', 'fair_trade_act')}
        ${lawRow('하도급법', 'subcontract_act')}
        ${lawRow('개인정보보호법', 'privacy_act')}`)}

      ${_renderLegalSection('improve', '💡', '개선 제안', improve.length, '6b7280', false, `
        <ul style="margin:0;padding-left:18px;font-size:12px">
          ${improve.map(s => `<li><strong>${esc(s.section)}</strong>: ${esc(s.suggestion)}</li>`).join('')}
        </ul>`)}
    </div>`;
  }

  // v6.0.0 UX: AI 결과 섹션 collapsible 렌더 헬퍼
  // - id: 섹션 식별자 (data-legal-section)
  // - count: 헤더에 표시할 건수 (0 이면 회색)
  // - defaultOpen: 기본 펼침 여부 (true 면 펼쳐서 시작)
  function _renderLegalSection(id, icon, title, count, color, defaultOpen, contentHtml) {
    if (count === 0) {
      // 0건이면 섹션 자체 안 보임
      return '';
    }
    const display = defaultOpen ? '' : 'none';
    const symbol = defaultOpen ? '▼' : '▶';
    return `<div style="margin-bottom:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <button type="button" class="ct-legal-section-toggle" data-legal-section="${id}"
        style="width:100%;text-align:left;padding:8px 12px;background:#f9fafb;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;color:#${color}">
        <span>${icon} ${esc(title)} <span style="font-weight:400;color:var(--text-3)">(${count}건)</span></span>
        <span class="ct-legal-section-arrow" data-section="${id}">${symbol}</span>
      </button>
      <div class="ct-legal-section-body" data-section="${id}" style="display:${display};padding:10px;background:#fff">
        ${contentHtml}
      </div>
    </div>`;
  }

  // 섹션 토글 이벤트 바인딩 (모달 onOpen + AI 검토 완료 후 호출)
  function _bindLegalSectionToggles() {
    document.querySelectorAll('.ct-legal-section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.legalSection;
        const body = document.querySelector(`.ct-legal-section-body[data-section="${id}"]`);
        const arrow = document.querySelector(`.ct-legal-section-arrow[data-section="${id}"]`);
        if (!body || !arrow) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? '' : 'none';
        arrow.textContent = isHidden ? '▼' : '▶';
      });
    });
  }

  function _renderFileList(files, contractId) {
    if (!files.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">아직 첨부 파일 없음</div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:90px">유형</th>
        <th>파일명</th>
        <th style="width:90px">크기</th>
        <th style="width:120px">등록일</th>
        <th style="width:200px;text-align:center">작업</th>
      </tr></thead>
      <tbody>
        ${files.map(f => {
          const analyzable = _isAnalyzable(f.original_filename);
          return `<tr>
            <td><span class="badge badge-gray">${esc(f.file_type || '-')}</span></td>
            <td>${esc(f.original_filename)}</td>
            <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
            <td>${_fmtDate(f.created_at)}</td>
            <td style="text-align:center;white-space:nowrap">
              ${analyzable
                ? `<button class="btn btn-ghost btn-sm ct-legal-btn" data-id="${f.id}" data-name="${esc(f.original_filename)}" type="button" title="AI 법무 검토" style="font-size:11px;padding:2px 6px;color:#7c3aed">🤖 법무</button>`
                : `<span style="display:inline-block;font-size:10px;color:var(--text-3);padding:2px 6px" title="PDF/이미지/텍스트만 AI 분석 가능">—</span>`}
              <a class="btn btn-ghost btn-sm" href="${API.contracts.downloadFileUrl(contractId, f.id)}" data-ct-file-download="${f.id}" title="다운로드" style="font-size:11px;padding:2px 6px">다운로드</a>
              <button class="btn btn-ghost btn-sm ct-file-del" data-id="${f.id}" type="button" style="color:#d93025;font-size:11px;padding:2px 6px" title="삭제">삭제</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  function _bindFileEvents(contractId) {
    // v6.0.0 UX 개선: 하단 [+ 파일 추가] 버튼은 제거됨 (AI 카드에서 직접 첨부)
    // 파일 행의 삭제/다운로드/법무 검토 핸들러는 그대로 유지
    document.querySelectorAll('.ct-file-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 파일을 삭제하시겠습니까?')) return;
        try {
          await API.contracts.deleteFile(contractId, parseInt(btn.dataset.id, 10));
          Toast.success?.('파일 삭제됨');
          await _reopenModalFresh(contractId);
        } catch (err) {
          Toast.error?.('삭제 실패: ' + (err.message || err));
        }
      });
    });

    // [🤖 법무] AI 법무 검토 실행
    document.querySelectorAll('.ct-legal-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        const name = btn.dataset.name || '계약서';
        const ok = confirm(
          `🤖 AI 법무 검토를 실행하시겠습니까?\n\n` +
            `대상 파일: ${name}\n\n` +
            `Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서 ` +
            `독소조항·누락조항·수정안을 분석합니다.\n\n` +
            `• 소요 시간: 약 30-60초\n` +
            `• 예상 비용: 약 500-1000원/회\n\n` +
            `계속하시겠습니까?`
        );
        if (!ok) return;
        const origText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '⏳';
        try {
          Toast.info?.('AI 법무 검토 중... (최대 60초 소요)');
          const res = await API.contracts.legalReview(contractId, fileId);
          const data = res?.data;
          if (!data) throw new Error('응답 비어있음');
          Toast.success?.(
            `AI 법무 검토 완료 — 점수 ${data.review_score}, 위험도 ${data.risk_level}`
          );
          const wrap = document.getElementById('ct-legal-review-wrap');
          if (wrap) {
            // v6.0.0 Phase A2-3: extracted_meta 카드 + 법무 검토 결과 카드 동시 렌더
            wrap.innerHTML =
              (data.extracted_meta ? _renderExtractedMetaCard(data.extracted_meta, null) : '') +
              _renderLegalReview(data);
            wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
            _bindLegalCloseBtn();
            _bindExtractedMetaCardEvents();

            // v6.0.0 UX 개선: AI 추출 정보 즉시 자동 채움 (counterparty 제외)
            if (data.extracted_meta) {
              const { applied, needsAction } = _autoApplyExtractedMeta(data.extracted_meta);
              if (applied > 0) {
                Toast.success?.(`AI 추출 정보 ${applied}개 자동 채움됨`);
              }
              if (needsAction.includes('counterparty_name')) {
                Toast.info?.(
                  `상대방 회사명 "${data.extracted_meta.counterparty_name}" — 카드에서 [✓ 적용] 클릭 시 매칭/신규 등록 가능`,
                  { duration: 7000 }
                );
              }
            }
          }
        } catch (err) {
          console.error('[contracts:legal-review] failed:', err);
          const detail = err?.error || err?.message || String(err);
          Toast.error?.('AI 법무 검토 실패: ' + detail, { duration: 8000 });
        } finally {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      });
    });
    _bindLegalCloseBtn();

    // 다운로드 (인증 헤더 fetch) — v6.0.0 fix: localStorage + sessionStorage fallback
    document.querySelectorAll('[data-ct-file-download]').forEach(a => {
      a.addEventListener('click', async ev => {
        ev.preventDefault();
        const fileId = parseInt(a.dataset.ctFileDownload, 10);
        try {
          // v6.0.0 fix: 토큰 + userId 양쪽 storage 확인 (login 옵션에 따라 다름)
          const token =
            localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
          const userId =
            localStorage.getItem('current_user_id') ||
            sessionStorage.getItem('current_user_id') ||
            '';
          if (!token && !userId) {
            Toast.error?.('인증 정보가 없습니다 — 다시 로그인 후 시도하세요');
            return;
          }
          const res = await fetch(API.contracts.downloadFileUrl(contractId, fileId), {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(userId ? { 'X-User-Id': userId } : {}),
            },
            credentials: 'include',
          });
          if (res.status === 401) {
            Toast.error?.('인증이 만료되었습니다 — 다시 로그인하세요');
            return;
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const aDl = document.createElement('a');
          aDl.href = url;
          const cd = res.headers.get('Content-Disposition') || '';
          const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
          aDl.download = m ? decodeURIComponent(m[1]) : 'contract_file';
          document.body.appendChild(aDl);
          aDl.click();
          aDl.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          _showFriendlyError('파일 다운로드', err);
        }
      });
    });
  }

  function _bindLegalCloseBtn() {
    const closeBtn = document.getElementById('ct-legal-close-btn');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      const wrap = document.getElementById('ct-legal-review-wrap');
      if (wrap) wrap.innerHTML = '';
    });
  }

  // Step 3: 메인 AI 법무 검토 CTA 버튼 핸들러
  // 모달 상단의 큰 CTA — 가장 최근에 업로드한 분석 가능 파일을 자동 선택
  // v6.0.0 UX 개선: AI 검토 카드 내부에서 파일 첨부 (메인 흐름)
  // - [📎 계약서 파일 첨부] 버튼 클릭 → 파일 다이얼로그
  // - 카드 영역에 파일 드래그&드롭
  // - 업로드 완료 후 모달 재오픈 (검토 가능 상태로 전환)
  function _bindCtaFileAttach(contractId) {
    const input = document.getElementById('ct-cta-file-input');
    const mainBtn = document.getElementById('ct-cta-file-add-btn'); // 분석 가능 파일 없을 때
    const moreBtn = document.getElementById('ct-cta-file-add-btn-more'); // 이미 있을 때 추가/교체
    const card = document.getElementById('ct-legal-cta-card');
    if (!input) return;

    const openPicker = () => input.click();
    if (mainBtn) mainBtn.addEventListener('click', openPicker);
    if (moreBtn) moreBtn.addEventListener('click', openPicker);

    const doUpload = async fileList => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('file_type', 'contract');
      try {
        Toast.info?.(`${files.length}개 파일 업로드 중...`);
        await API.contracts.uploadFile(contractId, fd);
        Toast.success?.(`${files.length}개 파일 업로드 완료 — AI 검토 가능`);
        await _reopenModalFresh(contractId);
      } catch (err) {
        Toast.error?.('업로드 실패: ' + (err.message || err));
      }
    };

    input.addEventListener('change', async ev => {
      await doUpload(ev.target.files);
      ev.target.value = '';
    });

    // 드래그&드롭 (분석 가능 파일 없을 때만 강조)
    if (card && mainBtn) {
      const setDragStyle = active => {
        card.style.background = active
          ? 'linear-gradient(135deg,#ddd6fe,#c4b5fd)'
          : 'linear-gradient(135deg,#faf5ff,#f3e8ff)';
        card.style.borderColor = active ? '#7c3aed' : '#7c3aed';
        card.style.borderStyle = active ? 'solid' : 'dashed';
      };
      ['dragenter', 'dragover'].forEach(evt => {
        card.addEventListener(evt, e => {
          e.preventDefault();
          e.stopPropagation();
          setDragStyle(true);
        });
      });
      ['dragleave', 'dragend'].forEach(evt => {
        card.addEventListener(evt, e => {
          e.preventDefault();
          e.stopPropagation();
          setDragStyle(false);
        });
      });
      card.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        setDragStyle(false);
        if (e.dataTransfer?.files?.length) {
          await doUpload(e.dataTransfer.files);
        }
      });
    }
  }

  function _bindLegalCtaBtn(contractId) {
    // v6.0.0 UX 개선: 카드 내부 [📎 파일 첨부] 버튼 + 드래그앤드롭 바인딩
    _bindCtaFileAttach(contractId);

    const btn = document.getElementById('ct-legal-cta-btn');
    if (!btn) return;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
    });
    btn.addEventListener('click', async () => {
      // _list 에는 목록 행이 있지만, files 는 모달 진입 시 entity 에서만 받음
      // 가장 안전한 방법: API.contracts.get 으로 재조회 → 최신 파일 선택
      let entity;
      try {
        const r = await API.contracts.get(contractId);
        entity = r?.data;
      } catch (err) {
        Toast.error?.('계약 정보 조회 실패: ' + (err.message || err));
        return;
      }
      const files = Array.isArray(entity?.files) ? entity.files : [];
      const analyzable = files.filter(f => _isAnalyzable(f.original_filename));
      if (!analyzable.length) {
        Toast.error?.('분석 가능한 파일이 없습니다 (PDF/이미지/TXT)');
        return;
      }
      // 최신 첨부 파일 선택 (목록은 created_at DESC 정렬)
      const target = analyzable[0];
      const ok = confirm(
        `🤖 AI 법무 검토를 실행하시겠습니까?\n\n` +
          `대상 파일: ${target.original_filename}\n\n` +
          `Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서 ` +
          `독소조항·누락조항·수정안을 분석합니다.\n\n` +
          `• 소요 시간: 약 30-60초\n` +
          `• 예상 비용: 약 500-1000원/회\n\n` +
          `계속하시겠습니까?`
      );
      if (!ok) return;
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳ AI 분석 중... (최대 60초)';
      try {
        Toast.info?.('AI 법무 검토 중... (최대 60초 소요)');
        const res = await API.contracts.legalReview(contractId, target.id);
        const data = res?.data;
        if (!data) throw new Error('응답 비어있음');
        Toast.success?.(
          `AI 법무 검토 완료 — 점수 ${data.review_score}, 위험도 ${data.risk_level}`
        );
        const wrap = document.getElementById('ct-legal-review-wrap');
        if (wrap) {
          // v6.0.0 fix: 순서 변경 — 법무 검토 결과(주) 먼저, AI 추출 카드(보조)는 아래
          wrap.innerHTML =
            _renderLegalReview(data) +
            _renderExtractedMetaCard(data.extracted_meta || null, null);
          wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
          _bindLegalCloseBtn();
          _bindExtractedMetaCardEvents();
          _bindLegalSectionToggles(); // v6.0.0 신규: AI 결과 섹션별 접기

          // v6.0.0 UX 개선: AI 추출 정보 즉시 자동 채움 (counterparty 제외)
          if (data.extracted_meta) {
            const { applied, needsAction, skipped } = _autoApplyExtractedMeta(data.extracted_meta);
            if (applied > 0) {
              Toast.success?.(`AI 추출 정보 ${applied}개 자동 채움됨`);
            } else if (skipped === 6) {
              Toast.info?.('AI가 추출한 정보가 없습니다 — 수동 입력하세요');
            }
            if (needsAction.includes('counterparty_name')) {
              Toast.info?.(
                `상대방 회사명 "${data.extracted_meta.counterparty_name}" — 카드에서 [✓ 적용] 클릭 시 매칭/신규 등록 가능`,
                { duration: 7000 }
              );
            }
          } else {
            Toast.warning?.(
              'AI 가 계약서에서 정보를 추출하지 못했습니다 — 수동 입력 후 저장하세요',
              { duration: 6000 }
            );
          }
        }
      } catch (err) {
        console.error('[contracts:legal-review:cta] failed:', err);
        const detail = err?.error || err?.message || String(err);
        Toast.error?.('AI 법무 검토 실패: ' + detail, { duration: 8000 });
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    });
  }

  async function _reopenModalFresh(contractId) {
    Modal.close();
    await _refreshList();
    // 임시 모드 유지 (사용자가 파일 첨부 후 모달 재진입 시 안내 카드 유지)
    const isTempMode = _tempContractId === contractId;
    await _openModal(contractId, { isTempMode });
  }

  // v6.0.0 Step 2 Commit 4: 4개 연결 Combobox 부착
  // - hidden #ct-f-{type}_id 가 실제 저장값, 표시는 #ct-f-{type}-search 텍스트
  // - 사용자가 텍스트 직접 수정 시 hidden id 해제 (정확한 선택만 저장)
  // - Combobox 미로드 시 graceful skip (이전 ID 그대로 유지)
  function _attachLinkComboboxes() {
    if (typeof Combobox === 'undefined') return;

    const setup = ({ inputId, hiddenId, fetchFn, renderItem, onSelect }) => {
      const inp = document.getElementById(inputId);
      const hid = document.getElementById(hiddenId);
      if (!inp || !hid) return;
      inp.addEventListener('input', () => {
        // 사용자가 텍스트 수정 시 hidden id 해제
        if (hid.value) hid.value = '';
      });
      Combobox.attach({
        inputEl: inp,
        fetchFn,
        renderItem,
        onSelect: item => {
          hid.value = item.id;
          onSelect(item);
        },
        minChars: 2,
        debounceMs: 250,
        allowCustom: false,
        customLabel: '(검색 결과만 선택 가능)',
      });
    };

    // 🏢 고객사
    setup({
      inputId: 'ct-f-customer-search',
      hiddenId: 'ct-f-customer_id',
      fetchFn: async q => {
        try {
          const r = await API.customers.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.industry, item.region].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">🏢 ${highlightMatch(item.name, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-customer-search').value = item.name;
        // 고객사명도 함께 자동 채움
        const nameField = document.getElementById('ct-f-customer_name');
        if (nameField) nameField.value = item.name;
      },
    });

    // 📌 영업리드
    setup({
      inputId: 'ct-f-lead-search',
      hiddenId: 'ct-f-lead_id',
      fetchFn: async q => {
        try {
          const r = await API.leads.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.stage].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📌 ${highlightMatch(item.project_name || `리드 #${item.id}`, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-lead-search').value =
          item.project_name || `리드 #${item.id}`;
        // 고객사 자동 채움 (비어있을 때만)
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
      },
    });

    // 📝 제안
    setup({
      inputId: 'ct-f-proposal-search',
      hiddenId: 'ct-f-proposal_id',
      fetchFn: async q => {
        try {
          const r = await API.proposals.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.status].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📝 ${esc(item.proposal_no)} — ${highlightMatch(item.proposal_title, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-proposal-search').value =
          `${item.proposal_no} — ${item.proposal_title}`;
        // lead_id / customer_id 자동 채움 (비어있을 때만)
        if (item.lead_id && !document.getElementById('ct-f-lead_id').value) {
          document.getElementById('ct-f-lead_id').value = item.lead_id;
        }
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
      },
    });

    // 📊 견적
    setup({
      inputId: 'ct-f-quote-search',
      hiddenId: 'ct-f-quote_id',
      fetchFn: async q => {
        try {
          const r = await API.quotes.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.status].filter(Boolean).join(' · ');
        const amount = item.total_amount
          ? Number(item.total_amount).toLocaleString('ko-KR') + ' 원'
          : '';
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📊 ${esc(item.quote_no)} — ${highlightMatch(item.name, q)}</div>
          ${meta || amount ? `<div class="combobox-item-meta">${esc(meta)}${amount ? ` · ${amount}` : ''}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-quote-search').value =
          `${item.quote_no} — ${item.name}`;
        // lead_id / customer_id 자동 채움 (비어있을 때만)
        if (item.lead_id && !document.getElementById('ct-f-lead_id').value) {
          document.getElementById('ct-f-lead_id').value = item.lead_id;
        }
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
        // 금액 자동 채움 (비어있을 때만)
        if (item.total_amount) {
          const amtField = document.getElementById('ct-f-contract_amount');
          if (amtField && !amtField.value) amtField.value = item.total_amount;
        }
      },
    });
  }

  function _collectForm() {
    // v6.0.0 Phase A3: 채번 모드 — 수동일 때만 contract_no 전송, 자동이면 백엔드 채번
    const noInput = document.getElementById('ct-f-contract_no');
    const noMode = noInput?.dataset?.mode || 'auto'; // 'auto' | 'manual'
    const noOriginal = noInput?.dataset?.originalNo || '';
    const noCurrent = noInput?.value?.trim() || '';
    let contractNoToSend;
    if (noMode === 'manual') {
      // 수동 모드: 항상 입력값 전송 (빈값이면 백엔드 거부)
      contractNoToSend = noCurrent || undefined;
    } else {
      // 자동 모드 — 신규: undefined (백엔드 채번), 편집: 원본 그대로 (변경 없음)
      contractNoToSend = noOriginal || undefined;
    }

    // v6.0.0 Phase A3: 거래처 계약번호 (선택)
    const ext = document.getElementById('ct-f-external_contract_no')?.value?.trim() || '';

    return {
      contract_no: contractNoToSend,
      external_contract_no: ext || null,
      contract_type: document.getElementById('ct-f-contract_type')?.value,
      status: document.getElementById('ct-f-status')?.value,
      title: document.getElementById('ct-f-title')?.value?.trim() || '',
      customer_name: document.getElementById('ct-f-customer_name')?.value?.trim() || null,
      currency: document.getElementById('ct-f-currency')?.value,
      start_date: document.getElementById('ct-f-start_date')?.value || null,
      end_date: document.getElementById('ct-f-end_date')?.value || null,
      contract_amount: document.getElementById('ct-f-contract_amount')?.value || null,
      // v6.0.0 Phase C: 검토 기한
      review_deadline: document.getElementById('ct-f-review_deadline')?.value || null,
      // 연결 (선택적)
      customer_id: parseInt(document.getElementById('ct-f-customer_id')?.value, 10) || null,
      lead_id: parseInt(document.getElementById('ct-f-lead_id')?.value, 10) || null,
      proposal_id: parseInt(document.getElementById('ct-f-proposal_id')?.value, 10) || null,
      quote_id: parseInt(document.getElementById('ct-f-quote_id')?.value, 10) || null,
      language: document.getElementById('ct-f-language')?.value,
      notes: document.getElementById('ct-f-notes')?.value?.trim() || null,
    };
  }

  async function _doSave(id, opts = {}) {
    const { isTempMode = false } = opts;
    const body = _collectForm();
    if (!body.title) {
      Toast.error?.('계약명을 입력하세요');
      document.getElementById('ct-f-title')?.focus();
      return;
    }
    try {
      if (id) {
        await API.contracts.update(id, body);
        Toast.success?.(isTempMode ? '계약 등록 완료 (정식 저장됨)' : '저장됨');
        // v6.0.0 Phase A2-2: 임시 모드에서 정식 저장 → 임시 추적 ID 해제
        if (isTempMode && _tempContractId === id) {
          _tempContractId = null;
        }
      } else {
        const res = await API.contracts.create(body);
        Toast.success?.(`계약 등록 완료 — ${res?.data?.contract_no || ''}`);
      }
      Modal.close();
      await _refreshList();
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err.message || err));
    }
  }

  async function _doDelete(id) {
    const contract = _list.find(c => c.id === id);
    const label = contract ? `${contract.contract_no} (${contract.title})` : `#${id}`;
    if (!confirm(`이 계약을 삭제하시겠습니까?\n\n${label}\n\n첨부 파일과 이력도 함께 삭제됩니다.`))
      return;
    try {
      await API.contracts.delete(id);
      Toast.success?.('삭제됨');
      await _refreshList();
    } catch (err) {
      Toast.error?.('삭제 실패: ' + (err.message || err));
    }
  }

  return { render };
})();
