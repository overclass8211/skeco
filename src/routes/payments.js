'use strict';
// =============================================================
// /api/payments — 수금관리 모듈 (SFR-011)
//
// F1. 수금 스케줄 관리  — 계약 연계, 단계별 수금 계획
// F2. 수금 실적 등록    — 실제 입금 처리 (전액/부분수금)
// F3. 미수금 관리       — 연체 추적 + 자동 알림
// F4. 세금계산서 관리   — 발행 요청·이력 (바로빌 API — Phase 2)
// F5. 매출 대시보드     — 예상 vs 실적, 손익, KPI
//
// 기능 플래그: crm.payments
// RBAC: team_lead 이상 (재무 민감 정보 보호)
// =============================================================

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireFeature } = require('../middleware/featureGuard');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const { sanitizeCell, validateRequest } = require('../utils/bulkPasteHelper');
const { toExcelBuffer, sendExcel } = require('../utils/excelHelper');
const paymentNotifier = require('../services/paymentNotifier');
const dunningService = require('../services/dunningService');

// 홈택스 가져오기 전용 — 메모리 업로드(csv/xlsx, 10MB). 디스크 저장 불필요(파싱만).
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(csv|xlsx|xls)$/i.test(file.originalname || '')),
});

// ─── 자가 마이그레이션 ─────────────────────────────────────────
async function runMigrations() {
  // ① 수금 스케줄 (계약 1개 → N개 단계)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_schedules (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      contract_id      INT NULL,
      customer_id      INT NULL,
      customer_name    VARCHAR(200) NULL,
      contract_name    VARCHAR(200) NULL,
      stage_name       VARCHAR(50) NOT NULL COMMENT '착수금|중도금|잔금|기타',
      stage_order      INT DEFAULT 1,
      ratio            DECIMAL(5,2) NULL       COMMENT '비율 % (30.00)',
      scheduled_amount DECIMAL(20,2) NOT NULL  COMMENT '예정 수금액 (VAT 포함)',
      supply_amount    DECIMAL(20,2) NULL       COMMENT '공급가액 (VAT 제외)',
      tax_amount       DECIMAL(20,2) DEFAULT 0 COMMENT '부가세',
      due_date         DATE NOT NULL            COMMENT '수금 예정일',
      invoice_date     DATE NULL                COMMENT '계산서 발행 예정일',
      status           VARCHAR(20) DEFAULT 'scheduled'
                       COMMENT 'scheduled|invoiced|partial|collected|overdue|written_off',
      note             TEXT NULL,
      created_by       INT NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contract  (contract_id),
      INDEX idx_customer  (customer_id),
      INDEX idx_due_date  (due_date),
      INDEX idx_status    (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ② 실제 입금 기록 (1 스케줄 → N 입금)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_records (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id    INT NOT NULL,
      contract_id    INT NULL,
      customer_id    INT NULL,
      paid_amount    DECIMAL(20,2) NOT NULL,
      paid_date      DATE NOT NULL,
      payment_method VARCHAR(30) DEFAULT 'bank_transfer'
                     COMMENT 'bank_transfer|card|cash|other',
      bank_account   VARCHAR(100) NULL,
      reference_no   VARCHAR(100) NULL COMMENT '입금 참조번호',
      note           TEXT NULL,
      registered_by  INT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_schedule  (schedule_id),
      INDEX idx_paid_date (paid_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ③ 세금계산서 (스케줄과 연동 — 바로빌 API Phase 2)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id    INT NULL,
      contract_id    INT NULL,
      customer_id    INT NULL,
      customer_name  VARCHAR(200) NULL,
      invoice_no     VARCHAR(100) NULL   COMMENT '자사 발행번호',
      supply_amount  DECIMAL(20,2) NOT NULL,
      tax_amount     DECIMAL(20,2) NOT NULL,
      total_amount   DECIMAL(20,2) NOT NULL,
      issue_date     DATE NULL,
      status         VARCHAR(20) DEFAULT 'draft'
                     COMMENT 'draft|requested|issued|cancelled',
      barobill_id    VARCHAR(200) NULL   COMMENT '바로빌 발행 ID (Phase 2)',
      nts_result     VARCHAR(50) NULL    COMMENT '국세청 전송 결과 (Phase 2)',
      issued_at      DATETIME NULL,
      note           TEXT NULL,
      raw_response   MEDIUMTEXT NULL     COMMENT 'API 응답 원문 (Phase 2)',
      created_by     INT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contract (contract_id),
      INDEX idx_customer (customer_id),
      INDEX idx_status   (status),
      INDEX idx_issue    (issue_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ④ 수금 비율 템플릿 (자주 쓰는 착수금/중도금/잔금 패턴 저장)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_templates (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(100) NOT NULL COMMENT '템플릿명 (예: 3단계 표준)',
      stages_json MEDIUMTEXT NOT NULL   COMMENT '[{name, ratio, offset_days, note}]',
      is_default  TINYINT(1) DEFAULT 0,
      created_by  INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 기본 템플릿 시드 (idempotent)
  const [existing] = await pool.query(
    `SELECT id FROM payment_templates WHERE is_default = 1 LIMIT 1`
  );
  if (existing.length === 0) {
    await pool.query(`
      INSERT INTO payment_templates (name, stages_json, is_default, created_by) VALUES
      ('3단계 표준 (착수30/중도40/잔금30)',
       '[{"name":"착수금","ratio":30,"offset_days":0,"note":"계약일 즉시"},{"name":"중도금","ratio":40,"offset_days":60,"note":"계약 후 60일"},{"name":"잔금","ratio":30,"offset_days":0,"note":"납품 완료 후"}]',
       1, NULL),
      ('2단계 (선금50/잔금50)',
       '[{"name":"선금","ratio":50,"offset_days":0,"note":"계약일 즉시"},{"name":"잔금","ratio":50,"offset_days":0,"note":"납품 완료 후"}]',
       0, NULL),
      ('단일 수금 (100%)',
       '[{"name":"수금","ratio":100,"offset_days":30,"note":"납품 후 30일"}]',
       0, NULL)
    `);
    console.log('[payments:migration] 기본 템플릿 시드 완료');
  }

  // ⑤ 총계약금 + 품목내역 컬럼 추가 (Phase 1-B — idempotent)
  await pool.query(`
    ALTER TABLE payment_schedules
      ADD COLUMN IF NOT EXISTS contract_supply_amount DECIMAL(20,2) NULL
        COMMENT '총계약금(VAT별도)',
      ADD COLUMN IF NOT EXISTS items_json MEDIUMTEXT NULL
        COMMENT '품목 내역 JSON'
  `);

  // ⑥ 통화 단위 + 계약 기간 컬럼 추가 (수금 모달 재설계 — idempotent)
  //    model A(평면) 정책: 계약 단위 정보를 각 마일스톤 행에 비정규화 저장
  await pool.query(`
    ALTER TABLE payment_schedules
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'KRW'
        COMMENT '통화 단위 (KRW|USD|JPY|EUR|GBP|CNY|AUD ...)',
      ADD COLUMN IF NOT EXISTS contract_start_date DATE NULL
        COMMENT '계약 시작일 (계약 단위, 비정규화)',
      ADD COLUMN IF NOT EXISTS contract_end_date DATE NULL
        COMMENT '계약 종료일 (계약 단위, 비정규화)'
  `);

  // ⑧ 매출 예정/확정 (P1 계약확정 자동화 — 매출확정=세금계산서 발행 시점, idempotent)
  await pool.query(`
    ALTER TABLE payment_schedules
      ADD COLUMN IF NOT EXISTS revenue_status VARCHAR(20) NOT NULL DEFAULT '예정'
        COMMENT '매출 인식 상태 (예정|확정|취소)',
      ADD COLUMN IF NOT EXISTS recognized_at DATETIME NULL
        COMMENT '매출 확정 시각 (세금계산서 발행 시)'
  `);

  // ⑦ 연체 미수금 알림 (B1 — 일일 스캔 → 인앱/이메일 알림 + 이력)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_notifications (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id   INT NULL,
      contract_id   INT NULL,
      customer_name VARCHAR(200) NULL,
      kind          VARCHAR(20) DEFAULT 'overdue'  COMMENT 'overdue(연체)',
      overdue_days  INT NULL,
      amount        DECIMAL(20,2) NULL,
      channel       VARCHAR(20) DEFAULT 'inapp'    COMMENT 'inapp|email',
      recipient     VARCHAR(200) NULL,
      status        VARCHAR(20) DEFAULT 'unread'   COMMENT 'unread|read|sent|failed|pending',
      dedup_key     VARCHAR(150) NULL              COMMENT '중복 방지 (연체 건당 1회)',
      payload_json  TEXT NULL,
      sent_at       DATETIME NULL,
      read_at       DATETIME NULL,
      attempts      INT DEFAULT 0,
      last_error    VARCHAR(500) NULL,
      created_by    INT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dedup (dedup_key),
      INDEX idx_schedule (schedule_id),
      INDEX idx_status (status),
      INDEX idx_channel (channel)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('[payments:migration] 자가 마이그레이션 완료 (5개 테이블 + 5개 컬럼)');
}

runMigrations().catch(err => console.error('[payments:migration] 오류:', err));

// 연체 미수금 일일 알림 스케줄러 시작 (테스트 환경에서는 내부적으로 no-op)
paymentNotifier.startScheduler();

// ─── Feature guard ─────────────────────────────────────────────
router.use(requireFeature('crm.payments'));

// ─── 헬퍼 ─────────────────────────────────────────────────────
// 연체 상태 자동 갱신 (due_date 경과 + status = 'scheduled'|'invoiced')
async function syncOverdueStatus() {
  await pool.query(`
    UPDATE payment_schedules
       SET status = 'overdue'
     WHERE status IN ('scheduled','invoiced')
       AND due_date < CURDATE()
  `);
}

// 스케줄별 실제 수금 합계 계산
async function calcCollectedAmount(scheduleId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(paid_amount),0) AS total FROM payment_records WHERE schedule_id = ?`,
    [scheduleId]
  );
  return Number(row.total);
}

// ─── F5. 매출 대시보드 KPI ─────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    await syncOverdueStatus();

    const now = new Date();
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

    // 전체 수주잔액 (미수금 = 미수금+예정)
    const [[totalRow]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('scheduled','invoiced','partial') THEN scheduled_amount ELSE 0 END),0) AS outstanding_amount,
        COALESCE(SUM(CASE WHEN status = 'collected' THEN scheduled_amount ELSE 0 END),0)                        AS collected_amount,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN scheduled_amount ELSE 0 END),0)                          AS overdue_amount,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END)                                                          AS overdue_count,
        COALESCE(SUM(scheduled_amount),0)                                                                       AS total_scheduled
      FROM payment_schedules
    `);

    // 이번달 예정 수금
    const [[thisMonthRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(scheduled_amount),0) AS this_month_scheduled
      FROM payment_schedules
      WHERE due_date BETWEEN ? AND ?
        AND status IN ('scheduled','invoiced','partial')
    `,
      [thisMonthStart, thisMonthEnd]
    );

    // 월별 추이 (최근 6개월 예정 vs 실제)
    const [monthlyTrend] = await pool.query(`
      SELECT
        DATE_FORMAT(ps.due_date, '%Y-%m') AS month,
        SUM(ps.scheduled_amount)          AS scheduled,
        COALESCE(SUM(pr.paid_amount), 0)  AS collected
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
        AND DATE_FORMAT(pr.paid_date, '%Y-%m') = DATE_FORMAT(ps.due_date, '%Y-%m')
      WHERE ps.due_date >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
      GROUP BY DATE_FORMAT(ps.due_date, '%Y-%m')
      ORDER BY month ASC
    `);

    // 고객사별 미수금 TOP 5
    const [overdueByCustomer] = await pool.query(`
      SELECT customer_name,
             SUM(scheduled_amount) AS overdue_amount,
             COUNT(*) AS count
      FROM payment_schedules
      WHERE status = 'overdue'
        AND customer_name IS NOT NULL
      GROUP BY customer_name
      ORDER BY overdue_amount DESC
      LIMIT 5
    `);

    const total = Number(totalRow.total_scheduled) || 1; // 0 나눗셈 방지
    const rate = Math.round((Number(totalRow.collected_amount) / total) * 100);

    res.json({
      success: true,
      data: {
        kpi: {
          outstanding_amount: Number(totalRow.outstanding_amount),
          collected_amount: Number(totalRow.collected_amount),
          overdue_amount: Number(totalRow.overdue_amount),
          overdue_count: Number(totalRow.overdue_count),
          this_month_scheduled: Number(thisMonthRow.this_month_scheduled),
          collection_rate: rate,
        },
        monthly_trend: monthlyTrend,
        overdue_by_customer: overdueByCustomer,
      },
    });
  } catch (err) {
    console.error('[payments] dashboard 오류:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F5-2. AR aging (미수금 연령분석) [P4-A] ────────────────────
//   미수(잔여>0) 스케줄을 연체 경과일 버킷으로 집계 + 고객사별. 읽기전용.
router.get('/ar-aging', async (req, res) => {
  try {
    await syncOverdueStatus();
    const [rows] = await pool.query(`
      SELECT ps.id, ps.customer_id, ps.customer_name, ps.due_date,
             ps.scheduled_amount
               - COALESCE((SELECT SUM(pr.paid_amount) FROM payment_records pr WHERE pr.schedule_id = ps.id), 0)
               AS remaining,
             DATEDIFF(CURDATE(), ps.due_date) AS od
        FROM payment_schedules ps
       WHERE ps.status IN ('scheduled','invoiced','partial','overdue')
    `);
    const BKEYS = [
      { key: 'not_due', label: '미도래' },
      { key: 'd30', label: '1-30일' },
      { key: 'd60', label: '31-60일' },
      { key: 'd90', label: '61-90일' },
      { key: 'd90p', label: '90일+' },
    ];
    const bucketOf = od => {
      if (od <= 0) return 'not_due';
      if (od <= 30) return 'd30';
      if (od <= 60) return 'd60';
      if (od <= 90) return 'd90';
      return 'd90p';
    };
    const buckets = {};
    BKEYS.forEach(b => {
      buckets[b.key] = { key: b.key, label: b.label, amount: 0, count: 0 };
    });
    const custMap = {};
    let total = 0;
    for (const r of rows) {
      const rem = Number(r.remaining);
      if (!(rem > 0)) continue;
      const bk = bucketOf(Number(r.od));
      buckets[bk].amount += rem;
      buckets[bk].count += 1;
      total += rem;
      const cid = r.customer_id ? `id:${r.customer_id}` : `name:${r.customer_name || '-'}`;
      if (!custMap[cid]) {
        custMap[cid] = {
          customer_id: r.customer_id || null,
          customer_name: r.customer_name || '-',
          total: 0,
          not_due: 0,
          d30: 0,
          d60: 0,
          d90: 0,
          d90p: 0,
        };
      }
      custMap[cid][bk] += rem;
      custMap[cid].total += rem;
    }
    const by_customer = Object.values(custMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    res.json({
      success: true,
      data: { buckets: BKEYS.map(b => buckets[b.key]), total_outstanding: total, by_customer },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F6. 드릴다운 — 계약→프로젝트→매출(청구차수)→수금 흐름 [P4-B] ──
//   하나의 계약을 기준으로 연결된 프로젝트·매출 라인·수금 현황을 한 번에. 읽기전용.
router.get('/flow/:contractId', async (req, res) => {
  try {
    const cid = parseInt(req.params.contractId, 10);
    if (!cid) return res.status(400).json({ success: false, error: '유효한 계약 ID 필요' });

    const [[contract]] = await pool.query(`SELECT * FROM contracts WHERE id = ?`, [cid]);
    if (!contract)
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없습니다' });

    const [[project]] = await pool.query(
      `SELECT * FROM projects WHERE contract_id = ? ORDER BY id ASC LIMIT 1`,
      [cid]
    );

    const [schedules] = await pool.query(
      `SELECT ps.id, ps.stage_name, ps.stage_order, ps.scheduled_amount, ps.currency,
              ps.due_date, ps.status AS collect_status, ps.revenue_status,
              COALESCE((SELECT SUM(pr.paid_amount) FROM payment_records pr WHERE pr.schedule_id = ps.id), 0) AS paid_amount,
              (SELECT COUNT(*) FROM tax_invoices ti WHERE ti.schedule_id = ps.id AND ti.status = 'issued') AS issued_cnt
         FROM payment_schedules ps
        WHERE ps.contract_id = ?
        ORDER BY ps.stage_order ASC, ps.due_date ASC, ps.id ASC`,
      [cid]
    );

    let scheduled = 0;
    let collected = 0;
    let confirmed = 0;
    for (const s of schedules) {
      scheduled += Number(s.scheduled_amount) || 0;
      collected += Number(s.paid_amount) || 0;
      if (s.revenue_status === '확정') confirmed += Number(s.scheduled_amount) || 0;
    }

    res.json({
      success: true,
      data: {
        contract,
        project: project || null,
        schedules,
        totals: {
          scheduled,
          collected,
          outstanding: scheduled - collected,
          revenue_confirmed: confirmed,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F3. 미수금 목록 ───────────────────────────────────────────
router.get('/overdue', async (req, res) => {
  try {
    await syncOverdueStatus();
    const [rows] = await pool.query(`
      SELECT ps.*,
             DATEDIFF(CURDATE(), ps.due_date) AS overdue_days,
             COALESCE(SUM(pr.paid_amount), 0) AS paid_amount
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
      WHERE ps.status = 'overdue'
      GROUP BY ps.id
      ORDER BY ps.due_date ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── B1. 연체 미수금 알림 ─────────────────────────────────────
//   인앱 알림 목록 (unread 우선 + 최근순). ?status=unread|read 필터.
//   ※ '/:id' 패턴보다 먼저 정의해야 'notifications' 가 :id 로 잡히지 않음
router.get('/notifications', async (req, res) => {
  try {
    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    let where = `channel = 'inapp'`;
    if (status === 'unread') where += ` AND status = 'unread'`;
    else if (status === 'read') where += ` AND status = 'read'`;
    const [rows] = await pool.query(
      `SELECT * FROM payment_notifications
        WHERE ${where}
        ORDER BY (status = 'unread') DESC, created_at DESC
        LIMIT ?`,
      [limit]
    );
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS unread FROM payment_notifications
        WHERE channel = 'inapp' AND status = 'unread'`
    );
    res.json({ success: true, data: rows, unread_count: Number(cnt.unread) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   알림 읽음 처리 (단건 id 또는 'all')
router.put('/notifications/:id/read', async (req, res) => {
  try {
    const id = req.params.id;
    if (id === 'all') {
      await pool.query(
        `UPDATE payment_notifications SET status='read', read_at=NOW()
          WHERE channel='inapp' AND status='unread'`
      );
    } else {
      await pool.query(
        `UPDATE payment_notifications SET status='read', read_at=NOW()
          WHERE id = ? AND channel='inapp'`,
        [parseInt(id, 10)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   수동 연체 스캔 트리거 (관리/검증용)
router.post('/notifications/scan', async (req, res) => {
  try {
    const result = await paymentNotifier.scanOverdue();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 독촉(dunning) 단계 관리 [P3] ────────────────────────────
//   스키마 변경 0 — payment_notifications(kind 'dunning_*') + system_settings 재사용.
//   경로는 모두 '/dunning/*'(2-segment)로 GET '/:id' 충돌 회피.
//   내부 관리 중심: 인앱 알림 자동 + 고객 메일은 담당자 수동 발송(P3-C).

//   단계별 독촉 스캔 (도래 단계마다 인앱 알림 1회 — dedup)
router.post('/dunning/scan', async (req, res) => {
  try {
    const result = await dunningService.scanDunning();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   독촉 현황 — 현재 연체 스케줄 + 도래 단계(독촉 전 포함)
router.get('/dunning/list', async (req, res) => {
  try {
    const rows = await dunningService.listCurrent();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   단계별 집계 (KPI)
router.get('/dunning/summary', async (req, res) => {
  try {
    const data = await dunningService.summary();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   독촉 이력 (payment_notifications kind LIKE 'dunning%')
router.get('/dunning/history', async (req, res) => {
  try {
    const rows = await dunningService.listHistory({
      kind: req.query.kind,
      channel: req.query.channel,
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   단계 정책 조회/저장
router.get('/dunning/policy', async (req, res) => {
  try {
    const policy = await dunningService.getPolicy();
    res.json({ success: true, data: { policy, defaults: dunningService.DEFAULT_POLICY } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.put('/dunning/policy', async (req, res) => {
  try {
    const saved = await dunningService.setPolicy(req.body?.stages);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

//   메시지 템플릿 조회/저장
router.get('/dunning/templates', async (req, res) => {
  try {
    const templates = await dunningService.getTemplates();
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.put('/dunning/templates', async (req, res) => {
  try {
    const saved = await dunningService.setTemplates(req.body?.templates);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

//   독촉 메시지 미리보기 (schedule + kind → 렌더된 subject/body)
router.post('/dunning/preview', async (req, res) => {
  try {
    const { schedule_id, kind } = req.body || {};
    if (!schedule_id) return res.status(400).json({ success: false, error: 'schedule_id 필요' });
    const data = await dunningService.previewMessage(schedule_id, kind || 'dunning_1st');
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

//   독촉 메일 수동 발송 (담당자 검토 후) — outward-facing, 사용자 트리거 전용
router.post('/dunning/send', async (req, res) => {
  try {
    const { schedule_id, kind, to } = req.body || {};
    if (!schedule_id || !to)
      return res.status(400).json({ success: false, error: 'schedule_id, to(수신 이메일) 필요' });
    const data = await dunningService.sendDunning({
      scheduleId: schedule_id,
      kind: kind || 'dunning_1st',
      to,
      senderUserId: req.user?.id || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── 은행 거래내역 자동 매칭 (입금 자동화) ────────────────────
//   파일 파싱은 기존 POST /import/parse 재사용 → 프론트가 컬럼 매핑 후
//   구조화 행 [{date, amount, name, memo}] 을 /bank/match 로 전송.
//   매칭은 미수 스케줄과 금액·입금자명·예정일 근접도로 점수화(무스키마).
function _bankNormName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜|（주）/g, '')
    .replace(/[\s\-_.()]/g, '');
}
function _bankToNum(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function _bankDateDiff(a, b) {
  const da = new Date(String(a).slice(0, 10) + 'T00:00:00');
  const db = new Date(String(b).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 9999;
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}
function _bankScore(bank, sch) {
  const reasons = [];
  let score = 0;
  const remaining = Math.round(Number(sch.remaining));
  const scheduled = Math.round(Number(sch.scheduled_amount));
  const amt = Math.round(bank.amount);
  if (amt === remaining) {
    score += 100;
    reasons.push('잔액 정확 일치');
  } else if (amt === scheduled) {
    score += 90;
    reasons.push('예정액 일치');
  } else if (amt > 0 && amt <= remaining) {
    score += 40;
    reasons.push('부분 입금 가능');
  } else {
    score -= 50; // 초과 입금 — 비선호
  }
  const bn = _bankNormName(bank.name);
  const cn = _bankNormName(sch.customer_name);
  if (bn && cn) {
    if (bn === cn) {
      score += 50;
      reasons.push('입금자명 일치');
    } else if (bn.includes(cn) || cn.includes(bn)) {
      score += 30;
      reasons.push('입금자명 포함');
    }
  }
  if (bank.date && sch.due_date) {
    const d = _bankDateDiff(bank.date, sch.due_date);
    if (d <= 3) {
      score += 20;
      reasons.push('예정일 근접(±3일)');
    } else if (d <= 14) {
      score += 10;
      reasons.push('예정일 근접(±14일)');
    } else if (d <= 31) {
      score += 5;
    }
  }
  return { score, reasons };
}

//   POST /bank/match — 은행 행 → 미수 스케줄 자동 매칭(상위 후보 + 점수)
router.post('/bank/match', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length)
      return res.status(400).json({ success: false, error: 'rows 가 비어 있습니다' });

    await syncOverdueStatus();
    // 미수(잔액>0) 스케줄
    const [open] = await pool.query(`
      SELECT ps.id, ps.customer_name, ps.contract_name, ps.stage_name,
             ps.scheduled_amount, ps.due_date, ps.status,
             ps.scheduled_amount - COALESCE(SUM(pr.paid_amount), 0) AS remaining
        FROM payment_schedules ps
        LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
       WHERE ps.status IN ('scheduled','invoiced','partial','overdue')
       GROUP BY ps.id
      HAVING remaining > 0
    `);

    const matches = rows.map((r, i) => {
      const bank = {
        date: String(r.date || '').slice(0, 10),
        amount: _bankToNum(r.amount),
        name: String(r.name || '').slice(0, 100),
        memo: String(r.memo || '').slice(0, 200),
      };
      const candidates = open
        .map(s => {
          const { score, reasons } = _bankScore(bank, s);
          return {
            schedule_id: s.id,
            customer_name: s.customer_name,
            contract_name: s.contract_name,
            stage_name: s.stage_name,
            scheduled_amount: Number(s.scheduled_amount),
            remaining: Number(s.remaining),
            due_date: String(s.due_date || '').slice(0, 10),
            score,
            reasons,
            confidence: score >= 120 ? 'high' : score >= 60 ? 'medium' : 'low',
          };
        })
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const best = candidates[0] || null;
      return {
        row_index: i,
        bank,
        candidates,
        suggested_schedule_id: best ? best.schedule_id : null,
        suggested_amount: best ? Math.min(bank.amount, best.remaining) : bank.amount,
      };
    });
    const matched = matches.filter(m => m.suggested_schedule_id).length;
    res.json({
      success: true,
      data: {
        matches,
        summary: { total: matches.length, matched, unmatched: matches.length - matched },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

//   POST /bank/apply — 확정된 매칭 → payment_records 일괄 등록 + 상태 자동전환
router.post('/bank/apply', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const applies = Array.isArray(req.body?.applies) ? req.body.applies : [];
    if (!applies.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'applies 가 비어 있습니다' });
    }
    await conn.beginTransaction();
    const results = [];
    let created = 0;
    for (const a of applies) {
      const scheduleId = parseInt(a.schedule_id, 10);
      const paidAmount = _bankToNum(a.paid_amount);
      const paidDate = String(a.paid_date || '').slice(0, 10);
      if (!scheduleId || !(paidAmount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) continue;
      const [[sch]] = await conn.query(`SELECT * FROM payment_schedules WHERE id = ?`, [
        scheduleId,
      ]);
      if (!sch) continue;
      const payer = String(a.name || '').slice(0, 100);
      const memo = String(a.memo || '').slice(0, 100);
      const note = `[은행자동매칭] 입금자:${payer}${memo ? ' / ' + memo : ''}`.slice(0, 255);
      const [r] = await conn.query(
        `INSERT INTO payment_records
           (schedule_id, contract_id, customer_id, paid_amount, paid_date,
            payment_method, bank_account, reference_no, note, registered_by)
         VALUES (?,?,?,?,?, 'bank_transfer', ?, ?, ?, ?)`,
        [
          scheduleId,
          sch.contract_id,
          sch.customer_id,
          paidAmount,
          paidDate,
          payer || null,
          memo || null,
          note,
          req.user?.id || null,
        ]
      );
      const [[sumRow]] = await conn.query(
        `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM payment_records WHERE schedule_id = ?`,
        [scheduleId]
      );
      const collected = Number(sumRow.total);
      const scheduled = Number(sch.scheduled_amount);
      let newStatus = sch.status;
      if (collected >= scheduled) newStatus = 'collected';
      else if (collected > 0) newStatus = 'partial';
      if (newStatus !== sch.status)
        await conn.query(`UPDATE payment_schedules SET status = ? WHERE id = ?`, [
          newStatus,
          scheduleId,
        ]);
      created++;
      results.push({
        schedule_id: scheduleId,
        record_id: r.insertId,
        new_status: newStatus,
        collected,
      });
    }
    await conn.commit();
    res.json({ success: true, data: { created, results } });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── F4. 세금계산서 목록 ──────────────────────────────────────
router.get('/tax-invoices', async (req, res) => {
  try {
    const { status, contract_id } = req.query;
    let sql = `SELECT ti.*, c.contract_no FROM tax_invoices ti
               LEFT JOIN contracts c ON c.id = ti.contract_id
               WHERE 1=1`;
    const params = [];
    if (status) {
      sql += ` AND ti.status = ?`;
      params.push(status);
    }
    if (contract_id) {
      sql += ` AND ti.contract_id = ?`;
      params.push(Number(contract_id));
    }
    sql += ` ORDER BY ti.created_at DESC LIMIT 200`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 세금계산서 생성 (draft)
router.post('/tax-invoices', async (req, res) => {
  try {
    const {
      schedule_id,
      contract_id,
      customer_id,
      customer_name,
      invoice_no,
      supply_amount,
      tax_amount,
      issue_date,
      note,
    } = req.body;
    if (!supply_amount)
      return res.status(400).json({ success: false, error: 'supply_amount 필수' });
    const total = Number(supply_amount) + Number(tax_amount || 0);
    const [result] = await pool.query(
      `
      INSERT INTO tax_invoices
        (schedule_id, contract_id, customer_id, customer_name, invoice_no,
         supply_amount, tax_amount, total_amount, issue_date, status, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,  'draft', ?,?)
    `,
      [
        schedule_id || null,
        contract_id || null,
        customer_id || null,
        customer_name || null,
        invoice_no || null,
        supply_amount,
        tax_amount || 0,
        total,
        issue_date || null,
        note || null,
        req.user?.id || null,
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 홈택스 가져오기: 파일 파싱 (csv/xlsx → headers/rows, 위치 기반) ──
//   헤더 중복('상호' 2개 등) 대응 위해 객체키가 아닌 컬럼 배열로 반환. DB 미저장(파싱만).
router.post('/import/parse', uploadMem.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '파일이 없습니다' });
    const name = (req.file.originalname || '').toLowerCase();
    const wb = new ExcelJS.Workbook();
    if (name.endsWith('.csv')) {
      await wb.csv.read(Readable.from(req.file.buffer));
    } else {
      await wb.xlsx.load(req.file.buffer);
    }
    const ws = wb.worksheets[0];
    if (!ws) return res.json({ success: true, data: { headers: [], rows: [] } });

    const colCount = ws.columnCount || 0;
    const cellText = val => {
      if (val === null || val === undefined) return '';
      if (val instanceof Date) {
        // 로컬 날짜 컴포넌트 사용 (toISOString 은 UTC 변환으로 KST 에서 하루 당겨짐)
        const pad = x => String(x).padStart(2, '0');
        return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
      }
      if (typeof val === 'object') {
        if (val.text !== undefined) return String(val.text);
        if (val.result !== undefined) return String(val.result);
        return '';
      }
      return String(val);
    };
    const headerRow = ws.getRow(1);
    const headers = [];
    for (let c = 1; c <= colCount; c++) headers.push(cellText(headerRow.getCell(c).value).trim());

    const rows = [];
    const maxRow = Math.min(ws.rowCount, 501); // 헤더 + 최대 500행
    for (let r = 2; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const arr = [];
      let hasAny = false;
      for (let c = 1; c <= colCount; c++) {
        const t = cellText(row.getCell(c).value).trim();
        if (t) hasAny = true;
        arr.push(t);
      }
      if (hasAny) rows.push(arr);
    }
    res.json({ success: true, data: { headers, rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: '파일 파싱 실패: ' + err.message });
  }
});

// ─── 홈택스 가져오기: 매핑된 행 일괄 등록 (tax_invoices, status=issued) ──
//   중복(invoice_no=승인번호)은 스킵. 행 단위 검증(공급가액 필수·발행일 4자리연도).
router.post('/tax-invoices/bulk', async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const invalid = validateRequest(rows); // 행 수 제한(200) + 빈 배열 검사
  if (invalid) return res.status(invalid.status).json({ success: false, error: invalid.message });

  const conn = await pool.getConnection();
  try {
    // 기존 발행번호 조회 (중복 스킵)
    const incomingNos = [
      ...new Set(rows.map(r => String((r && r.invoice_no) || '').trim()).filter(Boolean)),
    ];
    let existingNos = new Set();
    if (incomingNos.length) {
      const [ex] = await conn.query('SELECT invoice_no FROM tax_invoices WHERE invoice_no IN (?)', [
        incomingNos,
      ]);
      existingNos = new Set(ex.map(e => String(e.invoice_no)));
    }

    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const seen = new Set();
    const errors = [];
    let created = 0;
    let duplicates = 0;

    await conn.beginTransaction();
    for (let i = 0; i < rows.length; i++) {
      try {
        const r = rows[i] || {};
        const customer_name = sanitizeCell(r.customer_name) || null;
        const invoice_no = (sanitizeCell(r.invoice_no) || '').trim() || null;
        const note = sanitizeCell(r.note) || null;
        const supply = Number(r.supply_amount);
        const tax = Number(r.tax_amount || 0);
        const issue_date =
          String(r.issue_date || '')
            .trim()
            .slice(0, 10) || null;

        if (!supply || isNaN(supply)) {
          errors.push({ row: i + 1, reason: '공급가액 누락/숫자 아님' });
          continue;
        }
        if (issue_date && !YMD.test(issue_date)) {
          errors.push({ row: i + 1, reason: '발행일 형식(YYYY-MM-DD) 오류' });
          continue;
        }
        if (invoice_no && (existingNos.has(invoice_no) || seen.has(invoice_no))) {
          duplicates++;
          continue;
        }
        if (invoice_no) seen.add(invoice_no);

        await conn.query(
          `INSERT INTO tax_invoices
             (customer_name, invoice_no, supply_amount, tax_amount, total_amount,
              issue_date, status, issued_at, note, created_by)
           VALUES (?,?,?,?,?,?, 'issued', NOW(), ?,?)`,
          [
            customer_name,
            invoice_no,
            supply,
            tax,
            supply + tax,
            issue_date,
            note,
            req.user?.id || null,
          ]
        );
        created++;
      } catch (e) {
        errors.push({
          row: i + 1,
          reason: e.code === 'SECURITY_VIOLATION' ? '보안 위반 셀' : e.message,
        });
      }
    }
    await conn.commit();
    res.json({ success: true, data: { created, duplicates, errors } });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// 세금계산서 수정 + 상태 전환 (바로빌 키 없이 수동 상태 관리)
//   상태: draft(작성중) → requested(발행요청) → issued(발행완료) → cancelled(취소)
//   ※ issued 는 수동 발행 기록 — 바로빌 자동발행/국세청 전송(Phase 2 키 단계)이 아님
const ALLOWED_TAX_FIELDS = [
  'schedule_id',
  'contract_id',
  'customer_id',
  'customer_name',
  'invoice_no',
  'supply_amount',
  'tax_amount',
  'issue_date',
  'status',
  'note',
];
const TAX_STATUSES = ['draft', 'requested', 'issued', 'cancelled'];

// P2 매출확정 동기화 — 매출확정 = 세금계산서 발행(issued) 시점.
//   schedule 에 'issued' 세금계산서가 있으면 revenue_status='확정'(발행시각 기록),
//   없으면(취소 등) '확정'→'예정' 복귀. '취소' 매출은 보존. 멱등.
async function _syncScheduleRevenue(scheduleId) {
  if (!scheduleId) return;
  const [[r]] = await pool.query(
    `SELECT MIN(COALESCE(issued_at, CONCAT(issue_date, ' 00:00:00'))) AS recog
       FROM tax_invoices WHERE schedule_id = ? AND status = 'issued'`,
    [scheduleId]
  );
  if (r && r.recog) {
    await pool.query(
      `UPDATE payment_schedules SET revenue_status = '확정', recognized_at = COALESCE(recognized_at, ?)
        WHERE id = ? AND revenue_status <> '취소'`,
      [r.recog, scheduleId]
    );
  } else {
    await pool.query(
      `UPDATE payment_schedules SET revenue_status = '예정', recognized_at = NULL
        WHERE id = ? AND revenue_status = '확정'`,
      [scheduleId]
    );
  }
}

router.put('/tax-invoices/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[existing]] = await pool.query(`SELECT * FROM tax_invoices WHERE id = ?`, [id]);
    if (!existing)
      return res.status(404).json({ success: false, error: '세금계산서를 찾을 수 없습니다' });

    const updates = {};
    for (const k of ALLOWED_TAX_FIELDS) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.status !== undefined && !TAX_STATUSES.includes(updates.status))
      return res.status(400).json({ success: false, error: '허용되지 않은 상태값입니다' });
    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: '변경 필드 없음' });

    // 공급가/세액 변경 시 합계 재계산
    if (updates.supply_amount !== undefined || updates.tax_amount !== undefined) {
      const supply =
        updates.supply_amount !== undefined
          ? Number(updates.supply_amount)
          : Number(existing.supply_amount);
      const tax =
        updates.tax_amount !== undefined ? Number(updates.tax_amount) : Number(existing.tax_amount);
      updates.total_amount = supply + tax;
    }

    // 발행완료(issued) 전환 시 발행시각 자동 기록 (수동 발행 기록)
    let extraSet = '';
    if (updates.status === 'issued' && !existing.issued_at) {
      extraSet = ', issued_at = NOW()';
      if (!existing.issue_date && updates.issue_date === undefined) {
        updates.issue_date = new Date().toISOString().slice(0, 10); // DATE 컬럼 (YYYY-MM-DD)
      }
    }

    const sets = Object.keys(updates)
      .map(k => `${k} = ?`)
      .join(', ');
    await pool.query(`UPDATE tax_invoices SET ${sets}${extraSet} WHERE id = ?`, [
      ...Object.values(updates),
      id,
    ]);

    // 발행완료(issued) 전환 + 연결된 수금 스케줄이 있으면 → 스케줄 상태 '청구(invoiced)' 자동 전환
    //   (예정 단계만 승급. 부분수금/수금완료/연체/대손은 보존)
    if (updates.status === 'issued' && existing.schedule_id) {
      await pool.query(
        `UPDATE payment_schedules SET status = 'invoiced' WHERE id = ? AND status = 'scheduled'`,
        [existing.schedule_id]
      );
    }

    // P2: 발행(issued)/취소(cancelled) → 매출확정(revenue_status) 동기화
    if (updates.status !== undefined && existing.schedule_id) {
      await _syncScheduleRevenue(existing.schedule_id);
    }

    res.json({ success: true, data: { id, status: updates.status || existing.status } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 세금계산서 삭제 (발행완료 건은 이력 보존 — 삭제 차단)
router.delete('/tax-invoices/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[existing]] = await pool.query(`SELECT status FROM tax_invoices WHERE id = ?`, [id]);
    if (!existing)
      return res.status(404).json({ success: false, error: '세금계산서를 찾을 수 없습니다' });
    if (existing.status === 'issued')
      return res
        .status(400)
        .json({ success: false, error: '발행완료된 세금계산서는 삭제할 수 없습니다' });
    await pool.query(`DELETE FROM tax_invoices WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 비율 템플릿 ──────────────────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM payment_templates ORDER BY is_default DESC, id ASC`
    );
    const parsed = rows.map(r => ({ ...r, stages: JSON.parse(r.stages_json || '[]') }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, stages } = req.body;
    if (!name || !stages?.length)
      return res.status(400).json({ success: false, error: 'name, stages 필수' });
    const [result] = await pool.query(
      `INSERT INTO payment_templates (name, stages_json, created_by) VALUES (?,?,?)`,
      [name, JSON.stringify(stages), req.user?.id || null]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 설정 (품목유형 + 기본 통화) — system_settings key-value ──
//    supplier-info 패턴 동일. 페이지(team_lead+) 에서 직접 관리 가능.
const PAYMENT_STAGE_TYPES_KEY = 'payment_stage_types';
const PAYMENT_DEFAULT_CUR_KEY = 'payment_default_currency';
const PAYMENT_NOTIFY_EMAIL_KEY = 'payment_overdue_notify_email'; // 연체 알림 수신 재무팀 메일
const DEFAULT_STAGE_TYPES = ['착수금', '중도금', '잔금', '기타'];
const DEFAULT_CURRENCY = 'KRW';
const ALLOWED_CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'AUD', 'SGD', 'HKD', 'VND'];

router.get('/config', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?, ?)`,
      [PAYMENT_STAGE_TYPES_KEY, PAYMENT_DEFAULT_CUR_KEY, PAYMENT_NOTIFY_EMAIL_KEY]
    );
    const map = {};
    rows.forEach(r => {
      map[r.setting_key] = r.setting_value;
    });

    let stageTypes = DEFAULT_STAGE_TYPES;
    if (map[PAYMENT_STAGE_TYPES_KEY]) {
      try {
        const parsed = JSON.parse(map[PAYMENT_STAGE_TYPES_KEY]);
        if (Array.isArray(parsed) && parsed.length) {
          stageTypes = parsed.map(s => String(s).slice(0, 50)).filter(Boolean);
        }
      } catch (_e) {
        /* 손상된 값 — 기본값 사용 */
      }
    }
    const defaultCurrency = ALLOWED_CURRENCIES.includes(map[PAYMENT_DEFAULT_CUR_KEY])
      ? map[PAYMENT_DEFAULT_CUR_KEY]
      : DEFAULT_CURRENCY;

    res.json({
      success: true,
      data: {
        stage_types: stageTypes,
        default_currency: defaultCurrency,
        allowed_currencies: ALLOWED_CURRENCIES,
        notify_email: map[PAYMENT_NOTIFY_EMAIL_KEY] || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    const { stage_types, default_currency, notify_email } = req.body || {};
    const updates = [];

    if (stage_types !== undefined) {
      if (!Array.isArray(stage_types) || !stage_types.length)
        return res
          .status(400)
          .json({ success: false, error: 'stage_types 는 비어있지 않은 배열이어야 합니다' });
      const cleaned = [
        ...new Set(
          stage_types
            .map(s =>
              String(s || '')
                .trim()
                .slice(0, 50)
            )
            .filter(Boolean)
        ),
      ];
      if (!cleaned.length)
        return res.status(400).json({ success: false, error: '유효한 품목유형이 없습니다' });
      updates.push([PAYMENT_STAGE_TYPES_KEY, JSON.stringify(cleaned)]);
    }
    if (default_currency !== undefined) {
      if (!ALLOWED_CURRENCIES.includes(default_currency))
        return res.status(400).json({ success: false, error: '허용되지 않은 통화 코드입니다' });
      updates.push([PAYMENT_DEFAULT_CUR_KEY, default_currency]);
    }
    if (notify_email !== undefined) {
      const email = String(notify_email || '').trim();
      // 빈 문자열 → 알림 해제(설정 제거). 값이 있으면 형식 검증.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ success: false, error: '유효한 이메일 형식이 아닙니다' });
      updates.push([PAYMENT_NOTIFY_EMAIL_KEY, email]);
    }
    if (!updates.length)
      return res.status(400).json({ success: false, error: '저장할 항목이 없습니다' });

    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 스케줄 일괄 저장 (계약 1건 → 마일스톤 N행) ────────────
//    model A(평면): shared(계약 단위) 정보를 각 마일스톤 행에 비정규화.
//    create + update(upsert) + delete 를 1 트랜잭션으로 원자 처리.
router.post('/batch', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { shared = {}, milestones = [], delete_ids = [] } = req.body || {};

    const customerName = String(shared.customer_name || '').trim();
    if (!customerName) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '고객사명(customer_name)은 필수입니다' });
    }
    if (!Array.isArray(milestones)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'milestones 는 배열이어야 합니다' });
    }
    const delIds = (Array.isArray(delete_ids) ? delete_ids : [])
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n > 0);
    if (!milestones.length && !delIds.length) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '저장할 마일스톤이 없습니다' });
    }

    // 계약 단위 비정규화 공통 필드
    const currency = ALLOWED_CURRENCIES.includes(shared.currency) ? shared.currency : 'KRW';
    const sharedCols = {
      contract_id: shared.contract_id || null,
      customer_id: shared.customer_id || null,
      customer_name: customerName,
      contract_name: shared.contract_name ? String(shared.contract_name).slice(0, 200) : null,
      contract_supply_amount:
        shared.contract_supply_amount !== null &&
        shared.contract_supply_amount !== undefined &&
        shared.contract_supply_amount !== ''
          ? Number(shared.contract_supply_amount)
          : null,
      currency,
      contract_start_date: shared.contract_start_date || null,
      contract_end_date: shared.contract_end_date || null,
    };

    // ── 날짜 유효성 검사 (프론트와 동일 규칙을 서버에서도 방어적으로 검증) ──
    //   ① 계약 시작/종료일 연도 4자리  ② 수금예정일 ≥ 계약 시작일
    //   ③ 단계 순서: 착수금 ≤ 중도금 ≤ 잔금 (기본 유형에 한함)
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const startDate = sharedCols.contract_start_date
      ? String(sharedCols.contract_start_date).slice(0, 10)
      : null;
    const endDate = sharedCols.contract_end_date
      ? String(sharedCols.contract_end_date).slice(0, 10)
      : null;
    if (startDate && !YMD.test(startDate)) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '계약 시작일의 연도는 4자리여야 합니다' });
    }
    if (endDate && !YMD.test(endDate)) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '계약 종료일의 연도는 4자리여야 합니다' });
    }
    const downArr = [],
      interimArr = [],
      finalArr = [];
    for (let i = 0; i < milestones.length; i++) {
      const raw = milestones[i] && milestones[i].due_date ? String(milestones[i].due_date) : '';
      const dd = raw.slice(0, 10);
      if (!dd) continue; // due_date 필수 검증은 아래 upsert 루프에서 처리
      if (!YMD.test(dd)) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          error: `${i + 1}번째 마일스톤: 수금예정일의 연도는 4자리여야 합니다`,
        });
      }
      if (startDate && YMD.test(startDate) && dd < startDate) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          error: `${i + 1}번째 마일스톤: 수금예정일은 계약 시작일 이후여야 합니다`,
        });
      }
      const sn = String(milestones[i].stage_name || '').trim();
      if (sn === '착수금') downArr.push(dd);
      else if (sn === '중도금') interimArr.push(dd);
      else if (sn === '잔금') finalArr.push(dd);
    }
    downArr.sort();
    interimArr.sort();
    finalArr.sort();
    const downMax = downArr.length ? downArr[downArr.length - 1] : null;
    const interimMin = interimArr.length ? interimArr[0] : null;
    const interimMax = interimArr.length ? interimArr[interimArr.length - 1] : null;
    const finalMin = finalArr.length ? finalArr[0] : null;
    if (downMax && interimMin && interimMin < downMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '중도금 수금예정일은 착수금보다 빠를 수 없습니다' });
    }
    if (downMax && finalMin && finalMin < downMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '잔금 수금예정일은 착수금보다 빠를 수 없습니다' });
    }
    if (interimMax && finalMin && finalMin < interimMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '잔금 수금예정일은 중도금보다 빠를 수 없습니다' });
    }

    // 1) 삭제 (제거된 마일스톤) — 입금기록도 함께 정리
    let deleted = 0;
    if (delIds.length) {
      const ph = delIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM payment_records WHERE schedule_id IN (${ph})`, delIds);
      const [r] = await conn.query(`DELETE FROM payment_schedules WHERE id IN (${ph})`, delIds);
      deleted = r.affectedRows || 0;
    }

    // 2) upsert (id 있으면 UPDATE, 없으면 INSERT)
    const createdIds = [];
    let updated = 0;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i] || {};
      const stageName = String(m.stage_name || '').trim();
      if (!stageName) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금품목유형(stage_name) 필수` });
      }
      if (!m.due_date) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금예정일(due_date) 필수` });
      }
      const supply = Number(m.supply_amount) || 0;
      const tax =
        m.tax_amount !== null && m.tax_amount !== undefined
          ? Number(m.tax_amount)
          : Math.round(supply * 0.1);
      const scheduled =
        m.scheduled_amount !== null && m.scheduled_amount !== undefined
          ? Number(m.scheduled_amount)
          : supply + tax;
      if (!scheduled) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금예정액 필수` });
      }
      const ratio =
        m.ratio !== null && m.ratio !== undefined && m.ratio !== '' ? Number(m.ratio) : null;
      const stageOrder = i + 1;
      const note = m.note ? String(m.note).slice(0, 2000) : null;

      const existingId = parseInt(m.id, 10);
      if (Number.isInteger(existingId) && existingId > 0) {
        await conn.query(
          `UPDATE payment_schedules SET
             contract_id=?, customer_id=?, customer_name=?, contract_name=?,
             contract_supply_amount=?, currency=?, contract_start_date=?, contract_end_date=?,
             stage_name=?, stage_order=?, ratio=?,
             scheduled_amount=?, supply_amount=?, tax_amount=?, due_date=?, note=?
           WHERE id=?`,
          [
            sharedCols.contract_id,
            sharedCols.customer_id,
            sharedCols.customer_name,
            sharedCols.contract_name,
            sharedCols.contract_supply_amount,
            sharedCols.currency,
            sharedCols.contract_start_date,
            sharedCols.contract_end_date,
            stageName,
            stageOrder,
            ratio,
            scheduled,
            supply,
            tax,
            m.due_date,
            note,
            existingId,
          ]
        );
        updated++;
      } else {
        const [result] = await conn.query(
          `INSERT INTO payment_schedules
             (contract_id, customer_id, customer_name, contract_name,
              contract_supply_amount, currency, contract_start_date, contract_end_date,
              stage_name, stage_order, ratio,
              scheduled_amount, supply_amount, tax_amount, due_date, status, note, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?,?)`,
          [
            sharedCols.contract_id,
            sharedCols.customer_id,
            sharedCols.customer_name,
            sharedCols.contract_name,
            sharedCols.contract_supply_amount,
            sharedCols.currency,
            sharedCols.contract_start_date,
            sharedCols.contract_end_date,
            stageName,
            stageOrder,
            ratio,
            scheduled,
            supply,
            tax,
            m.due_date,
            note,
            req.user?.id || null,
          ]
        );
        createdIds.push(result.insertId);
      }
    }

    await conn.commit();
    res.json({
      success: true,
      data: { created: createdIds.length, updated, deleted, ids: createdIds },
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── F1. 수금 스케줄 목록 ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await syncOverdueStatus();
    const { status, contract_id, customer_id, due_from, due_to, search } = req.query;
    let sql = `
      SELECT ps.*,
             COALESCE(SUM(pr.paid_amount), 0) AS paid_amount,
             c.contract_no,
             c.title           AS contract_title,
             c.customer_name   AS linked_customer_name,
             c.contract_amount AS contract_amount
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
      LEFT JOIN contracts c ON c.id = ps.contract_id
      WHERE 1=1`;
    const params = [];
    if (status) {
      sql += ` AND ps.status = ?`;
      params.push(status);
    }
    if (contract_id) {
      sql += ` AND ps.contract_id = ?`;
      params.push(Number(contract_id));
    }
    if (customer_id) {
      sql += ` AND ps.customer_id = ?`;
      params.push(Number(customer_id));
    }
    if (due_from) {
      sql += ` AND ps.due_date >= ?`;
      params.push(due_from);
    }
    if (due_to) {
      sql += ` AND ps.due_date <= ?`;
      params.push(due_to);
    }
    if (search) {
      sql += ` AND (ps.customer_name LIKE ? OR ps.contract_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` GROUP BY ps.id ORDER BY ps.due_date ASC LIMIT 500`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금현황 엑셀 내보내기 (현재 필터 반영, .xlsx) ───────────
router.get('/export', async (req, res) => {
  try {
    await syncOverdueStatus();
    const { status, contract_id, customer_id, due_from, due_to, search } = req.query;
    let sql = `
      SELECT ps.*, COALESCE(SUM(pr.paid_amount),0) AS paid_amount, c.contract_no
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
      LEFT JOIN contracts c ON c.id = ps.contract_id
      WHERE 1=1`;
    const params = [];
    if (status) {
      sql += ` AND ps.status = ?`;
      params.push(status);
    }
    if (contract_id) {
      sql += ` AND ps.contract_id = ?`;
      params.push(Number(contract_id));
    }
    if (customer_id) {
      sql += ` AND ps.customer_id = ?`;
      params.push(Number(customer_id));
    }
    if (due_from) {
      sql += ` AND ps.due_date >= ?`;
      params.push(due_from);
    }
    if (due_to) {
      sql += ` AND ps.due_date <= ?`;
      params.push(due_to);
    }
    if (search) {
      sql += ` AND (ps.customer_name LIKE ? OR ps.contract_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` GROUP BY ps.id ORDER BY ps.due_date ASC LIMIT 5000`;
    const [rows] = await pool.query(sql, params);

    const LABEL = {
      scheduled: '예정',
      invoiced: '청구',
      partial: '부분수금',
      collected: '수금완료',
      overdue: '연체',
      written_off: '대손처리',
    };
    const data = rows.map(r => {
      const sch = Number(r.scheduled_amount || 0);
      const paid = Number(r.paid_amount || 0);
      return {
        customer_name: r.customer_name || '',
        contract_name: r.contract_name || r.contract_no || '',
        stage_name: r.stage_name || '',
        currency: r.currency || 'KRW',
        scheduled_amount: sch,
        supply_amount: r.supply_amount ?? '',
        tax_amount: r.tax_amount ?? '',
        paid_amount: paid,
        due_date: r.due_date ? String(r.due_date).slice(0, 10) : '',
        status: LABEL[r.status] || r.status || '',
        progress_pct: sch > 0 ? Math.min(Math.round((paid / sch) * 100), 100) : 0,
        note: r.note || '',
      };
    });
    const columns = [
      { key: 'customer_name', label: '고객사' },
      { key: 'contract_name', label: '계약/프로젝트' },
      { key: 'stage_name', label: '단계' },
      { key: 'currency', label: '통화' },
      { key: 'scheduled_amount', label: '수금예정액' },
      { key: 'supply_amount', label: '공급가액' },
      { key: 'tax_amount', label: '세액' },
      { key: 'paid_amount', label: '수금액' },
      { key: 'due_date', label: '수금예정일' },
      { key: 'status', label: '상태' },
      { key: 'progress_pct', label: '진행률(%)' },
      { key: 'note', label: '비고' },
    ];
    const buffer = await toExcelBuffer(columns, data, '수금현황');
    sendExcel(res, buffer, `수금현황_${new Date().toISOString().slice(0, 10)}`);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 수금 스케줄 생성 ─────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      contract_id,
      customer_id,
      customer_name,
      contract_name,
      stage_name,
      stage_order,
      ratio,
      contract_supply_amount,
      scheduled_amount,
      supply_amount,
      tax_amount,
      due_date,
      invoice_date,
      note,
      items_json,
    } = req.body;
    if (!stage_name || !scheduled_amount || !due_date)
      return res
        .status(400)
        .json({ success: false, error: 'stage_name, scheduled_amount, due_date 필수' });

    const [result] = await pool.query(
      `
      INSERT INTO payment_schedules
        (contract_id, customer_id, customer_name, contract_name,
         stage_name, stage_order, ratio, contract_supply_amount,
         scheduled_amount, supply_amount, tax_amount,
         due_date, invoice_date, status, note, items_json, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?,?,?)
    `,
      [
        contract_id || null,
        customer_id || null,
        customer_name || null,
        contract_name || null,
        stage_name,
        stage_order || 1,
        ratio || null,
        contract_supply_amount || null,
        scheduled_amount,
        supply_amount || null,
        tax_amount || 0,
        due_date,
        invoice_date || null,
        note || null,
        items_json || null,
        req.user?.id || null,
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 계약 → 수금 스케줄 자동 생성 ────────────────────────────
router.post('/from-contract/:contractId', async (req, res) => {
  try {
    const contractId = parseInt(req.params.contractId, 10);
    const { template_id, stages } = req.body; // stages: [{name, ratio, due_date, note}]

    // 계약 정보 조회
    const [[contract]] = await pool.query(
      `SELECT c.*, cu.name AS customer_name
       FROM contracts c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       WHERE c.id = ?`,
      [contractId]
    );
    if (!contract)
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없습니다' });

    // 템플릿 or 직접 stages 사용
    let stageList = stages;
    if (!stageList?.length && template_id) {
      const [[tmpl]] = await pool.query(`SELECT stages_json FROM payment_templates WHERE id = ?`, [
        template_id,
      ]);
      stageList = tmpl ? JSON.parse(tmpl.stages_json) : [];
    }
    if (!stageList?.length)
      return res.status(400).json({ success: false, error: 'stages 또는 template_id 필수' });

    const totalAmount = Number(contract.contract_amount) || 0;
    const insertIds = [];
    for (let i = 0; i < stageList.length; i++) {
      const s = stageList[i];
      const amount = s.amount || Math.round((totalAmount * (s.ratio || 0)) / 100);
      const supplyAmt = Math.round(amount / 1.1);
      const taxAmt = amount - supplyAmt;
      const [result] = await pool.query(
        `
        INSERT INTO payment_schedules
          (contract_id, customer_id, customer_name, contract_name,
           stage_name, stage_order, ratio,
           scheduled_amount, supply_amount, tax_amount,
           due_date, status, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,  'scheduled', ?,?)
      `,
        [
          contractId,
          contract.customer_id || null,
          contract.customer_name || null,
          contract.title || contract.contract_no,
          s.name,
          i + 1,
          s.ratio || null,
          amount,
          supplyAmt,
          taxAmt,
          s.due_date,
          s.note || null,
          req.user?.id || null,
        ]
      );
      insertIds.push(result.insertId);
    }
    res.json({ success: true, data: { created: insertIds.length, ids: insertIds } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 상세 ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[schedule]] = await pool.query(
      `SELECT ps.*, COALESCE(SUM(pr.paid_amount),0) AS paid_amount, c.contract_no
       FROM payment_schedules ps
       LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
       LEFT JOIN contracts c ON c.id = ps.contract_id
       WHERE ps.id = ?
       GROUP BY ps.id`,
      [id]
    );
    if (!schedule)
      return res.status(404).json({ success: false, error: '스케줄을 찾을 수 없습니다' });

    const [records] = await pool.query(
      `SELECT * FROM payment_records WHERE schedule_id = ? ORDER BY paid_date DESC`,
      [id]
    );
    // 연동(수금→계산서): 이 스케줄에 연결된 세금계산서 목록 (양방향 연동)
    const [tax_invoices] = await pool.query(
      `SELECT * FROM tax_invoices WHERE schedule_id = ? ORDER BY created_at DESC`,
      [id]
    );
    res.json({ success: true, data: { ...schedule, records, tax_invoices } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 수정 ──────────────────────────────────────────
const ALLOWED_SCHEDULE_FIELDS = [
  'contract_id',
  'customer_id',
  'stage_name',
  'stage_order',
  'ratio',
  'contract_supply_amount',
  'scheduled_amount',
  'supply_amount',
  'tax_amount',
  'due_date',
  'invoice_date',
  'status',
  'note',
  'customer_name',
  'contract_name',
  'items_json',
  'currency',
  'contract_start_date',
  'contract_end_date',
];

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updates = {};
    for (const k of ALLOWED_SCHEDULE_FIELDS) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: '변경 필드 없음' });

    const sets = Object.keys(updates)
      .map(k => `${k} = ?`)
      .join(', ');
    await pool.query(`UPDATE payment_schedules SET ${sets} WHERE id = ?`, [
      ...Object.values(updates),
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 삭제 ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM payment_records WHERE schedule_id = ?`, [id]);
    await pool.query(`DELETE FROM payment_schedules WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 실제 입금 등록 ───────────────────────────────────────
router.post('/:id/records', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    const { paid_amount, paid_date, payment_method, bank_account, reference_no, note } = req.body;
    if (!paid_amount || !paid_date)
      return res.status(400).json({ success: false, error: 'paid_amount, paid_date 필수' });

    // 스케줄 정보 조회
    const [[schedule]] = await pool.query(`SELECT * FROM payment_schedules WHERE id = ?`, [
      scheduleId,
    ]);
    if (!schedule)
      return res.status(404).json({ success: false, error: '스케줄을 찾을 수 없습니다' });

    const [result] = await pool.query(
      `
      INSERT INTO payment_records
        (schedule_id, contract_id, customer_id,
         paid_amount, paid_date, payment_method,
         bank_account, reference_no, note, registered_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `,
      [
        scheduleId,
        schedule.contract_id,
        schedule.customer_id,
        paid_amount,
        paid_date,
        payment_method || 'bank_transfer',
        bank_account || null,
        reference_no || null,
        note || null,
        req.user?.id || null,
      ]
    );

    // 수금 상태 자동 갱신
    const collected = await calcCollectedAmount(scheduleId);
    const scheduled = Number(schedule.scheduled_amount);
    let newStatus = schedule.status;
    if (collected >= scheduled) {
      newStatus = 'collected';
    } else if (collected > 0) {
      newStatus = 'partial';
    }
    if (newStatus !== schedule.status) {
      await pool.query(`UPDATE payment_schedules SET status = ? WHERE id = ?`, [
        newStatus,
        scheduleId,
      ]);
    }

    res.json({ success: true, data: { id: result.insertId, new_status: newStatus, collected } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 입금 이력 조회 ───────────────────────────────────────
router.get('/:id/records', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT * FROM payment_records WHERE schedule_id = ? ORDER BY paid_date DESC`,
      [scheduleId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 입금 기록 삭제 (오입력 정정) ─────────────────────────
router.delete('/:id/records/:rid', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM payment_records WHERE id = ? AND schedule_id = ?`, [
      parseInt(req.params.rid, 10),
      scheduleId,
    ]);

    // 상태 재계산
    const [[schedule]] = await pool.query(`SELECT * FROM payment_schedules WHERE id = ?`, [
      scheduleId,
    ]);
    if (schedule) {
      const collected = await calcCollectedAmount(scheduleId);
      const scheduled = Number(schedule.scheduled_amount);
      let newStatus = 'scheduled';
      if (collected >= scheduled) newStatus = 'collected';
      else if (collected > 0) newStatus = 'partial';
      await pool.query(`UPDATE payment_schedules SET status = ? WHERE id = ?`, [
        newStatus,
        scheduleId,
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
