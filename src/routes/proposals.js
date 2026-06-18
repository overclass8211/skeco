'use strict';
// =============================================================
// /api/proposals — 제안관리 아카이브 (Phase 1: CRUD + 상태 + history)
//
// 기능:
//   - 제안 건 CRUD (헤더만 / 파일/리비전/이메일/AI 는 Phase 3+)
//   - 자동채번 P-YYYY-NNNN (트랜잭션 보호)
//   - 상태 전환 PATCH /status (워크플로우)
//   - proposal_history 자동 기록 (감사 추적)
//   - leads/customers/quotes 연결 (선택)
//
// 권한: 기본 인증 (team_lead+) — autoLevel 미적용 (manager 도 접근 가능)
// 기능 플래그: crm.proposals
//
// 엔드포인트 (Phase 1):
//   GET    /next-proposal-no  — 다음 자동 채번 미리보기
//   GET    /                  — 목록 (페이징, 필터)
//   GET    /:id               — 단건 (history 포함)
//   POST   /                  — 생성 (lead/quote 자동 반영)
//   PUT    /:id               — 수정
//   PATCH  /:id/status        — 상태 전환
//   DELETE /:id               — 삭제 (CASCADE 로 children 자동)
// =============================================================

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');
const readReceipts = require('../services/readReceipts');
const { analyzeProposalRFP, evaluateProposalAgainstRFP } = require('../services/gemini');
const {
  sendMessageWithAttachments,
  classifyError: gmailClassifyError,
} = require('../services/gmail');

router.use(requireFeature('crm.proposals'));

// ── Phase 3: 파일 업로드 인프라 ──────────────────────────────
// 저장 경로: public/uploads/proposals/{proposal_id}/{timestamp}_{sanitized}.ext
// 허용 확장자: pdf, ppt, pptx, doc, docx, xls, xlsx, png, jpg, jpeg, hwp, hwpx
// 제한: 100MB (PPT/HWP 대용량 대응)
const PROPOSAL_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'proposals');
if (!fs.existsSync(PROPOSAL_UPLOAD_DIR)) fs.mkdirSync(PROPOSAL_UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|png|jpe?g|hwp|hwpx)$/i;
const ALLOWED_FILE_TYPES = [
  'rfp',
  'proposal',
  'quote',
  'company_profile',
  'reference',
  'response_form',
  'etc',
];

// 파일명 sanitize — 경로 traversal/특수문자 제거, 한글/영문/숫자/일부 기호만 허용
function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|-]/g, '_') // 위험 문자
    .replace(/\.{2,}/g, '.') // 연속 점 (path traversal 방어)
    .slice(0, 200); // 길이 제한
}

// multer 는 multipart 의 filename 을 latin1 로 디코딩해서 originalname 에 저장한다.
// 브라우저가 UTF-8 로 보낸 한글 파일명을 살리려면 latin1 → utf8 재디코딩이 필요하다.
function decodeOriginalName(originalname) {
  if (!originalname) return 'file';
  try {
    // latin1 1 byte = 0x00~0xFF 그대로 → UTF-8 멀티바이트 시퀀스로 재해석
    return Buffer.from(originalname, 'latin1').toString('utf8');
  } catch (_) {
    return originalname;
  }
}

// proposal_date / due_date / rfp_received_date / rfp_due_date 등 DATE 컬럼 정규화.
// 클라이언트가 ISO 8601 ('2026-05-21T15:00:00.000Z') 을 보내도 'YYYY-MM-DD' 로 변환.
// 빈 문자열/null/undefined → null 반환.
function toYMD(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  // 이미 'YYYY-MM-DD' 형식이면 그대로 통과
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO 8601 또는 다른 Date-parsable 문자열 → 로컬 타임존 기준 'YYYY-MM-DD'
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const proposalUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const propId = parseInt(req.params.id, 10);
      if (!propId) return cb(new Error('proposal_id 누락'));
      const dir = path.join(PROPOSAL_UPLOAD_DIR, String(propId));
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      // 한글 파일명 복원 후 sanitize (디스크에 저장될 파일명)
      const decoded = decodeOriginalName(file.originalname);
      const safe = sanitizeFilename(decoded);
      // 동시 업로드 충돌 방지를 위해 ms + random suffix
      const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_EXT.test(file.originalname);
    cb(null, ok);
  },
});

// Phase 4-B: 단일 'file' + 다중 'files' 양쪽 수용 (호환성 유지)
// - 기존 클라이언트 (.attach('file', ...)) 는 그대로 동작
// - 신규 다중 업로드 (.attach('files', ...) × N) 도 동작
const uploadMixed = proposalUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

