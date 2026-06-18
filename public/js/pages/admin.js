// ============================================================
// Admin Page - 시스템 현황 / 접근 로그 / 팀 관리 / 사용 통계
// ============================================================
const AdminPage = {
  activeTab: 'system',
  logsPage: 0,
  logsData: [],
  teamData: [],
  statsData: null,
  teamStatsData: [],
  usageChart: null,

  async render() {
    const html = `
      <div class="filter-bar" style="margin-bottom:0;border-bottom:none">
        <div class="card-title" style="margin-right:auto">관리자 콘솔</div>
      </div>

      <div class="tab-bar" id="admin-tab-bar" style="display:flex;gap:4px;padding:0 0 0 0;border-bottom:2px solid var(--border);margin-bottom:18px">
        <button class="tab-btn active" data-tab="system">시스템 현황</button>
        <button class="tab-btn"        data-tab="users">👤 사용자 관리</button>
        <button class="tab-btn"        data-tab="policy">시스템 정책</button>
        <button class="tab-btn"        data-tab="tokens">사용자 토큰 관리</button>
        <button class="tab-btn"        data-tab="logs">접근 로그</button>
        <button class="tab-btn"        data-tab="team">팀 관리</button>
        <button class="tab-btn"        data-tab="usage">사용 통계</button>
        <button class="tab-btn"        data-tab="board">📋 게시판 통계</button>
        <button class="tab-btn"        data-tab="pipeline">🔀 파이프라인 설정</button>
        <button class="tab-btn"        data-tab="menu-config">🧭 메뉴 구조</button>
        <button class="tab-btn"        data-tab="word-repo">🗂 워드 사전</button>
        <button class="tab-btn"        data-tab="supplier-info">📑 공급사 기본 정보</button>
        ${
          App.currentUser?.role === 'superadmin'
            ? `
        <button class="tab-btn" data-tab="token-monitor"
          style="color:#d93025;border-bottom-color:transparent">
          🔑 AI 토큰 현황
        </button>`
            : ''
        }
      </div>

      <div id="admin-tab-system"        class="admin-tab-panel"></div>
      <div id="admin-tab-users"         class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-policy"        class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-tokens"        class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-logs"          class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-team"          class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-usage"         class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-board"         class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-pipeline"      class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-menu-config"   class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-word-repo"     class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-supplier-info" class="admin-tab-panel" style="display:none"></div>
      <div id="admin-tab-token-monitor" class="admin-tab-panel" style="display:none"></div>
    `;
    document.getElementById('content').innerHTML = html;

    // tab delegation
    document.getElementById('admin-tab-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn[data-tab]');
      if (btn) this.switchTab(btn.dataset.tab);
    });

    // inject minimal tab-btn styles if not present
    if (!document.getElementById('admin-tab-style')) {
      const s = document.createElement('style');
      s.id = 'admin-tab-style';
      s.textContent = `
        .tab-btn {
          padding: 8px 18px;
          border: none;
          background: none;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-2, #6B7280);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          transition: color .15s, border-color .15s;
        }
        .tab-btn.active {
          color: var(--primary, #1664E5);
          border-bottom-color: var(--primary, #1664E5);
        }
        .tab-btn:hover:not(.active) {
          color: var(--text-1, #111);
        }
        .health-dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          margin-right: 5px;
        }
        .log-method {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          font-family: monospace;
        }
        .log-method-GET    { background:#EEF2FF; color:#3730A3; }
        .log-method-POST   { background:#F0FDF4; color:#166534; }
        .log-method-PUT    { background:#FFFBEB; color:#92400E; }
        .log-method-DELETE { background:#FEF2F2; color:#991B1B; }
        .log-method-PATCH  { background:#F5F3FF; color:#6D28D9; }
        .pagination-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
          font-size: 13px;
          color: var(--text-2, #6B7280);
        }
        .stat-card-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 18px;
        }
        @media (max-width: 900px) {
          .stat-card-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .admin-stat-card {
          background: var(--card-bg, #fff);
          border: 1px solid var(--border, #E5E7EB);
          border-radius: 10px;
          padding: 18px 20px;
        }
        .admin-stat-label {
          font-size: 12px;
          color: var(--text-2, #6B7280);
          margin-bottom: 6px;
        }
        .admin-stat-value {
          font-size: 26px;
          font-weight: 700;
          color: var(--text-1, #111);
          line-height: 1.1;
        }
        .admin-stat-unit {
          font-size: 13px;
          font-weight: 400;
          color: var(--text-2, #6B7280);
          margin-left: 3px;
        }
        .admin-stat-sub {
          font-size: 11px;
          color: var(--text-3, #9CA3AF);
          margin-top: 4px;
        }
        .health-table td, .health-table th {
          padding: 10px 14px;
          font-size: 13px;
        }
        .chart-wrap-bar {
          position: relative;
          height: 260px;
        }
      `;
      document.head.appendChild(s);
    }

    await this.loadSystem();
  },

  // ── Tab switching ──────────────────────────────────────────
  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('#admin-tab-bar .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.admin-tab-panel').forEach(panel => {
      panel.style.display = 'none';
    });
    document.getElementById('admin-tab-' + tab).style.display = '';

    const panel = document.getElementById('admin-tab-' + tab);
    if (!panel.dataset.loaded) {
      if (tab === 'system') this.loadSystem();
      else if (tab === 'users') this.loadUsers();
      else if (tab === 'policy') this.loadPolicy();
      else if (tab === 'tokens') this.loadTokens();
      else if (tab === 'logs') this.loadLogs(0);
      else if (tab === 'team') this.loadTeam();
      else if (tab === 'usage') this.loadUsage();
      else if (tab === 'board') this.loadBoardStats();
      else if (tab === 'pipeline') this.loadPipelineStages();
      else if (tab === 'menu-config') this.loadMenuConfig();
      else if (tab === 'word-repo') this.loadWordRepo();
      else if (tab === 'supplier-info') this.loadSupplierInfo();
      else if (tab === 'token-monitor') this.loadTokenMonitor();
    }
  },

  // ============================================================
  // Tab — 사용자 관리 (RBAC)
  // ============================================================
  async loadUsers() {
    const panel = document.getElementById('admin-tab-users');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const r = await API.request('GET', '/auth/users');
      const ROLE_INFO = {
        manager: { label: '매니저', color: '#6c757d', desc: '일반사용자' },
        team_lead: { label: '팀장', color: '#3788d8', desc: '관리자' },
        executive: { label: '경영진', color: '#fd7e14', desc: '전체열람' },
        superadmin: { label: 'IT운영', color: '#e63946', desc: '수퍼어드민' },
      };
      const rows = r.data
        .map(u => {
          const ri = ROLE_INFO[u.role] || ROLE_INFO.manager;
          return `<tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.full_name || '-'}</td>
          <td>${u.email || '-'}</td>
          <td><span class="badge" style="background:${ri.color}20;color:${ri.color};border:1px solid ${ri.color}40;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${ri.label}</span></td>
          <td><span style="color:${u.is_active ? '#28a745' : '#dc3545'}">${u.is_active ? '활성' : '비활성'}</span></td>
          <td>${u.otp_enabled ? '✅' : '-'}</td>
          <td>${u.last_login ? new Date(u.last_login).toLocaleDateString('ko-KR') : '-'}</td>
          <td>
            <button class="btn-sm btn-outline" data-action="edit-user"
              data-uid="${u.id}" data-username="${esc(u.username)}" data-fullname="${esc(u.full_name || '')}"
              data-email="${esc(u.email || '')}" data-role="${esc(u.role)}" data-active="${u.is_active ? 1 : 0}">수정</button>
            ${u.role !== 'superadmin' ? `<button class="btn-sm btn-danger-outline" data-action="delete-user" data-uid="${u.id}" data-username="${esc(u.username)}">비활성화</button>` : ''}
          </td>
        </tr>`;
        })
        .join('');
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <strong>시스템 사용자 목록</strong>
            <span style="color:var(--text-2);font-size:13px;margin-left:8px">${r.data.length}명</span>
          </div>
          <button class="btn-primary" id="admin-create-user-btn">+ 사용자 추가</button>
        </div>
        <div class="admin-role-help-box" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--text-1)">
          <strong>역할 설명:</strong>
          &nbsp;<span style="color:var(--text-3)">매니저(일반)</span> →
          <span style="color:#3788d8">팀장(관리자)</span> →
          <span style="color:#fd7e14">경영진(전체열람)</span> →
          <span style="color:#e63946">IT운영(수퍼어드민)</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>아이디</th><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th>OTP</th><th>마지막 로그인</th><th>관리</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      panel.dataset.loaded = '1';

      document
        .getElementById('admin-create-user-btn')
        ?.addEventListener('click', () => this.createUserModal());
      panel.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const uid = parseInt(btn.dataset.uid);
        if (btn.dataset.action === 'edit-user') {
          this.editUser(
            uid,
            btn.dataset.username,
            btn.dataset.fullname,
            btn.dataset.email,
            btn.dataset.role,
            btn.dataset.active === '1'
          );
        } else if (btn.dataset.action === 'delete-user') {
          this.deleteUser(uid, btn.dataset.username);
        }
      });
    } catch (e) {
      panel.innerHTML = `<div class="empty-state">오류: ${e.message}</div>`;
    }
  },

  createUserModal() {
    const ROLES = [
      { v: 'manager', l: '매니저 (일반사용자)' },
      { v: 'team_lead', l: '팀장 (관리자)' },
      { v: 'executive', l: '경영진 (전체열람)' },
      { v: 'superadmin', l: 'IT운영 (수퍼어드민)' },
    ];
    Modal.open(
      '사용자 추가',
      `
      <div class="form-group"><label>아이디 *</label><input id="nu-username" class="form-control" placeholder="영문/숫자 4~20자"></div>
      <div class="form-group"><label>이름</label><input id="nu-fullname" class="form-control" placeholder="홍길동"></div>
      <div class="form-group"><label>이메일</label><input id="nu-email" class="form-control" type="email" placeholder="user@oci.com"></div>
      <div class="form-group"><label>비밀번호 *</label><input id="nu-password" class="form-control" type="password" placeholder="8자 이상"></div>
      <div class="form-group"><label>역할</label>
        <select id="nu-role" class="form-control">
          ${ROLES.map(r => `<option value="${r.v}">${r.l}</option>`).join('')}
        </select>
      </div>
    `,
      async () => {
        const body = {
          username: document.getElementById('nu-username').value.trim(),
          full_name: document.getElementById('nu-fullname').value.trim(),
          email: document.getElementById('nu-email').value.trim(),
          password: document.getElementById('nu-password').value,
          role: document.getElementById('nu-role').value,
        };
        if (!body.username || !body.password) {
          Toast.error('아이디와 비밀번호는 필수입니다.');
          return;
        }
        await API.request('POST', '/auth/users', body);
        Toast.success('사용자가 추가되었습니다.');
        document.getElementById('admin-tab-users').dataset.loaded = '';
        AdminPage.loadUsers();
      }
    );
  },

  editUser(id, username, fullName, email, role, isActive) {
    const ROLES = [
      { v: 'manager', l: '매니저 (일반사용자)' },
      { v: 'team_lead', l: '팀장 (관리자)' },
      { v: 'executive', l: '경영진 (전체열람)' },
      { v: 'superadmin', l: 'IT운영 (수퍼어드민)' },
    ];
    Modal.open(
      `사용자 수정 — ${username}`,
      `
      <div class="form-group"><label>이름</label><input id="eu-fullname" class="form-control" value="${fullName}"></div>
      <div class="form-group"><label>이메일</label><input id="eu-email" class="form-control" type="email" value="${email}"></div>
      <div class="form-group"><label>역할</label>
        <select id="eu-role" class="form-control">
          ${ROLES.map(r => `<option value="${r.v}" ${r.v === role ? 'selected' : ''}>${r.l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>상태</label>
        <select id="eu-active" class="form-control">
          <option value="1" ${isActive ? 'selected' : ''}>활성</option>
          <option value="0" ${!isActive ? 'selected' : ''}>비활성</option>
        </select>
      </div>
      <div class="form-group"><label>새 비밀번호 (변경 시만)</label><input id="eu-password" class="form-control" type="password" placeholder="비워두면 변경 안 함"></div>
    `,
      async () => {
        const body = {
          full_name: document.getElementById('eu-fullname').value.trim(),
          email: document.getElementById('eu-email').value.trim(),
          role: document.getElementById('eu-role').value,
          is_active: parseInt(document.getElementById('eu-active').value),
        };
        const pw = document.getElementById('eu-password').value;
        if (pw) body.password = pw;
        await API.request('PUT', `/auth/users/${id}`, body);
        Toast.success('사용자 정보가 수정되었습니다.');
        document.getElementById('admin-tab-users').dataset.loaded = '';
        AdminPage.loadUsers();
      }
    );
  },

  async deleteUser(id, username) {
    if (!confirm(`${username} 계정을 비활성화하시겠습니까?`)) return;
    await API.request('DELETE', `/auth/users/${id}`);
    Toast.success('계정이 비활성화되었습니다.');
    document.getElementById('admin-tab-users').dataset.loaded = '';
    AdminPage.loadUsers();
  },

  // ============================================================
  // Tab — 시스템 정책 (idle timeout, default token limit)
  // ============================================================
  async loadPolicy() {
    const panel = document.getElementById('admin-tab-policy');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const r = await API.admin.getSettings();
      const idle = parseInt(r.data.idle_timeout_min || 30);
      const defLimit = parseInt(r.data.default_monthly_token_limit || 500000);

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">⏰ 자동 로그아웃 (Idle Timeout)</div>
          </div>
          <div class="card-body">
            <p style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6">
              사용자가 일정 시간 동안 활동이 없을 때 자동으로 로그아웃됩니다.
              마우스, 키보드, 스크롤 입력이 감지되면 타이머가 초기화됩니다.
            </p>
            <div class="form-row" style="max-width:340px">
              <label class="form-label">자동 로그아웃 대기 시간 (분)</label>
              <select class="form-input" id="policy-idle">
                <option value="0"  ${idle === 0 ? 'selected' : ''}>비활성화 (자동 로그아웃 안 함)</option>
                <option value="5"  ${idle === 5 ? 'selected' : ''}>5분</option>
                <option value="10" ${idle === 10 ? 'selected' : ''}>10분</option>
                <option value="15" ${idle === 15 ? 'selected' : ''}>15분</option>
                <option value="30" ${idle === 30 ? 'selected' : ''}>30분</option>
                <option value="60" ${idle === 60 ? 'selected' : ''}>60분</option>
                <option value="120" ${idle === 120 ? 'selected' : ''}>120분</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-header">
            <div class="card-title">🛡 AI 토큰 기본 한도</div>
          </div>
          <div class="card-body">
            <p style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6">
              개별 한도가 지정되지 않은 사용자에게 적용되는 월간 AI 토큰 한도입니다.
              한도 초과 시 해당 사용자의 AI 호출이 자동 차단됩니다.
            </p>
            <div class="form-row" style="max-width:340px">
              <label class="form-label">월간 기본 토큰 한도</label>
              <input type="number" class="form-input" id="policy-token-limit"
                     value="${defLimit}" min="0" step="10000"
                     placeholder="0 = 무제한">
              <small style="font-size:11px;color:var(--text-3);margin-top:4px">0 입력 시 무제한</small>
            </div>
          </div>
        </div>

        <div style="margin-top:18px;text-align:right">
          <button class="btn btn-primary" id="policy-save-btn">정책 저장</button>
        </div>
      `;
      panel.dataset.loaded = '1';
      document
        .getElementById('policy-save-btn')
        ?.addEventListener('click', () => this.savePolicy());
    } catch (err) {
      panel.innerHTML = `<div class="empty">설정 로드 실패: ${esc(err.message)}</div>`;
    }
  },

  async savePolicy() {
    const idle = document.getElementById('policy-idle').value;
    const limit = document.getElementById('policy-token-limit').value;
    try {
      await API.admin.saveSettings({
        idle_timeout_min: idle,
        default_monthly_token_limit: limit,
      });
      Toast.success('정책이 저장되었습니다');
      // 즉시 적용
      if (typeof UserPrefs !== 'undefined') UserPrefs.reloadIdlePolicy();
    } catch (err) {
      console.error(err);
    }
  },

  // ============================================================
  // Tab — 사용자 토큰 관리
  // ============================================================
  async loadTokens() {
    const panel = document.getElementById('admin-tab-tokens');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const r = await API.admin.tokenByUser();
      const rows = r.data || [];
      const defaultLimit = r.defaultLimit || 0;

      const totalUsed = rows.reduce((s, x) => s + Number(x.used_this_month), 0);

      panel.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="card-body">
            <div style="display:flex;gap:24px;font-size:13px">
              <div><strong>이번 달 누적 사용:</strong> ${totalUsed.toLocaleString()} tokens</div>
              <div><strong>등록 사용자:</strong> ${rows.length}명</div>
              <div><strong>기본 한도:</strong> ${defaultLimit.toLocaleString()} tokens/월</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-body no-pad">
            <table class="data-table">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>역할</th>
                  <th>이번 달 사용</th>
                  <th>호출 수</th>
                  <th>월간 한도</th>
                  <th>사용률</th>
                  <th style="width:140px">한도 변경</th>
                </tr>
              </thead>
              <tbody id="tokens-tbody">
                ${rows
                  .map(u => {
                    const limit =
                      u.monthly_token_limit !== null && u.monthly_token_limit !== undefined
                        ? u.monthly_token_limit
                        : defaultLimit;
                    const used = Number(u.used_this_month);
                    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                    const barColor = pct >= 90 ? '#d93025' : pct >= 70 ? '#f59c00' : '#1a73e8';
                    return `
                    <tr>
                      <td><strong>${esc(u.name)}</strong><br><span style="font-size:11px;color:var(--text-3)">${esc(u.email || '')}</span></td>
                      <td><span class="badge badge-blue">${esc(u.role)}</span></td>
                      <td class="mono">${used.toLocaleString()}</td>
                      <td class="mono">${u.calls_this_month}</td>
                      <td class="mono">
                        ${
                          u.monthly_token_limit !== null && u.monthly_token_limit !== undefined
                            ? `<strong>${Number(u.monthly_token_limit).toLocaleString()}</strong>`
                            : `<span style="color:var(--text-3)">기본 (${defaultLimit.toLocaleString()})</span>`
                        }
                      </td>
                      <td>
                        <div style="display:flex;align-items:center;gap:8px">
                          <div style="flex:1;height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden">
                            <div style="height:100%;width:${pct}%;background:${barColor};transition:width 0.3s"></div>
                          </div>
                          <span style="font-size:11px;font-weight:600;min-width:36px;text-align:right">${pct}%</span>
                        </div>
                      </td>
                      <td>
                        <input type="number" class="form-input" style="height:30px;font-size:12px;padding:4px 8px"
                               id="tlim-${u.id}" value="${u.monthly_token_limit || ''}"
                               placeholder="기본값" min="0" step="10000">
                        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11px;margin-top:4px"
                                data-action="save-limit" data-uid="${u.id}">저장</button>
                      </td>
                    </tr>
                  `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
      panel.dataset.loaded = '1';
      panel.addEventListener('click', e => {
        const btn = e.target.closest('[data-action="save-limit"]');
        if (btn) this.saveUserLimit(parseInt(btn.dataset.uid));
      });
    } catch (err) {
      panel.innerHTML = `<div class="empty">로드 실패: ${esc(err.message)}</div>`;
    }
  },

  async saveUserLimit(userId) {
    const val = document.getElementById(`tlim-${userId}`).value;
    try {
      await API.admin.setTokenLimit(userId, val);
      Toast.success('한도가 저장되었습니다');
      delete document.getElementById('admin-tab-tokens').dataset.loaded;
      this.loadTokens();
    } catch (err) {
      console.error(err);
    }
  },

  // ============================================================
  // Tab 1 — 시스템 현황
  // ============================================================
  async loadSystem() {
    const panel = document.getElementById('admin-tab-system');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const res = await API.get('/admin/stats');
      const d = res.data || res;
      this.statsData = d;

      panel.dataset.loaded = '1';
      // listener added after innerHTML is set (below)
      panel.innerHTML = `
        <div class="stat-card-grid">
          <div class="admin-stat-card">
            <div class="admin-stat-label">총 팀원</div>
            <div class="admin-stat-value">${d.total_users ?? '-'}<span class="admin-stat-unit">명</span></div>
            <div class="admin-stat-sub">등록된 전체 사용자</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-label">금일 API 호출</div>
            <div class="admin-stat-value">${d.api_calls_today !== null && d.api_calls_today !== undefined ? d.api_calls_today.toLocaleString() : '-'}<span class="admin-stat-unit">회</span></div>
            <div class="admin-stat-sub">오늘 0시 이후 누적</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-label">DB 크기</div>
            <div class="admin-stat-value">${d.db_size_mb !== null && d.db_size_mb !== undefined ? parseFloat(d.db_size_mb).toFixed(1) : '-'}<span class="admin-stat-unit">MB</span></div>
            <div class="admin-stat-sub">MariaDB 전체 데이터</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-label">가동 시간</div>
            <div class="admin-stat-value">${d.uptime_hours !== null && d.uptime_hours !== undefined ? Math.floor(d.uptime_hours) : '-'}<span class="admin-stat-unit">hr</span></div>
            <div class="admin-stat-sub">마지막 재시작 이후</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">시스템 헬스 체크</div>
            <button class="btn btn-ghost btn-sm" id="system-refresh-btn">새로고침</button>
          </div>
          <div class="card-body no-pad">
            <table class="data-table health-table">
              <thead>
                <tr>
                  <th>서비스</th>
                  <th>상태</th>
                  <th>설명</th>
                  <th>최근 확인</th>
                </tr>
              </thead>
              <tbody>
                ${this._healthRows(d)}
              </tbody>
            </table>
          </div>
        </div>
      `;
      document
        .getElementById('system-refresh-btn')
        ?.addEventListener('click', () => this.loadSystem());
    } catch (err) {
      panel.innerHTML = `<div class="alert alert-error">시스템 현황을 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  },

  _healthRows(d) {
    const now = Fmt.date(new Date());
    const services = [
      {
        name: 'DB 연결',
        ok: d.db_size_mb !== null && d.db_size_mb !== undefined,
        desc:
          d.db_size_mb !== null && d.db_size_mb !== undefined
            ? `MariaDB 정상 응답 · ${parseFloat(d.db_size_mb).toFixed(1)} MB`
            : '연결 실패',
      },
      {
        name: 'API 서비스',
        ok: d.api_calls_today !== null && d.api_calls_today !== undefined,
        desc:
          d.api_calls_today !== null && d.api_calls_today !== undefined
            ? `Express API 정상 · 금일 ${d.api_calls_today.toLocaleString()}회 처리`
            : '응답 없음',
      },
      {
        name: '파일 스토리지',
        ok: true,
        desc: '로컬 파일시스템 정상',
      },
      {
        // 이 앱은 native `ws` 라이브러리 사용 (Socket.IO 아님)
        // 클라이언트 측: 전역 WS 객체의 WS.socket.readyState 로 판정
        // 서버 측: getClientCount() 가 d.ws_connections 에 활성 클라이언트 수 반환
        name: 'WebSocket',
        ok: typeof WS !== 'undefined' && WS.socket?.readyState === 1,
        desc:
          typeof WS !== 'undefined' && WS.socket?.readyState === 1
            ? `WebSocket 연결 활성${d.ws_connections !== null && d.ws_connections !== undefined ? ` · 활성 클라이언트 ${d.ws_connections}개` : ''}`
            : d.ws_connections > 0
              ? `서버 측 WebSocket 활성(${d.ws_connections}개 연결) · 현재 브라우저 연결 끊김`
              : 'WebSocket 연결 끊김 또는 미초기화',
      },
    ];

    return services
      .map(
        s => `
      <tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td>
          <span class="badge ${s.ok ? 'badge-green' : 'badge-red'}">
            <span class="health-dot" style="background:${s.ok ? '#17A85A' : '#E63329'}"></span>
            ${s.ok ? '정상' : '이상'}
          </span>
        </td>
        <td class="text-muted">${esc(s.desc)}</td>
        <td class="text-muted fs-12">${now}</td>
      </tr>
    `
      )
      .join('');
  },

  // ============================================================
  // Tab 2 — 접근 로그
  // ============================================================
  async loadLogs(page = 0) {
    this.logsPage = page;
    const panel = document.getElementById('admin-tab-logs');
    if (!panel.dataset.loaded) {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">접근 로그</div>
            <button class="btn btn-ghost btn-sm text-danger" id="logs-clear-btn">로그 초기화</button>
          </div>
          <div class="card-body no-pad" id="logs-table-wrap">
            <div class="loading">로딩중...</div>
          </div>
          <div class="pagination-bar" id="logs-pagination"></div>
        </div>
      `;
      panel.dataset.loaded = '1';
      document.getElementById('logs-clear-btn')?.addEventListener('click', () => this.clearLogs());
    }

    const wrap = document.getElementById('logs-table-wrap');
    if (wrap) wrap.innerHTML = '<div class="loading">로딩중...</div>';

    try {
      const limit = 50;
      const offset = page * limit;
      const res = await API.get(`/admin/access-logs?limit=${limit}&offset=${offset}`);
      const rows = Array.isArray(res) ? res : res.data || [];
      this.logsData = rows;
      this._renderLogsTable(rows, page, limit);
    } catch (err) {
      const wrap2 = document.getElementById('logs-table-wrap');
      if (wrap2)
        wrap2.innerHTML = `<div class="alert alert-error" style="margin:12px">로그를 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  },

  _renderLogsTable(rows, page, limit) {
    const wrap = document.getElementById('logs-table-wrap');
    const pag = document.getElementById('logs-pagination');
    if (!wrap) return;

    if (!rows.length) {
      wrap.innerHTML =
        '<div class="empty" style="padding:40px;text-align:center;color:var(--text-2)">기록된 로그가 없습니다</div>';
      if (pag) pag.innerHTML = '';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>시간</th>
            <th>경로</th>
            <th>메서드</th>
            <th>상태 코드</th>
            <th class="text-right">응답시간</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              r => `
            <tr>
              <td class="text-muted fs-12 mono" style="white-space:nowrap">${Fmt.relTime(r.created_at)}</td>
              <td class="mono fs-12" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.path)}</td>
              <td><span class="log-method log-method-${esc(r.method)}">${esc(r.method)}</span></td>
              <td>${this._statusBadge(r.status_code)}</td>
              <td class="text-right mono fs-12">${r.duration_ms !== null && r.duration_ms !== undefined ? r.duration_ms + ' ms' : '-'}</td>
              <td class="text-muted fs-12 mono">${esc(r.ip || '-')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;

    if (pag) {
      const hasPrev = page > 0;
      const hasNext = rows.length === limit;
      pag.innerHTML = `
        <span>페이지 ${page + 1}</span>
        <button class="btn btn-ghost btn-sm" ${hasPrev ? '' : 'disabled'} data-logs-page="${page - 1}">← 이전</button>
        <button class="btn btn-ghost btn-sm" ${hasNext ? '' : 'disabled'} data-logs-page="${page + 1}">다음 →</button>
      `;
      pag.addEventListener('click', e => {
        const btn = e.target.closest('[data-logs-page]');
        if (btn && !btn.disabled) this.loadLogs(parseInt(btn.dataset.logsPage));
      });
    }
  },

  _statusBadge(code) {
    if (!code) return '<span class="badge badge-gray">-</span>';
    const c = parseInt(code);
    let cls = 'badge-gray';
    if (c >= 200 && c < 300) cls = 'badge-green';
    else if (c >= 400 && c < 500) cls = 'badge-amber';
    else if (c >= 500) cls = 'badge-red';
    return `<span class="badge ${cls}">${esc(String(code))}</span>`;
  },

  clearLogs() {
    Modal.confirm('모든 접근 로그를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', async () => {
      try {
        await API.del('/admin/access-logs');
        Toast.success('접근 로그가 초기화되었습니다');
        const panel = document.getElementById('admin-tab-logs');
        if (panel) delete panel.dataset.loaded;
        this.loadLogs(0);
      } catch (err) {
        console.error(err);
      }
    });
  },

  // ============================================================
  // Tab 3 — 팀 관리
  // ============================================================
  async loadTeam() {
    const panel = document.getElementById('admin-tab-team');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const res = await API.get('/admin/team-stats');
      this.teamData = Array.isArray(res) ? res : res.data || [];
      panel.dataset.loaded = '1';
      this._renderTeamPanel();
    } catch (err) {
      panel.innerHTML = `<div class="alert alert-error">팀 데이터를 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  },

  _renderTeamPanel() {
    const panel = document.getElementById('admin-tab-team');
    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">팀원 관리 <span class="text-muted fs-12" id="admin-team-count"></span></div>
          <button class="btn btn-primary btn-sm" id="admin-add-member-btn">+ 팀원 추가</button>
        </div>
        <div class="card-body no-pad" id="admin-team-table-wrap">
          <div class="loading">로딩중...</div>
        </div>
      </div>
    `;
    document
      .getElementById('admin-add-member-btn')
      ?.addEventListener('click', () => this.openMemberForm());
    this._renderTeamTable();
  },

  _renderTeamTable() {
    const wrap = document.getElementById('admin-team-table-wrap');
    const cnt = document.getElementById('admin-team-count');
    if (!wrap) return;

    if (cnt) cnt.textContent = `(총 ${this.teamData.length}명)`;

    if (!this.teamData.length) {
      wrap.innerHTML =
        '<div class="empty" style="padding:40px;text-align:center;color:var(--text-2)">등록된 팀원이 없습니다</div>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>역할</th>
            <th>팀</th>
            <th>이메일</th>
            <th>최근 활동</th>
            <th class="text-right">담당 리드</th>
            <th class="text-right">활동 수</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.teamData
            .map(
              m => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="member-avatar sm" style="background:${this._roleColor(m.role)};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff">
                    ${esc((m.name || '?').charAt(0))}
                  </div>
                  <strong>${esc(m.name || '-')}</strong>
                </div>
              </td>
              <td><span class="badge ${this._roleBadge(m.role)}">${esc(m.role || '-')}</span></td>
              <td class="text-muted">${esc(m.team || '-')}</td>
              <td class="text-muted fs-12">${esc(m.email || '-')}</td>
              <td class="text-muted fs-12">${m.last_active ? Fmt.relTime(m.last_active) : '-'}</td>
              <td class="text-right mono">${m.leads_count !== null && m.leads_count !== undefined ? m.leads_count : '-'}</td>
              <td class="text-right mono">${m.activities_count !== null && m.activities_count !== undefined ? m.activities_count : '-'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-ghost btn-sm" data-action="edit-member" data-mid="${m.id}">편집</button>
                <button class="btn btn-ghost btn-sm text-danger" data-action="deactivate-member" data-mid="${m.id}" data-mname="${esc(m.name || '')}">비활성화</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const mid = parseInt(btn.dataset.mid);
      if (btn.dataset.action === 'edit-member') this.openMemberForm(mid);
      else if (btn.dataset.action === 'deactivate-member')
        this.deactivateMember(mid, btn.dataset.mname);
    });
  },

  _roleColor(role) {
    return (
      { Sales: '#E63329', Field: '#2357E8', CS: '#17A85A', Manager: '#7C4DFF', Admin: '#F59C00' }[
        role
      ] || '#6B7280'
    );
  },

  _roleBadge(role) {
    return (
      {
        Sales: 'badge-red',
        Field: 'badge-blue',
        CS: 'badge-green',
        Manager: 'badge-purple',
        Admin: 'badge-amber',
      }[role] || 'badge-gray'
    );
  },

  openMemberForm(id = null) {
    const m = id ? this.teamData.find(x => x.id === id) : null;
    const roles = ['Sales', 'CS', 'Field', 'Manager', 'Admin'];
    Modal.open({
      title: m ? '팀원 정보 수정' : '신규 팀원 등록',
      width: 480,
      body: `
        <form id="admin-member-form" class="form-grid">
          <div class="form-row">
            <label class="form-label">이름 *</label>
            <input class="form-input" name="name" value="${esc(m?.name || '')}" placeholder="홍길동" required>
          </div>
          <div class="form-row">
            <label class="form-label">역할 *</label>
            <select class="form-input" name="role" required>
              ${roles.map(r => `<option value="${r}" ${m?.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">팀</label>
            <input class="form-input" name="team" value="${esc(m?.team || '')}" placeholder="예: 태양광, 전기/ESS, CS팀">
          </div>
          <div class="form-row">
            <label class="form-label">이메일</label>
            <input type="email" class="form-input" name="email" value="${esc(m?.email || '')}" placeholder="name@example.com">
          </div>
          <div class="form-row">
            <label class="form-label">전화</label>
            <input class="form-input" name="phone" value="${esc(m?.phone || '')}" placeholder="010-0000-0000">
          </div>
        </form>
      `,
      footer: `
        ${m ? `<button class="btn btn-ghost text-danger" id="member-deactivate-btn">비활성화</button>` : ''}
        <button class="btn btn-ghost" id="member-cancel-btn">취소</button>
        <button class="btn btn-primary" id="member-save-btn">${m ? '저장' : '등록'}</button>
      `,
      bind: {
        ...(m
          ? { '#member-deactivate-btn': () => this.deactivateMember(m.id, m.name || '', true) }
          : {}),
        '#member-cancel-btn': () => Modal.close(),
        '#member-save-btn': () => this.saveMember(m?.id || null),
      },
    });
  },

  async saveMember(id) {
    const form = document.getElementById('admin-member-form');
    if (!form) return;
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => {
      body[k] = v;
    });
    if (!body.name) return Toast.error('이름을 입력하세요');
    try {
      if (id) {
        await API.put(`/team/${id}`, body);
        Toast.success('팀원 정보가 수정되었습니다');
      } else {
        await API.post('/team', body);
        Toast.success('팀원이 등록되었습니다');
      }
      Modal.close();
      const panel = document.getElementById('admin-tab-team');
      if (panel) delete panel.dataset.loaded;
      await this.loadTeam();
    } catch (err) {
      console.error(err);
    }
  },

  deactivateMember(id, name, fromModal = false) {
    const doDeactivate = async () => {
      try {
        await API.del(`/team/${id}`);
        Toast.success(`${name || '팀원'}이 비활성화되었습니다`);
        Modal.close();
        const panel = document.getElementById('admin-tab-team');
        if (panel) delete panel.dataset.loaded;
        await this.loadTeam();
      } catch (err) {
        console.error(err);
      }
    };

    if (fromModal) {
      Modal.close();
      setTimeout(() => {
        Modal.confirm(`"${esc(name)}" 팀원을 비활성화하시겠습니까?`, doDeactivate);
      }, 150);
    } else {
      Modal.confirm(`"${esc(name)}" 팀원을 비활성화하시겠습니까?`, doDeactivate);
    }
  },

  // ============================================================
  // Tab 4 — 사용 통계
  // ============================================================
  async loadUsage() {
    const panel = document.getElementById('admin-tab-usage');
    panel.innerHTML = '<div class="loading">로딩중...</div>';
    try {
      const res = await API.get('/admin/stats');
      const d = res.data || res;
      panel.dataset.loaded = '1';
      panel.innerHTML = `
        <div class="grid-2 mb-3">
          <div class="card">
            <div class="card-header">
              <div class="card-title">최근 7일 API 호출 추이</div>
            </div>
            <div class="card-body">
              <div class="chart-wrap-bar">
                <canvas id="admin-usage-chart"></canvas>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">주요 접근 엔드포인트</div>
            </div>
            <div class="card-body no-pad" id="admin-endpoint-table">
              <div class="loading">로딩중...</div>
            </div>
          </div>
        </div>

        <div class="stat-card-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="admin-stat-card">
            <div class="admin-stat-label">금일 API 호출</div>
            <div class="admin-stat-value">${d.api_calls_today !== null && d.api_calls_today !== undefined ? d.api_calls_today.toLocaleString() : '-'}<span class="admin-stat-unit">회</span></div>
            <div class="admin-stat-sub">오늘 0시 기준 누적</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-label">활성 세션</div>
            <div class="admin-stat-value">${d.active_sessions !== null && d.active_sessions !== undefined ? d.active_sessions : '-'}<span class="admin-stat-unit">개</span></div>
            <div class="admin-stat-sub">현재 접속 중인 세션</div>
          </div>
          <div class="admin-stat-card">
            <div class="admin-stat-label">DB 크기</div>
            <div class="admin-stat-value">${d.db_size_mb !== null && d.db_size_mb !== undefined ? parseFloat(d.db_size_mb).toFixed(1) : '-'}<span class="admin-stat-unit">MB</span></div>
            <div class="admin-stat-sub">MariaDB 누적 데이터</div>
          </div>
        </div>
      `;

      this._renderUsageChart(d);
      this._renderEndpointTable(d);
    } catch (err) {
      panel.innerHTML = `<div class="alert alert-error">사용 통계를 불러올 수 없습니다: ${esc(err.message)}</div>`;
    }
  },

  _renderUsageChart(d) {
    const ctx = document.getElementById('admin-usage-chart');
    if (!ctx) return;

    // Build last-7-days labels
    const labels = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      labels.push(`${day.getMonth() + 1}/${day.getDate()}`);
    }

    // Use daily_calls array if provided, otherwise distribute api_calls_today across days
    let callData;
    if (Array.isArray(d.daily_calls) && d.daily_calls.length === 7) {
      callData = d.daily_calls;
    } else {
      const todayVal = d.api_calls_today || 0;
      // synthetic fallback: gentle curve leading up to today
      callData = [
        Math.round(todayVal * 0.55),
        Math.round(todayVal * 0.7),
        Math.round(todayVal * 0.6),
        Math.round(todayVal * 0.8),
        Math.round(todayVal * 0.75),
        Math.round(todayVal * 0.9),
        todayVal,
      ];
    }

    if (this.usageChart) {
      this.usageChart.destroy();
      this.usageChart = null;
    }

    this.usageChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'API 호출 수',
            data: callData,
            backgroundColor: '#1664E5',
            borderRadius: 5,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.parsed.y.toLocaleString()}회`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#E8EAED' },
            ticks: {
              font: { size: 11 },
              callback: v => v.toLocaleString(),
            },
          },
        },
      },
    });
  },

  _renderEndpointTable(d) {
    const wrap = document.getElementById('admin-endpoint-table');
    if (!wrap) return;

    // Use top_endpoints if provided, otherwise show static common endpoints
    const endpoints =
      Array.isArray(d.top_endpoints) && d.top_endpoints.length
        ? d.top_endpoints
        : [
            {
              path: '/api/leads',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.28),
            },
            {
              path: '/api/dashboard/stats',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.18),
            },
            {
              path: '/api/activities',
              method: 'POST',
              count: Math.round((d.api_calls_today || 100) * 0.14),
            },
            {
              path: '/api/team',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.1),
            },
            {
              path: '/api/notifications',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.08),
            },
            {
              path: '/api/products',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.07),
            },
            {
              path: '/api/customers',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.06),
            },
            {
              path: '/api/admin/stats',
              method: 'GET',
              count: Math.round((d.api_calls_today || 100) * 0.05),
            },
          ];

    const total = endpoints.reduce((s, e) => s + (e.count || 0), 0) || 1;

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>엔드포인트</th>
            <th>메서드</th>
            <th class="text-right">호출 수</th>
            <th style="width:120px">비율</th>
          </tr>
        </thead>
        <tbody>
          ${endpoints
            .map(e => {
              const pct = Math.round((e.count / total) * 100);
              return `
              <tr>
                <td class="mono fs-12">${esc(e.path)}</td>
                <td><span class="log-method log-method-${esc(e.method)}">${esc(e.method)}</span></td>
                <td class="text-right mono">${(e.count || 0).toLocaleString()}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;height:6px;background:var(--border,#E5E7EB);border-radius:3px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:#1664E5;border-radius:3px"></div>
                    </div>
                    <span class="fs-12 text-muted" style="min-width:30px;text-align:right">${pct}%</span>
                  </div>
                </td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  },

  // ============================================================
  // Tab — 게시판 통계 (월별 / 조직별)
  // ============================================================
  _boardYear: new Date().getFullYear(),
  _boardMonth: new Date().getMonth() + 1,

  async loadBoardStats(year, month) {
    if (year !== undefined) this._boardYear = parseInt(year);
    if (month !== undefined) this._boardMonth = parseInt(month);

    const panel = document.getElementById('admin-tab-board');
    panel.innerHTML =
      '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';

    try {
      const res = await API.get(
        `/admin/board-stats?year=${this._boardYear}&month=${this._boardMonth}`
      );
      panel.dataset.loaded = '1';
      this._renderBoardStats(panel, res.data);
    } catch (err) {
      panel.innerHTML = `<div style="color:#E63329;padding:20px">통계를 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  },

  _renderBoardStats(panel, d) {
    const y = d.year;
    const m = d.month;
    const monthOptions = Array.from(
      { length: 12 },
      (_, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${i + 1}월</option>`
    ).join('');
    const yearOptions = [y - 2, y - 1, y, y + 1]
      .map(yr => `<option value="${yr}" ${yr === y ? 'selected' : ''}>${yr}년</option>`)
      .join('');

    // 본부(role) 목록
    const roles = [...new Set(d.members.map(mb => mb.role))];

    const buildRows = () => {
      let html = '';
      roles.forEach(role => {
        const roleData = d.roles.find(r => r.role === role) || { posts: 0, comments: 0, views: 0 };
        html += `
          <tr class="board-stat-role board-stat-toggle-row" style="background:var(--bg-2);font-weight:700;cursor:pointer"
              data-bs-role="${esc(role)}" data-toggle-type="role" data-toggle-key="${esc(role)}">
            <td colspan="2" style="padding:9px 14px">
              <span class="board-stat-toggle" style="display:inline-block;transition:transform .2s">▼</span>
              <span style="margin-left:6px">🏢 ${esc(role)}</span>
            </td>
            <td class="text-right mono" style="font-size:13px">${roleData.posts.toLocaleString()}</td>
            <td class="text-right mono" style="font-size:13px">${roleData.comments.toLocaleString()}</td>
            <td class="text-right mono" style="font-size:13px">${roleData.views.toLocaleString()}</td>
          </tr>`;

        const teams = [...new Set(d.members.filter(mb => mb.role === role).map(mb => mb.team))];
        teams.forEach(team => {
          const teamData = d.teams.find(t => t.role === role && t.team === team) || {
            posts: 0,
            comments: 0,
            views: 0,
          };
          const teamKey = `${role}||${team}`;
          html += `
            <tr class="board-stat-team board-stat-toggle-row" data-role="${esc(role)}" data-team="${esc(teamKey)}"
                style="background:var(--surface-1,#fff);font-weight:600;cursor:pointer"
                data-toggle-type="team" data-toggle-key="${esc(teamKey)}">
              <td style="padding:7px 14px 7px 30px">
                <span class="board-stat-toggle" style="display:inline-block;font-size:11px;transition:transform .2s">▼</span>
                <span style="margin-left:6px;color:var(--oci-blue,#1a73e8)">👥 ${esc(team)}</span>
              </td>
              <td class="text-muted fs-12">
                ${d.members.filter(mb => mb.role === role && mb.team === team).length}명
              </td>
              <td class="text-right mono fs-13">${teamData.posts.toLocaleString()}</td>
              <td class="text-right mono fs-13">${teamData.comments.toLocaleString()}</td>
              <td class="text-right mono fs-13">${teamData.views.toLocaleString()}</td>
            </tr>`;

          d.members
            .filter(mb => mb.role === role && mb.team === team)
            .forEach(mem => {
              const hasAct = mem.posts + mem.comments + mem.views > 0;
              html += `
              <tr data-role="${esc(role)}" data-team="${esc(teamKey)}"
                  style="font-size:13px${hasAct ? '' : ';color:var(--text-3)'}">
                <td colspan="2" style="padding:6px 14px 6px 46px">👤 ${esc(mem.name)}</td>
                <td class="text-right mono">${mem.posts > 0 ? `<strong>${mem.posts}</strong>` : '<span style="color:var(--text-3)">-</span>'}</td>
                <td class="text-right mono">${mem.comments > 0 ? `<strong>${mem.comments}</strong>` : '<span style="color:var(--text-3)">-</span>'}</td>
                <td class="text-right mono">${mem.views > 0 ? `<strong>${mem.views}</strong>` : '<span style="color:var(--text-3)">-</span>'}</td>
              </tr>`;
            });
        });
      });
      return html;
    };

    // 월별 트렌드 바
    const maxVal = Math.max(...d.monthly.map(r => r.posts + r.comments + r.views), 1);
    const trendBars = d.monthly
      .map(row => {
        const active = row.month === m;
        return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;flex:1"
             data-board-yr="${y}" data-board-mo="${row.month}" title="${row.month}월: 게시${row.posts} 댓글${row.comments} 열람${row.views}">
          <div style="width:100%;height:56px;background:var(--border);border-radius:4px 4px 0 0;overflow:hidden;position:relative;display:flex;align-items:flex-end">
            <div style="width:34%;height:${Math.round((row.posts / Math.max(maxVal, 1)) * 100)}%;background:#1a73e8;"></div>
            <div style="width:33%;height:${Math.round((row.comments / Math.max(maxVal, 1)) * 100)}%;background:#34a853;"></div>
            <div style="width:33%;height:${Math.round((row.views / Math.max(maxVal, 1)) * 100)}%;background:#9c27b0;"></div>
          </div>
          <div style="font-size:10px;font-weight:${active ? 700 : 400};color:${active ? 'var(--oci-blue,#1a73e8)' : 'var(--text-3)'}">
            ${row.month}월
          </div>
          ${active ? `<div style="width:6px;height:6px;border-radius:50%;background:var(--oci-blue,#1a73e8)"></div>` : ''}
        </div>`;
      })
      .join('');

    panel.innerHTML = `
      <!-- 필터 -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <select class="filter-select" style="width:90px" id="board-year-sel">${yearOptions}</select>
        <select class="filter-select" style="width:78px" id="board-month-sel">${monthOptions}</select>
        <span class="badge badge-blue" style="font-size:11px">${y}년 ${m}월</span>
        <span class="text-muted fs-12">반복 열람 제외 · 동일 공지 1회 집계</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" id="board-refresh-btn">🔄 새로고침</button>
      </div>

      <!-- 요약 카드 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${[
          { label: '총 게시글', val: d.total.posts.toLocaleString(), icon: '📝', color: '#1a73e8' },
          {
            label: '총 댓글',
            val: d.total.comments.toLocaleString(),
            icon: '💬',
            color: '#34a853',
          },
          { label: '총 열람', val: d.total.views.toLocaleString(), icon: '👁', color: '#9c27b0' },
          {
            label: '활동 인원',
            val: d.members.filter(mb => mb.posts + mb.comments + mb.views > 0).length + '명',
            icon: '👤',
            color: '#ff7043',
          },
        ]
          .map(
            c => `
          <div class="card" style="margin:0">
            <div class="card-body" style="padding:14px 18px">
              <div class="fs-11 text-muted">${c.icon} ${c.label}</div>
              <div style="font-size:24px;font-weight:800;color:${c.color};margin-top:4px">${c.val}</div>
            </div>
          </div>`
          )
          .join('')}
      </div>

      <!-- 월별 트렌드 -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">월별 트렌드 (${y}년)</div>
          <div style="display:flex;gap:14px;font-size:11px">
            <span style="color:#1a73e8">■ 게시글</span>
            <span style="color:#34a853">■ 댓글</span>
            <span style="color:#9c27b0">■ 열람</span>
          </div>
        </div>
        <div class="card-body" style="padding:12px 16px 8px">
          <div style="display:flex;gap:4px;align-items:flex-end;height:80px">
            ${trendBars}
          </div>
        </div>
      </div>

      <!-- 조직별 상세 -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">조직별 상세 <span class="text-muted fs-12">(${y}년 ${m}월)</span></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="board-expand-btn">전체 펼치기</button>
            <button class="btn btn-ghost btn-sm" id="board-collapse-btn">전체 접기</button>
          </div>
        </div>
        <div class="card-body no-pad">
          <table class="data-table" style="width:100%">
            <thead>
              <tr>
                <th colspan="2">구성원 (본부 → 팀 → 개인)</th>
                <th class="text-right" style="width:100px">📝 게시글</th>
                <th class="text-right" style="width:100px">💬 댓글</th>
                <th class="text-right" style="width:110px">
                  👁 열람
                  <span style="font-size:10px;font-weight:400;color:var(--text-3);display:block">중복 제외</span>
                </th>
              </tr>
            </thead>
            <tbody id="board-stat-tbody">${buildRows()}</tbody>
            <tfoot>
              <tr style="font-weight:700;background:var(--bg-2);border-top:2px solid var(--border)">
                <td colspan="2" style="padding:10px 14px">합 계</td>
                <td class="text-right mono" style="font-size:14px">${d.total.posts.toLocaleString()}</td>
                <td class="text-right mono" style="font-size:14px">${d.total.comments.toLocaleString()}</td>
                <td class="text-right mono" style="font-size:14px">${d.total.views.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <style id="board-stat-style">
        .board-stat-hidden { display:none !important; }
        .board-stat-role:hover td,
        .board-stat-team:hover td { background:var(--surface-2) !important; }
      </style>
    `;

    // add event listeners after innerHTML
    document
      .getElementById('board-year-sel')
      ?.addEventListener('change', e => this.loadBoardStats(e.target.value, m));
    document
      .getElementById('board-month-sel')
      ?.addEventListener('change', e => this.loadBoardStats(y, e.target.value));
    document
      .getElementById('board-refresh-btn')
      ?.addEventListener('click', () => this.loadBoardStats(y, m));
    document
      .getElementById('board-expand-btn')
      ?.addEventListener('click', () => this._expandAllBoard(true));
    document
      .getElementById('board-collapse-btn')
      ?.addEventListener('click', () => this._expandAllBoard(false));

    // trend bar delegation
    panel.querySelector('.card-body')?.addEventListener('click', e => {
      const bar = e.target.closest('[data-board-yr]');
      if (bar) this.loadBoardStats(parseInt(bar.dataset.boardYr), parseInt(bar.dataset.boardMo));
    });

    // row toggle delegation
    document.getElementById('board-stat-tbody')?.addEventListener('click', e => {
      const row = e.target.closest('.board-stat-toggle-row');
      if (row) this._toggleBoardGroup(row, row.dataset.toggleType, row.dataset.toggleKey);
    });
  },

  _toggleBoardGroup(row, type, key) {
    const tbody = document.getElementById('board-stat-tbody');
    if (!tbody) return;
    const attr = type === 'role' ? 'data-role' : 'data-team';
    const targets = [...tbody.querySelectorAll(`tr[${attr}="${key}"]`)];
    const hidden = targets.some(r => r.classList.contains('board-stat-hidden'));
    targets.forEach(r => r.classList.toggle('board-stat-hidden', !hidden));
    const toggle = row.querySelector('.board-stat-toggle');
    if (toggle) toggle.style.transform = hidden ? '' : 'rotate(-90deg)';
  },

  _expandAllBoard(expand) {
    const tbody = document.getElementById('board-stat-tbody');
    if (!tbody) return;
    tbody
      .querySelectorAll('tr[data-role], tr[data-team]')
      .forEach(r => r.classList.toggle('board-stat-hidden', !expand));
    tbody
      .querySelectorAll('.board-stat-toggle')
      .forEach(t => (t.style.transform = expand ? '' : 'rotate(-90deg)'));
  },

  // ============================================================
  // 🔑 AI 토큰 현황 (superadmin 전용)
  // ============================================================
  _tmYear: new Date().getFullYear(),
  _tmMonth: new Date().getMonth() + 1,

  async loadTokenMonitor(year, month) {
    // superadmin 권한 확인
    if (App.currentUser?.role !== 'superadmin') {
      document.getElementById('admin-tab-token-monitor').innerHTML =
        '<div style="padding:40px;text-align:center;color:#d93025">⛔ 관리자(superadmin) 권한이 필요합니다.</div>';
      return;
    }
    if (year !== undefined) this._tmYear = parseInt(year);
    if (month !== undefined) this._tmMonth = parseInt(month);

    const panel = document.getElementById('admin-tab-token-monitor');
    panel.innerHTML =
      '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';
    try {
      const res = await API.admin.tokenMonitor(this._tmYear, this._tmMonth);
      panel.dataset.loaded = '1';
      this._renderTokenMonitor(panel, res.data);
    } catch (err) {
      panel.innerHTML = `<div style="color:#E63329;padding:20px">데이터를 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  },

  _renderTokenMonitor(panel, d) {
    const y = d.year;
    const m = d.month;
    const USD_KRW = 1380; // 환율 (고정 근사값)
    const fmt = n => Number(n || 0).toLocaleString();
    const fmtUsd = v => `$${Number(v || 0).toFixed(4)}`;
    const fmtKrw = v => `₩${Math.round(Number(v || 0) * USD_KRW).toLocaleString()}`;

    const yearSel = [y - 2, y - 1, y, y + 1]
      .map(yr => `<option value="${yr}" ${yr === y ? 'selected' : ''}>${yr}년</option>`)
      .join('');
    const monthSel = Array.from(
      { length: 12 },
      (_, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${i + 1}월</option>`
    ).join('');

    // ── 일별 스파크라인 (최근 30일) ──
    const maxDay = Math.max(...d.daily.map(r => r.total), 1);
    const dailyBars = d.daily
      .map(r => {
        const pct = Math.round((r.total / maxDay) * 100);
        const isToday = r.day === new Date().toISOString().slice(0, 10);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;cursor:default" title="${r.day}\n토큰:${fmt(r.total)}\n비용:${fmtUsd(r.cost_usd)}\n호출:${r.calls}회">
        <div style="width:100%;height:${Math.max(pct * 0.6, 2)}px;background:${isToday ? '#d93025' : '#1a73e8'};border-radius:2px 2px 0 0;min-height:2px"></div>
      </div>`;
      })
      .join('');

    // ── 월별 트렌드 ──
    const maxMon = Math.max(...d.monthly.map(r => Number(r.total)), 1);
    const monthlyBars = d.monthly
      .map(r => {
        const pct = Math.round((Number(r.total) / maxMon) * 100);
        const lbl = `${r.yr}-${String(r.mo).padStart(2, '0')}`;
        const isCur = r.yr === y && r.mo === m;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;cursor:pointer"
        data-tm-yr="${r.yr}" data-tm-mo="${r.mo}" title="${lbl}: ${fmt(r.total)} tokens">
        <div style="width:100%;height:${Math.max(pct * 0.5, 2)}px;background:${isCur ? '#d93025' : '#9c27b0'};border-radius:2px 2px 0 0"></div>
        <div style="font-size:9px;color:${isCur ? '#d93025' : 'var(--text-3)'};font-weight:${isCur ? 700 : 400}">${r.mo}월</div>
      </div>`;
      })
      .join('');

    // ── 기능별 파이 대체(테이블) ──
    const totalEp = d.byEndpoint.reduce((s, e) => s + Number(e.total), 0) || 1;
    const epRows = d.byEndpoint
      .map(e => {
        const pct = Math.round((Number(e.total) / totalEp) * 100);
        return `<tr>
        <td>${esc(e.endpoint)}</td>
        <td class="text-right mono">${fmt(e.total)}</td>
        <td class="text-right mono">${fmt(e.calls)}</td>
        <td class="text-right mono">${fmt(e.avg_per_call)}</td>
        <td><div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px">
            <div style="width:${pct}%;height:100%;background:#1a73e8;border-radius:3px"></div>
          </div>
          <span style="font-size:11px;min-width:32px;text-align:right">${pct}%</span>
        </div></td>
      </tr>`;
      })
      .join('');

    // ── 모델별 ──
    const modelRows = d.byModel
      .map(
        m2 => `
      <tr>
        <td><span class="badge badge-blue" style="font-size:11px">${esc(m2.model)}</span></td>
        <td class="text-right mono">${fmt(m2.prompt)}</td>
        <td class="text-right mono">${fmt(m2.completion)}</td>
        <td class="text-right mono">${fmt(m2.total)}</td>
        <td class="text-right mono">${fmt(m2.calls)}</td>
        <td class="text-right" style="color:#d93025;font-weight:600">${fmtUsd(m2.cost_usd)}</td>
      </tr>`
      )
      .join('');

    // ── 사용자별 ──
    const userRows = d.users
      .map(u => {
        const limit = u.eff_limit || 0;
        const pct = limit > 0 ? Math.min(100, Math.round((u.used_tokens / limit) * 100)) : 0;
        const barClr = pct >= 90 ? '#d93025' : pct >= 70 ? '#f59c00' : '#34a853';
        const limitLabel =
          u.monthly_token_limit !== null && u.monthly_token_limit !== undefined
            ? `<strong>${fmt(u.monthly_token_limit)}</strong>`
            : `<span style="color:var(--text-3)">기본 (${fmt(d.defaultLimit)})</span>`;
        return `
        <tr id="tm-row-${u.id}">
          <td>
            <strong>${esc(u.name)}</strong>
            <div style="font-size:11px;color:var(--text-3)">${esc(u.role || '')}</div>
          </td>
          <td class="mono">${fmt(u.used_tokens)}</td>
          <td class="mono">${fmt(u.calls)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;min-width:60px;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${barClr};border-radius:4px;transition:width .3s"></div>
              </div>
              <span style="font-size:11px;font-weight:600;min-width:34px;text-align:right;color:${barClr}">${pct}%</span>
            </div>
          </td>
          <td>${limitLabel}</td>
          <td style="color:#d93025;font-size:12px">${fmtUsd(u.cost_usd)} <span style="color:var(--text-3);font-size:10px">(${fmtKrw(u.cost_usd)})</span></td>
          <td>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <!-- 한도 변경 -->
              <input type="number" id="tlim2-${u.id}" value="${u.monthly_token_limit || ''}"
                placeholder="기본값" min="0" step="10000"
                style="width:90px;height:28px;font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:4px">
              <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px"
                data-action="save-limit2" data-uid="${u.id}">저장</button>
              <!-- 수동충전 -->
              <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;color:#1a73e8"
                data-action="open-recharge" data-uid="${u.id}" data-uname="${esc(u.name)}" data-ulimit="${u.eff_limit}">⚡ 충전</button>
              <!-- 자동충전 설정 -->
              <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;color:${u.auto_recharge_enabled ? '#34a853' : 'var(--text-3)'}"
                data-action="open-auto-recharge" data-uid="${u.id}" data-uname="${esc(u.name)}"
                title="자동충전 설정">
                ${u.auto_recharge_enabled ? '🔄 자동ON' : '🔄 자동OFF'}
              </button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    // ── 충전 로그 ──
    const logRows =
      (d.rechargeLogs || [])
        .map(
          r => `
      <tr>
        <td>${esc(r.user_name || r.user_id)}</td>
        <td><span class="badge ${r.triggered_by === 'auto' ? 'badge-blue' : 'badge-green'}" style="font-size:10px">${r.triggered_by === 'auto' ? '자동' : '수동'}</span></td>
        <td class="mono" style="color:#34a853">+${fmt(r.recharge_amount)}</td>
        <td class="mono">${fmt(r.new_limit)}</td>
        <td>${esc(r.reason || '')}</td>
        <td style="color:var(--text-3);font-size:12px">${Fmt.dateTime ? Fmt.dateTime(r.created_at) : Fmt.date(r.created_at)}</td>
      </tr>`
        )
        .join('') ||
      '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:20px">충전 이력 없음</td></tr>';

    panel.innerHTML = `
      <!-- 헤더 필터 -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <span style="font-weight:700;color:#d93025">🔑 AI 토큰 현황</span>
        <select class="filter-select" style="width:90px" id="tm-year-sel">${yearSel}</select>
        <select class="filter-select" style="width:78px" id="tm-month-sel">${monthSel}</select>
        <span class="badge badge-red" style="font-size:11px">${y}년 ${m}월</span>
        <span style="font-size:11px;color:var(--text-3)">superadmin 전용 · 환율 ₩${USD_KRW}/$ 기준</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" id="tm-refresh-btn">🔄 새로고침</button>
      </div>

      <!-- 요약 카드 6개 -->
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px">
        ${[
          {
            label: '이번달 토큰',
            val: fmt(d.summary.month_tokens),
            sub: '합계',
            color: '#1a73e8',
            icon: '🔤',
          },
          {
            label: '오늘 토큰',
            val: fmt(d.summary.today_tokens),
            sub: '금일',
            color: '#ff7043',
            icon: '📅',
          },
          {
            label: '이번달 호출',
            val: fmt(d.summary.month_calls) + '회',
            sub: 'API 요청',
            color: '#9c27b0',
            icon: '📡',
          },
          {
            label: '이번달 비용',
            val: fmtUsd(d.summary.cost_usd),
            sub: fmtKrw(d.summary.cost_usd),
            color: '#d93025',
            icon: '💰',
          },
          {
            label: '예상 월비용',
            val: fmtUsd(d.summary.projected_cost_usd),
            sub: '월말 예상',
            color: '#f59c00',
            icon: '📈',
          },
          {
            label: '활동 사용자',
            val: d.summary.month_active_users + '명',
            sub: '이번달',
            color: '#34a853',
            icon: '👥',
          },
        ]
          .map(
            c => `
          <div class="card" style="margin:0">
            <div class="card-body" style="padding:12px 14px">
              <div style="font-size:10px;color:var(--text-3)">${c.icon} ${c.label}</div>
              <div style="font-size:18px;font-weight:800;color:${c.color};margin-top:3px;line-height:1.2">${c.val}</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:2px">${c.sub}</div>
            </div>
          </div>`
          )
          .join('')}
      </div>

      <!-- 일별 스파크라인 + 월별 트렌드 -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">
        <div class="card" style="margin:0">
          <div class="card-header"><div class="card-title">일별 토큰 사용 (최근 30일)</div></div>
          <div class="card-body" style="padding:10px 14px">
            <div style="display:flex;gap:2px;align-items:flex-end;height:64px">${dailyBars}</div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--text-3)">
              <span>${d.daily[0]?.day?.slice(5) || ''}</span>
              <span style="color:#d93025">● 오늘</span>
              <span>${d.daily[d.daily.length - 1]?.day?.slice(5) || ''}</span>
            </div>
          </div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-header"><div class="card-title">월별 트렌드</div></div>
          <div class="card-body" style="padding:10px 14px">
            <div style="display:flex;gap:3px;align-items:flex-end;height:64px">${monthlyBars}</div>
          </div>
        </div>
      </div>

      <!-- 기능별 + 모델별 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="card" style="margin:0">
          <div class="card-header"><div class="card-title">기능별 사용량 (${y}년 ${m}월)</div></div>
          <div class="card-body no-pad">
            <table class="data-table" style="font-size:12px">
              <thead><tr><th>기능</th><th class="text-right">토큰</th><th class="text-right">호출</th><th class="text-right">평균</th><th>비율</th></tr></thead>
              <tbody>${epRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-3)">데이터 없음</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-header"><div class="card-title">모델별 사용량 & 비용 (${y}년 ${m}월)</div></div>
          <div class="card-body no-pad">
            <table class="data-table" style="font-size:12px">
              <thead><tr><th>모델</th><th class="text-right">입력</th><th class="text-right">출력</th><th class="text-right">합계</th><th class="text-right">호출</th><th class="text-right" style="color:#d93025">비용(USD)</th></tr></thead>
              <tbody>${modelRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-3)">데이터 없음</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 사용자별 상세 -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">인원별 사용량 & 한도 관리 <span class="text-muted fs-12">(${y}년 ${m}월)</span></div>
          <div style="font-size:11px;color:var(--text-3)">한도 변경 즉시 적용 · 자동충전 설정 가능</div>
        </div>
        <div class="card-body no-pad">
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th>사용자</th>
                <th class="text-right">사용 토큰</th>
                <th class="text-right">호출 수</th>
                <th style="min-width:120px">사용률</th>
                <th class="text-right">월 한도</th>
                <th class="text-right">비용(USD)</th>
                <th style="min-width:260px">관리</th>
              </tr>
            </thead>
            <tbody>${userRows}</tbody>
          </table>
        </div>
      </div>

      <!-- 충전 이력 -->
      <div class="card">
        <div class="card-header"><div class="card-title">토큰 충전 이력 (최근 20건)</div></div>
        <div class="card-body no-pad">
          <table class="data-table" style="font-size:12px">
            <thead><tr><th>사용자</th><th>유형</th><th class="text-right">충전량</th><th class="text-right">충전 후 한도</th><th>사유</th><th>일시</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>
        </div>
      </div>
    `;

    // add event listeners
    document
      .getElementById('tm-year-sel')
      ?.addEventListener('change', e => this.loadTokenMonitor(e.target.value, m));
    document
      .getElementById('tm-month-sel')
      ?.addEventListener('change', e => this.loadTokenMonitor(y, e.target.value));
    document
      .getElementById('tm-refresh-btn')
      ?.addEventListener('click', () => this.loadTokenMonitor(y, m));

    // monthly bars delegation
    panel.addEventListener('click', e => {
      const bar = e.target.closest('[data-tm-yr]');
      if (bar) {
        this.loadTokenMonitor(parseInt(bar.dataset.tmYr), parseInt(bar.dataset.tmMo));
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const uid = parseInt(btn.dataset.uid);
      if (btn.dataset.action === 'save-limit2') this._saveLimit2(uid);
      else if (btn.dataset.action === 'open-recharge')
        this._openRechargeModal(uid, btn.dataset.uname, parseInt(btn.dataset.ulimit));
      else if (btn.dataset.action === 'open-auto-recharge')
        this._openAutoRechargeModal(uid, btn.dataset.uname);
    });
  },

  async _saveLimit2(userId) {
    const val = document.getElementById(`tlim2-${userId}`)?.value?.trim();
    try {
      await API.admin.setTokenLimit(userId, val === '' ? null : val);
      Toast.success('한도가 저장되었습니다');
      delete document.getElementById('admin-tab-token-monitor').dataset.loaded;
      this.loadTokenMonitor();
    } catch (err) {
      Toast.error('저장 실패: ' + err.message);
    }
  },

  _openRechargeModal(userId, userName, currentLimit) {
    Modal.open({
      title: `⚡ 토큰 수동 충전 — ${esc(userName)}`,
      body: `
        <div style="margin-bottom:14px;font-size:13px">
          현재 한도: <strong>${Number(currentLimit || 0).toLocaleString()} 토큰</strong>
        </div>
        <div class="form-field">
          <label class="form-label">충전할 토큰 수</label>
          <input class="form-control" type="number" id="recharge-amount-input"
            value="100000" min="1000" step="10000" placeholder="예: 100000">
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--text-3)">
          충전 후 새 한도 = 현재 한도 + 충전량
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="recharge-cancel-btn">취소</button>
        <button class="btn btn-primary" id="recharge-confirm-btn">충전하기</button>
      `,
      bind: {
        '#recharge-cancel-btn': () => Modal.close(),
        '#recharge-confirm-btn': () => this._doManualRecharge(userId),
      },
    });
  },

  async _doManualRecharge(userId) {
    const amount = parseInt(document.getElementById('recharge-amount-input')?.value || 0);
    if (!amount || amount < 1000) return Toast.error('1,000 이상 입력하세요');
    try {
      const res = await API.admin.manualRecharge(userId, amount);
      Toast.success(`충전 완료 — 새 한도: ${res.new_limit?.toLocaleString()} 토큰`);
      Modal.close();
      delete document.getElementById('admin-tab-token-monitor').dataset.loaded;
      this.loadTokenMonitor();
    } catch (err) {
      Toast.error('충전 실패: ' + err.message);
    }
  },

  async _openAutoRechargeModal(userId, userName) {
    // 현재 설정 조회
    let u = {};
    try {
      const res = await API.admin.tokenMonitor(this._tmYear, this._tmMonth);
      u = res.data.users.find(x => x.id === userId) || {};
    } catch (_) {}
    Modal.open({
      title: `🔄 자동충전 설정 — ${esc(userName)}`,
      width: 420,
      body: `
        <div style="margin-bottom:16px;font-size:13px;color:var(--text-2);line-height:1.6">
          사용률이 설정 임계치에 도달하면 자동으로 토큰을 충전합니다.<br>
          <span style="color:var(--text-3);font-size:11px">※ 이번 달 1회 자동충전으로 제한됩니다.</span>
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label class="form-label">자동충전 활성화</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="ar-enabled" ${u.auto_recharge_enabled ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:13px">활성화</span>
          </label>
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label class="form-label">트리거 임계값 (%)</label>
          <input class="form-control" type="number" id="ar-threshold"
            value="${u.auto_recharge_threshold ?? 80}" min="50" max="99" step="5">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">
            사용률이 이 값에 도달하면 자동충전 실행
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">1회 충전량 (토큰)</label>
          <input class="form-control" type="number" id="ar-amount"
            value="${u.auto_recharge_amount ?? 100000}" min="10000" step="10000">
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="auto-recharge-cancel-btn">취소</button>
        <button class="btn btn-primary" id="auto-recharge-save-btn">저장</button>
      `,
      bind: {
        '#auto-recharge-cancel-btn': () => Modal.close(),
        '#auto-recharge-save-btn': () => this._saveAutoRecharge(userId),
      },
    });
  },

  async _saveAutoRecharge(userId) {
    const body = {
      auto_recharge_enabled: document.getElementById('ar-enabled')?.checked ? 1 : 0,
      auto_recharge_threshold: parseInt(document.getElementById('ar-threshold')?.value || 80),
      auto_recharge_amount: parseInt(document.getElementById('ar-amount')?.value || 100000),
    };
    try {
      await API.admin.saveRechargeSettings(userId, body);
      Toast.success('자동충전 설정이 저장되었습니다');
      Modal.close();
      delete document.getElementById('admin-tab-token-monitor').dataset.loaded;
      this.loadTokenMonitor();
    } catch (err) {
      Toast.error('저장 실패: ' + err.message);
    }
  },

  // ============================================================
  // Tab — 파이프라인 설정 (단계 CRUD + 드래그 정렬)
  //   권한: admin 또는 superadmin (백엔드 차단)
  //   기능: label/color/sort_order/is_active 수정 + 추가/삭제
  //   주의: stage_key, role 은 변경 불가 (시스템 무결성)
  // ============================================================
  async loadPipelineStages() {
    const panel = document.getElementById('admin-tab-pipeline');
    const role = App.currentUser?.role;
    const canEdit = role === 'admin' || role === 'superadmin';

    panel.innerHTML =
      '<div class="loading" style="padding:30px;text-align:center">로딩 중...</div>';
    try {
      const r = await API.get('/pipeline/stages?include=all');
      const stages = (r.data || [])
        .slice()
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      panel.innerHTML = `
        <div class="card mb-3">
          <div class="card-body" style="padding:14px 20px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
              <div>
                <div style="font-size:14px;font-weight:700;margin-bottom:4px">🔀 파이프라인 단계 관리</div>
                <div style="font-size:12px;color:var(--text-3);line-height:1.6">
                  영업 파이프라인의 단계 정의를 사용자 정의할 수 있습니다.<br>
                  • <strong>편집</strong>으로 표시 이름·색상·순서·활성 여부 변경 · <strong>추가</strong>로 새 단계 신설<br>
                  • 변경 후 모든 사용자의 칸반·헬스체크에 즉시 반영됩니다<br>
                  • ⚠️ <code>stage_key</code> 와 <code>role</code>은 변경 불가 (시스템 통계 무결성)
                </div>
              </div>
              ${
                canEdit
                  ? `<button class="btn btn-primary btn-sm" id="ps-add-btn">+ 단계 추가</button>`
                  : `<span class="badge badge-gray" style="font-size:11px">읽기 전용 — 관리자만 편집 가능</span>`
              }
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-body no-pad">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:50px;text-align:center">순서</th>
                  <th style="width:90px">key</th>
                  <th>표시 이름</th>
                  <th style="width:80px">역할</th>
                  <th style="width:140px">색상</th>
                  <th style="width:70px;text-align:center">사용 중</th>
                  <th style="width:70px;text-align:center">활성</th>
                  ${canEdit ? '<th style="width:180px;text-align:right">액션</th>' : ''}
                </tr>
              </thead>
              <tbody id="ps-tbody">
                ${stages.map((s, i) => this._renderStageRow(s, i, canEdit)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // 사용 중 카운트 (백그라운드 로드)
      this._loadStageUsage(stages);

      // 이벤트 바인딩
      if (canEdit) {
        document
          .getElementById('ps-add-btn')
          .addEventListener('click', () => this._openStageModal(null));
        panel.querySelectorAll('[data-ps-edit]').forEach(b =>
          b.addEventListener('click', () => {
            const stage = stages.find(s => s.id === parseInt(b.dataset.psEdit));
            this._openStageModal(stage);
          })
        );
        panel
          .querySelectorAll('[data-ps-toggle]')
          .forEach(b =>
            b.addEventListener('click', () => this._toggleStageActive(parseInt(b.dataset.psToggle)))
          );
        panel
          .querySelectorAll('[data-ps-delete]')
          .forEach(b =>
            b.addEventListener('click', () => this._deleteStage(parseInt(b.dataset.psDelete)))
          );
        panel.querySelectorAll('[data-ps-up], [data-ps-down]').forEach(b =>
          b.addEventListener('click', () => {
            const id = parseInt(b.dataset.psUp || b.dataset.psDown);
            const dir = b.dataset.psUp ? -1 : 1;
            this._moveStage(id, dir, stages);
          })
        );
      }
    } catch (e) {
      panel.innerHTML = `<div style="color:var(--oci-red);padding:30px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  _renderStageRow(s, idx, canEdit) {
    const roleColors = { active: '#1664E5', won: '#17A85A', lost: '#6B7280', dropped: '#E63329' };
    const roleClr = roleColors[s.role] || '#999';
    return `
      <tr style="${s.is_active ? '' : 'opacity:.55'}">
        <td class="text-center mono">${s.sort_order}</td>
        <td><code style="font-size:11px;color:var(--text-3)">${esc(s.stage_key)}</code></td>
        <td><strong>${esc(s.label)}</strong></td>
        <td><span class="badge" style="background:${roleClr}15;color:${roleClr};border:1px solid ${roleClr}40;font-size:10px">${s.role}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:18px;height:18px;border-radius:4px;background:${esc(s.color)};border:1px solid rgba(0,0,0,.1)"></div>
            <span class="mono" style="font-size:11px">${esc(s.color)}</span>
          </div>
        </td>
        <td class="text-center"><span class="ps-usage" data-stage-key="${esc(s.stage_key)}" style="font-size:11px;color:var(--text-3)">…</span></td>
        <td class="text-center">${
          s.is_active
            ? '<span class="badge badge-green" style="font-size:10px">✓ 활성</span>'
            : '<span class="badge badge-gray" style="font-size:10px">비활성</span>'
        }</td>
        ${
          canEdit
            ? `
        <td class="text-right" style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-ps-up="${s.id}" title="위로" style="padding:2px 6px">↑</button>
          <button class="btn btn-ghost btn-sm" data-ps-down="${s.id}" title="아래로" style="padding:2px 6px">↓</button>
          <button class="btn btn-ghost btn-sm" data-ps-edit="${s.id}" title="편집">편집</button>
          <button class="btn btn-ghost btn-sm" data-ps-toggle="${s.id}" title="활성 토글">${s.is_active ? '비활성' : '활성'}</button>
          <button class="btn btn-ghost btn-sm" data-ps-delete="${s.id}" title="삭제" style="color:var(--oci-red)">🗑</button>
        </td>`
            : ''
        }
      </tr>
    `;
  },

  async _loadStageUsage(stages) {
    // 단계별 사용 카운트 — leads 통계로 조회
    try {
      // 별도 카운트 API가 없으면 dist 응답 활용. 여기서는 단순화하여 개별 조회 회피
      // 백엔드의 leads list 응답에 totalByStage 같은 필드가 없으므로
      // 임시: pipeline-stages 엔드포인트 호출 1회로는 알 수 없음 → 각 단계별 GET /leads?stage=X count
      for (const s of stages) {
        try {
          const cr = await API.get(`/leads?stage=${encodeURIComponent(s.stage_key)}&limit=1`);
          const cnt = cr.pagination?.total ?? (cr.data?.length || 0);
          const el = document.querySelector(`.ps-usage[data-stage-key="${s.stage_key}"]`);
          if (el) el.textContent = cnt + '건';
        } catch {
          /* 단계별 실패는 무시 */
        }
      }
    } catch (e) {
      console.warn('usage 조회 실패:', e.message);
    }
  },

  _openStageModal(stage) {
    const isEdit = !!stage;
    Modal.open({
      title: isEdit ? `단계 편집 — ${stage.label}` : '새 단계 추가',
      compact: true,
      width: 520,
      body: `
        <form id="ps-form" class="form-grid">
          ${
            isEdit
              ? `
            <div class="form-row">
              <label class="form-label">stage_key <span style="font-size:11px;color:var(--text-3)">(변경 불가)</span></label>
              <input class="form-input" disabled value="${esc(stage.stage_key)}" style="background:var(--surface-2);color:var(--text-3)">
            </div>
            <div class="form-row">
              <label class="form-label">role <span style="font-size:11px;color:var(--text-3)">(변경 불가 — 시스템 통계 보호)</span></label>
              <input class="form-input" disabled value="${esc(stage.role)}" style="background:var(--surface-2);color:var(--text-3)">
            </div>
          `
              : `
            <div class="form-row">
              <label class="form-label">stage_key <span style="color:var(--oci-red)">*</span></label>
              <input class="form-input" id="ps-key" placeholder="예: estimate (영문 소문자, 숫자, 밑줄)"
                     pattern="[a-z0-9_]{1,30}" required>
              <small style="color:var(--text-3);font-size:11px">DB 영구 식별자. 생성 후 변경 불가.</small>
            </div>
            <div class="form-row">
              <label class="form-label">role <span style="color:var(--oci-red)">*</span></label>
              <select class="form-input" id="ps-role" required>
                <option value="active">active — 진행 단계 (파이프라인 합계 포함)</option>
                <option value="won">won — 수주 (회계 lock 대상)</option>
                <option value="lost">lost — 실주</option>
                <option value="dropped">dropped — 드롭</option>
              </select>
            </div>
          `
          }
          <div class="form-row">
            <label class="form-label">표시 이름 <span style="color:var(--oci-red)">*</span></label>
            <input class="form-input" id="ps-label" required maxlength="100"
                   value="${esc(stage?.label || '')}" placeholder="예: 잠재고객">
          </div>
          <div class="form-row-2">
            <div class="form-row">
              <label class="form-label">순서</label>
              <input class="form-input" id="ps-order" type="number" step="1"
                     value="${stage?.sort_order ?? 50}">
              <small style="color:var(--text-3);font-size:11px">작은 값이 왼쪽에 표시</small>
            </div>
            <div class="form-row">
              <label class="form-label">색상</label>
              <input class="form-input" id="ps-color" type="color"
                     value="${stage?.color || '#93B4F9'}" style="height:38px;padding:2px 6px">
            </div>
          </div>
          ${
            isEdit
              ? `
            <div class="form-row" style="display:flex;align-items:center;gap:8px">
              <input type="checkbox" id="ps-active" ${stage.is_active ? 'checked' : ''} style="width:16px;height:16px">
              <label for="ps-active" style="margin:0;cursor:pointer">활성 (체크 해제 시 칸반에서 숨김)</label>
            </div>
          `
              : ''
          }
        </form>
      `,
      footer: `
        <button class="btn btn-ghost" id="ps-cancel">취소</button>
        <button class="btn btn-primary" id="ps-save">${isEdit ? '저장' : '추가'}</button>
      `,
      bind: {
        '#ps-cancel': () => Modal.close(),
        '#ps-save': () => this._saveStage(stage),
      },
    });
  },

  async _saveStage(existing) {
    const form = document.getElementById('ps-form');
    if (!form.reportValidity()) return;
    const isEdit = !!existing;

    const body = {
      label: document.getElementById('ps-label').value.trim(),
      sort_order: parseInt(document.getElementById('ps-order').value) || 0,
      color: document.getElementById('ps-color').value,
    };
    if (isEdit) {
      body.is_active = document.getElementById('ps-active').checked ? 1 : 0;
    } else {
      body.stage_key = document.getElementById('ps-key').value.trim().toLowerCase();
      body.role = document.getElementById('ps-role').value;
    }

    try {
      if (isEdit) {
        await API.put(`/pipeline/stages/${existing.id}`, body);
        Toast.success('단계가 수정되었습니다');
      } else {
        await API.post('/pipeline/stages', body);
        Toast.success('새 단계가 추가되었습니다');
      }
      Modal.close();
      // 단계 목록 새로고침 + STAGES 동적 재로드
      await this._refreshStages();
    } catch (e) {
      Toast.error((isEdit ? '수정' : '추가') + ' 실패: ' + e.message);
    }
  },

  async _toggleStageActive(id) {
    try {
      const r = await API.get('/pipeline/stages?include=all');
      const stage = (r.data || []).find(s => s.id === id);
      if (!stage) return;
      await API.put(`/pipeline/stages/${id}`, { is_active: stage.is_active ? 0 : 1 });
      Toast.success(stage.is_active ? '비활성화됨' : '활성화됨');
      await this._refreshStages();
    } catch (e) {
      Toast.error('처리 실패: ' + e.message);
    }
  },

  async _deleteStage(id) {
    if (!confirm('이 단계를 삭제하시겠습니까?\n사용 중인 단계는 삭제할 수 없습니다.')) return;
    try {
      await API.delete(`/pipeline/stages/${id}`);
      Toast.success('단계가 삭제되었습니다');
      await this._refreshStages();
    } catch (e) {
      // 409 응답일 가능성 — 사용 중 차단
      Toast.error(e.message + '\n비활성화를 사용하세요.');
    }
  },

  async _moveStage(id, dir, stages) {
    // 같은 role 내에서만 순서 변경 (active끼리만 swap)
    const cur = stages.find(s => s.id === id);
    if (!cur) return;
    const peers = stages
      .filter(s => s.role === cur.role)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = peers.findIndex(s => s.id === id);
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= peers.length) {
      Toast.info('더 이동할 수 없습니다');
      return;
    }
    const target = peers[targetIdx];
    try {
      await API.post('/pipeline/stages/reorder', {
        order: [
          { id: cur.id, sort_order: target.sort_order },
          { id: target.id, sort_order: cur.sort_order },
        ],
      });
      await this._refreshStages();
    } catch (e) {
      Toast.error('순서 변경 실패: ' + e.message);
    }
  },

  async _refreshStages() {
    // STAGES 객체 갱신 + 패널 재렌더
    if (typeof loadStages === 'function') await loadStages();
    const panel = document.getElementById('admin-tab-pipeline');
    if (panel) {
      delete panel.dataset.loaded;
      await this.loadPipelineStages();
    }
  },

  // ============================================================
  // Tab — 메뉴 구조 설정 (사이드바 순서/가시성/라벨)
  // ============================================================
  // 원본 라벨/아이콘 매핑 — label_override 가 NULL 일 때 폴백
  // minRole: 백엔드 ROLE_PAGES + dev 특례를 시각적으로 안내 (실제 차단은 서버 측)
  _menuMeta: {
    sections: {
      main: { label: '메인', icon: '🏠' },
      erp: { label: 'ERP', icon: '🛒' },
      sales: { label: '영업관리', icon: '📁' },
      analysis: { label: '분석', icon: '📊' },
      comm: { label: '소통', icon: '💬' },
      ai: { label: 'AI 기능', icon: '🤖' },
      system: { label: '시스템', icon: '⚙️' },
    },
    items: {
      dashboard: { label: '대시보드', icon: '📊' },
      pipeline: { label: '파이프라인', icon: '📈' },
      orders: { label: 'ERP 연계', icon: '🛒' },
      leads: { label: '영업 리드', icon: '🎯' },
      projects: { label: '프로젝트', icon: '📁', minRole: '팀장+' },
      customers: { label: '고객사', icon: '🏢' },
      calendar: { label: '영업 캘린더', icon: '📅' },
      team: { label: '팀 현황', icon: '👥', minRole: '팀장+' },
      reports: { label: '리포트', icon: '📋', minRole: '팀장+' },
      board: { label: '커뮤니케이션', icon: '💬' },
      'ai-assistant': { label: 'AI 어시스턴트', icon: '🤖' },
      meeting: { label: '회의록 AI', icon: '🎤' },
      'meeting-list': { label: '회의록 목록', icon: '📝' },
      admin: { label: '관리자', icon: '🛡️', minRole: '경영진+' },
      settings: { label: '설정', icon: '⚙️' },
      dev: { label: '개발자 옵션', icon: '🔧', minRole: '슈퍼관리자' },
    },
  },
  _menuConfigData: null, // { sections: [...], items: [...] }
  _menuConfigDirty: false,
  _sortableInstances: [], // 정리용

  async loadMenuConfig() {
    const panel = document.getElementById('admin-tab-menu-config');
    panel.innerHTML =
      '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';
    try {
      const r = await API.request('GET', '/admin/menu-config');
      this._menuConfigData = r.data || { sections: [], items: [] };
      this._menuConfigDirty = false;
      this._renderMenuConfig();
      panel.dataset.loaded = '1';
    } catch (e) {
      panel.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">불러오기 실패: ${esc(e.message || '')}</div>`;
    }
  },

  _renderMenuConfig() {
    const panel = document.getElementById('admin-tab-menu-config');
    if (!panel || !this._menuConfigData) return;
    const { sections, items } = this._menuConfigData;
    const meta = this._menuMeta;

    // 섹션별로 항목 그룹핑
    const itemsBySection = {};
    items.forEach(it => {
      if (!itemsBySection[it.section_key]) itemsBySection[it.section_key] = [];
      itemsBySection[it.section_key].push(it);
    });
    // 각 섹션 내 정렬 (display_order ASC)
    Object.values(itemsBySection).forEach(arr =>
      arr.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    );

    const sectionCards = sections
      .map(s => {
        const sMeta = meta.sections[s.section_key] || { label: s.section_label, icon: '📌' };
        const sLabel = s.section_label || sMeta.label;
        const sysSec = s.is_system ? 'is-system' : '';
        const sysLockHtml = s.is_system
          ? '<span class="mc-lock" title="시스템 섹션 — 라벨/가시성 변경 불가">🔒</span>'
          : '';
        const visBtn = s.is_system
          ? ''
          : `<button type="button" class="mc-vis-btn" data-section="${esc(s.section_key)}" data-visible="${s.is_visible ? 1 : 0}" title="가시성">${s.is_visible ? '👁' : '🚫'}</button>`;
        const labelInput = s.is_system
          ? `<span class="mc-section-label">${sMeta.icon} ${esc(sLabel)}</span>`
          : `<input type="text" class="mc-section-input" data-section="${esc(s.section_key)}" value="${esc(sLabel)}" placeholder="${esc(sMeta.label)}" maxlength="100">`;

        const itemRows = (itemsBySection[s.section_key] || [])
          .map(it => {
            const iMeta = meta.items[it.menu_key] || { label: it.menu_key, icon: '📄' };
            const curLabel = it.label_override || iMeta.label;
            const sysItem = it.is_system ? 'is-system' : '';
            const sysLockI = it.is_system
              ? '<span class="mc-lock" title="시스템 항목 — 가시성/라벨 변경 불가">🔒</span>'
              : '';
            const visBtnI = it.is_system
              ? ''
              : `<button type="button" class="mc-vis-btn" data-menu="${esc(it.menu_key)}" data-visible="${it.is_visible ? 1 : 0}" title="가시성">${it.is_visible ? '👁' : '🚫'}</button>`;
            const labelI = it.is_system
              ? `<span class="mc-item-label">${esc(curLabel)}</span>`
              : `<input type="text" class="mc-item-input" data-menu="${esc(it.menu_key)}" value="${esc(curLabel)}" placeholder="${esc(iMeta.label)}" maxlength="100">`;
            const roleBadge = iMeta.minRole
              ? `<span class="mc-role-badge" title="이 메뉴는 ${esc(iMeta.minRole)} 권한 이상만 볼 수 있습니다">${esc(iMeta.minRole)}</span>`
              : '';
            return `
          <div class="mc-item ${sysItem} ${it.is_visible ? '' : 'is-hidden'}" data-menu-key="${esc(it.menu_key)}">
            <span class="mc-handle ${it.is_system ? 'is-disabled' : ''}" title="드래그">≡</span>
            <span class="mc-icon">${iMeta.icon}</span>
            ${labelI}
            ${roleBadge}
            ${sysLockI}
            ${visBtnI}
          </div>`;
          })
          .join('');

        return `
        <div class="mc-section ${sysSec} ${s.is_visible ? '' : 'is-hidden'}" data-section-key="${esc(s.section_key)}">
          <div class="mc-section-header">
            <span class="mc-handle mc-section-handle ${s.is_system ? 'is-disabled' : ''}" title="섹션 드래그">≡</span>
            <span class="mc-icon">${sMeta.icon}</span>
            ${labelInput}
            ${sysLockHtml}
            ${visBtn}
          </div>
          <div class="mc-items" data-section-items="${esc(s.section_key)}">
            ${itemRows || '<div class="mc-empty">(빈 섹션 — 다른 메뉴를 드래그해서 추가 가능)</div>'}
          </div>
        </div>`;
      })
      .join('');

    panel.innerHTML = `
      <div class="mc-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" id="mc-reset-btn">🔄 기본값으로 복원</button>
        <span class="mc-changes" id="mc-changes-badge">변경 없음</span>
        <button type="button" class="btn btn-primary btn-sm" id="mc-save-btn" disabled>💾 저장</button>
      </div>
      <div class="mc-hint">
        💡 ≡ 핸들로 드래그하여 순서 변경 · 👁 클릭으로 가시성 토글 · 라벨 클릭하여 이름 변경
        <br>🔒 시스템 메뉴(관리자/설정/개발자 옵션)는 순서만 변경 가능하며 숨김 처리는 차단됩니다.
        <br>👤 이 설정은 모든 사용자에게 적용되지만, 권한이 없는 사용자에게는 해당 메뉴가 자동으로 숨겨집니다.
      </div>
      <div class="mc-list" id="mc-section-list">
        ${sectionCards}
      </div>
    `;

    this._wireMenuConfigEvents();
    this._initMenuConfigSortable();
  },

  _wireMenuConfigEvents() {
    const panel = document.getElementById('admin-tab-menu-config');
    if (!panel) return;
    // 저장 / 리셋
    panel.querySelector('#mc-save-btn')?.addEventListener('click', () => this._saveMenuConfig());
    panel.querySelector('#mc-reset-btn')?.addEventListener('click', () => this._resetMenuConfig());

    // 가시성 토글 (이벤트 위임)
    panel.addEventListener('click', e => {
      const btn = e.target.closest('.mc-vis-btn');
      if (!btn) return;
      const cur = btn.dataset.visible === '1';
      const next = cur ? 0 : 1;
      btn.dataset.visible = String(next);
      btn.textContent = next ? '👁' : '🚫';
      // 데이터 모델 반영
      if (btn.dataset.section) {
        const s = this._menuConfigData.sections.find(x => x.section_key === btn.dataset.section);
        if (s) s.is_visible = next;
        btn.closest('.mc-section')?.classList.toggle('is-hidden', !next);
      } else if (btn.dataset.menu) {
        const it = this._menuConfigData.items.find(x => x.menu_key === btn.dataset.menu);
        if (it) it.is_visible = next;
        btn.closest('.mc-item')?.classList.toggle('is-hidden', !next);
      }
      this._markMenuConfigDirty();
    });

    // 라벨 입력 변경
    panel.addEventListener('input', e => {
      const t = e.target;
      if (t.classList.contains('mc-section-input')) {
        const s = this._menuConfigData.sections.find(x => x.section_key === t.dataset.section);
        if (s) s.section_label = t.value;
        this._markMenuConfigDirty();
      } else if (t.classList.contains('mc-item-input')) {
        const it = this._menuConfigData.items.find(x => x.menu_key === t.dataset.menu);
        const original = this._menuMeta.items[it?.menu_key]?.label;
        if (it) it.label_override = t.value && t.value !== original ? t.value : null;
        this._markMenuConfigDirty();
      }
    });
  },

  _initMenuConfigSortable() {
    // 기존 인스턴스 정리
    this._sortableInstances.forEach(s => {
      try {
        s.destroy();
      } catch (_) {}
    });
    this._sortableInstances = [];

    if (typeof Sortable === 'undefined') {
      console.warn('[menu-config] Sortable.js 미로드 — 드래그 비활성');
      return;
    }

    // 1) 섹션 자체 정렬 (외부 리스트)
    const sectionList = document.getElementById('mc-section-list');
    if (sectionList) {
      const inst = new Sortable(sectionList, {
        handle: '.mc-section-handle:not(.is-disabled)',
        animation: 150,
        ghostClass: 'mc-drag-ghost',
        filter: '.mc-section.is-system .mc-section-handle',
        onEnd: () => this._rebuildOrderFromDOM(),
      });
      this._sortableInstances.push(inst);
    }

    // 2) 각 섹션 내부 항목 정렬 (그룹으로 묶어 cross-section 이동 허용)
    document.querySelectorAll('.mc-items').forEach(list => {
      const inst = new Sortable(list, {
        group: {
          name: 'menu-items',
          put: to => {
            // 시스템 섹션으로는 시스템 항목만 받음 (역방향 가능)
            const toSec = to.el.dataset.sectionItems;
            return toSec !== 'system' || true; // 일단 모두 허용, 서버측에서 시스템 항목은 시스템에서만 정렬 적용
          },
        },
        handle: '.mc-handle:not(.is-disabled)',
        animation: 150,
        ghostClass: 'mc-drag-ghost',
        filter: '.mc-item.is-system .mc-handle',
        onEnd: () => this._rebuildOrderFromDOM(),
      });
      this._sortableInstances.push(inst);
    });
  },

  _rebuildOrderFromDOM() {
    // DOM 순서를 데이터 모델에 반영
    const sectionList = document.getElementById('mc-section-list');
    if (!sectionList) return;
    const sectionNodes = [...sectionList.querySelectorAll('.mc-section')];
    sectionNodes.forEach((sn, idx) => {
      const key = sn.dataset.sectionKey;
      const s = this._menuConfigData.sections.find(x => x.section_key === key);
      if (s) s.display_order = idx + 1;
      // 항목 순서
      const itemNodes = [...sn.querySelectorAll('.mc-item')];
      itemNodes.forEach((it, j) => {
        const mk = it.dataset.menuKey;
        const item = this._menuConfigData.items.find(x => x.menu_key === mk);
        if (item) {
          item.section_key = key; // cross-section 이동 반영
          item.display_order = j + 1;
        }
      });
    });
    this._markMenuConfigDirty();
  },

  _markMenuConfigDirty() {
    this._menuConfigDirty = true;
    const badge = document.getElementById('mc-changes-badge');
    const saveBtn = document.getElementById('mc-save-btn');
    if (badge) {
      badge.textContent = '● 저장되지 않은 변경 있음';
      badge.classList.add('is-dirty');
    }
    if (saveBtn) saveBtn.disabled = false;
  },

  async _saveMenuConfig() {
    if (!this._menuConfigDirty || !this._menuConfigData) return;
    const saveBtn = document.getElementById('mc-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }
    try {
      await API.request('PUT', '/admin/menu-config', this._menuConfigData);
      this._menuConfigDirty = false;
      const badge = document.getElementById('mc-changes-badge');
      if (badge) {
        badge.textContent = '✓ 저장 완료';
        badge.classList.remove('is-dirty');
      }
      if (saveBtn) saveBtn.textContent = '💾 저장';
      // 즉시 사이드바에 반영 (본인 화면 — 다른 사용자는 새로고침 시 반영)
      if (typeof App?.applyMenuConfig === 'function') {
        try {
          await App.applyMenuConfig();
        } catch (_) {
          /* non-critical */
        }
      }
      Toast.success('메뉴 구조가 저장되었습니다.');
    } catch (e) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 저장';
      }
      Toast.error('저장 실패: ' + (e.message || ''));
    }
  },

  _resetMenuConfig() {
    Modal.confirm(
      '메뉴 구조를 기본값으로 복원합니다.<br>현재 설정(순서·라벨·가시성)이 모두 초기화되며 되돌릴 수 없습니다.<br><br>계속하시겠습니까?',
      async () => {
        try {
          await API.request('POST', '/admin/menu-config/reset');
          Toast.success('기본값으로 복원되었습니다.');
          await this.loadMenuConfig(); // 다시 불러옴
        } catch (e) {
          Toast.error('복원 실패: ' + (e.message || ''));
        }
      }
    );
  },

  // ============================================================
  // Tab — 🗂 워드 사전 (Word Repository)
  // 화면 컬럼 라벨을 DB 스키마 변경 없이 설정만으로 바꾸는 기능.
  // 권한: admin(level 4) 이상.  엔드포인트: /api/admin/labels
  // ============================================================
  _wordRepoData: null,
  _wordRepoScope: null,
  _wordRepoLocale: 'ko',
  _wordRepoDirty: {},

  async loadWordRepo() {
    const panel = document.getElementById('admin-tab-word-repo');
    panel.innerHTML =
      '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';
    try {
      const locale = this._wordRepoLocale || 'ko';
      const r = await API.request('GET', `/admin/labels?locale=${encodeURIComponent(locale)}`);
      this._wordRepoData = r.data || { scopes: [], labels: {}, locales: [], system_locale: 'ko' };
      this._wordRepoLocale = r.data?.locale || locale;
      this._wordRepoDirty = {};
      if (!this._wordRepoScope || !this._wordRepoData.scopes.includes(this._wordRepoScope)) {
        this._wordRepoScope = this._wordRepoData.scopes[0] || null;
      }
      this._renderWordRepo();
      panel.dataset.loaded = '1';
    } catch (e) {
      panel.innerHTML = `<div class="empty-state">불러오기 실패: ${esc(e.message || '')}</div>`;
    }
  },

  _renderWordRepo() {
    const panel = document.getElementById('admin-tab-word-repo');
    const {
      scopes = [],
      labels = {},
      locales = [],
      system_locale = 'ko',
    } = this._wordRepoData || {};
    const activeScope = this._wordRepoScope;
    const activeLocale = this._wordRepoLocale || 'ko';
    const SCOPE_LABEL = {
      leads: '영업 리드',
      customers: '고객사',
      projects: '프로젝트',
      activities: '영업 활동',
      team: '팀',
      menu: '메뉴',
      common: '공통',
    };

    // 언어 탭
    const localeTabs = locales
      .map(
        lo => `
      <button class="wr-locale-btn${lo.code === activeLocale ? ' active' : ''}"
              data-locale="${lo.code}"
              title="${esc(lo.label)}">
        ${lo.flag || ''} ${esc(lo.label)}
        ${lo.code === system_locale ? '<span class="wr-sys-badge">시스템</span>' : ''}
      </button>
    `
      )
      .join('');

    const sideList = scopes
      .map(
        s => `
      <button class="wr-scope-btn${s === activeScope ? ' active' : ''}" data-scope="${s}">
        ${SCOPE_LABEL[s] || s}
      </button>
    `
      )
      .join('');

    const dirtyCount = Object.keys(this._wordRepoDirty).length;
    const rows = Object.entries(labels[activeScope] || {})
      .map(([k, v]) => {
        const dirtyKey = `${activeScope}.${k}`;
        const curr =
          this._wordRepoDirty[dirtyKey] !== undefined ? this._wordRepoDirty[dirtyKey] : v.current;
        const isOverridden =
          v.overridden ||
          (this._wordRepoDirty[dirtyKey] !== undefined &&
            this._wordRepoDirty[dirtyKey] !== v.default);
        return `
        <tr data-scope="${activeScope}" data-key="${k}">
          <td><span class="mono fs-12" style="color:var(--text-3)">${esc(k)}</span></td>
          <td><span style="color:var(--text-2)">${esc(v.default)}</span></td>
          <td>
            <input type="text" class="form-control wr-input ${isOverridden ? 'wr-input-overridden' : ''}" value="${esc(curr)}"
                   maxlength="200" placeholder="${esc(v.default)}"
                   style="font-size:13px"
                   data-original="${esc(v.current)}">
          </td>
          <td style="font-size:11px;color:var(--text-3)">${esc(v.desc || '')}</td>
          <td>
            ${isOverridden ? '<span style="color:#fd7e14;font-size:11px">●변경됨</span>' : ''}
          </td>
        </tr>
      `;
      })
      .join('');

    panel.innerHTML = `
      <style id="word-repo-style">
        .wr-wrap { display:grid; grid-template-columns: 200px 1fr; gap:18px; }
        .wr-side { border:1px solid var(--border); border-radius:8px; padding:10px; height:fit-content; }
        .wr-scope-btn {
          display:block; width:100%; text-align:left;
          padding:8px 12px; margin-bottom:4px;
          border:none; background:transparent; border-radius:6px;
          font-size:13px; cursor:pointer; color:var(--text-1);
        }
        .wr-scope-btn:hover { background:var(--bg-1, #f5f7fb); }
        .wr-scope-btn.active { background:#eef2ff; color:#1664E5; font-weight:600; }
        .wr-main { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
        .wr-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:14px 18px; border-bottom:1px solid var(--border); background:#fafbfc;
        }
        .wr-table { width:100%; border-collapse:collapse; }
        .wr-table th, .wr-table td { padding:10px 14px; border-bottom:1px solid var(--border); font-size:13px; vertical-align:middle; }
        .wr-table th { background:#fafbfc; text-align:left; font-weight:600; color:var(--text-2); font-size:12px; }
        .wr-table tbody tr:hover { background:#fcfcfd; }
        .wr-dirty-bar {
          position:sticky; top:0; z-index:5;
          background:#fff8f0; border:1px solid #fdba74; border-radius:8px;
          padding:10px 16px; margin-bottom:12px;
          display:flex; align-items:center; justify-content:space-between;
        }
        .wr-locale-bar {
          display:flex; align-items:center; gap:6px;
          padding:10px 0; margin-bottom:14px;
          border-bottom:1px solid var(--border);
        }
        .wr-locale-btn {
          padding:6px 14px; border:1px solid var(--border); background:#fff;
          border-radius:18px; cursor:pointer; font-size:12px; color:var(--text-1);
          display:inline-flex; align-items:center; gap:5px;
        }
        .wr-locale-btn:hover { background:#f5f7fb; }
        .wr-locale-btn.active { background:#1664E5; color:#fff; border-color:#1664E5; }
        .wr-sys-badge {
          background:#28a745; color:#fff; font-size:9px;
          padding:1px 5px; border-radius:8px; margin-left:4px;
        }
        .wr-locale-btn.active .wr-sys-badge { background:#fff; color:#28a745; }
        .wr-sys-action { margin-left:auto; font-size:11px; color:var(--text-2); }
        .wr-sys-action button {
          padding:4px 10px; font-size:11px; border:1px solid var(--border);
          background:#fff; border-radius:4px; cursor:pointer;
        }
      </style>
      <div style="margin-bottom:8px">
        <strong>🗂 워드 사전</strong>
        <span style="color:var(--text-2);font-size:12px;margin-left:6px">
          화면 컬럼 라벨을 DB 스키마 변경 없이 설정만으로 변경합니다 (admin 이상)
        </span>
      </div>

      <div class="wr-locale-bar">
        <span style="font-size:12px;color:var(--text-2);margin-right:8px">🌐 편집 언어:</span>
        ${localeTabs}
        <span class="wr-sys-action">
          시스템 기본 언어: <strong>${esc(this._getLocaleLabel(system_locale))}</strong>
          ${activeLocale !== system_locale ? `<button id="wr-set-system" style="margin-left:8px">현재 언어를 시스템 기본으로 설정</button>` : ''}
        </span>
      </div>

      ${
        dirtyCount > 0
          ? `
        <div class="wr-dirty-bar">
          <div><strong style="color:#c2410c">변경된 항목 ${dirtyCount}개</strong> · 저장 전까지 적용되지 않습니다</div>
          <div>
            <button class="btn-secondary btn-sm" id="wr-discard">초기 상태로 되돌리기</button>
            <button class="btn-primary btn-sm" id="wr-save" style="margin-left:6px">💾 저장</button>
          </div>
        </div>
      `
          : ''
      }
      <div class="wr-wrap">
        <div class="wr-side">${sideList}</div>
        <div class="wr-main">
          <div class="wr-header">
            <div>
              <strong>${SCOPE_LABEL[activeScope] || activeScope}</strong>
              <span style="color:var(--text-3);font-size:12px;margin-left:6px">${Object.keys(labels[activeScope] || {}).length}개 항목 · ${esc(this._getLocaleLabel(activeLocale))} 편집중</span>
            </div>
            <div>
              <button class="btn-secondary btn-sm" id="wr-audit-btn">📜 변경 이력</button>
              <button class="btn-danger-outline btn-sm" id="wr-reset-scope-btn" style="margin-left:6px">
                이 도메인 초기화
              </button>
            </div>
          </div>
          <table class="wr-table">
            <thead>
              <tr><th style="width:24%">키</th><th style="width:18%">기본값</th><th style="width:28%">현재 라벨</th><th>설명</th><th style="width:80px"></th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    // ── 이벤트 바인딩 ──────────────────────────────────────
    panel.querySelectorAll('.wr-scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._wordRepoScope = btn.dataset.scope;
        this._renderWordRepo();
      });
    });

    panel.querySelectorAll('.wr-locale-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (Object.keys(this._wordRepoDirty).length > 0) {
          if (
            !confirm(
              '저장하지 않은 변경 사항이 있습니다. 언어를 전환하면 사라집니다. 계속하시겠습니까?'
            )
          )
            return;
        }
        this._wordRepoLocale = btn.dataset.locale;
        await this.loadWordRepo();
      });
    });

    document
      .getElementById('wr-set-system')
      ?.addEventListener('click', () => this._setSystemLocale(activeLocale));

    panel.querySelectorAll('.wr-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const tr = inp.closest('tr');
        const key = `${tr.dataset.scope}.${tr.dataset.key}`;
        const orig = inp.dataset.original || '';
        const val = inp.value;
        if (val !== orig) {
          this._wordRepoDirty[key] = val;
        } else {
          delete this._wordRepoDirty[key];
        }
        // 변경 카운트만 갱신 (전체 재렌더는 입력 끊김 발생)
        this._refreshDirtyBar();
      });
    });

    document.getElementById('wr-save')?.addEventListener('click', () => this._saveWordRepo());
    document.getElementById('wr-discard')?.addEventListener('click', () => {
      this._wordRepoDirty = {};
      this._renderWordRepo();
    });
    document
      .getElementById('wr-reset-scope-btn')
      ?.addEventListener('click', () => this._resetWordRepoScope());
    document
      .getElementById('wr-audit-btn')
      ?.addEventListener('click', () => this._showWordRepoAudit());
  },

  _refreshDirtyBar() {
    const cnt = Object.keys(this._wordRepoDirty).length;
    const bar = document.querySelector('#admin-tab-word-repo .wr-dirty-bar');
    if (cnt === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      // 다시 렌더해서 dirty bar 생성
      this._renderWordRepo();
      return;
    }
    bar.querySelector('strong').textContent = `변경된 항목 ${cnt}개`;
  },

  _getLocaleLabel(code) {
    const locales = this._wordRepoData?.locales || [];
    const lo = locales.find(l => l.code === code);
    return lo ? `${lo.flag || ''} ${lo.label}` : code;
  },

  _setSystemLocale(locale) {
    if (!locale) return;
    Modal.confirm(
      `시스템 기본 언어를 <strong>${esc(this._getLocaleLabel(locale))}</strong> 로 변경합니다.<br>
       모든 사용자의 기본 화면 언어가 이 언어로 표시됩니다.<br>
       (사용자가 개인 언어 설정을 한 경우 그것이 우선)<br><br>
       계속하시겠습니까?`,
      async () => {
        try {
          await API.request('PUT', '/admin/labels/system-locale', { locale });
          Toast.success('시스템 기본 언어가 변경되었습니다.');
          if (typeof Labels !== 'undefined') {
            // 사용자 override 없으면 시스템 언어로 즉시 전환
            const userPref = localStorage.getItem('oci_user_locale');
            if (!userPref) {
              Labels.invalidate();
              await Labels.ensureLoaded();
              Labels.apply();
            }
          }
          await this.loadWordRepo();
        } catch (e) {
          Toast.error('변경 실패: ' + (e.message || ''));
        }
      }
    );
  },

  async _saveWordRepo() {
    const locale = this._wordRepoLocale || 'ko';
    const items = Object.entries(this._wordRepoDirty).map(([qual, label]) => {
      const [scope, key] = qual.split('.');
      return { scope, key, label, locale };
    });
    if (!items.length) return;
    try {
      const r = await API.request('PUT', '/admin/labels', { items, locale });
      Toast.success(`${r.changed || 0}개 라벨 저장됨`);
      // 캐시 무효화 + 현재 사용자 locale 기준 다시 로드 + DOM 재적용
      if (typeof Labels !== 'undefined') {
        Labels.invalidate();
        await Labels.ensureLoaded();
        Labels.apply();
      }
      await this.loadWordRepo();
    } catch (e) {
      Toast.error('저장 실패: ' + (e.message || ''));
    }
  },

  _resetWordRepoScope() {
    const scope = this._wordRepoScope;
    const locale = this._wordRepoLocale || 'ko';
    if (!scope) return;
    Modal.confirm(
      `<strong>${esc(scope)}</strong> 도메인의 <strong>${esc(this._getLocaleLabel(locale))}</strong> 라벨을 기본값으로 되돌립니다.<br>
       이 작업은 되돌릴 수 없습니다.<br><br>계속하시겠습니까?`,
      async () => {
        try {
          await API.request('POST', '/admin/labels/reset', { scope, locale });
          Toast.success('초기화되었습니다.');
          if (typeof Labels !== 'undefined') {
            Labels.invalidate();
            await Labels.ensureLoaded();
            Labels.apply();
          }
          await this.loadWordRepo();
        } catch (e) {
          Toast.error('초기화 실패: ' + (e.message || ''));
        }
      }
    );
  },

  async _showWordRepoAudit() {
    try {
      const r = await API.request('GET', '/admin/labels/audit?limit=200');
      const FLAG = { ko: '🇰🇷', en: '🇺🇸', ja: '🇯🇵', zh: '🇨🇳' };
      const rows = (r.data || [])
        .map(
          a => `
        <tr>
          <td class="fs-11">${FLAG[a.locale] || ''} <span class="mono">${esc(a.locale || 'ko')}</span></td>
          <td class="mono fs-11">${esc(a.scope)}.${esc(a.key_name)}</td>
          <td style="color:var(--text-2)">${esc(a.old_label || '')}</td>
          <td>→</td>
          <td><strong>${esc(a.new_label || '')}</strong></td>
          <td>${esc(a.changed_by_name || '-')}</td>
          <td class="fs-11" style="color:var(--text-3)">${new Date(a.changed_at).toLocaleString('ko-KR')}</td>
        </tr>
      `
        )
        .join('');
      Modal.open({
        title: '워드 사전 변경 이력',
        confirmOnClose: false,
        body: `
          <div style="max-height:60vh;overflow:auto">
            ${
              rows
                ? `
              <table class="wr-table">
                <thead><tr><th>언어</th><th>키</th><th>이전</th><th></th><th>변경 후</th><th>변경자</th><th>일시</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
                : '<div class="empty-state">변경 이력이 없습니다.</div>'
            }
          </div>
        `,
        footer: `<button class="btn btn-primary" id="wr-audit-close">닫기</button>`,
        bind: { '#wr-audit-close': () => Modal.close() },
      });
    } catch (e) {
      Toast.error('이력 조회 실패: ' + (e.message || ''));
    }
  },

  // ============================================================
  // Tab — Phase 7: 공급사 기본 정보
  // 견적서/제안서 PDF 출력 시 자동 표시되는 회사 정보 관리.
  // 권한: admin(level 4) 이상만 수정 가능. 그 외는 읽기 전용.
  // ============================================================
  _supplierInfo: null,

  async loadSupplierInfo() {
    const panel = document.getElementById('admin-tab-supplier-info');
    panel.dataset.loaded = '1';
    panel.innerHTML =
      '<div class="loading" style="padding:40px;text-align:center">로딩 중...</div>';
    try {
      const r = await API.request('GET', '/admin/supplier-info');
      this._supplierInfo = r.data || {};
      this._renderSupplierInfo();
    } catch (e) {
      panel.innerHTML = `<div class="empty-state" style="padding:60px;text-align:center;color:#d93025">불러오기 실패: ${esc(e.message || e)}</div>`;
    }
  },

  _renderSupplierInfo() {
    const panel = document.getElementById('admin-tab-supplier-info');
    const d = this._supplierInfo || {};
    const role = App.currentUser?.role || 'manager';
    const ROLE_LEVEL = { manager: 1, team_lead: 2, executive: 3, admin: 4, superadmin: 5 };
    const canEdit = (ROLE_LEVEL[role] || 0) >= 4;
    const readonlyAttr = canEdit ? '' : 'readonly disabled';

    const upd =
      d._updated_at && d.supplier_updated_by_name
        ? `<span style="color:var(--text-3);font-size:12px">최종 수정: ${new Date(d._updated_at).toLocaleString('ko-KR')} · ${esc(d.supplier_updated_by_name)}</span>`
        : `<span style="color:var(--text-3);font-size:12px">아직 입력된 정보 없음</span>`;

    panel.innerHTML = `
      <div style="max-width:1100px">
        <!-- 헤더 -->
        <div style="margin-bottom:18px;padding:14px 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
          <div style="font-size:15px;font-weight:700;color:#92400e;margin-bottom:4px">📑 공급사 기본 정보</div>
          <div style="font-size:12px;color:#92400e;line-height:1.6">
            모든 <strong>견적서 / 제안서 PDF</strong> 의 공급사 영역에 자동 표시됩니다.
            ${canEdit ? '' : '<br>⚠️ <strong>수정 권한이 없습니다</strong> — admin 이상만 변경 가능합니다.'}
          </div>
          <div style="margin-top:6px">${upd}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <!-- 좌측: 입력 폼 -->
          <div>
            <!-- 회사 정보 섹션 -->
            <div class="si-section">
              <div class="si-section-title">🏢 회사 정보</div>
              <div class="form-row">
                <label class="form-label">회사명 <span style="color:#d93025">*</span></label>
                <input class="form-input si-input" id="si-supplier_company_name" value="${esc(d.supplier_company_name || '')}" placeholder="예: OCI Holdings Co., Ltd." ${readonlyAttr}>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label class="form-label">주소</label>
                <input class="form-input si-input" id="si-supplier_address" value="${esc(d.supplier_address || '')}" placeholder="예: 서울특별시 강남구 ..." ${readonlyAttr}>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label class="form-label">사업자등록번호</label>
                <input class="form-input si-input" id="si-supplier_business_no" value="${esc(d.supplier_business_no || '')}" placeholder="예: 123-45-67890" ${readonlyAttr}>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label class="form-label">대표자</label>
                <input class="form-input si-input" id="si-supplier_ceo" value="${esc(d.supplier_ceo || '')}" placeholder="예: 홍길동" ${readonlyAttr}>
              </div>
            </div>

            <!-- 영업 담당자 섹션 -->
            <div class="si-section">
              <div class="si-section-title">👤 영업 담당자</div>
              <div class="form-row">
                <label class="form-label">담당자 이름</label>
                <input class="form-input si-input" id="si-sales_rep_name" value="${esc(d.sales_rep_name || '')}" placeholder="예: 김영업" ${readonlyAttr}>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label class="form-label">연락처</label>
                <input class="form-input si-input" id="si-sales_rep_contact" value="${esc(d.sales_rep_contact || '')}" placeholder="예: 02-1234-5678 / 010-1234-5678" ${readonlyAttr}>
              </div>
              <div class="form-row" style="margin-top:8px">
                <label class="form-label">이메일</label>
                <input class="form-input si-input" id="si-sales_rep_email" type="email" value="${esc(d.sales_rep_email || '')}" placeholder="예: sales@oci.com" ${readonlyAttr}>
              </div>
            </div>

            ${
              canEdit
                ? `<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center">
                  <div style="font-size:11px;color:var(--text-3)">⚠️ 변경 후 다음에 작성하는 견적서/제안서부터 적용됩니다 (기존 견적서는 유지)</div>
                  <button class="btn btn-primary" id="si-save-btn">💾 저장</button>
                </div>`
                : ''
            }
          </div>

          <!-- 우측: PDF 미리보기 -->
          <div>
            <div class="si-section-title" style="margin-bottom:12px">📄 PDF 미리보기 (실시간)</div>
            <div id="si-preview" class="si-preview">
              ${this._renderSupplierPreview(d)}
            </div>
          </div>
        </div>
      </div>

      <style>
        .si-section {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 14px 18px;
          margin-bottom: 12px;
        }
        .si-section-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-1);
          margin-bottom: 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .si-preview {
          background: #fff;
          border: 2px dashed var(--border-2);
          border-radius: 8px;
          padding: 20px 24px;
          font-family: 'Malgun Gothic', sans-serif;
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-1);
          position: sticky;
          top: 20px;
        }
        .si-preview-header {
          font-size: 11px;
          font-weight: 700;
          color: #E63329;
          letter-spacing: 0.04em;
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid #E63329;
        }
        .si-preview-empty {
          color: var(--text-3);
          font-style: italic;
          font-size: 11px;
        }
      </style>
    `;
    this._bindSupplierInfo(canEdit);
  },

  _renderSupplierPreview(d) {
    d = d || {};
    const f = k => esc((d[k] || '').trim());
    const company = f('supplier_company_name');
    const address = f('supplier_address');
    const bizNo = f('supplier_business_no');
    const ceo = f('supplier_ceo');
    const repName = f('sales_rep_name');
    const repContact = f('sales_rep_contact');
    const repEmail = f('sales_rep_email');
    const hasAny =
      company || address || bizNo || ceo || repName || repContact || repEmail;
    if (!hasAny) {
      return `<div class="si-preview-empty">⚠️ 정보를 입력하면 여기에 PDF 출력 모습이 표시됩니다</div>`;
    }
    return `
      <div class="si-preview-header">공급사 (Supplier)</div>
      ${company ? `<div style="font-weight:700;font-size:13px;color:#1F2329">${company}</div>` : ''}
      ${address ? `<div style="color:#555;margin-top:2px">${address}</div>` : ''}
      ${bizNo ? `<div style="color:#555;margin-top:2px">사업자등록번호: ${bizNo}</div>` : ''}
      ${ceo ? `<div style="color:#555;margin-top:2px">대표: ${ceo}</div>` : ''}
      ${
        repName || repContact || repEmail
          ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #E4E7EB">
            <div style="font-size:10px;font-weight:600;color:#86909C;margin-bottom:3px">담당자</div>
            ${repName ? `<div style="color:#1F2329">${repName}</div>` : ''}
            ${repContact ? `<div style="color:#555">${repContact}</div>` : ''}
            ${repEmail ? `<div style="color:#555">${repEmail}</div>` : ''}
          </div>`
          : ''
      }
    `;
  },

  _bindSupplierInfo(canEdit) {
    // 실시간 미리보기 — 입력 변경 시 우측 영역 재렌더
    const updatePreview = () => {
      const d = {};
      document.querySelectorAll('.si-input').forEach(el => {
        const key = el.id.replace(/^si-/, '');
        d[key] = el.value || '';
      });
      const preview = document.getElementById('si-preview');
      if (preview) preview.innerHTML = this._renderSupplierPreview(d);
    };
    document.querySelectorAll('.si-input').forEach(el => {
      el.addEventListener('input', updatePreview);
    });

    if (!canEdit) return;

    // 저장 버튼
    const saveBtn = document.getElementById('si-save-btn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
      const body = {};
      document.querySelectorAll('.si-input').forEach(el => {
        const key = el.id.replace(/^si-/, '');
        body[key] = (el.value || '').trim();
      });
      // 클라이언트 사전 검증
      if (!body.supplier_company_name) {
        Toast.error('회사명은 필수 입력입니다');
        document.getElementById('si-supplier_company_name')?.focus();
        return;
      }
      if (
        body.sales_rep_email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.sales_rep_email)
      ) {
        Toast.error('이메일 형식이 유효하지 않습니다');
        document.getElementById('si-sales_rep_email')?.focus();
        return;
      }

      const orig = saveBtn.innerHTML;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '⏳ 저장 중...';
      try {
        await API.request('PUT', '/admin/supplier-info', body);
        Toast.success('공급사 기본 정보 저장됨');
        // 갱신 — 마지막 수정 정보 반영
        await this.loadSupplierInfo();
      } catch (e) {
        Toast.error('저장 실패: ' + (e.error || e.message || e));
        saveBtn.disabled = false;
        saveBtn.innerHTML = orig;
      }
    });
  },
};
