'use strict';
// =============================================================
// /api/reports — 리포트 페이지의 사용자 정의 위젯 관리
//
// 사용자가 리포트 빌더에서 저장한 리포트(report_definitions)를
// 리포트 페이지의 위젯으로 등록/조회/제거/재배치하는 API.
//
// 권한: crm.reports 기능 플래그 + 인증 사용자
// 위젯 = report_definitions 의 reference (config_json 은 빌더에서 관리)
//
// 엔드포인트:
//   GET    /widgets        — 본인 위젯 목록 + 각 리포트 config_json 함께
//   POST   /widgets        — 위젯 1+ 추가 (report_id 또는 report_ids 배열)
//   PUT    /widgets/order  — 재배치 (드래그 후 ids 배열 순서대로)
//   DELETE /widgets/:id    — 위젯 제거
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');

// crm.reports 기능 플래그 가드
router.use(requireFeature('crm.reports'));

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
// CASCADE: 리포트 삭제 시 위젯도 자동 삭제 (정합성 유지)
// 외래키 실패 시 fallback — 일반 컬럼만 생성 (report_definitions 아직 없을 때)
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_report_widgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        report_id INT NOT NULL,
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_order (user_id, display_order),
        UNIQUE KEY uk_user_report (user_id, report_id),
        CONSTRAINT fk_widget_report FOREIGN KEY (report_id)
          REFERENCES report_definitions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (_e) {
    // 외래키 실패 시 fallback — 외래키 없이 재시도 (report_definitions 부재 등)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_report_widgets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          report_id INT NOT NULL,
          display_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_user_order (user_id, display_order),
          UNIQUE KEY uk_user_report (user_id, report_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }
}
const _migrationPromise = ensureSchema();

// 자가 마이그레이션 완료 대기 — 첫 요청이 테이블 생성 전에 도착해도 안전
router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── GET /widgets — 본인 위젯 목록 + 각 리포트의 config_json ──
router.get('/widgets', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const [rows] = await pool.query(
      `SELECT w.id, w.report_id, w.display_order,
              r.name, r.description, r.config_json
         FROM user_report_widgets w
         JOIN report_definitions r ON r.id = w.report_id
        WHERE w.user_id = ?
        ORDER BY w.display_order ASC, w.id ASC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /widgets — 위젯 1+ 추가 (다중 선택 지원) ──────────
// Body: { report_id: 123 } 또는 { report_ids: [1, 2, 3] }
// 본인 리포트 또는 공유된(is_shared=1) 리포트만 추가 가능
// UNIQUE(user_id, report_id) — 중복 추가 시 silent skip
router.post('/widgets', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const reportIds = Array.isArray(req.body.report_ids)
      ? req.body.report_ids
      : req.body.report_id
        ? [req.body.report_id]
        : [];
    if (reportIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'report_id 또는 report_ids 가 필요합니다' });
    }
    // 본인 리포트 또는 공유 리포트만 (보안)
    const [validRows] = await pool.query(
      `SELECT id FROM report_definitions WHERE id IN (?) AND (user_id = ? OR is_shared = 1)`,
      [reportIds, userId]
    );
    if (validRows.length === 0) {
      return res.status(400).json({ success: false, error: '유효한 리포트가 없습니다' });
    }
    // 현재 max display_order
    const [[mo]] = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) AS maxOrder FROM user_report_widgets WHERE user_id = ?`,
      [userId]
    );
    let order = (mo?.maxOrder ?? -1) + 1;
    const added = [];
    for (const { id } of validRows) {
      try {
        const [result] = await pool.query(
          `INSERT INTO user_report_widgets (user_id, report_id, display_order) VALUES (?,?,?)`,
          [userId, id, order]
        );
        added.push({ id: result.insertId, report_id: id, display_order: order });
        order++;
      } catch (e) {
        // UNIQUE 위반 = 이미 추가됨 → silent skip
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    res.json({ success: true, data: added, skipped: reportIds.length - added.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /widgets/order — 재배치 (드래그 후 호출) ────────────
// Body: { ids: [id1, id2, id3, ...] } — 새 순서대로 ids 배열
router.put('/widgets/order', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids 배열이 필요합니다' });
    }
    // 각 위젯의 display_order 를 새 인덱스로 업데이트 (본인 위젯만)
    for (let i = 0; i < ids.length; i++) {
      const wid = parseInt(ids[i], 10);
      if (!wid) continue;
      await pool.query(
        `UPDATE user_report_widgets SET display_order = ? WHERE id = ? AND user_id = ?`,
        [i, wid, userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /widgets/:id ─────────────────────────────────────
router.delete('/widgets/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [result] = await pool.query(
      `DELETE FROM user_report_widgets WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '위젯을 찾을 수 없거나 권한 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