// fields 패턴 응답 (req.files = { file: [], files: [] }) 또는
// array 패턴 응답 (req.files = []) 양쪽에서 평탄화된 파일 배열을 추출
function collectFiles(req) {
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return [...(req.files.file || []), ...(req.files.files || [])];
}

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        proposal_no         VARCHAR(50) UNIQUE NOT NULL,
        proposal_title      VARCHAR(300) NOT NULL,
        lead_id             INT NULL,
        customer_id         INT NULL,
        customer_name       VARCHAR(200) NOT NULL,
        quote_id            INT NULL,
        quote_no            VARCHAR(50) NULL,
        proposal_date       DATE NOT NULL,
        due_date            DATE NULL,
        status              VARCHAR(30) DEFAULT 'draft',
        owner_id            INT NULL,
        owner_name          VARCHAR(100) NULL,
        expected_amount     DECIMAL(20,2) NULL,
        currency            VARCHAR(10) DEFAULT 'KRW',
        rfp_title           VARCHAR(300) NULL,
        rfp_received_date   DATE NULL,
        rfp_due_date        DATE NULL,
        rfp_summary         MEDIUMTEXT NULL,
        ai_strategy_md      MEDIUMTEXT NULL,
        ai_strategy_generated_at DATETIME NULL,
        share_token         VARCHAR(100) NULL,
        shared_until        DATETIME NULL,
        version_no          INT DEFAULT 1,
        parent_proposal_id  INT NULL,
        sent_at             DATETIME NULL,
        accepted_at         DATETIME NULL,
        rejected_at         DATETIME NULL,
        remark              TEXT NULL,
        created_by          INT NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_proposal_no       (proposal_no),
        INDEX idx_lead_id           (lead_id),
        INDEX idx_customer_id       (customer_id),
        INDEX idx_quote_id          (quote_id),
        INDEX idx_owner_id          (owner_id),
        INDEX idx_status            (status),
        INDEX idx_proposal_date     (proposal_date),
        INDEX idx_due_date          (due_date),
        INDEX idx_share_token       (share_token),
        INDEX idx_parent            (parent_proposal_id),
        INDEX idx_created_by        (created_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_files (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id         INT NOT NULL,
        file_type           VARCHAR(50) NOT NULL,
        original_filename   VARCHAR(300) NOT NULL,
        stored_filename     VARCHAR(300) NOT NULL,
        file_path           VARCHAR(500) NOT NULL,
        file_size           BIGINT NULL,
        mime_type           VARCHAR(100) NULL,
        revision_no         INT DEFAULT 1,
        is_final            TINYINT(1) DEFAULT 0,
        include_in_email    TINYINT(1) DEFAULT 0,
        description         TEXT NULL,
        uploaded_by         INT NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_type (proposal_id, file_type),
        INDEX idx_proposal_rev  (proposal_id, revision_no),
        CONSTRAINT fk_pf_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_revisions (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id  INT NOT NULL,
        revision_no  INT NOT NULL,
        title        VARCHAR(300) NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_rev (proposal_id, revision_no),
        CONSTRAINT fk_pr_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id  INT NOT NULL,
        action_type  VARCHAR(50) NOT NULL,
        old_value    TEXT NULL,
        new_value    TEXT NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_created (proposal_id, created_at),
        INDEX idx_action (action_type),
        CONSTRAINT fk_ph_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_email_logs (
        id                    INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id           INT NOT NULL,
        to_emails             TEXT NOT NULL,
        cc_emails             TEXT NULL,
        subject               VARCHAR(300) NOT NULL,
        body                  MEDIUMTEXT NULL,
        attachment_file_ids   TEXT NULL,
        gmail_message_id      VARCHAR(100) NULL,
        sent_by               INT NULL,
        sent_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        send_status           VARCHAR(30) DEFAULT 'sent',
        error_message         TEXT NULL,
        INDEX idx_proposal_sent (proposal_id, sent_at),
        CONSTRAINT fk_pel_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Phase 6-B: AI 평가 결과 (RFP 대비 제안서 커버율 + 누락/보완 코칭)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_evaluations (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id         INT NOT NULL,
        target_file_id      INT NOT NULL,
        rfp_file_id         INT NOT NULL,
        coverage_score      INT NOT NULL,
        covered_count       INT DEFAULT 0,
        missing_count       INT DEFAULT 0,
        evaluation_md       MEDIUMTEXT NULL,
        evaluation_json     MEDIUMTEXT NULL,
        generated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by          INT NULL,
        INDEX idx_proposal_eval (proposal_id, generated_at),
        INDEX idx_target_file   (target_file_id),
        CONSTRAINT fk_pev_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // 외래키 실패 시 fallback — FK 없이 재시도 (예: proposals 부재 등)
    console.warn('[proposals:migration] FK 생성 실패 → fallback (FK 없이 재생성):', e.message);
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_files (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          file_type VARCHAR(50) NOT NULL, original_filename VARCHAR(300) NOT NULL,
          stored_filename VARCHAR(300) NOT NULL, file_path VARCHAR(500) NOT NULL,
          file_size BIGINT NULL, mime_type VARCHAR(100) NULL, revision_no INT DEFAULT 1,
          is_final TINYINT(1) DEFAULT 0, include_in_email TINYINT(1) DEFAULT 0,
          description TEXT NULL, uploaded_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_type (proposal_id, file_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_revisions (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          revision_no INT NOT NULL, title VARCHAR(300) NULL, description TEXT NULL,
          created_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_rev (proposal_id, revision_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_history (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          action_type VARCHAR(50) NOT NULL, old_value TEXT NULL, new_value TEXT NULL,
          description TEXT NULL, created_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_created (proposal_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_email_logs (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          to_emails TEXT NOT NULL, cc_emails TEXT NULL, subject VARCHAR(300) NOT NULL,
          body MEDIUMTEXT NULL, attachment_file_ids TEXT NULL,
          gmail_message_id VARCHAR(100) NULL, sent_by INT NULL,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          send_status VARCHAR(30) DEFAULT 'sent', error_message TEXT NULL,
          INDEX idx_proposal_sent (proposal_id, sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      // Phase 6-B: AI 평가 (FK 없이)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_evaluations (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          target_file_id INT NOT NULL, rfp_file_id INT NOT NULL,
          coverage_score INT NOT NULL, covered_count INT DEFAULT 0, missing_count INT DEFAULT 0,
          evaluation_md MEDIUMTEXT NULL, evaluation_json MEDIUMTEXT NULL,
          generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_by INT NULL,
          INDEX idx_proposal_eval (proposal_id, generated_at),
          INDEX idx_target_file (target_file_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }
}
const _migrationPromise = ensureSchema();

// 첫 요청 안전성 — 마이그레이션 promise await
router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── 자동채번 헬퍼 (P-YYYY-NNNN) ─────────────────────────────
async function generateProposalNo(conn, year) {
  const yyyy = year || new Date().getFullYear();
  const prefix = `P-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT proposal_no FROM proposals
      WHERE proposal_no LIKE ?
      ORDER BY proposal_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.proposal_no) {
    const m = row.proposal_no.match(/P-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// ── history 자동 기록 헬퍼 ──────────────────────────────────
async function logHistory(conn, proposalId, userId, actionType, opts = {}) {
  try {
    await (conn || pool).query(
      `INSERT INTO proposal_history
        (proposal_id, action_type, old_value, new_value, description, created_by)
       VALUES (?,?,?,?,?,?)`,
      [
        proposalId,
        String(actionType).slice(0, 50),
        opts.oldValue ? String(opts.oldValue).slice(0, 65000) : null,
        opts.newValue ? String(opts.newValue).slice(0, 65000) : null,
        opts.description ? String(opts.description).slice(0, 65000) : null,
        userId || null,
      ]
    );
  } catch (e) {
    // history 실패는 본 작업에 영향 X (로그만)
    console.warn('[proposals:history] log failed:', e.message);
  }
}

// 허용 상태값 (단일 진실 소스)
const ALLOWED_STATUS = [
  'draft',
  'review',
  'ready',
  'sent',
  'revised',
  'accepted',
  'rejected',
  'expired',
];

// ── GET /next-proposal-no — 다음 자동 채번 미리보기 ──────────
// ⚠️ 반드시 /:id 보다 먼저 선언 (Express 라우트 매칭 순서)
// v6.0.0: GET /api/proposals/dashboard — 상단 KPI 카드 (5개 모듈 통일)
// 작성중 / 발송 / 수주 / 마감 임박
router.get('/dashboard', async (req, res) => {
  try {
    const [[row]] = await pool.query(`
      SELECT
        SUM(CASE WHEN status IN ('draft','review','ready') THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status IN ('sent','revised')         THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'accepted'                  THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN status NOT IN ('accepted','rejected','expired')
                  AND due_date IS NOT NULL
                  AND due_date BETWEEN CURDATE()
                  AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS due_7d
      FROM proposals
    `);
    res.json({
      success: true,
      data: {
        in_progress: Number(row.in_progress) || 0,
        sent: Number(row.sent) || 0,
        accepted: Number(row.accepted) || 0,
        due_7d: Number(row.due_7d) || 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/next-proposal-no', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const next = await generateProposalNo(conn, year);
      res.json({ success: true, data: { proposal_no: next, year } });
    } finally {
      conn.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET / — 목록 (페이징 + 필터) ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      search,
      status,
      customer_id,
      lead_id,
      quote_id,
      date_from,
      date_to,
      due_soon,
      autocomplete,
    } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    // v6.0.0 Step 2: Autocomplete 모드 (계약 모달의 제안 Combobox 용)
    if (autocomplete === '1' && search) {
      const q = String(search).trim();
      if (q.length < 2) return res.json({ success: true, data: [], query: q });
      const acLimit = Math.min(20, parseInt(req.query.limit) || 10);
      const [rows] = await pool.query(
        `SELECT id, proposal_no, proposal_title, customer_id, customer_name,
                lead_id, status, expected_amount, currency
           FROM proposals
          WHERE (proposal_no LIKE ? OR proposal_title LIKE ? OR customer_name LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
        [`%${q}%`, `%${q}%`, `%${q}%`, acLimit]
      );
      return res.json({ success: true, data: rows, query: q });
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (p.proposal_title LIKE ? OR p.proposal_no LIKE ? OR p.customer_name LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k);
    }
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (customer_id) {
      where += ' AND p.customer_id = ?';
      params.push(parseInt(customer_id, 10));
    }
    if (lead_id) {
      where += ' AND p.lead_id = ?';
      params.push(parseInt(lead_id, 10));
    }
    if (quote_id) {
      where += ' AND p.quote_id = ?';
      params.push(parseInt(quote_id, 10));
    }
    if (date_from) {
      where += ' AND p.proposal_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      where += ' AND p.proposal_date <= ?';
      params.push(date_to);
    }
    if (due_soon === '1' || due_soon === 'true') {
      // 마감 7일 이내 (또는 이미 지난 것 중 sent 안 된 것)
      where += ' AND p.due_date IS NOT NULL AND p.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
    }

    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM proposals p ${where}`, params),
      pool.query(
        `SELECT p.id, p.proposal_no, p.proposal_title, p.customer_name,
                p.lead_id, p.customer_id, p.quote_id, p.quote_no,
                p.expected_amount, p.currency, p.status,
                p.proposal_date, p.due_date, p.owner_id, p.owner_name,
                p.version_no AS latest_revision_no, p.sent_at, p.created_at,
                tm.name AS created_by_name,
                (SELECT COUNT(*) FROM proposal_files pf WHERE pf.proposal_id = p.id) AS file_count
           FROM proposals p
           LEFT JOIN team_members tm ON tm.id = p.created_by
           ${where}
          ORDER BY p.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRow[0]?.total ?? 0);
    // v6.0.0: 읽음 상태 enrich
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'proposal', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id — 단건 + 연결 정보 + history ─────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    // v6.0.0: 모달 오픈 = 읽음 처리
    readReceipts.markRead(getUserId(req), 'proposal', id).catch(() => {});

    const [[proposal]] = await pool.query(
      `SELECT p.*, tm.name AS created_by_name
         FROM proposals p
         LEFT JOIN team_members tm ON tm.id = p.created_by
        WHERE p.id = ?`,
      [id]
    );
    if (!proposal) return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });

    // 연결된 lead/quote 요약 (있으면)
    const queries = [];
    if (proposal.lead_id) {
      queries.push(
        pool.query(
          `SELECT id, customer_name, project_name, stage, expected_amount, currency, amount_krw
             FROM leads WHERE id = ?`,
          [proposal.lead_id]
        )
      );
    } else {
      queries.push(Promise.resolve([[null]]));
    }
    if (proposal.quote_id) {
      queries.push(
        pool.query(
          `SELECT id, quote_no, name, total_amount, subtotal, vat_amount, vat_included, status
             FROM quotes WHERE id = ?`,
          [proposal.quote_id]
        )
      );
    } else {
      queries.push(Promise.resolve([[null]]));
    }
    queries.push(
      pool.query(`SELECT * FROM proposal_files WHERE proposal_id = ? ORDER BY created_at DESC`, [
        id,
      ]),
      pool.query(
        `SELECT * FROM proposal_revisions WHERE proposal_id = ? ORDER BY revision_no DESC`,
        [id]
      ),
      pool.query(
        `SELECT pel.*, tm.name AS sent_by_name
           FROM proposal_email_logs pel
           LEFT JOIN team_members tm ON tm.id = pel.sent_by
          WHERE pel.proposal_id = ? ORDER BY pel.sent_at DESC LIMIT 100`,
        [id]
      ),
      pool.query(
        `SELECT ph.*, tm.name AS created_by_name
           FROM proposal_history ph
           LEFT JOIN team_members tm ON tm.id = ph.created_by
          WHERE ph.proposal_id = ? ORDER BY ph.created_at DESC LIMIT 200`,
        [id]
      ),
      // Phase 11-A: 최신 AI 평가 1건 + 파일명 (모달 재진입 시 자동 표시)
      pool.query(
        `SELECT pe.id, pe.proposal_id, pe.target_file_id, pe.rfp_file_id,
                pe.coverage_score, pe.covered_count, pe.missing_count,
                pe.evaluation_md, pe.evaluation_json, pe.generated_at,
                tf.original_filename AS target_filename,
                rf.original_filename AS rfp_filename,
                tm.name AS created_by_name
           FROM proposal_evaluations pe
           LEFT JOIN proposal_files tf ON tf.id = pe.target_file_id
           LEFT JOIN proposal_files rf ON rf.id = pe.rfp_file_id
           LEFT JOIN team_members tm ON tm.id = pe.created_by
          WHERE pe.proposal_id = ?
          ORDER BY pe.generated_at DESC
          LIMIT 1`,
        [id]
      )
    );
    const [[[lead]], [[quote]], [files], [revisions], [emailLogs], [history], [[latestEvalRow]]] =
      await Promise.all(queries);

    // Phase 11-A: evaluation_json 안에 전체 평가 데이터 (covered_items/quality_metrics 등)
    let latestEval = null;
    if (latestEvalRow) {
      let detail = null;
      try {
        detail = latestEvalRow.evaluation_json ? JSON.parse(latestEvalRow.evaluation_json) : null;
      } catch (_) {
        /* ignore */
      }
      latestEval = {
        id: latestEvalRow.id,
        proposal_id: latestEvalRow.proposal_id,
        target_file_id: latestEvalRow.target_file_id,
        rfp_file_id: latestEvalRow.rfp_file_id,
        target_filename: latestEvalRow.target_filename,
        rfp_filename: latestEvalRow.rfp_filename,
        coverage_score: latestEvalRow.coverage_score,
        covered_count: latestEvalRow.covered_count,
        missing_count: latestEvalRow.missing_count,
        generated_at: latestEvalRow.generated_at,
        created_by_name: latestEvalRow.created_by_name,
        // evaluation_json 풀어서 노출 (프론트 _renderEvalResult 와 동일 schema)
        covered_items: (detail && detail.covered_items) || [],
        missing_items: (detail && detail.missing_items) || [],
        improvement_suggestions: (detail && detail.improvement_suggestions) || [],
        overall_assessment:
          (detail && detail.overall_assessment) || latestEvalRow.evaluation_md || null,
        win_probability: (detail && detail.win_probability) || 0,
        quality_metrics: (detail && detail.quality_metrics) || null,
        win_factors: (detail && detail.win_factors) || [],
        risk_factors: (detail && detail.risk_factors) || [],
      };
    }

    res.json({
      success: true,
      data: {
        ...proposal,
        lead,
        quote,
        files,
        revisions,
        email_logs: emailLogs,
        history,
        latest_evaluation: latestEval,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST / — 생성 ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const body = req.body || {};
    if (!body.proposal_title || !String(body.proposal_title).trim()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '제안명이 필요합니다' });
    }
    if (!body.proposal_date) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '제안일이 필요합니다' });
    }
    let customerName = body.customer_name ? String(body.customer_name).trim() : '';

    // lead_id 자동 반영 (customer_name 비어있으면 lead 에서 추출)
    let leadCustomerId = null;
    let leadExpectedAmount = null;
    let leadCurrency = null;
    if (body.lead_id) {
      const [[lead]] = await conn.query(
        `SELECT customer_id, customer_name, expected_amount, currency FROM leads WHERE id = ?`,
        [body.lead_id]
      );
      if (lead) {
        if (!customerName) customerName = lead.customer_name || '';
        leadCustomerId = lead.customer_id || null;
        leadExpectedAmount = lead.expected_amount || null;
        leadCurrency = lead.currency || null;
      }
    }

    // quote_id 자동 반영 (quote_no/expected_amount/currency 추출)
    let quoteNo = body.quote_no || null;
    let quoteTotalAmount = null;
    if (body.quote_id) {
      const [[quote]] = await conn.query(
        `SELECT quote_no, total_amount, customer_name FROM quotes WHERE id = ?`,
        [body.quote_id]
      );
      if (quote) {
        quoteNo = quote.quote_no;
        quoteTotalAmount = quote.total_amount;
        if (!customerName) customerName = quote.customer_name || '';
      }
    }

    if (!customerName) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '고객명이 필요합니다' });
    }

    // 날짜 정규화 (ISO 8601 → 'YYYY-MM-DD')
    const proposalDate = toYMD(body.proposal_date);
    const dueDate = toYMD(body.due_date);
    const rfpReceivedDate = toYMD(body.rfp_received_date);
    const rfpDueDate = toYMD(body.rfp_due_date);
    if (!proposalDate) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '제안일 형식이 유효하지 않습니다' });
    }

    // 자동 채번 (수동 입력 가능)
    const year = new Date(proposalDate).getFullYear() || new Date().getFullYear();
    let proposalNo = body.proposal_no && String(body.proposal_no).trim();
    if (!proposalNo) proposalNo = await generateProposalNo(conn, year);

    // owner_name 자동 보강 (owner_id 있으면 team_members 에서 조회)
    let ownerName = body.owner_name || null;
    if (body.owner_id && !ownerName) {
      const [[tm]] = await conn.query(`SELECT name FROM team_members WHERE id = ?`, [
        body.owner_id,
      ]);
      ownerName = tm?.name || null;
    }

    // 최종 expected_amount: 명시값 > 견적 총액 > lead 예상금액
    const expectedAmount =
      body.expected_amount !== undefined && body.expected_amount !== null
        ? body.expected_amount
        : quoteTotalAmount || leadExpectedAmount || null;
    const currency = body.currency || leadCurrency || 'KRW';

    const [result] = await conn.query(
      `INSERT INTO proposals
        (proposal_no, proposal_title, lead_id, customer_id, customer_name,
         quote_id, quote_no, proposal_date, due_date, status,
         owner_id, owner_name, expected_amount, currency,
         rfp_title, rfp_received_date, rfp_due_date, rfp_summary,
         version_no, parent_proposal_id, remark, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        proposalNo,
        String(body.proposal_title).slice(0, 300),
        body.lead_id || null,
        body.customer_id || leadCustomerId || null,
        String(customerName).slice(0, 200),
        body.quote_id || null,
        quoteNo,
        proposalDate,
        dueDate,
        body.status && ALLOWED_STATUS.includes(body.status) ? body.status : 'draft',
        body.owner_id || null,
        ownerName,
        expectedAmount,
        currency,
        body.rfp_title || null,
        rfpReceivedDate,
        rfpDueDate,
        body.rfp_summary || null,
        Number(body.version_no) || 1,
        body.parent_proposal_id || null,
        body.remark || null,
        userId || null,
      ]
    );
    const proposalId = result.insertId;
    await logHistory(conn, proposalId, userId, 'create', {
      description: `제안 건 생성: ${proposalNo}`,
    });

    // lead_id 가 있으면 activities 에 활동 자동 기록 (best-effort — 실패해도 제안 생성 성공)
    if (body.lead_id) {
      try {
        await conn.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, created_by)
           VALUES (?, '제안', ?, ?, ?)`,
          [
            body.lead_id,
            `제안 건 생성: ${proposalNo}`,
            `제안명: ${body.proposal_title}`,
            userId || null,
          ]
        );
      } catch (_) {
        /* activities 미존재/스키마 차이 — 무시 */
      }
    }

    await conn.commit();
    res.json({
      success: true,
      id: proposalId,
      data: { id: proposalId, proposal_no: proposalNo },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '제안번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:id — 수정 ─────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const body = req.body || {};

    const [[prev]] = await conn.query(`SELECT * FROM proposals WHERE id = ?`, [id]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    // v6.0.0: 데이터 정합성 — lead_id 가 (변경되어) 들어왔는데 customer_id 가 비어있으면 자동 도출
    // (고객사 카드 [📄 제안] 탭에서 보이려면 customer_id 가 필수)
    if (body.lead_id && body.customer_id === undefined) {
      const [[ld]] = await conn.query(
        `SELECT customer_id, customer_name FROM leads WHERE id = ? LIMIT 1`,
        [body.lead_id]
      );
      if (ld) {
        body.customer_id = ld.customer_id || null;
        if (body.customer_name === undefined && ld.customer_name) {
          body.customer_name = ld.customer_name;
        }
      }
    }

    // quote_id 변경 시 quote 요약 정보 재반영
    let newQuoteNo = body.quote_no;
    if (body.quote_id !== undefined && body.quote_id !== prev.quote_id) {
      if (body.quote_id) {
        const [[quote]] = await conn.query(
          `SELECT quote_no, total_amount FROM quotes WHERE id = ?`,
          [body.quote_id]
        );
        if (quote) newQuoteNo = quote.quote_no;
      } else {
        newQuoteNo = null;
      }
    }

    const fields = [];
    const values = [];
    const allowed = [
      'proposal_title',
      'customer_name',
      'lead_id',
      'customer_id',
      'quote_id',
      'proposal_date',
      'due_date',
      'status',
      'owner_id',
      'owner_name',
      'expected_amount',
      'currency',
      'rfp_title',
      'rfp_received_date',
      'rfp_due_date',
      'rfp_summary',
      'ai_strategy_md',
      'remark',
    ];
    // DATE 컬럼은 ISO 8601 / 빈문자/Date-string 모두 'YYYY-MM-DD' 로 정규화
    const DATE_FIELDS = new Set(['proposal_date', 'due_date', 'rfp_received_date', 'rfp_due_date']);
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
      }
      let v = body[f];
      if (DATE_FIELDS.has(f)) {
        v = toYMD(v);
        if (f === 'proposal_date' && !v) {
          await conn.rollback();
          return res.status(400).json({ success: false, error: '제안일 형식이 유효하지 않습니다' });
        }
      }
      fields.push(`${f} = ?`);
      values.push(v);
    }
    // ai_strategy_md 변경 시 ai_strategy_generated_at 자동 갱신 (NOW())
    if (body.ai_strategy_md !== undefined && body.ai_strategy_md !== prev.ai_strategy_md) {
      fields.push('ai_strategy_generated_at = NOW()');
    }
    // quote_id 변경 시 quote_no 도 반영
    if (body.quote_id !== undefined && newQuoteNo !== undefined) {
      fields.push('quote_no = ?');
      values.push(newQuoteNo);
    }

    // 상태별 timestamp 자동 기록
    if (body.status && body.status !== prev.status) {
      if (body.status === 'sent' && !prev.sent_at) {
        fields.push('sent_at = NOW()');
      } else if (body.status === 'accepted' && !prev.accepted_at) {
        fields.push('accepted_at = NOW()');
      } else if (body.status === 'rejected' && !prev.rejected_at) {
        fields.push('rejected_at = NOW()');
      }
    }

    if (fields.length === 0) {
      await conn.commit();
      return res.json({ success: true, data: { id, unchanged: true } });
    }
    values.push(id);
    await conn.query(`UPDATE proposals SET ${fields.join(', ')} WHERE id = ?`, values);

    // history 기록 (status 변경은 별도 명시)
    if (body.status && body.status !== prev.status) {
      await logHistory(conn, id, userId, 'status_change', {
        oldValue: prev.status,
        newValue: body.status,
        description: `상태 변경: ${prev.status} → ${body.status}`,
      });
    } else {
      await logHistory(conn, id, userId, 'update', {
        description: `필드 변경: ${fields.length}개`,
      });
    }

    await conn.commit();
    res.json({ success: true, data: { id } });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PATCH /:id/status — 상태 전환 (빠른 액션) ────────────────
router.patch('/:id/status', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const status = String(req.body?.status || '').trim();
    if (!ALLOWED_STATUS.includes(status)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
    }
    const [[prev]] = await conn.query(
      `SELECT id, status, sent_at, accepted_at, rejected_at, lead_id FROM proposals WHERE id = ?`,
      [id]
    );
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    const setParts = ['status = ?'];
    const params = [status];
    if (status === 'sent' && !prev.sent_at) setParts.push('sent_at = NOW()');
    if (status === 'accepted' && !prev.accepted_at) setParts.push('accepted_at = NOW()');
    if (status === 'rejected' && !prev.rejected_at) setParts.push('rejected_at = NOW()');
    params.push(id);

    await conn.query(`UPDATE proposals SET ${setParts.join(', ')} WHERE id = ?`, params);
    await logHistory(conn, id, userId, 'status_change', {
      oldValue: prev.status,
      newValue: status,
      description: `상태 변경: ${prev.status} → ${status}`,
    });

    // lead_id 가 있으면 activities 자동 기록 (best-effort)
    if (prev.lead_id) {
      try {
        await conn.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, created_by)
           VALUES (?, '제안', ?, ?, ?)`,
          [prev.lead_id, `제안 상태: ${status}`, `이전: ${prev.status}`, userId || null]
        );
      } catch (_) {
        /* 무시 */
      }
    }

    await conn.commit();
    res.json({ success: true, data: { id, status } });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── DELETE /:id — 삭제 (CASCADE 로 children 자동 삭제) ───────
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [result] = await pool.query(`DELETE FROM proposals WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// Phase 3: 파일 업로드/다운로드/삭제 + 리비전 생성
// =============================================================

// ── POST /:id/rfp — RFP 파일 업로드 (단일 + 다중) + 메타 업데이트
// 입력 필드: 'file' (단일, 기존 호환) 또는 'files' (다중, Phase 4-B)
// 응답: { success, data: { uploaded: [...], failed: [...] } }
// 파일별 독립 처리 — 일부 실패해도 나머지 계속, 부분 성공 허용
router.post('/:id/rfp', uploadMixed, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const files = collectFiles(req);
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: '파일이 없습니다 (허용 확장자만)' });
    }

    const userId = getUserId(req);
    const body = req.body || {};

    // proposals 의 rfp_* 메타 업데이트 (전달된 경우만, 다중 업로드 시 1회만 반영)
    const metaFields = [];
    const metaValues = [];
    if (body.rfp_title) {
      metaFields.push('rfp_title = ?');
      metaValues.push(String(body.rfp_title).slice(0, 300));
    }
    const rcv = toYMD(body.rfp_received_date);
    if (rcv) {
      metaFields.push('rfp_received_date = ?');
      metaValues.push(rcv);
    }
    const due = toYMD(body.rfp_due_date);
    if (due) {
      metaFields.push('rfp_due_date = ?');
      metaValues.push(due);
    }
    if (metaFields.length > 0) {
      metaValues.push(id);
      try {
        await pool.query(`UPDATE proposals SET ${metaFields.join(', ')} WHERE id = ?`, metaValues);
      } catch (e) {
        console.warn('[proposals:rfp meta] update failed:', e.message);
      }
    }

    // 파일별 독립 INSERT (한 파일 실패해도 나머지 계속)
    const uploaded = [];
    const failed = [];
    for (const file of files) {
      const originalName = decodeOriginalName(file.originalname);
      try {
        const relPath = `/uploads/proposals/${id}/${file.filename}`;
        const [ins] = await pool.query(
          `INSERT INTO proposal_files
            (proposal_id, file_type, original_filename, stored_filename, file_path,
             file_size, mime_type, revision_no, description, uploaded_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            'rfp',
            originalName,
            file.filename,
            relPath,
            file.size,
            file.mimetype || null,
            1,
            body.description || null,
            userId || null,
          ]
        );
        await logHistory(null, id, userId, 'rfp_upload', {
          description: `RFP 파일 업로드: ${originalName}`,
          newValue: originalName,
        });
        uploaded.push({
          id: ins.insertId,
          original_filename: originalName,
          file_path: relPath,
          file_size: file.size,
          mime_type: file.mimetype || null,
        });
      } catch (e) {
        // 실패 시 디스크 cleanup
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {}
        failed.push({
          original_filename: originalName,
          error: e.message || String(e),
        });
      }
    }

    res.json({ success: true, data: { uploaded, failed } });
  } catch (err) {
    // 전체 실패 시 모든 디스크 파일 cleanup
    for (const file of collectFiles(req)) {
      try {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch (_) {}
    }
    handleError(res, err);
  }
});

// ── POST /:id/files — 일반 제안 파일 업로드 (단일 + 다중) ────
// 입력 필드: 'file' (단일, 기존 호환) 또는 'files' (다중, Phase 4-B)
// 응답: { success, data: { uploaded: [...], failed: [...] } }
router.post('/:id/files', uploadMixed, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const files = collectFiles(req);
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: '파일이 없습니다 (허용 확장자만)' });
    }

    const userId = getUserId(req);
    const body = req.body || {};

    // file_type 검증 (요청 단위, 모든 파일에 공통 적용)
    let fileType = body.file_type || 'etc';
    if (!ALLOWED_FILE_TYPES.includes(fileType)) fileType = 'etc';

    const isFinal =
      body.is_final === '1' || body.is_final === 'true' || body.is_final === 1 ? 1 : 0;
    const inEmail =
      body.include_in_email === '1' ||
      body.include_in_email === 'true' ||
      body.include_in_email === 1
        ? 1
        : 0;
    const revNo = Number(body.revision_no) || 1;

    const uploaded = [];
    const failed = [];
    for (const file of files) {
      const originalName = decodeOriginalName(file.originalname);
      try {
        const relPath = `/uploads/proposals/${id}/${file.filename}`;
        const [ins] = await pool.query(
          `INSERT INTO proposal_files
            (proposal_id, file_type, original_filename, stored_filename, file_path,
             file_size, mime_type, revision_no, is_final, include_in_email, description, uploaded_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            fileType,
            originalName,
            file.filename,
            relPath,
            file.size,
            file.mimetype || null,
            revNo,
            isFinal,
            inEmail,
            body.description || null,
            userId || null,
          ]
        );
        await logHistory(null, id, userId, 'file_upload', {
          description: `파일 업로드 (${fileType}): ${originalName}`,
          newValue: originalName,
        });
        uploaded.push({
          id: ins.insertId,
          original_filename: originalName,
          file_path: relPath,
          file_size: file.size,
          mime_type: file.mimetype || null,
          file_type: fileType,
        });
      } catch (e) {
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {}
        failed.push({
          original_filename: originalName,
          error: e.message || String(e),
        });
      }
    }

    res.json({ success: true, data: { uploaded, failed } });
  } catch (err) {
    for (const file of collectFiles(req)) {
      try {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch (_) {}
    }
    handleError(res, err);
  }
});

