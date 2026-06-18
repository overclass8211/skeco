'use strict';
// =============================================================
// /api/contracts — 계약관리 모듈 (Phase 0: 기반 인프라)
//
// 기능:
//   - 계약 CRUD + 자동채번 C-YYYY-NNNN
//   - 다중 파일 업로드 / 다운로드 / 삭제 (proposals 패턴 재사용)
//   - contract_history 자동 기록 (Audit Trail — Phase 1 에서 강화)
//   - leads/customers/proposals 연결 (선택)
//
// 권한: 기본 인증 (manager+) — autoLevel 미적용
// 기능 플래그: crm.contracts
//
// 엔드포인트 (Phase 0):
//   GET    /next-contract-no  — 다음 자동 채번 미리보기
//   GET    /                  — 목록 (페이징, 필터)
//   GET    /:id               — 단건 (files + history 포함)
//   POST   /                  — 생성
//   PUT    /:id               — 수정 (diff history 자동 기록)
//   DELETE /:id               — 삭제 (CASCADE)
//   POST   /:id/files         — 파일 업로드 (다중)
//   GET    /:id/files/:fileId/download — 다운로드
//   DELETE /:id/files/:fileId — 파일 삭제
//
// Phase 1+ 추가 예정:
//   PATCH  /:id/status              (CLM 워크플로우)
//   POST   /:id/files/:fileId/review (AI 법무 검토)
//   GET    /templates / POST /templates (계약 템플릿)
//   GET    /alerts (만료 알림 큐)
// =============================================================

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { analyzeContractLegal } = require('../services/gemini');
const modusign = require('../services/modusign');
const readReceipts = require('../services/readReceipts');

// 토큰 암호화 — ENCRYPTION_KEY 미설정 시 best-effort (mock 모드에서만 안전)
let _crypto;
try {
  _crypto = require('../utils/crypto');
} catch (_) {
  _crypto = { encrypt: v => v, decrypt: v => v };
}
function _safeEncrypt(v) {
  try {
    return _crypto.encrypt(v);
  } catch (_) {
    return v;
  }
}
function _safeDecrypt(v) {
  try {
    return _crypto.decrypt(v);
  } catch (_) {
    return v;
  }
}

router.use(requireFeature('crm.contracts'));

// ── 파일 업로드 인프라 (proposals 패턴 동일) ──────────────────
// 저장 경로: public/uploads/contracts/{contract_id}/{timestamp}_{sanitized}.ext
const CONTRACT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'contracts');
if (!fs.existsSync(CONTRACT_UPLOAD_DIR)) fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|png|jpe?g|hwp|hwpx|txt|md)$/i;
const ALLOWED_FILE_TYPES = ['contract', 'draft', 'signed', 'amendment', 'attachment', 'etc'];

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 200);
}

function decodeOriginalName(originalname) {
  if (!originalname) return 'file';
  try {
    return Buffer.from(originalname, 'latin1').toString('utf8');
  } catch (_) {
    return originalname;
  }
}

function toYMD(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const contractUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const contractId = parseInt(req.params.id, 10);
      if (!contractId) return cb(new Error('contract_id 누락'));
      const dir = path.join(CONTRACT_UPLOAD_DIR, String(contractId));
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const decoded = decodeOriginalName(file.originalname);
      const safe = sanitizeFilename(decoded);
      const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_EXT.test(file.originalname);
    cb(null, ok);
  },
});

const uploadMixed = contractUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

function collectFiles(req) {
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return [...(req.files.file || []), ...(req.files.files || [])];
}

