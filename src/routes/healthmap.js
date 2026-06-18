// =============================================================
// Operational Health Map — 운영 헬스맵 API
//
//   GET    /api/admin/healthmap/snapshot       — 전체 노드 + 메트릭 + 상태
//   GET    /api/admin/healthmap/node/:type/:key/logs   — 노드별 최근 로그
//   GET    /api/admin/healthmap/guides         — 가이드 목록
//   GET    /api/admin/healthmap/guides/:id     — 단건
//   POST   /api/admin/healthmap/guides         — 신규
//   PUT    /api/admin/healthmap/guides/:id     — 수정 (is_system=1 거부)
//   DELETE /api/admin/healthmap/guides/:id     — 삭제 (is_system=1 거부)
//   POST   /api/admin/healthmap/ai-interpret   — AI 해석 (캐시 + 옵션)
//
// 권한: superadmin 전용 (서버 진입 미들웨어에서 처리)
// =============================================================

const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');

// 임계값 (UI 에서 향후 조정 가능하도록 메모리 캐시)
const THRESHOLDS = {
  api: {
    warn_ms: 200,
    crit_ms: 500,
    warn_err: 0.01, // 1%
    crit_err: 0.05, // 5%
    down_idle_sec: 120, // 2분간 응답 없으면 다운
  },
  db: {
    warn_ms: 50,
    crit_ms: 200,
  },
  external: {
    warn_ms: 1000,
    crit_ms: 3000,
  },
  process: {
    warn_mem_mb: 400,
    crit_mem_mb: 800,
    warn_cpu: 0.7,
    crit_cpu: 0.9, // 정규화 비율
  },
};

const SEVERITY_RANK = { up: 0, warn: 1, critical: 2, down: 3 };

function statusFromMetrics(type, m) {
  // m: 노드별 메트릭 객체
  const t = THRESHOLDS[type] || {};
  if (type === 'api') {
    if (
      m.lastSeenAgoSec !== null &&
      m.lastSeenAgoSec !== undefined &&
      m.lastSeenAgoSec > t.down_idle_sec &&
      m.totalCalls > 0
    ) {
      // 최근 호출 있던 라우트가 갑자기 끊기면 down 후보 — 보수적으로 warn
    }
    if (m.avgMs > t.crit_ms || m.errRate > t.crit_err) return 'critical';
    if (m.avgMs > t.warn_ms || m.errRate > t.warn_err) return 'warn';
    return 'up';
  }
  if (type === 'db') {
    if (!m.connected) return 'down';
    if (m.avgQueryMs > t.crit_ms) return 'critical';
    if (m.avgQueryMs > t.warn_ms) return 'warn';
    return 'up';
  }
  if (type === 'external') {
    if (m.lastStatus === 'down') return 'down';
    if (m.avgMs > t.crit_ms || m.errRate > 0.1) return 'critical';
    if (m.avgMs > t.warn_ms || m.errRate > 0.02) return 'warn';
    return 'up';
  }
  if (type === 'process') {
    if (m.memoryMb > t.crit_mem_mb || m.cpu > t.crit_cpu) return 'critical';
    if (m.memoryMb > t.warn_mem_mb || m.cpu > t.warn_cpu) return 'warn';
    return 'up';
  }
  return 'up';
}

// API 라우트 자동 발견 — Express _router.stack 활용
function discoverApiNodes(_app) {
  // 안전성 위해 app 직접 참조 안 하고, 헬스맵 API 사용 시점에만 호출
  // 호출자가 server.app 을 전달해야 하나, 여기선 hard-coded API 그룹 fallback 사용
  const KNOWN_API_GROUPS = [
    '/api/leads',
    '/api/customers',
    '/api/projects',
    '/api/activities',
    '/api/calendar',
    '/api/meetings',
    '/api/board',
    '/api/team',
    '/api/dashboard',
    '/api/products',
    '/api/ai',
    '/api/admin',
    '/api/notifications',
    '/api/exchange',
    '/api/auth',
    '/api/google',
    '/api/upload',
    '/api/menu',
    '/api/search',
    '/api/email-templates',
    '/api/pipeline/stages',
  ];
  return KNOWN_API_GROUPS.map(p => ({ id: 'api:' + p, key: p, type: 'api', label: p }));
}