// ── GET /:id/files/:fileId/download — 파일 다운로드 ──────────
router.get('/:id/files/:fileId/download', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!id || !fileId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [[file]] = await pool.query(
      `SELECT * FROM proposal_files WHERE id = ? AND proposal_id = ?`,
      [fileId, id]
    );
    if (!file) return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });

    const absPath = path.join(__dirname, '..', '..', 'public', file.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: '파일이 디스크에 없습니다 (삭제됨)' });
    }

    // history 기록 (best-effort)
    logHistory(null, id, getUserId(req), 'file_download', {
      description: `파일 다운로드: ${file.original_filename}`,
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`
    );
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(absPath);
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /:id/files/:fileId — 파일 삭제 (DB + 디스크) ──────
router.delete('/:id/files/:fileId', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!id || !fileId) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    const [[file]] = await conn.query(
      `SELECT * FROM proposal_files WHERE id = ? AND proposal_id = ?`,
      [fileId, id]
    );
    if (!file) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });
    }

    await conn.query(`DELETE FROM proposal_files WHERE id = ?`, [fileId]);
    await logHistory(conn, id, userId, 'file_delete', {
      description: `파일 삭제: ${file.original_filename}`,
      oldValue: file.original_filename,
    });
    await conn.commit();

    // 디스크 파일 삭제 (best-effort)
    try {
      const absPath = path.join(__dirname, '..', '..', 'public', file.file_path);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } catch (e) {
      console.warn('[proposals:file_delete] disk unlink failed:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── POST /:id/rfp/analyze — AI 제안전략 분석 (Phase 4-A) ─────
// 입력: { file_id }  — proposal_files 중 분석 대상 파일
// 처리: Gemini Multimodal 로 파일 내용 분석 → 5필드 JSON 응답
// 출력: 분석 결과만 반환 (DB 자동 저장 X — 사용자가 검토 후 [저장] 누르면 PUT /:id 로 별도 반영)
// 부가: proposal_history 에 'ai_analyze' 기록 (사용 로그 추적)
router.post('/:id/rfp/analyze', async (req, res) => {
  const startedAt = Date.now();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    const fileId = parseInt(req.body?.file_id, 10);
    if (!fileId) {
      return res.status(400).json({ success: false, error: '분석 대상 file_id 가 필요합니다' });
    }

    // 파일 조회 + 소유 검증
    const [[file]] = await pool.query(
      `SELECT id, file_path, mime_type, original_filename, file_size
         FROM proposal_files
        WHERE id = ? AND proposal_id = ?`,
      [fileId, id]
    );
    if (!file) {
      return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });
    }

    const absPath = path.join(__dirname, '..', '..', 'public', file.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: '파일이 디스크에 없습니다 (삭제됨)' });
    }

    console.log(
      `[proposals:analyze] start proposal=${id} file=${fileId} (${file.original_filename})`
    );

    // Gemini Multimodal 호출
    const analysis = await analyzeProposalRFP({
      filePath: absPath,
      mimeType: file.mime_type || 'application/pdf',
      userId,
      endpoint: 'proposal_rfp_analyze',
    });

    const elapsed = Date.now() - startedAt;
    console.log(`[proposals:analyze] done proposal=${id} elapsed=${elapsed}ms`);

    // history 기록 (best-effort, 트랜잭션 없이)
    logHistory(null, id, userId, 'ai_analyze', {
      description: `AI 분석: ${file.original_filename} (${elapsed}ms)`,
      newValue: file.original_filename,
    });

    res.json({ success: true, data: analysis });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(`[proposals:analyze] failed after ${elapsed}ms:`, err?.message || err);
    // 사용자에게 친절한 메시지 전달 (handleError 가 stack 만 보낼 수 있어 직접 처리)
    res.status(500).json({
      success: false,
      error: err?.message || 'AI 분석 실패',
    });
  }
});

// ── POST /:id/email/send — 제안 이메일 발송 (Phase 5-B) ──────
// 입력 body:
//   {
//     to: 'a@b.com, c@d.com'    // 콤마 구분 가능
//     cc?: string
//     subject: string
//     body: string              // text/plain
//     file_ids?: number[]       // proposal_files 첨부 (소유 검증)
//   }
// 응답: { success, data: { log_id, message_id, attachment_count, total_bytes } }
// 동작:
//   - 첨부 대상 파일 소유 검증 (proposal_id 일치 + 디스크 존재)
//   - sendMessageWithAttachments(userId, opts) 호출 (Gmail multipart/mixed)
//   - proposal_email_logs 기록 (성공/실패 모두)
//   - proposal_history 'email_send' 기록
router.post('/:id/email/send', async (req, res) => {
  const startedAt = Date.now();
  let logId = null;
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, error: '인증된 사용자만 이메일을 발송할 수 있습니다' });
    }

    const body = req.body || {};
    const to = String(body.to || '').trim();
    const cc = body.cc ? String(body.cc).trim() : '';
    const subject = String(body.subject || '').trim();
    const bodyText = String(body.body || '').trim();
    const fileIds = Array.isArray(body.file_ids)
      ? body.file_ids.map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x > 0)
      : [];

    // 사전 검증
    if (!to || !/@/.test(to)) {
      return res.status(400).json({ success: false, error: '유효한 수신자(to) 가 필요합니다' });
    }
    if (!subject) {
      return res.status(400).json({ success: false, error: '제목이 필요합니다' });
    }

    // 제안 존재 확인
    const [[prop]] = await pool.query(
      `SELECT id, proposal_no, proposal_title FROM proposals WHERE id = ?`,
      [id]
    );
    if (!prop) {
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    // 첨부 파일 조회 + 소유 검증 (id 배열로 IN 조회)
    let attachmentRows = [];
    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT id, original_filename, stored_filename, file_path, file_size, mime_type
           FROM proposal_files
          WHERE proposal_id = ? AND id IN (${placeholders})`,
        [id, ...fileIds]
      );
      attachmentRows = rows || [];
      if (attachmentRows.length !== fileIds.length) {
        return res.status(400).json({
          success: false,
          error: `요청한 ${fileIds.length}개 파일 중 ${attachmentRows.length}개만 소유 — 잘못된 file_id`,
        });
      }
    }

    // 디스크에서 파일 buffer 읽기 + 크기 합산
    const attachments = [];
    let totalBytes = 0;
    for (const row of attachmentRows) {
      const absPath = path.join(__dirname, '..', '..', 'public', row.file_path);
      if (!fs.existsSync(absPath)) {
        return res.status(400).json({
          success: false,
          error: `파일이 디스크에 없습니다: ${row.original_filename}`,
        });
      }
      const data = fs.readFileSync(absPath);
      totalBytes += data.length;
      attachments.push({
        filename: row.original_filename,
        mimeType: row.mime_type || 'application/octet-stream',
        data,
      });
    }
    // 25MB 한도 사전 검증 (Gmail 35MB 한도 + 안전마진) — gmail.js 도 내부 검증하지만 명확한 메시지
    if (totalBytes > 25 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: `첨부 합계 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 가 25MB 초과 — 일부 파일 제외 후 재시도`,
      });
    }

    console.log(
      `[proposals:email] start proposal=${id} to=${to} attachments=${attachments.length} (${(totalBytes / 1024).toFixed(1)}KB)`
    );

    // proposal_email_logs 사전 INSERT (status='sending') — 실패 시에도 추적 가능
    const fileIdsJson = JSON.stringify(fileIds);
    const [logInsert] = await pool.query(
      `INSERT INTO proposal_email_logs
        (proposal_id, to_emails, cc_emails, subject, body, attachment_file_ids,
         sent_by, send_status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, to, cc || null, subject.slice(0, 300), bodyText || null, fileIdsJson, userId, 'sending']
    );
    logId = logInsert.insertId;

    // Gmail 발송
    let result;
    try {
      result = await sendMessageWithAttachments(userId, {
        to,
        cc,
        subject,
        body: bodyText,
        attachments,
      });
    } catch (sendErr) {
      // Gmail 미연결 / 권한 / 토큰 만료 등 — log 업데이트 후 분류된 응답
      await pool.query(
        `UPDATE proposal_email_logs
           SET send_status = 'failed', error_message = ?
         WHERE id = ?`,
        [String(sendErr?.message || sendErr).slice(0, 500), logId]
      );
      const classified = gmailClassifyError(sendErr);
      console.error(
        `[proposals:email] gmail send failed (log_id=${logId}):`,
        sendErr?.message || sendErr
      );
      return res.status(classified.status || 500).json(classified.body);
    }

    // 성공 — log 업데이트 + history 기록
    await pool.query(
      `UPDATE proposal_email_logs
         SET send_status = 'sent', gmail_message_id = ?
       WHERE id = ?`,
      [result.message_id || null, logId]
    );

    const elapsed = Date.now() - startedAt;
    console.log(
      `[proposals:email] done proposal=${id} log_id=${logId} msg_id=${result.message_id} elapsed=${elapsed}ms`
    );

    logHistory(null, id, userId, 'email_send', {
      description: `이메일 발송: ${to} (첨부 ${attachments.length}개, ${(totalBytes / 1024).toFixed(1)}KB)`,
      newValue: to,
    });

    res.json({
      success: true,
      data: {
        log_id: logId,
        message_id: result.message_id,
        attachment_count: attachments.length,
        total_bytes: totalBytes,
        from: result.from,
      },
    });
  } catch (err) {
    console.error('[proposals:email] failed:', err?.message || err);
    // log 가 만들어졌으면 failed 로 마킹
    if (logId) {
      try {
        await pool.query(
          `UPDATE proposal_email_logs SET send_status = 'failed', error_message = ? WHERE id = ?`,
          [String(err?.message || err).slice(0, 500), logId]
        );
      } catch (_) {}
    }
    res.status(500).json({ success: false, error: err?.message || '이메일 발송 실패' });
  }
});

// ── Phase 6-B: AI 제안서 평가 (RFP 대비 커버율 + 코칭) ─────────
// 입력: { proposal_file_id }  — 평가 대상 제안서 파일 (file_type 무관)
// 자동: RFP 파일 = proposal_files 중 file_type='rfp' AND PDF/이미지/텍스트 형식의 첫 파일
// 출력: { id, coverage_score, covered_count, missing_count, ... } + DB 저장
router.post('/:id/evaluate', async (req, res) => {
  const startedAt = Date.now();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    const targetFileId = parseInt(req.body?.proposal_file_id, 10);
    if (!targetFileId) {
      return res
        .status(400)
        .json({ success: false, error: '평가 대상 proposal_file_id 가 필요합니다' });
    }

    // 대상 제안서 파일 조회 + 소유 검증
    const [[targetFile]] = await pool.query(
      `SELECT id, file_path, mime_type, original_filename
         FROM proposal_files
        WHERE id = ? AND proposal_id = ?`,
      [targetFileId, id]
    );
    if (!targetFile) {
      return res.status(404).json({ success: false, error: '대상 파일을 찾을 수 없음' });
    }

    // RFP 파일 자동 선택 — file_type='rfp' 의 첫 파일 (PDF/이미지/텍스트만)
    const [rfpFiles] = await pool.query(
      `SELECT id, file_path, mime_type, original_filename
         FROM proposal_files
        WHERE proposal_id = ? AND file_type = 'rfp'
        ORDER BY created_at ASC`,
      [id]
    );
    const ANALYZABLE_RE = /\.(pdf|png|jpe?g|webp|txt)$/i;
    const rfpFile = (rfpFiles || []).find(f => ANALYZABLE_RE.test(f.original_filename));
    if (!rfpFile) {
      return res.status(400).json({
        success: false,
        error:
          'RFP 파일이 없거나 분석 불가 형식입니다. 기본 탭의 RFP 영역에 PDF/이미지/텍스트 파일을 먼저 업로드하세요',
      });
    }

    // 두 파일 디스크 존재 확인
    const rfpAbsPath = path.join(__dirname, '..', '..', 'public', rfpFile.file_path);
    const targetAbsPath = path.join(__dirname, '..', '..', 'public', targetFile.file_path);
    if (!fs.existsSync(rfpAbsPath)) {
      return res
        .status(404)
        .json({ success: false, error: `RFP 파일이 디스크에 없음: ${rfpFile.original_filename}` });
    }
    if (!fs.existsSync(targetAbsPath)) {
      return res.status(404).json({
        success: false,
        error: `제안서 파일이 디스크에 없음: ${targetFile.original_filename}`,
      });
    }

    console.log(
      `[proposals:evaluate] start proposal=${id} rfp=${rfpFile.id} target=${targetFile.id}`
    );

    // Gemini 평가 호출
    const evaluation = await evaluateProposalAgainstRFP({
      rfpPath: rfpAbsPath,
      rfpMime: rfpFile.mime_type || 'application/pdf',
      proposalPath: targetAbsPath,
      proposalMime: targetFile.mime_type || 'application/pdf',
      userId,
      endpoint: 'proposal_evaluate',
    });

    const elapsed = Date.now() - startedAt;
    console.log(
      `[proposals:evaluate] done proposal=${id} score=${evaluation.coverage_score} elapsed=${elapsed}ms`
    );

    // DB 저장
    const [ins] = await pool.query(
      `INSERT INTO proposal_evaluations
        (proposal_id, target_file_id, rfp_file_id, coverage_score,
         covered_count, missing_count, evaluation_md, evaluation_json, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        targetFileId,
        rfpFile.id,
        evaluation.coverage_score,
        evaluation.covered_count,
        evaluation.missing_count,
        evaluation.overall_assessment || null,
        JSON.stringify(evaluation),
        userId || null,
      ]
    );

    // history 기록
    logHistory(null, id, userId, 'evaluate', {
      description: `AI 평가 — ${targetFile.original_filename} vs ${rfpFile.original_filename} (커버율 ${evaluation.coverage_score}%, ${elapsed}ms)`,
      newValue: String(evaluation.coverage_score),
    });

    res.json({
      success: true,
      data: {
        id: ins.insertId,
        proposal_id: id,
        target_file_id: targetFileId,
        rfp_file_id: rfpFile.id,
        target_filename: targetFile.original_filename,
        rfp_filename: rfpFile.original_filename,
        ...evaluation,
      },
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(`[proposals:evaluate] failed after ${elapsed}ms:`, err?.message || err);
    res.status(500).json({
      success: false,
      error: err?.message || 'AI 평가 실패',
    });
  }
});

