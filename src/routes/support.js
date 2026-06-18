// =============================================================
// /api/support — 고객지원(A/S) 모듈 (P1-A: DB 자가 마이그레이션 + 설정형 CRUD)
//
// 설계 (사용자 승인 스키마):
//   - 테이블 5개: support_tickets / support_settings / support_comments
//                 / support_files / support_history
//   - 설정형 4종(status·type·priority·channel)을 단일 support_settings 테이블로 통합
//     (project_statuses 패턴 복제). kind 로 구분, UNIQUE(kind,item_key).
//   - FK 강제 제약 대신 인덱스 + 앱 관리 무결성 (기존 projects 모듈 컨벤션)
//
// 권한:
//   GET   : 인증된 모든 사용자 (폼/목록 표시용)
//   POST/PUT/DELETE/reorder : admin or superadmin 전용
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { parsePage, pageResult } = require('../utils/routeHelper');
const upload = require('../middleware/upload');

const COLORS = ['blue', 'green', 'amber', 'red', 'gray'];
const normColor = c => (COLORS.includes(c) ? c : 'gray');
const KINDS = ['status', 'type', 'priority', 'channel'];
// 설정형 kind → support_tickets 의 사용 컬럼 (삭제 시 사용 중 검사용)
const KIND_COL = { status: 'status', type: 'type', priority: 'priority', channel: 'channel' };

