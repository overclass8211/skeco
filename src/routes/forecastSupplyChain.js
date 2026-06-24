'use strict';
// =============================================================
// /api/forecast-sc — 반도체 수급 기반 FCST (MI수요 → 생산Capa → 매출)
//
//   GET    /monthly       월별 집계 (대시보드 메인: 수요/공급/매출/충족률)
//   GET    /summary       연간 KPI 요약
//   GET    /demand        수요 로데이터 (행별 공급량·매출 산출 포함)
//   GET    /capacity      생산 Capa 목록 (제품 × 월)
//   POST   /capacity      Capa 생성/업서트
//   PUT    /capacity/:id  Capa 수정
//   DELETE /capacity/:id  Capa 삭제
//
// 산출 모델 (엑셀 로데이터 동일):
//   유효Capa(제품·월) = nameplate × utilization
//   충족률(제품·월)   = MIN(1, 유효Capa / 해당 제품·월 총수요)
//   공급량(행)        = 수요량 × 충족률           (Capa 제약 비례 배분)
//   기대매출(행)      = 공급량 × 판가
// 기존 /api/forecast(파이프라인)·/api/production-forecasts(CRUD)는 그대로 보존.
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function monthOf(period) {
  return parseInt(String(period).slice(5, 7), 10); // 1~12
}

// 수요 + Capa 적재 후 행별 공급량·매출 산출 (엑셀 배분 모델)
async function computeRows(year, extraWhere = '', extraParams = []) {
  const [fc] = await pool.query(
    `SELECT id, customer_id, customer_name, product_id, product_name, period,
            business_type, region, forecast_qty AS demand_qty, unit,
            unit_price, currency, demand_source, status
       FROM production_forecasts
      WHERE period LIKE ? ${extraWhere}
      ORDER BY period ASC, product_name ASC, customer_name ASC, id ASC`,
    [`${year}-%`, ...extraParams]
  );
  const [cap] = await pool.query(
    `SELECT product_name, period, nameplate, utilization
       FROM production_capacity WHERE period LIKE ?`,
    [`${year}-%`]
  );
  // 유효Capa 맵 (제품|월)
  const effCapa = new Map();
  for (const c of cap) {
    effCapa.set(`${c.product_name}|${c.period}`, Number(c.nameplate) * Number(c.utilization));
  }
  // 제품|월 총수요
  const totDemand = new Map();
  for (const row of fc) {
    const k = `${row.product_name}|${row.period}`;
    totDemand.set(k, (totDemand.get(k) || 0) + Number(row.demand_qty || 0));
  }
  // 행별 충족률·공급·매출
  for (const row of fc) {
    const k = `${row.product_name}|${row.period}`;
    const total = totDemand.get(k) || 0;
    const hasCapa = effCapa.has(k);
    const eff = hasCapa ? effCapa.get(k) : null;
    let ratio = 1; // Capa 미등록 = 무제약(전량 출하 가정)
    if (hasCapa && total > 0) ratio = Math.min(1, eff / total);
    row.fulfill_ratio = r2(ratio * 1); // 0~1
    row.supply_qty = r2(Number(row.demand_qty || 0) * ratio);
    row.expected_revenue = r2(row.supply_qty * Number(row.unit_price || 0));
  }
  return fc;
}

// 통화 메타 (혼합 시 'MIXED')
function currencyOf(rows) {
  const set = new Set(rows.map(r => r.currency || 'KRW'));
  if (set.size === 1) return [...set][0];
  return set.size === 0 ? 'USD' : 'MIXED';
}