// ── GET /:id/evaluations — 평가 이력 조회 (다중 버전 비교) ─────
router.get('/:id/evaluations', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [rows] = await pool.query(
      `SELECT pe.id, pe.proposal_id, pe.target_file_id, pe.rfp_file_id,
              pe.coverage_score, pe.covered_count, pe.missing_count,
              pe.evaluation_md, pe.evaluation_json, pe.generated_at,
              tf.original_filename AS target_filename,
              rf.original_filename AS rfp_filename,
              tm.name AS created_by_name
         FROM proposal_evaluations pe
         LEFT JOIN proposal_files tf ON tf.id = pe.target_file_id
         LEFT JOIN proposal_files rf ON rf.id = pe.rfp_file_id
         LEFT JOIN team_members tm ON tm.id = pe.created_by
        WHERE pe.proposal_id = ?
        ORDER BY pe.generated_at DESC
        LIMIT 50`,
      [id]
    );

    const data = (rows || []).map(r => {
      let detail = null;
      try {
        detail = r.evaluation_json ? JSON.parse(r.evaluation_json) : null;
      } catch (_) {
        /* ignore parse error */
      }
      return {
        id: r.id,
        proposal_id: r.proposal_id,
        target_file_id: r.target_file_id,
        target_filename: r.target_filename,
        rfp_file_id: r.rfp_file_id,
        rfp_filename: r.rfp_filename,
        coverage_score: r.coverage_score,
        covered_count: r.covered_count,
        missing_count: r.missing_count,
        evaluation_md: r.evaluation_md,
        evaluation_json: detail,
        generated_at: r.generated_at,
        created_by_name: r.created_by_name,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('[proposals:evaluations list] failed:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || '평가 이력 조회 실패' });
  }
});

// ── Phase 5-C: 공유 링크 토큰 발급/무효화 ─────────────────────
// 발급: 기존 토큰이 있어도 새로 생성 (재발급 시 이전 링크 무효화)
// 토큰 형식: crypto.randomBytes(32) → base64url (43자)
function _generateShareToken() {
  return crypto
    .randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// POST /:id/share — 공유 링크 발급 / 재발급
// body: { expires_days?: number } — 기본 7일, 0/음수 = 무제한(NULL)
router.post('/:id/share', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);

    const [[prop]] = await pool.query(
      `SELECT id, share_token, shared_until FROM proposals WHERE id = ?`,
      [id]
    );
    if (!prop) return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });

    const expiresDays = parseInt(req.body?.expires_days, 10);
    const days = Number.isFinite(expiresDays) ? expiresDays : 7; // 기본 7일
    const token = _generateShareToken();
    let sharedUntilSql;
    let sharedUntilValue = null;
    if (days > 0) {
      sharedUntilSql = 'DATE_ADD(NOW(), INTERVAL ? DAY)';
      sharedUntilValue = days;
    } else {
      sharedUntilSql = 'NULL'; // 무제한
    }

    if (sharedUntilValue !== null) {
      await pool.query(
        `UPDATE proposals SET share_token = ?, shared_until = ${sharedUntilSql} WHERE id = ?`,
        [token, sharedUntilValue, id]
      );
    } else {
      await pool.query(`UPDATE proposals SET share_token = ?, shared_until = NULL WHERE id = ?`, [
        token,
        id,
      ]);
    }

    // 갱신된 shared_until 조회
    const [[updated]] = await pool.query(`SELECT shared_until FROM proposals WHERE id = ?`, [id]);

    logHistory(null, id, userId, 'share_create', {
      description: `공유 링크 ${prop.share_token ? '재' : ''}발급 (만료: ${days > 0 ? days + '일' : '무제한'})`,
      newValue: token,
    });

    res.json({
      success: true,
      data: {
        share_token: token,
        shared_until: updated.shared_until,
        expires_days: days > 0 ? days : null,
      },
    });
  } catch (err) {
    console.error('[proposals:share create] failed:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || '공유 링크 발급 실패' });
  }
});

