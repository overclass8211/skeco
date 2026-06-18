'use strict';
/**
 * 입력 검증 미들웨어 모음
 * - requireFields: 필수 필드 존재 확인
 * - validateId   : :id 파라미터 양의 정수 확인
 * - sanitizeQuery: 빈 쿼리스트링 → undefined
 * - schema       : 타입·범위·패턴 기반 스키마 검증
 */

// ─────────────────────────────────────────────
// 기존 헬퍼 (하위 호환 유지)
// ─────────────────────────────────────────────

function requireFields(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const val = req.body[field];
      if (val === undefined || val === null || val === '') {
        return res.status(400).json({
          success: false,
          error: `필수 항목 누락: ${field}`,
          code: 'VALIDATION_ERROR',
          field,
        });
      }
    }
    next();
  };
}

function sanitizeQuery(req, _res, next) {
  for (const key of Object.keys(req.query)) {
    if (req.query[key] === '') req.query[key] = undefined;
  }
  next();
}

function validateId(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (!req.params.id || isNaN(id) || id < 1) {
    return res
      .status(400)
      .json({ success: false, error: '유효하지 않은 ID입니다.', code: 'VALIDATION_ERROR' });
  }
  req.params.id = id;
  next();
}

// ─────────────────────────────────────────────
// 스키마 검증 엔진
// ─────────────────────────────────────────────

/**
 * 필드 정의:
 *   { type, required, min, max, minLen, maxLen, pattern, enum: [], custom }
 *
 * 사용 예:
 *   validate.schema({
 *     username: { type:'string', required:true, minLen:2, maxLen:50 },
 *     age:      { type:'number', min:0, max:150 },
 *     role:     { type:'string', enum:['manager','team_lead'] },
 *   })
 */
function schema(defs) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(defs)) {
      const raw = req.body[field];
      const missing = raw === undefined || raw === null || raw === '';

      if (rules.required && missing) {
        errors.push({ field, message: `필수 항목입니다: ${field}` });
        continue;
      }
      if (missing) continue; // optional 필드 — 없으면 나머지 검사 생략

      // 타입 검사
      if (rules.type === 'string' && typeof raw !== 'string') {
        errors.push({ field, message: `${field}은(는) 문자열이어야 합니다.` });
        continue;
      }
      if (rules.type === 'number') {
        const n = Number(raw);
        if (isNaN(n)) {
          errors.push({ field, message: `${field}은(는) 숫자여야 합니다.` });
          continue;
        }
        req.body[field] = n; // 자동 캐스팅
        if (rules.min !== undefined && n < rules.min)
          errors.push({ field, message: `${field}은(는) ${rules.min} 이상이어야 합니다.` });
        if (rules.max !== undefined && n > rules.max)
          errors.push({ field, message: `${field}은(는) ${rules.max} 이하여야 합니다.` });
      }
      if (rules.type === 'boolean') {
        if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') {
          errors.push({ field, message: `${field}은(는) boolean이어야 합니다.` });
          continue;
        }
        req.body[field] = raw === true || raw === 'true';
      }
      if (rules.type === 'date') {
        if (isNaN(Date.parse(raw))) {
          errors.push({ field, message: `${field}은(는) 유효한 날짜여야 합니다.` });
          continue;
        }
      }

      // 문자열 길이
      if (typeof raw === 'string') {
        if (rules.minLen !== undefined && raw.length < rules.minLen)
          errors.push({
            field,
            message: `${field}은(는) 최소 ${rules.minLen}자 이상이어야 합니다.`,
          });
        if (rules.maxLen !== undefined && raw.length > rules.maxLen)
          errors.push({ field, message: `${field}은(는) 최대 ${rules.maxLen}자 이하여야 합니다.` });
      }

      // 열거형
      if (rules.enum && !rules.enum.includes(raw)) {
        errors.push({
          field,
          message: `${field}은(는) [${rules.enum.join(', ')}] 중 하나여야 합니다.`,
        });
      }

      // 정규식 패턴
      if (rules.pattern && typeof raw === 'string' && !rules.pattern.test(raw)) {
        errors.push({ field, message: rules.patternMsg || `${field} 형식이 올바르지 않습니다.` });
      }

      // 커스텀 검증
      if (rules.custom) {
        const result = rules.custom(raw, req.body);
        if (result !== true) errors.push({ field, message: result || `${field} 검증 실패` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: errors[0].message,
        code: 'VALIDATION_ERROR',
        field: errors[0].field,
        errors,
      });
    }
    next();
  };
}

// ─────────────────────────────────────────────
// 공통 패턴 상수
// ─────────────────────────────────────────────
const PATTERNS = {
  username: /^[a-zA-Z0-9_-]{2,50}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  isoDate: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/,
  noScript: /^(?!.*<script).*$/i, // XSS 기초 차단
};

// ─────────────────────────────────────────────
// 도메인별 미리 정의된 스키마
// ─────────────────────────────────────────────
const SCHEMAS = {
  login: {
    username: { type: 'string', required: true, minLen: 1, maxLen: 100 },
    password: { type: 'string', required: true, minLen: 1, maxLen: 200 },
  },
  createUser: {
    username: {
      type: 'string',
      required: true,
      minLen: 2,
      maxLen: 50,
      pattern: PATTERNS.username,
      patternMsg: '아이디는 영문/숫자/밑줄 2~50자여야 합니다.',
    },
    password: { type: 'string', required: true, minLen: 4, maxLen: 200 },
    email: {
      type: 'string',
      maxLen: 100,
      pattern: PATTERNS.email,
      patternMsg: '이메일 형식이 올바르지 않습니다.',
    },
    role: { type: 'string', enum: ['manager', 'team_lead', 'executive', 'superadmin'] },
  },
  createLead: {
    customer_name: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    project_name: { type: 'string', required: true, minLen: 1, maxLen: 300 },
    stage: { type: 'string', maxLen: 50 }, // 동적 검증 (pipeline_stages 테이블 기반, 라우터에서 별도 확인)
    expected_amount: { type: 'number', min: 0 },
    region: { type: 'string', maxLen: 50 },
  },
  createCustomer: {
    customer_name: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    region: { type: 'string', maxLen: 100 },
  },
  createActivity: {
    lead_id: { type: 'number', required: true, min: 1 },
    activity_type: { type: 'string', required: true, maxLen: 50 },
  },
  createCalendar: {
    title: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    start_datetime: { type: 'date', required: true },
  },
  createAnnouncement: {
    title: { type: 'string', required: true, minLen: 1, maxLen: 300 },
    content: { type: 'string', required: true, minLen: 1 },
  },
  createTeamMember: {
    name: { type: 'string', required: true, minLen: 1, maxLen: 100 },
    email: {
      type: 'string',
      maxLen: 100,
      pattern: PATTERNS.email,
      patternMsg: '이메일 형식이 올바르지 않습니다.',
    },
  },
  createProduct: {
    name: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    cost: { type: 'number', min: 0 },
  },
};

module.exports = { requireFields, sanitizeQuery, validateId, schema, SCHEMAS, PATTERNS };