// ── 자가 마이그레이션 (idempotent) — v6.0.0 슬림화: 4개 핵심 테이블만 ──
// v6.0.0 변경: 8개 → 4개 테이블 (templates / alerts / negotiation / translations 제거)
// 기존 데이터는 DROP TABLE 로 안전하게 삭제 (사용자 승인 완료)
async function ensureSchema() {
  try {
    // ① 메인: contracts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id                    INT AUTO_INCREMENT PRIMARY KEY,
        contract_no           VARCHAR(50) UNIQUE NOT NULL,
        title                 VARCHAR(300) NOT NULL,
        customer_id           INT NULL,
        customer_name         VARCHAR(200) NULL,
        proposal_id           INT NULL,
        lead_id               INT NULL,
        quote_id              INT NULL,
        contract_type         VARCHAR(50) DEFAULT 'etc',
        status                VARCHAR(30) DEFAULT 'draft',
        start_date            DATE NULL,
        end_date              DATE NULL,
        contract_amount       DECIMAL(20,2) NULL,
        currency              VARCHAR(10) DEFAULT 'KRW',
        language              VARCHAR(10) DEFAULT 'ko',
        auto_renewal          TINYINT(1) DEFAULT 0,
        renewal_notice_days   INT DEFAULT 30,
        legal_review_score    INT NULL,
        ai_review_summary     MEDIUMTEXT NULL,
        template_id           INT NULL,
        version_no            INT DEFAULT 1,
        parent_contract_id    INT NULL,
        esign_provider        VARCHAR(20) NULL,
        esign_request_id      VARCHAR(100) NULL,
        esign_status          VARCHAR(20) NULL,
        owner_id              INT NULL,
        owner_name            VARCHAR(100) NULL,
        notes                 TEXT NULL,
        created_by            INT NULL,
        created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contract_no     (contract_no),
        INDEX idx_customer_id     (customer_id),
        INDEX idx_proposal_id     (proposal_id),
        INDEX idx_lead_id         (lead_id),
        INDEX idx_quote_id        (quote_id),
        INDEX idx_status          (status),
        INDEX idx_end_date        (end_date),
        INDEX idx_parent_contract (parent_contract_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 기존 contracts 에 quote_id 컬럼 추가 (idempotent — 이미 있으면 무시)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN quote_id INT NULL`);
      await pool.query(`ALTER TABLE contracts ADD INDEX idx_quote_id (quote_id)`);
      console.log('[contracts:migration] quote_id 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // v6.0.0 Phase A1: extracted_meta_json — AI 법무 검토에서 추출한 메타 (등록 폼 자동 채움용)
    try {
      await pool.query(
        `ALTER TABLE contract_legal_reviews ADD COLUMN extracted_meta_json MEDIUMTEXT NULL`
      );
      console.log('[contracts:migration] extracted_meta_json 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // v6.0.0 Phase A3: external_contract_no — 거래처(상대방) 계약번호 (선택, 보조 식별자)
    // 자사 contract_no 와 별개로 거래처가 발급한 번호 (양식 자유)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN external_contract_no VARCHAR(80) NULL`);
      await pool.query(
        `ALTER TABLE contracts ADD INDEX idx_external_contract_no (external_contract_no)`
      );
      console.log('[contracts:migration] external_contract_no 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // v6.0.0 Step 4 (Modusign): 전자서명 추가 컬럼 (esign_provider/request_id/status 는 이미 존재)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN esign_requested_at DATETIME NULL`);
      console.log('[contracts:migration] esign_requested_at 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN esign_signed_at DATETIME NULL`);
      console.log('[contracts:migration] esign_signed_at 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN esign_signed_pdf_path VARCHAR(500) NULL`);
      console.log('[contracts:migration] esign_signed_pdf_path 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN esign_signers_json MEDIUMTEXT NULL`);
      console.log('[contracts:migration] esign_signers_json 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // ⑤ 전자서명 OAuth 토큰 (사용자별 1건)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS esign_oauth_tokens (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        user_id          INT NOT NULL,
        provider         VARCHAR(20) DEFAULT 'modusign',
        access_token     TEXT NOT NULL COMMENT 'AES-256-GCM 암호화',
        refresh_token    TEXT NULL COMMENT 'AES-256-GCM 암호화',
        token_type       VARCHAR(20) DEFAULT 'Bearer',
        expires_at       DATETIME NULL,
        scope            VARCHAR(255) NULL,
        modusign_user_id VARCHAR(100) NULL,
        modusign_email   VARCHAR(200) NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_provider (user_id, provider),
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ⑥ 전자서명 이벤트 로그 (Webhook 수신 감사 추적)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS esign_events (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          contract_id    INT NOT NULL,
          provider       VARCHAR(20) DEFAULT 'modusign',
          external_id    VARCHAR(100) NOT NULL,
          event_type     VARCHAR(50) NOT NULL,
          event_payload  MEDIUMTEXT NULL,
          signer_email   VARCHAR(200) NULL,
          received_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract (contract_id, received_at),
          INDEX idx_external (external_id),
          CONSTRAINT fk_ee_contract FOREIGN KEY (contract_id)
            REFERENCES contracts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      // FK 실패 → fallback
      await pool.query(`
        CREATE TABLE IF NOT EXISTS esign_events (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          provider VARCHAR(20) DEFAULT 'modusign', external_id VARCHAR(100) NOT NULL,
          event_type VARCHAR(50) NOT NULL, event_payload MEDIUMTEXT NULL,
          signer_email VARCHAR(200) NULL, received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract (contract_id, received_at), INDEX idx_external (external_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    // v6.0.0 Phase B: 공유 링크 + 수신자
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_share_links (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          token          VARCHAR(64) NOT NULL UNIQUE,
          contract_id    INT NOT NULL,
          created_by     INT NULL,
          role           VARCHAR(20) DEFAULT 'viewer'
                         COMMENT 'viewer|commenter|approver',
          expires_at     DATETIME NULL,
          revoked_at     DATETIME NULL,
          note           VARCHAR(500) NULL,
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_contract (contract_id, revoked_at),
          INDEX idx_token (token),
          CONSTRAINT fk_csl_contract FOREIGN KEY (contract_id)
            REFERENCES contracts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_share_links (
          id INT AUTO_INCREMENT PRIMARY KEY, token VARCHAR(64) NOT NULL UNIQUE,
          contract_id INT NOT NULL, created_by INT NULL,
          role VARCHAR(20) DEFAULT 'viewer',
          expires_at DATETIME NULL, revoked_at DATETIME NULL,
          note VARCHAR(500) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_contract (contract_id, revoked_at), INDEX idx_token (token)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_share_recipients (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          share_link_id  INT NOT NULL,
          email          VARCHAR(200) NOT NULL,
          name           VARCHAR(100) NULL,
          notified_at    DATETIME NULL,
          viewed_at      DATETIME NULL,
          responded_at   DATETIME NULL,
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_share_email (share_link_id, email),
          CONSTRAINT fk_csr_share FOREIGN KEY (share_link_id)
            REFERENCES contract_share_links(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_share_recipients (
          id INT AUTO_INCREMENT PRIMARY KEY, share_link_id INT NOT NULL,
          email VARCHAR(200) NOT NULL, name VARCHAR(100) NULL,
          notified_at DATETIME NULL, viewed_at DATETIME NULL, responded_at DATETIME NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_share_email (share_link_id, email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    // v6.0.0 Phase D: 댓글 (1단계 스레드)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_comments (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          contract_id    INT NOT NULL,
          share_link_id  INT NULL,
          user_id        INT NULL,
          parent_id      INT NULL,
          comment_type   VARCHAR(20) DEFAULT 'general'
                         COMMENT 'general|revise|approve|reject',
          body           TEXT NOT NULL,
          author_email   VARCHAR(200) NULL,
          author_name    VARCHAR(100) NULL,
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_created (contract_id, created_at),
          CONSTRAINT fk_cc_contract FOREIGN KEY (contract_id)
            REFERENCES contracts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_comments (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          share_link_id INT NULL, user_id INT NULL, parent_id INT NULL,
          comment_type VARCHAR(20) DEFAULT 'general',
          body TEXT NOT NULL,
          author_email VARCHAR(200) NULL, author_name VARCHAR(100) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_created (contract_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    // v6.0.0 Phase E: 알림 발송 이력 (디바운싱 + 재시도)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_notifications (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          contract_id    INT NOT NULL,
          event_type     VARCHAR(50) NOT NULL
                         COMMENT 'comment|status_change|share_invite|deadline_alert',
          recipient_email VARCHAR(200) NOT NULL,
          channel        VARCHAR(20) DEFAULT 'email'
                         COMMENT 'email|inapp',
          status         VARCHAR(20) DEFAULT 'pending'
                         COMMENT 'pending|sent|failed|skipped',
          payload_json   MEDIUMTEXT NULL,
          attempts       INT DEFAULT 0,
          last_error     VARCHAR(500) NULL,
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          sent_at        DATETIME NULL,
          INDEX idx_contract (contract_id, created_at),
          INDEX idx_status (status),
          CONSTRAINT fk_cn_contract FOREIGN KEY (contract_id)
            REFERENCES contracts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_notifications (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          event_type VARCHAR(50) NOT NULL, recipient_email VARCHAR(200) NOT NULL,
          channel VARCHAR(20) DEFAULT 'email', status VARCHAR(20) DEFAULT 'pending',
          payload_json MEDIUMTEXT NULL, attempts INT DEFAULT 0,
          last_error VARCHAR(500) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME NULL,
          INDEX idx_contract (contract_id, created_at), INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    // v6.0.0 Phase C: 검토 D-Day
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN review_deadline DATE NULL`);
      await pool.query(`ALTER TABLE contracts ADD INDEX idx_review_deadline (review_deadline)`);
      console.log('[contracts:migration] review_deadline 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // P1: 계약 확정(completed) 자동 프로비저닝 멱등 가드 (프로젝트+매출계획 1회 생성)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN auto_provisioned_at DATETIME NULL`);
      console.log('[contracts:migration] auto_provisioned_at 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // ② 파일: contract_files
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_files (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        contract_id        INT NOT NULL,
        file_type          VARCHAR(50) DEFAULT 'contract',
        original_filename  VARCHAR(300) NOT NULL,
        stored_filename    VARCHAR(300) NOT NULL,
        file_path          VARCHAR(500) NOT NULL,
        mime_type          VARCHAR(100) NULL,
        file_size          BIGINT NULL,
        version_no         INT DEFAULT 1,
        is_final           TINYINT(1) DEFAULT 0,
        description        TEXT NULL,
        uploaded_by        INT NULL,
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_type (contract_id, file_type),
        CONSTRAINT fk_cf_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ③ 감사: contract_history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        contract_id  INT NOT NULL,
        action_type  VARCHAR(50) NOT NULL,
        field_name   VARCHAR(100) NULL,
        old_value    TEXT NULL,
        new_value    TEXT NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_created (contract_id, created_at),
        INDEX idx_action (action_type),
        CONSTRAINT fk_ch_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ④ AI 법무 검토 결과: contract_legal_reviews
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_legal_reviews (
        id                          INT AUTO_INCREMENT PRIMARY KEY,
        contract_id                 INT NOT NULL,
        target_file_id              INT NULL,
        review_score                INT NULL,
        risk_level                  VARCHAR(10) NULL,
        toxic_clauses_json          MEDIUMTEXT NULL,
        missing_clauses_json        MEDIUMTEXT NULL,
        legal_compliance_json       MEDIUMTEXT NULL,
        improvement_suggestions_json MEDIUMTEXT NULL,
        overall_assessment          MEDIUMTEXT NULL,
        language                    VARCHAR(10) DEFAULT 'ko',
        generated_by                INT NULL,
        generated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_gen (contract_id, generated_at),
        CONSTRAINT fk_clr_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // FK 생성 실패 시 fallback — FK 없이 재시도
    console.warn('[contracts:migration] FK 생성 실패 → fallback:', e.message);
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_files (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          file_type VARCHAR(50) DEFAULT 'contract',
          original_filename VARCHAR(300) NOT NULL, stored_filename VARCHAR(300) NOT NULL,
          file_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NULL,
          file_size BIGINT NULL, version_no INT DEFAULT 1,
          is_final TINYINT(1) DEFAULT 0, description TEXT NULL,
          uploaded_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_type (contract_id, file_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_history (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          action_type VARCHAR(50) NOT NULL, field_name VARCHAR(100) NULL,
          old_value TEXT NULL, new_value TEXT NULL, description TEXT NULL,
          created_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_created (contract_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_legal_reviews (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          target_file_id INT NULL, review_score INT NULL, risk_level VARCHAR(10) NULL,
          toxic_clauses_json MEDIUMTEXT NULL, missing_clauses_json MEDIUMTEXT NULL,
          legal_compliance_json MEDIUMTEXT NULL, improvement_suggestions_json MEDIUMTEXT NULL,
          overall_assessment MEDIUMTEXT NULL, language VARCHAR(10) DEFAULT 'ko',
          generated_by INT NULL, generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_gen (contract_id, generated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }

  // v6.0.0 슬림화: 구 Phase 3-6 테이블 DROP (사용자 승인 완료)
  // 기존 데이터 보존이 필요한 경우, 본 블록을 주석 처리하고 별도 백업 후 진행.
  try {
    await pool.query(`DROP TABLE IF EXISTS contract_translations`);
    await pool.query(`DROP TABLE IF EXISTS contract_negotiation_coaches`);
    await pool.query(`DROP TABLE IF EXISTS contract_alerts`);
    await pool.query(`DROP TABLE IF EXISTS contract_templates`);
  } catch (e) {
    console.warn('[contracts:migration] 구 테이블 DROP 실패 (무시):', e.message);
  }

  // 기존 8단계 상태 → 4단계 매핑 (idempotent, 최초 1회)
  // negotiation/renewal → review, signing/active → approved, expired/terminated → completed
  try {
    const [r1] = await pool.query(
      `UPDATE contracts SET status='review' WHERE status IN ('negotiation','renewal')`
    );
    const [r2] = await pool.query(
      `UPDATE contracts SET status='approved' WHERE status IN ('signing','active')`
    );
    const [r3] = await pool.query(
      `UPDATE contracts SET status='completed' WHERE status IN ('expired','terminated')`
    );
    const total = (r1.affectedRows || 0) + (r2.affectedRows || 0) + (r3.affectedRows || 0);
    if (total > 0) {
      console.log(`[contracts:migration] 상태 4단계 변환: ${total}건`);
    }
  } catch (e) {
    console.warn('[contracts:migration] 상태 변환 실패 (무시):', e.message);
  }
}

const _migrationPromise = ensureSchema();

router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── 자동채번 헬퍼 (C-YYYY-NNNN) ─────────────────────────────
async function generateContractNo(conn, year) {
  const yyyy = year || new Date().getFullYear();
  const prefix = `C-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT contract_no FROM contracts
      WHERE contract_no LIKE ?
      ORDER BY contract_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.contract_no) {
    const m = row.contract_no.match(/C-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// ── history 자동 기록 ──────────────────────────────────────
async function logHistory(conn, contractId, userId, actionType, opts = {}) {
  try {
    await (conn || pool).query(
      `INSERT INTO contract_history
        (contract_id, action_type, field_name, old_value, new_value, description, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        contractId,
        String(actionType).slice(0, 50),
        opts.fieldName ? String(opts.fieldName).slice(0, 100) : null,
        opts.oldValue !== undefined && opts.oldValue !== null
          ? String(opts.oldValue).slice(0, 65000)
          : null,
        opts.newValue !== undefined && opts.newValue !== null
          ? String(opts.newValue).slice(0, 65000)
          : null,
        opts.description ? String(opts.description).slice(0, 65000) : null,
        userId || null,
      ]
    );
  } catch (e) {
    console.warn('[contracts:history] log failed:', e.message);
  }
}

// 허용 상태값 (v6.0.0 슬림화 — 4단계 CLM)
const ALLOWED_STATUS = [
  'draft', // 초안
  'review', // 검토
  'approved', // 승인
  'completed', // 계약완료
];

// v6.0.0: 4단계 상태 전이 매트릭스
// 정방향: draft → review → approved → completed
// 회귀(수정 요청): review → draft (검토 단계에서만 가능)
// 종료: 임의 단계에서 → completed (관리자 강제 종료 허용)
const STATUS_TRANSITIONS = {
  draft: ['review', 'completed'],
  review: ['draft', 'approved', 'completed'],
  approved: ['review', 'completed'],
  completed: [],
};

// 상태 라벨 (history 메시지용 — 한글)
const STATUS_LABELS_KO = {
  draft: '초안',
  review: '검토',
  approved: '승인',
  completed: '계약완료',
};

// 전이가 유효한지 검증
function _isValidTransition(from, to) {
  if (from === to) return false; // 자기 자신으로 전이 금지
  const allowedTargets = STATUS_TRANSITIONS[from];
  if (!allowedTargets) return false; // 알 수 없는 from
  return allowedTargets.includes(to);
}

const ALLOWED_CONTRACT_TYPES = [
  'NDA', // 비밀유지계약
  'MSA', // 기본거래계약
  'SLA', // 서비스수준계약
  'SOW', // 작업기술서
  'service', // 용역계약
  'purchase', // 구매계약
  'license', // 라이선스
  'employment', // 고용계약
  'etc', // 기타
];

// ── GET /dashboard — KPI 대시보드 (Phase C) ─────────────────
// ⚠️ /:id 보다 먼저 선언
// Response: {
//   total, by_status: {draft, review, approved, completed},
//   expiring_30: N,  // approved 단계 + end_date <= today+30
//   expiring_60: N,  // approved 단계 + end_date > today+30 && <= today+60
//   expiring_90: N,  // ...
//   no_end_date_active: N,  // approved 인데 end_date 없음 (관리 필요)
// }
router.get('/dashboard', async (req, res) => {
  try {
    // by_status 집계
    const [statusRows] = await pool.query(
      `SELECT status, COUNT(*) AS cnt FROM contracts GROUP BY status`
    );
    const by_status = { draft: 0, review: 0, approved: 0, completed: 0 };
    let total = 0;
    for (const r of statusRows) {
      const s = r.status;
      const cnt = Number(r.cnt) || 0;
      if (by_status[s] !== undefined) by_status[s] = cnt;
      total += cnt;
    }

    // 만료 임박 (approved 단계 + end_date 구간별)
    const [[expRow]] = await pool.query(
      `SELECT
         SUM(CASE WHEN end_date IS NOT NULL AND end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  AND end_date >= CURDATE() THEN 1 ELSE 0 END) AS expiring_30,
         SUM(CASE WHEN end_date IS NOT NULL AND end_date > DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  AND end_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 1 ELSE 0 END) AS expiring_60,
         SUM(CASE WHEN end_date IS NOT NULL AND end_date > DATE_ADD(CURDATE(), INTERVAL 60 DAY)
                  AND end_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS expiring_90,
         SUM(CASE WHEN end_date IS NULL THEN 1 ELSE 0 END) AS no_end_date_active,
         SUM(CASE WHEN end_date IS NOT NULL AND end_date < CURDATE() THEN 1 ELSE 0 END) AS overdue
       FROM contracts
       WHERE status = 'approved'`
    );

    res.json({
      success: true,
      data: {
        total,
        by_status,
        expiring_30: Number(expRow.expiring_30) || 0,
        expiring_60: Number(expRow.expiring_60) || 0,
        expiring_90: Number(expRow.expiring_90) || 0,
        no_end_date_active: Number(expRow.no_end_date_active) || 0,
        overdue: Number(expRow.overdue) || 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /next-contract-no — 다음 자동 채번 미리보기 ─────────
// ⚠️ /:id 보다 먼저 선언
router.get('/next-contract-no', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const next = await generateContractNo(conn, year);
      res.json({ success: true, data: { contract_no: next, year } });
    } finally {
      conn.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET / — 목록 (페이징 + 필터) ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      search,
      status,
      contract_type,
      customer_id,
      proposal_id,
      lead_id,
      quote_id,
      date_from,
      date_to,
      expiring_soon,
    } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      // v6.0.0 Phase A3: 검색 대상에 external_contract_no 추가 (거래처 계약번호로도 찾기)
      where +=
        ' AND (c.title LIKE ? OR c.contract_no LIKE ? OR c.customer_name LIKE ?' +
        ' OR c.external_contract_no LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k, k);
    }
    if (status) {
      where += ' AND c.status = ?';
      params.push(status);
    }
    if (contract_type) {
      where += ' AND c.contract_type = ?';
      params.push(contract_type);
    }
    if (customer_id) {
      where += ' AND c.customer_id = ?';
      params.push(parseInt(customer_id, 10));
    }
    if (proposal_id) {
      where += ' AND c.proposal_id = ?';
      params.push(parseInt(proposal_id, 10));
    }
    if (lead_id) {
      where += ' AND c.lead_id = ?';
      params.push(parseInt(lead_id, 10));
    }
    if (quote_id) {
      where += ' AND c.quote_id = ?';
      params.push(parseInt(quote_id, 10));
    }
    if (date_from) {
      where += ' AND c.start_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      where += ' AND c.start_date <= ?';
      params.push(date_to);
    }
    // 만료 임박 (status=active 이면서 end_date 가 30일 이내)
    if (expiring_soon === '1' || expiring_soon === 'true') {
      where +=
        " AND c.status = 'active' AND c.end_date IS NOT NULL" +
        ' AND c.end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
    }

    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM contracts c ${where}`, params),
      pool.query(
        `SELECT c.id, c.contract_no, c.external_contract_no,
                c.title, c.customer_id, c.customer_name,
                c.proposal_id, c.lead_id, c.quote_id, c.contract_type, c.status,
                c.start_date, c.end_date, c.contract_amount, c.currency,
                c.auto_renewal, c.renewal_notice_days,
                c.legal_review_score, c.version_no, c.owner_id, c.owner_name,
                c.created_at, c.updated_at,
                tm.name AS created_by_name,
                (SELECT COUNT(*) FROM contract_files cf WHERE cf.contract_id = c.id) AS file_count
           FROM contracts c
           LEFT JOIN team_members tm ON tm.id = c.created_by
           ${where}
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRow[0]?.total ?? 0);
    // v6.0.0: 읽음 상태 enrich
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'contract', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id — 단건 + files + history ────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    // v6.0.0: 모달 오픈 = 읽음 처리
    readReceipts.markRead(getUserId(req), 'contract', id).catch(() => {});

    const [[contract]] = await pool.query(
      `SELECT c.*, tm.name AS created_by_name
         FROM contracts c
         LEFT JOIN team_members tm ON tm.id = c.created_by
        WHERE c.id = ?`,
      [id]
    );
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const [[files], [history], [latestReview]] = await Promise.all([
      pool.query(`SELECT * FROM contract_files WHERE contract_id = ? ORDER BY created_at DESC`, [
        id,
      ]),
      pool.query(
        `SELECT ch.*, tm.name AS created_by_name
           FROM contract_history ch
           LEFT JOIN team_members tm ON tm.id = ch.created_by
          WHERE ch.contract_id = ? ORDER BY ch.created_at DESC LIMIT 200`,
        [id]
      ),
      // 최신 AI 법무 검토 결과 (모달 재진입 시 자동 표시)
      pool.query(
        `SELECT clr.*, cf.original_filename AS target_filename
           FROM contract_legal_reviews clr
           LEFT JOIN contract_files cf ON cf.id = clr.target_file_id
          WHERE clr.contract_id = ?
          ORDER BY clr.generated_at DESC LIMIT 1`,
        [id]
      ),
    ]);

    contract.files = files;
    contract.history = history;
    // 최신 법무 검토 풀어서 노출 (JSON 컬럼 → 객체)
    if (latestReview && latestReview[0]) {
      const r = latestReview[0];
      const parseJson = (s, fallback) => {
        if (!s) return fallback;
        try {
          return JSON.parse(s);
        } catch (_) {
          return fallback;
        }
      };
      contract.latest_legal_review = {
        id: r.id,
        target_file_id: r.target_file_id,
        target_filename: r.target_filename,
        review_score: r.review_score,
        risk_level: r.risk_level,
        toxic_clauses: parseJson(r.toxic_clauses_json, []),
        missing_clauses: parseJson(r.missing_clauses_json, []),
        legal_compliance: parseJson(r.legal_compliance_json, {}),
        improvement_suggestions: parseJson(r.improvement_suggestions_json, []),
        overall_assessment: r.overall_assessment,
        extracted_meta: parseJson(r.extracted_meta_json, null), // v6.0.0+
        language: r.language,
        generated_at: r.generated_at,
      };
    } else {
      contract.latest_legal_review = null;
    }
    res.json({ success: true, data: contract });
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

    if (!body.title || !String(body.title).trim()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '계약명(title)이 필요합니다' });
    }

    // 연결: proposal_id 자동 반영
    let customerName = body.customer_name || null;
    let customerId = body.customer_id || null;
    let contractAmount = body.contract_amount;
    let currency = body.currency || 'KRW';
    if (body.proposal_id) {
      const [[prop]] = await conn.query(
        `SELECT customer_id, customer_name, expected_amount, currency
           FROM proposals WHERE id = ?`,
        [body.proposal_id]
      );
      if (prop) {
        if (!customerId) customerId = prop.customer_id || null;
        if (!customerName) customerName = prop.customer_name || null;
        if (contractAmount === undefined || contractAmount === null) {
          contractAmount = prop.expected_amount || null;
        }
        if (!body.currency && prop.currency) currency = prop.currency;
      }
    }
    if (body.lead_id && !customerId) {
      const [[lead]] = await conn.query(
        `SELECT customer_id, customer_name FROM leads WHERE id = ?`,
        [body.lead_id]
      );
      if (lead) {
        customerId = lead.customer_id || null;
        if (!customerName) customerName = lead.customer_name || null;
      }
    }

    const startDate = toYMD(body.start_date);
    const endDate = toYMD(body.end_date);

    // 자동 채번 (수동 입력 가능)
    const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
    let contractNo = body.contract_no && String(body.contract_no).trim();
    if (!contractNo) contractNo = await generateContractNo(conn, year);

    // v6.0.0 Phase A3: 거래처 계약번호 (선택)
    const externalContractNo =
      body.external_contract_no && String(body.external_contract_no).trim()
        ? String(body.external_contract_no).slice(0, 80)
        : null;

    const status = body.status && ALLOWED_STATUS.includes(body.status) ? body.status : 'draft';
    const contractType =
      body.contract_type && ALLOWED_CONTRACT_TYPES.includes(body.contract_type)
        ? body.contract_type
        : 'etc';

    let ownerName = body.owner_name || null;
    if (body.owner_id && !ownerName) {
      const [[tm]] = await conn.query(`SELECT name FROM team_members WHERE id = ?`, [
        body.owner_id,
      ]);
      ownerName = tm?.name || null;
    }

    const [result] = await conn.query(
      `INSERT INTO contracts
        (contract_no, external_contract_no, title, customer_id, customer_name,
         proposal_id, lead_id, quote_id, contract_type, status,
         start_date, end_date, contract_amount, currency, language,
         auto_renewal, renewal_notice_days,
         template_id, version_no, parent_contract_id,
         owner_id, owner_name, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractNo,
        externalContractNo,
        String(body.title).slice(0, 300),
        customerId || null,
        customerName ? String(customerName).slice(0, 200) : null,
        body.proposal_id || null,
        body.lead_id || null,
        body.quote_id || null,
        contractType,
        status,
        startDate,
        endDate,
        contractAmount || null,
        currency,
        body.language || 'ko',
        body.auto_renewal ? 1 : 0,
        Number(body.renewal_notice_days) || 30,
        body.template_id || null,
        Number(body.version_no) || 1,
        body.parent_contract_id || null,
        body.owner_id || null,
        ownerName,
        body.notes || null,
        userId || null,
      ]
    );
    const contractId = result.insertId;
    await logHistory(conn, contractId, userId, 'create', {
      description: `계약 생성: ${contractNo} (${body.title})`,
    });

    await conn.commit();

    res.json({
      success: true,
      id: contractId,
      data: { id: contractId, contract_no: contractNo },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '계약번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:id — 수정 (diff history 자동 기록) ─────────────────
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

    const [[prev]] = await conn.query(`SELECT * FROM contracts WHERE id = ?`, [id]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    // v6.0.0: 데이터 정합성 — lead_id/proposal_id 가 (변경되어) 들어왔는데 customer_id 가 비어있으면 자동 도출
    // (고객사 카드 [📜 계약] 탭에서 보이려면 customer_id 가 필수)
    if (body.customer_id === undefined) {
      let lookup = null;
      if (body.proposal_id) {
        const [[p]] = await conn.query(
          `SELECT customer_id, customer_name FROM proposals WHERE id = ? LIMIT 1`,
          [body.proposal_id]
        );
        lookup = p;
      } else if (body.lead_id) {
        const [[ld]] = await conn.query(
          `SELECT customer_id, customer_name FROM leads WHERE id = ? LIMIT 1`,
          [body.lead_id]
        );
        lookup = ld;
      } else if (body.quote_id) {
        const [[q]] = await conn.query(
          `SELECT customer_id, customer_name FROM quotes WHERE id = ? LIMIT 1`,
          [body.quote_id]
        );
        lookup = q;
      }
      if (lookup) {
        body.customer_id = lookup.customer_id || null;
        if (body.customer_name === undefined && lookup.customer_name) {
          body.customer_name = lookup.customer_name;
        }
      }
    }

    const fields = [];
    const values = [];
    const allowed = [
      'contract_no', // v6.0.0 Phase A3: 자동→수동 채번 전환 시 수정 가능
      'external_contract_no', // v6.0.0 Phase A3: 거래처 계약번호
      'title',
      'customer_id',
      'customer_name',
      'proposal_id',
      'lead_id',
      'quote_id',
      'contract_type',
      'status',
      'start_date',
      'end_date',
      'contract_amount',
      'currency',
      'language',
      'auto_renewal',
      'renewal_notice_days',
      'template_id',
      'version_no',
      'parent_contract_id',
      'owner_id',
      'owner_name',
      'notes',
      'review_deadline', // v6.0.0 Phase C: 검토 D-Day
    ];
    const DATE_FIELDS = new Set(['start_date', 'end_date', 'review_deadline']);
    const BOOL_FIELDS = new Set(['auto_renewal']);
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
      }
      if (f === 'contract_type' && body[f] && !ALLOWED_CONTRACT_TYPES.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 계약 유형' });
      }
      // v6.0.0 Phase A3: contract_no 수동 변경 시 빈문자 금지 + 길이 제한
      if (f === 'contract_no') {
        const trimmed = body[f] === null ? null : String(body[f]).trim();
        if (!trimmed) {
          await conn.rollback();
          return res.status(400).json({ success: false, error: '계약번호는 비울 수 없습니다' });
        }
        body[f] = trimmed.slice(0, 50);
      }
      // v6.0.0 Phase A3: external_contract_no 길이 제한 + 빈문자 → null
      if (f === 'external_contract_no') {
        if (body[f] === null || body[f] === '' || !String(body[f]).trim()) {
          body[f] = null;
        } else {
          body[f] = String(body[f]).trim().slice(0, 80);
        }
      }
      let v = body[f];
      if (DATE_FIELDS.has(f)) v = toYMD(v);
      if (BOOL_FIELDS.has(f)) v = v ? 1 : 0;
      fields.push(`${f} = ?`);
      values.push(v);
    }

    if (fields.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '수정할 항목이 없습니다' });
    }

    values.push(id);
    await conn.query(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`, values);

    // diff history (값이 실제로 바뀐 필드만)
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      const oldV = prev[f];
      let newV = body[f];
      if (DATE_FIELDS.has(f)) newV = toYMD(newV);
      if (BOOL_FIELDS.has(f)) newV = newV ? 1 : 0;
      // 단순 비교 (null/string/number 모두 String 으로 비교)
      const ov = oldV === null || oldV === undefined ? '' : String(oldV);
      const nv = newV === null || newV === undefined ? '' : String(newV);
      if (ov !== nv) {
        await logHistory(conn, id, userId, f === 'status' ? 'status_change' : 'update', {
          fieldName: f,
          oldValue: ov,
          newValue: nv,
        });
      }
    }

    await conn.commit();

    res.json({ success: true, data: { id } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '계약번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── DELETE /:id — 삭제 (CASCADE) ────────────────────────────
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    // 파일들 디스크에서도 정리
    const [files] = await conn.query(`SELECT file_path FROM contract_files WHERE contract_id = ?`, [
      id,
    ]);
    for (const f of files) {
      try {
        if (f.file_path && fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      } catch (e) {
        console.warn('[contracts:delete] 파일 삭제 실패:', e.message);
      }
    }
    // 계약 디렉토리 자체도 정리 (best-effort)
    try {
      const dir = path.join(CONTRACT_UPLOAD_DIR, String(id));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* 무시 */
    }

    const [result] = await conn.query(`DELETE FROM contracts WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PATCH /:id/status — 상태 전이 (Phase 1 CLM 워크플로우) ───
// 전이 규칙 검증 + 자동 timestamp + history 강조
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
    const newStatus = req.body?.status;
    if (!newStatus || !ALLOWED_STATUS.includes(newStatus)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
    }

    const [[prev]] = await conn.query(`SELECT id, status, start_date FROM contracts WHERE id = ?`, [
      id,
    ]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    const fromStatus = prev.status;
    if (fromStatus === newStatus) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: `이미 ${STATUS_LABELS_KO[fromStatus] || fromStatus} 상태입니다`,
      });
    }

    if (!_isValidTransition(fromStatus, newStatus)) {
      await conn.rollback();
      const allowed = STATUS_TRANSITIONS[fromStatus] || [];
      const allowedKo = allowed.map(s => STATUS_LABELS_KO[s] || s).join(', ');
      return res.status(400).json({
        success: false,
        error:
          `잘못된 전이: ${STATUS_LABELS_KO[fromStatus]} → ${STATUS_LABELS_KO[newStatus] || newStatus}` +
          (allowed.length > 0
            ? ` (허용: ${allowedKo})`
            : ' (이 상태에서는 다른 상태로 전이할 수 없습니다)'),
      });
    }

    // 자동 timestamp — signing → active 시 start_date 비어있으면 오늘 채움
    let extraSql = '';
    const extraParams = [];
    if (fromStatus === 'signing' && newStatus === 'active' && !prev.start_date) {
      const today = new Date();
      const p = n => String(n).padStart(2, '0');
      const todayYmd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
      extraSql = ', start_date = ?';
      extraParams.push(todayYmd);
    }

    await conn.query(`UPDATE contracts SET status = ?${extraSql} WHERE id = ?`, [
      newStatus,
      ...extraParams,
      id,
    ]);

    // history 강조 (전이 종류에 따라 description 다르게)
    let desc;
    if (newStatus === 'terminated') {
      desc = `❌ 해지 처리: ${STATUS_LABELS_KO[fromStatus]} → 해지`;
    } else if (newStatus === 'expired') {
      desc = `⏰ 만료 처리: ${STATUS_LABELS_KO[fromStatus]} → 만료`;
    } else if (fromStatus === 'signing' && newStatus === 'active') {
      desc = `✅ 발효: 서명진행 → 발효` + (extraSql ? ' (start_date 자동 채움)' : '');
    } else if (fromStatus === 'active' && newStatus === 'renewal') {
      desc = `🔄 갱신 시작: 발효 → 갱신중`;
    } else if (fromStatus === 'renewal' && newStatus === 'active') {
      desc = `🔄 갱신 완료: 갱신중 → 발효`;
    } else {
      desc = `상태 변경: ${STATUS_LABELS_KO[fromStatus]} → ${STATUS_LABELS_KO[newStatus]}`;
    }
    await logHistory(conn, id, userId, 'status_change', {
      fieldName: 'status',
      oldValue: fromStatus,
      newValue: newStatus,
      description: desc,
    });

    // P1: 계약 체결(completed) 시 프로젝트 + 매출계획 자동 생성 (멱등, 같은 트랜잭션)
    //     실패 시 아래 catch 에서 전체 롤백(상태 변경 포함) → 데이터 정합성 보장.
    let provision = null;
    if (newStatus === 'completed') {
      const { provisionOnComplete } = require('../services/contractProvision');
      provision = await provisionOnComplete(conn, id);
    }

    await conn.commit();

    res.json({
      success: true,
      data: {
        id,
        from: fromStatus,
        to: newStatus,
        auto_start_date: extraSql ? extraParams[0] : null,
        provision, // {projectId, projectCreated, scheduleIds, scheduleCreated, skipped}
      },
    });

    // v6.0.0 Phase E: 상태 변경 알림 (best-effort, 비동기 — 응답 차단 안함)
    try {
      const notifySvc = require('../services/contractNotifier');
      if (notifySvc?.notifyStatusChange) {
        notifySvc.notifyStatusChange({
          contractId: id,
          fromStatus,
          toStatus: newStatus,
          changedByUserId: userId,
        });
      }
    } catch (_) {
      /* skip */
    }
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── POST /:id/files — 파일 업로드 (다중) ─────────────────────
router.post('/:id/files', uploadMixed, async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    if (!contractId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);

    const [[contract]] = await pool.query(`SELECT id FROM contracts WHERE id = ?`, [contractId]);
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const files = collectFiles(req);
    if (!files.length) return res.status(400).json({ success: false, error: '파일이 없습니다' });

    const fileType =
      req.body.file_type && ALLOWED_FILE_TYPES.includes(req.body.file_type)
        ? req.body.file_type
        : 'contract';
    const versionNo = parseInt(req.body.version_no, 10) || 1;
    const isFinal = req.body.is_final === '1' || req.body.is_final === 'true' ? 1 : 0;
    const description = req.body.description || null;

    const uploaded = [];
    const failed = [];
    for (const file of files) {
      try {
        const decoded = decodeOriginalName(file.originalname);
        const [r] = await pool.query(
          `INSERT INTO contract_files
            (contract_id, file_type, original_filename, stored_filename, file_path,
             mime_type, file_size, version_no, is_final, description, uploaded_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            contractId,
            fileType,
            decoded,
            file.filename,
            file.path,
            file.mimetype || null,
            file.size || null,
            versionNo,
            isFinal,
            description,
            userId || null,
          ]
        );
        uploaded.push({
          id: r.insertId,
          original_filename: decoded,
          file_type: fileType,
          file_size: file.size,
        });
        await logHistory(null, contractId, userId, 'file_upload', {
          description: `파일 업로드: ${decoded} (${fileType})`,
          newValue: decoded,
        });
      } catch (e) {
        failed.push({ original_filename: decodeOriginalName(file.originalname), error: e.message });
        // 실패 시 디스크 파일 정리
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {
          /* 무시 */
        }
      }
    }

    res.json({ success: true, data: { uploaded, failed } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id/files/:fileId/download — 다운로드 ───────────────
router.get('/:id/files/:fileId/download', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }

    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ success: false, error: '디스크에 파일이 없습니다' });
    }

    res.download(file.file_path, file.original_filename, err => {
      if (err) {
        console.error('[contracts:download] 실패:', err.message);
        if (!res.headersSent) {
          handleError(res, err);
        }
      }
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /:id/files/:fileId — 파일 삭제 ────────────────────
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });

    // 디스크 정리
    try {
      if (file.file_path && fs.existsSync(file.file_path)) fs.unlinkSync(file.file_path);
    } catch (e) {
      console.warn('[contracts:file-delete] 디스크 삭제 실패:', e.message);
    }

    await pool.query(`DELETE FROM contract_files WHERE id = ?`, [fileId]);
    await logHistory(null, contractId, userId, 'file_delete', {
      description: `파일 삭제: ${file.original_filename}`,
      oldValue: file.original_filename,
    });

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// Phase 2: AI 법무 검토 (analyzeContractLegal)
//
// 정책: team_lead+ 권한 권장 (현재 manager+ 로 열어둠 — Phase 2-PR2 에서 조정)
// AI 비용: 1회 약 500-1000원 (Gemini 2.5 Pro Multimodal)
// =============================================================

// POST /:id/files/:fileId/legal-review — AI 법무 검토 실행 + DB 영속화
router.post('/:id/files/:fileId/legal-review', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    // 계약 존재 확인
    const [[contract]] = await pool.query(`SELECT id FROM contracts WHERE id = ?`, [contractId]);
    if (!contract) {
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    // 대상 파일 조회
    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) {
      return res.status(404).json({ success: false, error: '계약서 파일을 찾을 수 없음' });
    }

    console.log(
      `[contracts:legal-review] start contract=${contractId} file=${fileId} (${file.original_filename})`
    );
    const startedAt = Date.now();

    // Gemini 호출 (테스트 환경은 mock)
    const result = await analyzeContractLegal({
      contractPath: file.file_path,
      contractMime: file.mime_type,
      userId,
      endpoint: 'contract_legal_review',
    });

    // DB 영속화 (contract_legal_reviews)
    const [insertResult] = await pool.query(
      `INSERT INTO contract_legal_reviews
        (contract_id, target_file_id, review_score, risk_level,
         toxic_clauses_json, missing_clauses_json, legal_compliance_json,
         improvement_suggestions_json, overall_assessment, extracted_meta_json,
         language, generated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractId,
        fileId,
        result.review_score,
        result.risk_level,
        JSON.stringify(result.toxic_clauses || []),
        JSON.stringify(result.missing_clauses || []),
        JSON.stringify(result.legal_compliance || {}),
        JSON.stringify(result.improvement_suggestions || []),
        result.overall_assessment || null,
        result.extracted_meta ? JSON.stringify(result.extracted_meta) : null,
        req.body?.language || 'ko',
        userId || null,
      ]
    );

    // 메인 contracts 테이블에도 요약 점수 반영 (마지막 검토 결과)
    await pool.query(
      `UPDATE contracts SET legal_review_score = ?, ai_review_summary = ? WHERE id = ?`,
      [result.review_score, result.overall_assessment || null, contractId]
    );

    // history 자동 기록
    await logHistory(null, contractId, userId, 'legal_review', {
      description: `AI 법무 검토 완료 — score=${result.review_score}, risk=${result.risk_level} (${file.original_filename})`,
      newValue: `score=${result.review_score}, risk=${result.risk_level}`,
    });

    console.log(
      `[contracts:legal-review] done contract=${contractId} score=${result.review_score} risk=${result.risk_level} elapsed=${Date.now() - startedAt}ms`
    );
    // v6.0.0 fix: extracted_meta 명시적 로깅 (자동 채움 디버깅용)
    if (result.extracted_meta) {
      const filled = Object.entries(result.extracted_meta)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k]) => k);
      console.log(
        `[contracts:legal-review] extracted_meta filled=${filled.length}/7 [${filled.join(',')}]`
      );
    } else {
      console.log(`[contracts:legal-review] extracted_meta=null (AI 추출 실패)`);
    }

    res.json({
      success: true,
      data: {
        id: insertResult.insertId,
        target_file_id: fileId,
        target_filename: file.original_filename,
        ...result,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[contracts:legal-review] failed:', err?.message || err);
    handleError(res, err);
  }
});

// GET /:id/legal-reviews — 법무 검토 이력 조회 (다중 버전)
router.get('/:id/legal-reviews', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    if (!contractId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [rows] = await pool.query(
      `SELECT clr.*, cf.original_filename AS target_filename,
              tm.name AS generated_by_name
         FROM contract_legal_reviews clr
         LEFT JOIN contract_files cf ON cf.id = clr.target_file_id
         LEFT JOIN team_members tm ON tm.id = clr.generated_by
        WHERE clr.contract_id = ?
        ORDER BY clr.generated_at DESC
        LIMIT 50`,
      [contractId]
    );

    // JSON 컬럼 풀어서 노출
    const parseJson = (s, fallback) => {
      if (!s) return fallback;
      try {
        return JSON.parse(s);
      } catch (_) {
        return fallback;
      }
    };
    const data = rows.map(r => ({
      id: r.id,
      target_file_id: r.target_file_id,
      target_filename: r.target_filename,
      review_score: r.review_score,
      risk_level: r.risk_level,
      toxic_clauses: parseJson(r.toxic_clauses_json, []),
      missing_clauses: parseJson(r.missing_clauses_json, []),
      legal_compliance: parseJson(r.legal_compliance_json, {}),
      improvement_suggestions: parseJson(r.improvement_suggestions_json, []),
      overall_assessment: r.overall_assessment,
      extracted_meta: parseJson(r.extracted_meta_json, null), // v6.0.0+
      language: r.language,
      generated_by: r.generated_by,
      generated_by_name: r.generated_by_name,
      generated_at: r.generated_at,
    }));

    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// v6.0.0 Step 4: Modusign 전자서명 통합
//
// OAuth 흐름:
//   GET /esign/oauth/connect   — 사용자를 모두싸인 인가 페이지로 redirect
//   GET /esign/oauth/callback  — 인가 코드 → access_token 교환 + DB 저장
//   GET /esign/status          — 현재 사용자 OAuth 연결 상태
//   DELETE /esign/disconnect   — OAuth 토큰 무효화
//
// 서명 워크플로우:
//   POST /:id/esign/request    — 계약서 서명 요청 시작
//   GET  /:id/esign/status     — 모두싸인 실시간 상태 조회
//   GET  /:id/esign/signed-pdf — 서명 완료 PDF 다운로드
//   POST /:id/esign/cancel     — 요청 취소
//
// 정책: requireFeature('crm.contracts.esign') — 별도 토글 (기본 비활성)
// =============================================================
const { requireFeature: _reqFeature } = require('../middleware/featureGuard');
const esignGuard = _reqFeature('crm.contracts.esign');

// 사용자 OAuth 토큰 조회 (복호화) — 없으면 null
async function _getUserEsignToken(userId) {
  if (!userId) return null;
  const [[row]] = await pool.query(
    `SELECT * FROM esign_oauth_tokens WHERE user_id = ? AND provider = 'modusign' LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  return {
    ...row,
    access_token: _safeDecrypt(row.access_token),
    refresh_token: row.refresh_token ? _safeDecrypt(row.refresh_token) : null,
  };
}

// ── GET /esign/oauth/connect — 인가 페이지 redirect ──────────
router.get('/esign/oauth/connect', esignGuard, (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    // state 에 userId 인코딩 (콜백 시 매칭용)
    const state = Buffer.from(JSON.stringify({ uid: userId, ts: Date.now() })).toString(
      'base64url'
    );
    const url = modusign.getAuthUrl(state);
    res.json({ success: true, data: { auth_url: url, mock: modusign.isMockMode() } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /esign/oauth/callback — 코드 → 토큰 교환 ─────────────
router.get('/esign/oauth/callback', esignGuard, async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, error: '인가 코드 누락' });
    }
    let userId;
    try {
      const decoded = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'));
      userId = decoded.uid;
    } catch (_) {
      userId = getUserId(req);
    }
    if (!userId) return res.status(401).json({ success: false, error: '사용자 식별 실패' });

    const token = await modusign.exchangeCodeForToken(String(code));
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;

    await pool.query(
      `INSERT INTO esign_oauth_tokens
        (user_id, provider, access_token, refresh_token, token_type,
         expires_at, scope, modusign_user_id, modusign_email)
       VALUES (?, 'modusign', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         refresh_token = VALUES(refresh_token),
         token_type = VALUES(token_type),
         expires_at = VALUES(expires_at),
         scope = VALUES(scope),
         modusign_user_id = VALUES(modusign_user_id),
         modusign_email = VALUES(modusign_email),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        _safeEncrypt(token.access_token),
        token.refresh_token ? _safeEncrypt(token.refresh_token) : null,
        token.token_type || 'Bearer',
        expiresAt,
        token.scope || null,
        token.modusign_user_id || null,
        token.modusign_email || null,
      ]
    );

    // 사용자 경험: JSON 응답 또는 redirect (프론트에서 처리)
    res.json({
      success: true,
      data: {
        connected: true,
        modusign_user_id: token.modusign_user_id || null,
        modusign_email: token.modusign_email || null,
        mock: modusign.isMockMode(),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /esign/status — 현재 사용자 연결 상태 ────────────────
router.get('/esign/status', esignGuard, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const token = await _getUserEsignToken(userId);
    res.json({
      success: true,
      data: {
        connected: !!token,
        modusign_user_id: token?.modusign_user_id || null,
        modusign_email: token?.modusign_email || null,
        expires_at: token?.expires_at || null,
        mock: modusign.isMockMode(),
        configured: modusign.isConfigured(),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /esign/disconnect — OAuth 토큰 삭제 ────────────────
router.delete('/esign/disconnect', esignGuard, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    await pool.query(`DELETE FROM esign_oauth_tokens WHERE user_id = ? AND provider = 'modusign'`, [
      userId,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /:id/esign/request — 서명 요청 시작 ─────────────────
router.post('/:id/esign/request', esignGuard, async (req, res) => {
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
    const { file_id, signers, message } = body;

    if (!Array.isArray(signers) || signers.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '서명자(signers) 1명 이상 필요' });
    }
    for (const s of signers) {
      if (!s.name || !s.email) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '서명자 name/email 필수' });
      }
    }

    const [[contract]] = await conn.query(`SELECT * FROM contracts WHERE id = ?`, [id]);
    if (!contract) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }
    if (contract.status !== 'approved') {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: '서명 요청은 "승인" 단계 계약만 가능합니다',
      });
    }
    if (contract.esign_request_id) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: `이미 서명 요청됨 (${contract.esign_status || 'requested'})`,
      });
    }

    // OAuth 토큰 확인 (mock 모드에서는 임시 토큰 허용)
    const token = await _getUserEsignToken(userId);
    if (!token && !modusign.isMockMode()) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: '모두싸인 연결 필요 — 설정에서 [모두싸인 연결] 후 재시도하세요',
      });
    }

    // 대상 파일 결정
    let targetFile;
    if (file_id) {
      const [[f]] = await conn.query(
        `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
        [parseInt(file_id, 10), id]
      );
      if (!f) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });
      }
      targetFile = f;
    } else {
      // 최신 분석 가능 파일 자동 선택
      const [files] = await conn.query(
        `SELECT * FROM contract_files WHERE contract_id = ?
           ORDER BY created_at DESC`,
        [id]
      );
      targetFile = files.find(f => /\.(pdf)$/i.test(f.original_filename));
      if (!targetFile) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          error: '서명 가능한 PDF 파일이 없습니다',
        });
      }
    }

    // 모두싸인 호출
    const result = await modusign.createSignatureRequest({
      accessToken: token?.access_token || '__MOCK__',
      filePath: targetFile.file_path,
      fileName: targetFile.original_filename,
      signers,
      message: message || `${contract.title} 계약서 서명 요청`,
    });

    if (!result?.document_id) {
      await conn.rollback();
      return res.status(502).json({
        success: false,
        error: 'Modusign 응답에 document_id 없음',
      });
    }

    // contracts 업데이트
    await conn.query(
      `UPDATE contracts SET
         esign_provider = 'modusign',
         esign_request_id = ?,
         esign_status = 'requested',
         esign_requested_at = NOW(),
         esign_signers_json = ?
       WHERE id = ?`,
      [result.document_id, JSON.stringify(signers), id]
    );

    // history
    await logHistory(conn, id, userId, 'esign_request', {
      description: `전자서명 요청: 서명자 ${signers.length}명, 문서 ID ${result.document_id}`,
      newValue: result.document_id,
    });

    await conn.commit();
    res.json({
      success: true,
      data: {
        document_id: result.document_id,
        status: 'requested',
        signers: result.signers || signers,
        mock: modusign.isMockMode(),
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('[contracts:esign:request] failed:', err?.message || err);
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── GET /:id/esign/status — 실시간 상태 조회 ──────────────────
router.get('/:id/esign/status', esignGuard, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);

    const [[contract]] = await pool.query(
      `SELECT id, esign_provider, esign_request_id, esign_status,
              esign_requested_at, esign_signed_at, esign_signers_json
         FROM contracts WHERE id = ?`,
      [id]
    );
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    if (!contract.esign_request_id) {
      return res.json({ success: true, data: { local: contract, remote: null } });
    }

    const token = await _getUserEsignToken(userId);
    let remote = null;
    try {
      remote = await modusign.getDocumentStatus({
        accessToken: token?.access_token || '__MOCK__',
        documentId: contract.esign_request_id,
      });
    } catch (e) {
      console.warn('[contracts:esign:status] remote fetch failed:', e.message);
    }

    res.json({
      success: true,
      data: {
        local: {
          ...contract,
          esign_signers: contract.esign_signers_json
            ? (() => {
                try {
                  return JSON.parse(contract.esign_signers_json);
                } catch (_) {
                  return [];
                }
              })()
            : [],
        },
        remote,
        mock: modusign.isMockMode(),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id/esign/signed-pdf — 서명 완료본 다운로드 ─────────
router.get('/:id/esign/signed-pdf', esignGuard, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    const [[contract]] = await pool.query(
      `SELECT id, contract_no, esign_request_id, esign_status, esign_signed_pdf_path
         FROM contracts WHERE id = ?`,
      [id]
    );
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    if (!contract.esign_request_id) {
      return res.status(400).json({ success: false, error: '서명 요청 이력이 없습니다' });
    }
    if (contract.esign_status !== 'signed' && !modusign.isMockMode()) {
      return res.status(400).json({
        success: false,
        error: `서명 미완료 (현재: ${contract.esign_status || 'unknown'})`,
      });
    }

    // 이미 저장된 파일 있으면 그대로 전송
    if (contract.esign_signed_pdf_path && fs.existsSync(contract.esign_signed_pdf_path)) {
      return res.download(contract.esign_signed_pdf_path, `${contract.contract_no}_signed.pdf`);
    }

    // 다운로드 + 저장 + 전송
    const token = await _getUserEsignToken(userId);
    const savePath = path.join(CONTRACT_UPLOAD_DIR, String(id), `signed_${Date.now()}.pdf`);
    await modusign.downloadSignedPdf({
      accessToken: token?.access_token || '__MOCK__',
      documentId: contract.esign_request_id,
      savePath,
    });
    await pool.query(`UPDATE contracts SET esign_signed_pdf_path = ? WHERE id = ?`, [savePath, id]);
    res.download(savePath, `${contract.contract_no}_signed.pdf`);
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /:id/esign/cancel — 서명 요청 취소 ───────────────────
router.post('/:id/esign/cancel', esignGuard, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    const [[contract]] = await conn.query(
      `SELECT esign_request_id, esign_status FROM contracts WHERE id = ?`,
      [id]
    );
    if (!contract) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }
    if (!contract.esign_request_id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '서명 요청 이력이 없습니다' });
    }
    if (contract.esign_status === 'signed') {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '이미 완료된 서명은 취소할 수 없습니다' });
    }

    const token = await _getUserEsignToken(userId);
    await modusign.cancelSignatureRequest({
      accessToken: token?.access_token || '__MOCK__',
      documentId: contract.esign_request_id,
    });
    await conn.query(`UPDATE contracts SET esign_status = 'cancelled' WHERE id = ?`, [id]);
    await logHistory(conn, id, userId, 'esign_cancel', {
      description: '전자서명 요청 취소',
      oldValue: contract.esign_status,
      newValue: 'cancelled',
    });
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// =============================================================
// v6.0.0 Phase B: 공유 링크 관리 (인증 필요 — 등록자가 토큰 발급/회수)
// =============================================================
const crypto = require('crypto');

function _generateToken() {
  // 32 bytes = 256-bit, base64url 43 chars (안전한 권장값)
  return crypto.randomBytes(32).toString('base64url');
}

const ALLOWED_ROLES = ['viewer', 'commenter', 'approver'];

// POST /:id/share — 공유 링크 발급
router.post('/:id/share', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    const body = req.body || {};

    // 역할 검증
    const role = ALLOWED_ROLES.includes(body.role) ? body.role : 'viewer';
    // 만료 (기본 14일)
    const expiresDays = Math.max(1, Math.min(365, parseInt(body.expires_days, 10) || 14));
    const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
    // 수신자
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자 1명 이상 필요' });
    }
    for (const r of recipients) {
      if (!r.email || !/^[^@]+@[^@]+\.[^@]+$/.test(r.email)) {
        return res
          .status(400)
          .json({ success: false, error: `유효하지 않은 이메일: ${r.email || '-'}` });
      }
    }

    const [[contract]] = await pool.query(`SELECT id, title FROM contracts WHERE id = ?`, [id]);
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const token = _generateToken();
    const [insRes] = await pool.query(
      `INSERT INTO contract_share_links
        (token, contract_id, created_by, role, expires_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        token,
        id,
        userId || null,
        role,
        expiresAt,
        body.note ? String(body.note).slice(0, 500) : null,
      ]
    );
    const linkId = insRes.insertId;

    // 수신자 일괄 등록
    for (const r of recipients) {
      try {
        await pool.query(
          `INSERT INTO contract_share_recipients (share_link_id, email, name)
           VALUES (?, ?, ?)`,
          [
            linkId,
            String(r.email).toLowerCase().slice(0, 200),
            r.name ? String(r.name).slice(0, 100) : null,
          ]
        );
      } catch (_) {
        /* 중복 등 무시 */
      }
    }

    await logHistory(null, id, userId, 'share_create', {
      description: `공유 링크 발급: role=${role}, 수신자=${recipients.length}명, 만료=${expiresDays}일`,
      newValue: token.slice(0, 12) + '...',
    });

    // 알림 발송 (best-effort)
    try {
      const notifySvc = require('../services/contractNotifier');
      if (notifySvc?.notifyShareInvite) {
        notifySvc.notifyShareInvite({
          contractId: id,
          shareLinkId: linkId,
          token,
          role,
          recipients,
        });
      }
    } catch (_) {
      /* notifier 없으면 skip */
    }

    res.json({
      success: true,
      data: { id: linkId, token, role, expires_at: expiresAt, recipients_count: recipients.length },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /:id/share — 활성 공유 링크 목록
router.get('/:id/share', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [links] = await pool.query(
      `SELECT csl.id, csl.token, csl.role, csl.expires_at, csl.revoked_at,
              csl.note, csl.created_at, tm.name AS created_by_name,
              (SELECT COUNT(*) FROM contract_share_recipients csr
                WHERE csr.share_link_id = csl.id) AS recipients_count,
              (SELECT COUNT(*) FROM contract_share_recipients csr
                WHERE csr.share_link_id = csl.id AND csr.viewed_at IS NOT NULL) AS viewed_count
         FROM contract_share_links csl
         LEFT JOIN team_members tm ON tm.id = csl.created_by
        WHERE csl.contract_id = ?
        ORDER BY csl.created_at DESC`,
      [id]
    );
    res.json({ success: true, data: links });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /:id/share/:linkId/recipients — 수신자 상세
router.get('/:id/share/:linkId/recipients', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId, 10);
    if (!linkId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [recipients] = await pool.query(
      `SELECT email, name, notified_at, viewed_at, responded_at
         FROM contract_share_recipients
        WHERE share_link_id = ?
        ORDER BY created_at ASC`,
      [linkId]
    );
    res.json({ success: true, data: recipients });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id/share/:linkId — 회수
router.delete('/:id/share/:linkId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const linkId = parseInt(req.params.linkId, 10);
    if (!id || !linkId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    await pool.query(
      `UPDATE contract_share_links SET revoked_at = NOW()
        WHERE id = ? AND contract_id = ? AND revoked_at IS NULL`,
      [linkId, id]
    );
    await logHistory(null, id, userId, 'share_revoke', {
      description: `공유 링크 회수 (#${linkId})`,
    });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// =============================================================
// v6.0.0 Phase D: 댓글 (인증된 사용자용)
// =============================================================
const ALLOWED_COMMENT_TYPES = ['general', 'revise', 'approve', 'reject'];

// GET /:id/comments — 댓글 목록
router.get('/:id/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [comments] = await pool.query(
      `SELECT cc.id, cc.parent_id, cc.comment_type, cc.body, cc.created_at,
              cc.author_email, cc.author_name, cc.user_id,
              tm.name AS internal_author_name
         FROM contract_comments cc
         LEFT JOIN team_members tm ON tm.id = cc.user_id
        WHERE cc.contract_id = ?
        ORDER BY cc.created_at ASC`,
      [id]
    );
    res.json({ success: true, data: comments });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/comments — 댓글 작성 (등록자/관리자)
router.post('/:id/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);
    const body = req.body || {};
    const text = String(body.body || '').trim();
    if (!text) return res.status(400).json({ success: false, error: '댓글 내용 필요' });
    const commentType = ALLOWED_COMMENT_TYPES.includes(body.comment_type)
      ? body.comment_type
      : 'general';
    const parentId = body.parent_id ? parseInt(body.parent_id, 10) : null;

    const [[contract]] = await pool.query(`SELECT id FROM contracts WHERE id = ?`, [id]);
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const [r] = await pool.query(
      `INSERT INTO contract_comments
        (contract_id, share_link_id, user_id, parent_id, comment_type, body)
       VALUES (?, NULL, ?, ?, ?, ?)`,
      [id, userId || null, parentId, commentType, text.slice(0, 5000)]
    );

    await logHistory(null, id, userId, 'comment', {
      description: `댓글: ${commentType} — ${text.slice(0, 80)}`,
    });

    // 알림 (best-effort)
    try {
      const notifySvc = require('../services/contractNotifier');
      if (notifySvc?.notifyComment) {
        notifySvc.notifyComment({
          contractId: id,
          commentId: r.insertId,
          authorEmail: null,
          authorName: null,
          authorUserId: userId,
          body: text,
        });
      }
    } catch (_) {
      /* skip */
    }

    res.json({ success: true, data: { id: r.insertId, comment_type: commentType } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