// ── 월별 집계 (대시보드 메인 그래프) ───────────────────────────
router.get('/monthly', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const rows = await computeRows(year);
    const demand = Array(12).fill(0);
    const supply = Array(12).fill(0);
    const revenue = Array(12).fill(0);
    for (const row of rows) {
      const m = monthOf(row.period);
      if (m < 1 || m > 12) continue;
      demand[m - 1] += Number(row.demand_qty || 0);
      supply[m - 1] += Number(row.supply_qty || 0);
      revenue[m - 1] += Number(row.expected_revenue || 0);
    }
    const fulfillment = demand.map((d, i) => (d > 0 ? r2((supply[i] / d) * 100) : 0));
    res.json({
      success: true,
      data: {
        year,
        currency: currencyOf(rows),
        months: [
          '1월',
          '2월',
          '3월',
          '4월',
          '5월',
          '6월',
          '7월',
          '8월',
          '9월',
          '10월',
          '11월',
          '12월',
        ],
        demand: demand.map(r2),
        supply: supply.map(r2),
        revenue: revenue.map(r2),
        fulfillment,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 연간 KPI 요약 ──────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const rows = await computeRows(year);
    let demand = 0;
    let supply = 0;
    let revenue = 0;
    for (const row of rows) {
      demand += Number(row.demand_qty || 0);
      supply += Number(row.supply_qty || 0);
      revenue += Number(row.expected_revenue || 0);
    }
    res.json({
      success: true,
      data: {
        year,
        currency: currencyOf(rows),
        annual_demand: r2(demand),
        annual_supply: r2(supply),
        annual_revenue: r2(revenue),
        fulfillment_rate: demand > 0 ? r2((supply / demand) * 100) : 0,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수요 로데이터 (행별 공급/매출 산출 포함) ───────────────────
router.get('/demand', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const where = [];
    const params = [];
    if (req.query.product) {
      where.push('product_name LIKE ?');
      params.push(`%${req.query.product}%`);
    }
    if (req.query.customer) {
      where.push('customer_name LIKE ?');
      params.push(`%${req.query.customer}%`);
    }
    if (req.query.period) {
      where.push('period = ?');
      params.push(req.query.period);
    }
    const extra = where.length ? `AND ${where.join(' AND ')}` : '';
    const rows = await computeRows(year, extra, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 생산 Capa: 목록 ────────────────────────────────────────────
router.get('/capacity', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.year) {
      where.push('period LIKE ?');
      params.push(`${parseInt(req.query.year, 10)}-%`);
    }
    if (req.query.product) {
      where.push('product_name LIKE ?');
      params.push(`%${req.query.product}%`);
    }
    const sql = `SELECT *, ROUND(nameplate * utilization, 2) AS effective_capa
                   FROM production_capacity
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY product_name ASC, period ASC`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 생산 Capa: 생성/업서트 (product_name + period 유니크) ───────
router.post('/capacity', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.product_name || !/^\d{4}-\d{2}$/.test(b.period || '')) {
      return res.status(400).json({ success: false, error: '제품명·기간(YYYY-MM)은 필수입니다.' });
    }
    const util = Math.max(0, Math.min(1, Number(b.utilization) || 0));
    const [r] = await pool.query(
      `INSERT INTO production_capacity
        (product_id, product_name, period, nameplate, utilization, unit, note)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         nameplate=VALUES(nameplate), utilization=VALUES(utilization),
         unit=VALUES(unit), note=VALUES(note)`,
      [
        b.product_id || null,
        b.product_name,
        b.period,
        Number(b.nameplate) || 0,
        util,
        b.unit || 'L',
        b.note || null,
      ]
    );
    res.json({
      success: true,
      data: { id: r.insertId || null, effective_capa: r2((Number(b.nameplate) || 0) * util) },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 생산 Capa: 수정 ────────────────────────────────────────────
router.put('/capacity/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const util = Math.max(0, Math.min(1, Number(b.utilization) || 0));
    await pool.query(
      `UPDATE production_capacity
          SET product_name=?, period=?, nameplate=?, utilization=?, unit=?, note=?
        WHERE id=?`,
      [
        b.product_name,
        b.period,
        Number(b.nameplate) || 0,
        util,
        b.unit || 'L',
        b.note || null,
        req.params.id,
      ]
    );
    res.json({ success: true, data: { effective_capa: r2((Number(b.nameplate) || 0) * util) } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 생산 Capa: 삭제 ────────────────────────────────────────────
router.delete('/capacity/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM production_capacity WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수요 로데이터: 생성 (실무자 입력) ──────────────────────────
router.post('/demand', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.customer_name || !b.product_name || !/^\d{4}-\d{2}$/.test(b.period || '')) {
      return res
        .status(400)
        .json({ success: false, error: '고객사·제품·기간(YYYY-MM)은 필수입니다.' });
    }
    let customerId = b.customer_id || null;
    if (!customerId) {
      const [[c]] = await pool.query('SELECT MIN(id) AS id FROM customers WHERE name=?', [
        b.customer_name,
      ]);
      customerId = c?.id || null;
    }
    const qty = Number(b.forecast_qty) || 0;
    const price = Number(b.unit_price) || 0;
    const [r] = await pool.query(
      `INSERT INTO production_forecasts
        (customer_id, customer_name, product_name, business_type, period,
         forecast_qty, unit, unit_price, expected_revenue, currency, status, demand_source, region)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        customerId,
        b.customer_name,
        b.product_name,
        b.business_type || null,
        b.period,
        qty,
        b.unit || 'L',
        price,
        r2(qty * price),
        b.currency || 'USD',
        '예측',
        b.demand_source || 'manual',
        b.region || null,
      ]
    );
    res.json({ success: true, data: { id: r.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수요 로데이터: 수정 (수요량·판가 인라인 편집) ──────────────
router.put('/demand/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    if (b.forecast_qty !== undefined) {
      sets.push('forecast_qty=?');
      params.push(Number(b.forecast_qty) || 0);
    }
    if (b.unit_price !== undefined) {
      sets.push('unit_price=?');
      params.push(Number(b.unit_price) || 0);
    }
    if (!sets.length)
      return res.status(400).json({ success: false, error: '수정할 값이 없습니다.' });
    params.push(req.params.id);
    await pool.query(`UPDATE production_forecasts SET ${sets.join(', ')} WHERE id=?`, params);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수요 로데이터: 삭제 ────────────────────────────────────────
router.delete('/demand/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM production_forecasts WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
