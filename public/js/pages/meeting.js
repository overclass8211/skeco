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

// 회의록 템플릿 세트 (수기 작성 — 드롭박스 선택 시 에디터에 삽입, 편집 가능)
// 노션풍 리치 HTML — Quill 에디터로 로드되어 그대로 편집/저장됩니다.
const MEETING_TEMPLATES = {
  '영업 기본 미팅록': `<blockquote>핵심 요약 — 한 줄로 정리해 주세요.</blockquote>
<h2>1. 회의 개요</h2><ul><li>목적: </li><li>배경: </li></ul>
<h2>2. 참석자</h2><ul><li>고객: </li><li>자사: </li></ul>
<h2>3. 주요 논의 사항</h2><ol><li></li><li></li></ol>
<h2>4. 고객 니즈 · 요구사항</h2><ul><li></li></ul>
<h2>5. 결정 사항</h2><ul><li></li></ul>
<h2>6. 후속 액션 (담당 · 기한)</h2><ul><li>☐ (담당:  / 기한: )</li></ul>`,
  '내부 보고 미팅': `<blockquote>핵심 요약 — 한 줄로 정리해 주세요.</blockquote>
<h2>1. 안건</h2><ul><li></li></ul>
<h2>2. 진행 현황</h2><ul><li></li></ul>
<h2>3. 이슈 · 리스크</h2><ul><li></li></ul>
<h2>4. 의사결정 요청</h2><ul><li></li></ul>
<h2>5. 결정 사항</h2><ul><li></li></ul>
<h2>6. To-Do (담당 · 기한)</h2><ul><li>☐ (담당:  / 기한: )</li></ul>`,
  '제안/견적 미팅': `<blockquote>핵심 요약 — 한 줄로 정리해 주세요.</blockquote>
<h2>1. 제안 개요</h2><ul><li></li></ul>
<h2>2. 고객 요구사항</h2><ul><li></li></ul>
<h2>3. 제안 내용 · 범위</h2><ul><li></li></ul>
<h2>4. 가격 · 조건</h2><ul><li></li></ul>
<h2>5. 경쟁 · 비교</h2><ul><li></li></ul>
<h2>6. 고객 피드백</h2><ul><li></li></ul>
<h2>7. 다음 단계</h2><ul><li>☐ </li></ul>`,
  '이슈 보고 미팅': `<blockquote>핵심 요약 — 이슈와 현재 상태를 한 줄로 정리해 주세요.</blockquote>
<h2>1. 이슈 개요</h2><ul><li></li></ul>
<h2>2. 발생 경위</h2><ul><li></li></ul>
<h2>3. 영향도</h2><ul><li></li></ul>
<h2>4. 원인 분석</h2><ul><li></li></ul>
<h2>5. 대응 방안</h2><ul><li></li></ul>
<h2>6. 조치 결정</h2><ul><li></li></ul>
<h2>7. 후속 관리 (담당 · 기한)</h2><ul><li>☐ (담당:  / 기한: )</li></ul>`,
  '프로젝트 미팅': `<blockquote>핵심 요약 — 한 줄로 정리해 주세요.</blockquote>
<h2>1. 프로젝트 현황</h2><ul><li></li></ul>
<h2>2. 마일스톤 · 일정</h2><ul><li></li></ul>
<h2>3. 진척률</h2><ul><li></li></ul>
<h2>4. 이슈 · 리스크</h2><ul><li></li></ul>
<h2>5. 액션 아이템 (담당 · 기한)</h2><ul><li>☐ (담당:  / 기한: )</li></ul>`,
  기타: `<blockquote>핵심 요약 — 한 줄로 정리해 주세요.</blockquote>
<h2>1. 회의 개요</h2><ul><li></li></ul>
<h2>2. 논의 사항</h2><ul><li></li></ul>
<h2>3. 결정 사항</h2><ul><li></li></ul>
<h2>4. 액션 아이템</h2><ul><li>☐ </li></ul>`,
};

// 30분 단위 시간 옵션(00/30)
function _mmTimeOptions(sel) {
  let o = '';
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '30']) {
      const v = `${String(h).padStart(2, '0')}:${m}`;
      o += `<option value="${v}" ${sel === v ? 'selected' : ''}>${v}</option>`;
    }
  }
  return o;
}

