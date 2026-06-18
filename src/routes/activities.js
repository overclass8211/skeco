const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

const ACT_COLS = [
  { key: 'id', label: 'ID' },
  { key: 'activity_type', label: '유형' },
  { key: 'title', label: '제목' },
  { key: 'content', label: '내용' },
  { key: 'customer_name', label: '고객사' },
  { key: 'project_name', label: '프로젝트' },
  { key: 'performer_name', label: '담당자' },
  { key: 'activity_date', label: '활동일' },
  { key: 'status', label: '상태' },
  { key: 'performed_at', label: '기록일시' },
];

// ─── activity_type 정규화 ──────────────────────────────────────
// 폼에서 영문 value('meeting','call' …) 로 전송되는데, DB 컬럼은
// 한글 ENUM('미팅','전화','이메일','제안서','입찰','수주','드롭','기타')
// 으로 정의되어 있어 "Data truncated for column 'activity_type'" 발생.
// → 영문 입력을 한글 라벨로 매핑, 한글 입력은 passthrough.
const ACT_TYPE_MAP = {
  // 영문 폼 value → 한글 라벨
  meeting: '미팅',
  call: '전화',
  email: '이메일',
  site_visit: '현장방문',
  proposal: '제안',
  note: '메모',
  bidding: '입찰',
  // 한글 passthrough (이미 한글로 들어온 경우)
  미팅: '미팅',
  전화: '전화',
  이메일: '이메일',
  현장방문: '현장방문',
  영업방문: '영업방문',
  제안: '제안',
  제안서: '제안서',
  입찰: '입찰',
  수주: '수주',
  드롭: '드롭',
  메모: '메모',
  내부: '내부',
  기타: '기타',
};
function normalizeActivityType(val) {
  if (!val) return '기타';
  return ACT_TYPE_MAP[val] || val;
}

// ENUM → VARCHAR 자가 마이그레이션 (idempotent, one-shot)
// migrations/03_leads_date_fix.sql 가 수동 실행 안 된 DB 보호.
(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'activities'
         AND COLUMN_NAME  = 'activity_type'`
    );
    if (rows.length && String(rows[0].DATA_TYPE).toLowerCase() === 'enum') {
      await pool.query(
        `ALTER TABLE activities MODIFY COLUMN activity_type VARCHAR(50) DEFAULT '기타'`
      );
      console.log('[migration] activities.activity_type: ENUM → VARCHAR(50)');
    }
  } catch (_) {
    /* 권한/스키마 차이는 무시 — 매핑이 fallback */
  }
})();

// 도메인 루트 — GET /api/activities → 활동 목록 (404 패턴 해소)
// 쿼리: ?lead_id=&project_id=&limit=&offset=
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const cond = [];
    const params = [];
    if (req.query.lead_id) {
      cond.push('a.lead_id = ?');
      params.push(req.query.lead_id);
    }
    if (req.query.project_id) {
      cond.push('a.project_id = ?');
      params.push(req.query.project_id);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT a.*, tm.name AS performer_name, l.customer_name, l.project_name
       FROM activities a
       LEFT JOIN team_members tm ON a.performed_by = tm.id
       LEFT JOIN leads l         ON a.lead_id = l.id
       ${where}
       ORDER BY COALESCE(a.activity_date, a.performed_at) DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// status 컬럼 자가 보장 (idempotent)
pool
  .query(
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'planned' AFTER activity_date`
  )
  .catch(() => {
    /* 이미 존재하거나 권한 없으면 무시 */
  });