// ─── 자가 마이그레이션 (idempotent — IF NOT EXISTS + kind별 0건일 때만 시드) ───
async function runMigrations() {
  // ① 티켓(메인)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      ticket_no     VARCHAR(20) NULL UNIQUE COMMENT '자동채번 CS-YYYY-NNNN',
      title         VARCHAR(300) NOT NULL COMMENT '제목/요약',
      description   TEXT NULL COMMENT '상세 내용',
      type          VARCHAR(30) NULL COMMENT '유형 (support_settings kind=type)',
      channel       VARCHAR(30) NULL COMMENT '채널 (kind=channel)',
      priority      VARCHAR(30) NOT NULL DEFAULT 'normal' COMMENT '우선순위 (kind=priority)',
      severity      VARCHAR(20) NULL COMMENT '심각도 (고정 enum low/medium/high/critical)',
      status        VARCHAR(30) NOT NULL DEFAULT 'received' COMMENT '상태 (kind=status)',
      customer_id   INT NULL COMMENT '고객사 (customers.id)',
      lead_id       INT NULL COMMENT '관련 영업딜 (leads.id)',
      contract_id   INT NULL COMMENT '관련 계약',
      project_id    INT NULL COMMENT '관련 프로젝트',
      requester_name  VARCHAR(100) NULL COMMENT '요청자(고객측 담당)',
      requester_phone VARCHAR(40) NULL,
      requester_email VARCHAR(120) NULL,
      assigned_to     INT NULL COMMENT '처리 담당자 (team_members.id)',
      watchers        TEXT NULL COMMENT '참조자(유관부서) JSON [{id,name}]',
      resolution      TEXT NULL COMMENT '조치 내용',
      first_response_at DATETIME NULL COMMENT '최초 응답 시각',
      resolved_at     DATETIME NULL COMMENT '조치완료 시각',
      closed_at       DATETIME NULL COMMENT '종료 시각',
      due_at          DATETIME NULL COMMENT 'SLA 해결기한/처리예정일 (P2)',
      requested_at    DATETIME NULL COMMENT '처리요청일 (고객 희망 처리일) [W1]',
      satisfaction    TINYINT NULL COMMENT 'CSAT 1~5 (P3)',
      created_by    INT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer (customer_id),
      INDEX idx_lead (lead_id),
      INDEX idx_assigned (assigned_to),
      INDEX idx_status (status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // [W1] 처리요청일 컬럼 — 기존 테이블 호환 (멱등: 중복 컬럼 에러 무시)
  try {
    await pool.query(
      `ALTER TABLE support_tickets ADD COLUMN requested_at DATETIME NULL COMMENT '처리요청일(고객 희망 처리일)' AFTER due_at`
    );
  } catch (_) {
    /* 이미 존재 */
  }

  // ② 설정형 4종 통합 (status·type·priority·channel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_settings (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      kind        VARCHAR(20) NOT NULL COMMENT 'status | type | priority | channel',
      item_key    VARCHAR(40) NOT NULL COMMENT '코드값',
      label       VARCHAR(60) NOT NULL COMMENT '표시명',
      color       VARCHAR(20) DEFAULT 'gray' COMMENT '배지 색 (상태/우선순위)',
      sort_order  INT DEFAULT 0,
      is_active   TINYINT(1) DEFAULT 1,
      category    VARCHAR(10) NULL COMMENT 'status 전용: open|pending|closed',
      is_initial  TINYINT(1) DEFAULT 0 COMMENT 'status 전용: 시작 상태',
      is_final    TINYINT(1) DEFAULT 0 COMMENT 'status 전용: 종결 상태',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_kind_key (kind, item_key),
      INDEX idx_kind (kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // [W3] 워크플로우 규칙 컬럼 (status 행에서 사용) — 가산·멱등 (중복 시 무시)
  for (const ddl of [
    "ALTER TABLE support_settings ADD COLUMN allowed_next TEXT NULL COMMENT '[W3] 허용 다음 상태 키 JSON 배열'",
    "ALTER TABLE support_settings ADD COLUMN default_assignee INT NULL COMMENT '[W3] 단계 진입 시 기본 담당자(team_members.id)'",
  ]) {
    try {
      await pool.query(ddl);
    } catch (_) {
      /* 이미 존재 */
    }
  }

  // ③ 댓글 (내부메모 vs 고객공개)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_comments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id   INT NOT NULL,
      author_id   INT NULL,
      content     TEXT NOT NULL,
      is_internal TINYINT(1) DEFAULT 0 COMMENT '1=내부메모, 0=고객공개',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ④ 첨부 (proposal_files 패턴)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_files (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id   INT NOT NULL,
      file_path   VARCHAR(500) NOT NULL,
      file_name   VARCHAR(255) NOT NULL,
      file_size   INT NULL,
      uploaded_by INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ⑤ 변경 이력 (상태/담당 등 감사추적)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_history (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id   INT NOT NULL,
      field       VARCHAR(30) NOT NULL COMMENT '변경 필드 (status/assigned_to 등)',
      from_value  VARCHAR(100) NULL,
      to_value    VARCHAR(100) NULL,
      note        VARCHAR(300) NULL,
      changed_by  INT NULL,
      changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ⑥ 인앱 알림 (할당/완료 등 → 담당자/접수자 수신) [W2]
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_notifications (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL COMMENT '수신자 (team_members.id)',
      ticket_id   INT NOT NULL,
      event_type  VARCHAR(30) NOT NULL COMMENT 'assigned|reassigned|resolved|status',
      message     VARCHAR(300) NOT NULL,
      is_read     TINYINT(1) DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_unread (user_id, is_read, created_at),
      INDEX idx_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 설정형 기본 시드 (kind별 0건일 때만 — 관리자 편집 보존) ──
  const SEED = {
    // 사용자 요청 프로세스 그대로: 접수→등록→할당→처리중→보류/조치완료/드롭
    status: [
      { key: 'received', label: '접수', color: 'blue', sort: 10, category: 'open', is_initial: 1 },
      { key: 'registered', label: '등록', color: 'blue', sort: 20, category: 'open' },
      { key: 'assigned', label: '할당', color: 'blue', sort: 30, category: 'open' },
      { key: 'in_progress', label: '처리중', color: 'blue', sort: 40, category: 'open' },
      { key: 'on_hold', label: '보류', color: 'amber', sort: 50, category: 'pending' },
      {
        key: 'resolved',
        label: '조치완료',
        color: 'green',
        sort: 60,
        category: 'closed',
        is_final: 1,
      },
      { key: 'dropped', label: '드롭', color: 'gray', sort: 70, category: 'closed', is_final: 1 },
    ],
    type: [
      { key: 'issue', label: '이슈', sort: 10 },
      { key: 'fault', label: '장애', sort: 20 },
      { key: 'complaint', label: '불만', sort: 30 },
      { key: 'inquiry', label: '단순문의', sort: 40 },
      { key: 'tech', label: '기술문의', sort: 50 },
    ],
    priority: [
      { key: 'urgent', label: '긴급', color: 'red', sort: 10 },
      { key: 'high', label: '높음', color: 'amber', sort: 20 },
      { key: 'normal', label: '보통', color: 'blue', sort: 30 },
      { key: 'low', label: '낮음', color: 'gray', sort: 40 },
    ],
    channel: [
      { key: 'phone', label: '전화', sort: 10 },
      { key: 'email', label: '이메일', sort: 20 },
      { key: 'visit', label: '방문', sort: 30 },
      { key: 'portal', label: '포털', sort: 40 },
      { key: 'etc', label: '기타', sort: 50 },
    ],
  };
  for (const kind of KINDS) {
    const [[{ cnt }]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM support_settings WHERE kind=?',
      [kind]
    );
    if (cnt === 0) {
      // INSERT IGNORE — 병렬 부팅/테스트 워커가 동시에 시드해도 UNIQUE 충돌로 중단되지 않게 (idempotent)
      for (const s of SEED[kind]) {
        await pool.query(
          `INSERT IGNORE INTO support_settings (kind, item_key, label, color, sort_order, category, is_initial, is_final)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            kind,
            s.key,
            s.label,
            s.color || 'gray',
            s.sort,
            s.category || null,
            s.is_initial || 0,
            s.is_final || 0,
          ]
        );
      }
      console.log(`[support:migration] ${kind} 기본값 ${SEED[kind].length}개 시드 완료`);
    }
  }
  console.log('[support:migration] 자가 마이그레이션 완료 (테이블 5 + 설정형 4종)');
}
runMigrations().catch(err => console.error('[support:migration] 오류:', err));

// ── 권한 가드: admin 또는 superadmin ─────────────────────────
//   (rbac.js 와 동일하게 test 환경은 우회 — 운영은 authenticate 가 req.user 주입)
function adminOnly(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: '고객지원 설정 변경은 관리자(admin) 또는 시스템관리자(superadmin)만 가능합니다.',
    });
  }
  next();
}

// ── 캐시 (설정형 검증/표시가 매번 조회하지 않도록) ─────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000;

async function getSettingsCached() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const [rows] = await pool.query(
    `SELECT id, kind, item_key, label, color, sort_order, is_active, category, is_initial, is_final,
            allowed_next, default_assignee
     FROM support_settings ORDER BY kind ASC, sort_order ASC, id ASC`
  );
  _cache = rows;
  _cacheAt = Date.now();
  return rows;
}
function invalidate() {
  _cache = null;
  _cacheAt = 0;
}
// 활성 설정값 유효성 (티켓 INSERT/UPDATE 검증용 — P1-B)
async function isValidSetting(kind, key) {
  if (!key) return false;
  const rows = await getSettingsCached();
  return rows.some(r => r.is_active && r.kind === kind && r.item_key === key);
}
// 시작 상태 키 (없으면 첫 활성 status) — P1-B 신규 티켓 기본값
async function getInitialStatusKey() {
  const rows = (await getSettingsCached()).filter(r => r.kind === 'status' && r.is_active);
  const init = rows.find(r => r.is_initial);
  return (init || rows[0] || { item_key: 'received' }).item_key;
}

// ── GET /api/support/settings  (전체 — kind별 그룹) ?include=inactive ──
router.get('/settings', async (req, res) => {
  try {
    const includeInactive = req.query.include === 'inactive' || req.query.include === 'all';
    const rows = await getSettingsCached();
    const data = { status: [], type: [], priority: [], channel: [] };
    for (const r of rows) {
      if (!includeInactive && !r.is_active) continue;
      if (data[r.kind]) data[r.kind].push(r);
    }
    res.json({ success: true, data });
  } catch (e) {
    handleError(res, e);
  }
});

// ── GET /api/support/settings/:kind  (단일 kind 배열) ──
router.get('/settings/:kind', async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!KINDS.includes(kind))
      return res.status(400).json({ success: false, error: '유효하지 않은 설정 종류' });
    const includeInactive = req.query.include === 'inactive' || req.query.include === 'all';
    const rows = (await getSettingsCached()).filter(
      r => r.kind === kind && (includeInactive || r.is_active)
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/support/settings/:kind  (신규) ──
// body: { label, color?, sort_order?, item_key?, category?, is_initial?, is_final? }
router.post('/settings/:kind', adminOnly, async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!KINDS.includes(kind))
      return res.status(400).json({ success: false, error: '유효하지 않은 설정 종류' });
    const { label, color = 'gray', sort_order = 0, item_key } = req.body || {};
    const lbl = String(label || '').trim();
    if (!lbl) return res.status(400).json({ success: false, error: 'label 필수' });
    const key = String(item_key || lbl)
      .trim()
      .slice(0, 40);
    if (!key) return res.status(400).json({ success: false, error: 'item_key 도출 실패' });

    // status 전용 속성만 status kind 에 반영
    const isStatus = kind === 'status';
    const category = isStatus ? String(req.body?.category || 'open').slice(0, 10) : null;
    const is_initial = isStatus && req.body?.is_initial ? 1 : 0;
    const is_final = isStatus && req.body?.is_final ? 1 : 0;

    const [r] = await pool.query(
      `INSERT INTO support_settings (kind, item_key, label, color, sort_order, category, is_initial, is_final)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        kind,
        key,
        lbl.slice(0, 60),
        normColor(color),
        parseInt(sort_order) || 0,
        category,
        is_initial,
        is_final,
      ]
    );
    invalidate();
    res.json({ success: true, id: r.insertId, item_key: key });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: '같은 값이 이미 존재합니다' });
    handleError(res, e);
  }
});

// ── PUT /api/support/settings/:id  (item_key·kind 변경 불가 — 정합 보호) ──
router.put('/settings/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[row]] = await pool.query('SELECT kind FROM support_settings WHERE id=?', [id]);
    if (!row) return res.status(404).json({ success: false, error: '설정 항목 없음' });

    const {
      label,
      color,
      sort_order,
      is_active,
      category,
      is_initial,
      is_final,
      allowed_next,
      default_assignee,
    } = req.body || {};
    const updates = [];
    const vals = [];
    if (label !== undefined) {
      updates.push('label=?');
      vals.push(String(label).slice(0, 60));
    }
    if (color !== undefined) {
      updates.push('color=?');
      vals.push(normColor(color));
    }
    if (sort_order !== undefined) {
      updates.push('sort_order=?');
      vals.push(parseInt(sort_order) || 0);
    }
    if (is_active !== undefined) {
      updates.push('is_active=?');
      vals.push(is_active ? 1 : 0);
    }
    // status 전용 속성
    if (row.kind === 'status') {
      if (category !== undefined) {
        updates.push('category=?');
        vals.push(String(category).slice(0, 10));
      }
      if (is_initial !== undefined) {
        updates.push('is_initial=?');
        vals.push(is_initial ? 1 : 0);
      }
      if (is_final !== undefined) {
        updates.push('is_final=?');
        vals.push(is_final ? 1 : 0);
      }
      // [W3] 허용 다음 상태 (빈 배열/null → 제약 없음) + 단계 기본 담당자
      if (allowed_next !== undefined) {
        const arr = parseAllowedNext(allowed_next);
        updates.push('allowed_next=?');
        vals.push(arr.length ? JSON.stringify(arr) : null);
      }
      if (default_assignee !== undefined) {
        updates.push('default_assignee=?');
        vals.push(intOrNull(default_assignee));
      }
    }
    if (!updates.length)
      return res
        .status(400)
        .json({ success: false, error: '수정할 항목 없음 (item_key·종류는 변경 불가)' });
    vals.push(id);
    await pool.query(`UPDATE support_settings SET ${updates.join(',')} WHERE id=?`, vals);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/support/settings/:kind/reorder ──
// body: { order: [{id, sort_order}, ...] }
router.post('/settings/:kind/reorder', adminOnly, async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length)
      return res.status(400).json({ success: false, error: 'order 배열 필요' });
    for (const o of order) {
      if (!Number.isFinite(o.id) || !Number.isFinite(o.sort_order)) continue;
      await pool.query('UPDATE support_settings SET sort_order=? WHERE id=?', [o.sort_order, o.id]);
    }
    invalidate();
    res.json({ success: true, updated: order.length });
  } catch (e) {
    handleError(res, e);
  }
});

// ── DELETE /api/support/settings/:id  (사용 중이면 차단 → 비활성화 안내) ──
router.delete('/settings/:id', adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [[row]] = await pool.query('SELECT kind, item_key FROM support_settings WHERE id=?', [
      id,
    ]);
    if (!row) return res.status(404).json({ success: false, error: '설정 항목 없음' });

    const col = KIND_COL[row.kind];
    if (col) {
      const [[usage]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM support_tickets WHERE ${col}=?`,
        [row.item_key]
      );
      if (usage.cnt > 0) {
        return res.status(409).json({
          success: false,
          error: `이 값에 ${usage.cnt}건의 지원건이 있어 삭제할 수 없습니다. "비활성화"를 사용하세요.`,
          used_count: usage.cnt,
        });
      }
    }
    await pool.query('DELETE FROM support_settings WHERE id=?', [id]);
    invalidate();
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// =============================================================
// P1-B: 티켓 CRUD + 자동채번 + 상태전환·이력 + 댓글 + 첨부
// =============================================================
const intOrNull = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const watJson = v => {
  if (v === null || v === '' || v === undefined) return null;
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch (_) {
    return null;
  }
};
// multer 한글 파일명 복원 (latin1 → utf8)
const decodeName = n => {
  try {
    return Buffer.from(n, 'latin1').toString('utf8');
  } catch (_) {
    return n;
  }
};

// 자동채번 CS-YYYY-NNNN (projects 채번 패턴)
async function generateTicketNo() {
  const yyyy = new Date().getFullYear();
  const prefix = `CS-${yyyy}-`;
  const [[row]] = await pool.query(
    'SELECT ticket_no FROM support_tickets WHERE ticket_no LIKE ? ORDER BY ticket_no DESC LIMIT 1',
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.ticket_no) {
    const m = String(row.ticket_no).match(/CS-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

async function addHistory(ticketId, field, from, to, userId, note) {
  await pool.query(
    `INSERT INTO support_history (ticket_id, field, from_value, to_value, changed_by, note)
     VALUES (?,?,?,?,?,?)`,
    [
      ticketId,
      field,
      from === null || from === undefined ? null : String(from).slice(0, 100),
      to === null || to === undefined ? null : String(to).slice(0, 100),
      userId,
      note ? String(note).slice(0, 300) : null,
    ]
  );
}

// 인앱 알림 생성 — 수신자 없음/본인이면 skip, 실패해도 본 작업에 영향 없음 [W2]
async function addNotification(userId, ticketId, eventType, message) {
  const uid = intOrNull(userId);
  if (!uid) return;
  try {
    await pool.query(
      'INSERT INTO support_notifications (user_id, ticket_id, event_type, message) VALUES (?,?,?,?)',
      [uid, ticketId, eventType, String(message || '').slice(0, 300)]
    );
  } catch (_) {
    /* 알림 실패 무시 */
  }
}

// [W3] 허용 다음 상태 파싱 (JSON 배열 문자열 → 키 배열)
const parseAllowedNext = raw => {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
};

// [F3] 참조자(watchers) JSON [{id,name}] → 고유 id 배열
const parseWatcherIds = raw => {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map(w => intOrNull(w && w.id)).filter(Boolean))];
  } catch (_) {
    return [];
  }
};

// [F3] 참조자 전원에게 인앱 알림 fan-out (actor 제외, 실패 무시는 addNotification 내부)
async function notifyWatchers(watchersRaw, ticketId, eventType, message, excludeUid) {
  const ex = intOrNull(excludeUid);
  for (const wid of parseWatcherIds(watchersRaw)) {
    if (wid === ex) continue;
    await addNotification(wid, ticketId, eventType, message);
  }
}

// 상세/목록 공통 SELECT (설정형 라벨·색 + 담당/고객/리드 조인)
const TICKET_SELECT = `
  SELECT t.*, cs.label AS status_label, cs.color AS status_color, cs.category AS status_category,
         ty.label AS type_label, pr.label AS priority_label, pr.color AS priority_color, ch.label AS channel_label,
         tm.name AS assigned_name, cb.name AS created_by_name, cu.name AS customer_name, l.project_name AS lead_name
    FROM support_tickets t
    LEFT JOIN support_settings cs ON cs.kind='status'   AND cs.item_key=t.status
    LEFT JOIN support_settings ty ON ty.kind='type'     AND ty.item_key=t.type
    LEFT JOIN support_settings pr ON pr.kind='priority' AND pr.item_key=t.priority
    LEFT JOIN support_settings ch ON ch.kind='channel'  AND ch.item_key=t.channel
    LEFT JOIN team_members tm ON tm.id=t.assigned_to
    LEFT JOIN team_members cb ON cb.id=t.created_by
    LEFT JOIN customers cu ON cu.id=t.customer_id
    LEFT JOIN leads l ON l.id=t.lead_id`;

// ── GET /api/support  (목록 + 필터 + 페이지) ──
router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const where = [];
    const params = [];
    const eq = (col, v) => {
      if (v !== undefined && v !== '') {
        where.push(`t.${col}=?`);
        params.push(v);
      }
    };
    eq('status', req.query.status);
    eq('type', req.query.type);
    eq('priority', req.query.priority);
    eq('channel', req.query.channel);
    if (req.query.assigned_to) {
      where.push('t.assigned_to=?');
      params.push(parseInt(req.query.assigned_to, 10));
    }
    if (req.query.customer_id) {
      where.push('t.customer_id=?');
      params.push(parseInt(req.query.customer_id, 10));
    }
    if (req.query.lead_id) {
      where.push('t.lead_id=?');
      params.push(parseInt(req.query.lead_id, 10));
    }
    if (req.query.category) {
      where.push('cs.category=?');
      params.push(req.query.category);
    }
    // [F4] 접수자(created_by) + 접수기간(created_at 범위) 필터
    if (req.query.created_by) {
      where.push('t.created_by=?');
      params.push(parseInt(req.query.created_by, 10));
    }
    if (req.query.from) {
      where.push('t.created_at >= ?');
      params.push(`${req.query.from} 00:00:00`);
    }
    if (req.query.to) {
      where.push('t.created_at <= ?');
      params.push(`${req.query.to} 23:59:59`);
    }
    // [SLA] 대시보드 KPI 클릭 → 처리예정일 기반 빠른 필터 (미해결 한정)
    if (req.query.overdue === '1') {
      where.push(
        'COALESCE(cs.is_final,0)=0 AND t.due_at IS NOT NULL AND DATE(t.due_at) < CURDATE()'
      );
    }
    if (req.query.due === 'today') {
      where.push(
        'COALESCE(cs.is_final,0)=0 AND t.due_at IS NOT NULL AND DATE(t.due_at) = CURDATE()'
      );
    }
    const q = (req.query.q || '').trim();
    if (q) {
      where.push('(t.title LIKE ? OR t.ticket_no LIKE ? OR t.requester_name LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM support_tickets t
         LEFT JOIN support_settings cs ON cs.kind='status' AND cs.item_key=t.status ${wsql}`,
      params
    );
    const [rows] = await pool.query(
      `${TICKET_SELECT} ${wsql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json(pageResult(rows, total, page, limit));
  } catch (e) {
    handleError(res, e);
  }
});

// ── GET /api/support/dashboard — SLA KPI 집계 (읽기전용) ──
// 미해결/오늘예정/기한초과/내담당 미해결/미배정 — 처리예정일(due_at) 기반
// (status 의 is_final 로 종결 제외, 날짜 비교는 DATE() 기준 = D-Day 와 일치)
router.get('/dashboard', async (req, res) => {
  try {
    const uid = getUserId(req) || 0;
    const [[k]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(cs.is_final,0)=0 THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN COALESCE(cs.is_final,0)=0 AND t.due_at IS NOT NULL AND DATE(t.due_at)=CURDATE() THEN 1 ELSE 0 END) AS due_today,
         SUM(CASE WHEN COALESCE(cs.is_final,0)=0 AND t.due_at IS NOT NULL AND DATE(t.due_at)<CURDATE() THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN COALESCE(cs.is_final,0)=0 AND t.assigned_to=? THEN 1 ELSE 0 END) AS mine_open,
         SUM(CASE WHEN COALESCE(cs.is_final,0)=0 AND t.assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned
       FROM support_tickets t
       LEFT JOIN support_settings cs ON cs.kind='status' AND cs.item_key=t.status`,
      [uid]
    );
    res.json({
      success: true,
      data: {
        total: Number(k.total) || 0,
        open: Number(k.open) || 0,
        due_today: Number(k.due_today) || 0,
        overdue: Number(k.overdue) || 0,
        mine_open: Number(k.mine_open) || 0,
        unassigned: Number(k.unassigned) || 0,
      },
    });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/support/check-due — 진입 시 기한 도래 알림 (하루 1회, 중복 방지) [SLA-3] ──
// 내 담당 미해결 + 처리예정일 도래/초과 건이 있으면 요약 알림 1건 생성 (당일 1회).
// 요청(사용자 진입) 트리거 + 멱등(당일 중복 가드) → 부팅/백그라운드 DB 쓰기 없음
router.post('/check-due', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.json({ success: true, created: false, count: 0 });
    // 내 담당 미해결 + 기한 도래/초과 (오늘 포함)
    const [[c]] = await pool.query(
      `SELECT COUNT(*) AS cnt
         FROM support_tickets t
         LEFT JOIN support_settings cs ON cs.kind='status' AND cs.item_key=t.status
        WHERE t.assigned_to=? AND COALESCE(cs.is_final,0)=0
          AND t.due_at IS NOT NULL AND DATE(t.due_at) <= CURDATE()`,
      [uid]
    );
    const count = Number(c.cnt) || 0;
    if (!count) return res.json({ success: true, created: false, count: 0 });
    // 당일 이미 발송했으면 skip (중복 방지)
    const [[dup]] = await pool.query(
      "SELECT id FROM support_notifications WHERE user_id=? AND event_type='due_alert' AND DATE(created_at)=CURDATE() LIMIT 1",
      [uid]
    );
    if (dup) return res.json({ success: true, created: false, count });
    // 가장 시급한(오래된 due) 1건 → 알림 클릭 시 해당 티켓으로 이동
    const [[top]] = await pool.query(
      `SELECT t.id, t.ticket_no
         FROM support_tickets t
         LEFT JOIN support_settings cs ON cs.kind='status' AND cs.item_key=t.status
        WHERE t.assigned_to=? AND COALESCE(cs.is_final,0)=0
          AND t.due_at IS NOT NULL AND DATE(t.due_at) <= CURDATE()
        ORDER BY t.due_at ASC LIMIT 1`,
      [uid]
    );
    const label = top?.ticket_no || '담당 티켓';
    const msg =
      count === 1
        ? `${label} 처리기한이 도래했습니다`
        : `${label} 외 ${count - 1}건의 처리기한이 도래/초과했습니다`;
    await addNotification(uid, top?.id || 0, 'due_alert', msg);
    res.json({ success: true, created: true, count });
  } catch (e) {
    handleError(res, e);
  }
});

// ── GET /api/support/:id ──
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const [[row]] = await pool.query(`${TICKET_SELECT} WHERE t.id=?`, [
      parseInt(req.params.id, 10),
    ]);
    if (!row) return res.status(404).json({ success: false, error: '지원건을 찾을 수 없습니다' });
    res.json({ success: true, data: row });
  } catch (e) {
    handleError(res, e);
  }
});

