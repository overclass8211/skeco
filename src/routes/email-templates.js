// =============================================================
// Email Templates — Mailto 발송용 템플릿 CRUD
//
//   GET    /api/email-templates              모든 템플릿 (시드 + 사용자)
//   GET    /api/email-templates/:id          단건 조회
//   POST   /api/email-templates              새 템플릿 추가
//   PUT    /api/email-templates/:id          수정 (is_system=1 은 거부)
//   DELETE /api/email-templates/:id          삭제 (is_system=1 은 거부)
//
// 변수 치환은 클라이언트(이메일 발송 모달)에서 수행.
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { requireFeature } = require('../middleware/featureGuard');

// 이메일 템플릿 전체에 feature flag 적용
router.use(requireFeature('email.templates'));
const { getUserId } = require('../middleware/auth');

const ALLOWED_CATEGORIES = new Set(['lead', 'customer', 'project', 'general']);

function sanitize(value, maxLen) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

// 목록
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    let sql = `SELECT id, name, category, subject, body, is_system,
                      created_by, created_at, updated_at
                 FROM email_templates`;
    const params = [];
    if (category) {
      sql += ` WHERE category = ?`;
      params.push(String(category));
    }
    sql += ` ORDER BY is_system DESC, name ASC`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// 단건
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });
    const [[row]] = await pool.query(
      `SELECT id, name, category, subject, body, is_system,
              created_by, created_at, updated_at
         FROM email_templates WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: '템플릿 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// 새 템플릿
router.post('/', async (req, res) => {
  try {
    const name = sanitize(req.body.name, 150);
    const category = sanitize(req.body.category, 20) || 'general';
    const subject = sanitize(req.body.subject, 300);
    const body = sanitize(req.body.body, 10000);

    if (!name || !subject || !body) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'name / subject / body 는 필수입니다.',
      });
    }
    if (!ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: `category 는 ${[...ALLOWED_CATEGORIES].join(', ')} 중 하나여야 합니다.`,
      });
    }

    const userId = getUserId(req);
    const [r] = await pool.query(
      `INSERT INTO email_templates (name, category, subject, body, is_system, created_by)
         VALUES (?, ?, ?, ?, 0, ?)`,
      [name, category, subject, body, userId]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

// 수정
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });

    const [[existing]] = await pool.query(
      `SELECT id, is_system FROM email_templates WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ success: false, error: '템플릿 없음' });
    if (existing.is_system) {
      return res.status(403).json({
        success: false,
        code: 'SYSTEM_TEMPLATE_PROTECTED',
        error: '시스템 템플릿은 수정할 수 없습니다.',
      });
    }

    const fields = [];
    const params = [];
    if (req.body.name !== undefined) {
      const v = sanitize(req.body.name, 150);
      if (!v)
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'name 은 비어있을 수 없습니다.',
        });
      fields.push('name = ?');
      params.push(v);
    }
    if (req.body.category !== undefined) {
      const v = sanitize(req.body.category, 20);
      if (!ALLOWED_CATEGORIES.has(v)) {
        return res
          .status(400)
          .json({ success: false, code: 'VALIDATION_ERROR', error: '잘못된 category' });
      }
      fields.push('category = ?');
      params.push(v);
    }
    if (req.body.subject !== undefined) {
      const v = sanitize(req.body.subject, 300);
      if (!v)
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'subject 는 비어있을 수 없습니다.',
        });
      fields.push('subject = ?');
      params.push(v);
    }
    if (req.body.body !== undefined) {
      const v = sanitize(req.body.body, 10000);
      if (!v)
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'body 는 비어있을 수 없습니다.',
        });
      fields.push('body = ?');
      params.push(v);
    }

    if (!fields.length) return res.json({ success: true, updated: 0 });

    params.push(id);
    const [r] = await pool.query(
      `UPDATE email_templates SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ success: true, updated: r.affectedRows });
  } catch (err) {
    handleError(res, err);
  }
});

// 복제 — 시스템 시드를 사용자 템플릿으로 복사
//   POST /email-templates/:id/clone
//   body: { name? }  — 옵션, 미지정 시 "원이름 (복사)" 형식
router.post('/:id/clone', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });

    const [[src]] = await pool.query(
      `SELECT name, category, subject, body FROM email_templates WHERE id = ?`,
      [id]
    );
    if (!src) return res.status(404).json({ success: false, error: '원본 템플릿 없음' });

    const newName = sanitize(req.body.name, 150) || `${src.name} (복사)`;
    const userId = getUserId(req);

    const [r] = await pool.query(
      `INSERT INTO email_templates (name, category, subject, body, is_system, created_by)
         VALUES (?, ?, ?, ?, 0, ?)`,
      [newName, src.category, src.subject, src.body, userId]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

// 삭제
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: '잘못된 id' });

    const [[existing]] = await pool.query(
      `SELECT id, is_system FROM email_templates WHERE id = ?`,
      [id]
    );
    if (!existing) return res.status(404).json({ success: false, error: '템플릿 없음' });
    if (existing.is_system) {
      return res.status(403).json({
        success: false,
        code: 'SYSTEM_TEMPLATE_PROTECTED',
        error: '시스템 템플릿은 삭제할 수 없습니다.',
      });
    }

    await pool.query(`DELETE FROM email_templates WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
