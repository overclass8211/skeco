const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

const TEAM_COLS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '이름' },
  { key: 'email', label: '이메일' },
  { key: 'phone', label: '전화번호' },
  { key: 'role', label: '역할' },
  { key: 'team', label: '팀' },
  { key: 'is_active', label: '활성' },
  { key: 'created_at', label: '등록일' },
];

// ── 익스포트 (xlsx/csv/json) ────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, role, team, is_active, created_at
         FROM team_members
        ORDER BY name`
    );
    await sendExport(res, {
      columns: TEAM_COLS,
      rows,
      sheetName: '팀원',
      filename: '팀원_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM team_members WHERE is_active = 1`),
      pool.query(
        `
      SELECT t.*,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id) AS total_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND stage NOT IN ('won','lost','dropped')) AS active_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_count,
        (SELECT COALESCE(SUM(expected_amount),0) FROM leads WHERE assigned_to = t.id AND stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_amount,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())) AS new_this_month
      FROM team_members t
      WHERE t.is_active = 1
      ORDER BY FIELD(t.role,'Sales','Field','CS'), t.name
      LIMIT ? OFFSET ?
    `,
        [limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, role, team, email, phone } = req.body;
    const [result] = await pool.query(
      `INSERT INTO team_members (name, role, team, email, phone) VALUES (?,?,?,?,?)`,
      [name, role, team || null, email || null, phone || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = ['name', 'role', 'team', 'email', 'phone', 'is_active'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE team_members SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE team_members SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