// 외부 API 노드 (하드코딩 — Gemini, Google, Kakao, Exchange)
const EXTERNAL_NODES = [
  { id: 'ext:gemini', key: 'ext.gemini', type: 'external', label: 'Gemini AI' },
  { id: 'ext:google', key: 'ext.google', type: 'external', label: 'Google APIs' },
  { id: 'ext:kakao', key: 'ext.kakao', type: 'external', label: 'Kakao Maps' },
  { id: 'ext:exchange', key: 'ext.exchange', type: 'external', label: '환율 API' },
];

const STATIC_NODES = [
  { id: 'sys:nginx', key: 'sys.nginx', type: 'gateway', label: 'Nginx (HTTPS)' },
  { id: 'sys:process', key: 'sys.process', type: 'process', label: 'Node.js 프로세스' },
  { id: 'sys:db', key: 'sys.db', type: 'db', label: 'MariaDB' },
];

// ─────────────────────────────────────────────────────────────
// 스냅샷 빌더 — HTTP + WebSocket 공유 (ws.js 가 require 해서 사용)
// ─────────────────────────────────────────────────────────────
async function buildSnapshot() {
  const since = new Date(Date.now() - 60 * 1000); // 최근 1분
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ');

  // API 노드 메트릭 — access_logs 기반 (path prefix 매칭)
  const apiNodes = discoverApiNodes();
  const [rows] = await pool.query(
    `SELECT path,
              COUNT(*)                   AS calls,
              ROUND(AVG(duration_ms),0)  AS avg_ms,
              MAX(duration_ms)           AS max_ms,
              SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS srv_err,
              SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) AS cli_err,
              MAX(created_at)            AS last_seen
         FROM access_logs
        WHERE created_at >= ?
        GROUP BY path`,
    [sinceStr]
  );

  // path → API 그룹 매칭
  const apiMetricsByGroup = {};
  for (const row of rows) {
    const grp = apiNodes.find(n => row.path === n.key || row.path.startsWith(n.key + '/'));
    if (!grp) continue;
    const k = grp.key;
    if (!apiMetricsByGroup[k]) {
      apiMetricsByGroup[k] = {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        srvErr: 0,
        cliErr: 0,
        lastSeen: null,
      };
    }
    const m = apiMetricsByGroup[k];
    m.calls += parseInt(row.calls, 10) || 0;
    m.totalMs += (parseFloat(row.avg_ms) || 0) * (parseInt(row.calls, 10) || 0);
    if ((row.max_ms || 0) > m.maxMs) m.maxMs = row.max_ms;
    m.srvErr += parseInt(row.srv_err, 10) || 0;
    m.cliErr += parseInt(row.cli_err, 10) || 0;
    if (!m.lastSeen || row.last_seen > m.lastSeen) m.lastSeen = row.last_seen;
  }

  const now = Date.now();
  const apiResults = apiNodes.map(n => {
    const m = apiMetricsByGroup[n.key] || { calls: 0, totalMs: 0, maxMs: 0, srvErr: 0, cliErr: 0 };
    const avgMs = m.calls ? m.totalMs / m.calls : 0;
    const errRate = m.calls ? (m.srvErr + m.cliErr) / m.calls : 0;
    const lastSeenAgoSec = m.lastSeen
      ? Math.round((now - new Date(m.lastSeen).getTime()) / 1000)
      : null;
    const metrics = {
      totalCalls: m.calls,
      avgMs: Math.round(avgMs),
      maxMs: m.maxMs,
      srvErr: m.srvErr,
      cliErr: m.cliErr,
      errRate: +(errRate * 100).toFixed(2), // 백분율
      lastSeenAgoSec,
    };
    return {
      ...n,
      metrics,
      status: statusFromMetrics('api', { ...metrics, errRate }),
    };
  });

  // 프로세스 메트릭
  const mem = process.memoryUsage();
  const cpuRaw = process.cpuUsage();
  const procMetrics = {
    memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
    memoryTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    cpu: Math.min((cpuRaw.user + cpuRaw.system) / 1e6 / (process.uptime() || 1) / 100, 1),
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
  };
  const procNode = {
    ...STATIC_NODES.find(n => n.id === 'sys:process'),
    metrics: procMetrics,
    status: statusFromMetrics('process', procMetrics),
  };

  // DB 헬스 + 슬로우 쿼리 (access_logs 의 평균 API 응답을 proxy 로)
  let dbConnected = false;
  let dbVersion = null;
  let dbConnections = 0;
  let dbAvgQueryMs = 0;
  try {
    const [[ver]] = await pool.query(`SELECT VERSION() AS v`);
    dbVersion = ver?.v || null;
    const [[stat]] = await pool.query(`SHOW STATUS LIKE 'Threads_connected'`);
    dbConnections = parseInt(stat?.Value, 10) || 0;
    // 최근 1분 평균 API 응답시간을 DB 응답시간의 proxy 로 사용
    const [[av]] = await pool.query(
      `SELECT ROUND(AVG(duration_ms),0) AS avg_ms
           FROM access_logs WHERE created_at >= ?`,
      [sinceStr]
    );
    dbAvgQueryMs = parseInt(av?.avg_ms, 10) || 0;
    dbConnected = true;
  } catch (_) {
    /* DB down */
  }
  const dbMetrics = {
    connected: dbConnected,
    version: dbVersion,
    connections: dbConnections,
    avgQueryMs: dbAvgQueryMs,
  };
  const dbNode = {
    ...STATIC_NODES.find(n => n.id === 'sys:db'),
    metrics: dbMetrics,
    status: statusFromMetrics('db', dbMetrics),
  };

  // 외부 API — runtime health 캐시 (메모리 — 다음 phase 에서 실제 ping)
  const extNodes = EXTERNAL_NODES.map(n => {
    const m = { avgMs: 0, errRate: 0, lastStatus: 'unknown', lastSeenAgoSec: null };
    return { ...n, metrics: m, status: 'up' };
  });

  // Nginx 게이트웨이 — 우리 서버가 응답하면 up
  const gwNode = {
    ...STATIC_NODES.find(n => n.id === 'sys:nginx'),
    metrics: { uptimeSec: procMetrics.uptimeSec },
    status: 'up',
  };

  // 전체 응답
  const allNodes = [gwNode, procNode, dbNode, ...apiResults, ...extNodes];
  const summary = {
    totalNodes: allNodes.length,
    up: allNodes.filter(n => n.status === 'up').length,
    warn: allNodes.filter(n => n.status === 'warn').length,
    critical: allNodes.filter(n => n.status === 'critical').length,
    down: allNodes.filter(n => n.status === 'down').length,
    worstSeverity: ['up', 'warn', 'critical', 'down'].reduce(
      (worst, sev) =>
        allNodes.some(n => n.status === sev) && SEVERITY_RANK[sev] > SEVERITY_RANK[worst]
          ? sev
          : worst,
      'up'
    ),
  };

  // 간선 (edges) — 정적 토폴로지
  const edges = [
    ...apiNodes.map(n => ({ from: 'sys:nginx', to: n.id })),
    ...apiNodes.map(n => ({ from: n.id, to: 'sys:db' })),
    { from: 'api:/api/ai', to: 'ext:gemini' },
    { from: 'api:/api/meetings', to: 'ext:google' },
    { from: 'api:/api/google', to: 'ext:google' },
    { from: 'api:/api/customers', to: 'ext:kakao' },
    { from: 'api:/api/exchange', to: 'ext:exchange' },
  ];

  return {
    nodes: allNodes,
    edges,
    summary,
    thresholds: THRESHOLDS,
    timestamp: new Date().toISOString(),
  };
}

