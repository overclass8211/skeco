const router = require('express').Router();
const fs = require('fs');
const pool = require('../db');
const upload = require('../middleware/upload');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const {
  genAI,
  MODEL_FAST,
  SAFETY_SETTINGS,
  logTokenUsage,
  isUserOverLimit,
} = require('../services/gemini');
const { transcribeAudio } = require('../services/stt');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

const MEETING_COLS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: '제목' },
  { key: 'meeting_date', label: '미팅일' },
  { key: 'customer_name', label: '고객사' },
  { key: 'audio_duration_sec', label: '길이(초)' },
  { key: 'created_by_name', label: '작성자' },
  { key: 'summary_preview', label: '요약 미리보기' },
  { key: 'created_at', label: '생성일' },
];

// 1) 음성 → 텍스트
router.post(
  '/transcribe',
  requireFeature('ai.meeting'),
  (req, res, next) => {
    // 장시간 (20분+) 녹음 → Gemini 처리시간 길어짐.
    // Node http 기본 requestTimeout (5분) 으로 끊기지 않도록 라우트별 15분 override.
    // (앞단 nginx 의 proxy_read_timeout 도 별도로 600s+ 권장 — README/배포 가이드 참조)
    try {
      req.setTimeout(15 * 60 * 1000);
      res.setTimeout(15 * 60 * 1000);
    } catch (_) {}
    upload.single('audio')(req, res, err => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: '파일 크기가 25MB를 초과합니다' });
      }
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  },
  async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ success: false, error: 'GEMINI_API_KEY 미설정' });
    }
    if (!req.file)
      return res.status(400).json({ success: false, error: '오디오 파일이 필요합니다' });

    const audioPath = req.file.path;
    try {
      const result = await transcribeAudio(audioPath, req.file.mimetype, req.file.size);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('STT error:', err);
      // 에러는 반드시 JSON — 프론트에서 sttRes.json() 파싱이 깨지지 않도록 보장
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: err.message || '음성 인식 처리 중 오류',
          code: 'STT_ERROR',
        });
      }
    } finally {
      fs.unlink(audioPath, () => {});
    }
  }
);

// 1-a) 음성 → 텍스트 [비동기] — 긴 녹음(120분급) 안정 처리
// 흐름: POST 시 즉시 job_id 반환 → 클라이언트가 /transcribe-status/:id 폴링.
// 기존 동기 /transcribe 는 하위 호환 위해 그대로 유지.
router.post(
  '/transcribe-async',
  requireFeature('ai.meeting'),
  (req, res, next) => {
    upload.audio.single('audio')(req, res, err => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: '파일 크기가 100MB를 초과합니다' });
      }
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  },
  (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ success: false, error: 'GEMINI_API_KEY 미설정' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: '오디오 파일이 필요합니다' });
    }
    const { createJob } = require('../services/sttJobs');
    const job = createJob({
      filePath: req.file.path,
      mimetype: req.file.mimetype,
      fileSize: req.file.size,
      userId: getUserId(req),
    });
    res.status(202).json({
      success: true,
      job_id: job.id,
      poll_url: `/api/meeting/transcribe-status/${job.id}`,
    });
  }
);

router.get('/transcribe-status/:id', (req, res) => {
  const { getJob } = require('../services/sttJobs');
  const job = getJob(req.params.id);
  if (!job) {
    return res
      .status(404)
      .json({ success: false, error: '작업을 찾을 수 없습니다 (만료 또는 ID 오류)' });
  }
  const base = {
    job_id: job.id,
    status: job.status,
    elapsed_sec: Math.max(0, Math.round(((job.finishedAt || Date.now()) - job.createdAt) / 1000)),
  };
  if (job.status === 'done') {
    return res.json({ success: true, ...base, data: job.result });
  }
  if (job.status === 'error' || job.status === 'cancelled') {
    return res.json({ success: false, ...base, error: job.error || '작업 실패' });
  }
  // pending 또는 processing — 응답은 즉시 (프록시 timeout 무관)
  return res.json({ success: true, ...base });
});

