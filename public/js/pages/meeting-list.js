// ============================================================
// MeetingListPage — AI 추출 회의록 목록 / 상세
// ============================================================
const MeetingListPage = {
  data: [],
  selectedId: null,
  _leads: [],
  _pendingId: null,

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar" style="margin-bottom:14px">
        <div class="card-title" style="margin-right:auto">📋 AI 회의록 목록</div>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="search-input" id="ml-search" placeholder="제목 / 고객사 검색..."
                 style="margin:0">
          <button class="btn btn-secondary btn-sm" id="ml-export-btn"
                  style="white-space:nowrap" title="내보내기 (Excel / CSV / JSON)">⤓ 내보내기</button>
          <button class="btn btn-primary" id="ml-new-btn"
                  style="white-space:nowrap">+ 새 회의록</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.2fr 2fr;gap:14px">
        <div class="card">
          <div class="card-body no-pad" id="ml-list" style="max-height:calc(100vh - 200px);overflow-y:auto">
            <div class="loading">로딩...</div>
          </div>
        </div>
        <div class="card">
          <div class="card-body" id="ml-detail" style="min-height:400px">
            <div class="empty">왼쪽 목록에서 회의록을 선택하세요</div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('ml-search')?.addEventListener('input', () => this.applyFilter());
    document.getElementById('ml-new-btn')?.addEventListener('click', () => App.navigate('meeting'));
    document.getElementById('ml-export-btn')?.addEventListener('click', e => {
      const search = document.getElementById('ml-search')?.value?.trim();
      const path = '/meetings/export' + (search ? '?search=' + encodeURIComponent(search) : '');
      const name = '회의록_' + new Date().toISOString().slice(0, 10);
      if (typeof ExportMenu !== 'undefined') ExportMenu.open(e.currentTarget, path, name);
      else API.downloadExport(path, name, 'xlsx');
    });
    await this.loadList();
  },

  async loadList() {
    try {
      const r = await API.meetings.list();
      this.data = r.data || [];
      this.renderList(this.data);
      // 알림에서 특정 회의록으로 직접 이동한 경우
      if (this._pendingId) {
        const pid = this._pendingId;
        this._pendingId = null;
        this.showDetail(pid);
      }
    } catch (err) {
      document.getElementById('ml-list').innerHTML =
        `<div class="empty" style="color:var(--oci-red)">${esc(err.message)}</div>`;
    }
  },

  applyFilter() {
    const q = (document.getElementById('ml-search')?.value || '').toLowerCase();
    const filtered = this.data.filter(
      m =>
        !q ||
        (m.title || '').toLowerCase().includes(q) ||
        (m.customer_name || '').toLowerCase().includes(q)
    );
    this.renderList(filtered);
  },

  renderList(items) {
    const el = document.getElementById('ml-list');
    if (!items.length) {
      const hasFilter = !!document.getElementById('ml-search')?.value?.trim();
      const presetKey = hasFilter ? 'filter' : 'meetings';
      el.innerHTML =
        typeof EmptyState !== 'undefined'
          ? EmptyState.preset(presetKey)
          : '<div class="empty">저장된 회의록이 없습니다</div>';
      if (!hasFilter) {
        document
          .getElementById('empty-meetings-new')
          ?.addEventListener('click', () => App.navigate('meeting'));
      }
      return;
    }
    el.innerHTML = items
      .map(
        m => `
      <div class="ml-item ${this.selectedId === m.id ? 'active' : ''}"
           data-meet-id="${m.id}" style="cursor:pointer">
        <div class="ml-item-title">${esc(m.title)}</div>
        <div class="ml-item-meta">
          ${m.customer_name ? `<span class="badge badge-blue" style="margin-right:6px">${esc(m.customer_name)}</span>` : ''}
          ${m.calendar_event_id ? '<span class="badge badge-green">📅 캘린더 등록됨</span>' : ''}
        </div>
        <div class="ml-item-preview">${esc((m.summary_preview || '').replace(/[#*]/g, '').slice(0, 100))}...</div>
        <div class="ml-item-date">
          ${esc(Fmt.date(m.meeting_date))} · 작성: ${esc(m.created_by_name || '시스템')} · ${esc(Fmt.relTime(m.created_at))}
        </div>
      </div>
    `
      )
      .join('');
    el.addEventListener('click', e => {
      const item = e.target.closest('[data-meet-id]');
      if (item) this.showDetail(parseInt(item.dataset.meetId));
    });
  },

  async showDetail(id) {
    this.selectedId = id;
    this.renderList(this.data); // active 표시 갱신
    const detail = document.getElementById('ml-detail');
    detail.innerHTML = '<div class="loading">로딩...</div>';

    try {
      const r = await API.meetings.get(id);
      const m = r.data;

      detail.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:17px;font-weight:600;color:var(--text-1);margin-bottom:6px">${esc(m.title)}</div>
            <div style="font-size:12px;color:var(--text-3)">
              ${esc(Fmt.date(m.meeting_date))}
              ${m.customer_name ? ` · ${esc(m.customer_name)}` : ''}
              ${m.created_by_name ? ` · 작성자: ${esc(m.created_by_name)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            ${
              m.calendar_event_id
                ? '<span class="badge badge-green">📅 캘린더 등록됨</span>'
                : `<button class="btn btn-ghost btn-sm" id="ml-reg-cal-btn">📅 캘린더 등록</button>`
            }
            <button class="btn btn-ghost btn-sm text-danger" id="ml-delete-meeting-btn">삭제</button>
          </div>
        </div>

        <div class="markdown-body" style="line-height:1.7;font-size:13px;margin-bottom:18px">
          ${AI.renderMarkdown(m.summary_md || '*요약 내용이 없습니다*')}
        </div>

        <details style="margin-top:18px">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0">
            🗣 화자 분리 원본 보기
          </summary>
          <div id="ml-speakers" style="margin-top:10px"></div>
        </details>

        <details style="margin-top:8px">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0">
            📜 전체 텍스트 보기
          </summary>
          <pre style="white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:6px;
                      font-size:12px;line-height:1.6;margin-top:10px;color:var(--text-2);
                      max-height:400px;overflow-y:auto">${esc(m.raw_transcript || '(전사 텍스트 없음)')}</pre>
        </details>
      `;

      // 버튼 이벤트 바인딩
      document
        .getElementById('ml-reg-cal-btn')
        ?.addEventListener('click', () => this.registerCalendar(m.id));
      document
        .getElementById('ml-delete-meeting-btn')
        ?.addEventListener('click', () => this.deleteMeeting(m.id));

      // 화자 렌더링
      try {
        const speakers = m.speakers_json ? JSON.parse(m.speakers_json) : [];
        const colors = ['#1664E5', '#00A86B', '#F59C00', '#7C4DFF', '#E63329', '#0EA5E9'];
        const sEl = document.getElementById('ml-speakers');
        if (speakers.length) {
          sEl.innerHTML = speakers
            .map(s => {
              const c = colors[(s.speaker - 1) % colors.length];
              return `
              <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${c};color:#fff;
                            display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px">${s.speaker}</div>
                <div style="flex:1;font-size:12px;line-height:1.6">${esc(s.text)}</div>
              </div>`;
            })
            .join('');
        } else sEl.innerHTML = '<div class="empty">화자 분리 데이터 없음</div>';
      } catch (_) {
        /* speaker data parse failed, section stays empty */
      }
    } catch (err) {
      detail.innerHTML = `<div class="empty" style="color:var(--oci-red)">${esc(err.message)}</div>`;
    }
  },

  async registerCalendar(id) {
    try {
      const r = await API.leads.list();
      this._leads = r.data || [];
    } catch (_) {
      this._leads = [];
    }

    const cached = this.data.find(m => m.id === id);
    const pre = (cached?.customer_name || '').trim();

    const crmNames = (App.customers || []).map(c => c.name || c.company_name || '').filter(Boolean);
    const leadNames = this._leads.map(l => l.customer_name || '').filter(Boolean);
    const allCustomers = [...new Set([...crmNames, ...leadNames])].sort((a, b) =>
      a.localeCompare(b)
    );
    const preInList = allCustomers.includes(pre);

    const customerOpts = allCustomers
      .map(c => `<option value="${esc(c)}" ${c === pre ? 'selected' : ''}>${esc(c)}</option>`)
      .join('');

    const initMatched = pre
      ? this._leads.filter(l => (l.customer_name || '').toLowerCase() === pre.toLowerCase())
      : this._leads;
    const dealOpts = this._buildDealOptions(initMatched);

    Modal.open({
      title: '📅 캘린더 등록',
      width: 520,
      body: `
        <div style="font-size:13px;color:var(--text-2);margin-bottom:16px;line-height:1.6">
          미팅 일정과 액션 아이템이 선택한 고객사/딜에 연결되어 캘린더에 자동 등록됩니다.
        </div>
        <div class="form-row" style="margin-bottom:12px">
          <label class="form-label">고객사 선택 <span style="color:var(--oci-red)">*</span></label>
          <select class="form-input" id="ml-reg-customer-select">
            <option value="">-- 고객사 선택 --</option>
            ${customerOpts}
            <option value="__direct__">✏️ 직접 입력</option>
          </select>
          <input class="form-input" id="ml-reg-customer-direct"
                 placeholder="고객사명 직접 입력"
                 style="margin-top:6px;display:${preInList || !pre ? 'none' : ''}"
                 value="${!preInList && pre ? esc(pre) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">영업 기회 (딜) <span style="font-weight:400;color:var(--text-3)">— 선택</span></label>
          <select class="form-input" id="ml-reg-lead">${dealOpts}</select>
          <div id="ml-reg-deal-hint" style="font-size:11px;color:var(--text-3);margin-top:4px"></div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" id="ml-cal-cancel-btn">취소</button>
        <button class="btn btn-primary" id="ml-cal-register-btn">캘린더에 등록</button>`,
      bind: {
        '#ml-cal-cancel-btn': () => Modal.close(),
        '#ml-cal-register-btn': () => this._doRegisterCalendar(id),
      },
    });

    // bind modal body inputs after modal renders
    setTimeout(() => {
      document
        .getElementById('ml-reg-customer-select')
        ?.addEventListener('change', e => this._onCustomerChange(e.target.value));
      document
        .getElementById('ml-reg-customer-direct')
        ?.addEventListener('input', e => this._onCustomerDirectInput(e.target.value));
      if (pre) this._applyDealHint(initMatched);
    }, 0);
  },

  _buildDealOptions(matchedLeads) {
    return (
      `<option value="">-- 없음 --</option>` +
      matchedLeads
        .map(
          l =>
            `<option value="${l.id}">${esc(l.customer_name || '')}${l.project_name ? ' · ' + esc(l.project_name) : ''}${l.stage ? ' [' + esc(l.stage) + ']' : ''}</option>`
        )
        .join('')
    );
  },

  _applyDealHint(matched) {
    const dealEl = document.getElementById('ml-reg-lead');
    const hintEl = document.getElementById('ml-reg-deal-hint');
    if (!dealEl) return;
    if (matched.length === 1) {
      dealEl.value = String(matched[0].id);
      if (hintEl) hintEl.textContent = '✅ 딜이 자동으로 선택되었습니다';
    } else if (matched.length > 1) {
      if (hintEl) hintEl.textContent = `${matched.length}개 딜이 있습니다. 선택해주세요.`;
    } else {
      if (hintEl) hintEl.textContent = '등록된 딜이 없습니다 (없음으로 진행됩니다)';
    }
  },

  _onCustomerChange(value) {
    const directEl = document.getElementById('ml-reg-customer-direct');
    const dealEl = document.getElementById('ml-reg-lead');
    const hintEl = document.getElementById('ml-reg-deal-hint');
    if (!dealEl) return;

    if (value === '__direct__') {
      if (directEl) {
        directEl.style.display = '';
        directEl.focus();
      }
      dealEl.innerHTML = this._buildDealOptions(this._leads);
      if (hintEl) hintEl.textContent = '고객사명을 입력하면 딜이 자동 필터링됩니다';
      return;
    }

    if (directEl) directEl.style.display = 'none';
    if (!value) {
      dealEl.innerHTML = this._buildDealOptions(this._leads);
      if (hintEl) hintEl.textContent = '';
      return;
    }

    const matched = this._leads.filter(
      l => (l.customer_name || '').toLowerCase() === value.toLowerCase()
    );
    dealEl.innerHTML = this._buildDealOptions(matched);
    this._applyDealHint(matched);
  },

  _onCustomerDirectInput(value) {
    const dealEl = document.getElementById('ml-reg-lead');
    const hintEl = document.getElementById('ml-reg-deal-hint');
    if (!dealEl) return;
    const trimmed = value.trim();
    if (!trimmed) {
      dealEl.innerHTML = this._buildDealOptions([]);
      if (hintEl) hintEl.textContent = '';
      return;
    }
    const matched = this._leads.filter(l =>
      (l.customer_name || '').toLowerCase().includes(trimmed.toLowerCase())
    );
    dealEl.innerHTML = this._buildDealOptions(matched);
    this._applyDealHint(matched);
  },

  async _doRegisterCalendar(id) {
    const selectEl = document.getElementById('ml-reg-customer-select');
    const directEl = document.getElementById('ml-reg-customer-direct');
    const dealEl = document.getElementById('ml-reg-lead');

    let customer = '';
    if (selectEl && selectEl.value === '__direct__') {
      customer = (directEl?.value || '').trim();
    } else if (selectEl && selectEl.value) {
      customer = selectEl.value;
    }

    if (!customer) {
      Toast.error('고객사명을 선택하거나 입력해주세요');
      if (selectEl) selectEl.focus();
      return;
    }

    const leadId = dealEl?.value || null;
    const btn = document.querySelector('#modal-box .btn-primary');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '등록 중...';
    }

    try {
      const r = await API.meetings.registerCalendar(id, {
        customer_name: customer,
        lead_id: leadId,
      });
      if (r.success) {
        Modal.close();
        Toast.success(`캘린더 등록 완료: 미팅 + 액션 ${r.data.action_events_created}건`);
        await this.loadList();
        this.showDetail(id);
      } else {
        Toast.error(r.error || '등록 실패');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '캘린더에 등록';
        }
      }
    } catch (err) {
      Toast.error('등록 실패: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '캘린더에 등록';
      }
    }
  },

  deleteMeeting(id) {
    Modal.confirm('이 회의록을 삭제하시겠습니까?', async () => {
      try {
        await API.meetings.delete(id);
        Toast.success('삭제되었습니다');
        this.selectedId = null;
        document.getElementById('ml-detail').innerHTML =
          '<div class="empty">왼쪽 목록에서 회의록을 선택하세요</div>';
        await this.loadList();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  },
};
