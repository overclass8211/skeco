const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { parsePage, pageResult } = require('../utils/routeHelper');

router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = '';
    const params = [];
    if (category) {
      where = 'WHERE category = ?';
      params.push(category);
    }

    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM products ${where}`, params),
      pool.query(`SELECT * FROM products ${where} ORDER BY category, name LIMIT ? OFFSET ?`, [
        ...params,
        limit,
        offset,
      ]),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, category, unit, current_price, currency, notes } = req.body;
    const [result] = await pool.query(
      `INSERT INTO products (name, category, unit, current_price, currency, last_updated, notes)
       VALUES (?,?,?,?,?,CURRENT_DATE(),?)`,
      [name, category, unit, current_price, currency || 'USD', notes || null]
    );
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at) VALUES (?,?,CURRENT_DATE())`,
      [result.insertId, current_price]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { current_price, notes } = req.body;
    const [[old]] = await pool.query('SELECT current_price FROM products WHERE id = ?', [
      req.params.id,
    ]);
    if (!old) return res.status(404).json({ success: false });
    const previous = parseFloat(old.current_price);
    const newPrice = parseFloat(current_price);
    const changePct = previous ? (((newPrice - previous) / previous) * 100).toFixed(2) : 0;
    await pool.query(
      `UPDATE products SET previous_price=?, current_price=?, change_pct=?, last_updated=CURRENT_DATE(), notes=? WHERE id=?`,
      [previous, newPrice, changePct, notes || null, req.params.id]
    );
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at) VALUES (?,?,CURRENT_DATE())`,
      [req.params.id, newPrice]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM cost_history WHERE product_id = ? ORDER BY recorded_at`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/products/seed-demo — 샘플 원가 7건 시드
//
// 멱등성 보장: 이름 기준 INSERT IGNORE (이미 같은 이름 있으면 skip)
// 권한: team_lead 이상 (autoLevel 미들웨어가 /products → 2 매핑으로 자동 적용)
// ─────────────────────────────────────────────────────────────
router.post('/seed-demo', async (req, res) => {
  try {
    const samples = [
      {
        name: '폴리실리콘 (Tier1)',
        category: '원자재',
        unit: '$/kg',
        current_price: 8.5,
        currency: 'USD',
      },
      {
        name: '실리콘 웨이퍼 (M10)',
        category: '원자재',
        unit: '$/장',
        current_price: 0.18,
        currency: 'USD',
      },
      {
        name: '단결정 PERC 모듈 (550W)',
        category: '모듈',
        unit: '$/W',
        current_price: 0.13,
        currency: 'USD',
      },
      {
        name: 'ESS PCS (250kW)',
        category: '부품',
        unit: '₩/대',
        current_price: 38000000,
        currency: 'KRW',
      },
      {
        name: '리튬인산철 배터리 셀 (LFP)',
        category: '부품',
        unit: '$/kWh',
        current_price: 95,
        currency: 'USD',
      },
      {
        name: 'EPC 설치 인건비 (숙련공)',
        category: '인건비',
        unit: '₩/일',
        current_price: 320000,
        currency: 'KRW',
      },
      {
        name: '엔지니어링/설계 (PV)',
        category: '인건비',
        unit: '₩/MW',
        current_price: 12000000,
        currency: 'KRW',
      },
    ];
    let inserted = 0;
    for (const s of samples) {
      const [[dup]] = await pool.query('SELECT id FROM products WHERE name = ? LIMIT 1', [s.name]);
      if (dup) continue; // 중복 skip — 멱등성
      const [result] = await pool.query(
        `INSERT INTO products (name, category, unit, current_price, currency, last_updated)
         VALUES (?,?,?,?,?,CURRENT_DATE())`,
        [s.name, s.category, s.unit, s.current_price, s.currency]
      );
      await pool.query(
        `INSERT INTO cost_history (product_id, price, recorded_at) VALUES (?,?,CURRENT_DATE())`,
        [result.insertId, s.current_price]
      );
      inserted++;
    }
    res.json({ success: true, inserted, skipped: samples.length - inserted });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
