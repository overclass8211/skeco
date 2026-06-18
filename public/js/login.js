// ============================================================
// OCI AI CRM — 로그인 페이지 스크립트
// ============================================================

const Login = {
  otpUserId: null, // OTP 2단계 인증 시 임시 저장

  /* ── 탭 전환 ── */
  switchTab(tab) {
    document
      .querySelectorAll('.ltab')
      .forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === `panel-${tab}`);
    });
    this.clearError();
  },

  /* ── 비밀번호 표시/숨김 ── */
  togglePw(btn) {
    const inp = btn.closest('.input-wrap').querySelector('input');
    const ico = btn.querySelector('i');
    if (inp.type === 'password') {
      inp.type = 'text';
      ico.className = 'fa fa-eye-slash';
    } else {
      inp.type = 'password';
      ico.className = 'fa fa-eye';
    }
  },

  /* ── 계정 로그인 제출 ── */
  async submitAccount(e) {
    e.preventDefault();
    const username = document.getElementById('inp-username').value.trim();
    const password = document.getElementById('inp-password').value;
    const remember = document.getElementById('chk-remember').checked;

    this.setLoading(true);
    this.clearError();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!data.success) {
        this.showError(data.error);
        return;
      }

      if (data.requireOtp) {
        // OTP 추가 인증 필요
        this.otpUserId = data.userId;
        this.switchTab('otp');
        document.getElementById('otp-step1').style.display = 'none';
        document.getElementById('otp-step2').style.display = '';
        document.querySelector('.otp-digit')?.focus();
        return;
      }

      this.onLoginSuccess(data, remember);
    } catch (_) {
      this.showError('서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      this.setLoading(false);
    }
  },

  /* ── OTP Step1: 아이디 확인 ── */
  otpRequest() {
    const val = document.getElementById('inp-otp-user').value.trim();
    if (!val) {
      this.showError('아이디를 입력하세요.');
      return;
    }

    // 먼저 계정 확인 (비밀번호 없이는 계정 찾기만)
    document.getElementById('otp-step1').style.display = 'none';
    document.getElementById('otp-step2').style.display = '';
    document.querySelector('.otp-digit')?.focus();
    this.clearError();
  },

  /* ── OTP Step2: 코드 검증 ── */
  async submitOtp() {
    const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
    if (digits.length < 6) {
      this.showError('6자리 코드를 입력하세요.');
      return;
    }

    if (!this.otpUserId) {
      this.showError('다시 처음부터 시도해 주세요.');
      return;
    }

    this.clearError();
    try {
      const res = await fetch('/api/auth/login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.otpUserId, otpToken: digits }),
      });
      const data = await res.json();
      if (!data.success) {
        this.showError(data.error);
        return;
      }
      this.onLoginSuccess(data, false);
    } catch (_) {
      this.showError('서버 오류가 발생했습니다.');
    }
  },

  otpBack() {
    this.otpUserId = null;
    document.getElementById('otp-step1').style.display = '';
    document.getElementById('otp-step2').style.display = 'none';
    document.querySelectorAll('.otp-digit').forEach(i => {
      i.value = '';
    });
    this.clearError();
  },

  /* ── 생체인식 (WebAuthn) ── */
  async startBiometric() {
    if (!window.PublicKeyCredential) {
      this.showError('이 브라우저는 생체인식을 지원하지 않습니다.');
      return;
    }

    // ① 등록 여부를 먼저 확인 — 미등록 시 WebAuthn 호출하지 않음
    const savedCred = localStorage.getItem('oci_webauthn_id');
    const savedToken = localStorage.getItem('oci_webauthn_token');
    if (!savedCred || !savedToken) {
      this.showError(
        '등록된 생체인식 정보가 없습니다. 계정 로그인 후 설정 메뉴에서 먼저 등록하세요.'
      );
      return;
    }

    const icon = document.getElementById('bio-icon');
    const hint = document.getElementById('bio-hint');
    icon.classList.add('scanning');
    hint.textContent = '생체 인식 중...';
    this.clearError();

    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60000,
          userVerification: 'required', // 반드시 생체 인증 사용
          allowCredentials: [
            {
              id: Uint8Array.from(atob(savedCred), c => c.charCodeAt(0)),
              type: 'public-key',
              transports: ['internal'], // 플랫폼 인증기(Windows Hello/Touch ID)만 허용
              // ← 이 설정이 없으면 외부 기기/보안키 팝업 노출
            },
          ],
        },
      });

      if (credential) {
        const user = JSON.parse(localStorage.getItem('oci_user') || '{}');
        hint.textContent = `${user.full_name || user.username || '사용자'}님, 인증 성공!`;
        setTimeout(() => {
          window.location.href = '/';
        }, 800);
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        this.showError('생체인식이 취소되었습니다.');
      } else if (err.name === 'SecurityError') {
        this.showError('보안 오류: HTTPS 또는 localhost 환경에서만 사용 가능합니다.');
      } else {
        this.showError('생체인식에 실패했습니다: ' + err.message);
      }
    } finally {
      icon.classList.remove('scanning');
      if (hint) hint.innerHTML = '지문 아이콘을 클릭하여<br>생체 인식을 시작하세요';
    }
  },

  /* ── 로그인 성공 처리 ── */
  onLoginSuccess(data, remember) {
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('oci_token', data.token);
    // "로그인 유지" 여부를 영속 저장 — 앱 콜드스타트 시 refresh 토큰 자동복구 허용 게이트
    // (미체크면 access token 만료 후 자동 로그인하지 않음 → 닫으면 로그아웃 동작 보존)
    localStorage.setItem('oci_remember', remember ? '1' : '0');
    localStorage.setItem('oci_user', JSON.stringify(data.user));
    localStorage.setItem('current_user_id', data.user.id);
    // 로그인 후 항상 대시보드로 진입 — 이전 세션의 lastPage 무시
    localStorage.removeItem('oci_lastPage');
    window.location.href = '/';
  },

  /* ── UI 헬퍼 ── */
  setLoading(on) {
    const btn = document.getElementById('btn-login');
    const text = btn?.querySelector('.btn-text');
    const load = btn?.querySelector('.btn-loading');
    if (!btn) return;
    btn.disabled = on;
    if (text) text.style.display = on ? 'none' : '';
    if (load) load.style.display = on ? '' : 'none';
  },
  showError(msg) {
    const el = document.getElementById('login-error');
    document.getElementById('login-error-msg').textContent = msg;
    el.style.display = 'flex';
  },
  clearError() {
    document.getElementById('login-error').style.display = 'none';
  },
};