router.post('/', async (req, res) => {
  try {
    const {
      lead_id,
      project_id,
      activity_type,
      title,
      content,
      performed_by,
      activity_date,
      calendar_event_id,
      status,
    } = req.body;
    const dateVal = activity_date ? activity_date.replace('T', ' ').slice(0, 19) : null;
    const statusVal = status === 'done' || status === 'planned' ? status : 'planned';
    const typeVal = normalizeActivityType(activity_type);

    const doInsert = () =>
      pool.query(
        `INSERT INTO activities
       (lead_id, project_id, activity_type, title, content, performed_by, activity_date, calendar_event_id, status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          lead_id || null,
          project_id || null,
          typeVal,
          title,
          content || null,
          performed_by || null,
          dateVal,
          calendar_event_id || null,
          statusVal,
        ]
      );

    try {
      const [result] = await doInsert();
      return res.json({
        success: true,
        id: result.insertId,
        data: { id: result.insertId, lead_id: lead_id || null },
      });
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        // 누락 컬럼 자동 추가 후 재시도
        await pool
          .query(
            `ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_date DATETIME NULL DEFAULT NULL`
          )
          .catch(() => {});
        await pool
          .query(
            `ALTER TABLE activities ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'planned'`
          )
          .catch(() => {});
        const [result] = await doInsert();
        return res.json({
          success: true,
          id: result.insertId,
          data: { id: result.insertId, lead_id: lead_id || null },
        });
      }
      throw e;
    }
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = [
      'activity_type',
      'title',
      'content',
      'performed_by',
      'activity_date',
      'calendar_event_id',
      'status',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=?`);
        if (f === 'activity_date' && req.body[f]) {
          values.push(String(req.body[f]).replace('T', ' ').slice(0, 19));
        } else if (f === 'activity_type') {
          values.push(normalizeActivityType(req.body[f]));
        } else {
          values.push(req.body[f] || null);
        }
      }
    });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE activities SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM activities WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ──────────────────────────────────────────────────────────────
