'use strict';
/**
 * WebSocket 서버
 * - 연결 시 JWT 토큰 검증 (쿼리스트링 ?token=... 또는 Authorization 헤더)
 * - 미인증 연결은 즉시 종료 (코드 4001)
 */
const WebSocket = require('ws');
const { verifyToken, blacklistHas } = require('./services/authService');

let wss = null;
const wsClients = new Set();

// 헬스맵 구독자 — 1초 간격 스냅샷 푸시
const healthmapSubscribers = new Set();
let healthmapTimer = null;

function init(server) {
  wss = new WebSocket.Server({ server, verifyClient });
  wss.on('connection', ws => {
    // verifyClient를 통과한 인증된 연결만 여기까지 도달
    wsClients.add(ws);

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (msg && msg.type === 'healthmap-subscribe') {
        healthmapSubscribers.add(ws);
        _ensureHealthmapTimer();
      } else if (msg && msg.type === 'healthmap-unsubscribe') {
        healthmapSubscribers.delete(ws);
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      healthmapSubscribers.delete(ws);
      _ensureHealthmapTimer();
    });
    ws.on('error', () => {
      wsClients.delete(ws);
      healthmapSubscribers.delete(ws);
    });
  });
}

function _ensureHealthmapTimer() {
  if (healthmapSubscribers.size > 0 && !healthmapTimer) {
    healthmapTimer = setInterval(_broadcastHealthmap, 1000);
  } else if (healthmapSubscribers.size === 0 && healthmapTimer) {
    clearInterval(healthmapTimer);
    healthmapTimer = null;
  }
}

async function _broadcastHealthmap() {
  if (healthmapSubscribers.size === 0) return;
  try {
    const { buildSnapshot } = require('./routes/healthmap');
    if (typeof buildSnapshot !== 'function') return;
    const snapshot = await buildSnapshot();
    const msg = JSON.stringify({ type: 'healthmap-snapshot', data: snapshot });
    healthmapSubscribers.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  } catch (_) {
    /* 다음 tick 에 재시도 */
  }
}

/**
 * WebSocket 연결 전 JWT 검증 콜백
 * 반환값: true → 연결 허용 / false → 거절
 */
function verifyClient(info, callback) {
  // 개발/테스트 환경에서는 인증 생략
  if (process.env.NODE_ENV === 'test') return callback(true);

  try {
    // WHATWG URL API로 쿼리스트링 파싱 (url.parse deprecation 대응)
    const reqUrl = new URL(info.req.url, 'http://localhost');
    // 1) 쿼리스트링에서 토큰 추출: ws://host/...?token=JWT
    // 2) Upgrade 요청의 Authorization 헤더
    const authHeader = info.req.headers['authorization'] || '';
    const token =
      reqUrl.searchParams.get('token') ||
      (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (!token) {
      return callback(false, 401, 'Unauthorized: 토큰이 없습니다.');
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (_) {
      return callback(false, 401, 'Unauthorized: 유효하지 않은 토큰입니다.');
    }

    // 블랙리스트 확인 (인메모리)
    if (decoded.jti && blacklistHas(decoded.jti)) {
      return callback(false, 401, 'Unauthorized: 만료된 세션입니다.');
    }

    callback(true);
  } catch (_) {
    callback(false, 500, 'Internal Server Error');
  }
}

// 기능 토글별 broadcast 가드 매핑
// (data.type 에 따라 해당 기능이 OFF면 emit 안 함)
const WS_FEATURE_MAP = {
  announcement: 'crm.notifications', // 공지사항 — 알림 시스템 토글
  // 향후 추가: 다른 실시간 이벤트도 여기 매핑
};

function wsBroadcast(data) {
  // 기능 토글 OFF 시 broadcast skip — 클라이언트가 OFF 기능 이벤트 수신 방지
  const featureKey = WS_FEATURE_MAP[data?.type];
  if (featureKey) {
    try {
      const { isFeatureEnabled } = require('./middleware/featureGuard');
      // 동기 캐시 사용 — broadcast 는 성능 중요, 비동기 await 회피
      // 캐시가 stale 이면 다음 호출에서 자동 갱신 (5초 TTL)
      isFeatureEnabled(featureKey)
        .then(enabled => {
          if (!enabled) return; // 토글 OFF — broadcast skip
          const msg = JSON.stringify(data);
          wsClients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) c.send(msg);
          });
        })
        .catch(() => {
          // 안전 fallback — 캐시 조회 실패 시에도 broadcast (잠금보다 안전성 우선)
          _doSendAll(data);
        });
      return;
    } catch (_) {
      // 모듈 로드 실패 시에도 fallback
    }
  }
  _doSendAll(data);
}

function _doSendAll(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function getClientCount() {
  return wsClients.size;
}

module.exports = { init, wsBroadcast, getClientCount };
