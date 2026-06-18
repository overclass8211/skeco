/**
 * validate 미들웨어 단위 테스트 — DB 불필요
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireFields, sanitizeQuery, validateId } = require('../../src/middleware/validate.js');

const next = vi.fn();
const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// ── requireFields ─────────────────────────────────────────────
describe('requireFields', () => {
  it('모든 필드 존재 → next() 호출', () => {
    next.mockClear();
    const req = { body: { name: 'OCI', email: 'a@b.com' } };
    requireFields(['name', 'email'])(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('필드 누락 → 400 반환', () => {
    const res = makeRes();
    const req = { body: { name: 'OCI' } };
    requireFields(['name', 'email'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'VALIDATION_ERROR',
        field: 'email',
      })
    );
  });

  it('빈 문자열도 누락으로 처리', () => {
    const res = makeRes();
    requireFields(['name'])({ body: { name: '' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('null 값도 누락으로 처리', () => {
    const res = makeRes();
    requireFields(['name'])({ body: { name: null } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('첫 번째 누락 필드를 오류로 반환', () => {
    const res = makeRes();
    requireFields(['a', 'b', 'c'])({ body: {} }, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field: 'a' }));
  });
});

// ── sanitizeQuery ─────────────────────────────────────────────
describe('sanitizeQuery', () => {
  it('빈 문자열 쿼리 파라미터를 undefined 로 변환', () => {
    next.mockClear();
    const req = { query: { stage: '', page: '1', type: '' } };
    sanitizeQuery(req, makeRes(), next);
    expect(req.query.stage).toBeUndefined();
    expect(req.query.type).toBeUndefined();
    expect(req.query.page).toBe('1');
    expect(next).toHaveBeenCalledOnce();
  });

  it('쿼리 없으면 그냥 통과', () => {
    next.mockClear();
    const req = { query: {} };
    sanitizeQuery(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ── validateId ────────────────────────────────────────────────
describe('validateId', () => {
  it('유효한 정수 ID → 숫자로 변환 후 next()', () => {
    next.mockClear();
    const req = { params: { id: '42' } };
    validateId(req, makeRes(), next);
    expect(req.params.id).toBe(42);
    expect(next).toHaveBeenCalledOnce();
  });

  it('문자열 ID → 400', () => {
    const res = makeRes();
    validateId({ params: { id: 'abc' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('0 → 400', () => {
    const res = makeRes();
    validateId({ params: { id: '0' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('음수 → 400', () => {
    const res = makeRes();
    validateId({ params: { id: '-5' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('ID 없음 → 400', () => {
    const res = makeRes();
    validateId({ params: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
