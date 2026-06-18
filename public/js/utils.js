// ============================================================
// Utilities - 공통 유틸리티
// ============================================================

// ----------- 포맷 -----------
const Fmt = {
  // 금액 포맷 — 모든 통화 1 unit (원/달러/유로 등) 기준 자동 단위 변환
  // KRW: 만/억/조 한국식 / 외화: K/M/B 영어식
  // ⚠️ DB 모든 금액 컬럼은 원/1단위 저장 정책 (억 단위 저장 X)
  amount(value, currency = 'KRW') {
    if (value === null || value === undefined || value === '') return '-';
    const n = parseFloat(value);
    if (isNaN(n)) return '-';
    const abs = Math.abs(n);

    if (currency === 'KRW' || !currency) {
      if (abs >= 1e12) return `₩${(n / 1e12).toFixed(2)}조`;
      if (abs >= 1e8) return `₩${(n / 1e8).toFixed(1)}억`;
      if (abs >= 1e4) return `₩${(n / 1e4).toFixed(0)}만`;
      return `₩${Math.round(n).toLocaleString()}`;
    }

    const symbols = {
      USD: '$',
      JPY: '¥',
      AUD: 'A$',
      CNY: '¥',
      VND: '₫',
      EUR: '€',
      GBP: '£',
      SGD: 'S$',
      HKD: 'HK$',
    };
    const sym = symbols[currency] || '';
    if (abs >= 1e9) return `${sym}${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sym}${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`;
    return `${sym}${n.toLocaleString()}`;
  },

  // 원 단위 금액 포맷 — Fmt.amount(_, 'KRW') 와 동일 (호환성 별칭)
  krw(value) {
    return Fmt.amount(value, 'KRW');
  },

  number(value) {
    if (value === null || value === undefined) return '-';
    return parseFloat(value).toLocaleString();
  },

  date(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  dateKor(value) {
    if (!value) return '-';
    const d = new Date(value);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  },

  relTime(value) {
    if (!value) return '-';
    const now = Date.now();
    const t = new Date(value).getTime();
    const diff = Math.floor((now - t) / 1000);
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
    return Fmt.date(value);
  },

  pct(value) {
    if (value === null || value === undefined) return '-';
    return `${parseFloat(value).toFixed(1)}%`;
  },

  changeIcon(pct) {
    const p = parseFloat(pct);
    if (isNaN(p) || p === 0) return '<span class="text-muted">— 변동없음</span>';
    if (p > 0) return `<span class="metric-change up">▲ ${Math.abs(p).toFixed(2)}%</span>`;
    return `<span class="metric-change dn">▼ ${Math.abs(p).toFixed(2)}%</span>`;
  },

  daysLeft(date) {
    if (!date) return null;
    const d = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return diff;
  },
};

// ----------- 단계 메타 정보 -----------
// 초기값(fallback) — 서버 부팅 직후 fetch 실패 또는 응답 전 화면용
// 실제 정의는 GET /api/pipeline/stages 에서 동적으로 갱신됨
const STAGES = {
  lead: { label: '리드 발굴', color: '#93B4F9', role: 'active', sort_order: 10 },
  review: { label: '검토/미팅', color: '#5585F5', role: 'active', sort_order: 20 },
  proposal: { label: '제안/견적', color: '#2357E8', role: 'active', sort_order: 30 },
  bidding: { label: '입찰', color: '#F59C00', role: 'active', sort_order: 40 },
  negotiation: { label: '협상/계약', color: '#17A85A', role: 'active', sort_order: 50 },
  won: { label: '수주 완료', color: '#0F7A3F', role: 'won', sort_order: 90 },
  lost: { label: '실주', color: '#6B7280', role: 'lost', sort_order: 95 },
  dropped: { label: '드롭', color: '#E63329', role: 'dropped', sort_order: 99 },
};

// ── 단계 메타 동적 로더 ──────────────────────────────────────
// 서버의 pipeline_stages 테이블에서 최신 정의를 불러와 STAGES 갱신
// 앱 부트 시 1회 + 관리자 페이지에서 변경 후 호출
async function loadStages() {
  try {
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const r = await fetch('/api/pipeline/stages?include=all', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.success || !Array.isArray(j.data)) throw new Error('응답 형식 오류');

    // STAGES 객체 in-place 재구성 (참조 유지로 기존 코드 안전)
    Object.keys(STAGES).forEach(k => delete STAGES[k]);
    j.data.forEach(s => {
      STAGES[s.stage_key] = {
        label: s.label,
        color: s.color || '#93B4F9',
        role: s.role || 'active',
        sort_order: s.sort_order || 0,
        is_active: s.is_active !== 0,
        id: s.id,
      };
    });
    // 변경 알림 (페이지가 listen하여 재렌더 가능)
    window.dispatchEvent(new CustomEvent('stages:updated', { detail: { stages: STAGES } }));
    return STAGES;
  } catch (e) {
    console.warn('[STAGES] 동적 로드 실패 — fallback 사용:', e.message);
    return STAGES;
  }
}

// 진행 단계만 (role='active') 순서대로 — 칸반/헬스체크 흐름 표시용
function getFlowStages() {
  return Object.entries(STAGES)
    .filter(([_, m]) => m.role === 'active' && m.is_active !== false)
    .sort((a, b) => (a[1].sort_order || 0) - (b[1].sort_order || 0))
    .map(([k]) => k);
}

// 사업 유형 색상
const BUSINESS_COLORS = {
  태양광: 'badge-amber',
  모듈: 'badge-amber',
  EPC: 'badge-blue',
  ESS: 'badge-blue',
  전기: 'badge-purple',
  설치: 'badge-purple',
};

// ----------- 모달 -----------
// 전체 시스템 모달 표준 폭 (고객사 통합 모달 기준 — 정보 시안성 우선)
const MODAL_STANDARD_WIDTH = 1080;

const Modal = {
  // 현재 열린 모달의 dirty 상태 추적 (입력값 변경 여부)
  _isDirty: false,
  // 닫기 시 컨펌 표시 여부 (open 옵션에서 false 로 끌 수 있음)
  _confirmOnClose: true,

  /**
   * Modal 열기
   * @param {object} opts
   *   title                 - 제목
   *   body                  - 본문 HTML 문자열
   *   footer                - 푸터 HTML 문자열 (버튼에 id 부여 후 bind로 연결)
   *   width                 - 최대 너비 (px). 기본값은 시스템 표준(1080)
   *   compact               - true면 width 인자를 그대로 사용 (확인 다이얼로그·짧은 알림용)
   *   bind                  - { '#btn-id': handler, '[data-x]': handler } CSP-safe 이벤트 바인딩
   *   onOpen                - (box) => {} 추가 초기화 콜백
   *   confirmOnClose        - 사용자가 입력 중일 때 바깥 클릭/× 로 닫으면 컨펌 표시 (기본 true)
   *                            확인 다이얼로그·알림 모달은 false 로 옵트아웃
   *   disableOverlayClose   - true 시 바깥 영역 클릭으로 닫히지 않음 (× 버튼/취소 버튼만 허용)
   *                            폼 데이터가 많은 모달의 실수 닫힘 방지 (기본 false)
   */
  open({
    title,
    body,
    footer,
    width,
    compact = false,
    wide = false,
    bind = {},
    onOpen,
    confirmOnClose = true,
    disableOverlayClose = false,
  }) {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    // 우선순위: compact (작은 다이얼로그) > wide (와이드 모달) > 표준
    // wide=true 면 1440px + 95vw 반응형 (v6.0.0: 영업리드 통합 타임라인용)
    if (compact) {
      box.style.maxWidth = (width || 480) + 'px';
      box.style.width = '';
    } else if (wide) {
      // 반응형: viewport 의 95% 와 1440px 중 작은 값
      box.style.maxWidth = 'min(95vw, ' + (width || 1440) + 'px)';
      box.style.width = '95vw';
    } else {
      box.style.maxWidth = MODAL_STANDARD_WIDTH + 'px';
      // wide 후 width:95vw 가 남아있을 수 있어 reset
      box.style.width = '';
    }
    box.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" id="__modal-x-btn">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    `;
    // 새 모달 열 때마다 dirty 플래그 리셋
    Modal._isDirty = false;
    Modal._confirmOnClose = confirmOnClose;
    // 입력 감지: input/textarea/select 가 변경되면 dirty 표시
    // (input 이벤트 = 글자 입력, change 이벤트 = select/checkbox/radio 변경)
    const markDirty = () => {
      Modal._isDirty = true;
    };
    box.addEventListener('input', markDirty);
    box.addEventListener('change', markDirty);
    // × 버튼 — inline onclick 제거 (CSP 대응) + dirty 시 컨펌
    document.getElementById('__modal-x-btn').addEventListener('click', () => Modal._tryClose());
    // 인라인 onclick="Modal.close()" 버튼 — CSP(script-src-attr)로 인라인 핸들러가 차단됨.
    //   onOpen 에서 동적으로 렌더되는 버튼(홈택스/은행 가져오기 [취소] 등)까지 포함하려면
    //   1회성 스캔이 아니라 box 클릭 위임(delegation) 으로 처리 (× 버튼과 동일 CSP-safe).
    //   box 는 재사용 엘리먼트라 위임 리스너는 1회만 등록.
    if (!box._closeDelegated) {
      box.addEventListener('click', e => {
        const t = e.target.closest('[onclick]');
        if (t && box.contains(t) && /Modal\.close\(\)/.test(t.getAttribute('onclick') || '')) {
          Modal.close();
        }
      });
      box._closeDelegated = true;
    }
    // bind 맵으로 버튼·요소에 이벤트 바인딩 (CSP-safe)
    for (const [sel, fn] of Object.entries(bind)) {
      box.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn));
    }
    overlay.classList.add('active');
    // 바깥 영역 클릭 — 옵션에 따라 동작
    //   disableOverlayClose=true  → 무시 (× 버튼/취소 버튼만 허용)
    //   기본                       → dirty 시 컨펌, 아니면 즉시 닫힘
    overlay.onclick = e => {
      if (e.target !== overlay) return;
      if (disableOverlayClose) return;
      Modal._tryClose();
    };
    if (onOpen) onOpen(box);
  },
  /**
   * 닫기 시도 — dirty 상태면 컨펌, 아니면 즉시 닫힘
   * (× 버튼 / 바깥 클릭 공통 진입점)
   */
  _tryClose() {
    if (Modal._confirmOnClose && Modal._isDirty) {
      Modal._confirmDiscard(() => Modal.close());
    } else {
      Modal.close();
    }
  },
  /**
   * "변경사항을 버리고 닫으시겠습니까?" 컨펌 오버레이
   * 현재 모달 위에 추가로 표시되는 작은 다이얼로그 (z-index 1100)
   */
  _confirmDiscard(onDiscard) {
    // 이미 열려있으면 중복 방지
    if (document.getElementById('__modal-discard-overlay')) return;
    const wrap = document.createElement('div');
    wrap.id = '__modal-discard-overlay';
    wrap.className = 'modal-discard-overlay';
    wrap.innerHTML = `
      <div class="modal-discard-box" role="alertdialog" aria-modal="true">
        <div class="modal-discard-title">⚠️ 변경사항이 저장되지 않습니다</div>
        <div class="modal-discard-body">정말 닫으시겠습니까?<br><span class="modal-discard-hint">작성 중이던 내용이 모두 사라집니다.</span></div>
        <div class="modal-discard-footer">
          <button type="button" class="btn btn-ghost" id="__modal-discard-stay">계속 편집</button>
          <button type="button" class="btn btn-primary" id="__modal-discard-leave">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const cleanup = () => wrap.remove();
    // "계속 편집" — 컨펌만 닫힘, 모달은 그대로
    document.getElementById('__modal-discard-stay').addEventListener('click', cleanup);
    // "닫기" — 컨펌 닫고 모달도 닫음
    document.getElementById('__modal-discard-leave').addEventListener('click', () => {
      cleanup();
      onDiscard();
    });
    // 오버레이 바깥 클릭 = "계속 편집" 과 동일 (실수 방지)
    wrap.addEventListener('click', e => {
      if (e.target === wrap) cleanup();
    });
    // 포커스를 "계속 편집" 에 둠 (실수로 Enter 눌렀을 때 안전한 쪽으로)
    setTimeout(() => document.getElementById('__modal-discard-stay')?.focus(), 50);
  },
  close() {
    document.getElementById('modal-overlay').classList.remove('active');
    // 닫을 때 dirty 플래그도 리셋
    Modal._isDirty = false;
  },
  confirm(message, onConfirm) {
    Modal.open({
      title: '확인',
      compact: true, // 확인 다이얼로그는 작게 유지
      width: 440,
      confirmOnClose: false, // 확인 다이얼로그 자체엔 컨펌 불필요
      body: `<p style="font-size:13px;color:var(--text-2);line-height:1.6">${message}</p>`,
      footer: `
        <button class="btn btn-ghost" id="modal-cfm-cancel">취소</button>
        <button class="btn btn-primary" id="modal-cfm-ok">확인</button>
      `,
      bind: {
        '#modal-cfm-cancel': () => Modal.close(),
        '#modal-cfm-ok': () => {
          Modal.close();
          onConfirm();
        },
      },
    });
  },
};

// ESC 키 = 닫기 (모달/컨펌 공통). 문서 레벨 1회 등록 — [닫기] 버튼·바깥 클릭과 동일 경로(_tryClose).
//   1) discard 컨펌이 떠 있으면 ESC = "계속 편집" (컨펌만 닫음)
//   2) 모달이 열려 있으면 ESC = 닫기 시도 (dirty 면 변경사항 컨펌)
//   Combobox 등 열린 위젯은 자체 keydown 에서 stopPropagation 하므로 여기로 전파되지 않음
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const discard = document.getElementById('__modal-discard-overlay');
  if (discard) {
    discard.remove();
    return;
  }
  const overlay = document.getElementById('modal-overlay');
  if (overlay && overlay.classList.contains('active')) Modal._tryClose();
});

// ----------- 토스트 -----------
const Toast = {
  show(message, type = 'success', onClick = null) {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}${onClick ? ' toast-action' : ''}`;
    if (onClick) {
      el.innerHTML = `<span>${message}</span><span class="toast-action-hint">클릭하여 이동 →</span>`;
    } else {
      el.textContent = message;
    }
    if (onClick) {
      el.addEventListener(
        'click',
        () => {
          onClick();
          el.remove();
        },
        { once: true }
      );
    }
    c.appendChild(el);
    const delay = onClick ? 5000 : 2800; // 클릭 가능 토스트는 조금 더 오래
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, delay);
  },
  success(msg, onClick) {
    Toast.show(msg, 'success', onClick);
  },
  error(msg) {
    Toast.show(msg, 'error');
  },
  info(msg, onClick) {
    Toast.show(msg, 'info', onClick);
  },
};

