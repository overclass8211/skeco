// ============================================================
// bulkPasteHelper — 일괄 붙여넣기 등록 공통 백엔드 유틸 (v6.0.0)
//
// 책임:
//   1) 요청 행 수 제한 (200/req)
//   2) 서버 sanitize (제어 문자 / XSS / CSV 인젝션) — 클라이언트 우회 방어
//   3) 응답 형식 통일 {success, inserted, duplicates, errors:[{row,reason}]}
//
// 프론트 BulkPaste 와 짝을 이루는 보안 2중 검증 레이어.
// 클라이언트 검증을 우회한 공격(직접 API 호출)에서도 안전.
// ============================================================
'use strict';

const MAX_ROWS_PER_REQUEST = 200;
const MAX_CELL_LENGTH = 5000;

// XSS / 스크립트 / 위험 패턴
const RE_DANGEROUS = /<script\b|javascript:|on\w+\s*=|<iframe\b|<embed\b|<object\b/i;
// CSV 인젝션: 셀이 =, +, -, @ 로 시작
const RE_CSV_INJECTION = /^[=+\-@]/;
// 제어 문자 (RTL override / zero-width 등) — \u escape 로 명시
// eslint-disable-next-line no-control-regex
const RE_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/g;

/**
 * 단일 셀 sanitize — 위험 패턴 감지 시 throw
 * @param {*} value
 * @returns {string|number|boolean|null}
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let v = String(value);
  // 1) 제어 문자 strip
  v = v.replace(RE_CONTROL_CHARS, '');
  // 2) 위험 패턴 감지 → throw (행 reject)
  if (RE_DANGEROUS.test(v)) {
    const err = new Error('보안: 스크립트/태그 패턴 감지');
    err.code = 'SECURITY_VIOLATION';
    throw err;
  }
  // 3) CSV 인젝션: 앞에 ' 추가
  if (RE_CSV_INJECTION.test(v)) {
    v = "'" + v;
  }
  // 4) 길이 cut
  if (v.length > MAX_CELL_LENGTH) {
    v = v.slice(0, MAX_CELL_LENGTH);
  }
  return v.trim();
}

/**
 * 행 전체 sanitize — 객체 모든 필드를 sanitizeCell 적용
 * @param {object} row
 * @returns {object}
 */
function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCell(v);
  }
  return out;
}

/**
 * 요청 검증 — 행 수 / 형식 점검
 * @param {Array} rows
 * @returns {null | {code, status, message}}
 */
function validateRequest(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { code: 'EMPTY', status: 400, message: '등록할 데이터가 없습니다.' };
  }
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return {
      code: 'TOO_MANY',
      status: 400,
      message: `한 번에 등록 가능한 최대 행 수는 ${MAX_ROWS_PER_REQUEST}개입니다. (요청: ${rows.length}개)`,
    };
  }
  return null;
}

/**
 * 응답 빌더 — 공통 응답 포맷
 * { success: true, inserted, duplicates, errors: [{row, reason}], insertedIds }
 */
function buildResponse({ inserted = [], duplicates = [], errors = [] } = {}) {
  return {
    success: true,
    inserted: inserted.length,
    duplicates: duplicates.length,
    errors: [...duplicates, ...errors], // 프론트가 reason 으로 구분
    insertedIds: inserted, // (옵션) inserted id 배열
  };
}

module.exports = {
  MAX_ROWS_PER_REQUEST,
  MAX_CELL_LENGTH,
  sanitizeCell,
  sanitizeRow,
  validateRequest,
  buildResponse,
};
