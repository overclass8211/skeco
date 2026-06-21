// =============================================================
// OCI CRM — 서버 진입점
// =============================================================
const express = require('express');
const http = require('http');
const https = require('https'); // ① HTTPS
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser'); // ③ Refresh Token 쿠키
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const pool = require('./src/db');
const apiSpec = require('./src/docs/openapi');

const app = express();

// ① 프로덕션: 프록시 신뢰 (nginx / CloudFlare 뒤에서 실제 IP·HTTPS 인식)
if (config.env === 'production') app.set('trust proxy', 1);

// ── 보안 헤더 ─────────────────────────────────────────────────
// ⚠️ HTTP 배포 환경 대응:
//   - HSTS / upgrade-insecure-requests 는 HTTPS 가 준비된 환경에서만 켭니다.
//   - .env 에 ENABLE_HTTPS=true 가 있어야 활성화. 기본값은 비활성 (IP·HTTP 직접 접속 허용).
//   - HTTPS 도입 후 ENABLE_HTTPS=true 설정만 켜면 자동 강화됩니다.
const httpsEnabled = process.env.ENABLE_HTTPS === 'true';
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // 외부 스크립트 로드 허용
    hsts: httpsEnabled, // HTTPS 미사용 환경에서는 HSTS 비활성
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-eval'", // pptxgenjs 내부 동적 eval 필요
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net',
          'https://unpkg.com', // pptxgenjs CDN
          // 카카오 주소 검색 + 지도 SDK (postcode.v2.js / kakao.js 등)
          'https://*.daumcdn.net',
          'https://*.daum.net',
          'https://*.kakao.com',
          'https://dapi.kakao.com',
          // 카카오맵 SDK가 HTTP(http://t1.daumcdn.net/mapjsapi/...) 로 로드되므로 HTTP 도 허용
          'http://*.daumcdn.net',
          'http://*.daum.net',
          'http://*.kakao.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://*.daumcdn.net',
          // 카카오맵 SDK 가 함께 로드하는 스타일시트 (HTTP variant)
          'http://*.daumcdn.net',
        ],
        fontSrc: [
          "'self'",
          'data:', // Quill 등 일부 라이브러리가 폰트를 data: URI 로 인라인 로드
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
          'https://*.daumcdn.net',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.daumcdn.net',
          'https://*.daum.net',
          'https://*.kakao.com',
          // 카카오맵 타일 이미지가 HTTP 로 서빙됨
          'http://*.daumcdn.net',
          'http://*.daum.net',
          'http://*.kakao.com',
        ],
        connectSrc: [
          "'self'",
          'wss:',
          'ws:',
          // CDN 자원 (Service Worker / preload / fetch 호환) — scriptSrc/styleSrc 와 동일
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://unpkg.com',
          'https://*.daumcdn.net',
          'https://*.daum.net',
          'https://*.kakao.com',
          'https://dapi.kakao.com',
          // 카카오 postcode iframe 의 부모-자식 origin 체크용 (HTTP 환경)
          'http://*.daumcdn.net',
          'http://*.daum.net',
          'http://*.kakao.com',
        ],
        // ⚠️ frame-src + child-src 둘 다 명시 (브라우저별 호환)
        // 카카오 postcode 서비스가 HTTP(http://postcode.map.kakao.com) 로 동작하므로 HTTP variants 도 허용
        frameSrc: [
          "'self'",
          'https://*.daum.net',
          'https://*.daumcdn.net',
          'https://*.kakao.com',
          'http://*.daum.net',
          'http://*.daumcdn.net',
          'http://*.kakao.com',
        ],
        childSrc: [
          "'self'",
          'https://*.daum.net',
          'https://*.daumcdn.net',
          'https://*.kakao.com',
          'http://*.daum.net',
          'http://*.daumcdn.net',
          'http://*.kakao.com',
        ],
        mediaSrc: ["'self'", 'blob:'], // 오디오 녹음
        workerSrc: ["'self'", 'blob:'], // Web Worker
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"], // Clickjacking 방어
        // HTTPS 환경에서만 자동 업그레이드 (HTTP 배포 시 정적 자원 차단 방지)
        upgradeInsecureRequests: httpsEnabled ? [] : null,
      },
    },
  })
);