// 과거 활동 ↔ 캘린더 자동 연결 (retroactive bulk link)
// 매칭 가능한 기존 이벤트 연결 + 없으면 새 캘린더 이벤트 생성
// ──────────────────────────────────────────────────────────────
router.post('/auto-link', async (req, res) => {
  try {
    const ACT_TO_EVENT = {
      meeting: '미팅',
      site_visit: '영업방문',
      proposal: '제안',
      bidding: '입찰',
      call: '기타',
      note: '기타',
      email: '기타',
      미팅: '미팅',
      영업방문: '영업방문',
      제안: '제안',
      제안서: '제안',
      입찰: '입찰',
      전화: '기타',
      이메일: '기타',
      메모: '기타',
      현장방문: '영업방문',
      내부: '내부',
      기타: '기타',
    };
    const TYPE_COLORS = {
      미팅: '#1a73e8',
      영업방문: '#33b679',
      입찰: '#d93025',
      제안: '#f9ab00',
      내부: '#616161',
      기타: '#9c27b0',
    };
    const TYPE_ICON = {
      미팅: '[미팅]',
      영업방문: '[현장방문]',
      입찰: '[입찰]',
      제안: '[제안]',
      내부: '[내부]',
      기타: '',
    };

    // 미연결 활동 목록 (lead_id + 날짜 + 리드 정보 포함)
    const [unlinked] = await pool.query(`
      SELECT a.id, a.lead_id, a.activity_type, a.title, a.content, a.performed_by,
             COALESCE(a.activity_date, a.performed_at) AS act_date,
             l.customer_name, l.project_name
      FROM activities a
      LEFT JOIN leads l ON a.lead_id = l.id
      WHERE a.calendar_event_id IS NULL
        AND a.lead_id IS NOT NULL
        AND a.activity_type NOT IN ('stage_change', '수주', '드롭')
    `);

    const [usedRows] = await pool.query(
      'SELECT calendar_event_id FROM activities WHERE calendar_event_id IS NOT NULL'
    );
    const usedIds = new Set(usedRows.map(r => r.calendar_event_id));

    let matched = 0,
      created = 0,
      skipped = 0;

    for (const act of unlinked) {
      if (!act.act_date) {
        skipped++;
        continue;
      }

      const eventType = ACT_TO_EVENT[act.activity_type] || '기타';
      const dateStr = new Date(act.act_date).toISOString().slice(0, 10);

      // ① 기존 캘린더 이벤트 중 매칭 후보 탐색 (같은 리드 ±3일)
      const [candidates] = await pool.query(
        `
        SELECT id, event_type,
               ABS(TIMESTAMPDIFF(MINUTE, start_datetime, ?)) AS diff_min
        FROM calendar_events
        WHERE lead_id = ?
          AND DATE(start_datetime) BETWEEN DATE_SUB(?, INTERVAL 3 DAY)
                                       AND DATE_ADD(?, INTERVAL 3 DAY)
        ORDER BY diff_min ASC LIMIT 10
      `,
        [act.act_date, act.lead_id, dateStr, dateStr]
      );

      const free = candidates.filter(c => !usedIds.has(c.id));
      let calId = null;

      if (free.length === 1) {
        calId = free[0].id;
      } else if (free.length > 1) {
        const sameType = free.filter(c => c.event_type === eventType);
        if (sameType.length >= 1) calId = sameType[0].id;
        else calId = free[0].id; // 가장 가까운 것 선택
      }

      if (calId) {
        // ② 기존 이벤트에 연결
        await pool.query('UPDATE activities SET calendar_event_id = ? WHERE id = ?', [
          calId,
          act.id,
        ]);
        usedIds.add(calId);
        matched++;
      } else {
        // ③ 매칭 이벤트 없음 → 새 캘린더 이벤트 생성 후 연결
        const color = TYPE_COLORS[eventType] || '#9c27b0';
        const titlePrefix = TYPE_ICON[eventType] || '';
        const custPart = act.customer_name ? act.customer_name + ' ' : '';
        const evTitle = `${titlePrefix} ${custPart}${act.title || act.activity_type}`.trim();

        // activity_date를 캘린더 start_datetime으로 사용
        const dt = new Date(act.act_date);
        const p = n => String(n).padStart(2, '0');
        const fmtDt = d =>
          `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
        const startDt = fmtDt(dt);
        const endDt = (() => {
          const e = new Date(dt);
          e.setHours(e.getHours() + 1);
          return fmtDt(e);
        })();

        const [ins] = await pool.query(
          `
          INSERT INTO calendar_events
            (title, description, start_datetime, end_datetime, all_day,
             event_type, status, lead_id, customer_name, assigned_to, color)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `,
          [
            evTitle,
            act.content || null,
            startDt,
            endDt,
            0,
            eventType,
            'completed', // 과거 활동이므로 완료 처리
            act.lead_id,
            act.customer_name || null,
            act.performed_by || null,
            color,
          ]
        );
        const newCalId = ins.insertId;

        await pool.query('UPDATE activities SET calendar_event_id = ? WHERE id = ?', [
          newCalId,
          act.id,
        ]);
        usedIds.add(newCalId);
        created++;
      }
    }

    res.json({
      success: true,
      matched, // 기존 이벤트 연결
      created, // 새 캘린더 이벤트 생성 후 연결
      skipped, // 날짜 없어서 건너뜀
      total: unlinked.length,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// 특정 활동의 캘린더 후보 조회 (수동 연결 picker 용)
router.get('/:id/calendar-candidates', async (req, res) => {
  try {
    const [actRows] = await pool.query(
      'SELECT id, lead_id, activity_type, COALESCE(activity_date, performed_at) AS act_date FROM activities WHERE id = ?',
      [req.params.id]
    );
    if (!actRows.length) return res.json({ success: true, data: [] });

    const act = actRows[0];
    if (!act.lead_id || !act.act_date) return res.json({ success: true, data: [] });

    const dateStr = new Date(act.act_date).toISOString().slice(0, 10);

    const [rows] = await pool.query(
      `
      SELECT e.id, e.title, e.event_type, e.start_datetime, e.status,
             e.customer_name,
             (SELECT a2.id FROM activities a2 WHERE a2.calendar_event_id = e.id LIMIT 1) AS already_linked_act
      FROM calendar_events e
      WHERE e.lead_id = ?
        AND DATE(e.start_datetime) BETWEEN DATE_SUB(?, INTERVAL 7 DAY)
                                       AND DATE_ADD(?, INTERVAL 7 DAY)
      ORDER BY ABS(TIMESTAMPDIFF(MINUTE, e.start_datetime, ?)) ASC
      LIMIT 20
    `,
      [act.lead_id, dateStr, dateStr, act.act_date]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 익스포트 (xlsx/csv/json) ────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { lead_id, project_id, activity_type, search } = req.query;
    const cond = [],
      params = [];
    if (lead_id) {
      cond.push('a.lead_id = ?');
      params.push(lead_id);
    }
    if (project_id) {
      cond.push('a.project_id = ?');
      params.push(project_id);
    }
    if (activity_type) {
      cond.push('a.activity_type = ?');
      params.push(activity_type);
    }
    if (search) {
      cond.push('(a.title LIKE ? OR a.content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT a.id, a.activity_type, a.title, a.content,
              a.activity_date, a.status, a.performed_at,
              tm.name AS performer_name,
              l.customer_name, l.project_name
         FROM activities a
         LEFT JOIN team_members tm ON a.performed_by = tm.id
         LEFT JOIN leads l         ON a.lead_id = l.id
        ${where}
        ORDER BY COALESCE(a.activity_date, a.performed_at) DESC
        LIMIT 5000`,
      params
    );
    await sendExport(res, {
      columns: ACT_COLS,
      rows,
      sheetName: '활동이력',
      filename: '활동이력_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