// ── POST /api/support  (접수/등록 — 자동채번 + 시작상태 + 이력) ──
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: '제목(title)은 필수입니다' });
    for (const [kind, val] of [
      ['type', b.type],
      ['priority', b.priority],
      ['channel', b.channel],
      ['status', b.status],
    ]) {
      if (val && !(await isValidSetting(kind, val)))
        return res.status(400).json({ success: false, error: `유효하지 않은 ${kind}: ${val}` });
    }
    const status = b.status || (await getInitialStatusKey());
    const priority = b.priority || 'normal';
    const uid = getUserId(req);

    // [W1] lead_id 만 있으면 customer_id 자동 도출 (quotes 정합성 패턴)
    let customerId = intOrNull(b.customer_id);
    const leadId = intOrNull(b.lead_id);
    if (leadId && !customerId) {
      const [[lr]] = await pool.query('SELECT customer_id FROM leads WHERE id=? LIMIT 1', [leadId]);
      if (lr && lr.customer_id) customerId = lr.customer_id;
    }
    // [W1] 접수자: 폼에서 지정 가능, 기본=현재 사용자
    const createdBy = intOrNull(b.created_by) || uid;

    let ticketNo;
    let insertId;
    for (let attempt = 0; attempt < 4; attempt++) {
      ticketNo = await generateTicketNo();
      try {
        const [r] = await pool.query(
          `INSERT INTO support_tickets
             (ticket_no, title, description, type, channel, priority, severity, status,
              customer_id, lead_id, contract_id, project_id,
              requester_name, requester_phone, requester_email, assigned_to, watchers, resolution, due_at, requested_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ticketNo,
            title.slice(0, 300),
            b.description || null,
            b.type || null,
            b.channel || null,
            priority,
            b.severity || null,
            status,
            customerId,
            leadId,
            intOrNull(b.contract_id),
            intOrNull(b.project_id),
            b.requester_name ? String(b.requester_name).slice(0, 100) : null,
            b.requester_phone ? String(b.requester_phone).slice(0, 40) : null,
            b.requester_email ? String(b.requester_email).slice(0, 120) : null,
            intOrNull(b.assigned_to),
            watJson(b.watchers),
            b.resolution || null,
            b.due_at || null,
            b.requested_at || null,
            createdBy,
          ]
        );
        insertId = r.insertId;
        break;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY' && attempt < 3) continue; // 채번 충돌 재시도
        throw e;
      }
    }
    await addHistory(insertId, 'created', null, ticketNo, uid, '접수');
    if (intOrNull(b.assigned_to))
      await addHistory(insertId, 'assigned_to', null, b.assigned_to, uid);
    // [F3] 참조자(유관부서)에게 지정 알림
    if (b.watchers !== undefined)
      await notifyWatchers(
        b.watchers,
        insertId,
        'watcher',
        `${ticketNo} 티켓에 참조자로 지정되었습니다`,
        uid
      );
    res.json({ success: true, id: insertId, ticket_no: ticketNo });
  } catch (e) {
    handleError(res, e);
  }
});

// ── PUT /api/support/:id  (수정 + 상태전환 이력/시각) ──
router.put('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[cur]] = await pool.query('SELECT * FROM support_tickets WHERE id=?', [id]);
    if (!cur) return res.status(404).json({ success: false, error: '지원건을 찾을 수 없습니다' });
    const b = req.body || {};
    for (const [kind, val] of [
      ['type', b.type],
      ['priority', b.priority],
      ['channel', b.channel],
      ['status', b.status],
    ]) {
      if (val && !(await isValidSetting(kind, val)))
        return res.status(400).json({ success: false, error: `유효하지 않은 ${kind}: ${val}` });
    }
    // [W3] 상태 전이 규칙 검증 — 현재 상태에 allowed_next 설정된 경우만 강제 (미설정=자유, 하위호환)
    if (b.status !== undefined && b.status !== cur.status) {
      const allSettings = await getSettingsCached();
      const curStatus = allSettings.find(r => r.kind === 'status' && r.item_key === cur.status);
      const allowed = parseAllowedNext(curStatus?.allowed_next);
      if (allowed.length && !allowed.includes(b.status)) {
        const tgt = allSettings.find(r => r.kind === 'status' && r.item_key === b.status);
        return res.status(400).json({
          success: false,
          error: `'${curStatus?.label || cur.status}' → '${tgt?.label || b.status}' 전이는 허용되지 않습니다`,
          code: 'TRANSITION_NOT_ALLOWED',
        });
      }
    }
    // [W1] lead_id 변경 시 customer_id 미지정이면 자동 도출
    if (b.lead_id !== undefined && intOrNull(b.lead_id) && b.customer_id === undefined) {
      const [[lr]] = await pool.query('SELECT customer_id FROM leads WHERE id=? LIMIT 1', [
        intOrNull(b.lead_id),
      ]);
      if (lr && lr.customer_id) b.customer_id = lr.customer_id;
    }
    const sets = [];
    const vals = [];
    const setStr = (col, v, len) => {
      if (v !== undefined) {
        sets.push(`${col}=?`);
        vals.push(v === null || v === '' ? null : String(v).slice(0, len));
      }
    };
    const setInt = (col, v) => {
      if (v !== undefined) {
        sets.push(`${col}=?`);
        vals.push(intOrNull(v));
      }
    };
    setStr('title', b.title, 300);
    setStr('description', b.description, 65535);
    setStr('type', b.type, 30);
    setStr('channel', b.channel, 30);
    setStr('priority', b.priority, 30);
    setStr('severity', b.severity, 20);
    setStr('status', b.status, 30);
    setInt('customer_id', b.customer_id);
    setInt('lead_id', b.lead_id);
    setInt('contract_id', b.contract_id);
    setInt('project_id', b.project_id);
    setStr('requester_name', b.requester_name, 100);
    setStr('requester_phone', b.requester_phone, 40);
    setStr('requester_email', b.requester_email, 120);
    setInt('assigned_to', b.assigned_to);
    setStr('resolution', b.resolution, 65535);
    setInt('satisfaction', b.satisfaction);
    if (b.watchers !== undefined) {
      sets.push('watchers=?');
      vals.push(watJson(b.watchers));
    }
    if (b.due_at !== undefined) {
      sets.push('due_at=?');
      vals.push(b.due_at || null);
    }
    if (b.requested_at !== undefined) {
      sets.push('requested_at=?');
      vals.push(b.requested_at || null);
    }
    setInt('created_by', b.created_by); // [W1] 접수자 변경 허용

    const statusChanged = b.status !== undefined && b.status !== cur.status;
    let autoAssignee = null; // [W3] 단계 자동배정된 담당자 (이력/알림용)
    if (statusChanged) {
      const ns = (await getSettingsCached()).find(
        r => r.kind === 'status' && r.item_key === b.status
      );
      if (ns && ns.is_final) sets.push('closed_at=COALESCE(closed_at, NOW())'); // 종결 시각
      // [W3] 단계 기본 담당자 자동배정 — 티켓 미배정 + 이번 요청에 담당자 미지정 시에만 (기존 담당 보존)
      const def = intOrNull(ns?.default_assignee);
      if (def && !cur.assigned_to && b.assigned_to === undefined) {
        sets.push('assigned_to=?');
        vals.push(def);
        autoAssignee = def;
      }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: '수정할 항목 없음' });
    vals.push(id);
    await pool.query(`UPDATE support_tickets SET ${sets.join(',')} WHERE id=?`, vals);

    const uid = getUserId(req);
    if (statusChanged) {
      await addHistory(id, 'status', cur.status, b.status, uid);
      // [W2] 종결(is_final) 시 접수자에게 인앱 알림
      const ns2 = (await getSettingsCached()).find(
        r => r.kind === 'status' && r.item_key === b.status
      );
      if (ns2 && ns2.is_final && cur.created_by && cur.created_by !== uid) {
        await addNotification(
          cur.created_by,
          id,
          'resolved',
          `${cur.ticket_no || '지원건'} 티켓이 '${ns2.label}' 처리되었습니다`
        );
      }
      // [F3] 종결 시 참조자(유관부서)에게도 정보공유 알림
      if (ns2 && ns2.is_final) {
        const effWatchers = b.watchers !== undefined ? b.watchers : cur.watchers;
        await notifyWatchers(
          effWatchers,
          id,
          'resolved',
          `${cur.ticket_no || '지원건'} 티켓이 '${ns2.label}' 처리되었습니다`,
          uid
        );
      }
    }
    const newAssignee = intOrNull(b.assigned_to);
    if (b.assigned_to !== undefined && newAssignee !== cur.assigned_to) {
      await addHistory(id, 'assigned_to', cur.assigned_to, newAssignee, uid);
      // [W2] PUT 로 담당 변경 시에도 새 담당자에게 알림
      if (newAssignee && newAssignee !== uid) {
        await addNotification(
          newAssignee,
          id,
          cur.assigned_to ? 'reassigned' : 'assigned',
          `${cur.ticket_no || '지원건'} 티켓이 회원님께 할당되었습니다`
        );
      }
    }
    // [W3] 단계 자동배정 시 이력 + 담당자 알림
    if (autoAssignee) {
      await addHistory(id, 'assigned_to', cur.assigned_to, autoAssignee, uid, '단계 자동배정');
      if (autoAssignee !== uid)
        await addNotification(
          autoAssignee,
          id,
          'assigned',
          `${cur.ticket_no || '지원건'} 티켓이 회원님께 자동 배정되었습니다`
        );
    }
    // [F3] 참조자 변경 시 신규 추가된 참조자에게 지정 알림
    if (b.watchers !== undefined) {
      const before = new Set(parseWatcherIds(cur.watchers));
      const added = parseWatcherIds(b.watchers).filter(wid => !before.has(wid));
      for (const wid of added) {
        if (wid !== uid)
          await addNotification(
            wid,
            id,
            'watcher',
            `${cur.ticket_no || '지원건'} 티켓에 참조자로 지정되었습니다`
          );
      }
    }
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── PATCH /api/support/:id/assign  (담당자 할당 + 이력) ──
router.patch('/:id(\\d+)/assign', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[cur]] = await pool.query(
      'SELECT assigned_to, ticket_no FROM support_tickets WHERE id=?',
      [id]
    );
    if (!cur) return res.status(404).json({ success: false, error: '지원건을 찾을 수 없습니다' });
    const to = intOrNull(req.body?.assigned_to);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null; // [W2] 재할당 사유
    const actor = getUserId(req);
    await pool.query('UPDATE support_tickets SET assigned_to=? WHERE id=?', [to, id]);
    await addHistory(id, 'assigned_to', cur.assigned_to, to, actor, note);
    // [W2] 새 담당자에게 인앱 알림 (셀프 할당 제외)
    if (to && to !== actor) {
      const re = cur.assigned_to ? '재' : '';
      await addNotification(
        to,
        id,
        cur.assigned_to ? 'reassigned' : 'assigned',
        `${cur.ticket_no || '지원건'} 티켓이 회원님께 ${re}할당되었습니다${note ? ' — ' + note : ''}`
      );
    }
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── DELETE /api/support/:id  (티켓 + 하위(댓글/첨부/이력) 정리) ──
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[t]] = await pool.query('SELECT id FROM support_tickets WHERE id=?', [id]);
    if (!t) return res.status(404).json({ success: false, error: '지원건을 찾을 수 없습니다' });
    const [files] = await pool.query('SELECT file_path FROM support_files WHERE ticket_id=?', [id]);
    const fs = require('node:fs');
    files.forEach(f => {
      try {
        fs.unlinkSync(f.file_path);
      } catch (_) {
        /* 이미 없음 */
      }
    });
    await pool.query('DELETE FROM support_comments WHERE ticket_id=?', [id]);
    await pool.query('DELETE FROM support_files WHERE ticket_id=?', [id]);
    await pool.query('DELETE FROM support_history WHERE ticket_id=?', [id]);
    await pool.query('DELETE FROM support_tickets WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 댓글 (내부메모 vs 고객공개) ──
router.get('/:id(\\d+)/comments', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.content, c.is_internal, c.created_at, u.full_name AS author_name
         FROM support_comments c LEFT JOIN users u ON u.id=c.author_id
        WHERE c.ticket_id=? ORDER BY c.id ASC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    handleError(res, e);
  }
});
router.post('/:id(\\d+)/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const content = String(req.body?.content || '').trim();
    if (!content)
      return res.status(400).json({ success: false, error: '내용(content)은 필수입니다' });
    const [r] = await pool.query(
      'INSERT INTO support_comments (ticket_id, author_id, content, is_internal) VALUES (?,?,?,?)',
      [id, getUserId(req), content, req.body?.is_internal ? 1 : 0]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 첨부 파일 ──
router.get('/:id(\\d+)/files', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.file_name, f.file_size, f.created_at, u.full_name AS uploaded_by_name
         FROM support_files f LEFT JOIN users u ON u.id=f.uploaded_by
        WHERE f.ticket_id=? ORDER BY f.id ASC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    handleError(res, e);
  }
});
router.post('/:id(\\d+)/files', upload.array('files', 10), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, error: '업로드할 파일 없음' });
    for (const f of files) {
      await pool.query(
        `INSERT INTO support_files (ticket_id, file_path, file_name, file_size, uploaded_by)
         VALUES (?,?,?,?,?)`,
        [id, f.path, decodeName(f.originalname), f.size || null, getUserId(req)]
      );
    }
    res.json({ success: true, count: files.length });
  } catch (e) {
    handleError(res, e);
  }
});
router.get('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT file_path, file_name FROM support_files WHERE id=? AND ticket_id=?',
      [parseInt(req.params.fileId, 10), parseInt(req.params.id, 10)]
    );
    if (!f || !f.file_path) return res.status(404).json({ success: false, error: '파일 없음' });
    res.download(f.file_path, f.file_name || 'file');
  } catch (e) {
    handleError(res, e);
  }
});
router.delete('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const [[f]] = await pool.query(
      'SELECT id, file_path FROM support_files WHERE id=? AND ticket_id=?',
      [parseInt(req.params.fileId, 10), parseInt(req.params.id, 10)]
    );
    if (!f) return res.status(404).json({ success: false, error: '파일 없음' });
    await pool.query('DELETE FROM support_files WHERE id=?', [f.id]);
    if (f.file_path) {
      try {
        require('node:fs').unlinkSync(f.file_path);
      } catch (_) {
        /* 이미 삭제됨 */
      }
    }
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 변경 이력 (감사추적) ──
router.get('/:id(\\d+)/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT h.*, u.full_name AS changed_by_name
         FROM support_history h LEFT JOIN users u ON u.id=h.changed_by
        WHERE h.ticket_id=? ORDER BY h.id ASC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 인앱 알림 (내 알림 조회/읽음) [W2] ──
router.get('/notifications', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.json({ success: true, data: [], unread: 0 });
    const [rows] = await pool.query(
      `SELECT n.*, t.ticket_no, t.title
         FROM support_notifications n LEFT JOIN support_tickets t ON t.id=n.ticket_id
        WHERE n.user_id=? ORDER BY n.is_read ASC, n.id DESC LIMIT 30`,
      [uid]
    );
    const [[c]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM support_notifications WHERE user_id=? AND is_read=0',
      [uid]
    );
    res.json({ success: true, data: rows, unread: c.unread });
  } catch (e) {
    handleError(res, e);
  }
});
router.post('/notifications/:id(\\d+)/read', async (req, res) => {
  try {
    const uid = getUserId(req);
    await pool.query('UPDATE support_notifications SET is_read=1 WHERE id=? AND user_id=?', [
      parseInt(req.params.id, 10),
      uid,
    ]);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});
router.post('/notifications/read-all', async (req, res) => {
  try {
    const uid = getUserId(req);
    await pool.query('UPDATE support_notifications SET is_read=1 WHERE user_id=? AND is_read=0', [
      uid,
    ]);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── 외부 노출 (P1-C/D 프론트·검증에서 사용) ──
module.exports = router;
module.exports.getSettingsCached = getSettingsCached;
module.exports.invalidate = invalidate;
module.exports.isValidSetting = isValidSetting;
module.exports.getInitialStatusKey = getInitialStatusKey;
module.exports.runMigrations = runMigrations;
