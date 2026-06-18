// =============================================================
// Global Search — Cmd+K 통합 검색
//   GET /api/search?q=<keyword>&types=<csv>&limit=<n>
//
// 검색 대상 (기본 5개):
//   • leads          — 영업 리드 (회사·프로젝트·메모·소스)
//   • customers      — 고객사 (이름·담당자·전화·이메일·산업·메모)
//   • projects       — 프로젝트 (이름·고객·유형·메모)
//   • meetings       — 회의록 (제목·요약·핵심내용·원본 일부)
//   • activities     — 활동 (제목·내용·유형)
//
// 검색 방식: LIKE '%keyword%' 기반 (한국어·짧은 토큰 친화)
//   - 결과는 카테고리별로 그룹화하여 반환
//   - 각 카테고리별 limit 적용 (기본 5)
//   - 한 번에 한 쿼리 (Promise.all 로 병렬 실행)
//
// 응답 스키마:
//   {
//     success: true,
//     data: {
//       query: "검색어",
//       total: 12,
//       results: {
//         leads:      [{ id, type, title, subtitle, snippet, meta }],
//         customers:  [...],
//         projects:   [...],
//         meetings:   [...],
//         activities: [...]
//       }
//     }
//   }
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { requireFeature } = require('../middleware/featureGuard');

// 글로벌 검색 전체에 feature flag 적용
router.use(requireFeature('crm.search'));

const ALLOWED_TYPES = new Set(['leads', 'customers', 'projects', 'meetings', 'activities']);
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// 검색어 안전성 검증
function sanitizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  // 트림 + 길이 제한 (DoS 방지)
  const trimmed = raw.trim().slice(0, 100);
  // 빈 검색어, 와일드카드만 입력된 경우 거부
  if (!trimmed || /^[%_*\s]+$/.test(trimmed)) return '';
  return trimmed;
}

