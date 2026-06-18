const pool = require('../db');
const { AppError } = require('../errors/AppError');

function friendlyError(err) {
  const msg = err.message || String(err);
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    return 'Gemini API 키가 유효하지 않습니다. .env 파일의 GEMINI_API_KEY를 확인 후 서버를 재시작하세요.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || err.status === 429) {
    return 'Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (msg.includes('INVALID_ARGUMENT') || err.status === 400) {
    return '요청 형식 오류입니다: ' + msg;
  }
  return msg;
}

function handleError(res, err) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      ...(err.field ? { field: err.field } : {}),
    });
  }
  console.error('API Error:', err);
  res.status(500).json({ success: false, error: friendlyError(err) });
}

function logAccess(req, statusCode, durationMs) {
  const skip = ['/api/admin/access-logs', '/api/admin/daily-logs', '/api/admin/top-paths'];
  if (skip.some(p => req.path.startsWith(p))) return;
  pool
    .query(
      'INSERT INTO access_logs (action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?)',
      [
        req.method + ' ' + req.path,
        req.method,
        req.path,
        req.ip || req.connection.remoteAddress,
        statusCode || 200,
        durationMs || 0,
      ]
    )
    .catch(() => {});
}

// 폴링성 읽기 전용 엔드포인트는 로깅 제외 (통계 오염 + access_logs 무한 누적 방지)
// app.use('/api', middleware) → req.path는 /api 이후 경로 (/admin/dev/schema 등)
const SKIP_LOG_PATHS = [
  '/admin/access-logs',
  '/admin/daily-logs',
  '/admin/top-paths',
  '/admin/dev/schema', // 스키마 인스펙터 폴링 (캐시 우회 refresh=1 포함)
  '/admin/dev/schema-relations', // 연관도 데이터 폴링
  '/admin/dev/perf', // 성능 모니터 자동 새로고침
  '/admin/dev/error-logs', // 에러 로그 뷰어 페이지네이션 쿼리
  '/admin/dev/error-logs/detect', // 헬스 프로브 호출 자체는 로깅 제외 (탐지된 4xx/5xx는 별도로 기록됨)
  // ── 프론트엔드 주기적 폴링 엔드포인트 ─────────────────────────
  // 로그아웃 상태에서도 계속 호출 → 401이 수백 건씩 access_logs 누적되는 것 방지
  '/ai/usage/today', // AI 사용량 폴링 (헤더 바 실시간 업데이트)
  '/notifications', // 알림 폴링 (미확인 뱃지 업데이트)
  '/briefing/', // 브리핑 캐시 폴링
];

function accessLogMiddleware(req, res, next) {
  // ⚠️  req.path를 미들웨어 진입 시점에 캡처 (중요!)
  // Express 중첩 라우터(/api/admin/...)는 내부에서 req.path를 하위 경로(/dev/schema)로
  // 덮어쓴다. res.on('finish') 시점에는 이미 변경된 값이므로 여기서 먼저 고정.
  const capturedPath = req.path; // 예: /admin/dev/schema

  if (SKIP_LOG_PATHS.some(p => capturedPath.startsWith(p))) return next();
  const start = Date.now();
  res.on('finish', () => {
    // req.user는 authenticate 미들웨어 이후에만 존재하므로 옵셔널 처리
    const userId = req.user?.id || null;
    pool
      .query(
        'INSERT IGNORE INTO access_logs (user_id, action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?,?)',
        [
          userId,
          req.method + ' /api' + capturedPath,
          req.method,
          '/api' + capturedPath,
          req.ip || '',
          res.statusCode,
          Date.now() - start,
        ]
      )
      .catch(() => {});
  });
  next();
}

module.exports = { friendlyError, handleError, logAccess, accessLogMiddleware };
