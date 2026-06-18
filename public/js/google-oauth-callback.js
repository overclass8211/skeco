// =============================================================
// Google OAuth 콜백 팝업 핸들러
//
// 흐름:
//   1. src/routes/google.js#GET /callback 이 토큰 처리 후 이 페이지를 렌더
//   2. data-payload 에 결과(JSON) 가 임베드됨
//   3. 이 스크립트가 부모 창에 postMessage → meeting.js 의 _onGoogleMessage 수신
//   4. 1.5초 후 자동 close
//
// 왜 외부 파일?
//   helmet CSP 가 inline script 를 차단함 ('unsafe-inline' 없음).
//   외부 'self' 정적 파일은 허용되므로 안전하게 동작.
// =============================================================
(function () {
  'use strict';
  const dataEl = document.getElementById('oauth-data');
  if (!dataEl) return;

  let payload;
  try {
    payload = JSON.parse(dataEl.dataset.payload || '{}');
  } catch (_) {
    return;
  }

  // 부모 창에 결과 알림
  try {
    if (window.opener) {
      window.opener.postMessage(payload, '*');
    }
  } catch (_) {
    /* opener 없거나 cross-origin 차단 — 무시 */
  }

  // 1.5초 후 자동 닫힘 (사용자가 결과 메시지 읽을 시간)
  setTimeout(function () {
    try {
      window.close();
    } catch (_) {}
  }, 1500);
})();