router.get('/healthmap/snapshot', async (req, res) => {
  try {
    const data = await buildSnapshot();
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 노드 클릭 시 — 최근 로그 5개
// ─────────────────────────────────────────────────────────────
router.get('/healthmap/node/:type/:key/logs', async (req, res) => {
  try {
    const { type, key } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    if (type === 'api') {
      // key 는 인코딩된 path (/api/leads 등)
      const pathKey = decodeURIComponent(key);
      const [rows] = await pool.query(
        `SELECT id, method, path, status_code, duration_ms, ip, created_at
           FROM access_logs
          WHERE path = ? OR path LIKE CONCAT(?, '/%')
          ORDER BY created_at DESC
          LIMIT ?`,
        [pathKey, pathKey, limit]
      );
      return res.json({ success: true, data: rows });
    }
    // 다른 타입은 현재 access_logs 외 로그 소스 없음 → 빈 결과
    res.json({ success: true, data: [] });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 가이드 CRUD
// ─────────────────────────────────────────────────────────────
function sanitize(value, maxLen) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

router.get('/healthmap/guides', async (req, res) => {
  try {
    const { node_type, node_key, severity } = req.query;
    let sql = `SELECT id, node_type, node_key, severity, title, symptom, diagnosis,
                      remedy, prevention, is_system, created_by, created_at, updated_at
                 FROM healthmap_guides`;
    const wh = [];
    const params = [];
    if (node_type) {
      wh.push('node_type = ?');
      params.push(String(node_type));
    }
    if (node_key) {
      wh.push('(node_key = ? OR node_key IS NULL)');
      params.push(String(node_key));
    }
    if (severity) {
      wh.push('(severity = ? OR severity = "any")');
      params.push(String(severity));
    }
    if (wh.length) sql += ' WHERE ' + wh.join(' AND ');
    sql += ' ORDER BY is_system DESC, id ASC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/healthmap/guides/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[row]] = await pool.query(`SELECT * FROM healthmap_guides WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ success: false, error: '가이드 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/healthmap/guides', async (req, res) => {
  try {
    const node_type = sanitize(req.body.node_type, 20);
    const title = sanitize(req.body.title, 200);
    if (!node_type || !title) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'node_type / title 은 필수입니다.',
      });
    }
    const userId = getUserId(req);
    const [r] = await pool.query(
      `INSERT INTO healthmap_guides
         (node_type, node_key, severity, title, symptom, diagnosis, remedy, prevention,
          is_system, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        node_type,
        sanitize(req.body.node_key, 200) || null,
        sanitize(req.body.severity, 20) || 'any',
        title,
        sanitize(req.body.symptom, 5000),
        sanitize(req.body.diagnosis, 5000),
        sanitize(req.body.remedy, 5000),
        sanitize(req.body.prevention, 5000),
        userId,
      ]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/healthmap/guides/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[existing]] = await pool.query(
      `SELECT id, is_system FROM healthmap_guides WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ success: false, error: '가이드 없음' });
    if (existing.is_system) {
      return res.status(403).json({
        success: false,
        code: 'SYSTEM_GUIDE_PROTECTED',
        error: '시스템 가이드는 수정할 수 없습니다.',
      });
    }
    const fields = [];
    const params = [];
    const setField = (key, max) => {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(sanitize(req.body[key], max));
      }
    };
    setField('node_type', 20);
    setField('node_key', 200);
    setField('severity', 20);
    setField('title', 200);
    setField('symptom', 5000);
    setField('diagnosis', 5000);
    setField('remedy', 5000);
    setField('prevention', 5000);
    if (!fields.length) return res.json({ success: true, updated: 0 });
    params.push(id);
    const [r] = await pool.query(
      `UPDATE healthmap_guides SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ success: true, updated: r.affectedRows });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/healthmap/guides/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[existing]] = await pool.query(
      `SELECT id, is_system FROM healthmap_guides WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ success: false, error: '가이드 없음' });
    if (existing.is_system) {
      return res.status(403).json({
        success: false,
        code: 'SYSTEM_GUIDE_PROTECTED',
        error: '시스템 가이드는 삭제할 수 없습니다.',
      });
    }
    await pool.query(`DELETE FROM healthmap_guides WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 시스템 가이드 복제 — 사용자 가이드로 카피
router.post('/healthmap/guides/:id/clone', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[src]] = await pool.query(
      `SELECT node_type, node_key, severity, title, symptom, diagnosis, remedy, prevention
         FROM healthmap_guides WHERE id = ?`,
      [id]
    );
    if (!src) return res.status(404).json({ success: false, error: '원본 없음' });
    const newTitle = sanitize(req.body.title, 200) || `${src.title} (복사)`;
    const userId = getUserId(req);
    const [r] = await pool.query(
      `INSERT INTO healthmap_guides
         (node_type, node_key, severity, title, symptom, diagnosis, remedy, prevention,
          is_system, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        src.node_type,
        src.node_key,
        src.severity,
        newTitle,
        src.symptom,
        src.diagnosis,
        src.remedy,
        src.prevention,
        userId,
      ]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// AI 해석 — 24시간 캐시 (off 옵션은 클라이언트에서 호출 자체 안 함)
// POST { node_type, node_key, status, metrics, recent_logs }
// ─────────────────────────────────────────────────────────────
router.post('/healthmap/ai-interpret', async (req, res) => {
  try {
    const { node_type, node_key, status, metrics, recent_logs } = req.body || {};
    if (!node_type) {
      return res
        .status(400)
        .json({ success: false, code: 'VALIDATION_ERROR', error: 'node_type 은 필수입니다.' });
    }

    // 캐시 키 — 입력 해시
    const payloadStr = JSON.stringify({ node_type, node_key, status, metrics });
    const cacheKey = crypto.createHash('sha256').update(payloadStr).digest('hex').slice(0, 64);

    // 24h 캐시 조회
    const [[cached]] = await pool.query(
      `SELECT interpretation, created_at
         FROM healthmap_ai_cache
        WHERE cache_key = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [cacheKey]
    );
    if (cached) {
      return res.json({
        success: true,
        data: { interpretation: cached.interpretation, cached: true, cached_at: cached.created_at },
      });
    }

    // AI 호출 — Gemini
    let interpretation = '';
    let tokensUsed = 0;
    try {
      const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');
      const model = genAI.getGenerativeModel({
        model: MODEL_FAST,
        safetySettings: SAFETY_SETTINGS,
      });
      const prompt = [
        '당신은 운영 시스템 모니터링 전문가입니다.',
        '아래 노드의 상태/메트릭/로그를 보고 한국어로 3-5문장으로 해석해주세요.',
        '',
        `[노드] ${node_type} ${node_key || ''}`,
        `[상태] ${status || 'unknown'}`,
        `[메트릭] ${JSON.stringify(metrics || {})}`,
        '[최근 로그 (최대 5건)]',
        ...(Array.isArray(recent_logs) ? recent_logs.slice(0, 5) : []).map(
          l => `- ${l.method || ''} ${l.path || ''} ${l.status_code || ''} ${l.duration_ms || ''}ms`
        ),
        '',
        '응답 형식 (마크다운):',
        '**현재 상태**: ...',
        '**가능한 원인**: ...',
        '**권장 조치**: ...',
      ].join('\n');

      const result = await model.generateContent(prompt);
      interpretation = result.response.text();
      tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;
    } catch (err) {
      return res.status(503).json({
        success: false,
        code: 'AI_UNAVAILABLE',
        error: 'AI 해석 사용 불가: ' + (err.message || ''),
      });
    }

    // 캐시 저장 (24h)
    await pool.query(
      `INSERT INTO healthmap_ai_cache (cache_key, interpretation, tokens_used)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE interpretation = VALUES(interpretation),
                                  tokens_used   = VALUES(tokens_used),
                                  created_at    = NOW()`,
      [cacheKey, interpretation, tokensUsed]
    );

    res.json({ success: true, data: { interpretation, cached: false, tokens_used: tokensUsed } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports.buildSnapshot = buildSnapshot;
