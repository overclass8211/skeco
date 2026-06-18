// ============================================================
// MeetingPage — 미팅 녹음/업로드 → STT → 요약 → 저장 → 캘린더 등록
// ============================================================

// ── 녹음 전역 상태 (페이지 이동 시에도 유지) ──────────────
const MeetingRecorder = {
  mediaRecorder: null,
  recordedChunks: [],
  recordedBlob: null,
  recordingStartTime: 0,
  timerId: null, // 경과 시간 타이머
  mimeType: 'audio/webm',
  isRecording() {
    return this.mediaRecorder?.state === 'recording';
  },

  /** 상단 인디케이터 + 페이지 내 UI를 함께 갱신 */
  _tick() {
    const sec = Math.floor((Date.now() - this.recordingStartTime) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    const txt = `${m}:${s}`;

    // 상단 바 인디케이터 (항상 존재)
    const gTime = document.getElementById('rec-global-time');
    if (gTime) gTime.textContent = txt;

    // 회의록 페이지 내 (존재할 때만)
    const pTime = document.getElementById('rec-time');
    if (pTime) pTime.textContent = txt;
  },

  startTimer() {
    clearInterval(this.timerId);
    this.timerId = setInterval(() => this._tick(), 500);
  },

  stopTimer() {
    clearInterval(this.timerId);
    this.timerId = null;
  },

  showIndicator() {
    const el = document.getElementById('rec-global-indicator');
    if (el) el.style.display = '';
  },

  hideIndicator() {
    const el = document.getElementById('rec-global-indicator');
    if (el) el.style.display = 'none';
    const gTime = document.getElementById('rec-global-time');
    if (gTime) gTime.textContent = '00:00';
  },
};

const MeetingPage = (() => {
  let leads = [];
  let _googleStatus = { connected: false, configured: false, email: null };

  let _state = {
    transcript: '',
    speakers: [],
    summary: '',
    savedId: null,
    customerName: '',
    leadId: null,
  };

  async function fetchLeads() {
    try {
      const r = await API.leads.list();
      leads = r.data || [];
    } catch (_) {
      leads = [];
    }
  }

  // ── 1) 페이지 렌더 ─────────────────────────────────────
  async function render() {
    const el = document.getElementById('content');

    // 먼저 뼈대 렌더 (Google 상태 로딩 중)
    el.innerHTML = `
      <div class="filter-bar" style="margin-bottom:16px">
        <div class="card-title" style="margin-right:auto">🎤 회의록 AI</div>
        <button class="btn btn-ghost" id="meet-goto-list-btn">📋 회의록 목록</button>
      </div>

      <!-- 오프라인 녹음 큐 (있을 때만 표시) -->
      <div id="offline-queue-card" class="card" style="display:none;margin-bottom:14px;border-left:3px solid #f59e0b">
        <div class="card-header">
          <div class="card-title">📡 오프라인 녹음 대기 <span id="offline-queue-count" style="color:var(--text-3);font-size:12px"></span></div>
          <button class="btn btn-ghost btn-sm" id="offline-queue-retry-btn" style="display:none" title="대기/실패 항목 재처리">
            🔄 재처리
          </button>
        </div>
        <div class="card-body no-pad" id="offline-queue-list"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <!-- 실시간 녹음 -->
        <div class="card">
          <div class="card-header"><div class="card-title">🔴 미팅 실시간 녹음</div></div>
          <div class="card-body" style="text-align:center;padding:24px">
            <div id="rec-visual" class="rec-visual"></div>
            <div id="rec-time" class="rec-time">00:00</div>
            <div id="rec-status" style="font-size:12px;color:var(--text-3);margin-bottom:14px">대기 중</div>
            <button class="btn btn-primary" id="rec-start-btn">
              ● 녹음 시작
            </button>
            <button class="btn btn-ghost text-danger" id="rec-stop-btn" style="display:none">
              ■ 녹음 중지
            </button>
          </div>
        </div>

        <!-- 파일 업로드 -->
        <div class="card">
          <div class="card-header"><div class="card-title">📁 녹음 파일 업로드</div></div>
          <div class="card-body">
            <div id="audio-dropzone">
              <div style="font-size:32px;margin-bottom:8px">🎵</div>
              <div style="font-size:13px;font-weight:600">오디오 파일을 드롭하거나 클릭해서 선택</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:4px">
                MP3 / WAV / M4A / WEBM / OGG · 최대 25MB
              </div>
              <input type="file" id="audio-file-input" accept="audio/*" style="display:none">
            </div>
            <div id="audio-file-info" style="margin-top:10px"></div>
          </div>
        </div>
      </div>

      <!-- Google Meet 연동 카드 -->
      <div class="card" style="margin-bottom:14px" id="gmeet-card" data-feature="crm.meeting_rec">
        <div class="card-header">
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" style="flex-shrink:0">
              <path fill="#00832d" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
            Google Meet 연동
          </div>
          <div id="gmeet-status-badge"></div>
        </div>
        <div class="card-body" id="gmeet-body">
          <div class="loading" style="padding:20px;text-align:center">연결 상태 확인 중...</div>
        </div>
      </div>

      <!-- 처리 결과 영역 -->
      <div id="meeting-result" style="display:none">
        <div class="card" style="margin-bottom:14px">
          <div class="card-header">
            <div class="card-title">🗣 음성 인식 결과 (화자 분리)</div>
            <span id="meeting-stats" style="font-size:11px;color:var(--text-3)"></span>
          </div>
          <div id="speakers-list" class="card-body" style="max-height:280px;overflow-y:auto"></div>
        </div>

        <div class="card" style="margin-bottom:14px">
          <div class="card-header">
            <div class="card-title">📝 AI 요약 회의록</div>
            <button class="btn btn-ghost btn-sm" id="meeting-regen-btn" style="display:none">
              🔄 다시 생성
            </button>
          </div>
          <div id="meeting-summary" class="card-body markdown-body" style="line-height:1.7;font-size:13px;min-height:120px">
            <span class="ai-cursor">▋</span>
          </div>
        </div>

        <!-- 메타 정보 + 저장 -->
        <div class="card">
          <div class="card-body">
            <div class="form-row-3">
              <div class="form-row">
                <label class="form-label">미팅 제목</label>
                <input class="form-input" id="meeting-title" placeholder="예: 삼성케미칼 분기 정기 미팅">
              </div>
              <div class="form-row">
                <label class="form-label">미팅 일자</label>
                <input type="date" class="form-input" id="meeting-date" value="${new Date().toISOString().slice(0, 10)}">
              </div>
              <div class="form-row">
                <label class="form-label">고객사 (선택)</label>
                <input class="form-input" id="meeting-customer" list="meeting-leads-list" placeholder="고객사 또는 빈칸">
                <datalist id="meeting-leads-list"></datalist>
              </div>
            </div>
            <div style="text-align:right;margin-top:14px">
              <button class="btn btn-ghost" id="meeting-reset-btn">초기화</button>
              <button class="btn btn-primary" id="meeting-save-btn" disabled>💾 회의록 저장</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // bind render() buttons
    document
      .getElementById('meet-goto-list-btn')
      ?.addEventListener('click', () => App.navigate('meeting-list'));
    document.getElementById('rec-start-btn')?.addEventListener('click', () => startRecording());
    document.getElementById('rec-stop-btn')?.addEventListener('click', () => stopRecording());
    document
      .getElementById('meeting-regen-btn')
      ?.addEventListener('click', () => regenerateSummary());
    document.getElementById('meeting-reset-btn')?.addEventListener('click', () => reset());
    document.getElementById('meeting-save-btn')?.addEventListener('click', () => save());

    // audio dropzone
    const dropzone = document.getElementById('audio-dropzone');
    if (dropzone) {
      dropzone.addEventListener('click', () =>
        document.getElementById('audio-file-input')?.click()
      );
      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
      dropzone.addEventListener('drop', e => _handleDrop(e));
    }
    document
      .getElementById('audio-file-input')
      ?.addEventListener('change', e => _handleFile(e.target.files[0]));

    // 병렬 로드
    await Promise.all([fetchLeads(), _loadGmeetSection()]);

    const dl = document.getElementById('meeting-leads-list');
    if (dl) {
      dl.innerHTML = leads
        .map(
          l =>
            `<option value="${esc(l.customer_name || '')}">${esc(l.customer_name || '')}${l.project_name ? ' - ' + esc(l.project_name) : ''}</option>`
        )
        .join('');
    }

    // 녹음이 이미 진행 중이면 UI 복원
    if (MeetingRecorder.isRecording()) {
      _restoreRecordingUI();
    }

    // 오프라인 큐 항목 표시 (있을 때만 카드 노출)
    _renderOfflineQueue();

    // Google OAuth 팝업 결과 수신
    window.addEventListener('message', _onGoogleMessage, { once: false });
  }

  // ── Google Meet 섹션 로드 ──────────────────────────────
  async function _loadGmeetSection() {
    try {
      const res = await API.google.status();
      _googleStatus = res.data;
      _renderGmeetSection();
    } catch (_) {
      const body = document.getElementById('gmeet-body');
      if (body)
        body.innerHTML =
          '<div style="color:var(--text-3);font-size:12px;padding:8px">Google 연동 상태를 확인할 수 없습니다.</div>';
    }
  }

  function _renderGmeetSection() {
    const badge = document.getElementById('gmeet-status-badge');
    const body = document.getElementById('gmeet-body');
    if (!body) return;

    const { connected, configured, email } = _googleStatus;

    if (badge) {
      badge.innerHTML = connected
        ? `<span class="badge badge-google-connected" style="border:none;font-size:11px">● 연결됨 · ${esc(email || '')}</span>`
        : `<span class="badge" style="background:var(--surface-2);color:var(--text-3);border:none;font-size:11px">미연결</span>`;
    }

    if (!configured) {
      body.innerHTML = `
        <div class="gmeet-setup-guide">
          <div style="font-size:28px;margin-bottom:10px">🔑</div>
          <div style="font-weight:600;margin-bottom:6px">Google OAuth 설정 필요</div>
          <div style="font-size:12px;color:var(--text-2);line-height:1.7;margin-bottom:14px">
            서버 관리자가 <code>.env</code> 파일에 Google OAuth 정보를 입력해야 합니다.<br>
            <strong>GOOGLE_CLIENT_ID</strong> / <strong>GOOGLE_CLIENT_SECRET</strong>
          </div>
          <button class="btn btn-ghost btn-sm" id="gmeet-setup-guide-btn">
            📖 설정 가이드 보기
          </button>
        </div>`;
      document
        .getElementById('gmeet-setup-guide-btn')
        ?.addEventListener('click', () => _showGoogleSetupGuide());
      return;
    }

    if (!connected) {
      body.innerHTML = `
        <div class="gmeet-connect-panel">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div>
              <div style="font-size:13px;font-weight:600;margin-bottom:4px">Google 계정을 연결하세요</div>
              <div style="font-size:12px;color:var(--text-2)">
                연결 후 Google Meet 링크를 바로 생성하고 회의록과 연동할 수 있습니다.
              </div>
            </div>
            <button class="btn btn-primary gmeet-google-btn" id="gmeet-connect-btn" style="flex-shrink:0">
              <svg width="16" height="16" viewBox="0 0 24 24" style="margin-right:6px">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google 계정 연결
            </button>
          </div>
        </div>`;
      document
        .getElementById('gmeet-connect-btn')
        ?.addEventListener('click', () => connectGoogle());
      return;
    }

    // 연결된 상태 — 미팅 생성 폼 + 최근 세션
    const now = new Date();
    const defDt = new Date(now.getTime() + 30 * 60_000);
    const defStr = `${defDt.getFullYear()}-${String(defDt.getMonth() + 1).padStart(2, '0')}-${String(defDt.getDate()).padStart(2, '0')}T${String(defDt.getHours()).padStart(2, '0')}:${String(defDt.getMinutes()).padStart(2, '0')}`;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start">
        <!-- 생성 폼 -->
        <div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <div style="flex:2;min-width:160px">
              <label class="form-label" style="font-size:11px">미팅 제목</label>
              <input class="form-input form-input-sm" id="gmeet-title" value="영업 미팅" style="height:34px">
            </div>
            <div style="flex:1;min-width:160px">
              <label class="form-label" style="font-size:11px">시작 일시</label>
              <input type="datetime-local" class="form-input form-input-sm" id="gmeet-datetime" value="${defStr}" style="height:34px">
            </div>
            <div style="width:90px">
              <label class="form-label" style="font-size:11px">소요 시간</label>
              <select class="form-input form-input-sm" id="gmeet-duration" style="height:34px">
                <option value="30">30분</option>
                <option value="60" selected>1시간</option>
                <option value="90">1.5시간</option>
                <option value="120">2시간</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="gmeet-create-btn">
            📹 Meet 링크 생성
          </button>
          <button class="btn btn-ghost btn-sm" id="gmeet-disconnect-btn" style="margin-left:6px;font-size:11px;color:var(--text-3)">연결 해제</button>
        </div>

        <!-- 생성된 링크 표시 -->
        <div id="gmeet-link-box" style="min-width:260px;display:none">
        </div>
      </div>

      <!-- 📧 Gmail 자동 동기화 (Phase G3) ───────────────────────── -->
      <div id="gmail-sync-box" style="margin-top:14px;padding:12px 14px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-size:13px;font-weight:600;margin-bottom:2px">
              📧 Gmail 자동 동기화
              <span id="gmail-sync-status" style="font-size:10px;color:var(--text-3);margin-left:6px"></span>
            </div>
            <div style="font-size:11px;color:var(--text-2);line-height:1.5">
              5분 주기로 새 메일 자동 매칭 → 고객사 활동 이력에 자동 기록
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" id="gmail-sync-now-btn" title="지금 즉시 동기화">⚡ 지금 동기화</button>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:500">
              <input type="checkbox" id="gmail-sync-toggle" style="width:16px;height:16px;cursor:pointer">
              <span id="gmail-sync-label">활성화</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 최근 Meet 세션 -->
      <div id="gmeet-recent" style="margin-top:14px"></div>
    `;

    document.getElementById('gmeet-create-btn')?.addEventListener('click', () => createMeet());
    document
      .getElementById('gmeet-disconnect-btn')
      ?.addEventListener('click', () => disconnectGoogle());

    _loadRecentMeetSessions();
    _loadGmailSyncSettings();
  }

  // ── 📧 Gmail 자동 동기화 설정 로드/토글 (Phase G3) ────────────
  async function _loadGmailSyncSettings() {
    const toggle = document.getElementById('gmail-sync-toggle');
    const status = document.getElementById('gmail-sync-status');
    const syncBtn = document.getElementById('gmail-sync-now-btn');
    if (!toggle) return;

    try {
      const r = await API.gmail.syncSettings();
      const d = r.data || {};
      toggle.checked = !!d.enabled;
      if (status) {
        const isInvalidGrant =
          (d.error || '').includes('인증이 만료') || /invalid_grant/i.test(d.error || '');
        if (d.enabled) {
          const last = d.last_polled_at
            ? new Date(d.last_polled_at).toLocaleString('ko-KR')
            : '아직 없음';
          status.textContent = `· 마지막 폴링: ${last}`;
          if (d.error)
            status.innerHTML += ` · <span style="color:var(--oci-red)">⚠️ ${esc(d.error)}</span>`;
        } else if (isInvalidGrant) {
          // 자동 비활성화된 상태 — 재연결 안내
          status.innerHTML = `· <span style="color:var(--oci-red);font-weight:600">⚠️ 재연결 필요</span> · <span style="font-size:11px">${esc(d.error)}</span>`;
        } else {
          status.textContent = '· 비활성';
        }
      }
    } catch (_) {}

    toggle.onchange = async () => {
      try {
        await API.gmail.setSync(toggle.checked);
        Toast.success(
          toggle.checked ? '📧 Gmail 자동 동기화 활성화' : 'Gmail 자동 동기화 비활성화'
        );
        _loadGmailSyncSettings();
      } catch (err) {
        toggle.checked = !toggle.checked; // 롤백
        Toast.error('설정 변경 실패: ' + (err.message || ''));
      }
    };

    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      const orig = syncBtn.textContent;
      syncBtn.textContent = '⏳ 동기화 중...';
      try {
        const r = await API.gmail.syncNow();
        const d = r.data || {};
        if (d.error === 'disabled') {
          Toast.warn?.('동기화가 비활성 상태입니다. 토글을 켜주세요.');
        } else if (d.reason === 'invalid_grant') {
          // 자동 비활성화됨 — 재연결 안내
          Toast.error('⚠️ Google 재연결 필요 — 위 "연결 해제" 클릭 후 다시 연결해 주세요');
        } else if (d.error) {
          Toast.error('동기화 실패: ' + d.error);
        } else {
          Toast.success(`✅ ${d.inserted || 0}건 새로 기록 · ${d.matched || 0}건 매칭`);
        }
        _loadGmailSyncSettings();
      } catch (err) {
        Toast.error('동기화 실패: ' + (err.message || ''));
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = orig;
      }
    };
  }

  async function _loadRecentMeetSessions() {
    const el = document.getElementById('gmeet-recent');
    if (!el) return;
    try {
      const res = await API.google.meet.list();
      const rows = res.data || [];
      if (!rows.length) {
        el.innerHTML = '';
        return;
      }

      el.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:var(--text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">
          최근 생성된 미팅
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${rows
            .map(
              r => `
            <div class="gmeet-session-row">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${esc(r.title || '미팅')}
                </div>
                <div style="font-size:11px;color:var(--text-3)">
                  ${r.scheduled_at ? new Date(r.scheduled_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '즉시'}
                  · ${r.duration_min}분
                  ${r.minutes_title ? `· <span style="color:#1a73e8">📝 ${esc(r.minutes_title)}</span>` : ''}
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-ghost btn-xs" data-action="copy-meet-link" data-link="${esc(r.meet_link)}">복사</button>
                <a class="btn btn-primary btn-xs" href="${esc(r.meet_link)}" target="_blank" rel="noopener">참여</a>
              </div>
            </div>`
            )
            .join('')}
        </div>`;
      el.addEventListener('click', e => {
        const btn = e.target.closest('[data-action="copy-meet-link"]');
        if (btn) _copyLink(btn.dataset.link);
      });
    } catch (_) {
      if (el) el.innerHTML = '';
    }
  }

  function _onGoogleMessage(e) {
    if (!e.data || e.data.type !== 'google_oauth') return;
    if (e.data.success) {
      _googleStatus = { connected: true, configured: true, email: e.data.email };
      _renderGmeetSection();
      Toast.success(`Google 계정 연결 완료 (${e.data.email})`);
    } else {
      Toast.error('Google 연결 실패: ' + (e.data.error || '알 수 없는 오류'));
    }
  }

  /** 화면으로 돌아왔을 때 녹음 중 UI 복원 */
  function _restoreRecordingUI() {
    const startBtn = document.getElementById('rec-start-btn');
    const stopBtn = document.getElementById('rec-stop-btn');
    const visual = document.getElementById('rec-visual');
    const status = document.getElementById('rec-status');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
    if (visual) visual.classList.add('recording');
    if (status) status.textContent = '🔴 녹음 중...';
    // 즉시 한 번 갱신 (경과 시간 표시)
    MeetingRecorder._tick();
  }

  // ── Google Meet 액션 함수들 ──────────────────────────────

  /** Google 계정 연결 — 팝업 방식 */
  async function connectGoogle() {
    try {
      const res = await API.google.authUrl();
      const popup = window.open(
        res.url,
        'google_oauth',
        'width=520,height=640,left=' +
          Math.round((screen.width - 520) / 2) +
          ',top=' +
          Math.round((screen.height - 640) / 2)
      );
      if (!popup) Toast.error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
    } catch (err) {
      Toast.error(err.message);
    }
  }

  /** Google Meet 링크 생성 */
  async function createMeet() {
    const btn = document.getElementById('gmeet-create-btn');
    const title = document.getElementById('gmeet-title')?.value.trim() || '영업 미팅';
    const dt = document.getElementById('gmeet-datetime')?.value;
    const dur = parseInt(document.getElementById('gmeet-duration')?.value || '60');

    if (btn) {
      btn.disabled = true;
      btn.textContent = '생성 중...';
    }
    try {
      const res = await API.google.meet.create({
        title,
        scheduled_at: dt ? new Date(dt).toISOString() : null,
        duration_min: dur,
      });
      _showMeetLink(res.data);
      _loadRecentMeetSessions();
      Toast.success('Google Meet 링크가 생성되었습니다');
    } catch (err) {
      if (err.notConnected) {
        _googleStatus.connected = false;
        _renderGmeetSection();
      }
      Toast.error(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📹 Meet 링크 생성';
      }
    }
  }

  /** 생성된 링크 박스 표시 */
  function _showMeetLink(data) {
    const box = document.getElementById('gmeet-link-box');
    if (!box) return;
    box.style.display = '';
    box.innerHTML = `
      <div class="gmeet-link-card">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#00832d" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
          <span style="font-size:12px;font-weight:600;color:var(--text-1)">${esc(data.title)}</span>
        </div>
        <div class="gmeet-link-url" id="gmeet-current-link">${esc(data.meet_link)}</div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn btn-ghost btn-sm" style="flex:1" id="gmeet-copy-link-btn">
            📋 링크 복사
          </button>
          <a class="btn btn-primary btn-sm" style="flex:1;text-align:center" href="${esc(data.meet_link)}" target="_blank" rel="noopener">
            📹 참여하기
          </a>
        </div>
        <button class="btn btn-ghost btn-sm" id="gmeet-start-recording-btn" style="width:100%;margin-top:6px;color:#d93025;font-size:11px">
          🔴 녹음 동시 시작
        </button>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px;text-align:center">
          ${data.scheduled_at ? new Date(data.scheduled_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '즉시 사용 가능'} · ${data.duration_min}분
        </div>
      </div>`;
    document
      .getElementById('gmeet-copy-link-btn')
      ?.addEventListener('click', () => _copyLink(data.meet_link));
    document
      .getElementById('gmeet-start-recording-btn')
      ?.addEventListener('click', () => startRecordingFromMeet());
  }

  /** 링크 복사 */
  function _copyLink(url) {
    navigator.clipboard.writeText(url).then(
      () => Toast.success('링크가 클립보드에 복사되었습니다'),
      () => {
        prompt('링크를 복사하세요:', url);
      }
    );
  }

  /** Google Meet + 녹음 동시 시작 */
  function startRecordingFromMeet() {
    if (!MeetingRecorder.isRecording()) startRecording();
    else Toast.info('이미 녹음 중입니다');
  }

  /** Google 계정 연결 해제 */
  async function disconnectGoogle() {
    if (!confirm('Google 계정 연결을 해제하시겠습니까?')) return;
    try {
      await API.google.disconnect();
      _googleStatus = { connected: false, configured: true, email: null };
      _renderGmeetSection();
      Toast.success('Google 계정 연결이 해제되었습니다');
    } catch (err) {
      Toast.error(err.message);
    }
  }

  /** Google OAuth 설정 가이드 */
  function _showGoogleSetupGuide() {
    Modal.open({
      title: '📖 Google OAuth 설정 가이드',
      width: 580,
      body: `
        <div style="font-size:13px;line-height:1.8;color:var(--text-1)">
          <ol style="padding-left:18px;margin:0">
            <li><a href="https://console.cloud.google.com/" target="_blank" style="color:#1a73e8">Google Cloud Console</a>에 접속합니다.</li>
            <li><strong>새 프로젝트</strong>를 생성하거나 기존 프로젝트를 선택합니다.</li>
            <li>좌측 메뉴 → <strong>API 및 서비스 → OAuth 동의 화면</strong> 설정<br>
              <span style="font-size:11px;color:var(--text-3)">User Type: 외부 / 앱 이름 입력 / 저장</span>
            </li>
            <li><strong>API 및 서비스 → 사용자 인증 정보</strong> → <strong>+ 사용자 인증 정보 만들기</strong> → <strong>OAuth 클라이언트 ID</strong></li>
            <li>애플리케이션 유형: <strong>웹 애플리케이션</strong><br>
              승인된 리디렉션 URI: <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">http://localhost:3001/api/google/callback</code>
            </li>
            <li>생성된 <strong>클라이언트 ID</strong>와 <strong>클라이언트 보안 비밀번호</strong>를 복사합니다.</li>
            <li>서버의 <code>.env</code> 파일에 아래 내용을 추가합니다:
              <pre style="background:var(--surface-2);padding:10px;border-radius:6px;margin-top:6px;font-size:11px;overflow-x:auto">GOOGLE_CLIENT_ID=발급받은_클라이언트_ID
GOOGLE_CLIENT_SECRET=발급받은_보안_비밀번호
GOOGLE_REDIRECT_URI=http://localhost:3001/api/google/callback</pre>
            </li>
            <li><strong>서버를 재시작</strong>합니다.</li>
          </ol>
          <div style="margin-top:12px;padding:10px;background:var(--surface-2);border-radius:6px;font-size:11px;color:var(--text-2)">
            💡 Google Calendar API와 Google Meet를 함께 사용하려면 <strong>Google Calendar API</strong>를 활성화해야 합니다.<br>
            (API 및 서비스 → 라이브러리 → "Google Calendar API" 검색 → 사용 설정)
          </div>
        </div>`,
      footer: `<button class="btn btn-primary" id="google-guide-ok-btn">확인</button>`,
      bind: { '#google-guide-ok-btn': () => Modal.close() },
    });
  }

  // ── 2) 녹음 ─────────────────────────────────────────────
  async function startRecording() {
    if (MeetingRecorder.isRecording()) return; // 이미 녹음 중이면 무시

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      MeetingRecorder.mimeType = mime;
      MeetingRecorder.recordedChunks = [];
      MeetingRecorder.recordedBlob = null;
      MeetingRecorder.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });

      MeetingRecorder.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) MeetingRecorder.recordedChunks.push(e.data);
      };

      MeetingRecorder.mediaRecorder.onstop = () => {
        // 마이크 스트림 종료
        stream.getTracks().forEach(t => t.stop());

        MeetingRecorder.recordedBlob = new Blob(MeetingRecorder.recordedChunks, {
          type: MeetingRecorder.mimeType,
        });
        MeetingRecorder.stopTimer();
        MeetingRecorder.hideIndicator();

        // 녹음 완료 UI 업데이트 (페이지가 열려 있을 때만)
        const status = document.getElementById('rec-status');
        const visual = document.getElementById('rec-visual');
        const startBtn = document.getElementById('rec-start-btn');
        const stopBtn = document.getElementById('rec-stop-btn');
        if (status)
          status.textContent = `✅ 녹음 완료 (${(MeetingRecorder.recordedBlob.size / 1024).toFixed(0)} KB)`;
        if (visual) visual.classList.remove('recording');
        if (startBtn) startBtn.style.display = '';
        if (stopBtn) stopBtn.style.display = 'none';

        const filename = `recording-${Date.now()}.webm`;
        const onMeetingPage = !!document.getElementById('rec-visual');

        // ── 오프라인 분기 — IndexedDB 큐에 저장 후 종료 (온라인 복귀 시 자동 처리) ──
        if (!navigator.onLine && typeof OfflineQueue !== 'undefined') {
          const customer = document.getElementById('meeting-customer')?.value || '';
          const date = document.getElementById('meeting-date')?.value || '';
          const title = document.getElementById('meeting-title')?.value || '';
          const sizeKB = (MeetingRecorder.recordedBlob.size / 1024).toFixed(0);
          OfflineQueue.add(MeetingRecorder.recordedBlob, {
            filename,
            customer_name: customer,
            meeting_date: date,
            meeting_title: title,
          })
            .then(() => {
              Toast.info(`📡 오프라인 — 녹음 ${sizeKB}KB 저장됨. 온라인 복귀 시 자동 처리됩니다.`);
              if (onMeetingPage) _renderOfflineQueue();
            })
            .catch(err => {
              Toast.error(
                '오프라인 저장 실패: ' + err.message + ' — 브라우저 저장 공간을 확인해 주세요.'
              );
            });
          return;
        }

        // 현재 회의록 페이지가 아닌 경우: 처리 후 페이지로 이동
        if (!onMeetingPage) {
          Toast.info('녹음이 완료되었습니다. 회의록 화면에서 결과를 확인하세요.');
          App.navigate('meeting').then(() => {
            _processAudio(MeetingRecorder.recordedBlob, filename);
          });
        } else {
          _processAudio(MeetingRecorder.recordedBlob, filename);
        }
      };

      MeetingRecorder.mediaRecorder.start();
      MeetingRecorder.recordingStartTime = Date.now();
      MeetingRecorder.startTimer();
      MeetingRecorder.showIndicator();

      // 페이지 내 UI 업데이트
      const status = document.getElementById('rec-status');
      const visual = document.getElementById('rec-visual');
      const startBtn = document.getElementById('rec-start-btn');
      const stopBtn = document.getElementById('rec-stop-btn');
      if (status) status.textContent = '🔴 녹음 중...';
      if (visual) visual.classList.add('recording');
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = '';
    } catch (err) {
      Toast.error('마이크 접근 권한이 필요합니다: ' + err.message);
    }
  }

  function stopRecording() {
    if (MeetingRecorder.mediaRecorder && MeetingRecorder.mediaRecorder.state !== 'inactive') {
      MeetingRecorder.mediaRecorder.stop();
    }
  }

  // ── 3) 파일 업로드 ──────────────────────────────────────
  function _handleDrop(e) {
    e.preventDefault();
    document.getElementById('audio-dropzone').classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) _handleFile(f);
  }
  function _handleFile(file) {
    if (!file) return;
    if (
      !file.type.startsWith('audio/') &&
      !/\.(mp3|wav|m4a|webm|ogg|opus|flac)$/i.test(file.name)
    ) {
      Toast.error('오디오 파일만 업로드 가능합니다');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      Toast.error('파일은 25MB 이하만 가능합니다');
      return;
    }
    document.getElementById('audio-file-info').innerHTML =
      `<div style="font-size:12px;color:var(--text-2);background:var(--surface-2);padding:8px 12px;border-radius:6px">
        🎵 <strong>${esc(file.name)}</strong> (${(file.size / 1024).toFixed(0)} KB)
      </div>`;
    _processAudio(file, file.name);
  }

  // ── 4) STT + 요약 처리 파이프라인 ───────────────────────
  async function _processAudio(blob, filename) {
    document.getElementById('meeting-result').style.display = '';
    const speakersEl = document.getElementById('speakers-list');
    const summaryEl = document.getElementById('meeting-summary');
    const statsEl = document.getElementById('meeting-stats');

    speakersEl.innerHTML =
      '<div class="loading" style="padding:20px;text-align:center">📤 업로드 중...</div>';
    summaryEl.innerHTML = '<span class="ai-cursor">▋ 음성 인식 완료 후 요약 시작</span>';
    statsEl.textContent = '';

    try {
      const fd = new FormData();
      fd.append('audio', blob, filename);
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const uid = localStorage.getItem('current_user_id');
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (uid) headers['X-User-Id'] = uid;

      // 1) 업로드 — 비동기 패턴 (긴 녹음 120분+ 대응).
      //    업로드 자체는 짧음 (~수십 초). nginx/proxy timeout 무관.
      //    실제 STT 는 백그라운드에서 진행되고 클라이언트는 status 폴링.
      const uploadAborter = new AbortController();
      const uploadTimer = setTimeout(() => uploadAborter.abort(), 5 * 60 * 1000); // 5분 (큰 파일 업로드 여유)

      let uploadRes;
      try {
        uploadRes = await fetch('/api/meeting/transcribe-async', {
          method: 'POST',
          body: fd,
          headers,
          signal: uploadAborter.signal,
        });
      } catch (netErr) {
        clearTimeout(uploadTimer);
        const msg =
          netErr.name === 'AbortError'
            ? '업로드 시간이 초과되었습니다 (5분). 네트워크를 확인해 주세요.'
            : `업로드 오류: ${netErr.message}`;
        speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(msg)}</div>`;
        summaryEl.innerHTML = '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
        return;
      }
      clearTimeout(uploadTimer);

      let uploadJson;
      try {
        uploadJson = await uploadRes.json();
      } catch (_) {
        const status = uploadRes.status;
        const hint =
          status === 413
            ? '파일이 너무 큽니다 (최대 100MB). 녹음을 분할해 주세요.'
            : `업로드 응답을 해석할 수 없습니다 (HTTP ${status}).`;
        speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(hint)}</div>`;
        summaryEl.innerHTML = '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
        return;
      }
      if (!uploadJson.success || !uploadJson.job_id) {
        speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(uploadJson.error || '업로드 실패')}</div>`;
        summaryEl.innerHTML = '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
        return;
      }

      // 2) 상태 폴링 (5초 간격, 최대 30분).
      //    각 폴링 요청은 즉시 응답 → 프록시/브라우저 timeout 무관.
      const jobId = uploadJson.job_id;
      const pollStartedAt = Date.now();
      const MAX_POLL_MS = 30 * 60 * 1000;
      const POLL_INTERVAL_MS = 5000;
      let sttData = null;
      let consecErrors = 0;

      while (true) {
        if (Date.now() - pollStartedAt > MAX_POLL_MS) {
          speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ 음성 인식이 30분을 초과했습니다. 녹음을 분할해 주세요.</div>`;
          summaryEl.innerHTML =
            '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
          return;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        let statRes;
        try {
          statRes = await fetch(`/api/meeting/transcribe-status/${encodeURIComponent(jobId)}`, {
            headers,
          });
        } catch (_) {
          // 일시적 네트워크 끊김 — 다음 폴링 시도 (3회 연속 실패 시 중단)
          if (++consecErrors >= 3) {
            speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ 서버 상태 폴링 실패 (네트워크 확인). 작업 ID: ${esc(jobId)}</div>`;
            summaryEl.innerHTML =
              '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
            return;
          }
          continue;
        }

        let stat;
        try {
          stat = await statRes.json();
        } catch (_) {
          if (++consecErrors >= 3) {
            speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ 서버 응답 해석 실패 (HTTP ${statRes.status})</div>`;
            summaryEl.innerHTML =
              '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
            return;
          }
          continue;
        }
        consecErrors = 0;

        const elapsed = stat.elapsed_sec ?? Math.round((Date.now() - pollStartedAt) / 1000);
        if (stat.status === 'done') {
          sttData = stat.data;
          break;
        }
        if (stat.status === 'error' || stat.status === 'cancelled' || stat.success === false) {
          speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(stat.error || '음성 인식 실패')}</div>`;
          summaryEl.innerHTML =
            '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
          return;
        }
        // 진행 표시 — 분/초 카운터
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const stage = stat.status === 'pending' ? '⏳ 대기 중' : '🎙 음성 인식 중';
        speakersEl.innerHTML = `<div class="loading" style="padding:20px;text-align:center">${stage}... (${mins}분 ${secs}초 경과)</div>`;
      }

      _state.transcript = sttData.transcript;
      _state.speakers = sttData.speakers || [];

      _renderSpeakers();
      statsEl.textContent = `${_state.speakers.length}개 화자 구간 · ${_state.transcript.length}자`;

      summaryEl.innerHTML = '<div class="loading">✏️ AI 요약 생성 중...</div>';
      const customer = document.getElementById('meeting-customer')?.value || '';
      const date = document.getElementById('meeting-date')?.value || '';
      const sumRes = await API.meetings.summarize({
        transcript: _state.transcript,
        speakers: _state.speakers,
        customer_name: customer,
        meeting_date: date,
      });

      if (sumRes.success) {
        _state.summary = sumRes.data.summary_md;
        summaryEl.innerHTML = AI.renderMarkdown(_state.summary);
        document.getElementById('meeting-save-btn').disabled = false;
        document.getElementById('meeting-regen-btn').style.display = '';
        const titleEl = document.getElementById('meeting-title');
        if (titleEl && !titleEl.value) {
          const firstAgenda = _state.summary.match(/##\s*미팅 주요 어젠다\s*\n-\s*(.+)/);
          titleEl.value = firstAgenda ? firstAgenda[1].slice(0, 60) : `회의록 ${date}`;
        }
        if (typeof UserPrefs !== 'undefined') UserPrefs.refreshTokens();
      } else {
        summaryEl.innerHTML = `<div style="color:var(--oci-red)">⚠️ ${esc(sumRes.error)}</div>`;
      }
    } catch (err) {
      console.error(err);
      speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function _renderSpeakers() {
    const el = document.getElementById('speakers-list');
    if (!_state.speakers.length) {
      el.innerHTML = '<div class="empty">화자 구분 결과가 없습니다</div>';
      return;
    }
    const colors = ['#1664E5', '#00A86B', '#F59C00', '#7C4DFF', '#E63329', '#0EA5E9'];
    el.innerHTML = _state.speakers
      .map(s => {
        const c = colors[(s.speaker - 1) % colors.length];
        return `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:${c};color:#fff;
                      display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px">
            ${s.speaker}
          </div>
          <div style="flex:1;font-size:13px;line-height:1.6">
            <div style="font-size:11px;font-weight:600;color:${c};margin-bottom:2px">화자 ${s.speaker}</div>
            ${esc(s.text)}
          </div>
        </div>`;
      })
      .join('');
  }

  // ── 5) 요약 재생성 ──────────────────────────────────────
  async function regenerateSummary() {
    if (!_state.transcript) return;
    const summaryEl = document.getElementById('meeting-summary');
    summaryEl.innerHTML = '<div class="loading">✏️ AI 재요약 중...</div>';
    try {
      const sumRes = await API.meetings.summarize({
        transcript: _state.transcript,
        speakers: _state.speakers,
        customer_name: document.getElementById('meeting-customer')?.value || '',
        meeting_date: document.getElementById('meeting-date')?.value || '',
      });
      if (sumRes.success) {
        _state.summary = sumRes.data.summary_md;
        summaryEl.innerHTML = AI.renderMarkdown(_state.summary);
        if (typeof UserPrefs !== 'undefined') UserPrefs.refreshTokens();
      }
    } catch (err) {
      Toast.error(err.message);
    }
  }

  // ── 6) 저장 + 캘린더 등록 플로우 ────────────────────────
  async function save() {
    const title =
      document.getElementById('meeting-title').value.trim() ||
      `회의록 ${new Date().toISOString().slice(0, 10)}`;
    const date = document.getElementById('meeting-date').value;
    const customer = document.getElementById('meeting-customer').value.trim();

    try {
      const r = await API.meetings.create({
        title,
        meeting_date: date,
        raw_transcript: _state.transcript,
        speakers_json: _state.speakers,
        summary_md: _state.summary,
        customer_name: customer,
      });
      if (r.success) {
        _state.savedId = r.id;
        _state.customerName = customer;
        Toast.success('회의록이 저장되었습니다');
        _askCalendarRegister();
      }
    } catch (err) {
      Toast.error('저장 실패: ' + err.message);
    }
  }

  function _askCalendarRegister() {
    Modal.open({
      title: '📅 캘린더 등록',
      width: 460,
      body: `
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:36px;margin-bottom:12px">📅</div>
          <div style="font-size:15px;font-weight:600;color:var(--text-1);margin-bottom:8px">
            미팅록 저장 완료
          </div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.6">
            핵심 영업활동 내용을 캘린더에 등록 하시겠습니까?<br>
            <span style="font-size:11px;color:var(--text-3)">미팅 일정 + 액션 아이템들이 자동으로 캘린더에 등록됩니다</span>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" id="cal-no-btn">아니오</button>
        <button class="btn btn-primary" id="cal-yes-btn">예, 등록하기</button>`,
      bind: {
        '#cal-no-btn': () => _calendarNo(),
        '#cal-yes-btn': () => _calendarYes(),
      },
    });
  }

  function _calendarNo() {
    Modal.close();
    Toast.info('회의록만 저장되었습니다');
    setTimeout(() => App.navigate('meeting-list'), 600);
  }

  function _calendarYes() {
    Modal.close();
    setTimeout(() => _askCustomerOrDeal(), 200);
  }

  function _askCustomerOrDeal() {
    // Unique customer names from App.customers (CRM) + leads
    const crmNames = (App.customers || []).map(c => c.name || c.company_name || '').filter(Boolean);
    const leadNames = leads.map(l => l.customer_name || '').filter(Boolean);
    const allCustomers = [...new Set([...crmNames, ...leadNames])].sort((a, b) =>
      a.localeCompare(b)
    );

    const pre = _state.customerName || '';
    const preInList = allCustomers.includes(pre);

    const customerOpts = allCustomers
      .map(c => `<option value="${esc(c)}" ${c === pre ? 'selected' : ''}>${esc(c)}</option>`)
      .join('');

    // Pre-filter deals
    const initMatched = pre
      ? leads.filter(l => (l.customer_name || '').toLowerCase() === pre.toLowerCase())
      : leads;
    const dealOpts = _buildDealOptions(initMatched);

    Modal.open({
      title: '📅 캘린더 등록',
      width: 520,
      body: `
        <div style="font-size:13px;color:var(--text-2);margin-bottom:16px;line-height:1.6">
          미팅 일정과 액션 아이템이 선택한 고객사/딜에 연결되어 캘린더에 자동 등록됩니다.
        </div>
        <div class="form-row" style="margin-bottom:12px">
          <label class="form-label">고객사 선택 <span style="color:var(--oci-red)">*</span></label>
          <select class="form-input" id="reg-customer-select">
            <option value="">-- 고객사 선택 --</option>
            ${customerOpts}
            <option value="__direct__">✏️ 직접 입력</option>
          </select>
          <input class="form-input" id="reg-customer-direct"
                 placeholder="고객사명 직접 입력"
                 style="margin-top:6px;display:${preInList || !pre ? 'none' : ''}"
                 value="${!preInList && pre ? esc(pre) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">영업 기회 (딜) <span style="font-weight:400;color:var(--text-3)">— 선택</span></label>
          <select class="form-input" id="reg-lead">${dealOpts}</select>
          <div id="reg-deal-hint" style="font-size:11px;color:var(--text-3);margin-top:4px"></div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" id="cal-reg-cancel-btn">취소</button>
        <button class="btn btn-primary" id="cal-reg-confirm-btn">캘린더에 등록</button>`,
      bind: {
        '#cal-reg-cancel-btn': () => Modal.close(),
        '#cal-reg-confirm-btn': () => _registerCalendar(),
      },
    });

    // bind modal body inputs (after modal renders)
    setTimeout(() => {
      document
        .getElementById('reg-customer-select')
        ?.addEventListener('change', e => _onCustomerChange(e.target.value));
      document
        .getElementById('reg-customer-direct')
        ?.addEventListener('input', e => _onCustomerDirectInput(e.target.value));
    }, 0);

    // Apply auto-match hint for pre-selected customer
    if (pre) setTimeout(() => _applyDealHint(initMatched), 50);
  }

  function _buildDealOptions(matchedLeads) {
    return (
      `<option value="">-- 없음 --</option>` +
      matchedLeads
        .map(
          l =>
            `<option value="${l.id}">${esc(l.customer_name || '')}${l.project_name ? ' · ' + esc(l.project_name) : ''}${l.stage ? ' [' + esc(l.stage) + ']' : ''}</option>`
        )
        .join('')
    );
  }

  function _applyDealHint(matched) {
    const dealEl = document.getElementById('reg-lead');
    const hintEl = document.getElementById('reg-deal-hint');
    if (!dealEl) return;
    if (matched.length === 1) {
      dealEl.value = String(matched[0].id);
      if (hintEl) hintEl.textContent = '✅ 딜이 자동으로 선택되었습니다';
    } else if (matched.length > 1) {
      if (hintEl) hintEl.textContent = `${matched.length}개 딜이 있습니다. 선택해주세요.`;
    } else if (matched.length === 0) {
      if (hintEl) hintEl.textContent = '등록된 딜이 없습니다 (없음으로 진행됩니다)';
    }
  }

  function _onCustomerChange(value) {
    const directEl = document.getElementById('reg-customer-direct');
    const dealEl = document.getElementById('reg-lead');
    const hintEl = document.getElementById('reg-deal-hint');
    if (!dealEl) return;

    if (value === '__direct__') {
      if (directEl) {
        directEl.style.display = '';
        directEl.focus();
      }
      dealEl.innerHTML = _buildDealOptions(leads);
      if (hintEl) hintEl.textContent = '고객사명을 입력하면 딜이 자동 필터링됩니다';
      return;
    }

    if (directEl) directEl.style.display = 'none';
    if (!value) {
      dealEl.innerHTML = _buildDealOptions(leads);
      if (hintEl) hintEl.textContent = '';
      return;
    }

    const matched = leads.filter(
      l => (l.customer_name || '').toLowerCase() === value.toLowerCase()
    );
    dealEl.innerHTML = _buildDealOptions(matched);
    _applyDealHint(matched);
  }

  function _onCustomerDirectInput(value) {
    const dealEl = document.getElementById('reg-lead');
    const hintEl = document.getElementById('reg-deal-hint');
    if (!dealEl) return;
    const trimmed = value.trim();
    if (!trimmed) {
      dealEl.innerHTML = _buildDealOptions([]);
      if (hintEl) hintEl.textContent = '';
      return;
    }
    const matched = leads.filter(l =>
      (l.customer_name || '').toLowerCase().includes(trimmed.toLowerCase())
    );
    dealEl.innerHTML = _buildDealOptions(matched);
    _applyDealHint(matched);
  }

  async function _registerCalendar() {
    const selectEl = document.getElementById('reg-customer-select');
    const directEl = document.getElementById('reg-customer-direct');
    const dealEl = document.getElementById('reg-lead');

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
      const r = await API.meetings.registerCalendar(_state.savedId, {
        customer_name: customer,
        lead_id: leadId,
      });
      if (r.success) {
        Modal.close();
        Toast.success(`캘린더 등록 완료: 미팅 + 액션 ${r.data.action_events_created}건`);
        setTimeout(() => App.navigate('meeting-list'), 800);
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
  }

  function reset() {
    _state = {
      transcript: '',
      speakers: [],
      summary: '',
      savedId: null,
      customerName: '',
      leadId: null,
    };
    MeetingRecorder.recordedBlob = null;
    const result = document.getElementById('meeting-result');
    const fileInfo = document.getElementById('audio-file-info');
    const recTime = document.getElementById('rec-time');
    const status = document.getElementById('rec-status');
    if (result) result.style.display = 'none';
    if (fileInfo) fileInfo.innerHTML = '';
    if (recTime) recTime.textContent = '00:00';
    if (status) status.textContent = '대기 중';
    const f = document.getElementById('audio-file-input');
    if (f) f.value = '';
  }

  // ── 오프라인 큐 UI ───────────────────────────────────────
  // OfflineQueue.list() 의 모든 item 을 카드에 렌더.
  // 큐가 비어있으면 카드 자체를 숨김.
  async function _renderOfflineQueue() {
    const card = document.getElementById('offline-queue-card');
    if (!card || typeof OfflineQueue === 'undefined') return;
    const items = await OfflineQueue.list();
    if (!items.length) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    const countEl = document.getElementById('offline-queue-count');
    if (countEl) countEl.textContent = `(${items.length}건)`;
    const retryBtn = document.getElementById('offline-queue-retry-btn');
    const hasRetryable = items.some(i => i.status === 'pending' || i.status === 'error');
    if (retryBtn) retryBtn.style.display = hasRetryable && navigator.onLine ? '' : 'none';

    const STATUS_BADGE = {
      pending: { label: '⏳ 대기 중', bg: '#fff8f0', color: '#c2410c' },
      uploading: { label: '📤 업로드 중', bg: '#eef2ff', color: '#3730a3' },
      transcribing: { label: '🎙 음성 인식 중', bg: '#eef2ff', color: '#3730a3' },
      done: { label: '✅ 완료', bg: '#f0fdf4', color: '#166534' },
      error: { label: '⚠️ 실패', bg: '#fef2f2', color: '#991b1b' },
    };

    const listEl = document.getElementById('offline-queue-list');
    listEl.innerHTML = items
      .map(it => {
        const badge = STATUS_BADGE[it.status] || STATUS_BADGE.pending;
        const sizeKB = it.blob ? (it.blob.size / 1024).toFixed(0) : '?';
        const ts = new Date(it.created_at).toLocaleString('ko-KR');
        const meta = [
          it.meeting_title || '(제목 없음)',
          it.customer_name ? `고객사: ${esc(it.customer_name)}` : '',
          it.meeting_date ? `일자: ${esc(it.meeting_date)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const msg = it.progress_msg
          ? `<div style="font-size:11px;color:var(--text-2);margin-top:4px">${esc(it.progress_msg)}</div>`
          : '';
        const errMsg = it.error
          ? `<div style="font-size:11px;color:#991b1b;margin-top:4px">${esc(it.error)}</div>`
          : '';

        return `
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${badge.bg};color:${badge.color};white-space:nowrap">${badge.label}</span>
          <div style="flex:1;min-width:160px">
            <div style="font-size:13px;font-weight:500">${esc(meta || '(메타 없음)')}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${sizeKB} KB · ${esc(ts)}</div>
            ${msg}${errMsg}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${it.status === 'done' ? `<button class="btn btn-primary btn-sm" data-oq-view="${it.id}">결과 보기</button>` : ''}
            ${
              (it.status === 'pending' || it.status === 'error') && navigator.onLine
                ? `<button class="btn btn-ghost btn-sm" data-oq-retry="${it.id}">재시도</button>`
                : ''
            }
            <button class="btn btn-ghost btn-sm text-danger" data-oq-del="${it.id}" title="삭제">🗑</button>
          </div>
        </div>
      `;
      })
      .join('');

    // 이벤트 위임
    listEl.onclick = async e => {
      const view = e.target.closest('[data-oq-view]');
      const retry = e.target.closest('[data-oq-retry]');
      const del = e.target.closest('[data-oq-del]');
      if (view) {
        const id = parseInt(view.dataset.oqView);
        const item = await OfflineQueue.get(id);
        if (!item || !item.result) return Toast.error('결과 데이터 없음');
        // 결과를 현재 페이지의 일반 STT 플로우 결과 영역에 표시 → 요약 자동 생성
        _state.transcript = item.result.transcript;
        _state.speakers = item.result.speakers || [];
        // 메타 입력 자동 복원
        const tEl = document.getElementById('meeting-title');
        const cEl = document.getElementById('meeting-customer');
        const dEl = document.getElementById('meeting-date');
        if (tEl && item.meeting_title) tEl.value = item.meeting_title;
        if (cEl && item.customer_name) cEl.value = item.customer_name;
        if (dEl && item.meeting_date) dEl.value = item.meeting_date;
        document.getElementById('meeting-result').style.display = '';
        _renderSpeakers();
        const statsEl = document.getElementById('meeting-stats');
        if (statsEl)
          statsEl.textContent = `${_state.speakers.length}개 화자 구간 · ${_state.transcript.length}자`;
        // AI 요약 생성 (기존 함수 재사용)
        regenerateSummary();
      }
      if (retry) {
        const id = parseInt(retry.dataset.oqRetry);
        await OfflineQueue.update(id, {
          status: 'pending',
          error: null,
          progress_msg: '재시도 대기 중...',
        });
        OfflineQueue.process();
      }
      if (del) {
        const id = parseInt(del.dataset.oqDel);
        if (confirm('이 오프라인 녹음 항목을 삭제할까요? (audio 데이터도 함께 삭제)')) {
          await OfflineQueue.remove(id);
        }
      }
    };

    // 재처리 버튼
    if (retryBtn) retryBtn.onclick = () => OfflineQueue.process();
  }

  // 큐 변경 시 자동 갱신 — render() 안에서 구독, 페이지 떠나도 OK (idempotent)
  if (typeof OfflineQueue !== 'undefined' && !OfflineQueue.__meetingPageSubscribed) {
    OfflineQueue.subscribe(() => {
      // 회의록 페이지일 때만 갱신
      if (document.getElementById('offline-queue-card')) _renderOfflineQueue();
    });
    OfflineQueue.__meetingPageSubscribed = true;
  }

  return {
    render,
    startRecording,
    stopRecording,
    _handleDrop,
    _handleFile,
    regenerateSummary,
    save,
    _calendarNo,
    _calendarYes,
    _registerCalendar,
    _onCustomerChange,
    _onCustomerDirectInput,
    reset,
    // Google Meet
    connectGoogle,
    createMeet,
    disconnectGoogle,
    startRecordingFromMeet,
    _copyLink,
    _showGoogleSetupGuide,
    // 오프라인 큐
    _renderOfflineQueue,
  };
})();