// LIKE 패턴 이스케이프 (%/_ 를 리터럴로 처리)
function escapeLike(s) {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`);
}

// 짧은 스니펫 생성 — 매치된 부분 주변 텍스트 추출
function makeSnippet(text, q, ctx = 40) {
  if (!text) return '';
  const str = String(text);
  const lower = str.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return str.slice(0, ctx * 2);
  const start = Math.max(0, idx - ctx);
  const end = Math.min(str.length, idx + q.length + ctx);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < str.length ? '…' : '';
  return prefix + str.slice(start, end).replace(/\s+/g, ' ') + suffix;
}

// 각 엔티티별 검색 함수 — 컬럼별 LIKE OR 결합
const SEARCHERS = {
  async leads(q, limit) {
    const pat = `%${escapeLike(q)}%`;
    const [rows] = await pool.query(
      `SELECT id, customer_name, project_name, stage, business_type,
              expected_amount, currency, assigned_to, notes, source,
              created_at
         FROM leads
        WHERE customer_name LIKE ? OR project_name LIKE ?
              OR notes LIKE ? OR source LIKE ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
      [pat, pat, pat, pat, limit]
    );
    return rows.map(r => ({
      id: r.id,
      type: 'leads',
      title: r.project_name || '(제목 없음)',
      subtitle: r.customer_name || '',
      snippet: makeSnippet(r.notes || r.source || '', q),
      meta: {
        stage: r.stage,
        business: r.business_type,
        amount: r.expected_amount,
        currency: r.currency,
      },
      route: `#leads?id=${r.id}`,
    }));
  },

  async customers(q, limit) {
    const pat = `%${escapeLike(q)}%`;
    const [rows] = await pool.query(
      `SELECT id, name, region, country, industry,
              contact_person, phone, email, notes, created_at
         FROM customers
        WHERE name LIKE ? OR contact_person LIKE ?
              OR phone LIKE ? OR email LIKE ?
              OR industry LIKE ? OR notes LIKE ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
      [pat, pat, pat, pat, pat, pat, limit]
    );
    return rows.map(r => ({
      id: r.id,
      type: 'customers',
      title: r.name,
      subtitle: [r.contact_person, r.industry].filter(Boolean).join(' · '),
      snippet: makeSnippet(r.notes || `${r.email || ''} ${r.phone || ''}`.trim(), q),
      meta: {
        region: r.region,
        country: r.country,
        email: r.email,
        phone: r.phone,
      },
      route: `#customers?id=${r.id}`,
    }));
  },

  async projects(q, limit) {
    const pat = `%${escapeLike(q)}%`;
    const [rows] = await pool.query(
      `SELECT id, name, customer_name, project_type, status,
              contract_amount, due_date, notes
         FROM projects
        WHERE name LIKE ? OR customer_name LIKE ?
              OR project_type LIKE ? OR notes LIKE ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
      [pat, pat, pat, pat, limit]
    );
    return rows.map(r => ({
      id: r.id,
      type: 'projects',
      title: r.name,
      subtitle: r.customer_name || '',
      snippet: makeSnippet(r.notes || '', q),
      meta: {
        status: r.status,
        type: r.project_type,
        amount: r.contract_amount,
        due: r.due_date,
      },
      route: `#projects?id=${r.id}`,
    }));
  },

  async meetings(q, limit) {
    const pat = `%${escapeLike(q)}%`;
    // raw_transcript 는 MEDIUMTEXT — 검색은 하되 결과 텍스트에는 직접 노출 X
    const [rows] = await pool.query(
      `SELECT id, title, meeting_date, customer_name,
              summary_md, key_points, agenda,
              audio_duration_sec
         FROM meeting_minutes
        WHERE title LIKE ? OR summary_md LIKE ?
              OR key_points LIKE ? OR agenda LIKE ?
              OR raw_transcript LIKE ?
        ORDER BY meeting_date DESC, id DESC
        LIMIT ?`,
      [pat, pat, pat, pat, pat, limit]
    );
    return rows.map(r => ({
      id: r.id,
      type: 'meetings',
      title: r.title || '(제목 없음)',
      subtitle: r.customer_name || '',
      snippet: makeSnippet(r.key_points || r.summary_md || r.agenda || '', q),
      meta: {
        date: r.meeting_date,
        duration: r.audio_duration_sec,
      },
      route: `#meeting-list?id=${r.id}`,
    }));
  },

  async activities(q, limit) {
    const pat = `%${escapeLike(q)}%`;
    const [rows] = await pool.query(
      `SELECT a.id, a.lead_id, a.project_id, a.activity_type,
              a.title, a.content, a.performed_at,
              l.customer_name AS lead_customer,
              p.name AS project_name
         FROM activities a
         LEFT JOIN leads    l ON a.lead_id    = l.id
         LEFT JOIN projects p ON a.project_id = p.id
        WHERE a.title LIKE ? OR a.content LIKE ? OR a.activity_type LIKE ?
        ORDER BY a.performed_at DESC, a.id DESC
        LIMIT ?`,
      [pat, pat, pat, limit]
    );
    return rows.map(r => ({
      id: r.id,
      type: 'activities',
      title: r.title || `${r.activity_type || '활동'}`,
      subtitle: r.lead_customer || r.project_name || '',
      snippet: makeSnippet(r.content || '', q),
      meta: {
        type: r.activity_type,
        performed: r.performed_at,
        leadId: r.lead_id,
        projectId: r.project_id,
      },
      route: r.lead_id
        ? `#leads?id=${r.lead_id}`
        : r.project_id
          ? `#projects?id=${r.project_id}`
          : '#',
    }));
  },
};

// GET /api/search
router.get('/', async (req, res) => {
  try {
    const q = sanitizeQuery(req.query.q);
    if (!q) {
      return res.json({
        success: true,
        data: { query: '', total: 0, results: {} },
      });
    }

    // 검색 대상 결정 (types 쿼리 파라미터로 제한 가능)
    let types;
    if (req.query.types) {
      const requested = String(req.query.types)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      types = requested.filter(t => ALLOWED_TYPES.has(t));
      if (!types.length) types = [...ALLOWED_TYPES];
    } else {
      types = [...ALLOWED_TYPES];
    }

    // 카테고리별 limit (총 합은 5*5=25 이내)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // 병렬 실행
    const tasks = types.map(t =>
      SEARCHERS[t](q, limit)
        .then(rows => [t, rows])
        .catch(err => {
          // 한 카테고리 실패해도 전체는 진행
          console.error(`[search] ${t} failed:`, err.message);
          return [t, []];
        })
    );
    const settled = await Promise.all(tasks);

    const results = {};
    let total = 0;
    for (const [type, rows] of settled) {
      results[type] = rows;
      total += rows.length;
    }

    res.json({
      success: true,
      data: { query: q, total, results },
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
