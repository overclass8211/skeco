// =============================================================
// Onboarding — 첫 로그인 환영 모달 + 5단계 체크리스트
//
// 동작:
//   • 첫 로그인 감지 → 환영 모달 자동 표시
//   • 사용자가 "시작하기" 클릭 → localStorage 에 완료 플래그
//   • 사용자가 "다시 보지 않기" 클릭 → 동일하게 플래그
//   • TopBar 🎓 버튼 / 단축키 도움말의 "온보딩 가이드" 버튼 → 언제든 다시 표시
//   • 3일 이상 미접속 + 미완료 단계 있을 때 → 부드러운 Toast nudge
//
// 외부 진입점:
//   Onboarding.maybeShow()       — 첫 로그인이면 자동 표시
//   Onboarding.show()            — 강제 표시 (진행 상태 조회 후)
//   Onboarding.reset()           — flag 삭제 + 다시 표시 (TopBar/단축키 버튼에서 호출)
//   Onboarding.maybeShowNudge()  — 3일 이상 미접속 + 미완료 단계 있을 때만 Toast
// =============================================================
'use strict';

const Onboarding = {
  FLAG_KEY: 'oci_onboarding_done',
  NUDGE_KEY: 'oci_onboarding_last_nudge',
  NUDGE_INTERVAL_DAYS: 3,
  _initialized: false,

  STEPS: [
    {
      icon: '🏢',
      title: '1. 고객사 등록',
      desc: '거래처를 등록하세요. 명함을 스캔하면 AI 가 자동으로 정보를 추출합니다.',
      target: 'customers',
      // 진행 상태 체크 (Phase 2) — list 결과 1건 이상이면 완료
      check: () =>
        API.customers
          .list()
          .then(r => (r.data || []).length > 0)
          .catch(() => false),
    },
    {
      icon: '🎯',
      title: '2. 영업 리드 추가',
      desc: '잠재 사업 기회를 리드로 등록하고 단계 (검토 → 제안 → 입찰 → 수주) 를 관리하세요.',
      target: 'leads',
      check: () =>
        API.leads
          .list()
          .then(r => (r.data || []).length > 0)
          .catch(() => false),
    },
    {
      icon: '📅',
      title: '3. 미팅 일정 등록',
      desc: '입찰 마감일과 미팅을 캘린더에 추가하면 자동 알림이 갑니다.',
      target: 'calendar',
      check: () =>
        API.calendar
          .list()
          .then(r => (r.data || []).length > 0)
          .catch(() => false),
    },
    {
      icon: '🎙️',
      title: '4. AI 회의록 활용',
      desc: '미팅 녹음을 업로드하면 AI 가 요약 + 액션 아이템을 자동 추출합니다.',
      target: 'meeting',
      check: () =>
        API.meetings
          .list()
          .then(r => (r.data || []).length > 0)
          .catch(() => false),
    },
    {
      icon: '📊',
      title: '5. 대시보드로 분석',
      desc: '리드 · 매출 · 팀 실적을 대시보드에서 한눈에 확인하세요.',
      target: 'dashboard',
      // 대시보드는 데이터 없음 — 방문 흔적으로 판단
      check: () => Promise.resolve(localStorage.getItem('oci_lastPage') === 'dashboard'),
    },
  ],

  // 첫 로그인 자동 표시 진입점
  maybeShow() {
    try {
      if (localStorage.getItem(this.FLAG_KEY)) return; // 이미 완료
      // 모달 인프라가 준비된 후 표시 (다음 프레임)
      requestAnimationFrame(() => {
        if (typeof Modal === 'undefined') return;
        this.show();
      });
    } catch (_) {
      /* localStorage 차단 시 무시 */
    }
  },

  // ─── 진행 상태 조회 (Phase 2) ─────────────────────────────
  // 각 단계의 check 함수를 병렬 실행 — 한 단계 실패해도 다른 결과 보존
  // 응답 시간: API 5개 병렬 호출 (보통 < 500ms)
  async _checkProgress() {
    try {
      const results = await Promise.allSettled(
        this.STEPS.map(s => (typeof s.check === 'function' ? s.check() : Promise.resolve(false)))
      );
      return results.map(r => (r.status === 'fulfilled' ? !!r.value : false));
    } catch (_) {
      return this.STEPS.map(() => false);
    }
  },

  async show() {
    if (typeof Modal === 'undefined') return;

    // 진행 상태 조회 (병렬 API 호출)
    const completed = await this._checkProgress();
    const doneCount = completed.filter(Boolean).length;
    const totalCount = this.STEPS.length;
    const progressLabel =
      doneCount > 0
        ? ` <span style="font-size:12px;color:var(--text-3);font-weight:400">(${doneCount}/${totalCount} 완료)</span>`
        : '';

    Modal.open({
      title: `🎉 OCI CRM에 오신 것을 환영합니다${progressLabel}`,
      width: 640,
      body: this._buildBody(completed),
      footer: `
        <button class="btn btn-ghost" id="onb-skip">다시 보지 않기</button>
        <button class="btn btn-primary" id="onb-start">시작하기</button>
      `,
      bind: {
        '#onb-skip': () => {
          this._markDone();
          Modal.close();
        },
        '#onb-start': () => {
          this._markDone();
          Modal.close();
          this._gotoFirstIncomplete(completed);
        },
        '[data-onb-goto]': e => {
          const tgt = e.currentTarget.dataset.onbGoto;
          this._markDone();
          Modal.close();
          if (typeof App !== 'undefined' && App.navigate) App.navigate(tgt);
        },
      },
    });
  },

  _buildBody(completed = []) {
    const doneCount = completed.filter(Boolean).length;
    const totalCount = this.STEPS.length;
    const introText =
      doneCount === 0
        ? '영업 활동의 시작부터 분석까지, <strong>5단계로 빠르게 시작</strong>해 보세요.<br>각 항목을 클릭하면 해당 페이지로 이동합니다.'
        : doneCount === totalCount
          ? '🎉 <strong>모든 단계를 완료하셨습니다!</strong> 계속해서 활용해 주세요.'
          : `<strong>${doneCount}/${totalCount} 단계 완료</strong> — 다음 단계를 진행해보세요. 완료된 단계는 ✓ 로 표시됩니다.`;

    return `
      <div class="onboarding-intro">
        <p style="margin:0 0 8px;font-size:13px;color:var(--text-2);line-height:1.7">${introText}</p>
      </div>
      <div class="onboarding-steps">
        ${this.STEPS.map((s, idx) => {
          const isDone = completed[idx] === true;
          return `
            <button class="onboarding-step ${isDone ? 'completed' : ''}"
                    data-onb-goto="${this._esc(s.target)}" type="button"
                    aria-label="${this._esc(s.title)} ${isDone ? '— 완료됨' : '— 진행하기'}">
              <span class="onboarding-step-icon">${this._esc(s.icon)}</span>
              <div class="onboarding-step-text">
                <div class="onboarding-step-title">
                  ${this._esc(s.title)}${isDone ? ' <span class="onboarding-step-check" title="완료">✓</span>' : ''}
                </div>
                <div class="onboarding-step-desc">${this._esc(s.desc)}</div>
              </div>
              <span class="onboarding-step-arrow">${isDone ? '↻' : '→'}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="onboarding-tips">
        💡 단축키: <kbd>?</kbd> 도움말 · <kbd>N</kbd> 새 리드 · <kbd>/</kbd> 검색 · <kbd>Ctrl+K</kbd> 통합 검색
      </div>
    `;
  },

  _markDone() {
    try {
      localStorage.setItem(this.FLAG_KEY, String(Date.now()));
    } catch (_) {
      /* ignore */
    }
  },

  // "시작하기" 클릭 시: 첫 미완료 단계로 이동 (전체 완료면 customers, 기본)
  _gotoFirstIncomplete(completed = []) {
    if (typeof App === 'undefined' || !App.navigate) return;
    const firstIncomplete = this.STEPS.findIndex((_, idx) => !completed[idx]);
    const target = firstIncomplete >= 0 ? this.STEPS[firstIncomplete].target : 'customers';
    if (App.pages?.[target]) App.navigate(target);
  },

  // 사용자 요청으로 다시 보기 — 플래그 초기화 후 표시
  reset() {
    try {
      localStorage.removeItem(this.FLAG_KEY);
    } catch (_) {
      /* ignore */
    }
    this.show();
  },

  // ─── Phase 3: 부드러운 자동 알림 (Toast Nudge) ────────────
  // 조건:
  //   1) 첫 모달은 이미 봤음 (FLAG_KEY 있음)
  //   2) 마지막 nudge 가 NUDGE_INTERVAL_DAYS 일 이상 전이거나 없음
  //   3) 미완료 단계가 1개 이상 있음
  // 동작: Toast.info (클릭 시 모달 열림) — 모달 강제 X (덜 거슬림)
  async maybeShowNudge() {
    try {
      // 조건 1: 첫 온보딩은 완료된 사용자만 대상 (신규 사용자는 maybeShow 가 처리)
      if (!localStorage.getItem(this.FLAG_KEY)) return;

      // 조건 2: nudge 간격 확인
      const lastNudgeStr = localStorage.getItem(this.NUDGE_KEY);
      if (lastNudgeStr) {
        const lastNudge = parseInt(lastNudgeStr, 10);
        const elapsed = Date.now() - lastNudge;
        const intervalMs = this.NUDGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
        if (elapsed < intervalMs) return; // 아직 간격 안 됨
      }

      // 조건 3: 미완료 단계 확인 (Toast 가 도움 되는 경우만)
      if (typeof Modal === 'undefined' || typeof API === 'undefined') return;
      const completed = await this._checkProgress();
      const incompleteIdx = completed.findIndex(c => !c);
      if (incompleteIdx < 0) return; // 모두 완료 — nudge 불필요

      const step = this.STEPS[incompleteIdx];
      const msg = `${step.icon} 아직 ${step.title.replace(/^\d+\.\s*/, '')} 을(를) 시도하지 않으셨네요!`;

      // Toast.info 의 onClick 콜백 — 클릭 시 모달 열림
      if (typeof Toast !== 'undefined' && Toast.info) {
        Toast.info(msg, () => this.show());
      }

      // nudge 시점 기록 — 다음 NUDGE_INTERVAL_DAYS 일 동안 안 뜸
      localStorage.setItem(this.NUDGE_KEY, String(Date.now()));
    } catch (_) {
      /* localStorage / API 실패 시 무시 — 핵심 동작 X */
    }
  },

  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};
