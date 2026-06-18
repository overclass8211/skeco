// ============================================================
// ProposalsPage — 제안관리 아카이브
//   Phase 1: 목록 + 등록/편집 (1탭)
//   Phase 2: 7개 탭 상세 모달 + RFP 메타정보 + 견적/리비전/이력 표시
//            (RFP 파일 / AI / 자료 / 이메일은 Phase 3~5)
// ============================================================
const ProposalsPage = (() => {
  // ── 모듈 상태 ────────────────────────────────────────────
  let _list = [];
  let _editing = null;
  let _leadsCache = [];
  let _quotesCache = [];
  let _teamCache = [];
  let _comboboxes = [];
  let _activeTab = 'basic'; // 현재 활성 탭
  // Phase 9-2: [+제안등록] 클릭 시 임시 제안 자동 생성 → 편집 모드 진입
  // [저장] 시 false 로 전환. [닫기] 시 true 면 자동 DELETE (사용자가 RFP 업로드한 경우 confirm)
  let _isTempProposal = false;
  // Phase 11-B: 목록 뷰 모드 (table | card) — localStorage 영속
  const VIEW_KEY = 'pr-list-view-mode';
  let _viewMode = (() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'card' ? 'card' : 'table';
    } catch (_) {
      return 'table';
    }
  })();

  // 상태 → 한국어 라벨 / 색상
  const STATUS_LABEL = {
    draft: '준비중',
    review: '내부검토',
    ready: '제출준비완료',
    sent: '발송완료',
    revised: '수정요청',
    accepted: '채택',
    rejected: '거절',
    expired: '만료',
  };
  const STATUS_COLOR = {
    draft: 'gray',
    review: 'blue',
    ready: 'blue',
    sent: 'blue',
    revised: 'orange',
    accepted: 'green',
    rejected: 'red',
    expired: 'gray',
  };
  // Phase 8-C: 3-탭 구조 — 새 워크플로우 (RFP 업로드→AI 분석→폼 자동채움)
  //   1. 기본정보 (RFP 섹션 상단 + 제안 기본정보 + AI 제안전략 요약 [비고 자리])
  //   2. 자료 & 견적 (파일 + AI 평가/수주확률)
  //   3. 발송 & 이력 (이메일/공유 + 리비전/이력)
  // 이전 4탭의 'ai' 탭은 기본정보 탭에 통합됨 (DB 컬럼/API 무변경)
  const TABS = [
    { id: 'basic', label: '📋 기본정보', alwaysOn: true },
    { id: 'content', label: '📊 제안평가', editOnly: true },
    { id: 'send', label: '📤 발송 & 이력', editOnly: true },
    // v6.0.0 Phase B: 계약 탭 (LinkedContracts 컴포넌트 활용)
    { id: 'contracts', label: '📜 계약', editOnly: true },
  ];

  // ── 유틸 ─────────────────────────────────────────────────
  function _fmtDate(s) {
    if (!s) return '';
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
    if (!s) return new Date().toISOString().slice(0, 10);
    const d = new Date(s);
    if (isNaN(d)) return new Date().toISOString().slice(0, 10);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function _statusLabel(s) {
    return STATUS_LABEL[s] || s || '준비중';
  }
  function _statusColor(s) {
    return STATUS_COLOR[s] || 'gray';
  }

  // v6.0.0: 단계 진척률 (5개 모듈 통일 — StageProgress 컴포넌트)
  // 정상 흐름: draft → review → ready → sent → accepted (5단계, revised 는 sent 와 동급 sent 로 표시)
  // 종료: rejected (거절), expired (만료)
  const _PR_STAGES = [
    { key: 'draft', label: '준비중', color: '#6b7280' },
    { key: 'review', label: '내부검토', color: '#3b82f6' },
    { key: 'ready', label: '제출준비', color: '#0891b2' },
    { key: 'sent', label: '발송', color: '#8b5cf6' },
    { key: 'accepted', label: '채택', color: '#16a34a' },
  ];
  const _PR_TERMINAL_REJECTED = { key: 'rejected', label: '거절', color: '#dc2626' };
  const _PR_TERMINAL_EXPIRED = { key: 'expired', label: '만료', color: '#9ca3af' };
  function _renderStageProgress(status) {
    if (typeof StageProgress === 'undefined') {
      return `<span class="badge badge-${_statusColor(status)}">${_statusLabel(status)}</span>`;
    }
    // revised 는 sent 단계로 표시 (수정 후 재발송)
    let cur = status === 'revised' ? 'sent' : status;
    let terminal = null;
    if (status === 'rejected') terminal = _PR_TERMINAL_REJECTED;
    else if (status === 'expired') terminal = _PR_TERMINAL_EXPIRED;
    if (terminal) cur = terminal.key;
    return StageProgress.render({
      stages: _PR_STAGES,
      current: cur,
      size: 'sm',
      terminal,
    });
  }

  function _debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function _cleanupInstances() {
    _comboboxes.forEach(c => {
      try {
        c.destroy?.();
      } catch (_) {}
    });
    _comboboxes = [];
  }

  // ── 캐시 prefetch ────────────────────────────────────────
  async function _ensureLeads() {
    if (_leadsCache.length > 0) return;
    try {
      const r = await API.leads.list({ limit: 500 });
      _leadsCache = r.data || [];
    } catch (_) {
      _leadsCache = [];
    }
  }
  async function _ensureQuotes() {
    if (_quotesCache.length > 0) return;
    try {
      const r = await API.quotes.list({ limit: 500 });
      _quotesCache = r.data || [];
    } catch (_) {
      _quotesCache = [];
    }
  }
  async function _ensureTeam() {
    if (_teamCache.length > 0) return;
    try {
      const r = await API.team.list();
      _teamCache = r.data || [];
    } catch (_) {
      _teamCache = [];
    }
  }

  // ── 페이지 렌더 ──────────────────────────────────────────
  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <!-- v6.0.0: KPI 바 (5개 모듈 통일) -->
      <div id="pr-kpi-bar"></div>
      <div class="filter-bar">
        <input class="search-input" id="pr-search" placeholder="제안명·고객사·번호 검색...">
        <select class="filter-select" id="pr-status">
          <option value="">전체 상태</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)">
          <input type="checkbox" id="pr-due-soon"> 마감임박 (7일)
        </label>
        <div style="margin-left:auto;display:flex;gap:10px;align-items:center">
          <!-- v6.0.0: 5개 모듈 통일 뷰 토글 (ViewToggle 컴포넌트) -->
          ${ViewToggle.render({ currentView: _viewMode === 'table' ? 'list' : _viewMode })}
          <button class="btn btn-primary" id="pr-new-btn">+ 제안 등록</button>
        </div>
      </div>
      <div id="pr-list-wrap">
        <div class="loading" style="padding:40px;text-align:center">로딩...</div>
      </div>
    `;

    document.getElementById('pr-new-btn').addEventListener('click', () => _openModal(null));
    document.getElementById('pr-search').addEventListener('input', _debounce(_reload, 250));
    document.getElementById('pr-status').addEventListener('change', _reload);
    document.getElementById('pr-due-soon').addEventListener('change', _reload);
    // v6.0.0: ViewToggle 컴포넌트 바인딩 ('list' 는 내부적으로 'table' 과 동일)
    ViewToggle.bind(
      document.querySelector('.filter-bar .view-toggle'),
      next => {
        // ViewToggle 은 'list'/'card' 사용, 내부 _viewMode 는 'table'/'card' 로 호환 유지
        const internalView = next === 'list' ? 'table' : next;
        if (internalView === _viewMode) return;
        _viewMode = internalView;
        try {
          localStorage.setItem(VIEW_KEY, internalView);
        } catch (_) {}
        const wrap = document.getElementById('pr-list-wrap');
        if (wrap && _list) {
          wrap.innerHTML = _renderList(_list);
          _bindListEvents();
        }
      },
      null // localStorage 는 위 콜백에서 직접 처리 (table↔list 변환 때문)
    );

    // v6.0.0: KPI 대시보드 로드 (best-effort)
    _loadKpiBar();

    await _reload();
  }

  // v6.0.0: 상단 KPI 바 (5개 모듈 통일)
  async function _loadKpiBar() {
    if (typeof KpiBar === 'undefined') return;
    KpiBar.renderLoading('#pr-kpi-bar', 4);
    try {
      const res = await API.proposals.dashboard();
      const d = res?.data || {};
      KpiBar.render({
        containerSel: '#pr-kpi-bar',
        cards: [
          { icon: '✏️', label: '작성중', value: d.in_progress, color: '#6b7280', sub: '초안·검토·준비' },
          { icon: '📤', label: '발송', value: d.sent, color: '#3b82f6', sub: '고객 검토 중' },
          { icon: '🏆', label: '수주', value: d.accepted, color: '#16a34a', sub: '채택' },
          { icon: '🔥', label: '마감 임박', value: d.due_7d, color: '#dc2626', sub: 'D-7 이내' },
        ],
      });
    } catch (e) {
      console.warn('[proposals] KPI 로드 실패:', e.message);
      document.getElementById('pr-kpi-bar').innerHTML = '';
    }
  }

  async function _reload() {
    const search = document.getElementById('pr-search')?.value || '';
    const status = document.getElementById('pr-status')?.value || '';
    const dueSoon = document.getElementById('pr-due-soon')?.checked ? 1 : '';
    const wrap = document.getElementById('pr-list-wrap');
    if (!wrap) return;
    try {
      const res = await API.proposals.list({ search, status, due_soon: dueSoon, limit: 100 });
      _list = res.data || [];
      wrap.innerHTML = _renderList(_list);
      _bindListEvents();
    } catch (err) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#d93025">불러오기 실패: ${esc(err.message || err)}</div>`;
    }
  }

  function _renderList(rows) {
    if (!rows.length) {
      return `<div style="padding:60px;text-align:center;color:var(--text-3)">
        등록된 제안이 없습니다. <br>우측 상단의 [+ 제안 등록] 버튼을 눌러 시작하세요.
      </div>`;
    }
    return _viewMode === 'card' ? _renderCardList(rows) : _renderTableList(rows);
  }

  function _renderTableList(rows) {
    return `
      <div class="pr-table-scroll">
      <table class="data-table pr-list-table">
        <thead>
          <tr>
            <th style="width:130px">제안번호</th>
            <th style="min-width:240px;width:300px">제안명</th>
            <th style="width:140px">고객사</th>
            <th style="width:110px">연결견적</th>
            <th style="width:130px;text-align:right">예상금액</th>
            <th style="width:80px;text-align:center">파일</th>
            <th style="width:90px;text-align:center">상태</th>
            <th style="width:100px">제출기한</th>
            <th style="width:110px">담당자</th>
            <th style="width:240px;text-align:center">액션</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(r => {
              const due = r.due_date ? _fmtDate(r.due_date) : '-';
              const overdue =
                r.due_date && new Date(r.due_date) < new Date() && r.status !== 'accepted'
                  ? 'style="color:#d93025;font-weight:600"'
                  : '';
              // v6.0.0: 읽음/안읽음 시각화
              const rrBadge = typeof ReadReceipts !== 'undefined' ? ReadReceipts.renderTitleBadge(r) : '';
              const rrStyle = typeof ReadReceipts !== 'undefined' ? ReadReceipts.rowStyleAttr(r) : '';
              const rrTooltip = typeof ReadReceipts !== 'undefined' ? ReadReceipts.tooltipAttr(r) : '';
              return `
            <tr data-id="${r.id}" style="${rrStyle}"${rrTooltip}>
              <td style="font-family:monospace;font-size:12px">${esc(r.proposal_no)}</td>
              <td class="pr-name-cell" title="${esc(r.proposal_title)}">${rrBadge}<a href="#" class="pr-link pr-name-link" data-id="${r.id}">${esc(r.proposal_title)}</a></td>
              <td>${esc(r.customer_name || '')}</td>
              <td style="font-family:monospace;font-size:11px;color:var(--text-3)">${esc(r.quote_no || '-')}</td>
              <td style="text-align:right;font-weight:500">${r.expected_amount ? esc(Fmt.amount(r.expected_amount, r.currency || 'KRW')) : '-'}</td>
              <td style="text-align:center">${r.file_count > 0 ? `<span class="badge badge-blue">${r.file_count}</span>` : '-'}</td>
              <td style="text-align:center">${_renderStageProgress(r.status)}</td>
              <td ${overdue}>${due}</td>
              <td>${esc(r.owner_name || '-')}</td>
              <td style="text-align:center">
                <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">상세</button>
                <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" style="color:#d93025">삭제</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      </div>
    `;
  }

  // Phase 11-B: 카드 뷰 렌더 (반응형 그리드 — auto-fill min 290px)
  function _renderCardList(rows) {
    return `
      <div class="pr-card-grid">
        ${rows
          .map(r => {
            const due = r.due_date ? _fmtDate(r.due_date) : '-';
            const isOverdue =
              r.due_date && new Date(r.due_date) < new Date() && r.status !== 'accepted';
            const amount = r.expected_amount
              ? esc(Fmt.amount(r.expected_amount, r.currency || 'KRW'))
              : '-';
            return `
        <div class="pr-card" data-id="${r.id}">
          <div class="pr-card-header">
            <span class="pr-card-no">${esc(r.proposal_no)}</span>
            ${_renderStageProgress(r.status)}
          </div>
          <div class="pr-card-title">
            <a href="#" class="pr-link" data-id="${r.id}">${esc(r.proposal_title || '(제안명 미입력)')}</a>
          </div>
          <div class="pr-card-meta">
            <div class="pr-card-meta-row" title="고객사">
              🏢 <strong>${esc(r.customer_name || '-')}</strong>
            </div>
            <div class="pr-card-meta-row pr-card-amount" title="예상금액">
              💰 ${amount}
            </div>
            <div class="pr-card-meta-row ${isOverdue ? 'pr-card-due-overdue' : ''}" title="제출기한">
              📅 제출기한: ${due}${isOverdue ? ' (마감 초과)' : ''}
            </div>
            ${
              r.quote_no
                ? `<div class="pr-card-meta-row" title="연결 견적" style="font-family:monospace;font-size:11px;color:var(--text-3)">
                    📄 ${esc(r.quote_no)}
                  </div>`
                : ''
            }
          </div>
          <div class="pr-card-footer">
            <div class="pr-card-stats">
              ${r.file_count > 0 ? `<span title="파일">📎 ${r.file_count}</span>` : ''}
              <span title="담당자">👤 ${esc(r.owner_name || '미배정')}</span>
            </div>
            <div class="pr-card-actions">
              <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">상세</button>
              <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" style="color:#d93025">삭제</button>
            </div>
          </div>
        </div>`;
          })
          .join('')}
      </div>
    `;
  }

  function _bindListEvents() {
    document.querySelectorAll('.pr-link').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = parseInt(a.dataset.id, 10);
        _openModal(id);
      });
    });
    document.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const act = btn.dataset.act;
        if (act === 'edit') _openModal(id);
        else if (act === 'delete') _delete(id);
      });
    });
    // Phase 11-B: 카드 전체 클릭 시 모달 열기 (.pr-link/버튼 클릭은 stopPropagation 으로 제외)
    document.querySelectorAll('.pr-card[data-id]').forEach(card => {
      card.addEventListener('click', e => {
        // 안쪽 a/button 클릭은 위 핸들러가 stopPropagation
        if (e.target.closest('a, button')) return;
        const id = parseInt(card.dataset.id, 10);
        if (id) _openModal(id);
      });
    });
  }

  async function _delete(id) {
    if (!confirm('이 제안을 삭제하시겠습니까? 관련 파일/리비전/이력도 함께 삭제됩니다.')) return;
    try {
      await API.proposals.delete(id);
      Toast.success('삭제됨');
      await _reload();
    } catch (err) {
      Toast.error('삭제 실패: ' + (err.message || err));
    }
  }

  // ── 모달 (Phase 8-C: 3-탭, Phase 9-2: 신규는 임시 제안 자동 생성) ──
  async function _openModal(id) {
    _editing = null;
    _isTempProposal = false;
    _cleanupInstances();
    _activeTab = 'basic'; // 항상 기본정보 탭으로 시작

    // 캐시 prefetch (병렬)
    await Promise.all([_ensureLeads(), _ensureQuotes(), _ensureTeam()]);

    if (id) {
      try {
        const r = await API.proposals.get(id);
        _editing = r.data;
      } catch (err) {
        Toast.error('제안 정보 불러오기 실패: ' + (err.message || err));
        return;
      }
    } else {
      // Phase 9-2: 신규 = 임시 제안 자동 생성 → 편집 모드 진입
      //   - proposal_no 자동 채번 (백엔드)
      //   - 필수값 통과를 위해 '(임시)' placeholder 사용
      //   - 모달 열린 직후엔 빈 값으로 표시 (저장 시 사용자 실제 입력 필요)
      try {
        const today = new Date().toISOString().slice(0, 10);
        const r = await API.proposals.create({
          proposal_title: '(임시)',
          customer_name: '(임시)',
          proposal_date: today,
          status: 'draft',
        });
        // 응답에서 받은 임시 제안을 즉시 다시 fetch 해서 _editing 전체 채움 (files/history 등 포함)
        const full = await API.proposals.get(r.data.id);
        _editing = full.data;
        _isTempProposal = true;
        // 임시 placeholder 값은 UI 에서 빈칸으로 표시 (저장 시 사용자가 실제 값 입력 필요)
        _editing.proposal_title = '';
        _editing.customer_name = '';
      } catch (err) {
        Toast.error('제안 생성 실패: ' + (err.message || err));
        return;
      }
    }

    const e = _editing;

    Modal.open({
      title: _isTempProposal
        ? `✏️ 새 제안 작성 — ${esc(e.proposal_no)}`
        : `📝 제안 상세 — ${esc(e.proposal_no)} (${_statusLabel(e.status)})`,
      width: 1180,
      body: _renderModalBody(e),
      footer: `
        <button class="btn btn-ghost" id="pr-cancel-btn">닫기</button>
        <button class="btn btn-primary" id="pr-save-btn">💾 저장</button>
      `,
      disableOverlayClose: true,
      bind: {
        '#pr-cancel-btn': () => _closeAndCleanup(),
        '#pr-save-btn': () => _save(),
      },
      onOpen: () => {
        _bindTabEvents();
        _renderActiveTab(e);
      },
    });
  }

  // Phase 9-2: 모달 닫기 + 임시 제안 정리
  //   - 임시 제안 (저장 전) → RFP 업로드/AI 분석한 경우 confirm, 아니면 자동 DELETE
  //   - 정상 제안 (저장 후) → 그냥 닫기
  async function _closeAndCleanup() {
    if (_isTempProposal && _editing && _editing.id) {
      const files = Array.isArray(_editing.files) ? _editing.files : [];
      const hasUploadedContent =
        files.length > 0 ||
        (_editing.rfp_title && String(_editing.rfp_title).trim()) ||
        (_editing.ai_strategy_md && String(_editing.ai_strategy_md).trim());
      if (hasUploadedContent) {
        const ok = confirm(
          '⚠️ 작성 중인 제안을 닫으시겠습니까?\n업로드한 RFP 파일 및 AI 분석 결과가 함께 삭제됩니다.'
        );
        if (!ok) return; // 닫기 취소
      }
      // 임시 제안 + CASCADE 로 파일/이력 모두 삭제
      try {
        await API.proposals.delete(_editing.id);
      } catch (_) {
        /* 무시 — 어차피 모달 닫음 */
      }
    }
    _cleanupInstances();
    Modal.close();
    if (_isTempProposal) {
      // 임시 제안 삭제 후 목록 갱신 (사용자가 보고 있을 수 있음)
      await _reload();
    }
  }

  function _renderModalBody(e) {
    const isNew = !e.id;
    return `
      <div class="pr-modal">
        <!-- 탭 헤더 -->
        <div class="pr-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:-8px -8px 16px;overflow-x:auto">
          ${TABS.map(t => {
            const disabled = isNew && t.editOnly;
            const active = t.id === _activeTab;
            return `<button class="pr-tab ${active ? 'active' : ''}" data-tab="${t.id}" type="button"
              ${disabled ? 'disabled' : ''}
              style="padding:10px 16px;border:none;background:none;cursor:${disabled ? 'not-allowed' : 'pointer'};
                     font-size:13px;font-weight:500;flex-shrink:0;
                     border-bottom:2px solid ${active ? 'var(--oci-red)' : 'transparent'};
                     margin-bottom:-2px;
                     color:${disabled ? 'var(--text-3)' : active ? 'var(--oci-red)' : 'var(--text-2)'};
                     opacity:${disabled ? '0.4' : '1'}">${t.label}</button>`;
          }).join('')}
        </div>

        <!-- 탭 컨텐츠 영역 -->
        <div id="pr-tab-content" style="min-height:520px;max-height:580px;overflow-y:auto;padding:4px 4px 20px">
          <!-- 동적 렌더 -->
        </div>
      </div>
    `;
  }

  function _bindTabEvents() {
    document.querySelectorAll('.pr-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const tab = btn.dataset.tab;
        if (tab === _activeTab) return;
        _activeTab = tab;
        // 탭 active 시각적 갱신
        document.querySelectorAll('.pr-tab').forEach(b => {
          const isActive = b.dataset.tab === tab;
          b.classList.toggle('active', isActive);
          b.style.borderBottomColor = isActive ? 'var(--oci-red)' : 'transparent';
          b.style.color = b.disabled
            ? 'var(--text-3)'
            : isActive
              ? 'var(--oci-red)'
              : 'var(--text-2)';
        });
        // _editing 사용 (이미 로드됨)
        _cleanupInstances();
        _renderActiveTab(_editing || {});
      });
    });
  }

  function _renderActiveTab(e) {
    const wrap = document.getElementById('pr-tab-content');
    if (!wrap) return;
    switch (_activeTab) {
      // ── 탭 1: 기본정보 ─────────────────────────────────────
      // Phase 8-C 신규 워크플로우:
      //   ① 상단: RFP 등록 & AI 분석 (RFP 파일 + AI 분석 시작 + 제안전략 요약 통합)
      //   ② 하단: 제안 기본정보 (검토 & 저장)
      case 'basic': {
        // Phase 13: 2-단계 통합 (3개 → 2개 카드, AI 제안전략 요약을 RFP 카드에 통합)
        if (e && e.id) {
          const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
          // Phase 13: 1단계 = RFP 업로드 + AI 분석/요약 모두 포함 (둘 다 있어야 완료)
          const hasRfp = rfpFiles.length > 0;
          const hasAiStrategy = !!(e.ai_strategy_md && String(e.ai_strategy_md).trim());
          const step1Done = hasRfp && hasAiStrategy;
          // 임시 placeholder 제거 + 사용자가 실제 입력했는지
          const realTitle = e.proposal_title && e.proposal_title !== '(임시)';
          const realCustomer = e.customer_name && e.customer_name !== '(임시)';
          const step2Done = realTitle && realCustomer; // 필수 기본정보 입력 완료
          // 활성 단계 — 가장 첫 미완료 단계
          const active = !step1Done ? 1 : 2;
          const open = { 1: active === 1, 2: active === 2 };

          // v6.0.0: 헤드라인 stepper UI 제거 (사용자 요청 — 섹션 자체 헤더로 충분)
          wrap.innerHTML =
            _renderStepSection(
              1,
              '📑 RFP 등록 & AI 분석',
              _summary1(rfpFiles, hasAiStrategy, step1Done),
              {
                active: active === 1,
                done: step1Done,
                open: open[1],
                // Phase 13: RFP 등록 + AI 제안전략 요약을 한 카드에 통합
                body:
                  _renderRfpTab(e) +
                  `<div style="margin-top:16px;padding-top:16px;border-top:1px dashed var(--border)"></div>` +
                  _renderAiStrategySection(e),
              }
            ) +
            _renderStepSection(2, '📋 제안 기본정보 검토 & 저장', _summary3(e, step2Done), {
              active: active === 2,
              done: step2Done,
              open: open[2],
              body: _renderBasicTab(e),
            });
          // v6.0.0 Phase B: 기존 basic 탭 LinkedContracts 섹션은 별도 [📜 계약] 탭으로 이동
        } else {
          // 신규 모드 (임시 제안 생성 실패 시 fallback) — 기본정보 폼만
          wrap.innerHTML = _renderBasicTab(e);
        }
        _attachLeadCombobox();
        _attachQuoteCombobox(e.quote_id);
        if (e && e.id) {
          _bindFileEvents(e, 'rfp');
          _bindAiTabEvents(e); // RFP 섹션의 AI 분석 버튼 + AI 요약 섹션의 복사/Word
          _bindSectionToggle(); // Phase 10-2: 섹션 헤더 클릭 시 접기/펼치기
        }
        break;
      }
      // v6.0.0 Phase B: 계약 탭 (LinkedContracts 컴포넌트 활용)
      case 'contracts':
        wrap.innerHTML = `<div id="lc-proposal"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>`;
        if (typeof LinkedContracts !== 'undefined' && e && e.id) {
          LinkedContracts.render('#lc-proposal', 'proposal', e.id).catch(() => {});
        }
        break;
      // ── 탭 2: 제안평가 (Phase 13-3: 2섹션으로 단순화) ──
      //   ① 📦 제안 자료 (파일 업로드 + 목록 + 큰 [📊 AI 제안평가] CTA)
      //   ② 📊 AI 평가 결과 (수주확률 + 정량 메트릭 + 승리/리스크 요인)
      //   * 연결 견적 섹션 제거 (Phase 13-3) — 기본정보 탭에서 이미 확인 가능
      case 'content':
        wrap.innerHTML =
          _renderFilesTab(e) +
          `<div class="pr-tab-divider">📊 AI 평가 (수주확률 + 정량 메트릭)</div>` +
          _renderEvalSection(e);
        _bindFileEvents(e, 'files');
        _bindEvalCloseBtn(); // Phase 11-A: 이력 카드 닫기 버튼
        break;
      // ── 탭 3: 발송 & 이력 ────────────────────────────────
      // 이메일/공유 + 리비전/히스토리 통합
      case 'send':
        wrap.innerHTML =
          _renderEmailTab(e) +
          `<div class="pr-tab-divider">🕒 리비전 & 이력</div>` +
          _renderHistoryTab(e);
        _bindEmailTabEvents(e);
        _bindHistoryEvents(e);
        break;
      default:
        wrap.innerHTML = '';
    }
  }

  // ── Phase 10-2: Collapsible 섹션 헬퍼 ──────────────────────
  // v6.0.0: 상단 stepper UI 제거 (사용자 요청) — 섹션 카드 자체 헤더로 충분
  // (이전 _renderStepper2 함수 제거됨)

  // Collapsible 섹션 카드 (단계별)
  function _renderStepSection(num, title, summary, opts) {
    const { active, done, open, body } = opts || {};
    const cls = [
      'pr-section',
      active ? 'is-active' : '',
      done ? 'is-done' : '',
      open ? 'is-open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<div class="${cls}" data-step="${num}">
      <div class="pr-section-header" data-section-toggle="${num}">
        <div class="pr-section-title">
          ${esc(title)} ${done ? '<span class="pr-section-badge">✓ 완료</span>' : ''}
        </div>
        <div class="pr-section-summary">${summary || ''}</div>
        <div class="pr-section-toggle">▼</div>
      </div>
      <div class="pr-section-body">${body}</div>
    </div>`;
  }

  // 단계별 summary (접힌 상태에서 보이는 1줄 요약)
  // Phase 13: 1단계 = RFP + AI 분석 통합 → 두 가지 상태 모두 표시
  function _summary1(rfpFiles, hasAiStrategy, done) {
    if (rfpFiles.length === 0) {
      // Phase 13-4: 노란색 안내 박스 제거에 따른 메시지 보강 (기본정보 + 6섹션 채움 정보 추가)
      return 'RFP 파일 업로드 후 [🤖 AI 분석] 클릭 시 기본정보 + 제안전략 6섹션 자동 채움';
    }
    const names = rfpFiles
      .slice(0, 2)
      .map(f => f.original_filename)
      .join(', ');
    const fileText = `${rfpFiles.length}개 파일${rfpFiles.length > 2 ? ' (' + names + ' 외)' : ' · ' + names}`;
    if (done) return `✓ ${fileText} · AI 6섹션 생성 완료`;
    return `${fileText} · ${hasAiStrategy ? 'AI 일부 생성' : '⚠️ AI 분석 대기'}`;
  }
  function _summary3(e, done) {
    if (!done) return '제안명·고객사·예상금액 등 검토 후 [💾 저장]';
    return `${e.proposal_title || ''} · ${e.customer_name || ''}`;
  }

  // 섹션 헤더 클릭 → 접기/펼치기 토글 (active/done 클래스는 유지)
  function _bindSectionToggle() {
    document.querySelectorAll('[data-section-toggle]').forEach(header => {
      header.addEventListener('click', ev => {
        // textarea/input/button 클릭은 토글 무시
        if (ev.target.closest('input, textarea, button, a, select, label')) return;
        const card = header.closest('.pr-section');
        if (card) card.classList.toggle('is-open');
      });
    });
  }

  // ── 탭 1: 기본정보 (Phase 1 폼 재사용) ───────────────────
  // Phase 8-C: 비고 필드는 AI 제안전략 요약 섹션으로 통합 (별도 textarea)
  function _renderBasicTab(e) {
    return `
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="form-row">
          <label class="form-label">제안번호</label>
          <input class="form-input" id="pr-f-proposal_no" value="${esc(e.proposal_no || '')}"
            ${e.id ? 'readonly style="background:#f5f5f7;color:#666"' : 'placeholder="(저장 시 자동 생성)"'}>
        </div>
        <div class="form-row">
          <label class="form-label required">제안일</label>
          <input class="form-input" id="pr-f-proposal_date" type="date" value="${_toInputDate(e.proposal_date)}">
        </div>
        <div class="form-row">
          <label class="form-label">제출기한</label>
          <input class="form-input" id="pr-f-due_date" type="date" value="${e.due_date ? _toInputDate(e.due_date) : ''}">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">💼 영업리드 연결 (선택)</label>
          <input class="form-input" id="pr-f-lead-input"
            value="${esc(_leadInitialText(e.lead_id))}"
            placeholder="🔍 고객사 또는 프로젝트명 1글자 이상 입력 → 자동완성">
          <input type="hidden" id="pr-f-lead_id" value="${e.lead_id || ''}">
          <input type="hidden" id="pr-f-customer_id" value="${e.customer_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">담당자</label>
          <select class="form-input" id="pr-f-owner_id">${_teamOptions(e.owner_id)}</select>
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">📄 연결 견적 (선택)</label>
          <input class="form-input" id="pr-f-quote-input"
            value="${esc(_quoteInitialText(e.quote_id))}"
            placeholder="🔍 견적번호 또는 견적명 1글자 이상 입력 → 자동완성">
          <input type="hidden" id="pr-f-quote_id" value="${e.quote_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">상태</label>
          <select class="form-input" id="pr-f-status">
            ${Object.entries(STATUS_LABEL)
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${e.status === k ? 'selected' : ''}>${v}</option>`
              )
              .join('')}
          </select>
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label required">제안명</label>
          <input class="form-input" id="pr-f-proposal_title" value="${esc(e.proposal_title || '')}" placeholder="제안서 제목 입력 (AI 분석 시 자동 채움)">
        </div>
        <div class="form-row">
          <label class="form-label required">고객사명</label>
          <input class="form-input" id="pr-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 명">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">예상금액 <span style="font-size:11px;color:var(--text-3);font-weight:normal">(AI 분석 시 자동 채움)</span></label>
          <div style="display:flex;gap:4px">
            <input class="form-input" id="pr-f-expected_amount" type="number" step="0.01" min="0" value="${e.expected_amount || ''}" placeholder="견적 연결 / AI 분석 시 자동 반영" style="flex:1">
            <select class="form-input" id="pr-f-currency" style="width:90px;flex-shrink:0">
              ${['KRW', 'USD', 'EUR', 'JPY', 'CNY']
                .map(c => `<option value="${c}" ${e.currency === c ? 'selected' : ''}>${c}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">버전</label>
          <input class="form-input" id="pr-f-version_no" value="v${e.version_no || 1}" readonly style="background:#f5f5f7;color:#666">
        </div>
      </div>

      <!-- Phase 8-C: 비고 필드는 하단 AI 제안전략 요약 섹션으로 이동 (편집 모드 한정) -->
      ${
        !e || !e.id
          ? `<div class="form-row" style="margin-top:14px">
              <label class="form-label">📝 비고</label>
              <textarea class="form-input" id="pr-f-remark" rows="3" placeholder="제안 관련 메모 (선택) — 저장 후 RFP 업로드 + AI 분석으로 전환됩니다" style="resize:vertical;font-family:inherit;line-height:1.5">${esc(e.remark || '')}</textarea>
            </div>`
          : `<input type="hidden" id="pr-f-remark" value="${esc(e.remark || '')}">`
      }
    `;
  }

  // ── RFP 섹션 (Phase 8-C: 기본정보 탭 상단으로 이동) ───────
  // 흐름: 메타 입력 → 파일 업로드 → [🤖 AI 분석] → 기본정보 + AI 제안전략 요약 자동 채움
  function _renderRfpTab(e) {
    const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
    const hasFiles = rfpFiles.length > 0;
    // v6.0.0 UX 개선:
    //   - 빈 상태: 큰 드롭존 (안내 통합) 만 노출
    //   - 파일 있음: 컴팩트 "+ 추가" 버튼 + 파일 목록 (안내 박스 제거)
    //   - 노란/하늘색 안내 박스 + 빈 목록 안내 모두 제거 (인지 부하 ↓)
    return `
      <!-- RFP 메타 hidden 필드 (AI 분석 결과/저장 흐름 유지) -->
      <input type="hidden" id="pr-f-rfp_title" value="${esc(e.rfp_title || '')}">
      <input type="hidden" id="pr-f-rfp_received_date" value="${e.rfp_received_date ? _toInputDate(e.rfp_received_date) : ''}">
      <input type="hidden" id="pr-f-rfp_due_date" value="${e.rfp_due_date ? _toInputDate(e.rfp_due_date) : ''}">
      <input type="hidden" id="pr-f-rfp_summary" value="${esc(e.rfp_summary || '')}">

      ${
        hasFiles
          ? `<!-- 파일 있음: 컴팩트 [+ 추가] 버튼 + 파일 목록 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">📎 RFP 파일 (${rfpFiles.length}건)</strong>
          <button id="pr-rfp-dropzone" class="btn btn-ghost btn-sm" data-source="rfp" type="button"
            title="RFP 파일 추가 — 클릭 또는 드래그">📥 파일 추가</button>
          <input type="file" id="pr-rfp-upload-input" multiple style="display:none"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg">
        </div>
        ${_renderFileList(rfpFiles, e.id, 'rfp')}`
          : `<!-- 빈 상태: 큰 드롭존만 -->
        <div id="pr-rfp-dropzone" class="pr-dropzone" data-source="rfp" tabindex="0" role="button" aria-label="RFP 파일 추가">
          <div class="pr-dropzone-icon">📥</div>
          <div class="pr-dropzone-title">RFP 파일 첨부</div>
          <div class="pr-dropzone-hint">클릭 또는 드래그 · PDF · 이미지 · 텍스트 우선 · 최대 100MB / 파일</div>
          <input type="file" id="pr-rfp-upload-input" multiple style="display:none"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg">
        </div>`
      }
    `;
  }

  // ── Phase 4-D: 간단 Markdown → HTML 렌더링 ────────────────
  // 외부 라이브러리 없이 ## h2, ### h3, **bold**, *italic*, - 리스트, 1. 번호리스트 지원.
  // 보안: esc() 로 먼저 escape 후 mark-up 만 복원. (XSS 안전)
  function _renderMarkdown(md) {
    if (!md) return '';
    // 1) HTML escape
    let html = esc(md);
    // 2) Headings (## , ### )
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    // 3) bold / italic
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // 4) 줄 단위 처리 — 리스트 그루핑
    const lines = html.split(/\n/);
    const out = [];
    let inUl = false;
    let inOl = false;
    const closeLists = () => {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
    };
    for (const line of lines) {
      const ulMatch = line.match(/^[-*]\s+(.+)$/);
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (ulMatch) {
        if (inOl) {
          out.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          out.push('<ul class="md-ul">');
          inUl = true;
        }
        out.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (inUl) {
          out.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          out.push('<ol class="md-ol">');
          inOl = true;
        }
        out.push(`<li>${olMatch[1]}</li>`);
      } else if (/^\s*$/.test(line)) {
        closeLists();
        out.push('');
      } else if (/^<h[123]/.test(line)) {
        closeLists();
        out.push(line);
      } else {
        closeLists();
        out.push(`<p class="md-p">${line}</p>`);
      }
    }
    closeLists();
    return out.join('\n');
  }

  // Gemini Multimodal 직접 지원 파일 (PDF / 이미지 / 텍스트)
  // PPT/DOC/HWP 등 Office 문서는 PDF 로 변환 필요
  const AI_ANALYZABLE_RE = /\.(pdf|png|jpe?g|webp|txt)$/i;
  function _isAnalyzable(filename) {
    return AI_ANALYZABLE_RE.test(String(filename || ''));
  }

  // ── AI 제안전략 요약 섹션 (Phase 8-C: 비고 자리에 통합) ───
  // 편집 가능한 textarea (markdown) + Word 다운로드 + 복사
  // Phase 12: 큰 CTA AI 분석 버튼 이 섹션 상단으로 이동 (1단계 → 2단계)
  // 6섹션 가이드: 제안목표 / 주요 일정 / 핵심사항 / 준비사항(체크리스트) / 예상 리스크 / 독소조항 회피방안
  function _renderAiStrategySection(e) {
    const hasResult = e.ai_strategy_md && e.ai_strategy_md.trim();
    // Phase 12: RFP 파일 호환성으로 AI 분석 가능 여부 결정 (1단계와 동일 로직)
    const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
    const analyzableFiles = rfpFiles.filter(f => _isAnalyzable(f.original_filename));
    const canAnalyze = analyzableFiles.length > 0;
    const hasRfpButUnanalyzable = rfpFiles.length > 0 && analyzableFiles.length === 0;
    const placeholder = [
      '## 제안 목표',
      '- (1단계 RFP 업로드 후 [🤖 AI 분석 시작] 버튼을 누르면 자동 채움)',
      '',
      '## 제안 주요 일정',
      '- ',
      '',
      '## 제안 핵심사항',
      '- ',
      '',
      '## 제안 준비사항 (체크리스트)',
      '- [ ] ',
      '',
      '## 예상 리스크',
      '- ',
      '',
      '## 독소조항 회피방안',
      '- ',
    ].join('\n');
    // v6.0.0 UX 개선: 보라색 6섹션 박스 제거, 결과 영역을 카드 형식으로 통합
    //   - 빈 상태 (canAnalyze=false): CTA 버튼만 (단일 hint), 결과 영역 hidden
    //   - 분석 가능 (canAnalyze=true, !hasResult): CTA + 결과 textarea (회색 placeholder)
    //   - 결과 있음: CTA "재분석" + 결과 카드 헤더 [📄 Word] [📋 복사]
    return `
      <button class="pr-ai-cta" id="pr-ai-analyze-btn" type="button"
        ${canAnalyze ? '' : 'disabled'}>
        🤖 ${hasResult ? 'AI 분석 다시 시작' : 'AI 분석 시작'} — RFP 기반 자동 생성
      </button>
      <div class="pr-ai-cta-hint">
        ${
          canAnalyze
            ? `Gemini 2.5 Pro 가 RFP 를 읽어 제안명·고객사·금액·일정·6섹션 전략을 자동 생성합니다 (약 10-30초)`
            : hasRfpButUnanalyzable
              ? '⚠️ RFP 파일이 분석 불가 형식 — PDF · 이미지(PNG/JPG/WEBP) · 텍스트만 지원'
              : '먼저 위 RFP 파일을 첨부하세요'
        }
      </div>

      ${
        canAnalyze || hasResult
          ? `<!-- 결과 영역: 분석 가능하거나 이미 결과 있을 때만 노출 -->
        <div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <strong style="font-size:13px">🧠 제안전략 6섹션</strong>
          <div style="display:flex;gap:6px">
            ${hasResult ? '<button class="btn btn-ghost btn-sm" id="pr-ai-word-btn" type="button" title="Word(.docx) 내려받기">📄 Word</button>' : ''}
            ${hasResult ? '<button class="btn btn-ghost btn-sm" id="pr-ai-copy-btn" type="button" title="markdown 복사">📋 복사</button>' : ''}
          </div>
        </div>
        <div class="form-row" style="margin-bottom:6px">
          <textarea class="form-input" id="pr-f-ai_strategy_md" rows="14" placeholder="${esc(placeholder)}" style="resize:vertical;font-family:'Consolas','Monaco',monospace;font-size:12px;line-height:1.6">${esc(e.ai_strategy_md || '')}</textarea>
        </div>
        <div style="font-size:11px;color:var(--text-3);text-align:right">
          ${e.ai_strategy_generated_at ? '최근 AI 분석: ' + _fmtDateTime(e.ai_strategy_generated_at) : '직접 편집 가능 (수동 입력 OK)'}
        </div>`
          : ''
      }
    `;
  }

  // ── 탭 4: 제안자료 (Phase 3 활성) ────────────────────────
  function _renderFilesTab(e) {
    const files = (e.files || []).filter(f => f.file_type !== 'rfp');
    // Phase 12: AI 제안평가 큰 CTA — 분석 가능 자료 파일 자동 선택
    const analyzableFiles = files.filter(f => _isAnalyzable(f.original_filename));
    const canEvaluate = analyzableFiles.length > 0;
    const hasFilesButUnanalyzable = files.length > 0 && analyzableFiles.length === 0;
    return `
      <!-- Phase 13-3: "제안 자료 아카이브" 안내 박스 제거 — UI 더 간결화 -->
      <div style="margin-bottom:14px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:11px;color:#92400e">
        💡 <strong>AI 제안평가 사용 안내</strong> — Gemini 2.5 Pro 는 <strong>PDF / 이미지(PNG·JPG·WEBP) / 텍스트</strong> 만 직접 분석 가능합니다.
        <strong>PPT/DOC/HWP/XLS</strong> 는 평가 전에 <strong>PDF 로 변환</strong>해서 업로드하세요 (PowerPoint: 파일 → 내보내기 → PDF).
      </div>

      <!-- Phase 13-3: 메타 입력 UI 제거 — 기본값(파일유형=proposal, rev=1, final=false, email=false, desc 빈값) 으로 자동 업로드 -->
      <!-- 업로드 핸들러 _doUpload() 는 element 부재 시 default 사용 (proposals.js 2007-2016 참조) -->
      <input type="hidden" id="pr-file-type" value="proposal">
      <input type="hidden" id="pr-file-rev" value="${e.version_no || 1}">

      <!-- Phase 4-C 드롭존 (다중 + drag/drop) -->
      <div id="pr-files-dropzone" class="pr-dropzone" data-source="files" tabindex="0" role="button" aria-label="제안 자료 추가">
        <div class="pr-dropzone-icon">📥</div>
        <div class="pr-dropzone-title">파일 추가</div>
        <div class="pr-dropzone-hint">이 영역을 클릭하거나 파일을 끌어다 놓으세요<br>(pdf · ppt · doc · xls · hwp · 이미지 — 최대 100MB / 파일)</div>
        <input type="file" id="pr-file-upload-input" multiple style="display:none" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg">
      </div>

      <div style="font-size:12px;color:var(--text-3);margin:14px 0 8px">📂 등록된 파일 (${files.length}건)</div>
      ${_renderFileList(files, e.id, 'files')}

      <!-- Phase 12: 큰 CTA AI 제안평가 버튼 (기본탭 [🤖 AI 분석 시작] 패턴 동일) -->
      <button class="pr-ai-cta" id="pr-evaluate-cta" type="button"
        ${canEvaluate ? '' : 'disabled'}>
        📊 AI 제안평가 시작 — RFP 와 자동 비교
      </button>
      <div class="pr-ai-cta-hint">
        ${
          canEvaluate
            ? `Gemini Pro 가 RFP 와 ${analyzableFiles.length}건의 제안서를 비교하여 수주확률·정량 메트릭·승리/리스크 요인을 생성합니다 (약 10-30초 · 1회 약 300-500원)`
            : hasFilesButUnanalyzable
              ? '⚠️ 등록된 자료가 분석 불가 형식입니다 — PDF / 이미지(PNG·JPG·WEBP) / 텍스트만 평가 가능'
              : '⚠️ 평가할 제안서를 먼저 업로드하세요 (PDF / 이미지 / 텍스트)'
        }
      </div>
    `;
  }

  // Phase 8-D + Phase 11-A: AI 평가 섹션 — 자료 행에서 [AI제안평가] 클릭 시 채워짐
  //   Phase 11-A: 최신 평가 이력 자동 표시 (모달 재진입 시에도 결과 유지)
  function _renderEvalSection(e) {
    const latest = e && e.latest_evaluation;
    return `
      <div style="margin-bottom:10px;padding:10px 14px;background:#ecfeff;border:1px solid #67e8f9;border-radius:6px;font-size:12px;color:#155e75">
        📊 <strong>AI 평가</strong> — 위 자료의 [AI제안평가] 버튼을 누르면 RFP 와 자동 비교하여 <strong>수주확률 + 정량 메트릭 + 승리/리스크 요인</strong>을 생성합니다. (Gemini Pro 호출 — 약 10-30초)
        ${
          latest
            ? `<br>💾 <strong>최근 평가 이력 자동 불러옴</strong> — ${_fmtDateTime(latest.generated_at)} 생성 (커버율 ${latest.coverage_score}% · 수주확률 ${latest.win_probability || '-'}%)`
            : ''
        }
      </div>
      <div id="pr-eval-result">${latest ? _renderEvalResult(latest) : ''}</div>
    `;
  }

  // Phase 11-A: 평가 결과 카드의 [✕ 닫기] 버튼 이벤트 바인딩
  function _bindEvalCloseBtn() {
    const closeBtn = document.getElementById('pr-eval-close-btn');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      const wrap = document.getElementById('pr-eval-result');
      if (wrap) wrap.innerHTML = '';
    });
  }

  // Phase 6-C + 8-D: AI 평가 결과 카드 렌더링
  //   - 수주확률 + 정성 메트릭 (Phase 8-D 신규)
  //   - 커버율 / 충족 / 누락 / 개선 / 승리요인 / 리스크요인
  function _renderEvalResult(data) {
    if (!data) return '';
    const score = Math.max(0, Math.min(100, parseInt(data.coverage_score, 10) || 0));
    const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';
    const sevLabel = { high: '높음', medium: '중간', low: '낮음' };
    const sevColor = { high: '#dc2626', medium: '#ca8a04', low: '#6b7280' };

    const covered = Array.isArray(data.covered_items) ? data.covered_items : [];
    const missing = Array.isArray(data.missing_items) ? data.missing_items : [];
    const improve = Array.isArray(data.improvement_suggestions) ? data.improvement_suggestions : [];

    // Phase 8-D: 수주확률 + 정성 메트릭 + 승리/리스크 요인
    const winProb = Math.max(0, Math.min(100, parseInt(data.win_probability, 10) || 0));
    const winColor = winProb >= 70 ? '#16a34a' : winProb >= 40 ? '#ca8a04' : '#dc2626';
    const winLabel = winProb >= 70 ? '높음' : winProb >= 40 ? '보통' : '낮음';
    const qm = data.quality_metrics || {};
    // Phase 13-3: backend 의 quality_metrics 키와 정확히 매핑 (이전엔 키 불일치로 항상 0점 표시되는 환각 버그)
    //   backend: requirement_coverage / strategy_clarity / differentiation / risk_handling / price_competitiveness
    const metrics = [
      { key: 'requirement_coverage', label: '요구사항 완전성', value: parseInt(qm.requirement_coverage, 10) || 0 },
      { key: 'strategy_clarity', label: '전략 명확성', value: parseInt(qm.strategy_clarity, 10) || 0 },
      { key: 'differentiation', label: '차별화 강도', value: parseInt(qm.differentiation, 10) || 0 },
      { key: 'risk_handling', label: '리스크 대응', value: parseInt(qm.risk_handling, 10) || 0 },
      { key: 'price_competitiveness', label: '가격 경쟁력', value: parseInt(qm.price_competitiveness, 10) || 0 },
    ];
    const winFactors = Array.isArray(data.win_factors) ? data.win_factors.filter(Boolean) : [];
    const riskFactors = Array.isArray(data.risk_factors) ? data.risk_factors.filter(Boolean) : [];

    return `<div class="pr-eval-card" id="pr-eval-card">
      <div class="pr-eval-header">
        <div>
          <div class="pr-eval-title">📊 AI 평가 결과</div>
          <div class="pr-eval-subtitle">
            ${esc(data.target_filename || '')} <span style="opacity:0.6">vs</span> ${esc(data.rfp_filename || '')}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="pr-eval-close-btn" type="button" title="닫기">✕</button>
      </div>

      <!-- Phase 8-D: 수주확률 카드 (대형) + 정성 메트릭 (5바) -->
      <div class="pr-eval-winprob-row">
        <div class="pr-eval-winprob-card" style="border-color:${winColor}">
          <div class="pr-eval-winprob-label">🎯 예상 수주확률</div>
          <div class="pr-eval-winprob-num" style="color:${winColor}">${winProb}<span class="pr-eval-winprob-unit">%</span></div>
          <div class="pr-eval-winprob-badge" style="background:${winColor}">${winLabel}</div>
        </div>
        <div class="pr-eval-metrics-card">
          <div class="pr-eval-metrics-label">📈 정량 메트릭 (5점 만점)</div>
          ${metrics
            .map(m => {
              // Phase 13-3: backend 스키마 0~5 정수에 맞춰 스케일/색상 임계값 조정 (이전엔 10점 만점으로 잘못 표시)
              const pct = (m.value / 5) * 100;
              const col = m.value >= 4 ? '#16a34a' : m.value >= 2 ? '#ca8a04' : '#dc2626';
              return `<div class="pr-eval-metric-row">
                <div class="pr-eval-metric-name">${esc(m.label)}</div>
                <div class="pr-eval-metric-bar">
                  <div class="pr-eval-metric-fill" style="width:${pct}%;background:${col}"></div>
                </div>
                <div class="pr-eval-metric-val" style="color:${col}">${m.value}<span style="opacity:0.4;font-size:10px">/5</span></div>
              </div>`;
            })
            .join('')}
        </div>
      </div>

      <!-- Phase 8-D: 승리 요인 + 리스크 요인 (좌우 2-칼럼) -->
      ${
        winFactors.length > 0 || riskFactors.length > 0
          ? `<div class="pr-eval-factors-row">
              ${
                winFactors.length > 0
                  ? `<div class="pr-eval-factor-card pr-eval-factor-win">
                      <div class="pr-eval-factor-title">✅ 승리 요인 (${winFactors.length}건)</div>
                      <ul class="pr-eval-factor-list">
                        ${winFactors.map(f => `<li>${esc(f)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }
              ${
                riskFactors.length > 0
                  ? `<div class="pr-eval-factor-card pr-eval-factor-risk">
                      <div class="pr-eval-factor-title">⚠️ 리스크 요인 (${riskFactors.length}건)</div>
                      <ul class="pr-eval-factor-list">
                        ${riskFactors.map(f => `<li>${esc(f)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }
            </div>`
          : ''
      }

      <!-- 커버율 진행바 (기존) -->
      <div class="pr-eval-score">
        <div class="pr-eval-score-label">RFP 커버율</div>
        <div class="pr-eval-score-bar">
          <div class="pr-eval-score-fill" style="width:${score}%;background:${scoreColor}"></div>
        </div>
        <div class="pr-eval-score-num" style="color:${scoreColor}">${score}%</div>
        <div class="pr-eval-score-meta">
          <span>충족 ${data.covered_count || covered.length}건</span>
          <span style="color:#dc2626">누락 ${data.missing_count || missing.length}건</span>
        </div>
      </div>

      <!-- 충족 요구사항 -->
      ${
        covered.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">✅ 충족 요구사항 (${covered.length}건)</div>
              <ul class="pr-eval-list pr-eval-covered">
                ${covered
                  .map(
                    c => `<li>
                  <strong>${esc(c.requirement)}</strong>
                  <span class="pr-eval-evidence">→ ${esc(c.evidence)}</span>
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 누락/부족 항목 -->
      ${
        missing.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title" style="color:#dc2626">⚠️ 누락 / 부족 항목 (${missing.length}건)</div>
              <ul class="pr-eval-list pr-eval-missing">
                ${missing
                  .map(
                    m => `<li>
                  <span class="pr-eval-sev" style="background:${sevColor[m.severity] || '#6b7280'}">${esc(sevLabel[m.severity] || m.severity)}</span>
                  <strong>${esc(m.requirement)}</strong>
                  <div class="pr-eval-suggestion">💡 ${esc(m.suggestion)}</div>
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 개선 제안 -->
      ${
        improve.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">💡 개선 제안 (${improve.length}건)</div>
              <ul class="pr-eval-list">
                ${improve
                  .map(
                    s => `<li>
                  <strong>${esc(s.section)}</strong>: ${esc(s.suggestion)}
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 종합 평가 (마크다운) -->
      ${
        data.overall_assessment
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">📝 종합 평가</div>
              <div class="pr-eval-md">${_renderMarkdown(data.overall_assessment)}</div>
            </div>`
          : ''
      }

      <div class="pr-eval-footer">
        ${data.generated_at ? `생성: ${_fmtDateTime(data.generated_at)}` : ''}
      </div>
    </div>`;
  }

  // 파일 목록 + 다운로드/삭제 버튼 (공통)
  function _renderFileList(files, proposalId, source) {
    if (!files.length) {
      return `<div style="padding:18px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">등록된 파일 없음 — 위 영역에서 파일을 추가하세요</div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:90px">유형</th>
        <th>파일명</th>
        <th style="width:60px">Rev</th>
        <th style="width:70px;text-align:center">최종본</th>
        <th style="width:70px;text-align:center">📧 첨부</th>
        <th style="width:90px">크기</th>
        <th style="width:120px">등록일</th>
        <th style="width:140px;text-align:center">작업</th>
      </tr></thead>
      <tbody>
        ${files
          .map(
            f => `<tr>
          <td><span class="badge badge-gray">${esc(f.file_type)}</span></td>
          <td>${esc(f.original_filename)}${f.description ? `<div style="font-size:10px;color:var(--text-3)">${esc(f.description)}</div>` : ''}</td>
          <td>v${f.revision_no || 1}</td>
          <td style="text-align:center">${f.is_final ? '✅' : '-'}</td>
          <td style="text-align:center">${f.include_in_email ? '📧' : '-'}</td>
          <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
          <td>${_fmtDateTime(f.created_at)}</td>
          <td style="text-align:center;white-space:nowrap">
            <a class="btn btn-ghost btn-sm" href="${API.proposals.downloadFileUrl(proposalId, f.id)}" data-pr-file-download="${f.id}" title="다운로드" style="font-size:11px;padding:2px 6px">다운로드</a>
            <button class="btn btn-ghost btn-sm pr-file-del" data-id="${f.id}" data-source="${source}" type="button" style="color:#d93025;font-size:11px;padding:2px 6px" title="삭제">삭제</button>
          </td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  // ── 탭 5: 견적 (백엔드 데이터 표시 — Phase 2 활성) ─────────
  function _renderQuoteTab(e) {
    const q = e.quote;
    if (!q) {
      return `
        <div style="padding:60px 20px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px">
          <div style="font-size:48px;margin-bottom:12px">📄</div>
          <div style="font-size:14px;margin-bottom:6px">연결된 견적이 없습니다</div>
          <div style="font-size:12px">기본정보 탭의 "연결 견적" 필드에서 견적을 선택하세요</div>
        </div>
      `;
    }
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:12px;color:#92400e">
        💰 <strong>연결된 견적 정보</strong> — 견적 내용 수정은 견적 모듈에서 처리하세요. 여기서는 조회만 가능합니다.
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600;width:120px">견적번호</td>
          <td style="padding:10px 14px;border:1px solid var(--border);font-family:monospace">${esc(q.quote_no || '-')}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600;width:120px">견적명</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${esc(q.name || '-')}</td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">단가구분</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${q.vat_included ? '부가세 포함 (10% 가산)' : '부가세 미포함'}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">상태</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${esc(q.status || '-')}</td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">소계</td>
          <td style="padding:10px 14px;border:1px solid var(--border);text-align:right;font-family:monospace">${esc(Fmt.amount(q.subtotal, 'KRW'))}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">부가세</td>
          <td style="padding:10px 14px;border:1px solid var(--border);text-align:right;font-family:monospace">${esc(Fmt.amount(q.vat_amount, 'KRW'))}</td>
        </tr>
        <tr>
          <td style="background:#fff5f5;padding:14px;border:1px solid var(--border);font-weight:700;color:var(--oci-red)" colspan="3">총합계</td>
          <td style="padding:14px;border:1px solid var(--border);text-align:right;font-weight:700;font-size:16px;color:var(--oci-red);background:#fff5f5">${esc(Fmt.amount(q.total_amount, 'KRW'))}</td>
        </tr>
      </table>

      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-ghost" id="pr-quote-goto" type="button">📄 견적 모듈로 이동</button>
        <button class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">📥 견적 PDF 다운로드 (Phase 5)</button>
      </div>
      <script>
        // 인라인 — onclick 등록 (CSP 정책상 main bind 에서 처리해야 함)
      </script>
    `;
  }

  // 기본 이메일 본문 템플릿 생성 (제안 정보 기반)
  function _defaultEmailBody(e) {
    const customer = e.customer_name || '담당자';
    const title = e.proposal_title || '제안서';
    const no = e.proposal_no || '';
    return [
      `${customer} 담당자님,`,
      ``,
      `안녕하세요. 요청하신 제안 자료를 송부드립니다.`,
      ``,
      `■ 제안명: ${title}`,
      no ? `■ 제안번호: ${no}` : null,
      ``,
      `첨부 파일을 확인해 주시고, 추가 문의사항이 있으시면 회신 부탁드립니다.`,
      ``,
      `감사합니다.`,
    ]
      .filter(x => x !== null)
      .join('\n');
  }

  // 공유 링크 URL 생성 (현재 origin 기반)
  function _buildShareUrl(token) {
    if (!token) return '';
    const origin = window.location.origin;
    return `${origin}/proposal-share.html?t=${encodeURIComponent(token)}`;
  }

  // ── 탭 6: 이메일/공유 (Phase 5-D 활성) ────────────────────
  function _renderEmailTab(e) {
    const logs = Array.isArray(e.email_logs) ? e.email_logs : [];
    const files = Array.isArray(e.files) ? e.files : [];
    // 기본 첨부 — include_in_email = 1 인 파일들
    // (없으면 사용자가 직접 체크)
    const defaultAttach = new Set(files.filter(f => f.is_final || f.include_in_email).map(f => f.id));

    const hasShare = !!e.share_token;
    const shareUrl = hasShare ? _buildShareUrl(e.share_token) : '';

    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;font-size:12px;color:#166534">
        📧 <strong>이메일 발송 / 공유 링크</strong> — 제안 파일을 Gmail 로 발송하거나, 외부 접근 가능한 공유 링크를 생성합니다.
      </div>

      <!-- ━━━━━━━━━━ 이메일 발송 폼 ━━━━━━━━━━ -->
      <div class="pr-email-section">
        <div class="pr-email-title">📨 이메일 발송</div>
        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="form-row">
            <label class="form-label">받는사람 *</label>
            <input class="form-input" id="pr-email-to" type="email" multiple placeholder="client@company.com (콤마로 여러 명)">
          </div>
          <div class="form-row">
            <label class="form-label">참조 (CC)</label>
            <input class="form-input" id="pr-email-cc" type="text" placeholder="manager@company.com">
          </div>
        </div>
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">제목 *</label>
          <input class="form-input" id="pr-email-subject" type="text" value="${esc(`[제안서 송부] ${e.proposal_title || ''}`)}" placeholder="제안서 송부 안내">
        </div>
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">본문</label>
          <textarea class="form-input" id="pr-email-body" rows="7" style="resize:vertical;font-family:inherit;line-height:1.6">${esc(_defaultEmailBody(e))}</textarea>
        </div>

        <!-- 첨부 파일 선택 -->
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">📎 첨부 파일 (${files.length}건 중 선택)</label>
          ${
            files.length === 0
              ? `<div style="padding:12px;text-align:center;color:var(--text-3);font-size:12px;background:#fafafa;border:1px dashed var(--border);border-radius:6px">첨부 가능한 파일 없음 — 자료 탭에서 먼저 업로드하세요</div>`
              : `<div class="pr-email-attach-list">
                  ${files
                    .map(
                      f => `<label class="pr-email-attach-item">
                    <input type="checkbox" class="pr-email-file" value="${f.id}" ${defaultAttach.has(f.id) ? 'checked' : ''}>
                    <span class="badge badge-gray" style="font-size:10px">${esc(f.file_type)}</span>
                    <span class="pr-email-attach-name">${esc(f.original_filename)}</span>
                    <span class="pr-email-attach-size">${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</span>
                  </label>`
                    )
                    .join('')}
                </div>`
          }
        </div>

        <!-- Phase 11-A: 발송 옵션 — Outlook(mailto) 권장 + Gmail OAuth 보조 -->
        <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="pr-email-download-btn" type="button" title="선택한 첨부 파일을 로컬에 다운로드 (메일앱에서 수동 첨부용)">
            📥 첨부 파일 다운로드
          </button>
          <button class="btn btn-primary" id="pr-email-mailto-btn" type="button" title="OS 기본 메일앱(Outlook/Apple Mail 등)으로 발송 — 권장">
            📧 메일앱(Outlook)으로 발송
          </button>
          <button class="btn btn-ghost" id="pr-email-send-btn" type="button" title="Gmail OAuth 로 직접 발송 (Google 연동 필요)">
            ✉️ Gmail 발송
          </button>
        </div>
        <div style="font-size:11px;color:var(--text-3);text-align:right;margin-top:6px">
          💡 메일앱 발송: 첨부 파일은 자동 첨부 안 됨 → [📥 첨부 파일 다운로드] 후 메일앱에서 수동 첨부
        </div>
        <div id="pr-email-status" class="pr-email-status"></div>
      </div>

      <!-- ━━━━━━━━━━ 공유 링크 ━━━━━━━━━━ -->
      <div class="pr-share-section">
        <div class="pr-email-title">🔗 외부 공유 링크</div>
        ${
          hasShare
            ? `<div class="pr-share-active">
                <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">
                  ${
                    e.shared_until
                      ? `⏳ 만료: <strong>${_fmtDateTime(e.shared_until)}</strong>`
                      : '♾️ 만료 없음'
                  }
                </div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
                  <input class="form-input" id="pr-share-url" type="text" readonly value="${esc(shareUrl)}" style="font-family:monospace;font-size:11px;background:#f9fafb">
                  <button class="btn btn-ghost btn-sm" id="pr-share-copy-btn" type="button" title="링크 복사">📋</button>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:11px;color:var(--text-3)">⚠️ 외부 노출: 제목/요약/include_in_email 파일만</span>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-ghost btn-sm" id="pr-share-renew-btn" type="button">🔁 재발급</button>
                    <button class="btn btn-ghost btn-sm" id="pr-share-revoke-btn" type="button" style="color:#d93025">🗑️ 무효화</button>
                  </div>
                </div>
              </div>`
            : `<div class="pr-share-empty">
                <div style="font-size:13px;color:var(--text-2);margin-bottom:8px">아직 공유 링크가 발급되지 않았습니다</div>
                <div style="display:flex;gap:8px;align-items:center;justify-content:center">
                  <label style="font-size:12px;color:var(--text-3)">만료일</label>
                  <select class="form-input" id="pr-share-expires" style="width:120px;font-size:12px">
                    <option value="7" selected>7일</option>
                    <option value="14">14일</option>
                    <option value="30">30일</option>
                    <option value="0">무제한</option>
                  </select>
                  <button class="btn btn-primary btn-sm" id="pr-share-create-btn" type="button">🔗 링크 생성</button>
                </div>
              </div>`
        }
      </div>

      <!-- ━━━━━━━━━━ 발송 이력 ━━━━━━━━━━ -->
      <div style="font-size:12px;color:var(--text-3);margin:14px 0 8px">📬 발송 이력 (${logs.length}건)</div>
      ${
        logs.length === 0
          ? `<div style="padding:18px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;font-size:12px">아직 발송 이력 없음</div>`
          : `<table class="data-table" style="font-size:12px">
              <thead><tr>
                <th style="width:140px">발송 시각</th>
                <th>수신자</th>
                <th>제목</th>
                <th style="width:80px;text-align:center">상태</th>
                <th style="width:110px">발송자</th>
              </tr></thead>
              <tbody>
                ${logs
                  .map(
                    l => `<tr>
                  <td>${_fmtDateTime(l.sent_at)}</td>
                  <td style="font-family:monospace;font-size:11px">${esc(l.to_emails || '')}</td>
                  <td>${esc(l.subject || '')}</td>
                  <td style="text-align:center"><span class="badge badge-${l.send_status === 'sent' ? 'green' : l.send_status === 'failed' ? 'red' : 'gray'}">${esc(l.send_status || 'sent')}</span></td>
                  <td>${esc(l.sent_by_name || '-')}</td>
                </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    `;
  }

  // ── 탭 7: 리비전/이력 (Phase 2 활성) ─────────────────────
  function _renderHistoryTab(e) {
    const revs = Array.isArray(e.revisions) ? e.revisions : [];
    const hist = Array.isArray(e.history) ? e.history : [];

    const actionIcon = type =>
      ({
        create: '🆕',
        update: '✏️',
        status_change: '🔄',
        rfp_upload: '📑',
        ai_strategy: '🤖',
        file_upload: '📦',
        file_download: '⬇️',
        file_delete: '🗑️',
        email_send: '📧',
        share_create: '🔗',
        revision_create: '🌿',
        quote_link: '💰',
      })[type] || '•';

    return `
      <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:14px">
        <!-- 리비전 목록 -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:13px">🌿 리비전 목록 (${revs.length}건)</strong>
            <button class="btn btn-ghost btn-sm" id="pr-rev-new-btn" type="button">+ 새 리비전</button>
          </div>
          ${
            revs.length === 0
              ? `<div style="padding:24px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px;font-size:12px">
                  아직 리비전이 없습니다 (v${e.version_no || 1} 만 존재)
                </div>`
              : `<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
                  ${revs
                    .map(
                      r => `<div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#fff">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                      <strong style="font-size:13px;color:var(--oci-red)">🌿 v${r.revision_no}</strong>
                      <span style="font-size:11px;color:var(--text-3)">${_fmtDateTime(r.created_at)}</span>
                    </div>
                    ${r.title ? `<div style="font-size:12px;color:var(--text-1);margin-bottom:2px">${esc(r.title)}</div>` : ''}
                    ${r.description ? `<div style="font-size:11px;color:var(--text-3);white-space:pre-wrap">${esc(r.description)}</div>` : ''}
                  </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>

        <!-- 이력 타임라인 -->
        <div>
          <strong style="font-size:13px;display:block;margin-bottom:8px">🕒 변경 이력 (${hist.length}건)</strong>
          ${
            hist.length === 0
              ? `<div style="padding:24px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px;font-size:12px">
                  이력이 없습니다
                </div>`
              : `<div style="border:1px solid var(--border);border-radius:6px;max-height:480px;overflow-y:auto">
                  ${hist
                    .map(
                      (h, i) => `<div style="padding:10px 14px;border-bottom:${i < hist.length - 1 ? '1px solid var(--border)' : 'none'};background:#fff;display:flex;gap:10px;align-items:flex-start">
                    <div style="font-size:18px;flex-shrink:0">${actionIcon(h.action_type)}</div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px">
                        <strong style="font-size:12px;color:var(--text-1)">${esc(h.action_type)}</strong>
                        <span style="font-size:11px;color:var(--text-3);flex-shrink:0">${_fmtDateTime(h.created_at)}</span>
                      </div>
                      ${h.description ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:2px">${esc(h.description)}</div>` : ''}
                      ${
                        h.old_value || h.new_value
                          ? `<div style="font-size:11px;color:var(--text-3);font-family:monospace">${h.old_value ? esc(h.old_value) + ' → ' : ''}${h.new_value ? esc(h.new_value) : ''}</div>`
                          : ''
                      }
                      ${h.created_by_name ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">by ${esc(h.created_by_name)}</div>` : ''}
                    </div>
                  </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;
  }

  // ── 유틸 (Combobox/Team 옵션) ────────────────────────────
  function _leadInitialText(leadId) {
    if (!leadId) return '';
    const l = _leadsCache.find(x => String(x.id) === String(leadId));
    if (!l) return '';
    return `${l.customer_name || ''}${l.project_name ? ' - ' + l.project_name : ''}`;
  }
  function _quoteInitialText(quoteId) {
    if (!quoteId) return '';
    const q = _quotesCache.find(x => String(x.id) === String(quoteId));
    if (!q) return '';
    return `${q.quote_no || ''} — ${q.name || ''}`;
  }
  function _teamOptions(selectedId) {
    return (
      `<option value="">-- 담당자 선택 --</option>` +
      _teamCache
        .map(
          m =>
            `<option value="${m.id}" ${String(m.id) === String(selectedId) ? 'selected' : ''}>${esc(m.name)}</option>`
        )
        .join('')
    );
  }

  // ── Combobox attach (기본정보 탭) ────────────────────────
  function _attachLeadCombobox() {
    const input = document.getElementById('pr-f-lead-input');
    const hidden = document.getElementById('pr-f-lead_id');
    const custHidden = document.getElementById('pr-f-customer_id');
    if (!input || !hidden || typeof Combobox === 'undefined') return;

    input.addEventListener('input', () => {
      if (!input.value.trim()) {
        hidden.value = '';
        if (custHidden) custHidden.value = '';
      }
    });

    const cb = Combobox.attach({
      inputEl: input,
      fetchFn: q => {
        const ql = (q || '').toLowerCase();
        if (!ql) return _leadsCache.slice(0, 20);
        return _leadsCache
          .filter(
            l =>
              (l.customer_name || '').toLowerCase().includes(ql) ||
              (l.project_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 20);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.customer_name || '', q)}${item.project_name ? ' - ' + highlightMatch(item.project_name, q) : ''}`;
        const meta = [];
        if (item.stage) meta.push(esc(item.stage));
        if (item.expected_amount)
          meta.push(esc(Fmt.amount(item.expected_amount, item.currency || 'KRW')));
        return `<div class="combobox-item-content">
            <div class="combobox-item-title">💼 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>`;
      },
      onSelect: item => {
        input.value = `${item.customer_name || ''}${item.project_name ? ' - ' + item.project_name : ''}`;
        hidden.value = item.id;
        if (custHidden) custHidden.value = item.customer_id || '';
        const titleEl = document.getElementById('pr-f-proposal_title');
        const custEl = document.getElementById('pr-f-customer_name');
        if (titleEl && !titleEl.value.trim()) {
          titleEl.value = item.project_name
            ? `${item.customer_name || ''} ${item.project_name} 제안서`
            : `${item.customer_name || ''} 제안서`;
        }
        if (custEl && !custEl.value.trim() && item.customer_name) {
          custEl.value = item.customer_name;
        }
      },
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
    _comboboxes.push(cb);
  }

  function _attachQuoteCombobox(_initialId) {
    const input = document.getElementById('pr-f-quote-input');
    const hidden = document.getElementById('pr-f-quote_id');
    if (!input || !hidden || typeof Combobox === 'undefined') return;

    input.addEventListener('input', () => {
      if (!input.value.trim()) hidden.value = '';
    });

    const cb = Combobox.attach({
      inputEl: input,
      fetchFn: q => {
        const ql = (q || '').toLowerCase();
        if (!ql) return _quotesCache.slice(0, 20);
        return _quotesCache
          .filter(
            x =>
              (x.quote_no || '').toLowerCase().includes(ql) ||
              (x.name || '').toLowerCase().includes(ql) ||
              (x.customer_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 20);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.quote_no || '', q)} — ${highlightMatch(item.name || '', q)}`;
        const meta = [];
        if (item.customer_name) meta.push(esc(item.customer_name));
        if (item.total_amount) meta.push(esc(Fmt.amount(item.total_amount, 'KRW')));
        return `<div class="combobox-item-content">
            <div class="combobox-item-title">📄 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>`;
      },
      onSelect: item => {
        input.value = `${item.quote_no || ''} — ${item.name || ''}`;
        hidden.value = item.id;
        const amtEl = document.getElementById('pr-f-expected_amount');
        const custEl = document.getElementById('pr-f-customer_name');
        if (amtEl && !amtEl.value && item.total_amount) {
          amtEl.value = item.total_amount;
        }
        if (custEl && !custEl.value.trim() && item.customer_name) {
          custEl.value = item.customer_name;
        }
      },
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
    _comboboxes.push(cb);
  }

  // ── 저장 (기본정보 + RFP 메타정보 통합 저장) ──────────────
  async function _save() {
    // 기본정보 탭 필수 필드 (탭 전환 후 DOM 에 없을 수도 있음 → 신규 등록 시는 반드시 기본정보 탭에서 시작)
    // 편집 모드에서 다른 탭 활성 시: 기본정보 필드는 미존재 → _editing 값 fallback
    const get = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    };
    const e = _editing || {};

    const title = (get('pr-f-proposal_title', e.proposal_title || '') || '').trim();
    const customer = (get('pr-f-customer_name', e.customer_name || '') || '').trim();
    // proposal_date — DOM 이 없으면 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화
    const date = get('pr-f-proposal_date', '') || _toInputDate(e.proposal_date);

    // 필수값 누락 시: 재렌더 금지 (사용자 입력 보존) — 해당 input 으로 포커스만 이동
    const focusField = id => {
      const el = document.getElementById(id);
      if (el && typeof el.focus === 'function') {
        try {
          el.focus();
          el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        } catch (_) {}
      }
    };
    if (!title) {
      Toast.error('제안명을 입력하세요 (기본정보 탭)');
      focusField('pr-f-proposal_title');
      return;
    }
    if (!customer) {
      Toast.error('고객사명을 입력하세요 (기본정보 탭)');
      focusField('pr-f-customer_name');
      return;
    }
    if (!date) {
      Toast.error('제안일을 입력하세요 (기본정보 탭)');
      focusField('pr-f-proposal_date');
      return;
    }

    const leadId = get('pr-f-lead_id', e.lead_id || '');
    const customerId = get('pr-f-customer_id', e.customer_id || '');
    const quoteId = get('pr-f-quote_id', e.quote_id || '');
    // due_date — DOM 없을 때 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화 (빈값 유지)
    const dueDate = get('pr-f-due_date', '') || (e.due_date ? _toInputDate(e.due_date) : '');
    const ownerId = get('pr-f-owner_id', e.owner_id || '');
    const expected = get('pr-f-expected_amount', e.expected_amount || '');
    const currency = get('pr-f-currency', e.currency || 'KRW');
    const status = get('pr-f-status', e.status || 'draft');
    const remark = get('pr-f-remark', e.remark || '');

    const body = {
      proposal_title: title,
      customer_name: customer,
      proposal_date: date,
      due_date: dueDate || null,
      lead_id: leadId ? parseInt(leadId, 10) : null,
      customer_id: customerId ? parseInt(customerId, 10) : null,
      quote_id: quoteId ? parseInt(quoteId, 10) : null,
      owner_id: ownerId ? parseInt(ownerId, 10) : null,
      expected_amount: expected ? Number(expected) : null,
      currency: currency || 'KRW',
      status: status || 'draft',
      remark: remark || null,
    };

    // RFP 메타정보 (탭에서 입력됐으면 함께 저장)
    const rfpTitle = get('pr-f-rfp_title', e.rfp_title || '');
    // RFP 날짜 — DOM 없을 때 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화 (빈값 유지)
    const rfpReceived =
      get('pr-f-rfp_received_date', '') ||
      (e.rfp_received_date ? _toInputDate(e.rfp_received_date) : '');
    const rfpDue =
      get('pr-f-rfp_due_date', '') || (e.rfp_due_date ? _toInputDate(e.rfp_due_date) : '');
    const rfpSummary = get('pr-f-rfp_summary', e.rfp_summary || '');
    // Phase 8-C: AI 제안전략 요약 textarea (편집 가능 — 비고 자리에 통합됨)
    const aiStrategyMd = get('pr-f-ai_strategy_md', e.ai_strategy_md || '');
    // Phase 9-2: _editing 항상 truthy (신규도 임시 제안 자동 생성됨) → RFP/AI 필드 항상 전송
    body.rfp_title = rfpTitle || null;
    body.rfp_received_date = rfpReceived || null;
    body.rfp_due_date = rfpDue || null;
    body.rfp_summary = rfpSummary || null;
    body.ai_strategy_md = aiStrategyMd || null;

    try {
      // Phase 9-2: 신규/편집 통합 — 항상 PUT 사용 (임시 제안이 이미 백엔드에 존재)
      await API.proposals.update(_editing.id, body);
      Toast.success(_isTempProposal ? `제안 생성됨 — ${_editing.proposal_no || ''}` : '제안 수정됨');
      _isTempProposal = false; // 저장 후 정상 제안으로 전환
      _cleanupInstances();
      Modal.close();
      await _reload();
    } catch (err) {
      Toast.error('저장 실패: ' + (err.message || err));
    }
  }

  // ── Phase 3+4-C: 파일 업로드/삭제 + AI 분석 ─────────────────
  function _bindFileEvents(e, source) {
    if (!e || !e.id) return; // 신규 모드는 파일 기능 없음
    const dropzoneId = source === 'rfp' ? 'pr-rfp-dropzone' : 'pr-files-dropzone';
    const inputId = source === 'rfp' ? 'pr-rfp-upload-input' : 'pr-file-upload-input';
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(inputId);

    // (1) 클릭 → 파일 다이얼로그
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', ev => {
        if (ev.target.tagName === 'INPUT') return;
        fileInput.click();
      });
      dropzone.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fileInput.click();
        }
      });

      // (2) Drag & Drop
      ['dragenter', 'dragover'].forEach(evt =>
        dropzone.addEventListener(evt, ev => {
          ev.preventDefault();
          ev.stopPropagation();
          dropzone.classList.add('is-dragover');
        })
      );
      ['dragleave', 'drop'].forEach(evt =>
        dropzone.addEventListener(evt, ev => {
          ev.preventDefault();
          ev.stopPropagation();
          dropzone.classList.remove('is-dragover');
        })
      );
      dropzone.addEventListener('drop', async ev => {
        const files = Array.from(ev.dataTransfer?.files || []);
        if (files.length === 0) return;
        await _doUploadFiles(e.id, files, source);
      });

      // (3) input change (다중)
      fileInput.addEventListener('change', async ev => {
        const files = Array.from(ev.target.files || []);
        if (files.length === 0) return;
        await _doUploadFiles(e.id, files, source);
        ev.target.value = ''; // reset for re-upload
      });
    }

    // (4) 파일 삭제 버튼
    document.querySelectorAll('.pr-file-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        if (!confirm('이 파일을 삭제하시겠습니까? 디스크에서도 함께 제거됩니다.')) return;
        try {
          await API.proposals.deleteFile(e.id, fileId);
          Toast.success('파일 삭제됨');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('삭제 실패: ' + (err.message || err));
        }
      });
    });

    // (5) Phase 12: AI 제안평가 큰 CTA 버튼 (자료 섹션 하단)
    //   _renderFileList 의 행 단위 [AI제안평가] 버튼은 제거됨
    //   분석 가능한 첫 번째 자료 파일을 자동 선택 (기본탭 AI 분석 패턴 동일)
    const evalCta = document.getElementById('pr-evaluate-cta');
    if (evalCta && source === 'files') {
      evalCta.addEventListener('click', async () => {
        const evalFiles = (e.files || []).filter(
          f => f.file_type !== 'rfp' && _isAnalyzable(f.original_filename)
        );
        if (evalFiles.length === 0) {
          Toast.error('평가 가능한 제안서가 없습니다 — PDF/이미지/텍스트 파일을 먼저 업로드하세요');
          return;
        }
        // 첫 번째 분석 가능 파일로 평가
        await _doEvaluateProposal(e.id, evalFiles[0].id, evalCta);
      });
    }

    // 다운로드는 href 직접 — history 기록은 백엔드 자동
  }

  // Phase 6-C: AI 제안서 평가 + 결과 카드 표시
  async function _doEvaluateProposal(propId, fileId, btn) {
    // Phase 9-5: 사전 검증 — RFP 파일이 분석 가능한 형식인지 (서버 호출 전 검증)
    const rfpFiles = (_editing?.files || []).filter(f => f.file_type === 'rfp');
    const analyzableRfp = rfpFiles.filter(f => _isAnalyzable(f.original_filename));
    if (analyzableRfp.length === 0) {
      if (rfpFiles.length > 0) {
        Toast.error(
          '⚠️ 등록된 RFP 파일이 분석 불가 형식입니다.\nPDF / 이미지(PNG·JPG·WEBP) / 텍스트만 평가 가능.\nPPT/DOC/HWP/XLS 는 PDF 로 변환 후 다시 업로드하세요.',
          { duration: 10000 }
        );
      } else {
        Toast.error(
          '⚠️ 기본정보 탭의 RFP 영역에 PDF 파일을 먼저 업로드하세요.\n(AI 평가는 RFP 와 제안서를 동시에 비교합니다)',
          { duration: 8000 }
        );
      }
      return;
    }

    // 기존 평가 결과가 화면에 있으면 덮어쓰기 confirm
    const existingCard = document.getElementById('pr-eval-card');
    if (existingCard) {
      const ok = confirm(
        '기존 평가 결과를 새로운 평가로 교체하시겠습니까?\n(약 10-30초 소요, 비용 발생)'
      );
      if (!ok) return;
    } else {
      // 첫 평가도 비용 발생 confirm (사용자 의식적 클릭)
      const ok = confirm(
        'AI 평가를 진행하시겠습니까?\nGemini Pro 호출 — 약 10-30초 소요, 1회 약 300-500원 발생'
      );
      if (!ok) return;
    }

    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳';
    }
    const resultWrap = document.getElementById('pr-eval-result');
    if (resultWrap) {
      resultWrap.innerHTML = `<div class="pr-eval-loading">
        <div class="pr-eval-spinner"></div>
        <div>📊 AI 평가 진행 중... (RFP 와 제안서 비교, 최대 30초 소요)</div>
      </div>`;
      resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      Toast.info?.('AI 평가 시작 — RFP 자동 선택 (file_type=rfp 첫 파일)');
      const res = await API.proposals.evaluate(propId, fileId);
      const data = res?.data || {};
      if (resultWrap) {
        resultWrap.innerHTML = _renderEvalResult(data);
        // 닫기 버튼 바인딩
        const closeBtn = document.getElementById('pr-eval-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            resultWrap.innerHTML = '';
          });
        }
        resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      Toast.success(
        `평가 완료 — 커버율 ${data.coverage_score}% (충족 ${data.covered_count} / 누락 ${data.missing_count})`
      );
    } catch (err) {
      console.error('[proposals:evaluate] failed:', err);
      const detail =
        err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
      Toast.error('AI 평가 실패: ' + detail, { duration: 8000 });
      if (resultWrap) {
        resultWrap.innerHTML = `<div class="pr-eval-error">❌ ${esc(detail)}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  // Phase 4-C — 다중 파일 업로드 (드롭존 / multi input 공통)
  async function _doUploadFiles(propId, files, source) {
    if (!files || !files.length) return;
    const fd = new FormData();
    files.forEach(file => fd.append('files', file));

    try {
      if (source === 'rfp') {
        // RFP 메타도 함께 (현재 탭 입력값)
        const title = document.getElementById('pr-f-rfp_title')?.value || '';
        const recv = document.getElementById('pr-f-rfp_received_date')?.value || '';
        const due = document.getElementById('pr-f-rfp_due_date')?.value || '';
        if (title) fd.append('rfp_title', title);
        if (recv) fd.append('rfp_received_date', recv);
        if (due) fd.append('rfp_due_date', due);
        Toast.info?.(`RFP ${files.length}개 파일 업로드 중...`);
        const res = await API.proposals.uploadRfp(propId, fd);
        _reportUploadResult(res, 'RFP');
      } else {
        const type = document.getElementById('pr-file-type')?.value || 'etc';
        const rev = document.getElementById('pr-file-rev')?.value || '1';
        const isFinal = document.getElementById('pr-file-final')?.checked ? '1' : '0';
        const inEmail = document.getElementById('pr-file-email')?.checked ? '1' : '0';
        const desc = document.getElementById('pr-file-desc')?.value || '';
        fd.append('file_type', type);
        fd.append('revision_no', rev);
        fd.append('is_final', isFinal);
        fd.append('include_in_email', inEmail);
        if (desc) fd.append('description', desc);
        Toast.info?.(`${files.length}개 파일 업로드 중...`);
        const res = await API.proposals.uploadFile(propId, fd);
        _reportUploadResult(res, '파일');
      }
      await _refreshDetail(propId);
    } catch (err) {
      Toast.error('업로드 실패: ' + (err.message || err));
    }
  }

  // 다중 업로드 결과 보고 (uploaded / failed 집계 Toast)
  function _reportUploadResult(res, label) {
    const data = res?.data || {};
    const uploaded = (data.uploaded || []).length;
    const failed = (data.failed || []).length;
    if (uploaded > 0 && failed === 0) {
      Toast.success(`${label} ${uploaded}개 업로드 완료`);
    } else if (uploaded > 0 && failed > 0) {
      Toast.error(`${label} ${uploaded}개 성공 / ${failed}개 실패`);
      // 실패 파일명 첫 1건 추가 알림
      const first = data.failed[0];
      if (first) Toast.error(`실패: ${first.original_filename} — ${first.error}`);
    } else if (uploaded === 0 && failed > 0) {
      Toast.error(`${label} 업로드 모두 실패 (${failed}건)`);
    }
  }

  // Phase 4-C — AI RFP 분석 + 폼 미리채움 (DB 자동 저장 X)
  // 4-D 보강: 상세 에러 표시 + console.error + 타임아웃 안내
  async function _doAnalyzeRfp(propId, fileId, btn) {
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳';
    }
    try {
      Toast.info?.('AI 분석 중... (최대 60초 소요)');
      const res = await API.proposals.analyzeRfp(propId, fileId);
      const d = res?.data || {};
      _applyAnalysisToForm(d);
      Toast.success('AI 분석 완료 — 폼에 결과가 채워졌습니다. 검토 후 [저장] 누르세요');
    } catch (err) {
      // 디버깅용 콘솔 (개발자도구 확인 가능)
      console.error('[proposals:analyze] failed:', err);
      // 상세 메시지 추출 — err.error / err.message / err.status
      const detail =
        err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
      Toast.error('AI 분석 실패: ' + detail, { duration: 8000 });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  // 분석 결과를 기본정보 탭 폼에 미리채움 + _editing 캐시 동기화 (DB 미반영)
  // Phase 8-C + Phase 9: ai_strategy_md + 제안 기본정보 (고객사/제안명/예상금액/통화/일정) 자동 채움
  // 사용자 워크플로우: [AI 분석] 클릭 = "AI 결과로 폼 채워줘" → 모두 force 덮어쓰기 (사용자가 다시 수정 가능)
  function _applyAnalysisToForm(d) {
    const setForce = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== null && v !== undefined && v !== '') el.value = v;
    };
    // ── RFP 메타 (항상 덮어쓰기 — AI 가 더 정확) ──
    if (d.rfp_title) setForce('pr-f-rfp_title', d.rfp_title);
    if (d.rfp_received_date) setForce('pr-f-rfp_received_date', d.rfp_received_date);
    if (d.rfp_due_date) setForce('pr-f-rfp_due_date', d.rfp_due_date);
    if (d.rfp_summary) setForce('pr-f-rfp_summary', d.rfp_summary);
    // ── AI 제안전략 요약 (textarea 항상 덮어쓰기) ──
    if (d.ai_strategy_md) setForce('pr-f-ai_strategy_md', d.ai_strategy_md);
    // ── Phase 8-A + Phase 9: 제안 기본정보 (AI 분석 결과 강제 채움 — 사용자 의도) ──
    // 사용자 워크플로우상 [AI 분석] 클릭 = "AI 결과 우선" 의미. 빈 값 검증 없이 덮어쓰기.
    if (d.customer_name) setForce('pr-f-customer_name', d.customer_name);
    if (d.proposal_title) setForce('pr-f-proposal_title', d.proposal_title);
    if (d.expected_amount) setForce('pr-f-expected_amount', d.expected_amount);
    // currency 는 select — 옵션이 일치하면 강제 (KRW 기본값 보호)
    if (d.currency) {
      const sel = document.getElementById('pr-f-currency');
      if (sel && Array.from(sel.options).some(o => o.value === d.currency)) {
        sel.value = d.currency;
      }
    }
    // 제안일/제출기한 — RFP 일정 강제 채움 (사용자가 다시 수정 가능)
    if (d.rfp_received_date) setForce('pr-f-proposal_date', d.rfp_received_date);
    if (d.rfp_due_date) setForce('pr-f-due_date', d.rfp_due_date);

    // _editing 캐시도 동기화 — 탭 전환해도 결과 유지
    if (_editing) {
      if (d.rfp_title) _editing.rfp_title = d.rfp_title;
      if (d.rfp_received_date) _editing.rfp_received_date = d.rfp_received_date;
      if (d.rfp_due_date) _editing.rfp_due_date = d.rfp_due_date;
      if (d.rfp_summary) _editing.rfp_summary = d.rfp_summary;
      if (d.ai_strategy_md) _editing.ai_strategy_md = d.ai_strategy_md;
      if (d.customer_name) _editing.customer_name = d.customer_name;
      if (d.proposal_title) _editing.proposal_title = d.proposal_title;
      if (d.expected_amount) _editing.expected_amount = d.expected_amount;
      if (d.currency) _editing.currency = d.currency;
    }
  }

  async function _refreshDetail(propId) {
    try {
      const r = await API.proposals.get(propId);
      _editing = r.data;
      _renderActiveTab(_editing);
    } catch (_) {
      /* 무시 */
    }
  }

  // ── Phase 8-C: AI 분석 + 미리보기 + 복사 (기본정보 탭 통합) ─
  // 분석 버튼은 RFP 섹션에 있고, 미리보기/복사는 AI 제안전략 요약 섹션에 있음
  function _bindAiTabEvents(e) {
    if (!e || !e.id) return;
    const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
    const analyzableFiles = rfpFiles.filter(f => _isAnalyzable(f.original_filename));

    // (1) 분석 / 재생성 버튼 (RFP 섹션) — 결과를 폼에 자동 채움
    const analyzeBtn = document.getElementById('pr-ai-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', async () => {
        if (analyzableFiles.length === 0) {
          if (rfpFiles.length > 0) {
            Toast.error(
              '분석 가능한 형식이 아닙니다 — PDF / 이미지 / 텍스트만 지원 (PPT/DOC/HWP 는 PDF 로 변환)'
            );
          } else {
            Toast.error('RFP 파일이 없습니다. 먼저 업로드하세요.');
          }
          return;
        }
        const currentMd = (
          document.getElementById('pr-f-ai_strategy_md')?.value ||
          e.ai_strategy_md ||
          ''
        ).trim();
        if (currentMd) {
          const ok = confirm(
            '기존 AI 제안전략 요약을 덮어쓰시겠습니까?\n(저장 전이면 [닫기]로 취소 가능합니다)'
          );
          if (!ok) return;
        }
        await _doAnalyzeRfp(e.id, analyzableFiles[0].id, analyzeBtn);
        // Phase 8-C: 분석 결과를 폼에 즉시 채움 (textarea + 제안 기본정보)
        // _doAnalyzeRfp 내부에서 _applyAnalysisToForm 호출됨
      });
    }

    // (2) Phase 9-3: Word(.docx) 다운로드 — 현재 textarea 내용으로 즉시 다운로드
    //   미저장 변경사항이 있으면 먼저 [💾 저장] 안내, 저장 후 백엔드 endpoint 호출
    const wordBtn = document.getElementById('pr-ai-word-btn');
    if (wordBtn) {
      wordBtn.addEventListener('click', async () => {
        const ta = document.getElementById('pr-f-ai_strategy_md');
        const currentMd = (ta?.value || '').trim();
        if (!currentMd) {
          Toast.error('다운로드할 AI 제안전략 요약이 비어있습니다');
          return;
        }
        // 사용자가 textarea 를 수정했는지 확인 (서버의 ai_strategy_md 와 비교)
        const savedMd = (_editing?.ai_strategy_md || '').trim();
        if (currentMd !== savedMd) {
          const ok = confirm(
            '⚠️ 미저장 변경사항이 있습니다.\n저장 후 다운로드해야 최신 내용이 반영됩니다.\n그래도 현재 저장된 내용으로 다운로드할까요?'
          );
          if (!ok) {
            Toast.info?.('[💾 저장] 후 다시 시도하세요');
            return;
          }
        }
        // 브라우저가 직접 다운로드 (인증 쿠키 자동 포함)
        try {
          const url = API.proposals.aiStrategyWordUrl(e.id);
          // 인증 토큰 필요 — fetch 로 blob 받아서 다운로드
          //   토큰 키는 API.js 와 동일: oci_token / current_user_id
          const token =
            localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
          const userId = localStorage.getItem('current_user_id') || '';
          const headers = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          if (userId) headers['X-User-Id'] = userId;
          const resp = await fetch(url, { headers, credentials: 'include' });
          if (!resp.ok) {
            let msg = `HTTP ${resp.status}`;
            try {
              const j = await resp.json();
              if (j?.error) msg = j.error;
            } catch (_) {}
            throw new Error(msg);
          }
          const blob = await resp.blob();
          // Content-Disposition 의 filename 추출 (UTF-8 encoded)
          const cd = resp.headers.get('Content-Disposition') || '';
          let filename = `AI제안전략요약.docx`;
          const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
          if (m) {
            try {
              filename = decodeURIComponent(m[1]);
            } catch (_) {}
          }
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          Toast.success('Word(.docx) 다운로드 완료');
        } catch (err) {
          console.error('[proposals:word] failed:', err);
          Toast.error('Word 다운로드 실패: ' + (err.message || err));
        }
      });
    }

    // (3) 복사 버튼 — clipboard.writeText (textarea 의 현재 값)
    const copyBtn = document.getElementById('pr-ai-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const md = (document.getElementById('pr-f-ai_strategy_md')?.value || '').trim();
        if (!md) {
          Toast.error('복사할 내용이 없습니다');
          return;
        }
        try {
          await navigator.clipboard.writeText(md);
          Toast.success('마크다운 클립보드에 복사됨');
        } catch (_) {
          // fallback — textarea 임시 사용
          const tmp = document.createElement('textarea');
          tmp.value = md;
          tmp.style.position = 'fixed';
          tmp.style.left = '-9999px';
          document.body.appendChild(tmp);
          tmp.select();
          try {
            document.execCommand('copy');
            Toast.success('마크다운 클립보드에 복사됨');
          } catch (_) {
            Toast.error('복사 실패 — 수동 선택 후 복사하세요');
          }
          document.body.removeChild(tmp);
        }
      });
    }
  }

  // ── Phase 5-D + Phase 11-A: 이메일/공유 탭 이벤트 ───────
  function _bindEmailTabEvents(e) {
    if (!e || !e.id) return;

    // Phase 11-A: 메일앱(Outlook) mailto: 발송 — 견적 모듈 패턴 재사용
    const mailtoBtn = document.getElementById('pr-email-mailto-btn');
    if (mailtoBtn) {
      mailtoBtn.addEventListener('click', () => {
        const to = (document.getElementById('pr-email-to')?.value || '').trim();
        const cc = (document.getElementById('pr-email-cc')?.value || '').trim();
        const subject = (document.getElementById('pr-email-subject')?.value || '').trim();
        const body = (document.getElementById('pr-email-body')?.value || '').trim();
        if (!subject) {
          Toast.error('제목을 입력하세요');
          return;
        }
        // mailto: URL 조립 (to/cc/subject/body 모두 URL encode)
        const params = [];
        if (cc) params.push(`cc=${encodeURIComponent(cc)}`);
        params.push(`subject=${encodeURIComponent(subject)}`);
        params.push(`body=${encodeURIComponent(body)}`);
        const mailto = `mailto:${encodeURIComponent(to)}?${params.join('&')}`;
        // mailto 길이 한계 (~2000자) 확인
        if (mailto.length > 2000) {
          Toast.error('본문이 너무 깁니다. 메일앱에서 직접 입력하거나 Gmail 발송을 사용하세요', {
            duration: 8000,
          });
          return;
        }
        // 새 창/탭 트리거 — OS 기본 메일앱 자동 실행
        window.location.href = mailto;
        const statusEl = document.getElementById('pr-email-status');
        if (statusEl) {
          statusEl.innerHTML =
            '✅ 메일앱(Outlook/Apple Mail 등)이 실행되었습니다. 첨부 파일이 있으면 [📥 첨부 파일 다운로드] 후 수동 첨부하세요.';
        }
      });
    }

    // Phase 11-A: 첨부 파일 일괄 다운로드 (메일앱에서 수동 첨부용)
    const downloadBtn = document.getElementById('pr-email-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const fileIds = Array.from(document.querySelectorAll('.pr-email-file:checked')).map(el =>
          parseInt(el.value, 10)
        );
        if (fileIds.length === 0) {
          Toast.error('다운로드할 첨부 파일을 선택하세요 (체크박스)');
          return;
        }
        // 각 파일에 대해 별도 다운로드 트리거 (브라우저가 순차 다운로드)
        fileIds.forEach((fid, idx) => {
          setTimeout(() => {
            const a = document.createElement('a');
            a.href = API.proposals.downloadFileUrl(e.id, fid);
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }, idx * 250); // 250ms 간격 (브라우저 다운로드 차단 회피)
        });
        Toast.success(`${fileIds.length}개 첨부 파일 다운로드 시작`);
      });
    }

    // (1) 이메일 발송 버튼
    const sendBtn = document.getElementById('pr-email-send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const to = (document.getElementById('pr-email-to')?.value || '').trim();
        const cc = (document.getElementById('pr-email-cc')?.value || '').trim();
        const subject = (document.getElementById('pr-email-subject')?.value || '').trim();
        const body = (document.getElementById('pr-email-body')?.value || '').trim();
        const fileIds = Array.from(document.querySelectorAll('.pr-email-file:checked')).map(el =>
          parseInt(el.value, 10)
        );

        if (!to || !/@/.test(to)) {
          Toast.error('받는사람 이메일 주소를 입력하세요');
          return;
        }
        if (!subject) {
          Toast.error('제목을 입력하세요');
          return;
        }

        // 첨부 합계 크기 사전 표시 (백엔드도 검증)
        const files = (e.files || []).filter(f => fileIds.includes(f.id));
        const totalBytes = files.reduce((sum, f) => sum + (f.file_size || 0), 0);
        if (totalBytes > 25 * 1024 * 1024) {
          Toast.error(
            `첨부 합계 ${(totalBytes / 1024 / 1024).toFixed(1)}MB — 25MB 한도 초과. 일부 파일 제외 후 재시도`
          );
          return;
        }

        const origText = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '⏳ 발송 중...';
        const statusEl = document.getElementById('pr-email-status');
        if (statusEl) statusEl.innerHTML = '⏳ Gmail 발송 중...';
        try {
          const res = await API.proposals.sendEmail(e.id, {
            to,
            cc,
            subject,
            body,
            file_ids: fileIds,
          });
          const d = res?.data || {};
          Toast.success(
            `발송 완료 — 첨부 ${d.attachment_count}개 (${((d.total_bytes || 0) / 1024).toFixed(1)}KB)`
          );
          if (statusEl) {
            statusEl.innerHTML = `✅ 발송 완료 — message_id: <code>${esc(d.message_id || '-')}</code>`;
          }
          // 발송 이력 갱신
          await _refreshDetail(e.id);
        } catch (err) {
          console.error('[proposals:email send] failed:', err);
          const detail =
            err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
          Toast.error('이메일 발송 실패: ' + detail, { duration: 8000 });
          if (statusEl) statusEl.innerHTML = `❌ 실패: ${esc(detail)}`;
          // Gmail 미연결 안내
          if (err?.notConnected || /Google 인증|gmail/i.test(detail)) {
            Toast.error('Google 계정을 먼저 연결하세요 (설정 → Google 연동)', { duration: 8000 });
          }
        } finally {
          sendBtn.disabled = false;
          sendBtn.innerHTML = origText;
        }
      });
    }

    // (2) 공유 링크 생성
    const createBtn = document.getElementById('pr-share-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const days = parseInt(document.getElementById('pr-share-expires')?.value, 10);
        const origText = createBtn.innerHTML;
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳';
        try {
          await API.proposals.createShare(e.id, Number.isFinite(days) ? days : 7);
          Toast.success('공유 링크 발급 완료');
          await _refreshDetail(e.id);
        } catch (err) {
          console.error('[proposals:share create] failed:', err);
          Toast.error('공유 링크 발급 실패: ' + (err?.error || err?.message || err));
          createBtn.disabled = false;
          createBtn.innerHTML = origText;
        }
      });
    }

    // (3) 공유 링크 재발급 — 기존 토큰 무효화 + 새 발급
    const renewBtn = document.getElementById('pr-share-renew-btn');
    if (renewBtn) {
      renewBtn.addEventListener('click', async () => {
        const ok = confirm(
          '공유 링크를 재발급하시겠습니까?\n현재 링크는 즉시 무효화되고, 새 링크가 생성됩니다.'
        );
        if (!ok) return;
        try {
          await API.proposals.createShare(e.id, 7);
          Toast.success('공유 링크 재발급 완료');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('재발급 실패: ' + (err?.error || err?.message || err));
        }
      });
    }

    // (4) 공유 링크 무효화
    const revokeBtn = document.getElementById('pr-share-revoke-btn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', async () => {
        const ok = confirm('공유 링크를 무효화하시겠습니까?\n외부 접근이 즉시 차단됩니다.');
        if (!ok) return;
        try {
          await API.proposals.revokeShare(e.id);
          Toast.success('공유 링크 무효화됨');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('무효화 실패: ' + (err?.error || err?.message || err));
        }
      });
    }

    // (5) 공유 URL 클립보드 복사
    const copyBtn = document.getElementById('pr-share-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const url = document.getElementById('pr-share-url')?.value || '';
        if (!url) {
          Toast.error('복사할 URL 이 없습니다');
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          Toast.success('공유 링크가 클립보드에 복사됨');
        } catch (_) {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            Toast.success('공유 링크가 클립보드에 복사됨');
          } catch (_) {
            Toast.error('복사 실패 — 수동 선택 후 복사하세요');
          }
          document.body.removeChild(ta);
        }
      });
    }
  }

  function _bindHistoryEvents(e) {
    const btn = document.getElementById('pr-rev-new-btn');
    if (!btn) return;
    btn.addEventListener('click', () => _openRevisionModal(e));
  }

  // ── 리비전 생성 모달 (작은 nested-ish — Modal.open 사용) ─────
  function _openRevisionModal(e) {
    const nextRev = (e.version_no || 1) + 1;
    Modal.open({
      title: `🌿 새 리비전 생성 — v${nextRev}`,
      width: 560,
      compact: true,
      confirmOnClose: false,
      body: `
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">리비전 제목 (선택)</label>
          <input class="form-input" id="pr-rev-title" placeholder="예: 1차 수정안 / 가격 협상안" value="v${nextRev}">
        </div>
        <div class="form-row">
          <label class="form-label">변경 내용 / 설명 (선택)</label>
          <textarea class="form-input" id="pr-rev-desc" rows="4" placeholder="이 리비전에서 변경된 주요 내용 (예: 가격 5% 인하, 일정 2주 단축)" style="resize:vertical;font-family:inherit"></textarea>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">
          ⚠️ 새 리비전 생성 후 제안의 version_no 가 v${nextRev} 로 갱신됩니다.
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="pr-rev-cancel-btn">취소</button>
        <button class="btn btn-primary" id="pr-rev-save-btn">💾 리비전 생성</button>
      `,
      bind: {
        '#pr-rev-cancel-btn': () => Modal.close(),
        '#pr-rev-save-btn': async () => {
          const title = document.getElementById('pr-rev-title').value.trim();
          const desc = document.getElementById('pr-rev-desc').value.trim();
          try {
            await API.proposals.createRevision(e.id, { title, description: desc });
            Toast.success(`리비전 v${nextRev} 생성됨`);
            Modal.close();
            // 부모 모달이 닫혔으니 목록만 reload + 상세 다시 열기는 사용자가 선택
            await _reload();
            // 상세 모달 다시 열기 (사용자 흐름 보존)
            setTimeout(() => _openModal(e.id), 200);
          } catch (err) {
            Toast.error('리비전 생성 실패: ' + (err.message || err));
          }
        },
      },
    });
  }

  return { render, _openModal };
})();

window.ProposalsPage = ProposalsPage;