// ── Rate Limiting ─────────────────────────────────────────────
const skipInTest = () => config.rateLimit?.skip === true;
// 환경별 한도 — 개발 환경은 통합 테스트·폴링·HMR 등으로 호출 빈도가 많음
// 운영 한도는 .env 의 RATE_LIMIT_API_MAX / RATE_LIMIT_AI_MAX 로 조정 가능 (재시작 없이 변경)
const isDev = config.env === 'development';
const API_MAX = parseInt(process.env.RATE_LIMIT_API_MAX) || (isDev ? 3000 : 1000); // 15분
const AI_MAX = parseInt(process.env.RATE_LIMIT_AI_MAX) || (isDev ? 100 : 60); // 1분

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: '요청 횟수가 초과되었습니다. 잠시 후 다시 시도하세요.',
    code: 'RATE_LIMIT',
  },
  skip: skipInTest,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AI_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: `AI 요청 한도(분당 ${AI_MAX}회)를 초과했습니다.`,
    code: 'RATE_LIMIT',
  },
  skip: skipInTest,
});

console.log(`[rate-limit] env=${config.env}  api=${API_MAX}/15min  ai=${AI_MAX}/min`);

// ── CORS ─────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.env === 'test') return cb(null, true);
      if (!config.allowedOrigins.length || config.allowedOrigins.includes(origin))
        return cb(null, true);
      cb(new Error('CORS policy: origin not allowed'));
    },
    credentials: true, // 쿠키 전달 허용
  })
);

// ── 압축 / 바디 파서 / 쿠키 파서 ─────────────────────────────
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // ③ HttpOnly 쿠키 파싱

// ── Service Worker 동적 버전 ─────────────────────────────────
// 서버 부팅 시각으로 CACHE_VERSION 자동 주입 → PM2 restart 마다 새 버전
// → 사용자 브라우저의 SW 캐시 자동 무효화 (PWA 업데이트 자동화)
const SW_CACHE_VERSION = `v-${Date.now()}`;
console.log(`📦 Service Worker 캐시 버전: ${SW_CACHE_VERSION}`);

// ── Logo URL 캐시 (60초 TTL) — 별도 모듈에서 관리 ────────
// logo.js 의 업로드/삭제 시 캐시 invalidate 호출 가능
const logoCache = require('./src/utils/logoCache');

app.get('/sw.js', (req, res) => {
  try {
    const fs = require('fs');
    const swPath = path.join(__dirname, 'public/sw.js');
    let content = fs.readFileSync(swPath, 'utf8');
    // 정적 'v1' 같은 값 → 서버 부팅 시각 기반 동적 값으로 치환
    content = content.replace(
      /const CACHE_VERSION = '[^']*'/,
      `const CACHE_VERSION = '${SW_CACHE_VERSION}'`
    );
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
  } catch (err) {
    console.error('[sw.js] load failed:', err.message);
    res.status(500).send('// Service Worker load error');
  }
});

// ── GET / 동적 로고 주입 (Flash 제거) ──────────────────────
// index.html 의 __LOGO_URL__ placeholder 를 현재 로고 URL 로 치환
// → 페이지 로드 즉시 정확한 로고 표시 (기본 로고 깜빡임 방지)
// express.static 보다 먼저 마운트해야 자동 디렉토리 인덱스를 가로챔
app.get('/', async (req, res, next) => {
  try {
    const fs = require('fs');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (!fs.existsSync(indexPath)) return next();

    const logoUrl = await logoCache.getCurrentLogoUrl();
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(/__LOGO_URL__/g, logoUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  } catch (_err) {
    next(); // 실패 시 정적 서빙으로 fallback
  }
});

// manifest.json 도 짧은 캐시로 (PWA 메타 변경 시 빠른 반영)
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false, // GET / 자동 index.html 서빙 비활성 — 위 동적 핸들러가 처리
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(`${path.sep}sw.js`) || filePath.endsWith('/sw.js')) {
        // 정적 경로로 직접 접근 시에도 동일하게 no-cache
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1시간
      }
    },
  })
);
app.use('/api', apiLimiter);
app.use('/api/ai', aiLimiter);

