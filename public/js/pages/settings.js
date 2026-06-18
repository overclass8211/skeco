// ============================================================
// Settings Page - 시스템 설정 / ERP 연동 / DB 상태
// ============================================================
const SettingsPage = {
  render() {
    const html = `
      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">시스템 연동 현황</div>
        </div>
        <div class="card-body">
          <div class="grid-2">
            <div class="integration-card" data-feature="erp.integration">
              <div class="integration-header">
                <div>
                  <div class="integration-name">OnERP</div>
                  <div class="integration-desc">전사 ERP 시스템 (제조 / 원가 / 재무)</div>
                </div>
                <span class="badge badge-green">● 연결 대기</span>
              </div>
              <div class="integration-body">
                <div class="kv-row"><span class="kv-key">동기화 항목</span><span class="kv-val">제품 원가, 출고 단가, 재고</span></div>
                <div class="kv-row"><span class="kv-key">동기화 주기</span><span class="kv-val">1시간 (실시간 옵션)</span></div>
                <div class="kv-row"><span class="kv-key">API 엔드포인트</span><span class="kv-val mono">https://erp.oci.co.kr/api/v1</span></div>
                <div class="kv-row"><span class="kv-key">최근 동기화</span><span class="kv-val text-muted">설정 필요</span></div>
              </div>
              <button class="btn btn-primary btn-sm" data-integration="OnERP">설정 열기</button>
            </div>

            <div class="integration-card">
              <div class="integration-header">
                <div>
                  <div class="integration-name">가온아이 그룹웨어</div>
                  <div class="integration-desc">결재 / 일정 / 메일 / 게시판</div>
                </div>
                <span class="badge badge-green">● 연결 대기</span>
              </div>
              <div class="integration-body">
                <div class="kv-row"><span class="kv-key">동기화 항목</span><span class="kv-val">결재 문서, 일정, 사용자 정보</span></div>
                <div class="kv-row"><span class="kv-key">SSO</span><span class="kv-val">SAML 2.0 지원</span></div>
                <div class="kv-row"><span class="kv-key">API 엔드포인트</span><span class="kv-val mono">https://groupware.oci.co.kr/api</span></div>
                <div class="kv-row"><span class="kv-key">최근 동기화</span><span class="kv-val text-muted">설정 필요</span></div>
              </div>
              <button class="btn btn-primary btn-sm" data-integration="가온아이">설정 열기</button>
            </div>
          </div>
        </div>
      </div>

      <!-- v6.0.0 Step 4: 전자계약 (eSign) 연동 — 모두싸인 OAuth 통합 -->
      <div class="card mb-3" data-feature="crm.contracts">
        <div class="card-header">
          <div class="card-title">🖋 전자계약 연동 (eSign)</div>
          <span class="badge badge-blue" style="font-size:10px">v6.0.0 Step 4 — 통합 완료</span>
        </div>
        <div class="card-body">
          <div class="grid-2">
            <div class="integration-card" id="esign-modusign-card">
              <div class="integration-header">
                <div>
                  <div class="integration-name">🇰🇷 모두싸인 (modusign)</div>
                  <div class="integration-desc">국내 표준 전자서명 솔루션 · OAuth 2.0 + Webhook</div>
                </div>
                <span class="badge" id="esign-modusign-badge" style="font-size:10px">조회 중...</span>
              </div>
              <div class="integration-body" id="esign-modusign-body">
                <div class="kv-row"><span class="kv-key">상태</span><span class="kv-val text-muted">⏳ 연결 상태 조회 중...</span></div>
              </div>
              <div id="esign-modusign-actions" style="display:flex;gap:6px;flex-wrap:wrap">
                <a href="https://developers.modusign.co.kr" target="_blank" rel="noopener"
                   class="btn btn-ghost btn-sm" style="text-decoration:none">
                  📘 개발자 문서 →
                </a>
              </div>
            </div>

            <div class="integration-card" style="opacity:0.55">
              <div class="integration-header">
                <div>
                  <div class="integration-name">🌐 DocuSign (글로벌)</div>
                  <div class="integration-desc">국제 표준 전자서명 솔루션 · 해외 거래용</div>
                </div>
                <span class="badge badge-gray">검토 중</span>
              </div>
              <div class="integration-body">
                <div class="kv-row"><span class="kv-key">상태</span><span class="kv-val text-muted">국내 모두싸인 우선 도입 후 검토</span></div>
              </div>
              <button class="btn btn-ghost btn-sm" disabled style="opacity:0.5;cursor:not-allowed">
                미지원
              </button>
            </div>
          </div>

          <!-- 운영 셋업 안내 박스 -->
          <div style="margin-top:14px;padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:12px;color:#075985;line-height:1.6">
            <strong>📋 운영 셋업 가이드:</strong>
            <ol style="margin:6px 0 0 18px;padding:0">
              <li><a href="https://developers.modusign.co.kr" target="_blank" rel="noopener" style="color:#0369a1;font-weight:600">모두싸인 개발자 콘솔</a> 가입</li>
              <li>OAuth 클라이언트 생성 → CLIENT_ID / SECRET 발급</li>
              <li>Redirect URI 등록: <code style="background:#fff;padding:1px 6px;border-radius:3px;font-size:11px">/api/contracts/esign/oauth/callback</code></li>
              <li>Webhook URL 등록: <code style="background:#fff;padding:1px 6px;border-radius:3px;font-size:11px">/api/webhooks/modusign</code></li>
              <li><code style="background:#fff;padding:1px 6px;border-radius:3px;font-size:11px">.env</code> 에 MODUSIGN_CLIENT_ID / SECRET / WEBHOOK_SECRET 입력 → pm2 restart</li>
              <li>본 화면에서 [모두싸인 연결] 버튼 클릭 → OAuth 인가</li>
            </ol>
            <div style="margin-top:6px;font-size:11px">
              💡 환경변수 미설정 시 <strong>Mock 모드</strong> — 실제 외부 호출 없이 UI/흐름만 테스트 가능
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">데이터베이스 상태</div>
          <button class="btn btn-ghost btn-sm" id="settings-checkdb-btn">상태 확인</button>
        </div>
        <div class="card-body" id="db-status">
          <div class="loading">확인중...</div>
        </div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header"><div class="card-title">알림 설정</div></div>
          <div class="card-body">
            <div class="setting-row">
              <div>
                <div class="setting-name">파이프라인 단계 변경 알림</div>
                <div class="setting-desc">담당자에게 이메일 발송</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">원가 변동 알림</div>
                <div class="setting-desc">주요 원자재 ±5% 이상 변동시</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">예상 마감일 임박 알림</div>
                <div class="setting-desc">7일 이내 마감 예정 리드</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">Slack 연동</div>
                <div class="setting-desc">팀 채널로 주요 이벤트 푸시</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title">권한 / 보안</div></div>
          <div class="card-body">
            <div class="setting-row">
              <div>
                <div class="setting-name">2단계 인증 (2FA)</div>
                <div class="setting-desc">로그인시 OTP 인증</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">감사 로그</div>
                <div class="setting-desc">데이터 변경 이력 자동 기록</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">담당자 외 리드 조회 제한</div>
                <div class="setting-desc">팀장 이상 권한자만 전체 조회</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">IP 화이트리스트</div>
                <div class="setting-desc">사내 IP에서만 접근 가능</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
          </div>
        </div>
      </div>

      <!-- 🎨 로고 관리 ─────────────────────────────────────── -->
      <div class="card mb-3" id="logo-mgmt-card">
        <div class="card-header">
          <div class="card-title">🎨 로고 관리</div>
          <span style="font-size:11px;color:var(--text-3)">사이드바 좌측 상단에 표시되는 로고 (PNG / JPG / SVG, 2MB 이하)</span>
        </div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
            <div style="flex:0 0 240px;display:flex;flex-direction:column;align-items:center;gap:8px">
              <div style="font-size:11px;color:var(--text-3);font-weight:600">현재 로고 (사이드바 실제 표시 크기)</div>
              <div style="width:220px;height:64px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:flex-start;padding:8px 14px;gap:8px">
                <!-- 실제 사이드바와 동일 비율: 로고 + divider + "CRM AI" 시뮬레이션 -->
                <img id="logo-preview" alt="현재 로고"
                     style="height:40px;max-width:140px;width:auto;object-fit:contain">
                <div style="width:1px;height:16px;background:var(--border-2)"></div>
                <span style="font-size:11px;color:var(--text-3);font-weight:500;letter-spacing:0.5px">CRM <span style="color:var(--oci-red);font-weight:700">AI</span></span>
              </div>
              <div id="logo-status" style="font-size:11px;color:var(--text-3)">로딩 중...</div>
            </div>
            <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:10px">
              <label style="font-size:13px;font-weight:600;color:var(--text-1)">새 로고 업로드</label>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/svg+xml" style="font-size:12px;flex:1;min-width:180px">
                <button class="btn btn-primary btn-sm" id="logo-upload-btn">📤 업로드</button>
                <button class="btn btn-ghost btn-sm" id="logo-restore-btn" style="color:var(--oci-red)">🔄 기본 로고로 복원</button>
              </div>
              <div style="font-size:12px;color:var(--text-2);line-height:1.7;padding:10px 12px;background:var(--surface-2);border-radius:6px;border-left:3px solid var(--oci-red)">
                <strong>📐 권장 사양</strong><br>
                • 실제 사이드바 표시: <strong>40px × ~140px</strong> (가로 한도)<br>
                • 업로드 권장: <strong>가로 280px × 세로 80px</strong> 이상 (Retina 2x)<br>
                • 가로:세로 비율 <strong>3.5:1 권장</strong> (예: 280×80, 350×100)<br>
                • PNG (투명 배경) / JPG / SVG (자동 sanitize)<br>
                <span style="color:var(--text-3);font-size:11px">
                  ⚠️ 정사각형 로고는 사이드바에 작게 표시됩니다 — 가로 긴 형태 권장
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">✉️ 이메일 템플릿</div>
          <button class="btn btn-primary btn-sm" id="email-tpl-new-btn">+ 새 템플릿</button>
        </div>
        <div class="card-body" id="email-tpl-list">
          <div class="loading">불러오는 중...</div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">🔗 Webhook (외부 통합)</div>
          <button class="btn btn-primary btn-sm" id="webhook-new-btn">+ 새 Webhook</button>
        </div>
        <div class="card-body" id="webhook-list">
          <div class="loading">불러오는 중...</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">시스템 정보</div></div>
        <div class="card-body">
          <div class="kv-grid">
            <div class="kv-row"><span class="kv-key">서비스명</span><span class="kv-val">OCI CRM</span></div>
            <div class="kv-row"><span class="kv-key">버전</span><span class="kv-val mono">v1.0.0</span></div>
            <div class="kv-row"><span class="kv-key">백엔드</span><span class="kv-val mono">Node.js + Express</span></div>
            <div class="kv-row"><span class="kv-key">데이터베이스</span><span class="kv-val mono">MariaDB 10.x</span></div>
            <div class="kv-row"><span class="kv-key">기반 모델</span><span class="kv-val">핑거세일즈 CRM 커스터마이징</span></div>
            <div class="kv-row"><span class="kv-key">최종 빌드</span><span class="kv-val text-muted">${Fmt.dateKor(new Date())}</span></div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    document
      .getElementById('settings-checkdb-btn')
      ?.addEventListener('click', () => this.checkDb());
    document.getElementById('content').addEventListener('click', e => {
      const btn = e.target.closest('[data-integration]');
      if (btn) this.openIntegration(btn.dataset.integration);
    });

    // 🎨 로고 관리
    this._initLogoManager();

    // 이메일 템플릿
    document
      .getElementById('email-tpl-new-btn')
      ?.addEventListener('click', () => this.openTemplateForm());
    this.loadEmailTemplates();

    // Webhook
    document
      .getElementById('webhook-new-btn')
      ?.addEventListener('click', () => this.openWebhookForm());
    this.loadWebhooks();

    // v6.0.0 Step 4: 모두싸인 OAuth 연결 상태 로드
    this.loadEsignStatus();

    this.checkDb();
  },

  // ─── v6.0.0 Step 4: 모두싸인 OAuth 연결 관리 ──────────────
  async loadEsignStatus() {
    const badge = document.getElementById('esign-modusign-badge');
    const body = document.getElementById('esign-modusign-body');
    const actions = document.getElementById('esign-modusign-actions');
    if (!badge || !body || !actions) return;
    try {
      const r = await API.contracts.esign.status();
      const d = r?.data || {};
      const connected = !!d.connected;
      const mock = !!d.mock;
      const configured = !!d.configured;

      // 배지
      if (mock && !configured) {
        badge.className = 'badge badge-orange';
        badge.style.fontSize = '10px';
        badge.textContent = '🧪 Mock 모드';
      } else if (connected) {
        badge.className = 'badge badge-green';
        badge.style.fontSize = '10px';
        badge.textContent = '✅ 연결됨';
      } else {
        badge.className = 'badge badge-gray';
        badge.style.fontSize = '10px';
        badge.textContent = '⚪ 미연결';
      }

      // 본문
      const rows = [];
      rows.push(
        `<div class="kv-row"><span class="kv-key">상태</span><span class="kv-val">${
          connected ? '✅ 연결됨' : mock && !configured ? '🧪 Mock 모드 (환경변수 미설정)' : '⚪ 미연결'
        }</span></div>`
      );
      if (connected) {
        rows.push(
          `<div class="kv-row"><span class="kv-key">계정</span><span class="kv-val">${
            d.modusign_email || d.modusign_user_id || '-'
          }</span></div>`
        );
        if (d.expires_at) {
          rows.push(
            `<div class="kv-row"><span class="kv-key">토큰 만료</span><span class="kv-val text-muted">${new Date(d.expires_at).toLocaleString('ko-KR')}</span></div>`
          );
        }
      }
      rows.push(
        `<div class="kv-row"><span class="kv-key">인증 방식</span><span class="kv-val">OAuth 2.0</span></div>`
      );
      rows.push(
        `<div class="kv-row"><span class="kv-key">Webhook</span><span class="kv-val">HMAC-SHA256 검증</span></div>`
      );
      body.innerHTML = rows.join('');

      // 액션 버튼
      const docLink = `<a href="https://developers.modusign.co.kr" target="_blank" rel="noopener"
                         class="btn btn-ghost btn-sm" style="text-decoration:none">📘 개발자 문서 →</a>`;
      if (connected) {
        actions.innerHTML =
          `<button class="btn btn-ghost btn-sm" id="esign-modusign-disconnect-btn" style="color:#dc2626">🔌 연결 해제</button>${docLink}`;
        document
          .getElementById('esign-modusign-disconnect-btn')
          ?.addEventListener('click', () => this.disconnectEsign());
      } else {
        actions.innerHTML =
          `<button class="btn btn-primary btn-sm" id="esign-modusign-connect-btn">🔗 모두싸인 연결</button>${docLink}`;
        document
          .getElementById('esign-modusign-connect-btn')
          ?.addEventListener('click', () => this.connectEsign());
      }
    } catch (e) {
      body.innerHTML = `<div class="kv-row"><span class="kv-key">상태</span><span class="kv-val text-muted">조회 실패: ${e.message || '-'}</span></div>`;
      badge.textContent = '⚠️ 오류';
      badge.className = 'badge badge-red';
    }
  },

  async connectEsign() {
    try {
      const r = await API.contracts.esign.connect();
      const url = r?.data?.auth_url;
      const mock = r?.data?.mock;
      if (mock) {
        // Mock 모드: 자동으로 콜백 호출 (개발 편의)
        if (
          confirm(
            '🧪 Mock 모드 — 실제 외부 호출 없이 가짜 토큰을 즉시 발급합니다.\n계속하시겠습니까?'
          )
        ) {
          const params = new URLSearchParams({ code: '__MOCK_CODE__' });
          const cbRes = await fetch(
            `/api/contracts/esign/oauth/callback?${params.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('oci_token') || ''}`,
                'X-User-Id': localStorage.getItem('current_user_id') || '',
              },
            }
          );
          const cbJson = await cbRes.json();
          if (cbJson?.success) {
            Toast.success?.('Mock 연결 완료');
            this.loadEsignStatus();
          } else {
            Toast.error?.('Mock 연결 실패');
          }
          return;
        }
      }
      if (url) {
        window.open(url, '_blank', 'width=600,height=700');
        Toast.info?.('새 창에서 모두싸인 인가 진행 후 본 화면 새로고침해주세요');
      } else {
        Toast.error?.('인가 URL 응답 없음');
      }
    } catch (e) {
      Toast.error?.('연결 실패: ' + (e.message || e));
    }
  },

  async disconnectEsign() {
    if (!confirm('모두싸인 연결을 해제하시겠습니까?')) return;
    try {
      await API.contracts.esign.disconnect();
      Toast.success?.('연결 해제됨');
      this.loadEsignStatus();
    } catch (e) {
      Toast.error?.('해제 실패: ' + (e.message || e));
    }
  },

  // ─── Webhook 관리 ───────────────────────────────────────
  async loadWebhooks() {
    const el = document.getElementById('webhook-list');
    if (!el) return;
    try {
      const r = await API.get('/webhooks');
      const hooks = r.data || [];
      if (!hooks.length) {
        el.innerHTML = `
          <div class="empty" style="padding:20px;text-align:center;color:var(--text-3)">
            등록된 Webhook 이 없습니다.
            <div style="margin-top:6px;font-size:11px">예: Slack, MS Teams, ERP 등 외부 시스템에 이벤트 전송</div>
          </div>`;
        return;
      }
      el.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:50px">상태</th>
              <th>이름</th>
              <th>URL</th>
              <th>이벤트</th>
              <th style="width:80px">최근 발송</th>
              <th style="width:220px;text-align:right">작업</th>
            </tr>
          </thead>
          <tbody>
            ${hooks
              .map(h => {
                const events = Array.isArray(h.event_types) ? h.event_types : [];
                const lastStatusBadge = !h.last_sent_at
                  ? '<span class="badge badge-gray" style="font-size:10px">미발송</span>'
                  : h.last_status === 'success'
                    ? '<span class="badge badge-green" style="font-size:10px">✓ 성공</span>'
                    : `<span class="badge badge-red" style="font-size:10px" title="${esc(h.last_status || 'failed')}">✕ 실패</span>`;
                return `
                <tr data-wh-id="${h.id}">
                  <td>${
                    h.is_active
                      ? '<span class="badge badge-green" style="font-size:10px">활성</span>'
                      : '<span class="badge badge-gray" style="font-size:10px">비활성</span>'
                  }
                  </td>
                  <td><strong>${esc(h.name)}</strong></td>
                  <td><code style="font-size:11px;color:var(--text-2)">${esc(h.url.slice(0, 60))}${h.url.length > 60 ? '…' : ''}</code></td>
                  <td>
                    ${events
                      .slice(0, 3)
                      .map(
                        e =>
                          `<span class="badge badge-blue" style="font-size:10px;margin-right:3px">${esc(e)}</span>`
                      )
                      .join('')}
                    ${events.length > 3 ? `<span class="badge badge-gray" style="font-size:10px">+${events.length - 3}</span>` : ''}
                  </td>
                  <td>${lastStatusBadge}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn btn-ghost btn-sm" data-wh-action="test"     data-id="${h.id}" title="테스트 발송">🧪 테스트</button>
                    <button class="btn btn-ghost btn-sm" data-wh-action="logs"     data-id="${h.id}" title="발송 이력">📋 이력</button>
                    <button class="btn btn-ghost btn-sm" data-wh-action="edit"     data-id="${h.id}">편집</button>
                    <button class="btn btn-ghost btn-sm" data-wh-action="delete"   data-id="${h.id}" style="color:var(--oci-red)">삭제</button>
                  </td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>
      `;
      el.querySelectorAll('[data-wh-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const a = btn.dataset.whAction;
          if (a === 'edit') this.openWebhookForm(id);
          if (a === 'delete') this.deleteWebhook(id);
          if (a === 'test') this.testWebhook(id);
          if (a === 'logs') this.showWebhookLogs(id);
        });
      });
    } catch (e) {
      el.innerHTML = `<div class="empty" style="color:var(--oci-red)">불러오기 실패: ${esc(e.message || '')}</div>`;
    }
  },

  async openWebhookForm(id = null) {
    let hook = {
      id: null,
      name: '',
      url: '',
      event_types: [],
      is_active: 1,
      has_secret: 0,
    };
    let events = [];
    try {
      const evRes = await API.get('/webhooks/events');
      events = evRes.data || [];
    } catch (_) {
      /* fallback */
    }
    if (id) {
      try {
        const r = await API.get(`/webhooks/${id}`);
        hook = r.data;
      } catch (e) {
        Toast.error('Webhook 로드 실패: ' + (e.message || ''));
        return;
      }
    }

    const isEdit = !!id;

    Modal.open({
      title: isEdit ? '🔗 Webhook 편집' : '🔗 새 Webhook',
      width: 720,
      body: `
        <div class="form-grid" style="grid-template-columns: 120px 1fr; gap: 10px 12px; align-items: center">
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="wh-name" maxlength="150" value="${esc(hook.name)}"
                 placeholder="예: Slack 알림 - 영업팀">

          <label class="form-label">URL *</label>
          <input type="text" class="form-input" id="wh-url" maxlength="500" value="${esc(hook.url)}"
                 placeholder="https://hooks.slack.com/services/...">

          <label class="form-label" style="align-self:flex-start;padding-top:6px">이벤트 *</label>
          <div id="wh-events-list" style="display:flex;flex-direction:column;gap:6px">
            ${events
              .map(
                ev => `
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                <input type="checkbox" name="wh-event" value="${esc(ev)}"
                       ${hook.event_types?.includes(ev) ? 'checked' : ''}>
                <code style="font-size:11px;background:var(--surface-3);padding:2px 6px;border-radius:4px">${esc(ev)}</code>
              </label>
            `
              )
              .join('')}
          </div>

          <label class="form-label">활성 상태</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" id="wh-active" ${hook.is_active ? 'checked' : ''}>
            <span>활성화 (이벤트 발생 시 발송)</span>
          </label>

          ${
            isEdit
              ? `
            <label class="form-label">시크릿</label>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-3)">
              ${hook.has_secret ? '🔒 설정됨' : '⚠️ 없음'}
              <button type="button" class="btn btn-ghost btn-sm" id="wh-regen-secret"
                      style="font-size:11px" title="시크릿을 새로 발급합니다">🔄 시크릿 재발급</button>
            </div>
          `
              : `
            <label class="form-label">시크릿</label>
            <div style="font-size:11px;color:var(--text-3)">
              저장 시 자동 발급됩니다 (32 byte hex).<br>
              수신 측에서 X-OCI-Signature 헤더의 HMAC-SHA256 서명 검증에 사용.
            </div>
          `
          }
        </div>
        <div style="margin-top:14px;font-size:11px;color:var(--text-3);line-height:1.7">
          💡 Webhook URL 은 http:// 또는 https:// 만 허용 (운영 환경은 https 강제).<br>
          📤 페이로드 형식: <code>{ event, delivery_id, timestamp, data: {...} }</code><br>
          🔐 서명 확인 방법: <code>HMAC-SHA256(secret, payload) === X-OCI-Signature</code>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="wh-cancel">취소</button>
        <button class="btn btn-primary" id="wh-save">저장</button>
      `,
      bind: {
        '#wh-cancel': () => Modal.close(),
        '#wh-regen-secret': async () => {
          if (!confirm('새 시크릿을 발급하시겠습니까? 수신 측 설정도 동시에 업데이트해야 합니다.'))
            return;
          try {
            await API.put(`/webhooks/${id}`, { secret: '' }); // 빈 문자열 → 서버에서 자동 재발급
            Toast.success('시크릿이 재발급되었습니다.');
            Modal.close();
            this.loadWebhooks();
          } catch (e) {
            Toast.error('재발급 실패: ' + (e.message || ''));
          }
        },
        '#wh-save': async () => {
          const name = document.getElementById('wh-name').value.trim();
          const url = document.getElementById('wh-url').value.trim();
          const active = document.getElementById('wh-active').checked;
          const selectedEvents = [];
          document.querySelectorAll('input[name="wh-event"]:checked').forEach(c => {
            selectedEvents.push(c.value);
          });

          if (!name || !url) {
            Toast.warn('이름·URL 은 필수입니다.');
            return;
          }
          if (selectedEvents.length === 0) {
            Toast.warn('최소 1개 이상의 이벤트를 선택하세요.');
            return;
          }

          try {
            if (isEdit) {
              await API.put(`/webhooks/${id}`, {
                name,
                url,
                event_types: selectedEvents,
                is_active: active,
              });
              Toast.success('Webhook 이 수정되었습니다.');
            } else {
              const r = await API.post('/webhooks', {
                name,
                url,
                event_types: selectedEvents,
              });
              if (r.secret) {
                // 신규 시크릿 — 한 번만 노출
                Modal.close();
                await new Promise(resolve => setTimeout(resolve, 100));
                Modal.open({
                  title: '🔐 시크릿 발급 완료 (한 번만 표시)',
                  body: `
                    <div style="padding:10px 0">
                      <p style="margin:0 0 10px;font-size:13px">
                        Webhook 시크릿이 발급되었습니다.<br>
                        수신 측에 등록하세요. <strong>이 화면을 닫으면 다시 볼 수 없습니다.</strong>
                      </p>
                      <textarea readonly rows="2" class="form-input"
                                style="font-family:monospace;font-size:11px;word-break:break-all"
                                id="wh-secret-display">${esc(r.secret)}</textarea>
                      <button class="btn btn-ghost btn-sm" id="wh-secret-copy"
                              style="margin-top:8px">📋 복사</button>
                    </div>
                  `,
                  footer: `<button class="btn btn-primary" id="wh-secret-ok">확인했습니다</button>`,
                  bind: {
                    '#wh-secret-copy': () => {
                      const t = document.getElementById('wh-secret-display');
                      t.select();
                      try {
                        document.execCommand('copy');
                        Toast.success('클립보드에 복사되었습니다.');
                      } catch (_) {
                        /* ignore */
                      }
                    },
                    '#wh-secret-ok': () => {
                      Modal.close();
                      this.loadWebhooks();
                    },
                  },
                });
                return;
              }
              Toast.success('Webhook 이 추가되었습니다.');
            }
            Modal.close();
            this.loadWebhooks();
          } catch (e) {
            Toast.error('저장 실패: ' + (e.message || ''));
          }
        },
      },
    });
  },

  async deleteWebhook(id) {
    if (!confirm('이 Webhook 을 삭제하시겠습니까? 발송 이력도 함께 삭제됩니다.')) return;
    try {
      await API.del(`/webhooks/${id}`);
      Toast.success('Webhook 이 삭제되었습니다.');
      this.loadWebhooks();
    } catch (e) {
      Toast.error('삭제 실패: ' + (e.message || ''));
    }
  },

  async testWebhook(id) {
    try {
      Toast.info('테스트 발송 중...');
      const r = await API.post(`/webhooks/${id}/test`, { event: 'lead.won' });
      const result = r.data || {};
      if (result.ok) {
        Toast.success(`✓ 성공 — HTTP ${result.status} (${result.ms || '?'}ms)`);
      } else {
        Toast.error(`✕ 실패 — ${result.error || result.status || '알 수 없음'}`);
      }
      this.loadWebhooks();
    } catch (e) {
      Toast.error('테스트 실패: ' + (e.message || ''));
    }
  },

  async showWebhookLogs(id) {
    try {
      const r = await API.get(`/webhooks/${id}/deliveries?limit=20`);
      const logs = r.data || [];
      const body =
        logs.length === 0
          ? `
        <div class="empty" style="padding:30px;text-align:center;color:var(--text-3)">
          아직 발송 이력이 없습니다.
        </div>
      `
          : `
        <table class="data-table" style="font-size:12px">
          <thead>
            <tr>
              <th style="width:60px">상태</th>
              <th>이벤트</th>
              <th>HTTP</th>
              <th>응답</th>
              <th>시도</th>
              <th>시각</th>
            </tr>
          </thead>
          <tbody>
            ${logs
              .map(
                l => `
              <tr>
                <td>${
                  l.status === 'success'
                    ? '<span class="badge badge-green" style="font-size:10px">✓</span>'
                    : '<span class="badge badge-red" style="font-size:10px" title="' +
                      esc(l.error_message || '') +
                      '">✕</span>'
                }
                </td>
                <td><code style="font-size:11px">${esc(l.event_type)}</code></td>
                <td style="font-variant-numeric:tabular-nums">${l.http_status || '-'}</td>
                <td style="font-variant-numeric:tabular-nums">${l.response_ms || '-'}ms</td>
                <td style="text-align:center">${l.attempt}</td>
                <td style="font-size:11px">${esc(new Date(l.created_at).toLocaleString('ko-KR'))}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      Modal.open({
        title: '📋 Webhook 발송 이력 (최근 20건)',
        width: 720,
        body,
        footer: `<button class="btn btn-primary" id="wh-logs-ok">닫기</button>`,
        bind: { '#wh-logs-ok': () => Modal.close() },
      });
    } catch (e) {
      Toast.error('이력 로드 실패: ' + (e.message || ''));
    }
  },

  // ─── 🎨 로고 관리 ───────────────────────────────────────
  async _initLogoManager() {
    const preview = document.getElementById('logo-preview');
    const statusEl = document.getElementById('logo-status');
    const fileInput = document.getElementById('logo-file-input');
    const uploadBtn = document.getElementById('logo-upload-btn');
    const restoreBtn = document.getElementById('logo-restore-btn');
    if (!preview || !uploadBtn) return;

    // 현재 로고 로드
    const refreshPreview = async () => {
      try {
        const r = await API.logo.get();
        const url = r?.data?.url || '/assets/default-logo.svg';
        const isCustom = r?.data?.is_custom;
        // 캐시 회피용 timestamp 쿼리 (업로드 직후 갱신)
        preview.src = url + (isCustom ? '?t=' + Date.now() : '');
        if (statusEl) {
          statusEl.textContent = isCustom ? '✅ 커스텀 로고 적용됨' : '기본 로고';
          statusEl.style.color = isCustom ? '#17A85A' : 'var(--text-3)';
        }
        // 사이드바 로고도 즉시 동기화
        const sidebarImg = document.getElementById('sidebar-logo-img');
        if (sidebarImg) sidebarImg.src = url + (isCustom ? '?t=' + Date.now() : '');
      } catch (_) {
        /* ignore */
      }
    };
    await refreshPreview();

    // 업로드 버튼
    uploadBtn.onclick = async () => {
      const file = fileInput?.files?.[0];
      if (!file) {
        Toast.warn?.('파일을 먼저 선택하세요 (PNG/JPG/SVG)');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        Toast.error('파일 크기는 2MB 이하만 가능합니다');
        return;
      }
      uploadBtn.disabled = true;
      const orig = uploadBtn.textContent;
      uploadBtn.textContent = '⏳ 업로드 중...';
      try {
        const formData = new FormData();
        formData.append('logo', file);
        // multipart 라 fetch 직접 사용 (Bearer 헤더 포함)
        const token = sessionStorage.getItem('oci_token') || localStorage.getItem('oci_token');
        const res = await fetch('/api/admin/logo/upload', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '업로드 실패');
        }
        // 최적화 결과 표시 (Sharp + svgo)
        const opt = data.data?.optimization;
        if (opt) {
          const fmt = b =>
            b < 1024
              ? `${b}B`
              : b < 1024 * 1024
                ? `${(b / 1024).toFixed(1)}KB`
                : `${(b / 1024 / 1024).toFixed(2)}MB`;
          const savings = opt.savings_percent > 0 ? ` (${opt.savings_percent}% 절감)` : '';
          const dims = opt.width && opt.height ? ` · ${opt.width}×${opt.height}` : '';
          Toast.success(
            `✅ 로고 변경 완료 — ${fmt(opt.original_size)} → ${fmt(opt.optimized_size)}${savings}${dims}`
          );
        } else {
          Toast.success('✅ 로고가 변경되었습니다');
        }
        fileInput.value = '';
        await refreshPreview();
      } catch (err) {
        Toast.error('업로드 실패: ' + (err.message || ''));
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = orig;
      }
    };

    // 복원 버튼
    restoreBtn.onclick = async () => {
      if (!confirm('기본 로고로 복원하시겠습니까?\n(업로드된 커스텀 로고 파일이 삭제됩니다)'))
        return;
      try {
        await API.logo.restore();
        Toast.success('🔄 기본 로고로 복원되었습니다');
        await refreshPreview();
      } catch (err) {
        Toast.error('복원 실패: ' + (err.message || ''));
      }
    };
  },

  // ─── 이메일 템플릿 관리 ─────────────────────────────────
  async loadEmailTemplates() {
    const el = document.getElementById('email-tpl-list');
    if (!el) return;
    try {
      const r = await API.get('/email-templates');
      const tpls = r.data || [];
      if (!tpls.length) {
        el.innerHTML =
          '<div class="empty" style="padding:20px;text-align:center;color:var(--text-3)">템플릿이 없습니다.</div>';
        return;
      }
      const catLabel = { lead: '영업', customer: '고객사', project: '프로젝트', general: '일반' };
      const userCount = tpls.filter(t => !t.is_system).length;
      const helpBanner =
        userCount === 0
          ? `
        <div class="alert alert-info" style="margin-bottom:12px;padding:10px 14px;font-size:12px;line-height:1.6">
          💡 시스템 템플릿(🔒)은 수정·삭제할 수 없습니다.
          오른쪽 <strong>📋 복제</strong> 버튼으로 사용자 템플릿을 만들면 자유롭게 편집할 수 있습니다.
        </div>
      `
          : '';
      el.innerHTML = `
        ${helpBanner}
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:60px">카테고리</th>
              <th>이름</th>
              <th>제목</th>
              <th style="width:80px">유형</th>
              <th style="width:200px;text-align:right">작업</th>
            </tr>
          </thead>
          <tbody>
            ${tpls
              .map(
                t => `
              <tr data-tpl-id="${t.id}">
                <td><span class="badge badge-blue">${esc(catLabel[t.category] || t.category)}</span></td>
                <td><strong>${esc(t.name)}</strong></td>
                <td style="font-size:12px;color:var(--text-2)">${this._renderTplVars(t.subject)}</td>
                <td>${
                  t.is_system
                    ? '<span class="badge badge-gray" title="시스템 시드 — 복제 후 편집 가능">🔒 시스템</span>'
                    : '<span class="badge badge-green">사용자</span>'
                }</td>
                <td style="text-align:right;white-space:nowrap">
                  ${
                    t.is_system
                      ? `
                    <button class="btn btn-ghost btn-sm" data-tpl-action="clone" data-id="${t.id}"
                            title="이 템플릿을 사용자 템플릿으로 복제 → 편집 가능">📋 복제</button>
                  `
                      : `
                    <button class="btn btn-ghost btn-sm" data-tpl-action="edit" data-id="${t.id}">편집</button>
                    <button class="btn btn-ghost btn-sm" data-tpl-action="delete" data-id="${t.id}"
                            style="color:var(--oci-red)">삭제</button>
                  `
                  }
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      // 이벤트 위임
      el.querySelectorAll('[data-tpl-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const action = btn.dataset.tplAction;
          if (action === 'edit') this.openTemplateForm(id);
          if (action === 'delete') this.deleteTemplate(id);
          if (action === 'clone') this.cloneTemplate(id);
        });
      });
    } catch (e) {
      el.innerHTML = `<div class="empty" style="color:var(--oci-red)">불러오기 실패: ${esc(e.message || '')}</div>`;
    }
  },

  // ─── 템플릿 변수 → 칩 스타일 렌더링 (시각적 강조 + 샘플 툴팁) ───
  // {{my_company}} → <span class="tpl-var" title="회사명 — 발송 시 'OCI' 같은 값으로 치환">my_company</span>
  // 알 수 없는 변수는 warning 스타일 (.tpl-var-unknown)
  _TPL_VARS: {
    customer_name: { label: '고객사명', sample: '한국동서발전' },
    contact_person: { label: '고객사 담당자', sample: '박팀장' },
    project_name: { label: '프로젝트명', sample: '30MW EPC 입찰' },
    my_name: { label: '내 이름', sample: '김영업' },
    my_company: { label: '회사명', sample: 'OCI' },
    today: { label: '오늘 날짜', sample: '2026-05-17' },
    bidding_deadline: { label: '입찰 마감일', sample: '2026-05-31' },
  },
  _renderTplVars(text) {
    if (!text) return '';
    const safe = esc(text);
    // esc() 가 {와 }는 변경 안 함 — \w+ 매칭으로 안전
    return safe.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const v = this._TPL_VARS[name];
      if (!v) {
        return `<span class="tpl-var tpl-var-unknown" title="⚠️ 알 수 없는 변수 — 발송 시 그대로 표시됩니다">${esc(name)}</span>`;
      }
      const tip = `${v.label} — 발송 시 '${v.sample}' 같은 값으로 자동 치환됩니다`;
      return `<span class="tpl-var" title="${esc(tip)}">${esc(name)}</span>`;
    });
  },

  // ─── 시스템 템플릿 복제 → 사용자 템플릿으로 ─────────────
  async cloneTemplate(id) {
    try {
      const r = await API.post(`/email-templates/${id}/clone`, {});
      Toast.success('템플릿이 복제되었습니다. 편집 모달을 엽니다.');
      if (typeof Email !== 'undefined') Email.templates = null; // 캐시 무효화
      await this.loadEmailTemplates();
      // 복제된 사용자 템플릿 편집 모달 자동 오픈
      if (r.id) await this.openTemplateForm(r.id);
    } catch (e) {
      Toast.error('복제 실패: ' + (e.message || ''));
    }
  },

  async openTemplateForm(id = null) {
    let tpl = { id: null, name: '', category: 'general', subject: '', body: '' };
    if (id) {
      try {
        const r = await API.get(`/email-templates/${id}`);
        tpl = r.data;
      } catch (e) {
        Toast.error('템플릿 로드 실패: ' + (e.message || ''));
        return;
      }
    }

    Modal.open({
      title: id ? '✉️ 템플릿 편집' : '✉️ 새 템플릿',
      width: 720,
      body: `
        <div class="form-grid" style="grid-template-columns: 120px 1fr; gap: 10px 12px; align-items: center">
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="tpl-name" maxlength="150" value="${esc(tpl.name)}">

          <label class="form-label">카테고리</label>
          <select class="form-input" id="tpl-category">
            <option value="lead"     ${tpl.category === 'lead' ? 'selected' : ''}>영업 리드</option>
            <option value="customer" ${tpl.category === 'customer' ? 'selected' : ''}>고객사</option>
            <option value="project"  ${tpl.category === 'project' ? 'selected' : ''}>프로젝트</option>
            <option value="general"  ${tpl.category === 'general' ? 'selected' : ''}>일반</option>
          </select>

          <label class="form-label">제목 *</label>
          <input type="text" class="form-input" id="tpl-subject" maxlength="300" value="${esc(tpl.subject)}">

          <label class="form-label" style="align-self:flex-start;padding-top:6px">본문 *</label>
          <textarea class="form-input" id="tpl-body" rows="12"
                    style="font-family:inherit;line-height:1.6">${esc(tpl.body)}</textarea>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-3);line-height:1.6">
          💡 변수: <code>{{customer_name}}</code>, <code>{{contact_person}}</code>,
          <code>{{project_name}}</code>, <code>{{my_name}}</code>,
          <code>{{my_company}}</code>, <code>{{today}}</code>,
          <code>{{bidding_deadline}}</code>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="tpl-cancel">취소</button>
        <button class="btn btn-primary" id="tpl-save">저장</button>
      `,
      bind: {
        '#tpl-cancel': () => Modal.close(),
        '#tpl-save': async () => {
          const data = {
            name: document.getElementById('tpl-name').value.trim(),
            category: document.getElementById('tpl-category').value,
            subject: document.getElementById('tpl-subject').value.trim(),
            body: document.getElementById('tpl-body').value,
          };
          if (!data.name || !data.subject || !data.body) {
            Toast.warn('이름·제목·본문은 필수입니다.');
            return;
          }
          try {
            if (id) {
              await API.put(`/email-templates/${id}`, data);
              Toast.success('템플릿이 수정되었습니다.');
            } else {
              await API.post('/email-templates', data);
              Toast.success('템플릿이 추가되었습니다.');
            }
            Modal.close();
            // Email 캐시 무효화
            if (typeof Email !== 'undefined') Email.templates = null;
            await this.loadEmailTemplates();
          } catch (e) {
            Toast.error('저장 실패: ' + (e.message || ''));
          }
        },
      },
    });
  },

  async deleteTemplate(id) {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
    try {
      await API.del(`/email-templates/${id}`);
      Toast.success('템플릿이 삭제되었습니다.');
      this.loadEmailTemplates();
      if (typeof Email !== 'undefined') Email.templates = null;
    } catch (e) {
      Toast.error('삭제 실패: ' + (e.message || ''));
    }
  },

  async checkDb() {
    const el = document.getElementById('db-status');
    el.innerHTML = '<div class="loading">확인중...</div>';
    try {
      const [team, leads, products] = await Promise.all([
        API.team.list(),
        API.leads.list(),
        API.products.list(),
      ]);
      el.innerHTML = `
        <div class="grid-3">
          <div class="db-stat">
            <div class="db-stat-label">팀원</div>
            <div class="db-stat-value">${team.data.length}<span class="metric-unit">건</span></div>
          </div>
          <div class="db-stat">
            <div class="db-stat-label">리드</div>
            <div class="db-stat-value">${leads.data.length}<span class="metric-unit">건</span></div>
          </div>
          <div class="db-stat">
            <div class="db-stat-label">상품/원가</div>
            <div class="db-stat-value">${products.data.length}<span class="metric-unit">건</span></div>
          </div>
        </div>
        <div class="alert alert-success mt-2">
          <strong>● 정상</strong> MariaDB 연결 정상. 모든 테이블 응답 OK.
        </div>
      `;
    } catch (err) {
      el.innerHTML = `
        <div class="alert alert-error">
          <strong>● 연결 실패</strong> MariaDB에 접속할 수 없습니다. .env 설정과 서비스 상태를 확인하세요.
          <div class="mono fs-12 mt-1">${esc(err.message)}</div>
        </div>
      `;
    }
  },

  openIntegration(name) {
    Modal.open({
      title: `${name} 연동 설정`,
      width: 520,
      body: `
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">API Endpoint URL</label>
            <input class="form-input mono" placeholder="https://...">
          </div>
          <div class="form-row">
            <label class="form-label">API Key</label>
            <input class="form-input mono" type="password" placeholder="••••••••••••••••">
          </div>
          <div class="form-row">
            <label class="form-label">동기화 주기 (분)</label>
            <input class="form-input" type="number" value="60">
          </div>
          <div class="form-row">
            <label class="form-label">매핑 규칙</label>
            <textarea class="form-input" rows="4" placeholder="예: leads.expected_amount → ${name === 'OnERP' ? 'erp.opportunity.amount' : 'gw.estimate.value'}"></textarea>
          </div>
          <div class="alert alert-info">
            ${name} API 키는 시스템 관리자가 발급합니다. 연동 후 첫 동기화는 5~10분 소요될 수 있습니다.
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="settings-int-cancel-btn">취소</button>
        <button class="btn btn-primary" id="settings-int-save-btn">저장 및 테스트</button>
      `,
      bind: {
        '#settings-int-cancel-btn': () => Modal.close(),
        '#settings-int-save-btn': () => {
          Toast.success(`${name} 연동 설정이 저장되었습니다`);
          Modal.close();
        },
      },
    });
  },
};