// DELETE /:id/share — 공유 링크 무효화
router.delete('/:id/share', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);

    const [[prop]] = await pool.query(`SELECT id, share_token FROM proposals WHERE id = ?`, [id]);
    if (!prop) return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });

    await pool.query(`UPDATE proposals SET share_token = NULL, shared_until = NULL WHERE id = ?`, [
      id,
    ]);

    if (prop.share_token) {
      logHistory(null, id, userId, 'share_revoke', {
        description: '공유 링크 무효화',
        oldValue: prop.share_token,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[proposals:share revoke] failed:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || '공유 링크 무효화 실패' });
  }
});

// ── POST /:id/revisions — 리비전 생성 ────────────────────────
// ── Phase 9-3: AI 제안전략 요약 Word(.docx) 다운로드 ──
// markdown (6섹션) → docx 변환 후 첨부 다운로드
router.get('/:id/ai-strategy/word', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const [[prop]] = await pool.query(
      `SELECT proposal_no, proposal_title, customer_name, ai_strategy_md, ai_strategy_generated_at
       FROM proposals WHERE id = ?`,
      [id]
    );
    if (!prop) {
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }
    if (!prop.ai_strategy_md || !String(prop.ai_strategy_md).trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'AI 제안전략 요약이 비어있습니다 — 먼저 작성/생성하세요' });
    }

    const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = require('docx');

    // 간단 markdown → docx 변환 (## 헤딩 + 불릿/체크박스 + 일반 문단)
    const lines = String(prop.ai_strategy_md).split(/\r?\n/);
    const children = [];

    // 표지: 제목 + 메타
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: '🤖 AI 제안전략 요약', bold: true, size: 36 })],
      })
    );
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `제안번호: ${prop.proposal_no || '-'}`, size: 22 })],
      })
    );
    if (prop.proposal_title) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: `제안명: ${prop.proposal_title}`, size: 22 })],
        })
      );
    }
    if (prop.customer_name) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: `고객사: ${prop.customer_name}`, size: 22 })],
        })
      );
    }
    if (prop.ai_strategy_generated_at) {
      const gen = new Date(prop.ai_strategy_generated_at);
      const genStr = isNaN(gen)
        ? String(prop.ai_strategy_generated_at)
        : `${gen.getFullYear()}.${String(gen.getMonth() + 1).padStart(2, '0')}.${String(gen.getDate()).padStart(2, '0')}`;
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: `최근 AI 분석: ${genStr}`, size: 18, color: '666666' })],
        })
      );
    } else {
      children.push(new Paragraph({ spacing: { after: 400 }, children: [] }));
    }

    // 본문 — markdown 파싱
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, ''); // 우측 공백 제거
      if (!line) {
        children.push(new Paragraph({}));
        continue;
      }
      // ## Heading 2
      if (/^##\s+/.test(line)) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
            children: [new TextRun({ text: line.replace(/^##\s+/, ''), bold: true, size: 28 })],
          })
        );
      } else if (/^###\s+/.test(line)) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 150, after: 80 },
            children: [new TextRun({ text: line.replace(/^###\s+/, ''), bold: true, size: 24 })],
          })
        );
      } else if (/^- \[ \]\s+/.test(line)) {
        // 체크박스 (미체크)
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: `☐ ${line.replace(/^- \[ \]\s+/, '')}`, size: 22 })],
          })
        );
      } else if (/^- \[x\]\s+/i.test(line)) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: `☑ ${line.replace(/^- \[x\]\s+/i, '')}`, size: 22 })],
          })
        );
      } else if (/^[-*]\s+/.test(line)) {
        // 일반 불릿
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: line.replace(/^[-*]\s+/, ''), size: 22 })],
          })
        );
      } else if (/^\d+\.\s+/.test(line)) {
        // 번호 리스트
        children.push(
          new Paragraph({
            numbering: { reference: 'numbering-ref', level: 0 },
            children: [new TextRun({ text: line.replace(/^\d+\.\s+/, ''), size: 22 })],
          })
        );
      } else {
        // 일반 문단 (bold/italic 미지원 — 단순 텍스트)
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: line, size: 22 })],
          })
        );
      }
    }

    const doc = new Document({
      creator: 'OCI CRM AI',
      title: `AI 제안전략 요약 — ${prop.proposal_no || ''}`,
      styles: {
        default: {
          document: {
            run: { font: '맑은 고딕', size: 22 },
          },
        },
      },
      sections: [{ properties: {}, children }],
    });

    const buffer = await Packer.toBuffer(doc);

    // 파일명 — proposal_no + 날짜 (한글 안전 인코딩)
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const baseName = `${prop.proposal_no || 'proposal'}_AI제안전략요약_${dateStr}.docx`;
    const encodedName = encodeURIComponent(baseName);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:id/revisions', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const body = req.body || {};

    const [[prev]] = await conn.query(`SELECT id, version_no FROM proposals WHERE id = ?`, [id]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    const newRev = (prev.version_no || 1) + 1;
    const [ins] = await conn.query(
      `INSERT INTO proposal_revisions (proposal_id, revision_no, title, description, created_by)
       VALUES (?,?,?,?,?)`,
      [
        id,
        newRev,
        body.title ? String(body.title).slice(0, 300) : `v${newRev}`,
        body.description || null,
        userId || null,
      ]
    );
    await conn.query(`UPDATE proposals SET version_no = ? WHERE id = ?`, [newRev, id]);
    await logHistory(conn, id, userId, 'revision_create', {
      description: `리비전 생성: v${newRev}`,
      newValue: `v${newRev}`,
    });

    await conn.commit();
    res.json({
      success: true,
      data: { id: ins.insertId, revision_no: newRev },
    });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ─────────────────
// GET /api/proposals/:id/contracts → contracts WHERE proposal_id = ?
// 제안 상세 모달 (기본탭) 에서 "🔗 연결된 계약" 섹션 렌더링용
router.get('/:id/contracts', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[p]] = await pool.query('SELECT id FROM proposals WHERE id = ?', [id]);
    if (!p) return res.status(404).json({ success: false, error: '제안 없음' });
    const [contracts] = await pool.query(
      `SELECT id, contract_no, title, status, contract_type,
              contract_amount, currency, start_date, end_date,
              customer_name, created_at
         FROM contracts
        WHERE proposal_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [id]
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
module.exports.ALLOWED_STATUS = ALLOWED_STATUS;
module.exports.ALLOWED_FILE_TYPES = ALLOWED_FILE_TYPES;