/* ── 기능 플래그에 따라 로그인 탭 표시/숨김 ── */
async function applyLoginFeatureFlags() {
  try {
    // /api/auth/* 는 인증 미들웨어 이전에 등록되어 토큰 없이 접근 가능
    const res = await fetch('/api/auth/features/public');
    if (!res.ok) {
      console.warn('[FeatureFlag] HTTP', res.status, '— 모든 탭 표시 유지');
      return;
    }
    const json = await res.json();
    const flags = json.data || {};

    // auth.biometric OFF → 생체인식 탭 + 패널 완전 제거
    if (flags['auth.biometric'] === false) {
      document.getElementById('tab-bio')?.remove();
      document.getElementById('panel-bio')?.remove();
    }

    // auth.otp OFF → OTP 탭 + 패널 완전 제거
    if (flags['auth.otp'] === false) {
      document.getElementById('tab-otp')?.remove();
      document.getElementById('panel-otp')?.remove();
    }
  } catch (err) {
    console.warn('[FeatureFlag] 로드 실패:', err.message, '— 모든 탭 표시 유지');
  }
}

/* ── DOM 준비 후 이벤트 바인딩 (CSP: inline onclick 제거) ── */
document.addEventListener('DOMContentLoaded', () => {
  // 기능 플래그 적용 (비활성화된 로그인 방식 탭 제거)
  applyLoginFeatureFlags();

  // 탭 전환
  document.querySelectorAll('.ltab').forEach(btn => {
    btn.addEventListener('click', () => Login.switchTab(btn.dataset.tab));
  });

  // 계정 로그인 폼 submit
  document.getElementById('form-account')?.addEventListener('submit', e => {
    e.preventDefault();
    Login.submitAccount(e);
  });

  // 비밀번호 보기/숨김
  document.getElementById('btn-toggle-pw')?.addEventListener('click', function () {
    Login.togglePw(this);
  });

  // OTP 요청
  document.getElementById('btn-otp-request')?.addEventListener('click', () => Login.otpRequest());

  // OTP 확인
  document.getElementById('btn-otp-submit')?.addEventListener('click', () => Login.submitOtp());

  // OTP 뒤로가기
  document.getElementById('btn-otp-back')?.addEventListener('click', () => Login.otpBack());

  // 생체인식 (아이콘 클릭 + 버튼 클릭)
  document.getElementById('bio-icon')?.addEventListener('click', () => Login.startBiometric());
  document.getElementById('btn-biometric')?.addEventListener('click', () => Login.startBiometric());

  // OTP 숫자 입력 자동 포커스 이동
  document.querySelectorAll('.otp-digit').forEach((inp, idx, arr) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && idx < arr.length - 1) arr[idx + 1].focus();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) arr[idx - 1].focus();
    });
    inp.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      [...text.slice(0, 6)].forEach((ch, i) => {
        if (arr[idx + i]) arr[idx + i].value = ch;
      });
      const next = Math.min(idx + text.length, arr.length - 1);
      arr[next].focus();
    });
  });

  // 저장된 세션 확인 — access token 만료 시 "로그인 유지"였다면 refresh 토큰(쿠키)으로 자동복구
  (async () => {
    const checkMe = async t => {
      try {
        const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        return !!(d && d.success);
      } catch (_) {
        return false;
      }
    };
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (token && (await checkMe(token))) {
      window.location.href = '/';
      return;
    }
    // access token 없음/만료 — "로그인 유지" 였을 때만 refresh 쿠키로 1회 복구 (미체크면 로그인 화면 유지)
    const remembered =
      localStorage.getItem('oci_remember') === '1' || !!localStorage.getItem('oci_token');
    if (!remembered) return;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem('oci_token', data.token); // remember 이므로 영속 저장
        window.location.href = '/';
      }
    } catch (_) {
      /* refresh 없음/실패 → 로그인 화면 유지 */
    }
  })();
});