// 2) 텍스트 → 요약
router.post('/summarize', async (req, res) => {
  try {
    const { transcript, speakers, customer_name, meeting_date } = req.body;
    if (!transcript) return res.status(400).json({ success: false, error: '텍스트 필요' });

    const userId = getUserId(req);
    if (await isUserOverLimit(userId)) {
      return res.status(429).json({ success: false, error: '월간 토큰 한도 초과' });
    }

    const speakerText = (speakers || []).map(s => `[화자 ${s.speaker}] ${s.text}`).join('\n');

    const prompt = `다음은 영업 미팅의 음성-텍스트 변환 결과입니다. 화자가 분리되어 있습니다.
회의록 요약 보고서를 마크다운 형식으로 작성하세요.

${customer_name ? `고객사: ${customer_name}` : ''}
${meeting_date ? `미팅 일시: ${meeting_date}` : ''}

미팅 내용:
${speakerText || transcript}

다음 4개 섹션을 반드시 포함하세요. 각 섹션 제목은 H2(##)로 시작:

## 미팅 주요 어젠다
- 미팅에서 다뤄진 핵심 의제 3~5개를 불릿으로 정리

## 핵심 내용
- 각 어젠다별 주요 논의 사항, 결정 사항, 제기된 이슈를 단락으로 서술
- 화자별 주요 발언이 있다면 화자 구분하여 표시

## 다음 해야할 일
- 액션 아이템을 \`- [ ] 담당자: 할 일 (기한)\` 형식의 체크리스트로 작성
- 최소 3개 이상

## 영업 인사이트
- 이번 미팅에서 도출된 영업적 시사점, 후속 전략, 주의사항을 간결하게 서술

전체적으로 실무 영업 담당자가 바로 활용할 수 있도록 구체적이고 명확하게 작성하세요.`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.5,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const result = await model.generateContent(prompt);
    await logTokenUsage('meeting-summary', result.response.usageMetadata, MODEL_FAST, userId);
    res.json({ success: true, data: { summary_md: result.response.text() } });
  } catch (err) {
    console.error('Meeting summarize error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 3) 회의록 CRUD
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.title, m.meeting_date, m.customer_name, m.lead_id,
              m.calendar_event_id, m.created_at,
              SUBSTRING(m.summary_md, 1, 200) AS summary_preview,
              t.name AS created_by_name
       FROM meeting_minutes m LEFT JOIN team_members t ON m.created_by = t.id
       ORDER BY m.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 익스포트 (xlsx/csv/json) — ⚠️ /:id 보다 먼저 등록 ────────
router.get('/export', async (req, res) => {
  try {
    const { search, customer_name } = req.query;
    const cond = [],
      params = [];
    if (customer_name) {
      cond.push('m.customer_name = ?');
      params.push(customer_name);
    }
    if (search) {
      cond.push('(m.title LIKE ? OR m.summary_md LIKE ? OR m.key_points LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT m.id, m.title, m.meeting_date, m.customer_name,
              m.audio_duration_sec, m.created_at,
              SUBSTRING(m.summary_md, 1, 200) AS summary_preview,
              t.name AS created_by_name
         FROM meeting_minutes m
         LEFT JOIN team_members t ON m.created_by = t.id
        ${where}
        ORDER BY m.created_at DESC
        LIMIT 2000`,
      params
    );
    await sendExport(res, {
      columns: MEETING_COLS,
      rows,
      sheetName: '회의록',
      filename: '회의록_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT m.*, t.name AS created_by_name FROM meeting_minutes m
       LEFT JOIN team_members t ON m.created_by = t.id WHERE m.id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, error: '회의록 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      title,
      meeting_date,
      raw_transcript,
      speakers_json,
      summary_md,
      customer_name,
      lead_id,
    } = req.body;
    const [result] = await pool.query(
      `INSERT INTO meeting_minutes
       (title, meeting_date, raw_transcript, speakers_json, summary_md,
        customer_name, lead_id, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        title || `회의록 ${new Date().toISOString().slice(0, 10)}`,
        meeting_date || new Date().toISOString().slice(0, 10),
        raw_transcript || null,
        speakers_json ? JSON.stringify(speakers_json) : null,
        summary_md || null,
        customer_name || null,
        lead_id || null,
        getUserId(req),
      ]
    );
    // Webhook 발행
    try {
      const wh = require('../services/webhookDispatcher');
      wh.emit('meeting.created', {
        id: result.insertId,
        title: title || `회의록 ${new Date().toISOString().slice(0, 10)}`,
        meeting_date: meeting_date || new Date().toISOString().slice(0, 10),
        customer_name: customer_name || null,
        lead_id: lead_id || null,
      });
    } catch (_) {
      /* 무시 */
    }
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = [
      'title',
      'meeting_date',
      'raw_transcript',
      'summary_md',
      'customer_name',
      'lead_id',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=?`);
        values.push(req.body[f] || null);
      }
    });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE meeting_minutes SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM meeting_minutes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 4) 회의록 → 캘린더 등록
router.post('/:id/register-calendar', async (req, res) => {
  try {
    const { customer_name, lead_id } = req.body;
    const [[meeting]] = await pool.query('SELECT * FROM meeting_minutes WHERE id = ?', [
      req.params.id,
    ]);
    if (!meeting) return res.status(404).json({ success: false, error: '회의록 없음' });

    const md = meeting.summary_md || '';
    const todoMatch = md.match(/##\s*다음 해야할\s*일\s*\n([\s\S]*?)(?=\n##|$)/);
    const todoSection = todoMatch ? todoMatch[1].trim() : '';
    const finalCustomer = (customer_name || meeting.customer_name || '').trim();

    // ① 제목: [미팅] 고객사명
    const meetingTitle = `[미팅] ${finalCustomer}`.trim();

    // mysql2 DATE 컬럼 → YYYY-MM-DD 문자열 변환 (duck-typing)
    const toYMD = d => {
      if (!d) return new Date().toISOString().slice(0, 10);
      if (typeof d.getFullYear === 'function') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      const s = String(d);
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      const p = new Date(s);
      if (!isNaN(p.getTime()))
        return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
      return new Date().toISOString().slice(0, 10);
    };
    const baseDate = toYMD(meeting.meeting_date);

    // ② lead_id 자동 매핑 (전달값 없으면 고객사명 기준 최신 리드)
    let resolvedLeadId = lead_id || meeting.lead_id || null;
    if (!resolvedLeadId && finalCustomer) {
      const [matched] = await pool.query(
        `SELECT id FROM leads WHERE customer_name = ? ORDER BY created_at DESC LIMIT 1`,
        [finalCustomer]
      );
      if (matched.length) resolvedLeadId = matched[0].id;
    }

    // ③ 메인 미팅 캘린더 이벤트
    // 핵심 내용 섹션에서 50자 요약 추출
    const coreMatch = md.match(/##\s*핵심\s*내용\s*\n([\s\S]*?)(?=\n##|$)/);
    const agendaMatch = md.match(/##\s*미팅\s*주요\s*어젠다\s*\n([\s\S]*?)(?=\n##|$)/);
    const rawSummary = (coreMatch?.[1] || agendaMatch?.[1] || md)
      .replace(/[#*`]/g, '')
      .replace(/\n+/g, ' ')
      .trim();
    const shortSummary = rawSummary.length > 50 ? rawSummary.substring(0, 50) + '...' : rawSummary;
    const description = `${shortSummary}\n\n[회의록 상세보기] meeting:${req.params.id}`;

    const [calMain] = await pool.query(
      `INSERT INTO calendar_events (title, description, start_datetime, end_datetime, all_day, event_type, status, lead_id, customer_name, color)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        meetingTitle,
        description,
        `${baseDate} 10:00:00`,
        `${baseDate} 11:00:00`,
        0,
        '미팅',
        'completed',
        resolvedLeadId,
        finalCustomer || null,
        '#1a73e8',
      ]
    );

    // ④ 액션 아이템 → 캘린더 (제목: [액션] 고객사 · 할일 최대 50자)
    const todoLines = todoSection
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.match(/^-\s*\[\s*[xX ]?\s*\]/) || l.match(/^[\d]+\.\s/) || l.match(/^-\s/));

    let actionEventCount = 0;
    for (let i = 0; i < todoLines.length; i++) {
      const raw = todoLines[i]
        .replace(/^-\s*\[\s*[xX ]?\s*\]\s*/, '')
        .replace(/^[\d]+\.\s*/, '')
        .replace(/^-\s*/, '')
        .replace(/\s*\([^)]{0,20}\)\s*$/, '') // 말미 괄호(기한 등) 제거
        .trim()
        .substring(0, 50);
      if (!raw) continue;
      const actionTitle = (
        finalCustomer ? `[액션] ${finalCustomer} · ${raw}` : `[액션] ${raw}`
      ).substring(0, 200);
      const target = new Date(baseDate);
      target.setDate(target.getDate() + i + 1);
      const dStr = target.toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO calendar_events (title, description, start_datetime, end_datetime, all_day, event_type, status, lead_id, customer_name, color)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          actionTitle,
          `${meeting.title} 후속 액션 아이템`,
          `${dStr} 14:00:00`,
          `${dStr} 15:00:00`,
          0,
          '기타',
          'planned',
          resolvedLeadId,
          finalCustomer || null,
          '#fd7e14',
        ]
      );
      actionEventCount++;
    }

    // ⑤ 회의록 업데이트
    await pool.query(
      'UPDATE meeting_minutes SET calendar_event_id=?, customer_name=?, lead_id=? WHERE id=?',
      [
        calMain.insertId,
        finalCustomer || meeting.customer_name,
        resolvedLeadId || meeting.lead_id,
        req.params.id,
      ]
    );

    // ⑥ 영업 활동 이력 자동 등록 (리드 연결 시)
    if (resolvedLeadId) {
      const actTitle = `[미팅] ${finalCustomer} - ${meeting.title}`;
      const actContent = md
        .replace(/#{1,3}\s*/g, '')
        .replace(/\*\*/g, '')
        .replace(/- \[[ xX]\]/g, '-')
        .substring(0, 300);
      try {
        await pool.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, performed_by, activity_date, calendar_event_id)
           VALUES (?,?,?,?,?,?,?)`,
          [
            resolvedLeadId,
            'meeting',
            actTitle,
            actContent,
            null,
            `${baseDate} 10:00:00`,
            calMain.insertId,
          ]
        );
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          await pool.query(
            `ALTER TABLE activities ADD COLUMN calendar_event_id INT NULL DEFAULT NULL`
          );
          await pool.query(
            `INSERT INTO activities (lead_id, activity_type, title, content, performed_by, activity_date, calendar_event_id)
             VALUES (?,?,?,?,?,?,?)`,
            [
              resolvedLeadId,
              'meeting',
              actTitle,
              actContent,
              null,
              `${baseDate} 10:00:00`,
              calMain.insertId,
            ]
          );
        }
        // 활동 등록 실패해도 캘린더 등록은 성공 처리
      }
    }

    res.json({
      success: true,
      data: {
        main_event_id: calMain.insertId,
        action_events_created: actionEventCount,
        lead_id: resolvedLeadId,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 익스포트 (xlsx/csv/json) ────────────────────────────────
module.exports = router;
