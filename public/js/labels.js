// =============================================================
// Labels — 워드 사전 dictionary 모듈 (다국어)
//
// 백엔드 GET /api/labels 결과를 sessionStorage 캐시(10분)
// DOM의 [data-label="<scope>.<key>"] 요소 텍스트 치환.
//
// 다국어:
//   - 부팅 시 시스템 locale 자동 감지 (또는 localStorage 사용자 override)
//   - Labels.setLocale('en') 으로 변경 가능
// =============================================================
'use strict';

const Labels = {
  _dict: null, // { scope: { key: 'label' } }
  _locale: 'ko', // 현재 적용 locale
  _systemLocale: 'ko', // 시스템 기본 locale (백엔드 설정)
  _supportedLocales: [], // [{code,label,flag}]
  _ttl: 10 * 60 * 1000,
  _key: 'oci_labels_cache',
  _loading: null,

  // ── 캐시 ─────────────────────────────────────────────────
  _cacheKey() {
    return `${this._key}_${this._locale}`;
  },
  _loadFromCache() {
    try {
      const raw = sessionStorage.getItem(this._cacheKey());
      if (!raw) return null;
      const { ts, data, locale, systemLocale, locales } = JSON.parse(raw);
      if (!ts || !data) return null;
      if (Date.now() - ts > this._ttl) return null;
      if (locale && locale !== this._locale) return null;
      this._systemLocale = systemLocale || this._systemLocale;
      this._supportedLocales = locales || this._supportedLocales;
      return data;
    } catch (_) {
      return null;
    }
  },
  _saveToCache(data, meta) {
    try {
      sessionStorage.setItem(
        this._cacheKey(),
        JSON.stringify({
          ts: Date.now(),
          data,
          locale: meta?.locale || this._locale,
          systemLocale: meta?.systemLocale || this._systemLocale,
          locales: meta?.locales || this._supportedLocales,
        })
      );
    } catch (_) {}
  },
  invalidate() {
    this._dict = null;
    try {
      // 모든 locale 캐시 무효화 (workspace 변경 등)
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith(this._key)) sessionStorage.removeItem(k);
      });
    } catch (_) {}
  },

  // ── 사용자 override locale ──────────────────────────────
  // localStorage 'oci_user_locale' 있으면 그것을, 없으면 시스템 locale
  _detectInitialLocale() {
    try {
      const userPref = localStorage.getItem('oci_user_locale');
      if (userPref) return userPref;
    } catch (_) {}
    return null; // 백엔드 응답의 system_locale 사용
  },

  // ── fetch ────────────────────────────────────────────────
  // 반환: Promise<dict> (또는 in-memory dict 가 있으면 sync 값)
  // 호출자는 모두 await 사용 — non-Promise 도 await 가 처리
  ensureLoaded() {
    if (this._dict) return this._dict;
    const cached = this._loadFromCache();
    if (cached) {
      this._dict = cached;
      return cached;
    }
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
        // 초기 부팅: locale 미정 → ?locale 생략 (백엔드가 시스템 locale 사용)
        const userPref = this._detectInitialLocale();
        const url = userPref ? '/api/labels?locale=' + encodeURIComponent(userPref) : '/api/labels';
        const r = await fetch(url, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
          credentials: 'include',
        });
        if (!r.ok) throw new Error('labels fetch failed: ' + r.status);
        const j = await r.json();
        const data = j.data || {};
        this._dict = data;
        this._locale = j.locale || userPref || 'ko';
        this._systemLocale = j.system_locale || 'ko';
        this._supportedLocales = j.locales || [];
        this._saveToCache(data, {
          locale: this._locale,
          systemLocale: this._systemLocale,
          locales: this._supportedLocales,
        });
        return data;
      } catch (_) {
        this._dict = {};
        return this._dict;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  },

  // ── locale 변경 ─────────────────────────────────────────
  // 사용자 override 저장 + 캐시 무효화 + 재로드 + DOM 재치환
  async setLocale(locale) {
    if (!locale) return;
    try {
      localStorage.setItem('oci_user_locale', locale);
    } catch (_) {}
    this.invalidate();
    this._locale = locale;
    await this.ensureLoaded();
    this.apply();
  },
  async clearUserLocale() {
    try {
      localStorage.removeItem('oci_user_locale');
    } catch (_) {}
    this.invalidate();
    await this.ensureLoaded();
    this.apply();
  },

  // ── getter ──────────────────────────────────────────────
  getLocale() {
    return this._locale;
  },
  getSystemLocale() {
    return this._systemLocale;
  },
  getSupportedLocales() {
    return this._supportedLocales;
  },

  get(qualified, fallback) {
    if (!this._dict) return fallback ?? qualified;
    const [scope, key] = String(qualified).split('.');
    const v = this._dict?.[scope]?.[key];
    return v || fallback || qualified;
  },

  // ── DOM 치환 ────────────────────────────────────────────
  // data-label        — 요소의 텍스트 내용
  // data-title-label  — 요소의 title (tooltip) 속성
  // data-placeholder-label — input/textarea placeholder 속성
  apply(root) {
    if (!this._dict) return;
    const scope = root || document;

    // 1) 텍스트 콘텐츠
    scope.querySelectorAll('[data-label]').forEach(el => {
      const key = el.getAttribute('data-label');
      if (!key) return;
      const v = this.get(key);
      if (v && v !== key) {
        if (el.children.length === 0) {
          el.textContent = v;
        } else {
          const firstText = Array.from(el.childNodes).find(n => n.nodeType === 3);
          if (firstText) firstText.nodeValue = v;
          else el.prepend(document.createTextNode(v));
        }
      }
    });

    // 2) title (tooltip) 속성
    scope.querySelectorAll('[data-title-label]').forEach(el => {
      const key = el.getAttribute('data-title-label');
      if (!key) return;
      const v = this.get(key);
      if (v && v !== key) el.setAttribute('title', v);
    });

    // 3) placeholder 속성
    scope.querySelectorAll('[data-placeholder-label]').forEach(el => {
      const key = el.getAttribute('data-placeholder-label');
      if (!key) return;
      const v = this.get(key);
      if (v && v !== key) el.setAttribute('placeholder', v);
    });
  },

  // dict 미로드 시 강제 로드 후 적용 — race 방지용
  async applyAsync(root) {
    if (!this._dict) await this.ensureLoaded();
    this.apply(root);
  },

  async init() {
    await this.ensureLoaded();
    this.apply();
  },
};

if (typeof window !== 'undefined') {
  window.Labels = Labels;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Labels.init());
  } else {
    Labels.init();
  }
}
