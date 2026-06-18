const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { wsBroadcast } = require('../ws');

// 도메인 루트 — board 인덱스 (공지+FAQ 요약)
// GET /api/board → 핵심 sub-resource 메타 반환 (404 패턴 해소)
router.get('/', async (req, res) => {
  try {
    const [[{ ann_cnt }]] = await pool.query(`SELECT COUNT(*) AS ann_cnt FROM announcements`);
    const [[{ faq_cnt }]] = await pool
      .query(`SELECT COUNT(*) AS faq_cnt FROM faqs`)
      .catch(() => [[{ faq_cnt: 0 }]]);
    const [recent] = await pool.query(
      `SELECT id, title, is_pinned, created_at FROM announcements
       ORDER BY is_pinned DESC, created_at DESC LIMIT 5`
    );
    res.json({
      success: true,
      data: {
        announcements_count: ann_cnt,
        faqs_count: faq_cnt,
        recent_announcements: recent,
      },
      endpoints: ['/announcements', '/comments', '/faq'],
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, t.name AS created_by_name,
        (SELECT COUNT(*) FROM comments c WHERE c.ref_type='announcement' AND c.ref_id=a.id) AS comment_count
      FROM announcements a LEFT JOIN team_members t ON a.created_by = t.id
      ORDER BY a.is_pinned DESC, a.created_at DESC`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/announcements', async (req, res) => {
  try {
    const { title, content, is_pinned, created_by } = req.body;
    const [result] = await pool.query(
      'INSERT INTO announcements (title, content, is_pinned, created_by) VALUES (?,?,?,?)',
      [title, content, is_pinned ? 1 : 0, created_by || null]
    );
    // 작성자 이름 조회 후 실시간 알림 브로드캐스트
    let authorName = '시스템';
    if (created_by) {
      const [[t]] = await pool.query('SELECT name FROM team_members WHERE id=?', [created_by]);
      if (t) authorName = t.name;
    }
    wsBroadcast({
      type: 'announcement',
      id: result.insertId,
      title,
      preview: (content || '').replace(/<[^>]+>/g, '').substring(0, 60),
      is_pinned: !!is_pinned,
      author: authorName,
    });
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/announcements/:id', async (req, res) => {
  try {
    const { title, content, is_pinned } = req.body;
    await pool.query('UPDATE announcements SET title=?, content=?, is_pinned=? WHERE id=?', [
      title,
      content,
      is_pinned ? 1 : 0,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/announcements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 공지 열람 기록 (반복 열람 무시 — PK 중복 시 무시) ──────────
router.post('/announcements/:id/view', async (req, res) => {
  try {
    const announcementId = parseInt(req.params.id);
    const viewerId = parseInt(req.body.viewer_id || req.headers['x-user-id'] || 0);
    if (!announcementId || !viewerId) return res.json({ success: true, skipped: true });
    // INSERT IGNORE: 이미 기록된 경우 무시 (반복 열람 제외)
    await pool.query(
      `INSERT IGNORE INTO announcement_views (announcement_id, viewer_id) VALUES (?, ?)`,
      [announcementId, viewerId]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/comments', async (req, res) => {
  try {
    const { ref_type, ref_id } = req.query;
    let sql = 'SELECT * FROM comments WHERE 1=1';
    const params = [];
    if (ref_type) {
      sql += ' AND ref_type=?';
      params.push(ref_type);
    }
    if (ref_id) {
      sql += ' AND ref_id=?';
      params.push(ref_id);
    }
    sql += ' ORDER BY created_at ASC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/comments', async (req, res) => {
  try {
    const { ref_type, ref_id, content, author_name } = req.body;
    const [result] = await pool.query(
      'INSERT INTO comments (ref_type, ref_id, content, author_name) VALUES (?,?,?,?)',
      [ref_type, ref_id, content, author_name || '익명']
    );

    // 댓글이 달린 게시글 제목 조회
    let refTitle = '';
    if (ref_type === 'announcement' && ref_id) {
      const [[ann]] = await pool
        .query('SELECT title FROM announcements WHERE id=?', [ref_id])
        .catch(() => [[null]]);
      if (ann) refTitle = ann.title;
    }
    wsBroadcast({
      type: 'comment',
      ref_type,
      ref_id: Number(ref_id),
      ref_title: refTitle,
      author: author_name || '익명',
      preview: (content || '').substring(0, 50),
    });
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/comments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM comments WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/faq', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM faq ORDER BY category, created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/faq', async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    const [result] = await pool.query(
      'INSERT INTO faq (question, answer, category) VALUES (?,?,?)',
      [question, answer, category || '기타']
    );
    wsBroadcast({
      type: 'faq',
      id: result.insertId,
      category: category || '기타',
      question: (question || '').substring(0, 60),
    });
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/faq/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM faq WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
