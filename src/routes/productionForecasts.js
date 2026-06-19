'use strict';
// =============================================================
// /api/production-forecasts — 생산예측 (마케팅 demand plan, Phase B)
//
//   GET    /                목록 (필터: period, customer, status, q)
//   POST   /                생성 (expected_revenue = qty × unit_price)
//   PUT    /:id             수정
//   DELETE /:id             삭제
//   POST   /:id/convert     수주 전환 → leads(파이프라인) 생성 + 연결
//
// 생산예측 → 수주 전환 시 leads.stage='won' 으로 편입되어
// 매출 포캐스트(Phase A)의 확정/예상 집계에 자동 반영된다.
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');

function calcRevenue(qty, price) {
  return Math.round((Number(qty) || 0) * (Number(price) || 0));
}

// ── 목록 ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const where = ['1=1'];
    const params = [];
    if (req.query.period) {
      where.push('period = ?');
      params.push(req.query.period);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.customer) {
      where.push('customer_name LIKE ?');
      params.push(`%${req.query.customer}%`);
    }
    if (req.query.q) {
      where.push('(customer_name LIKE ? OR product_name LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    const [rows] = await pool.query(
      `SELECT pf.*, tm.name AS assignee_name
         FROM production_forecasts pf
         LEFT JOIN team_members tm ON pf.assigned_to = tm.id
        WHERE ${where.join(' AND ')}
        ORDER BY pf.period ASC, pf.customer_name ASC, pf.id ASC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 생성 ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.customer_name || !b.product_name || !/^\d{4}-\d{2}$/.test(b.period || '')) {
      return res
        .status(400)
        .json({ success: false, error: '고객사·품목·기간(YYYY-MM)은 필수입니다.' });
    }
    const revenue = calcRevenue(b.forecast_qty, b.unit_price);
    const [r] = await pool.query(
      `INSERT INTO production_forecasts
        (customer_id, customer_name, product_id, product_name, business_type,
         period, forecast_qty, unit, unit_price, expected_revenue, currency, status, assigned_to, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.customer_id || null,
        b.customer_name,
        b.product_id || null,
        b.product_name,
        b.business_type || null,
        b.period,
        b.forecast_qty || 0,
        b.unit || 'kg',
        b.unit_price || 0,
        revenue,
        b.currency || 'KRW',
        '예측',
        b.assigned_to || getUserId(req) || null,
        b.note || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId, expected_revenue: revenue } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수정 ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const revenue = calcRevenue(b.forecast_qty, b.unit_price);
    await pool.query(
      `UPDATE production_forecasts
          SET customer_name=?, product_name=?, business_type=?, period=?,
              forecast_qty=?, unit=?, unit_price=?, expected_revenue=?, note=?
        WHERE id=?`,
      [
        b.customer_name,
        b.product_name,
        b.business_type || null,
        b.period,
        b.forecast_qty || 0,
        b.unit || 'kg',
        b.unit_price || 0,
        revenue,
        b.note || null,
        req.params.id,
      ]
    );
    res.json({ success: true, data: { expected_revenue: revenue } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 삭제 ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM production_forecasts WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수주 전환 → leads 생성 ─────────────────────────────────────
router.post('/:id/convert', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pf]] = await conn.query('SELECT * FROM production_forecasts WHERE id=? FOR UPDATE', [
      req.params.id,
    ]);
    if (!pf) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '생산예측 없음' });
    }
    if (pf.status === '수주전환' && pf.converted_lead_id) {
      await conn.rollback();
      return res.status(409).json({ success: false, error: '이미 수주 전환됨' });
    }
    // leads.expected_amount 는 원(₩) 풀값 — 생산예측 예상매출(원)을 그대로 사용
    const amountWon = Math.round(Number(pf.expected_revenue) || 0);
    const closeDate = `${pf.period}-01`;
    const [lr] = await conn.query(
      `INSERT INTO leads
        (customer_id, customer_name, project_name, business_type, region, capacity_mw,
         expected_amount, currency, stage, assigned_to, expected_close_date, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pf.customer_id || null,
        pf.customer_name,
        `${pf.product_name} ${pf.period} 공급`,
        pf.business_type || null,
        '국내',
        0,
        amountWon,
        'KRW',
        'won',
        pf.assigned_to || null,
        closeDate,
        `생산예측 #${pf.id} 수주 전환 (수량 ${pf.forecast_qty}${pf.unit})`,
      ]
    );
    await conn.query(
      "UPDATE production_forecasts SET status='수주전환', converted_lead_id=? WHERE id=?",
      [lr.insertId, pf.id]
    );
    await conn.commit();
    res.json({ success: true, data: { lead_id: lr.insertId, expected_amount: amountWon } });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

module.exports = router;