const MeetingPage = (() => {
  let leads = [];
  let _mmQuill = null; // 수기 작성 리치 에디터 인스턴스

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

      <div id="meeting-entry" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px">
        <!-- 실시간 녹음 -->
        <div class="card">
          <div class="card-body meet-mode" style="text-align:center;padding:26px 18px;display:flex;flex-direction:column;align-items:center;min-height:212px">
            <span class="meet-ico" style="background:rgba(230,51,41,.1);color:var(--oci-red)"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg></span>
            <div style="font-size:15px;font-weight:600;margin:12px 0 4px">실시간 녹음</div>
            <div id="rec-status" style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:4px">미팅을 실시간 녹취하고<br>자동으로 회의록 생성</div>
            <div id="rec-visual" class="rec-visual" style="display:none"></div>
            <div id="rec-time" class="rec-time" style="display:none">00:00</div>
            <button class="btn meet-cta" id="rec-start-btn" style="margin-top:auto;background:var(--oci-red);border-color:var(--oci-red);color:#fff">● 녹음 시작</button>
            <button class="btn meet-cta" id="rec-stop-btn" style="margin-top:auto;background:var(--surface-2);border:1px solid var(--border);color:var(--oci-red);display:none">■ 녹음 중지</button>
          </div>
        </div>

        <!-- 파일 업로드 -->
        <div class="card">
          <div class="card-body meet-mode" id="audio-dropzone" style="text-align:center;padding:26px 18px;display:flex;flex-direction:column;align-items:center;min-height:212px;cursor:pointer">
            <span class="meet-ico" style="background:rgba(26,115,232,.1);color:#1a73e8"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13v8M8 17l4-4 4 4"/><path d="M20 16.5A4.5 4.5 0 0 0 17 8h-1.26A7 7 0 1 0 4 15"/></svg></span>
            <div style="font-size:15px;font-weight:600;margin:12px 0 4px">파일 업로드</div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:4px">녹음 파일(MP3·WAV 등) 업로드 후 자동 변환<br><span style="font-size:11px;color:var(--text-3)">또는 카드 위로 드래그</span></div>
            <input type="file" id="audio-file-input" accept="audio/*" style="display:none">
            <div id="audio-file-info" style="width:100%"></div>
            <button class="btn meet-cta" id="audio-pick-btn" style="margin-top:auto;background:#1a73e8;border-color:#1a73e8;color:#fff">파일 선택</button>
          </div>
        </div>

        <!-- 수기 작성 -->
        <div class="card">
          <div class="card-body meet-mode" style="text-align:center;padding:26px 18px;display:flex;flex-direction:column;align-items:center;min-height:212px">
            <span class="meet-ico" style="background:rgba(0,0,0,.05);color:var(--text-2)"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
            <div style="font-size:15px;font-weight:600;margin:12px 0 4px">수기 작성</div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:4px">템플릿 선택 후<br>직접 회의록 작성</div>
            <button class="btn meet-cta" id="meeting-manual-btn" style="margin-top:auto;background:#0EA5A0;border-color:#0EA5A0;color:#fff">수기 작성 시작</button>
          </div>
        </div>
      </div>

      <!-- 수기 작성 폼 (기본 숨김) -->
      <div id="meeting-manual" class="card" style="display:none;margin-bottom:14px">
        <div class="card-header">
          <div class="card-title">✍ 수기 회의록 작성</div>
          <div style="display:flex;gap:6px;margin-left:auto">
            <button class="btn btn-ghost btn-sm" id="mm-list-btn" title="회의록 목록으로 이동">📋 목록</button>
            <button class="btn btn-primary btn-sm" id="mm-save-btn">💾 회의록 저장</button>
          </div>
        </div>
        <div class="card-body">
          <div class="mm-form">
            <div class="form-row-2">
              <div class="form-row"><label class="form-label required">회의명</label>
                <input class="form-input" id="mm-title" placeholder="예: LG디스플레이 공장 실사"></div>
              <div class="form-row"><label class="form-label">고객사</label>
                <input class="form-input" id="mm-customer" autocomplete="off" placeholder="2글자 이상 입력 시 추천 검색"></div>
            </div>
            <div class="form-row-2">
              <div class="form-row"><label class="form-label">참석자(고객)</label>
                <input class="form-input" id="mm-att-cust" placeholder="쉼표로 구분 (예: 정수석, 김책임)"></div>
              <div class="form-row"><label class="form-label">참석자(자사)</label>
                <input class="form-input" id="mm-att-int" placeholder="쉼표로 구분"></div>
            </div>
            <div class="form-row-2">
              <div class="form-row"><label class="form-label">날짜 / 시간</label>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <input type="date" class="form-input" id="mm-date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;min-width:130px">
                  <select class="form-input" id="mm-start" style="width:92px">${_mmTimeOptions('13:00')}</select>
                  <span style="color:var(--text-3)">~</span>
                  <select class="form-input" id="mm-end" style="width:92px">${_mmTimeOptions('13:30')}</select>
                </div>
              </div>
              <div class="form-row"><label class="form-label">장소</label>
                <input class="form-input" id="mm-location" placeholder="회의 장소"></div>
            </div>
            <div class="form-row">
              <div class="mm-content-bar">
                <label class="form-label" style="margin:0">내용</label>
                <select class="form-input mm-tpl-select" id="mm-template">
                  <option value="">회의록 템플릿 선택…</option>
                  ${Object.keys(MEETING_TEMPLATES).map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}
                </select>
              </div>
              <div class="mm-editor-wrap">
                <div id="mm-quill"></div>
                <textarea id="mm-html" class="mm-html-src" style="display:none" spellcheck="false"></textarea>
                <div class="mm-src-tabs">
                  <span class="mm-src-hint">↕ 입력창 크기 조절</span>
                  <button type="button" class="mm-src-tab is-active" data-mode="editor">Editor</button>
                  <button type="button" class="mm-src-tab" data-mode="html">HTML</button>
                </div>
              </div>
            </div>
          </div>
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

    // ── 수기 작성 모드 ─────────────────────────────────────
    document.getElementById('meeting-manual-btn')?.addEventListener('click', () => {
      // 진입 카드/결과 숨기고 수기 폼 표시
      ['meeting-entry', 'meeting-result'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const mm = document.getElementById('meeting-manual');
      if (mm) mm.style.display = '';
      document.getElementById('mm-title')?.focus();
    });
    document.getElementById('mm-list-btn')?.addEventListener('click', () => App.navigate('meeting-list'));
    document.getElementById('mm-save-btn')?.addEventListener('click', () => saveManual());

    // 리치 에디터(Quill) 초기화
    _initManualEditor();
    // 템플릿 선택 → 에디터에 삽입
    document.getElementById('mm-template')?.addEventListener('change', e => {
      const key = e.target.value;
      if (!key || !MEETING_TEMPLATES[key] || !_mmQuill) return;
      const apply = () => {
        _mmSyncToEditor();
        _mmQuill.setContents([]); // 초기화 후 삽입
        _mmQuill.clipboard.dangerouslyPasteHTML(0, MEETING_TEMPLATES[key]);
        _mmQuill.focus();
      };
      if (_mmQuill.getText().trim()) {
        Modal.confirm('현재 작성 내용을 템플릿으로 덮어쓸까요?', apply, () => {
          e.target.value = '';
        });
      } else {
        apply();
      }
    });
    // Editor ↔ HTML 소스 토글
    document.querySelectorAll('.mm-src-tab').forEach(tab => {
      tab.addEventListener('click', () => _mmSetSourceMode(tab.dataset.mode));
    });
    // 고객사 자동완성 → 선택 시 담당자 자동 입력 (편집 가능)
    const mmCust = document.getElementById('mm-customer');
    if (mmCust && window.Combobox) {
      Combobox.attach({
        inputEl: mmCust,
        minChars: 2,
        allowCustom: false,
        fetchFn: async q => {
          try {
            const r = await API.customers.autocomplete(q, 8);
            return r?.data || (Array.isArray(r) ? r : []);
          } catch (_) {
            return [];
          }
        },
        renderItem: (it, q, { highlightMatch }) =>
          `<div style="font-weight:600">${highlightMatch(it.name, q)}</div>` +
          `<div style="font-size:11px;color:var(--text-3)">${esc(it.industry || '')}` +
          `${it.contact_person ? ' · 담당 ' + esc(it.contact_person) : ''}</div>`,
        onSelect: it => {
          mmCust.value = it.name || '';
          const att = document.getElementById('mm-att-cust');
          if (att && !att.value.trim() && it.contact_person) att.value = it.contact_person;
        },
      });
    }

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
    await fetchLeads();

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
  // 수기 회의록 저장 → 목록으로 이동
  // ── 수기 리치 에디터(Quill) ───────────────────────────────
  // 이미지1 수준의 리치 에디터: 글꼴/크기/색/정렬/목록/인용/링크/이미지 + Editor·HTML 소스탭
  function _initManualEditor() {
    _mmQuill = null;
    const host = document.getElementById('mm-quill');
    if (!host || !window.Quill) return;
    const toolbar = [
      [{ font: [] }, { size: ['small', false, 'large', 'huge'] }],
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
      ['blockquote', 'link', 'image'],
      ['clean'],
    ];
    try {
      _mmQuill = new Quill(host, {
        theme: 'snow',
        placeholder: '템플릿을 선택하거나 직접 작성하세요.',
        modules: { toolbar },
      });
    } catch (e) {
      console.error('Quill init failed:', e);
    }
  }

  // 소스탭 전환: editor ↔ html
  function _mmSetSourceMode(mode) {
    const wrap = document.querySelector('.mm-editor-wrap');
    const ta = document.getElementById('mm-html');
    if (!wrap || !ta || !_mmQuill) return;
    const toolbarEl = wrap.querySelector('.ql-toolbar');
    const containerEl = wrap.querySelector('.ql-container');
    document.querySelectorAll('.mm-src-tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.mode === mode)
    );
    if (mode === 'html') {
      ta.value = _mmQuill.root.innerHTML;
      ta.style.display = '';
      if (toolbarEl) toolbarEl.style.display = 'none';
      if (containerEl) containerEl.style.display = 'none';
    } else {
      _mmSyncToEditor();
      ta.style.display = 'none';
      if (toolbarEl) toolbarEl.style.display = '';
      if (containerEl) containerEl.style.display = '';
    }
  }

  // HTML 소스가 열려 있으면 편집기로 반영
  function _mmSyncToEditor() {
    const ta = document.getElementById('mm-html');
    if (!ta || !_mmQuill) return;
    if (ta.style.display !== 'none') {
      _mmQuill.setContents([]);
      _mmQuill.clipboard.dangerouslyPasteHTML(0, ta.value || '');
    }
  }

  // 저장용 HTML 추출 (빈 내용은 null)
  function _mmGetContent() {
    if (!_mmQuill) return null;
    _mmSyncToEditor();
    if (!_mmQuill.getText().trim()) return null;
    return _mmQuill.root.innerHTML;
  }

  async function saveManual() {
    const title = document.getElementById('mm-title').value.trim();
    if (!title) {
      Toast.error('회의명을 입력하세요');
      document.getElementById('mm-title')?.focus();
      return;
    }
    const st = document.getElementById('mm-start').value;
    const et = document.getElementById('mm-end').value;
    if (st && et && et < st) {
      Toast.error('종료 시간이 시작 시간보다 앞설 수 없습니다.');
      return;
    }
    const payload = {
      title,
      customer_name: document.getElementById('mm-customer').value.trim() || null,
      meeting_date: document.getElementById('mm-date').value || new Date().toISOString().slice(0, 10),
      start_time: st || null,
      end_time: et || null,
      attendees_customer: document.getElementById('mm-att-cust').value.trim() || null,
      attendees_internal: document.getElementById('mm-att-int').value.trim() || null,
      location: document.getElementById('mm-location').value.trim() || null,
      summary_md: _mmGetContent(),
      source: 'manual',
    };
    const btn = document.getElementById('mm-save-btn');
    if (btn) btn.disabled = true;
    try {
      await API.meetings.create(payload);
      Toast.success('회의록이 저장되었습니다');
      App.navigate('meeting-list');
    } catch (_) {
      Toast.error('저장 중 오류가 발생했습니다');
      if (btn) btn.disabled = false;
    }
  }

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
    // 오프라인 큐
    _renderOfflineQueue,
  };
})();
