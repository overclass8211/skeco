'use strict';
// =============================================================
// 매출관리 (Revenue) — payment_schedules 를 '매출 렌즈'로 조회/집계 [P2]
//
//   · 단일 소스(payment_schedules) 재사용 — 매출/수금 분리는 모듈(뷰)로만.
//   · 매출확정 = 세금계산서 발행(issued) 시점 → revenue_status='확정'
//     (동기화는 payments.js _syncScheduleRevenue 가 담당)
//
//   GET /schedules : 청구차수(매출 라인) 목록 + 필터(매출상태/고객/계약/기간/검색)
//   GET /summary   : 매출 예정/확정 KPI + 월별 추이 (실적 집계)
// =============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { parsePage, pageResult } = require('../utils/routeHelper');

// ── GET /schedules — 청구차수(매출 라인) 목록 ───────────────────
router.get('/schedules', async (req, res) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const where = [];
    const params = [];
    const eq = (col, v) => {
      if (v !== undefined && v !== '') {
        where.push(`${col} = ?`);
        params.push(v);
      }
    };
    eq('ps.revenue_status', req.query.revenue_status);
    eq('ps.customer_id', req.query.customer_id);
    eq('ps.contract_id', req.query.contract_id);
    if (req.query.from) {
      where.push('ps.due_date >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      where.push('ps.due_date <= ?');
      params.push(req.query.to);
    }
    const q = (req.query.q || '').trim();
    if (q) {
      where.push('(ps.customer_name LIKE ? OR ps.contract_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const ws = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_schedules ps ${ws}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT ps.id, ps.contract_id, ps.customer_id, ps.customer_name, ps.contract_name,
              ps.stage_name, ps.stage_order, ps.ratio,
              ps.scheduled_amount, ps.supply_amount, ps.tax_amount, ps.currency,
              ps.due_date, ps.status AS collect_status, ps.revenue_status, ps.recognized_at,
              (SELECT COUNT(*) FROM tax_invoices ti
                WHERE ti.schedule_id = ps.id AND ti.status = 'issued') AS issued_cnt
         FROM payment_schedules ps
         ${ws}
        ORDER BY ps.due_date ASC, ps.id ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /summary — 매출 예정/확정 KPI + 월별 추이 ───────────────
router.get('/summary', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.from) {
      where.push('due_date >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      where.push('due_date <= ?');
      params.push(req.query.to);
    }
    if (req.query.customer_id) {
      where.push('customer_id = ?');
      params.push(req.query.customer_id);
    }
    const ws = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // KPI: 매출상태별 건수/금액
    const [kpiRows] = await pool.query(
      `SELECT revenue_status,
              COUNT(*) AS cnt,
              COALESCE(SUM(scheduled_amount), 0) AS amount,
              COALESCE(SUM(supply_amount), 0) AS supply,
              COALESCE(SUM(tax_amount), 0) AS tax
         FROM payment_schedules ${ws}
        GROUP BY revenue_status`,
      params
    );
    const kpi = {
      예정: { cnt: 0, amount: 0, supply: 0, tax: 0 },
      확정: { cnt: 0, amount: 0, supply: 0, tax: 0 },
      취소: { cnt: 0, amount: 0, supply: 0, tax: 0 },
    };
    for (const r of kpiRows) {
      if (kpi[r.revenue_status]) {
        kpi[r.revenue_status] = {
          cnt: r.cnt,
          amount: Number(r.amount),
          supply: Number(r.supply),
          tax: Number(r.tax),
        };
      }
    }

    // 월별 추이 — 예정은 due_date, 확정은 recognized_at(없으면 due_date) 기준
    const [planned] = await pool.query(
      `SELECT DATE_FORMAT(due_date, '%Y-%m') AS ym, COALESCE(SUM(scheduled_amount), 0) AS amount
         FROM payment_schedules ${ws ? `${ws} AND` : 'WHERE'} revenue_status = '예정' AND due_date IS NOT NULL
        GROUP BY ym ORDER BY ym`,
      params
    );
    const [confirmed] = await pool.query(
      `SELECT DATE_FORMAT(COALESCE(recognized_at, due_date), '%Y-%m') AS ym,
              COALESCE(SUM(scheduled_amount), 0) AS amount
         FROM payment_schedules ${ws ? `${ws} AND` : 'WHERE'} revenue_status = '확정'
        GROUP BY ym ORDER BY ym`,
      params
    );

    res.json({ success: true, data: { kpi, monthly: { planned, confirmed } } });
  } catch (err) {
    handleError(res, err);
  }
});

// 공급자(자사) 정보 — system_settings(supplier_*) 묶음 [Phase 7 재사용]
async function _getSupplier() {
  const keys = [
    'supplier_company_name',
    'supplier_business_no',
    'supplier_address',
    'supplier_ceo',
  ];
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?,?,?,?)`,
    keys
  );
  const m = {};
  rows.forEach(r => {
    m[r.setting_key] = r.setting_value;
  });
  return {
    company_name: m.supplier_company_name || '',
    business_no: m.supplier_business_no || '',
    address: m.supplier_address || '',
    ceo: m.supplier_ceo || '',
  };
}

// ── GET /schedules/:id — 청구차수 상세 (기본 + 고객사 + 공급자 정보) ──
//   /schedules(목록) 와 충돌 없음(더 구체적 경로). 읽기전용.
router.get('/schedules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[ps]] = await pool.query(
      `SELECT ps.*,
              (SELECT COUNT(*) FROM tax_invoices ti
                WHERE ti.schedule_id = ps.id AND ti.status = 'issued') AS issued_cnt
         FROM payment_schedules ps WHERE ps.id = ?`,
      [id]
    );
    if (!ps) return res.status(404).json({ success: false, error: '청구차수를 찾을 수 없습니다' });
    let customer = null;
    if (ps.customer_id) {
      const [[c]] = await pool.query(
        `SELECT id, name, business_no, address, contact_person, phone, email,
                tax_recipient_name, tax_recipient_dept, tax_recipient_email
           FROM customers WHERE id = ?`,
        [ps.customer_id]
      );
      customer = c || null;
    }
    const supplier = await _getSupplier();
    res.json({ success: true, data: { schedule: ps, customer, supplier } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /schedules/:id/tax-recipient — 세금계산서 수신 담당자 저장 ──
//   대상은 청구차수에 연결된 '고객사'. 화이트리스트 3필드만 UPDATE(가산형).
router.put('/schedules/:id/tax-recipient', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[ps]] = await pool.query(`SELECT customer_id FROM payment_schedules WHERE id = ?`, [id]);
    if (!ps) return res.status(404).json({ success: false, error: '청구차수를 찾을 수 없습니다' });
    if (!ps.customer_id)
      return res.status(400).json({ success: false, error: '연결된 고객사가 없습니다' });

    const { name, dept, email } = req.body || {};
    if (
      email !== undefined &&
      String(email).trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())
    )
      return res.status(400).json({ success: false, error: '유효한 이메일 형식이 아닙니다' });

    const sets = [];
    const vals = [];
    if (name !== undefined) {
      sets.push('tax_recipient_name = ?');
      vals.push(String(name).trim().slice(0, 100) || null);
    }
    if (dept !== undefined) {
      sets.push('tax_recipient_dept = ?');
      vals.push(String(dept).trim().slice(0, 100) || null);
    }
    if (email !== undefined) {
      sets.push('tax_recipient_email = ?');
      vals.push(String(email).trim().slice(0, 200) || null);
    }
    if (!sets.length)
      return res.status(400).json({ success: false, error: '변경할 항목이 없습니다' });

    await pool.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, [
      ...vals,
      ps.customer_id,
    ]);
    res.json({ success: true, data: { customer_id: ps.customer_id } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
