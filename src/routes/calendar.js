const router = require('express').Router();
const pool = require('../db');
const { handleError, logAccess } = require('../middleware/errorHandler');

// 도메인 루트 — GET /api/calendar → /events 와 동일 동작 위임 (404 패턴 해소)
async function _eventsHandler(req, res) {
  try {
    const { start, end, assigned_to, lead_id } = req.query;
    let sql = `
      SELECT e.*,
             t.name AS assignee_name,
             act.id           AS linked_activity_id,
             act.activity_type AS linked_activity_type,
             act.title        AS linked_activity_title,
             act.performed_by AS linked_activity_performed_by,
             tm2.name         AS linked_activity_performer
      FROM calendar_events e
      LEFT JOIN team_members t   ON e.assigned_to = t.id
      LEFT JOIN (
        SELECT a.id, a.calendar_event_id, a.activity_type, a.title, a.performed_by
        FROM activities a
        WHERE a.calendar_event_id IS NOT NULL
        GROUP BY a.calendar_event_id
      ) act ON act.calendar_event_id = e.id
      LEFT JOIN team_members tm2 ON act.performed_by = tm2.id
      WHERE 1=1`;
    const params = [];
    if (start) {
      sql += ' AND e.start_datetime >= ?';
      params.push(start);
    }
    if (end) {
      sql += ' AND e.start_datetime <= ?';
      params.push(end);
    }
    if (assigned_to) {
      sql += ' AND e.assigned_to = ?';
      params.push(assigned_to);
    }
    if (lead_id) {
      sql += ' AND e.lead_id = ?';
      params.push(lead_id);
    }
    sql += ' ORDER BY e.start_datetime ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
}
router.get('/', _eventsHandler); // 도메인 루트 (신규)
router.get('/events', _eventsHandler); // 기존 호환 유지

router.get('/events/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT e.*,
             t.name AS assignee_name,
             act.id           AS linked_activity_id,
             act.activity_type AS linked_activity_type,
             act.title        AS linked_activity_title,
             act.performed_by AS linked_activity_performed_by,
             tm2.name         AS linked_activity_performer
      FROM calendar_events e
      LEFT JOIN team_members t   ON e.assigned_to = t.id
      LEFT JOIN (
        SELECT a.id, a.calendar_event_id, a.activity_type, a.title, a.performed_by
        FROM activities a WHERE a.calendar_event_id IS NOT NULL GROUP BY a.calendar_event_id
      ) act ON act.calendar_event_id = e.id
      LEFT JOIN team_members tm2 ON act.performed_by = tm2.id
      WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, error: '이벤트를 찾을 수 없습니다' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/calendar/title-suggestions — 제목 자동완성 (Step 2)
//
// 두 가지 데이터 소스를 합쳐 반환:
//  1) history  — 팀 전체 과거 이벤트 제목 (use_count + last_used_at)
//  2) template — 매칭된 첫 번째 고객사 + 표준 동사 5개 (펼침)
//
// 응답 데이터: [
//   { type: 'history',  title, customer_name, lead_id, last_used_at, use_count },
//   { type: 'template', customer_id, customer_name, verb, generated_title, active_deals_count }
// ]
//
// 사이드이펙 방지:
//  - calendar_events 테이블 customer_id 컬럼 없음 → customer_name 으로만 매칭
//  - frontend 에서 lead_id 로 customers/leads 메모리 조회하여 자동 채움
//  - q 길이 < 2 면 빈 배열 (오타 방지)
// ─────────────────────────────────────────────────────────────
router.get('/title-suggestions', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const limit = Math.min(20, parseInt(req.query.limit, 10) || 8);
    const historyLimit = Math.min(limit, 5);

    // ─── 1) 과거 이벤트 제목 (Smart Ranking) ──────────────
    // title + customer_name 그룹화 → 동일 제목/고객사 조합의 사용 횟수
    // 가장 최근의 lead_id 보존 (다른 고객사로 같은 제목 쓴 경우도 OK)
    const [historyRows] = await pool.query(
      `
      SELECT
        e.title,
        e.customer_name,
        (
          SELECT lead_id FROM calendar_events
          WHERE title = e.title
            AND (customer_name <=> e.customer_name)
            AND lead_id IS NOT NULL
          ORDER BY start_datetime DESC LIMIT 1
        ) AS lead_id,
        MAX(e.start_datetime) AS last_used_at,
        COUNT(*) AS use_count
      FROM calendar_events e
      WHERE e.title LIKE ?
      GROUP BY e.title, e.customer_name
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT ?
      `,
      [`%${q}%`, historyLimit]
    );

    // ─── 2) 고객사 + 동사 템플릿 (매칭된 첫 번째 고객사) ──
    // ranking: 정확 일치(1) > 접두 일치(2) > 부분 일치(3)
    const [customerRows] = await pool.query(
      `
      SELECT
        c.id AS customer_id, c.name AS customer_name,
        (SELECT COUNT(*) FROM leads l
           WHERE l.customer_id = c.id
             AND l.stage NOT IN ('won','lost','dropped')) AS active_deals_count
      FROM customers c
      WHERE c.name LIKE ?
      ORDER BY
        CASE WHEN c.name = ? THEN 1
             WHEN c.name LIKE ? THEN 2
             ELSE 3 END,
        c.name ASC
      LIMIT 1
      `,
      [`%${q}%`, q, `${q}%`]
    );

    const VERBS = ['미팅', '견적서 발송', '계약 체결', '방문', '통화'];
    const templates = [];
    if (customerRows.length > 0) {
      const c = customerRows[0];
      for (const verb of VERBS) {
        templates.push({
          type: 'template',
          customer_id: c.customer_id,
          customer_name: c.customer_name,
          active_deals_count: Number(c.active_deals_count) || 0,
          verb,
          generated_title: `${c.customer_name} ${verb}`,
        });
      }
    }

    const history = historyRows.map(r => ({
      type: 'history',
      title: r.title,
      customer_name: r.customer_name,
      lead_id: r.lead_id,
      last_used_at: r.last_used_at,
      use_count: Number(r.use_count) || 1,
    }));

    return res.json({
      success: true,
      data: [...history, ...templates],
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/events', async (req, res) => {
  try {
    const {
      title,
      description,
      start_datetime,
      end_datetime,
      all_day,
      event_type,
      status,
      lead_id,
      customer_name,
      assigned_to,
      color,
      recurrence,
    } = req.body;
    const [result] = await pool.query(
      `INSERT INTO calendar_events
       (title, description, start_datetime, end_datetime, all_day, event_type,
        status, lead_id, customer_name, assigned_to, color, recurrence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        title,
        description || null,
        start_datetime,
        end_datetime || null,
        all_day ? 1 : 0,
        event_type || '기타',
        status || 'planned',
        lead_id || null,
        customer_name || null,
        assigned_to || null,
        color || '#e63946',
        recurrence || null,
      ]
    );
    logAccess(req, 201);
    res.json({ success: true, id: result.insertId, data: { id: result.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/events/:id', async (req, res) => {
  try {
    const fields = [
      'title',
      'description',
      'start_datetime',
      'end_datetime',
      'all_day',
      'event_type',
      'status',
      'lead_id',
      'customer_name',
      'assigned_to',
      'color',
      'recurrence',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=?`);
        values.push(req.body[f]);
      }
    });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE calendar_events SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 대량 시드 — 2026년 1~4월
router.post('/seed-massive', async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events');
    const [leads] = await pool.query(
      `SELECT id, customer_name, project_name, business_type FROM leads ORDER BY id`
    );
    if (!leads.length)
      return res.status(400).json({ success: false, error: '리드가 없어 시드 불가' });

    const [team] = await pool.query('SELECT id, name FROM team_members WHERE is_active=1');
    const teamIds = team.length ? team.map(t => t.id) : [null];

    const HOLIDAYS = new Set([
      '2026-01-01',
      '2026-02-16',
      '2026-02-17',
      '2026-02-18',
      '2026-03-01',
      '2026-03-02',
      '2026-04-15',
    ]);
    const TYPE_COLORS = {
      미팅: '#3788d8',
      영업방문: '#28a745',
      입찰: '#e63946',
      제안: '#fd7e14',
      내부: '#6c757d',
      기타: '#9c27b0',
    };
    const SLOTS = [
      { hour: 9, types: ['미팅', '영업방문', '내부'] },
      { hour: 11, types: ['미팅', '입찰', '제안', '내부'] },
      { hour: 14, types: ['미팅', '영업방문', '제안', '입찰'] },
      { hour: 16, types: ['영업방문', '내부', '기타', '제안'] },
    ];
    const TITLE_BANK = {
      미팅: [
        '방문 미팅',
        '기술 협의 미팅',
        '킥오프 미팅',
        '진행상황 점검 미팅',
        '임원 보고 미팅',
        '계약 조율 미팅',
        '파트너사 미팅',
      ],
      영업방문: [
        '현장 답사',
        '사이트 실사',
        '본사 방문',
        '신규 거래선 발굴 방문',
        '관계 강화 방문',
        '공장 실사',
      ],
      입찰: [
        '입찰서 제출',
        'PQ 제출',
        '입찰 마감 대응',
        '입찰 현장 설명회 참석',
        'Q&A 세션 참석',
        '기술 평가 대응',
      ],
      제안: [
        '견적서 발송',
        '제안서 발표',
        'RFP 입수',
        '제안 PT',
        '상업 조건 협의',
        '가격 협상',
        '최종 제안서 제출',
      ],
      내부: [
        '파이프라인 리뷰',
        '영업 전략 회의',
        '주간 보고',
        '원가 검토',
        '분기 실적 회의',
        '수주 현황 공유',
      ],
      기타: [
        '자료 전달',
        '계약서 검토',
        '전화 상담',
        '이메일 팔로업',
        '샘플 발송',
        '문서 요청 응대',
      ],
    };

    const p2 = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const dt = (d, h) => `${ymd(d)} ${p2(h)}:00:00`;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = [];

    for (let d = new Date('2026-01-01'); d <= new Date('2026-04-30'); d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6 || HOLIDAYS.has(ymd(d))) continue;

      const eventCount = 3 + Math.floor(Math.random() * 2);
      const slots = [...SLOTS].sort(() => Math.random() - 0.5).slice(0, eventCount);
      const status = d < today ? 'completed' : 'planned';

      for (const slot of slots) {
        const lead = pick(leads);
        const type = pick(slot.types);
        rows.push([
          `${lead.customer_name} ${pick(TITLE_BANK[type])}`,
          `${lead.project_name || lead.customer_name} 관련 ${type} — ${lead.business_type || ''}`,
          dt(new Date(d), slot.hour),
          dt(new Date(d), slot.hour + 1),
          0,
          type,
          status,
          lead.id,
          lead.customer_name,
          pick(teamIds),
          TYPE_COLORS[type],
        ]);
      }
    }

    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await pool.query(
        `INSERT INTO calendar_events (title,description,start_datetime,end_datetime,all_day,event_type,status,lead_id,customer_name,assigned_to,color) VALUES ${ph}`,
        batch.flat()
      );
    }
    res.json({ success: true, seeded: rows.length, period: '2026-01-01 ~ 2026-04-30' });
  } catch (err) {
    handleError(res, err);
  }
});

