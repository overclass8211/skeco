// ============================================================
// CalendarPage — 영업 캘린더 (Google Calendar 스타일)
// ============================================================
const CalendarPage = (() => {
  let calendar = null;
  let currentFilter = '';
  let leads = [];
  // 영업기회 콤보박스 — 고객사 선택에 의해 필터링되는 상태 (Step 1)
  let _leadFilterCustomerId = null;

  const TYPE_COLORS = {
    미팅: '#1a73e8',
    영업방문: '#33b679',
    입찰: '#d93025',
    제안: '#f9ab00',
    내부: '#616161',
    기타: '#9c27b0',
  };
  const EVENT_TYPES = Object.keys(TYPE_COLORS);

  async function fetchLeads() {
    try {
      const res = await API.leads.list();
      leads = res.data || [];
    } catch (_) {
      leads = [];
    }
  }

  async function fetchEvents(fetchInfo, successCallback, failureCallback) {
    try {
      const start = fetchInfo.startStr.slice(0, 10);
      const end = fetchInfo.endStr.slice(0, 10);
      let qs = `start=${start}&end=${end}`;
      if (currentFilter) qs += `&assigned_to=${encodeURIComponent(currentFilter)}`;
      const res = await API.get(`/calendar/events?${qs}`);
      const events = (res.data || []).map(e => {
        const isDone = e.status === 'completed';
        const baseColor = e.color || TYPE_COLORS[e.event_type] || '#1a73e8';
        const icon = isDone ? '✓' : '●';
        const assignee = e.assignee_name ? ` · ${e.assignee_name}` : '';
        // 제목에 아이콘 + 담당자 직접 포함 (custom eventContent 회피로 안정적 렌더링)
        const composedTitle = `${icon} ${e.title}${assignee}`;
        return {
          id: String(e.id),
          title: composedTitle,
          start: e.start_datetime,
          end: e.end_datetime || undefined,
          allDay: !!e.all_day,
          backgroundColor: baseColor,
          borderColor: baseColor,
          textColor: '#fff',
          classNames: isDone ? ['cal-event-completed'] : [],
          extendedProps: e,
        };
      });
      successCallback(events);
    } catch (err) {
      failureCallback(err);
    }
  }

  function toLocalDT(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function toDateStr(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function teamOptions(selectedId) {
    const team = App?.team || [];
    return (
      `<option value="">-- 담당자 선택 --</option>` +
      team
        .map(
          m =>
            `<option value="${m.id}" ${String(m.id) === String(selectedId) ? 'selected' : ''}>${esc(m.name)}</option>`
        )
        .join('')
    );
  }
  function teamFilterOptions() {
    const team = App?.team || [];
    return (
      `<option value="">담당자 전체</option>` +
      team
        .map(
          m =>
            `<option value="${m.id}" ${String(m.id) === String(currentFilter) ? 'selected' : ''}>${esc(m.name)}</option>`
        )
        .join('')
    );
  }
  // 초기 lead_id 가 있을 때 input 에 표시할 텍스트 ("고객사 - 프로젝트")
  function _leadInitialText(leadId) {
    if (!leadId) return '';
    const l = leads.find(x => String(x.id) === String(leadId));
    if (!l) return '';
    return `${l.customer_name || ''}${l.project_name ? ' - ' + l.project_name : ''}`;
  }

  function buildEventForm(d = {}) {
    const colorVal = d.color || TYPE_COLORS[d.event_type] || '#1a73e8';
    const status = d.status || 'planned';
    return `
      <form id="cal-event-form" autocomplete="off" class="form-grid">
        <div class="form-row">
          <label class="form-label required">제목</label>
          <input class="form-input" id="cal-title" value="${esc(d.title || '')}"
                 placeholder="예: 삼성케미칼 견적서 발송" required>
        </div>

        <div class="form-row-3">
          <div class="form-row">
            <label class="form-label">유형</label>
            <select class="form-input" id="cal-event-type">
              ${EVENT_TYPES.map(t => `<option value="${t}" ${d.event_type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">상태</label>
            <select class="form-input" id="cal-status">
              <option value="planned"   ${status === 'planned' ? 'selected' : ''}>○ 계획</option>
              <option value="completed" ${status === 'completed' ? 'selected' : ''}>✓ 완료</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">담당자</label>
            <select class="form-input" id="cal-assigned-to">${teamOptions(d.assigned_to)}</select>
          </div>
        </div>

        <div id="cal-datetime-group">
          <div class="form-row-2" id="cal-datetime-row">
            <div class="form-row">
              <label class="form-label">시작 일시</label>
              <input type="datetime-local" class="form-input" id="cal-start"
                     value="${esc(d.start_datetime ? toLocalDT(d.start_datetime) : d._start || '')}">
            </div>
            <div class="form-row">
              <label class="form-label">종료 일시</label>
              <input type="datetime-local" class="form-input" id="cal-end"
                     value="${esc(d.end_datetime ? toLocalDT(d.end_datetime) : d._end || '')}">
            </div>
          </div>
          <div class="form-row-2" id="cal-date-row" style="display:none">
            <div class="form-row">
              <label class="form-label">시작일</label>
              <input type="date" class="form-input" id="cal-start-date"
                     value="${esc(d.start_datetime ? toDateStr(d.start_datetime) : d._startDate || '')}">
            </div>
            <div class="form-row">
              <label class="form-label">종료일</label>
              <input type="date" class="form-input" id="cal-end-date"
                     value="${esc(d.end_datetime ? toDateStr(d.end_datetime) : d._endDate || '')}">
            </div>
          </div>
        </div>

        <div class="form-row-3">
          <div class="form-row">
            <label class="form-check">
              <input type="checkbox" id="cal-allday" ${d.all_day ? 'checked' : ''}> 종일 일정
            </label>
          </div>
          <div class="form-row">
            <label class="form-label">색상 구분</label>
            <div class="cal-color-indicator" id="cal-color-indicator">
              <span class="cal-color-dot" id="cal-color-dot"></span>
              <span class="cal-color-text" id="cal-color-text"></span>
            </div>
            <input type="hidden" id="cal-color" value="${colorVal}">
          </div>
          <div class="form-row"><!-- spacer --></div>
        </div>

        <div class="form-row-2">
          <div class="form-row">
            <label class="form-label">고객사</label>
            <input class="form-input" id="cal-customer" value="${esc(d.customer_name || '')}" placeholder="고객사명">
          </div>
          <div class="form-row">
            <label class="form-label">영업 기회 연결</label>
            <input class="form-input" id="cal-lead-input"
                   placeholder="고객사/프로젝트 검색 (선택)" autocomplete="off"
                   value="${esc(_leadInitialText(d.lead_id))}">
            <input type="hidden" id="cal-lead-id" value="${esc(d.lead_id || '')}">
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">설명 / 메모</label>
          <textarea class="form-input" id="cal-description" rows="3"
                    placeholder="회의 안건, 준비 사항, 결과 등">${esc(d.description || '')}</textarea>
        </div>
      </form>`;
  }

  function syncColorIndicator() {
    const typeEl = document.getElementById('cal-event-type');
    const statusEl = document.getElementById('cal-status');
    const dotEl = document.getElementById('cal-color-dot');
    const textEl = document.getElementById('cal-color-text');
    const hiddenEl = document.getElementById('cal-color');
    if (!typeEl || !statusEl || !dotEl) return;

    const isCompleted = statusEl.value === 'completed';
    const type = typeEl.value;
    const color = isCompleted ? '#9e9e9e' : TYPE_COLORS[type] || '#1a73e8';

    dotEl.style.background = color;
    textEl.textContent = isCompleted ? `완료 · ${type}` : `계획 · ${type}`;
    textEl.style.color = color;
    if (hiddenEl) hiddenEl.value = color;
  }

  function wireAlldayToggle() {
    const chk = document.getElementById('cal-allday');
    const dtRow = document.getElementById('cal-datetime-row');
    const dRow = document.getElementById('cal-date-row');
    if (!chk) return;
    const toggle = () => {
      dtRow.style.display = chk.checked ? 'none' : '';
      dRow.style.display = chk.checked ? '' : 'none';
    };
    toggle();
    chk.addEventListener('change', toggle);

    // 유형·상태 변경 시 색상 프리뷰 + hidden value 동기화
    const typeEl = document.getElementById('cal-event-type');
    const statusEl = document.getElementById('cal-status');
    if (typeEl) typeEl.addEventListener('change', syncColorIndicator);
    if (statusEl) statusEl.addEventListener('change', syncColorIndicator);
    syncColorIndicator(); // 초기 렌더
  }

  function collectForm() {
    const allDay = document.getElementById('cal-allday').checked;
    const start = allDay
      ? document.getElementById('cal-start-date').value
      : document.getElementById('cal-start').value;
    const end = allDay
      ? document.getElementById('cal-end-date').value || start
      : document.getElementById('cal-end').value;
    return {
      title: document.getElementById('cal-title').value.trim(),
      event_type: document.getElementById('cal-event-type').value,
      status: document.getElementById('cal-status').value,
      start_datetime: start,
      end_datetime: end || null,
      all_day: allDay ? 1 : 0,
      description: document.getElementById('cal-description').value.trim(),
      customer_name: document.getElementById('cal-customer').value.trim(),
      customer_id: document.getElementById('cal-customer-id')?.value || null, // Combobox 자동완성 선택 시
      lead_id: document.getElementById('cal-lead-id').value || null,
      assigned_to: document.getElementById('cal-assigned-to').value || null,
      color: document.getElementById('cal-color').value,
    };
  }

  // ─── 고객사 Combobox + 영업기회 자동 필터 통합 ───────────
  // 사이드이펙 방지:
  //  - 기존 input/select 유지 (Combobox 가 input wrap 만 함)
  //  - Combobox 미사용 시 (모듈 로드 실패) 기존 자유 입력 동작 그대로
  //  - 선택 안 한 경우 customer_name 자유 텍스트로 저장됨
  function _attachCustomerCombobox(selectedCustomerId, initialLeadId) {
    const input = document.getElementById('cal-customer');
    if (!input) {
      console.warn('[calendar] cal-customer input not found');
      return null;
    }
    if (typeof Combobox === 'undefined') {
      console.warn(
        '[calendar] Combobox 컴포넌트 로드 실패 — /js/components/combobox.js 가 캐시되지 않았을 수 있음. Ctrl+Shift+R 강제 새로고침 필요.'
      );
      return null;
    }

    // hidden field — customer_id 보관 (기존 데이터 호환 위해 옵션)
    let hiddenIdInput = document.getElementById('cal-customer-id');
    if (!hiddenIdInput) {
      hiddenIdInput = document.createElement('input');
      hiddenIdInput.type = 'hidden';
      hiddenIdInput.id = 'cal-customer-id';
      input.parentNode.appendChild(hiddenIdInput);
    }
    if (selectedCustomerId) hiddenIdInput.value = selectedCustomerId;

    // 영업기회 콤보박스를 고객사로 필터링하는 헬퍼
    // (select → input + Combobox 로 바뀜 — _leadFilterCustomerId 만 업데이트)
    const refreshLeadOptions = customerId => {
      _leadFilterCustomerId = customerId || null;
      const leadInput = document.getElementById('cal-lead-input');
      const leadHidden = document.getElementById('cal-lead-id');
      if (!leadInput || !leadHidden) return;
      // 현재 선택된 lead 가 새 customer 와 다르면 자동 해제
      if (leadHidden.value && customerId) {
        const currentLead = leads.find(l => String(l.id) === String(leadHidden.value));
        if (currentLead && String(currentLead.customer_id) !== String(customerId)) {
          leadInput.value = '';
          leadHidden.value = '';
          leadInput.dispatchEvent(new Event('change'));
        }
      }
    };

    // 초기 lead_id 가 있으면 그것의 customer_id 로 필터링
    if (initialLeadId && !selectedCustomerId) {
      const initLead = leads.find(l => String(l.id) === String(initialLeadId));
      if (initLead?.customer_id) {
        hiddenIdInput.value = initLead.customer_id;
        refreshLeadOptions(initLead.customer_id);
      }
    } else if (selectedCustomerId) {
      refreshLeadOptions(selectedCustomerId);
    } else {
      // 신규 모달: 필터 초기화
      _leadFilterCustomerId = null;
    }

    return Combobox.attach({
      inputEl: input,
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
        if (item.active_deals_count > 0)
          meta.push(
            `<span style="color:var(--oci-red);font-weight:600">진행 ${item.active_deals_count}건</span>`
          );
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
        hiddenIdInput.value = item.id;
        refreshLeadOptions(item.id);
      },
      onCustomCreate: query => {
        // 자유 입력 유지 — 신규 등록은 별도 (가벼운 일정이라 강제 안 함)
        // 사용자가 입력한 텍스트 그대로 저장 (customer_id NULL)
        input.value = query;
        hiddenIdInput.value = '';
        refreshLeadOptions(null);
        Toast.warn?.(`"${query}" — 신규 고객사로 입력됨 (등록은 고객사 메뉴에서)`);
      },
      minChars: 2,
      debounceMs: 250,
      allowCustom: true,
      customLabel: '+ "X" 로 자유 입력 (신규 고객사)',
    });
  }

  // ─── 영업기회 Combobox (Step 1) ────────────────────────
  // <select> 대신 input + hidden id + Combobox 로 교체
  // 사이드이펙 방지:
  //  - hidden #cal-lead-id 의 .value 인터페이스 유지 (collectForm 등 호환)
  //  - Combobox 미로드 시 일반 input 으로 동작 (lead_id 는 빈값 유지)
  //  - leads 메모리 데이터를 클라이언트 사이드 필터 (백엔드 변경 없음)
  function _attachLeadCombobox() {
    const input = document.getElementById('cal-lead-input');
    const hiddenId = document.getElementById('cal-lead-id');
    if (!input || !hiddenId) return null;
    if (typeof Combobox === 'undefined') {
      console.warn('[calendar] Combobox 로드 실패 — 영업기회 자동완성 비활성');
      return null;
    }

    // 사용자가 input 을 직접 비우면 hidden id 도 초기화 (선택 해제 효과)
    input.addEventListener('input', () => {
      if (!input.value.trim()) {
        hiddenId.value = '';
        // 활동이력 동기화 UI 토글을 위해 change 트리거
        input.dispatchEvent(new Event('change'));
      }
    });

    return Combobox.attach({
      inputEl: input,
      fetchFn: q => {
        const ql = (q || '').toLowerCase();
        const filtered = _leadFilterCustomerId
          ? leads.filter(l => String(l.customer_id) === String(_leadFilterCustomerId))
          : leads;
        return filtered
          .filter(
            l =>
              (l.customer_name || '').toLowerCase().includes(ql) ||
              (l.project_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 10);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.customer_name || '', q)}${item.project_name ? ' - ' + highlightMatch(item.project_name, q) : ''}`;
        const meta = [];
        if (item.stage) meta.push(esc(item.stage));
        if (item.amount) meta.push('₩' + Number(item.amount).toLocaleString());
        return `
          <div class="combobox-item-content">
            <div class="combobox-item-title">💼 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>
        `;
      },
      onSelect: item => {
        input.value = `${item.customer_name || ''}${item.project_name ? ' - ' + item.project_name : ''}`;
        hiddenId.value = item.id;
        // 활동이력 토글을 위해 change 이벤트 발생
        input.dispatchEvent(new Event('change'));
      },
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
  }

  // ─── 제목 Combobox (Step 2) ────────────────────────────
  // 두 가지 추천:
  //  1) 📝 과거 이벤트 제목 (use_count + 최근 사용)
  //  2) 🏢 고객사 + 동사 템플릿 (매칭된 첫 번째 고객사의 5개 동사)
  // 선택 시 customer_name/customer_id/lead_id 도 함께 자동 채움 (Step 3 미리)
  function _attachTitleCombobox() {
    const input = document.getElementById('cal-title');
    if (!input || typeof Combobox === 'undefined') return null;

    // 다른 필드 helper — Step 3 에서 본격 확장
    const fillCustomer = (customerId, customerName) => {
      const cInput = document.getElementById('cal-customer');
      const cHidden = document.getElementById('cal-customer-id');
      if (cInput && customerName) cInput.value = customerName;
      if (cHidden) cHidden.value = customerId || '';
      _leadFilterCustomerId = customerId || null;
    };
    const fillLead = leadId => {
      const leadInput = document.getElementById('cal-lead-input');
      const leadHidden = document.getElementById('cal-lead-id');
      if (!leadInput || !leadHidden || !leadId) return;
      const l = leads.find(x => String(x.id) === String(leadId));
      if (!l) return;
      leadInput.value = `${l.customer_name || ''}${l.project_name ? ' - ' + l.project_name : ''}`;
      leadHidden.value = l.id;
      leadInput.dispatchEvent(new Event('change'));
    };

    return Combobox.attach({
      inputEl: input,
      fetchFn: async q => {
        try {
          const r = await API.calendar.titleSuggestions(q, 8);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        if (item.type === 'history') {
          const dateStr = item.last_used_at
            ? new Date(item.last_used_at).toLocaleDateString('ko-KR', {
                month: 'numeric',
                day: 'numeric',
              })
            : '';
          const useBadge = item.use_count > 1 ? `${item.use_count}회` : '';
          const metaParts = [];
          if (item.customer_name) metaParts.push(`🏢 ${esc(item.customer_name)}`);
          if (useBadge) metaParts.push(useBadge);
          if (dateStr) metaParts.push(dateStr);
          return `
            <div class="combobox-item-content">
              <div class="combobox-item-title">📝 ${highlightMatch(item.title, q)}</div>
              ${metaParts.length ? `<div class="combobox-item-meta">${metaParts.join(' · ')}</div>` : ''}
            </div>
          `;
        }
        // type === 'template'
        const dealMeta =
          item.active_deals_count > 0
            ? `<span style="color:var(--oci-red);font-weight:600">진행 ${item.active_deals_count}건</span>`
            : '';
        return `
          <div class="combobox-item-content">
            <div class="combobox-item-title">🏢 ${highlightMatch(item.customer_name || '', q)} <span style="color:var(--text-3);font-weight:400">+ ${esc(item.verb)}</span></div>
            <div class="combobox-item-meta">→ "${esc(item.generated_title)}" 자동 입력 ${dealMeta ? '· ' + dealMeta : ''}</div>
          </div>
        `;
      },
      onSelect: item => {
        if (item.type === 'history') {
          input.value = item.title;
          // 고객사 자동 채움 (customer_name 기반)
          // customer_id 는 calendar_events 에 없으므로 leads 메모리에서 lead_id 로 lookup
          if (item.lead_id) {
            const l = leads.find(x => String(x.id) === String(item.lead_id));
            if (l) fillCustomer(l.customer_id, l.customer_name || item.customer_name);
            fillLead(item.lead_id);
          } else if (item.customer_name) {
            // lead 없는 경우 customer_name 만
            fillCustomer(null, item.customer_name);
          }
        } else if (item.type === 'template') {
          input.value = item.generated_title;
          fillCustomer(item.customer_id, item.customer_name);
          // 영업기회는 자동 필터링만 — 사용자가 명시적으로 선택해야 함
        }
      },
      minChars: 2,
      debounceMs: 250,
      allowCustom: true,
      customLabel: '+ "X" 그대로 사용',
    });
  }

  function openCreateModal(defaults = {}) {
    Modal.open({
      title: '새 일정 등록',
      width: 600,
      body:
        buildEventForm(defaults) +
        `
        <div class="form-row" id="cal-act-sync-row" style="align-items:center;gap:8px;margin-top:4px;display:none">
          <label class="form-label" style="margin:0">활동 이력 자동 등록</label>
          <input type="checkbox" id="cal-act-sync-cb" checked style="width:16px;height:16px;cursor:pointer">
          <span style="font-size:11px;color:var(--text-3)">캘린더 저장 시 영업 활동에도 동시 기록</span>
        </div>`,
      footer: `<button class="btn btn-ghost" id="cal-create-cancel-btn">취소</button>
               <button class="btn btn-primary" id="cal-save-btn">저장</button>`,
      bind: { '#cal-create-cancel-btn': () => Modal.close() },
    });
    wireAlldayToggle();

    // 고객사 자동완성 + 영업기회 자동 필터링 활성화
    _attachCustomerCombobox(defaults.customer_id || null, defaults.lead_id || null);
    // 영업기회 콤보박스 활성화
    _attachLeadCombobox();
    // 제목 자동완성 (Step 2) — 과거 이벤트 + 고객사+동사 템플릿
    _attachTitleCombobox();

    // lead 선택 시 활동 이력 동기화 옵션 표시
    const leadInput = document.getElementById('cal-lead-input');
    const leadHidden = document.getElementById('cal-lead-id');
    const actSyncRow = document.getElementById('cal-act-sync-row');
    if (leadInput && leadHidden && actSyncRow) {
      const toggleActSync = () => {
        actSyncRow.style.display = leadHidden.value ? '' : 'none';
      };
      toggleActSync();
      // input change 이벤트는 onSelect/사용자 직접 비움 시 발생 (위 _attachLeadCombobox 에서 dispatch)
      leadInput.addEventListener('change', toggleActSync);
    }

    document.getElementById('cal-save-btn').addEventListener('click', async () => {
      const data = collectForm();
      if (!data.title) {
        Toast.error('제목을 입력하세요');
        return;
      }
      if (!data.start_datetime) {
        Toast.error('시작 일시를 입력하세요');
        return;
      }
      try {
        // ① 캘린더 이벤트 생성
        const calResult = await API.post('/calendar/events', data);
        const calId = calResult.id;

        // ② 활동 이력 자동 등록 (lead 연결 + 체크박스 활성 시)
        const syncAct = document.getElementById('cal-act-sync-cb')?.checked;
        if (syncAct && data.lead_id && calId && data.start_datetime) {
          const evtToAct = {
            미팅: 'meeting',
            영업방문: 'site_visit',
            제안: 'proposal',
            입찰: 'bidding',
            내부: 'note',
            기타: 'note',
          };
          try {
            await API.activities.create({
              lead_id: data.lead_id,
              activity_type: evtToAct[data.event_type] || '기타',
              title: data.title,
              content: data.description || null,
              performed_by: data.assigned_to || null,
              activity_date: data.start_datetime,
              calendar_event_id: calId,
            });
          } catch (actErr) {
            console.warn('활동 이력 자동 등록 실패:', actErr);
          }
        }

        Toast.success(
          syncAct && data.lead_id ? '일정 등록 + 활동 이력 기록 완료' : '일정이 등록되었습니다'
        );
        Modal.close();
        calendar?.refetchEvents();
      } catch (_) {
        /* API error handled by Toast elsewhere */
      }
    });
  }

  function openEditModal(eventData) {
    Modal.open({
      title: '일정 수정',
      width: 600,
      body: buildEventForm(eventData),
      footer: `<button class="btn btn-ghost" id="cal-edit-cancel-btn">취소</button>
               <button class="btn btn-primary" id="cal-update-btn">저장</button>`,
      bind: { '#cal-edit-cancel-btn': () => Modal.close() },
    });
    wireAlldayToggle();
    // 고객사 자동완성 + 영업기회 자동 필터링 (수정 모달도 동일)
    _attachCustomerCombobox(eventData.customer_id || null, eventData.lead_id || null);
    _attachLeadCombobox();
    // 제목 자동완성 (Step 2)
    _attachTitleCombobox();
    document.getElementById('cal-update-btn').addEventListener('click', async () => {
      const data = collectForm();
      if (!data.title) {
        Toast.error('제목을 입력하세요');
        return;
      }
      try {
        await API.put(`/calendar/events/${eventData.id}`, data);
        Toast.success('일정이 수정되었습니다');
        Modal.close();
        calendar?.refetchEvents();
      } catch (_) {
        /* API error handled by Toast elsewhere */
      }
    });
  }

  function openDetailModal(ep) {
    const dotStyle = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(ep.color || TYPE_COLORS[ep.event_type] || '#ccc')};margin-right:8px;vertical-align:middle`;
    const startStr = ep.all_day
      ? Fmt.date(ep.start_datetime)
      : toLocalDT(ep.start_datetime).replace('T', ' ');
    const endStr = ep.end_datetime
      ? ep.all_day
        ? Fmt.date(ep.end_datetime)
        : toLocalDT(ep.end_datetime).replace('T', ' ')
      : '-';
    const isDone = ep.status === 'completed';
    const statusBadge = isDone
      ? `<span class="status-badge completed">✓ 완료</span>`
      : `<span class="status-badge planned">○ 계획</span>`;
    const descBlock = ep.description
      ? (() => {
          const meetingMatch = ep.description.match(/\[회의록 상세보기\]\s*meeting:(\d+)/);
          const cleanDesc = ep.description
            .replace(/\n?\[회의록 상세보기\]\s*meeting:\d+/, '')
            .trim();
          const meetingLink = meetingMatch
            ? `<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="cal-meeting-detail-btn" style="color:#1a73e8;border-color:#1a73e8" data-meeting-id="${meetingMatch[1]}">📋 회의록 상세보기</button></div>`
            : '';
          return `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:8px">설명 / 메모</div>
          <div style="font-size:13px;line-height:1.75;color:var(--text-1);white-space:pre-wrap;
                      background:var(--bg-2);padding:12px 14px;border-radius:8px;
                      max-height:320px;overflow-y:auto;word-break:break-word">${esc(cleanDesc)}</div>
          ${meetingLink}
        </div>`;
        })()
      : '';

    // ── 연결된 활동 이력 블록 (양방향성) ─────────────────────
    const ACTIVITY_ICON_MAP = {
      meeting: '🤝',
      call: '📞',
      email: '✉',
      site_visit: '🏗',
      proposal: '📄',
      bidding: '📋',
      contract: '✍',
      note: '📝',
    };
    const linkedActivityBlock = ep.linked_activity_id
      ? (() => {
          const icon = ACTIVITY_ICON_MAP[ep.linked_activity_type] || '●';
          const label = ep.linked_activity_title || ep.linked_activity_type || '활동';
          const performer = ep.linked_activity_performer
            ? ` · ${esc(ep.linked_activity_performer)}`
            : '';
          const leadClickAttr = ep.lead_id
            ? `id="cal-go-lead-btn" data-lead-id="${ep.lead_id}" style="cursor:pointer"`
            : '';
          return `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:8px">🔗 연결된 활동 이력</div>
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                      background:var(--bg-2);border-radius:8px"
               ${leadClickAttr}>
            <span style="font-size:18px">${icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;color:var(--text-1)">${esc(label)}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px">${esc(ep.linked_activity_type || '')}${performer}</div>
            </div>
            ${ep.lead_id ? `<span style="font-size:11px;color:#1a73e8;white-space:nowrap">리드 상세 →</span>` : ''}
          </div>
        </div>`;
        })()
      : '';

    Modal.open({
      title: `<span style="${dotStyle}"></span>${esc(ep.title)}`,
      width: 560,
      body: `
        <div class="kv-grid">
          <div class="kv-row"><span class="kv-key">상태</span><span class="kv-val">${statusBadge}</span></div>
          <div class="kv-row"><span class="kv-key">유형</span><span class="kv-val">${esc(ep.event_type || '-')}</span></div>
          <div class="kv-row"><span class="kv-key">시작</span><span class="kv-val">${esc(startStr)}</span></div>
          <div class="kv-row"><span class="kv-key">종료</span><span class="kv-val">${esc(endStr)}</span></div>
          <div class="kv-row"><span class="kv-key">고객사</span><span class="kv-val">${esc(ep.customer_name || '-')}</span></div>
          <div class="kv-row"><span class="kv-key">담당자</span><span class="kv-val">${esc(ep.assignee_name || '-')}</span></div>
        </div>
        ${descBlock}
        ${linkedActivityBlock}`,
      footer: `
        <button class="btn btn-ghost text-danger" id="cal-del-btn">삭제</button>
        <button class="btn btn-ghost" id="cal-detail-close-btn">닫기</button>
        <button class="btn btn-primary" id="cal-edit-btn">수정</button>`,
      bind: { '#cal-detail-close-btn': () => Modal.close() },
    });
    document.getElementById('cal-edit-btn').addEventListener('click', () => {
      Modal.close();
      setTimeout(() => openEditModal(ep), 80);
    });
    document.getElementById('cal-del-btn').addEventListener('click', () => {
      Modal.confirm(`"${ep.title}" 일정을 삭제하시겠습니까?`, async () => {
        await API.del(`/calendar/events/${ep.id}`);
        Toast.success('일정이 삭제되었습니다');
        Modal.close();
        calendar?.refetchEvents();
      });
    });
    // meeting detail link inside modal body
    document.getElementById('cal-meeting-detail-btn')?.addEventListener('click', () => {
      const mid = document.getElementById('cal-meeting-detail-btn').dataset.meetingId;
      Modal.close();
      App.navigate('meeting-list');
      setTimeout(() => MeetingListPage.showDetail(parseInt(mid)), 400);
    });
    // go-to-lead link inside modal body
    document.getElementById('cal-go-lead-btn')?.addEventListener('click', () => {
      const lid = document.getElementById('cal-go-lead-btn').dataset.leadId;
      Modal.close();
      App.openLeadDetail(parseInt(lid));
    });
  }

  // 데이터 부족 시 자동 시드
  async function ensureSeedData() {
    try {
      const r = await API.get('/calendar/events?start=2026-01-01&end=2026-04-30');
      const count = (r.data || []).length;
      if (count < 100) {
        Toast.info('영업 활동 데이터를 생성하는 중입니다...');
        const seedRes = await API.post('/calendar/seed-massive', {});
        if (seedRes.success) {
          Toast.success(`${seedRes.seeded}개 영업활동이 생성되었습니다`);
        }
      }
    } catch (err) {
      console.error('Seed error:', err);
    }
  }

  async function render() {
    const container = document.getElementById('content');
    container.innerHTML = `
      <div class="cal-page">
        <div class="cal-toolbar">
          <button class="cal-today-btn" id="cal-today">오늘</button>
          <div class="cal-nav-group">
            <button class="cal-arrow-btn" id="cal-prev" title="이전">‹</button>
            <button class="cal-arrow-btn" id="cal-next" title="다음">›</button>
          </div>
          <span id="cal-title-label" class="cal-title"></span>

          <select class="cal-team-filter" id="cal-team-filter">
            ${teamFilterOptions()}
          </select>

          <div class="cal-view-group">
            <button class="cal-view-btn active" data-cal-view="dayGridMonth">월</button>
            <button class="cal-view-btn" data-cal-view="timeGridWeek">주</button>
            <button class="cal-view-btn" data-cal-view="timeGridDay">일</button>
            <button class="cal-view-btn" data-cal-view="listWeek">목록</button>
          </div>

          <button class="cal-add-btn" id="cal-add-btn">+ 일정 만들기</button>
          <button class="btn btn-ghost btn-sm" id="cal-autolink-btn" title="리드가 연결된 과거 활동 이력을 캘린더 일정과 자동 매칭합니다"
                  style="font-size:12px;white-space:nowrap">🔗 과거 활동 연결</button>
        </div>
        <div class="cal-wrap">
          <div id="cal-calendar"></div>
        </div>
      </div>`;

    await fetchLeads();
    await ensureSeedData();

    if (typeof FullCalendar === 'undefined') {
      document.getElementById('cal-calendar').innerHTML =
        '<div style="padding:40px;text-align:center;color:#d93025">FullCalendar 라이브러리 로드 실패. 페이지를 새로고침하세요.</div>';
      return;
    }

    calendar = new FullCalendar.Calendar(document.getElementById('cal-calendar'), {
      locale: 'ko',
      initialView: 'dayGridMonth',
      initialDate: new Date().toISOString().slice(0, 10), // 오늘 날짜 기준 현월 표시
      headerToolbar: false,
      height: '100%',
      events: fetchEvents,
      eventDisplay: 'block', // 점(dot) 대신 색깔 막대로 강제 렌더링 (월간뷰 핵심)
      displayEventTime: true,
      eventTextColor: '#fff',
      editable: true,
      selectable: true,
      dayMaxEvents: 3,
      moreLinkText: n => `+${n}건 더보기`,
      // 한국 로케일이 "1일", "2일"로 표시하는 것을 숫자만으로 변경
      dayCellContent(arg) {
        return { html: `<span class="cal-day-num">${arg.date.getDate()}</span>` };
      },
      nowIndicator: true,
      firstDay: 0, // 일요일 시작 (Google Calendar 기본)
      dayHeaderFormat: { weekday: 'short' },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventClick(info) {
        openDetailModal(info.event.extendedProps);
      },
      dateClick(info) {
        if (info.allDay) {
          openCreateModal({ _startDate: info.dateStr, _endDate: info.dateStr, all_day: true });
        } else {
          const end = new Date(new Date(info.dateStr).getTime() + 3600000);
          openCreateModal({ _start: toLocalDT(info.dateStr), _end: toLocalDT(end.toISOString()) });
        }
      },
      eventDrop(info) {
        const e = info.event;
        API.put(`/calendar/events/${e.extendedProps.id}`, {
          ...e.extendedProps,
          start_datetime: e.startStr.slice(0, 19).replace('T', ' '),
          end_datetime: (e.endStr || e.startStr).slice(0, 19).replace('T', ' '),
          all_day: e.allDay ? 1 : 0,
        }).catch(() => info.revert());
      },
      eventResize(info) {
        const e = info.event;
        API.put(`/calendar/events/${e.extendedProps.id}`, {
          ...e.extendedProps,
          start_datetime: e.startStr.slice(0, 19).replace('T', ' '),
          end_datetime: (e.endStr || e.startStr).slice(0, 19).replace('T', ' '),
          all_day: e.allDay ? 1 : 0,
        }).catch(() => info.revert());
      },
      datesSet() {
        const el = document.getElementById('cal-title-label');
        if (el && calendar) el.textContent = calendar.view.title;
      },
    });

    calendar.render();

    const titleEl = document.getElementById('cal-title-label');
    if (titleEl) titleEl.textContent = calendar.view.title;

    document.querySelectorAll('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        calendar.changeView(btn.dataset.calView);
        document
          .querySelectorAll('[data-cal-view]')
          .forEach(b => b.classList.toggle('active', b === btn));
        if (titleEl) titleEl.textContent = calendar.view.title;
      });
    });

    document.getElementById('cal-prev').addEventListener('click', () => {
      calendar.prev();
    });
    document.getElementById('cal-today').addEventListener('click', () => {
      calendar.today();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      calendar.next();
    });

    document.getElementById('cal-team-filter').addEventListener('change', e => {
      currentFilter = e.target.value;
      calendar.refetchEvents();
    });
    document.getElementById('cal-add-btn').addEventListener('click', () => openCreateModal({}));

    // 과거 활동 자동 연결
    document.getElementById('cal-autolink-btn').addEventListener('click', async () => {
      const btn = document.getElementById('cal-autolink-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '연결 중...';
      }
      try {
        const result = await API.post('/activities/auto-link', {});
        Toast.success(
          `자동 연결 완료 — 기존이벤트 연결 ${result.matched}건 / 신규생성 ${result.created}건 / 건너뜀 ${result.skipped}건 (전체 ${result.total}건)`
        );
        calendar?.refetchEvents();
      } catch {
        Toast.error('자동 연결 중 오류가 발생했습니다');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔗 과거 활동 연결';
        }
      }
    });

    // 윈도우 리사이즈 시 캘린더 재계산
    setTimeout(() => calendar.updateSize(), 100);
  }

  // 활동이력에서 호출: 특정 이벤트 날짜로 이동 후 이벤트 상세 팝업
  function openEventById(eventId, dateStr) {
    if (!calendar) return;
    // 날짜로 이동
    if (dateStr) {
      try {
        calendar.gotoDate(dateStr);
      } catch (_) {}
    }
    // FullCalendar에서 해당 이벤트 찾아 클릭 처리
    setTimeout(() => {
      const fcEvent = calendar.getEventById(String(eventId));
      if (fcEvent) {
        // extendedProps로 상세 모달 오픈 (detail view)
        openDetailModal(fcEvent.extendedProps);
      } else {
        // 이벤트가 현재 뷰에 없으면 API에서 직접 조회
        API.get(`/calendar/events/${eventId}`)
          .then(r => {
            if (r.success && r.data) openDetailModal(r.data);
          })
          .catch(() => Toast.info('캘린더로 이동했습니다'));
      }
    }, 300);
  }

  return { render, openEventById };
})();
