'use strict';
// =============================================================
// 운영 헬스맵 — 기본 트러블슈팅 가이드 시드
//
// 각 가이드는 4단계 구조:
//   symptom     — 증상 (관찰 가능한 현상)
//   diagnosis   — 진단 (가능한 원인)
//   remedy      — 조치 (지금 당장 할 일)
//   prevention  — 예방 (재발 방지)
//
// node_type:
//   api       — Express 라우트 (/api/...)
//   db        — MariaDB 인스턴스
//   external  — Gemini / Google / Kakao / Exchange 등 외부 API
//   process   — Node.js 프로세스 (CPU / 메모리 / GC)
//   page      — SPA 페이지 (클라이언트 측)
// =============================================================

const DEFAULT_HEALTHMAP_GUIDES = [
  // ── API 일반 ──────────────────────────────────────────
  {
    node_type: 'api',
    node_key: null,
    severity: 'warn',
    title: 'API 응답 지연 (>500ms 평균)',
    symptom:
      '특정 API 라우트의 p50 또는 평균 응답시간이 500ms 를 초과합니다. ' +
      '사용자가 화면 로딩 지연을 체감할 가능성이 있습니다.',
    diagnosis: [
      '1) DB 쿼리 비효율 — N+1, 인덱스 누락, 풀스캔',
      '2) 외부 API 동기 호출 (Gemini, Google) 응답 대기',
      '3) JSON 직렬화/역직렬화 부담 (대용량 응답)',
      '4) CPU/메모리 압박 (다른 워크로드 영향)',
    ].join('\n'),
    remedy: [
      '• 해당 라우트의 SQL 에 EXPLAIN 실행 — 인덱스 사용 여부 확인',
      '• access_logs 에서 같은 path 의 duration 분포 확인 (p95 vs p50)',
      '• 응답 페이로드 크기 측정 — 불필요한 컬럼/조인 제거',
      '• 외부 API 가 원인이면 비동기 처리 또는 캐시 도입',
    ].join('\n'),
    prevention: [
      '• 인덱스 자동 검사 (개발자 옵션 > 스키마 맵)',
      '• 응답 페이로드 크기 모니터링 임계값 설정',
      '• AI/외부 API 호출은 항상 타임아웃 + 캐시',
    ].join('\n'),
  },
  {
    node_type: 'api',
    node_key: null,
    severity: 'critical',
    title: 'API 5xx 에러율 급증',
    symptom: 'HTTP 5xx 에러 비율이 5% 이상으로 상승. 사용자에게 실패 응답이 반환됩니다.',
    diagnosis: [
      '1) DB 연결 실패 또는 풀 고갈',
      '2) 외부 API 다운 또는 타임아웃',
      '3) 코드 버그 (Unhandled Promise Rejection)',
      '4) 메모리 부족으로 인한 OOM',
    ].join('\n'),
    remedy: [
      '• PM2 로그 확인: pm2 logs oci-ai --err --lines 50',
      '• DB 헬스체크: SELECT 1; (수동 실행)',
      '• 외부 API 헬스맵 노드 상태 확인',
      '• 임시 조치로 PM2 재시작 후 원인 추적',
    ].join('\n'),
    prevention: [
      '• Unhandled Rejection 글로벌 핸들러 + Sentry',
      '• DB 커넥션 풀 모니터링',
      '• 외부 API 회로 차단기(Circuit Breaker) 패턴',
    ].join('\n'),
  },

  // ── DB ──────────────────────────────────────────────
  {
    node_type: 'db',
    node_key: null,
    severity: 'warn',
    title: 'DB 슬로우 쿼리 감지',
    symptom: '평균 쿼리 시간이 평소보다 2배 이상 증가. 또는 100ms 초과 쿼리가 분당 10건 이상.',
    diagnosis: [
      '1) 인덱스 누락 또는 쿼리 옵티마이저 오작동',
      '2) 테이블 락 (장기 트랜잭션)',
      '3) DB 자원 부족 (CPU/메모리/디스크 I/O)',
      '4) access_logs 같은 큰 테이블 풀스캔',
    ].join('\n'),
    remedy: [
      '• SHOW PROCESSLIST 로 진행 중인 쿼리 확인',
      '• EXPLAIN <slow query> 로 실행 계획 분석',
      '• 필요 시 SHOW ENGINE INNODB STATUS',
      '• access_logs 등 큰 테이블 주기 정리 (이미 자동 cleanup 등록됨)',
    ].join('\n'),
    prevention: [
      '• slow_query_log = ON 으로 운영 시 누적 분석',
      '• 매 인덱스 추가 PR 에서 ANALYZE TABLE 실행',
      '• 데이터 증가 곡선 모니터링 + 파티셔닝 검토',
    ].join('\n'),
  },
  {
    node_type: 'db',
    node_key: null,
    severity: 'critical',
    title: 'DB 연결 풀 고갈',
    symptom: 'ER_CON_COUNT_ERROR 에러 빈발. 새 쿼리가 대기 상태로 멈춤.',
    diagnosis: [
      '1) 코드에서 connection.release() 누락',
      '2) 장기 실행 트랜잭션이 연결 점유',
      '3) connectionLimit 설정값이 트래픽 대비 부족',
    ].join('\n'),
    remedy: [
      '• 즉시: pm2 restart oci-ai (연결 풀 초기화)',
      '• grep -rn "getConnection" src/  — release 누락 의심 코드',
      '• MariaDB 측 SHOW STATUS LIKE "Threads_connected"',
    ].join('\n'),
    prevention: [
      '• pool.query() 우선 사용 (자동 release)',
      '• 수동 getConnection 시 try/finally 로 release 보장',
      '• 운영 시 평균 vs max 연결수 모니터링',
    ].join('\n'),
  },

  // ── 외부 API ────────────────────────────────────────
  {
    node_type: 'external',
    node_key: null,
    severity: 'warn',
    title: '외부 API 응답 지연',
    symptom: '외부 서비스 (Gemini / Google / Kakao 등) 평균 응답이 3초 초과',
    diagnosis: [
      '1) 외부 서비스 자체의 일시적 부하',
      '2) 네트워크 경로 문제 (CDN, DNS)',
      '3) API rate limit 도달 → 429 반환 후 재시도 비용',
      '4) 잘못된 요청 파라미터로 인한 처리 지연',
    ].join('\n'),
    remedy: [
      '• 외부 서비스 status 페이지 확인 (status.openai.com 등)',
      '• curl 로 직접 호출하여 reproducibility 확인',
      '• 최근 access_logs 에서 같은 외부 API path 의 응답 패턴 검토',
    ].join('\n'),
    prevention: [
      '• 모든 외부 호출에 타임아웃 (default 10초)',
      '• 결과 캐시 (특히 환율 / 카카오 지도)',
      '• Circuit Breaker — 연속 실패 시 일정 시간 차단',
    ].join('\n'),
  },
  {
    node_type: 'external',
    node_key: 'ext.gemini',
    severity: 'critical',
    title: 'Gemini API 호출 실패',
    symptom: 'AI 회의록 / 요약 기능 동작 안 함. 401/403/429/500 에러 반환',
    diagnosis: [
      '401/403 — API 키 만료 또는 권한 회수',
      '429 — 분당/일당 quota 초과',
      '500/503 — Google 측 일시 장애',
      '네트워크 — 도메인 차단 또는 DNS 실패',
    ].join('\n'),
    remedy: [
      '• .env GEMINI_API_KEY 값 확인 + Google Cloud Console 에서 키 상태 확인',
      '• 사용량 확인 — Google AI Studio quota 페이지',
      '• 일시 장애면 자동 재시도 + 사용자 안내 메시지',
    ].join('\n'),
    prevention: [
      '• 키 회전 정책 (90일마다 재발급)',
      '• 사용량 알림 임계값 (월 한도의 80%)',
      '• AI 호출 결과 캐시 (같은 입력 재호출 방지)',
    ].join('\n'),
  },

  // ── 프로세스 ────────────────────────────────────────
  {
    node_type: 'process',
    node_key: null,
    severity: 'warn',
    title: 'Node.js 메모리 사용량 증가',
    symptom: 'process.memoryUsage().heapUsed 가 평소 대비 2배 이상. uptime 길어질수록 증가 추세.',
    diagnosis: [
      '1) 메모리 누수 — 이벤트 리스너 미해제, 클로저 참조 유지',
      '2) 캐시 무한 증가 (Map/Set 에 누적)',
      '3) 큰 응답을 메모리에 적재 (예: 회의록 전사 텍스트)',
    ].join('\n'),
    remedy: [
      '• PM2 max_memory_restart 설정 → 임계값 초과 시 자동 재시작',
      '• Node --inspect 으로 힙 스냅샷 채취 → Chrome DevTools 비교',
      '• 의심 모듈의 캐시 크기 제한 (LRU)',
    ].join('\n'),
    prevention: [
      '• 모든 캐시는 TTL 또는 max-size 설정',
      '• EventEmitter 의 removeListener 보장',
      '• 큰 데이터는 stream 으로 처리 (회의록 STT 등)',
    ].join('\n'),
  },
  {
    node_type: 'process',
    node_key: null,
    severity: 'critical',
    title: 'Node.js CPU 폭주',
    symptom: 'process.cpuUsage() 가 100% 가까이 지속. 요청 응답이 모두 지연됨.',
    diagnosis: [
      '1) 무한 루프 또는 동기 무거운 연산 (정규식, JSON parse 대용량)',
      '2) GC 압박 (메모리 누수와 동반)',
      '3) PDF / Excel 생성 같은 CPU 집약 작업이 메인 스레드에서 실행',
    ].join('\n'),
    remedy: [
      '• 즉시: pm2 restart oci-ai',
      '• Source Monitor (개발자옵션) 에서 최근 변경된 복잡도 높은 함수 확인',
      '• 동기 무거운 연산은 worker_threads 또는 child_process 로 격리',
    ].join('\n'),
    prevention: [
      '• CPU 메트릭 임계값 알림',
      '• 정규식 ReDoS 검사 (특히 사용자 입력 검증)',
      '• PDF/Excel 등 무거운 작업 큐 + 백그라운드 처리',
    ].join('\n'),
  },

  // ── 페이지 (클라이언트) ─────────────────────────────
  {
    node_type: 'page',
    node_key: null,
    severity: 'warn',
    title: '특정 페이지 클라이언트 에러 빈발',
    symptom: '브라우저 콘솔에 같은 에러 메시지 반복. 사용자 보고로만 인지 가능.',
    diagnosis: [
      '1) 새 코드 배포 후 회귀 버그',
      '2) 사용자 브라우저 캐시 (이전 버전 JS + 새 API)',
      '3) 특정 데이터 조합에서만 발생하는 엣지 케이스',
    ].join('\n'),
    remedy: [
      '• 사용자에게 Ctrl+Shift+R 강제 새로고침 안내',
      '• 최근 master 커밋 review',
      '• Playwright E2E 로 회귀 재현',
    ].join('\n'),
    prevention: [
      '• 모든 PR 에 E2E 실행 (CRUD 체크리스트)',
      '• Service Worker 사용 시 버전 관리 철저',
      '• 클라이언트 에러 텔레메트리 도입 (Sentry 등)',
    ].join('\n'),
  },

  // ── 다운 (any node) ──────────────────────────────────
  {
    node_type: 'api',
    node_key: null,
    severity: 'down',
    title: '노드 응답 없음 (down)',
    symptom: '해당 노드의 응답이 30초 이상 없음. 모든 요청이 타임아웃.',
    diagnosis: [
      '1) 프로세스 다운 (PM2 crash)',
      '2) 네트워크 단절',
      '3) DB 연결 완전 차단 (방화벽, IP 변경)',
      '4) 디스크 풀 → 로그 쓰기 실패로 hang',
    ].join('\n'),
    remedy: [
      '• pm2 status 확인 → stopped 면 pm2 restart',
      '• 디스크: df -h',
      '• 네트워크: curl ifconfig.me + ping db_host',
      '• 로그: pm2 logs oci-ai --err --lines 100',
    ].join('\n'),
    prevention: [
      '• PM2 cluster 모드 + 자동 복구',
      '• 디스크 사용량 알림 (>80%)',
      '• access_logs 자동 정리 (이미 적용됨)',
      '• 외부 헬스체크 (UptimeRobot 등)',
    ].join('\n'),
  },
];

module.exports = { DEFAULT_HEALTHMAP_GUIDES };
