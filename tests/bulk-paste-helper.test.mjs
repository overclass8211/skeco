/**
 * BulkPaste Helper — 단위 테스트 (서버 sanitize / 행 수 제한 / 응답 빌더)
 *
 * 목표:
 *   - sanitizeCell: 제어 문자 strip, XSS throw, CSV 인젝션 prefix, 길이 cut
 *   - sanitizeRow: 객체 전체 sanitize
 *   - validateRequest: 빈/초과 행 수
 *   - buildResponse: 통일된 응답 포맷
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  sanitizeCell,
  sanitizeRow,
  validateRequest,
  buildResponse,
  MAX_ROWS_PER_REQUEST,
  MAX_CELL_LENGTH,
} = require('../src/utils/bulkPasteHelper');

describe('BulkPaste Helper — sanitizeCell', () => {
  it('일반 문자열 — trim 후 반환', () => {
    expect(sanitizeCell('  hello  ')).toBe('hello');
  });

  it('null/undefined → null', () => {
    expect(sanitizeCell(null)).toBeNull();
    expect(sanitizeCell(undefined)).toBeNull();
  });

  it('숫자/boolean → 그대로 통과', () => {
    expect(sanitizeCell(42)).toBe(42);
    expect(sanitizeCell(true)).toBe(true);
  });

  it('<script> 태그 감지 → throw', () => {
    expect(() => sanitizeCell('<script>alert(1)</script>')).toThrow();
    expect(() => sanitizeCell('<SCRIPT src="x">')).toThrow();
  });

  it('javascript: URL → throw', () => {
    expect(() => sanitizeCell('javascript:alert(1)')).toThrow();
  });

  it('on* 이벤트 핸들러 → throw', () => {
    expect(() => sanitizeCell('<img onerror=alert(1)>')).toThrow();
  });

  it('<iframe> / <embed> / <object> → throw', () => {
    expect(() => sanitizeCell('<iframe src="x">')).toThrow();
    expect(() => sanitizeCell('<embed src="x">')).toThrow();
    expect(() => sanitizeCell('<object data="x">')).toThrow();
  });

  it('CSV 인젝션: =, +, -, @ 로 시작 → 앞에 " 추가', () => {
    expect(sanitizeCell('=SUM(1+1)')).toMatch(/^'=/);
    expect(sanitizeCell('+1234')).toMatch(/^'\+/);
    expect(sanitizeCell('-1234')).toMatch(/^'-/);
    expect(sanitizeCell('@user')).toMatch(/^'@/);
  });

  it('길이 5000 초과 → cut', () => {
    const long = 'a'.repeat(MAX_CELL_LENGTH + 100);
    const out = sanitizeCell(long);
    expect(out.length).toBeLessThanOrEqual(MAX_CELL_LENGTH);
  });

  it('제어 문자 (RTL override, zero-width) → strip', () => {
    const evil = 'hello‮world​!';
    const out = sanitizeCell(evil);
    expect(out).toBe('helloworld!');
  });

  it('일반 한글/영문 — 보존', () => {
    expect(sanitizeCell('OCI 솔루션')).toBe('OCI 솔루션');
    expect(sanitizeCell('test@example.com')).toBe('test@example.com');
  });
});

describe('BulkPaste Helper — sanitizeRow', () => {
  it('객체 전체 필드 sanitize', () => {
    const row = {
      name: '  Acme  ',
      email: 'hi@ex.com',
      junk: null,
      n: 42,
    };
    const out = sanitizeRow(row);
    expect(out.name).toBe('Acme');
    expect(out.email).toBe('hi@ex.com');
    expect(out.junk).toBeNull();
    expect(out.n).toBe(42);
  });

  it('위험 패턴 포함 시 throw (행 전체 reject)', () => {
    expect(() =>
      sanitizeRow({ name: 'OK', notes: '<script>bad</script>' })
    ).toThrow();
  });

  it('null/empty row → {}', () => {
    expect(sanitizeRow(null)).toEqual({});
    expect(sanitizeRow(undefined)).toEqual({});
  });
});

describe('BulkPaste Helper — validateRequest', () => {
  it('빈 배열 → 400 EMPTY', () => {
    const e = validateRequest([]);
    expect(e?.code).toBe('EMPTY');
    expect(e?.status).toBe(400);
  });

  it('null/undefined → 400 EMPTY', () => {
    expect(validateRequest(null)?.code).toBe('EMPTY');
    expect(validateRequest(undefined)?.code).toBe('EMPTY');
  });

  it(`행 수 ${MAX_ROWS_PER_REQUEST} 이하 → null (통과)`, () => {
    const rows = Array.from({ length: MAX_ROWS_PER_REQUEST }, () => ({}));
    expect(validateRequest(rows)).toBeNull();
  });

  it(`행 수 ${MAX_ROWS_PER_REQUEST + 1} 초과 → 400 TOO_MANY`, () => {
    const rows = Array.from({ length: MAX_ROWS_PER_REQUEST + 1 }, () => ({}));
    const e = validateRequest(rows);
    expect(e?.code).toBe('TOO_MANY');
    expect(e?.status).toBe(400);
    expect(e?.message).toContain(String(MAX_ROWS_PER_REQUEST));
  });
});

describe('BulkPaste Helper — buildResponse', () => {
  it('비어 있을 때 — 모두 0', () => {
    const r = buildResponse();
    expect(r.success).toBe(true);
    expect(r.inserted).toBe(0);
    expect(r.duplicates).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it('inserted/duplicates/errors 카운트', () => {
    const r = buildResponse({
      inserted: [1, 2, 3],
      duplicates: [{ row: {}, reason: '중복 (기존 ID:1)' }],
      errors: [{ row: {}, reason: '필수값 누락' }],
    });
    expect(r.inserted).toBe(3);
    expect(r.duplicates).toBe(1);
    // duplicates 와 errors 가 errors 배열에 합쳐짐
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].reason).toMatch(/중복/);
    expect(r.errors[1].reason).toBe('필수값 누락');
    expect(r.insertedIds).toEqual([1, 2, 3]);
  });
});
