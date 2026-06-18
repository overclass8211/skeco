// =============================================================
// OCI CRM Service Worker — App Shell 캐싱 + 오프라인 fallback
//
// 전략:
//   - HTML: network-first (최신 우선) → 실패 시 캐시 → 최후 offline.html
//   - CSS/JS/이미지/폰트: cache-first (속도 우선) → 캐시 미스 시 network
//   - /api/*: 캐시 안 함 (실시간 데이터)
//   - /uploads/*: 캐시 안 함 (대용량 + 업로드 직후 변경)
//
// 캐시 무효화:
//   서버(server.js)가 /sw.js 요청 시 부팅 시각을 동적으로 주입.
//   PM2 restart 마다 새 CACHE_VERSION 적용 → 사용자 브라우저 자동 갱신.
//   아래 'v1' 은 fallback (서버 동적 주입 실패 시 또는 로컬 file:// 사용 시).
// =============================================================

'use strict';

// 서버가 부팅 시각으로 자동 교체함 — `const CACHE_VERSION = 'v-1700000000000'` 같은 형태로
const CACHE_VERSION = 'v1';
const APP_CACHE = `oci-crm-${CACHE_VERSION}`;

// 사전 캐시 — 부팅에 필요한 최소 자원만 (작아야 install 빠름)
const PRECACHE_URLS = [
  '/',
  '/css/styles.css',
  '/css/login.css',
  '/js/api.js',
  '/js/utils.js',
  '/js/labels.js',
  '/js/app.js',
  '/assets/oci_logo.png',
  '/assets/pwa-icon.svg',
  '/offline.html',
  '/manifest.json',
];

// ── install: 사전 캐시 ───────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      // addAll 은 하나라도 실패하면 전체 실패 → 개별 add 로 견고하게
      return Promise.all(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] precache miss:', url, err.message);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── activate: 옛 버전 캐시 정리 ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('oci-crm-') && k !== APP_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── fetch: 자원 종류별 전략 분기 ─────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  // GET 만 처리 — POST/PUT/DELETE 는 절대 캐시 안 함
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 같은 origin 만 처리 (CDN 등 외부는 브라우저 기본 처리)
  if (url.origin !== self.location.origin) return;

  // /api/* 와 /uploads/* 는 캐시 절대 X — 인증/실시간 데이터
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;  // 브라우저 기본 fetch (캐시 무관)
  }

  // Phase 5-E: 외부 공유 페이지 — SW 캐시 우회 (항상 최신 데이터)
  if (url.pathname === '/proposal-share.html' ||
      url.pathname.startsWith('/js/pages/proposal-share')) {
    return;
  }
  // v6.0.0 Phase B: 계약 공유 페이지 (contract-share)
  if (url.pathname === '/contract-share.html' ||
      url.pathname === '/js/contract-share.js') {
    return;
  }

  // HTML 요청 (navigation) — network-first
  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 정적 자원 — cache-first
  event.respondWith(cacheFirst(req));
});

// ── network-first: 최신 우선, 실패 시 캐시 → 최후 offline.html ─
async function networkFirst(req) {
  try {
    const networkRes = await fetch(req);
    // 성공 시 캐시 갱신 (오프라인 대비)
    if (networkRes && networkRes.status === 200) {
      const cache = await caches.open(APP_CACHE);
      cache.put(req, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // 캐시도 없으면 오프라인 fallback
    const offline = await caches.match('/offline.html');
    return offline || new Response('Offline', { status: 503 });
  }
}

// ── cache-first: 캐시 우선, 미스 시 network 가져와 캐시 ──────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const networkRes = await fetch(req);
    if (networkRes && networkRes.status === 200) {
      const cache = await caches.open(APP_CACHE);
      cache.put(req, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch (_) {
    return new Response('', { status: 504 });
  }
}

// ── message: 캐시 강제 갱신 트리거 (선택) ────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