// 데모 시드
router.post('/seed-demo', async (req, res) => {
  try {
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM calendar_events');
    if (cnt.c >= 5)
      return res.json({ success: true, seeded: 0, message: '이미 충분한 데이터 있음' });

    const [leads] = await pool.query(
      'SELECT id, customer_name, project_name FROM leads ORDER BY updated_at DESC LIMIT 15'
    );
    if (!leads.length) return res.json({ success: true, seeded: 0, message: '리드 없음' });

    const typeColors = {
      미팅: '#3788d8',
      영업방문: '#28a745',
      입찰: '#e63946',
      제안: '#fd7e14',
      내부: '#6c757d',
      기타: '#adb5bd',
    };
    const typeTitles = {
      미팅: ['킥오프 미팅', '제품 소개 미팅', '기술 협의 미팅', '견적 검토 미팅', '상황 점검 미팅'],
      영업방문: ['현장 실사 방문', '고객 니즈 파악', '관계 강화 방문', '경쟁 현황 파악'],
      입찰: ['입찰서류 제출', '기술 평가 대응', '현장 설명회 참석', 'Q&A 세션'],
      제안: ['기술 제안 발표', '상업 조건 협의', '최종 제안서 제출', '가격 협상'],
      내부: ['주간 파이프라인 리뷰', '영업 전략 회의', '팀 브리핑', '원가 검토 회의'],
      기타: ['전화 상담', '이메일 팔로업', '서류 전달', '계약서 검토'],
    };
    const types = Object.keys(typeColors);
    const now = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const fmtDT = d =>
      `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:00:00`;

    for (let i = 0; i < 28; i++) {
      const offset = Math.floor(Math.random() * 110) - 30;
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(9 + Math.floor(Math.random() * 8), 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(date.getHours() + 1, 0, 0, 0);
      const lead = leads[Math.floor(Math.random() * leads.length)];
      const type = types[Math.floor(Math.random() * types.length)];
      const subtl = typeTitles[type][Math.floor(Math.random() * typeTitles[type].length)];
      await pool.query(
        `INSERT INTO calendar_events (title,description,start_datetime,end_datetime,all_day,event_type,lead_id,customer_name,assigned_to,color)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          `[${type}] ${lead.customer_name} ${subtl}`,
          `${lead.project_name || lead.customer_name} 관련 ${type} 일정`,
          fmtDT(date),
          fmtDT(endDate),
          0,
          type,
          lead.id,
          lead.customer_name,
          null,
          typeColors[type],
        ]
      );
    }
    res.json({ success: true, seeded: 28 });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
