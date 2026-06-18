// ============================================================
// Team Page - 팀 현황 / 조직 구조
// ============================================================
const TeamPage = {
  members: [],

  async render() {
    const html = `
      <div class="filter-bar">
        <div class="card-title" style="margin-right:auto" data-label="team.org_status">영업 조직 현황</div>
        <button class="btn btn-secondary btn-sm" id="team-export-btn"
                style="white-space:nowrap" title="내보내기 (Excel / CSV / JSON)"><span data-label="common.export">⤓ 내보내기</span></button>
        <button class="btn btn-primary" id="team-add-btn" data-label="team.add_button">+ 팀원 추가</button>
      </div>

      <div class="metrics-grid mb-3" id="team-summary">
        <div class="metric-card"><div class="metric-label" data-label="common.loading">로딩...</div></div>
      </div>

      <div class="grid-3 mb-3" id="team-divisions"></div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span data-label="team.sales_perf">팀원별 영업 실적</span> <span class="text-muted fs-12" id="team-count"></span></div>
        </div>
        <div class="card-body no-pad" id="team-table-wrap">
          <div class="loading" data-label="common.loading">로딩중...</div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;
    document.getElementById('team-add-btn')?.addEventListener('click', () => this.openForm());
    document.getElementById('team-export-btn')?.addEventListener('click', e => {
      const path = '/team/export';
      const name = '팀원_' + new Date().toISOString().slice(0, 10);
      if (typeof ExportMenu !== 'undefined') ExportMenu.open(e.currentTarget, path, name);
      else API.downloadExport(path, name, 'xlsx');
    });
    await this.loadData();
  },

  async loadData() {
    try {
      const result = await API.team.list();
      this.members = result.data;
      this.renderSummary();
      this.renderDivisions();
      this.renderTable();
    } catch (err) {
      console.error(err);
    }
  },

  renderSummary() {
    const cs = this.members.filter(m => m.role === 'CS').length;
    const field = this.members.filter(m => m.role === 'Field').length;
    const sales = this.members.filter(m => m.role === 'Sales').length;
    const total = this.members.length;
    const totalActive = this.members.reduce((s, m) => s + (parseInt(m.active_leads) || 0), 0);
    const totalWon = this.members.reduce((s, m) => s + (parseInt(m.won_count) || 0), 0);

    document.getElementById('team-summary').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">총 인원</div>
        <div class="metric-value">${total}<span class="metric-unit">명</span></div>
        <div class="metric-sub">활성 팀원</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">CS (고객지원)</div>
        <div class="metric-value">${cs}<span class="metric-unit">명</span></div>
        <div class="metric-sub">기술/A/S 대응</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Field (현장)</div>
        <div class="metric-value">${field}<span class="metric-unit">명</span></div>
        <div class="metric-sub">현장 시공/관리</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Sales (영업)</div>
        <div class="metric-value">${sales}<span class="metric-unit">명</span></div>
        <div class="metric-sub">파이프 ${totalActive}건 · 수주 ${totalWon}건</div>
      </div>
    `;
  },

  renderDivisions() {
    // 사업영역별 분류 (team 컬럼 기준)
    const groups = {};
    this.members.forEach(m => {
      const key = m.team || '미배정';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });

    // 주요 사업영역 카드
    const order = ['태양광', '전기/ESS', '해외영업', 'CS팀', '미배정'];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    document.getElementById('team-divisions').innerHTML = sortedKeys
      .map(key => {
        const arr = groups[key];
        const activeLeads = arr.reduce((s, m) => s + (parseInt(m.active_leads) || 0), 0);
        const wonAmount = arr.reduce((s, m) => s + (parseFloat(m.won_amount) || 0), 0);
        return `
        <div class="card">
          <div class="card-header">
            <div class="card-title">${esc(key)}</div>
            <span class="badge badge-blue">${arr.length}명</span>
          </div>
          <div class="card-body">
            <div class="text-muted fs-12 mb-2">진행중 ${activeLeads}건 · 올해수주 ${Fmt.amount(wonAmount)}</div>
            <div class="team-member-list">
              ${arr
                .map(
                  m => `
                <div class="member-row">
                  <div class="member-avatar" style="background:${this.roleColor(m.role)}">
                    ${esc(m.name.charAt(0))}
                  </div>
                  <div class="member-info">
                    <div class="member-name">${esc(m.name)}</div>
                    <div class="member-role">${esc(m.role)}${m.email ? ' · ' + esc(m.email) : ''}</div>
                  </div>
                  <span class="badge badge-gray">${m.active_leads || 0}</span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  },

  renderTable() {
    document.getElementById('team-count').textContent = `(총 ${this.members.length}명)`;
    if (!this.members.length) {
      document.getElementById('team-table-wrap').innerHTML =
        '<div class="empty"><div class="empty-icon">👥</div>등록된 팀원이 없습니다</div>';
      return;
    }

    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th data-label="team.name">이름</th>
            <th data-label="team.role">역할</th>
            <th data-label="team.team">소속팀</th>
            <th data-label="team.email">이메일</th>
            <th class="text-right" data-label="team.in_progress">진행중</th>
            <th class="text-right" data-label="team.won_this_year">올해수주</th>
            <th class="text-right" data-label="team.won_amount">수주금액</th>
            <th class="text-right" data-label="team.new_this_month">이번달신규</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.members
            .map(
              m => `
            <tr>
              <td>
                <div class="flex gap-2 ai-center">
                  <div class="member-avatar sm" style="background:${this.roleColor(m.role)}">${esc(m.name.charAt(0))}</div>
                  <strong>${esc(m.name)}</strong>
                </div>
              </td>
              <td><span class="badge ${this.roleBadge(m.role)}">${esc(m.role)}</span></td>
              <td class="text-muted">${esc(m.team || '-')}</td>
              <td class="text-muted fs-12">${esc(m.email || '-')}</td>
              <td class="text-right mono">${m.active_leads || 0}</td>
              <td class="text-right mono">${m.won_count || 0}</td>
              <td class="text-right mono"><strong>${Fmt.amount(m.won_amount)}</strong></td>
              <td class="text-right mono">${m.new_this_month || 0}</td>
              <td>
                <button class="btn btn-ghost btn-sm" data-action="edit-member" data-mid="${m.id}">편집</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    document.getElementById('team-table-wrap').innerHTML = html;
    document.getElementById('team-table-wrap').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const mid = parseInt(btn.dataset.mid);
      if (btn.dataset.action === 'edit-member') this.openForm(mid);
    });
  },

  roleColor(role) {
    return { Sales: '#E63329', Field: '#2357E8', CS: '#17A85A' }[role] || '#6B7280';
  },
  roleBadge(role) {
    return { Sales: 'badge-red', Field: 'badge-blue', CS: 'badge-green' }[role] || 'badge-gray';
  },

  openForm(id = null) {
    const m = id ? this.members.find(x => x.id === id) : null;
    Modal.open({
      title: m ? '팀원 정보 수정' : '신규 팀원 등록',
      width: 480,
      body: `
        <form id="team-form" class="form-grid">
          <div class="form-row">
            <label class="form-label">이름 *</label>
            <input class="form-input" name="name" value="${esc(m?.name || '')}" required>
          </div>
          <div class="form-row">
            <label class="form-label">역할 *</label>
            <select class="form-input" name="role" required>
              <option value="Sales" ${m?.role === 'Sales' ? 'selected' : ''}>Sales (영업)</option>
              <option value="Field" ${m?.role === 'Field' ? 'selected' : ''}>Field (현장)</option>
              <option value="CS" ${m?.role === 'CS' ? 'selected' : ''}>CS (고객지원)</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">소속팀</label>
            <input class="form-input" name="team" value="${esc(m?.team || '')}" placeholder="예: 태양광, 전기/ESS, 해외영업">
          </div>
          <div class="form-row">
            <label class="form-label">이메일</label>
            <input type="email" class="form-input" name="email" value="${esc(m?.email || '')}">
          </div>
          <div class="form-row">
            <label class="form-label">전화</label>
            <input class="form-input" name="phone" value="${esc(m?.phone || '')}">
          </div>
        </form>
      `,
      footer: `
        ${m ? `<button class="btn btn-ghost text-danger" id="team-deactivate-btn">비활성화</button>` : ''}
        <button class="btn btn-ghost" id="team-cancel-btn">취소</button>
        <button class="btn btn-primary" id="team-save-btn">${m ? '저장' : '등록'}</button>
      `,
      bind: {
        ...(m ? { '#team-deactivate-btn': () => this.deactivate(m.id) } : {}),
        '#team-cancel-btn': () => Modal.close(),
        '#team-save-btn': () => this.save(m?.id || null),
      },
    });
  },

  async save(id) {
    const form = document.getElementById('team-form');
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => (body[k] = v));
    if (!body.name) return Toast.error('이름을 입력하세요');
    try {
      if (id) {
        await API.team.update(id, body);
        Toast.success('팀원 정보가 수정되었습니다');
      } else {
        await API.team.create(body);
        Toast.success('팀원이 등록되었습니다');
      }
      Modal.close();
      this.loadData();
    } catch (err) {
      console.error(err);
    }
  },

  deactivate(id) {
    Modal.confirm('이 팀원을 비활성화하시겠습니까?', async () => {
      try {
        await API.team.delete(id);
        Toast.success('비활성화되었습니다');
        this.loadData();
      } catch (err) {
        console.error(err);
      }
    });
  },
};