// ----------- HTML 이스케이프 -----------
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 사용자 환경 설정 (UserPrefs) — 세션 / 토큰 / 테마 / 폰트 / Idle
// ============================================================
const FONT_STEPS = [0.9, 1.0, 1.1, 1.2, 1.3];

const UserPrefs = {
  sessionStart: Date.now(),
  lastActivity: Date.now(),
  idleLimitMin: 0, // 0 = 비활성화
  warningShownAt: 0,
  _sessionTimer: null,
  _tokenTimer: null,
  _idleTimer: null,

  async init() {
    this.applyTheme(localStorage.getItem('theme') || 'light');
    this.applyFontScale(parseFloat(localStorage.getItem('fontScale')) || 1);
    this.startSessionTimer();
    this.startTokenPolling();
    this.bindControls();
    this.bindActivityTracking();
    await this.loadIdlePolicy();
    this.startIdleWatcher();
  },

  bindControls() {
    const $theme = document.getElementById('theme-toggle');
    const $dec = document.getElementById('font-decrease');
    const $inc = document.getElementById('font-increase');
    if ($theme) $theme.addEventListener('click', () => this.toggleTheme());
    if ($dec) $dec.addEventListener('click', () => this.adjustFont(-1));
    if ($inc) $inc.addEventListener('click', () => this.adjustFont(+1));
  },

  // ── 세션 타이머 ────────────────────────────────────────────
  startSessionTimer() {
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    const tick = () => {
      const el = document.getElementById('session-time');
      if (!el) return;
      const elapsed = Math.floor((Date.now() - this.sessionStart) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      el.textContent = `${h}:${m}:${s}`;
    };
    tick();
    this._sessionTimer = setInterval(tick, 1000);
  },

  // ── 토큰 사용량 폴링 ──────────────────────────────────────
  async fetchTokenUsage() {
    const el = document.getElementById('token-count');
    if (!el) return;
    try {
      const r = await API.ai.usageToday();
      if (r.success) {
        const t = r.data.total;
        el.textContent = t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
        const wrap = document.getElementById('token-widget');
        if (wrap) wrap.title = `오늘 사용 토큰: ${t.toLocaleString()} (요청 ${r.data.calls}회)`;
      }
    } catch (_) {
      /* token widget is non-critical */
    }
  },

  startTokenPolling() {
    if (this._tokenTimer) clearInterval(this._tokenTimer);
    this.fetchTokenUsage();
    this._tokenTimer = setInterval(() => this.fetchTokenUsage(), 30000);
  },

  refreshTokens() {
    this.fetchTokenUsage();
  },

  // ── 테마 ────────────────────────────────────────────────
  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    this.applyTheme(current === 'light' ? 'dark' : 'light');
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.innerHTML =
        theme === 'dark'
          ? '<path d="M12 2.5A6.5 6.5 0 0 0 7 14a6.5 6.5 0 0 1-1-3.5A6.5 6.5 0 0 1 12.5 4 6.5 6.5 0 0 0 12 2.5z" fill="currentColor"/>'
          : '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M1 8h2M13 8h2M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>';
    }
  },

  // ── 폰트 (- / + 분리 버튼) ──────────────────────────────
  adjustFont(dir) {
    const cur = parseFloat(localStorage.getItem('fontScale')) || 1;
    const idx = FONT_STEPS.findIndex(s => Math.abs(s - cur) < 0.01);
    const base = idx === -1 ? FONT_STEPS.indexOf(1.0) : idx;
    const next = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, base + dir))];
    if (Math.abs(next - cur) < 0.001) {
      Toast.info(dir < 0 ? '최소 크기입니다' : '최대 크기입니다');
      return;
    }
    this.applyFontScale(next);
    Toast.info(`폰트 크기: ${Math.round(next * 100)}%`);
    // 경계 버튼 비활성화 표시
    const dec = document.getElementById('font-decrease');
    const inc = document.getElementById('font-increase');
    if (dec) dec.disabled = Math.abs(next - FONT_STEPS[0]) < 0.001;
    if (inc) inc.disabled = Math.abs(next - FONT_STEPS[FONT_STEPS.length - 1]) < 0.001;
  },

  applyFontScale(scale) {
    // body.zoom 으로 전체 UI 스케일링
    // html + body 모두 overflow:hidden + height:100% 이므로
    // zoom 값이 달라져도 viewport 스크롤은 완전 차단됨
    document.body.style.zoom = String(scale);
    localStorage.setItem('fontScale', String(scale));
    const label = document.getElementById('font-scale-label');
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  },

  // ── 활동 추적 ────────────────────────────────────────────
  bindActivityTracking() {
    const reset = () => {
      this.lastActivity = Date.now();
      this.warningShownAt = 0;
    };
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
      document.addEventListener(evt, reset, { passive: true });
    });
  },

  // ── Idle 정책 로드 ───────────────────────────────────────
  async loadIdlePolicy() {
    try {
      const r = await API.get('/admin/settings');
      if (r.success && r.data) {
        this.idleLimitMin = parseInt(r.data.idle_timeout_min || 0);
      }
    } catch (_) {
      this.idleLimitMin = 0;
    }
  },

  // ── Idle 감지 — 매 5초 확인 ─────────────────────────────
  startIdleWatcher() {
    if (this._idleTimer) clearInterval(this._idleTimer);
    this._idleTimer = setInterval(() => this.checkIdle(), 5000);
  },

  checkIdle() {
    if (!this.idleLimitMin || this.idleLimitMin <= 0) return;
    const limitMs = this.idleLimitMin * 60 * 1000;
    const idleMs = Date.now() - this.lastActivity;

    // 만료 30초 전 경고
    if (idleMs >= limitMs - 30000 && idleMs < limitMs && !this.warningShownAt) {
      this.warningShownAt = Date.now();
      Toast.error(`30초 후 자동 로그아웃됩니다. 화면을 클릭하여 세션을 유지하세요.`);
    }

    // 만료
    if (idleMs >= limitMs) {
      clearInterval(this._idleTimer);
      this.showSessionExpired();
    }
  },

  showSessionExpired() {
    if (document.querySelector('.session-expired-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'session-expired-overlay';
    overlay.innerHTML = `
      <div class="session-expired-box">
        <div class="session-expired-icon">⏰</div>
        <div class="session-expired-title">세션이 만료되었습니다</div>
        <div class="session-expired-msg">
          ${this.idleLimitMin}분간 활동이 없어 자동 로그아웃되었습니다.<br>
          계속 사용하려면 다시 시작하세요.
        </div>
        <button class="btn btn-primary" id="session-reload-btn">다시 시작</button>
      </div>`;
    document.body.appendChild(overlay);
    document
      .getElementById('session-reload-btn')
      ?.addEventListener('click', () => location.reload());
  },

  // 관리자 설정 변경 시 호출
  reloadIdlePolicy() {
    this.loadIdlePolicy();
  },
};

// ----------- 디바운스 -----------
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// 필터바 sticky 감지 — 페이지 이동 시 호출하여 is-stuck 클래스 토글
function initStickyFilterBar() {
  const content = document.getElementById('content');
  if (!content) return;
  const onScroll = () => {
    const bar = content.querySelector('.filter-bar');
    if (bar) bar.classList.toggle('is-stuck', content.scrollTop > 0);
  };
  // 이전 리스너 제거 후 재등록
  content.removeEventListener('scroll', content._stickyHandler);
  content._stickyHandler = onScroll;
  content.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // 초기 상태 적용
}