// ── API 문서 (개발·스테이징 전용) ────────────────────────────
if (config.env !== 'production') {
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(apiSpec, {
      customSiteTitle: 'OCI CRM API Docs',
      swaggerOptions: { persistAuthorization: true },
    })
  );
  app.get('/api/docs/spec', (_req, res) => res.json(apiSpec));
}

// 인증 라우트 (RBAC 불필요)
app.use('/api/auth', require('./src/routes/auth'));
// Google OAuth 콜백은 인증 미들웨어 전에 등록 (Google 리디렉션엔 JWT 없음)
app.use('/api/google', require('./src/routes/google'));
// Gmail (Phase G1 — google.js 의 helper 재사용)
app.use('/api/gmail', require('./src/routes/gmail'));

// 헬스체크 — 인증 불필요
app.get('/api/health', async (_req, res) => {
  try {
    const conn = await pool.getConnection();
    conn.release();
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime(), env: config.env });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// 공개 설정 — 클라이언트가 부트스트랩 시 사용 (인증 불필요)
// 카카오맵 JS 키 등 클라이언트 노출이 허용되는 값만 포함
app.get('/api/config/public', (_req, res) => {
  res.json({
    success: true,
    data: {
      kakaoMapKey: config.kakaoMapKey || '',
      hasKakaoMap: !!config.kakaoMapKey,
    },
  });
});

// 제안 공유 링크 — 인증 불필요 (외부 접근, share_token 기반 보안)
// ※ authenticate 미들웨어보다 먼저 등록 (Phase 5-C)
app.use('/api/proposals/share', require('./src/routes/proposalShare'));

// 계약 공유 링크 — 인증 불필요 (외부 접근, contract_share_links.token 기반 보안 + 역할 검증)
// ※ authenticate 미들웨어보다 먼저 등록 (v6.0.0 Phase B)
app.use('/api/contracts/share', require('./src/routes/contractShare'));

// 모두싸인 Webhook — 인증 불필요 (외부 호출, HMAC-SHA256 서명 검증)
// ※ authenticate 미들웨어보다 먼저 등록 (v6.0.0 Step 4)
app.use('/api/webhooks', require('./src/routes/modusignWebhook'));

// 공개 기능 플래그 — 인증 불필요 (로그인 페이지에서 토큰 없이 사용)
// ※ authenticate 미들웨어보다 먼저 등록해야 로그인 전에도 접근 가능
app.get('/api/admin/dev/features/public', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT feature_key, is_enabled FROM dev_features');
    const data = {};
    rows.forEach(r => {
      data[r.feature_key] = !!r.is_enabled;
    });
    res.json({ success: true, data });
  } catch (_) {
    res.json({ success: true, data: {} }); // 실패 시 모든 기능 활성화로 처리
  }
});

// API 접근 로그 + RBAC 인증
const { accessLogMiddleware } = require('./src/middleware/errorHandler');
const { authenticate, autoLevel } = require('./src/middleware/rbac');
app.use('/api', accessLogMiddleware);
app.use('/api', authenticate);
app.use('/api', autoLevel);

