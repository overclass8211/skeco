// ============================================================
// Notifications List Page — 알림 전체 목록
// ============================================================
const NotificationsListPage = {
  items: [],
  _filterType: '',

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <select class="filter-select" id="notif-type-filter">
          <option value="">전체 유형</option>
          <option value="마감초과">🚨 마감초과</option>
          <option value="입찰마감">📋 입찰마감</option>
          <option value="마감임박">⏰ 마감임박</option>
          <option value="납기임박">🏭 납기임박</option>
          <option value="오늘일정">📅 일정</option>
          <option value="수주완료">🏆 수주완료</option>
          <option value="단계변경">🔄 단계변경</option>
          <option value="회의록등록">📝 회의록</option>
          <option value="리드등록">🎯 리드등록</option>
          <option value="고객사등록">🏢 고객사등록</option>
          <option value="활동등록">✍️ 활동등록</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="notif-refresh-btn">🔄 새로고침</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">알림 전체 목록 <span class="text-muted fs-12" id="notif-total-count"></span></div>
        </div>
        <div id="notif-full-list" class="card-body no-pad">
          <div class="loading" style="padding:40px;text-align:center">로딩 중...</div>
        </div>
      </div>
    `;
    document
      .getElementById('notif-type-filter')
      ?.addEventListener('change', () => this.applyFilter());
    document.getElementById('notif-refresh-btn')?.addEventListener('click', () => this.load());
    await this.load();
  },

  async load() {
    const wrap = document.getElementById('notif-full-list');
    if (wrap)
      wrap.innerHTML =
        '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';
    try {
      const res = await API.get('/notifications?extended=true');
      this.items = res.data || [];
      this.applyFilter();
    } catch {
      if (wrap)
        wrap.innerHTML =
          '<div class="empty" style="padding:40px;text-align:center">알림을 불러오지 못했습니다</div>';
    }
  },

  applyFilter() {
    const type = document.getElementById('notif-type-filter')?.value || '';
    this._filterType = type;
    const filtered = type ? this.items.filter(n => n.type === type) : this.items;
    this.renderList(filtered);
  },

  renderList(items) {
    const countEl = document.getElementById('notif-total-count');
    if (countEl) countEl.textContent = `(${items.length}건)`;

    const wrap = document.getElementById('notif-full-list');
    if (!wrap) return;

    if (!items.length) {
      wrap.innerHTML =
        '<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">해당 알림이 없습니다</div>';
      return;
    }

    const META = {
      마감초과: { icon: '🚨', color: 'red', dateLabel: '초과일', urgent: true },
      입찰마감: { icon: '📋', color: 'red', dateLabel: '마감일', urgent: true },
      마감임박: { icon: '⏰', color: 'amber', dateLabel: '마감일', urgent: true },
      납기임박: { icon: '🏭', color: 'amber', dateLabel: '납기일', urgent: true },
      오늘일정: { icon: '📅', color: 'blue', dateLabel: '일정', urgent: false },
      수주완료: { icon: '🏆', color: 'green', dateLabel: '완료일', urgent: false },
      단계변경: { icon: '🔄', color: 'blue', dateLabel: '변경일', urgent: false },
      회의록등록: { icon: '📝', color: 'green', dateLabel: '등록일', urgent: false },
      리드등록: { icon: '🎯', color: 'purple', dateLabel: '등록일', urgent: false },
      고객사등록: { icon: '🏢', color: 'purple', dateLabel: '등록일', urgent: false },
      활동등록: { icon: '✍️', color: 'gray', dateLabel: '등록일', urgent: false },
    };

    const STAGE_LABELS = {
      lead: '리드발굴',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      dropped: '드롭',
    };

    // 시간순(최신↓) 정렬 후 날짜 그룹핑 — Notifications 의 헬퍼 재사용
    const sorted =
      typeof Notifications !== 'undefined' && Notifications._sortByRecency
        ? Notifications._sortByRecency(items)
        : items;
    const groups =
      typeof Notifications !== 'undefined' && Notifications._groupByDate
        ? Notifications._groupByDate(sorted)
        : { today: sorted, week: [], month: [], older: [] };

    const renderSection = (list, label) => {
      if (!list.length) return '';
      const rows = list
        .map(n => {
          const m = META[n.type] || { icon: '🔔', color: 'amber', dateLabel: '일자' };
          const daysTag =
            n.type === '마감초과' && n.days_left > 0
              ? `<span class="badge badge-red" style="font-size:11px">D+${n.days_left}</span>`
              : n.days_left > 0
                ? `<span class="badge badge-amber" style="font-size:11px">D-${n.days_left}</span>`
                : '';
          const dateStr = n.due_date
            ? Fmt.dateTime
              ? Fmt.dateTime(n.due_date)
              : Fmt.date(n.due_date)
            : '';

          let descHtml;
          if (n.type === '단계변경' && n.stage_detail) {
            const arrow = n.stage_detail.replace('단계 변경: ', '');
            descHtml = `${esc(n.project_name || '')} <span style="color:var(--oci-blue,#1a73e8);font-weight:600">→ ${esc(arrow)}</span>`;
          } else {
            descHtml = esc(n.project_name || n.stage || '');
          }

          return `
          <tr class="notif-row" data-notif-type="${esc(n.type)}" data-notif-id="${n.id}"
              style="cursor:pointer" title="클릭하여 이동">
            <td style="width:40px;text-align:center">
              <span class="notif-icon-sm ${m.color}">${m.icon}</span>
            </td>
            <td>
              <span class="badge badge-${m.color === 'red' ? 'red' : m.color === 'amber' ? 'amber' : m.color === 'green' ? 'green' : m.color === 'blue' ? 'blue' : m.color === 'purple' ? 'purple' : 'gray'}"
                    style="font-size:11px">${esc(n.type)}</span>
            </td>
            <td style="font-weight:600">${esc(n.customer_name || '-')}</td>
            <td>${descHtml}</td>
            <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${dateStr}</td>
            <td>${daysTag}</td>
          </tr>`;
        })
        .join('');

      return `
        <div style="padding:8px 16px 4px;font-size:11px;font-weight:700;color:var(--text-3);
                    letter-spacing:.5px;text-transform:uppercase;background:var(--bg-2);
                    border-bottom:1px solid var(--border)">${label}</div>
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th style="width:90px">유형</th>
              <th>고객사</th>
              <th>내용</th>
              <th style="width:140px">일시</th>
              <th style="width:60px">D-Day</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    };

    wrap.innerHTML =
      renderSection(groups.today, '📅 오늘') +
      renderSection(groups.week, '🗓 최근 7일') +
      renderSection(groups.month, '📆 이번 달') +
      renderSection(groups.older, '📋 이전');

    wrap.addEventListener('click', e => {
      const row = e.target.closest('.notif-row[data-notif-id]');
      if (row) this.navigateTo(row.dataset.notifType, parseInt(row.dataset.notifId));
    });
  },

  navigateTo(type, id) {
    // Notifications 객체의 navigateTo 재활용
    if (typeof Notifications !== 'undefined') {
      // items를 임시로 this.items로 교체해서 호출
      const origItems = Notifications.items;
      Notifications.items = this.items;
      Notifications.navigateTo(type, id);
      Notifications.items = origItems;
    }
  },
};