// 도메인 라우트
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/leads', require('./src/routes/leads'));
app.use('/api/products', require('./src/routes/products'));
// 프로젝트 단계/상태 정의 (관리자 설정) — /api/projects 보다 먼저 등록해야 /stages·/statuses 가 :id 로 안 빠짐
app.use('/api/projects/statuses', require('./src/routes/project-statuses'));
app.use('/api/projects/stages', require('./src/routes/project-stages'));
app.use('/api/projects', require('./src/routes/projects'));
app.use('/api/team', require('./src/routes/team'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/customer360', require('./src/routes/customer360')); // 고객·제품 360뷰 (MVP 집계)
app.use('/api/activities', require('./src/routes/activities'));
app.use('/api/quotes', require('./src/routes/quotes'));
app.use('/api/proposals', require('./src/routes/proposals'));
app.use('/api/contracts', require('./src/routes/contracts'));
app.use('/api/payments', require('./src/routes/payments')); // v8.0.0 SFR-011 수금관리
app.use('/api/revenue', require('./src/routes/revenue')); // 매출관리 (P2 — payment_schedules 매출 렌즈)
app.use('/api/forecast', require('./src/routes/forecast')); // 매출 포캐스트 (파이프라인 가중 예측)
app.use('/api/production-forecasts', require('./src/routes/productionForecasts')); // 생산예측 (Phase B)
app.use('/api/support', require('./src/routes/support')); // 고객지원(A/S) 모듈 P1
app.use('/api/quality', require('./src/routes/quality')); // 전사 품질관리 (Quality Inbox)
// v6.0.0: 읽음 표시 통합 라우터 (lead/project/quote/proposal/contract 공통)
app.use('/api/read-receipts', require('./src/routes/readReceipts'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/calendar', require('./src/routes/calendar'));
app.use('/api/meeting', require('./src/routes/meetings'));
app.use('/api/meetings', require('./src/routes/meetings'));
app.use('/api/board', require('./src/routes/board'));
app.use('/api/upload', require('./src/routes/upload'));
app.use('/uploads', require('./src/routes/upload'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/search', require('./src/routes/search'));
app.use('/api/email-templates', require('./src/routes/email-templates'));
app.use('/api/webhooks', require('./src/routes/webhooks'));
app.use('/api/admin', require('./src/routes/healthmap'));
app.use('/api/exchange', require('./src/routes/exchange'));
app.use('/api/pipeline/stages', require('./src/routes/pipeline-stages'));
app.use('/api/report-builder', require('./src/routes/report-builder'));
app.use('/api/admin/dev/schema', require('./src/routes/schema-export'));
app.use('/api/admin/menu-config', require('./src/routes/menu-config'));
// 워드 사전 — admin 전용 관리 + 퍼블릭 dictionary
const adminLabelsRouter = require('./src/routes/admin-labels');
app.use('/api/admin/labels', adminLabelsRouter);
app.use('/api/labels', adminLabelsRouter.publicRouter);
app.use('/api/menu', require('./src/routes/menu'));

// 로고 관리
// GET /api/system/logo — 누구나 (로그인 페이지 포함, 인증 미들웨어 전에 마운트)
// POST/DELETE /api/admin/logo — admin 라우트로 분리 (RBAC autoLevel 미들웨어 자동 적용)
const logoRouter = require('./src/routes/logo');
app.use('/api/system/logo', logoRouter);
app.use('/api/admin/logo', logoRouter);

// 로그인 페이지
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// SPA 폴백 — 위쪽의 동적 로고 inject 핸들러가 이미 처리하므로 여기는 fallback 안전망

// 404
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: '요청한 API 엔드포인트를 찾을 수 없습니다.',
    code: 'NOT_FOUND',
  });
});

// 글로벌 에러 핸들러
const { handleError } = require('./src/middleware/errorHandler');
app.use((err, _req, res, _next) => {
  handleError(res, err);
});

const { initTables } = require('./src/initTables');
const { loadBlacklistFromDB } = require('./src/services/authService');

// ── 서버 시작 ────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      const conn = await pool.getConnection();
      console.log(`✅ MariaDB 연결 성공: ${config.db.host}:${config.db.port}`);
      conn.release();
    } catch (err) {
      console.error('❌ MariaDB 연결 실패:', err.message);
    }
    await initTables();

    // ⑤ 서버 재시작 후 블랙리스트 복원 (DB → 메모리)
    await loadBlacklistFromDB(pool);

    // ① HTTPS 지원 ──────────────────────────────────────────
    if (config.sslKeyPath && config.sslCertPath) {
      try {
        const sslOptions = {
          key: fs.readFileSync(config.sslKeyPath),
          cert: fs.readFileSync(config.sslCertPath),
        };
        const httpsServer = https.createServer(sslOptions, app);
        // 장시간 STT 라우트 보호 — 라우트별 req.setTimeout 과 동기화
        httpsServer.requestTimeout = 16 * 60 * 1000;
        httpsServer.headersTimeout = 65 * 1000;

        // WebSocket을 HTTPS 서버에도 연결
        const ws = require('./src/ws');
        ws.init(httpsServer);

        // HTTP → HTTPS 리디렉션 서버
        const httpRedirect = http.createServer((req, res) => {
          const host = req.headers.host?.replace(/:\d+$/, '');
          res.writeHead(301, { Location: `https://${host}:${config.httpsPort}${req.url}` });
          res.end();
        });

        httpsServer.listen(config.httpsPort, () => {
          console.log('═════════════════════════════════════════════');
          console.log('  🔒 OCI CRM HTTPS 서버 시작  [' + config.env + ']');
          console.log('  📍 https://localhost:' + config.httpsPort);
          console.log('  🔀 HTTP 리디렉션: ' + config.port + ' → ' + config.httpsPort);
          console.log('═════════════════════════════════════════════');
        });
        httpRedirect.listen(config.port);
        return;
      } catch (e) {
        console.error('⚠️  SSL 설정 오류 (HTTP로 대체):', e.message);
      }
    }

    // HTTP (개발 기본)
    const httpServer = http.createServer(app);
    // Node 기본 requestTimeout(5분) 으로 인해 장시간 STT (20분+ 녹음) 가
    // 끊기지 않도록 16분으로 확장. 라우트별 req.setTimeout 과 함께 동작.
    httpServer.requestTimeout = 16 * 60 * 1000;
    httpServer.headersTimeout = 65 * 1000;
    const ws = require('./src/ws');
    ws.init(httpServer);

    httpServer.listen(config.port, () => {
      console.log('═════════════════════════════════════════════');
      console.log('  🔴 OCI CRM 서버 시작  [' + config.env + ']');
      console.log('  📍 http://localhost:' + config.port);
      console.log('  🔌 WebSocket 활성화');
      console.log('  🔐 Access Token: ' + config.jwtExpires + ' | Refresh Token: 7d');
      console.log('═════════════════════════════════════════════');
    });

    // ── 환율 자동 갱신 (매일 새벽 4시) ─────────────────────────────────────
    // 수출입은행 매매기준율은 영업일 11시 갱신 → 다음날 새벽에 안전하게 수집
    const Fx = require('./src/services/exchange');
    function scheduleFxRefresh() {
      const next4am = new Date();
      next4am.setHours(4, 0, 0, 0);
      if (next4am <= new Date()) next4am.setDate(next4am.getDate() + 1);
      const delay = next4am - new Date();
      setTimeout(async function runFx() {
        try {
          const r = await Fx.refreshAll();
          console.log(`[FX] 자동 갱신 완료 (${r.source})`);
        } catch (e) {
          console.error('[FX] 자동 갱신 실패:', e.message);
        }
        setTimeout(runFx, 24 * 60 * 60 * 1000);
      }, delay);
      console.log(`[FX] 환율 자동 갱신 등록 (다음: ${next4am.toLocaleString('ko-KR')})`);
    }
    scheduleFxRefresh();

    // ── Gmail 자동 동기화 (Phase G3) — 5분 주기 ────────────────────────
    // gmail_sync_enabled=1 인 사용자만 폴링. 옵트인 기본.
    // server.js 부팅 후 30초 뒤 첫 실행 (DB 마이그레이션 + 토큰 로드 완료 대기)
    const GMAIL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
    setTimeout(() => {
      const gmailSync = require('./src/services/gmailSync');
      const tick = async () => {
        try {
          const results = await gmailSync.pollAll();
          const total = results.reduce((s, r) => s + (r.inserted || 0), 0);
          if (total > 0) {
            console.log(`[gmailSync] ${results.length} users, ${total} new activities`);
          }
        } catch (e) {
          console.error('[gmailSync] tick failed:', e.message);
        }
      };
      tick(); // 즉시 1회
      setInterval(tick, GMAIL_SYNC_INTERVAL_MS).unref?.();
      console.log(`[gmailSync] 자동 동기화 등록 (${GMAIL_SYNC_INTERVAL_MS / 60000}분 주기)`);
    }, 30 * 1000);

    // 서버 시작 시 1회 즉시 갱신 + 백필
    setTimeout(async () => {
      try {
        const [[c]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM exchange_rates WHERE rate_date >= CURRENT_DATE'
        );
        if (c.cnt < 3) {
          console.log('[FX] 오늘자 환율 캐시 부족 — 즉시 갱신');
          await Fx.refreshAll();
        }

        // amount_krw가 NULL인 leads 백필 (1회성, 일괄)
        const [missing] = await pool.query(
          `SELECT id, expected_amount, currency, stage
           FROM leads
           WHERE expected_amount IS NOT NULL AND expected_amount > 0
             AND amount_krw IS NULL
           LIMIT 500`
        );
        if (missing.length) {
          console.log(`[FX] amount_krw 백필 시작: ${missing.length}건`);
          let ok = 0,
            fail = 0;
          const isLocked = stage => ['won', 'lost', 'dropped'].includes(stage);
          for (const r of missing) {
            try {
              const rate = await Fx.getRate(r.currency || 'KRW');
              const krw = Math.round(Number(r.expected_amount) * rate);
              const policy = isLocked(r.stage) ? 'locked' : 'live';
              const lockedAt = isLocked(r.stage) ? new Date() : null;
              await pool.query(
                'UPDATE leads SET amount_krw=?, fx_rate=?, fx_lock_policy=?, fx_locked_at=? WHERE id=?',
                [krw, rate, policy, lockedAt, r.id]
              );
              ok++;
            } catch {
              fail++;
            }
          }
          console.log(`[FX] 백필 완료: 성공 ${ok}건 / 실패 ${fail}건`);
        }
      } catch (e) {
        console.warn('[FX] 초기화 실패:', e.message);
      }
    }, 3000);

    // ── access_logs 자동 정리 (매일 새벽 3시, 90일 초과 레코드 삭제) ──────────
    // 폴링·일반 사용자 요청이 연간 수십만건 누적되는 것을 방지
    function scheduleAccessLogCleanup() {
      const now = new Date();
      const next3am = new Date(now);
      next3am.setHours(3, 0, 0, 0);
      if (next3am <= now) next3am.setDate(next3am.getDate() + 1);
      const delay = next3am - now;

      setTimeout(async function runCleanup() {
        try {
          const [result] = await pool.query(
            `DELETE FROM access_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`
          );
          if (result.affectedRows > 0) {
            console.log(`[cleanup] access_logs 정리: ${result.affectedRows}건 삭제 (90일 초과)`);
          }
        } catch (e) {
          console.error('[cleanup] access_logs 정리 실패:', e.message);
        }
        setTimeout(runCleanup, 24 * 60 * 60 * 1000); // 다음날 같은 시각
      }, delay);

      console.log(
        `[cleanup] access_logs 정리 스케줄 등록 (다음 실행: ${next3am.toLocaleString('ko-KR')})`
      );
    }
    scheduleAccessLogCleanup();

    // v6.0.0 슬림화 — Contract 만료 알림 cron (구 Phase 4) 제거됨.
    // 향후 부활 시: src/services/contractAlerts.js + contract_alerts 테이블 + 본 블록 복원.
  })();
}

module.exports = { app, pool };
