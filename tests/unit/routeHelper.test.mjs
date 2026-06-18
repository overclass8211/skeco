/**
 * routeHelper 단위 테스트 — DB 불필요
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildPatch, asyncRoute } = require('../../src/utils/routeHelper.js');

// ── buildPatch ────────────────────────────────────────────────
describe('buildPatch', () => {
  it('허용 필드만 포함', () => {
    const result = buildPatch({ name: 'Alice', secret: 'x' }, ['name', 'email']);
    expect(result).toEqual({ sql: 'name = ?', values: ['Alice'] });
  });

  it('여러 필드 처리', () => {
    const result = buildPatch({ name: 'A', email: 'a@b.com' }, ['name', 'email']);
    expect(result).toEqual({ sql: 'name = ?, email = ?', values: ['A', 'a@b.com'] });
  });

  it('업데이트 가능한 필드 없으면 null 반환', () => {
    expect(buildPatch({ secret: 'x' }, ['name', 'email'])).toBeNull();
  });

  it('빈 body는 null 반환', () => {
    expect(buildPatch({}, ['name'])).toBeNull();
  });

  it('null 값은 포함 (명시적 null 업데이트)', () => {
    const result = buildPatch({ name: null }, ['name']);
    expect(result).toEqual({ sql: 'name = ?', values: [null] });
  });

  it('undefined 값은 제외', () => {
    expect(buildPatch({ name: undefined }, ['name'])).toBeNull();
  });
});

// ── asyncRoute ────────────────────────────────────────────────
describe('asyncRoute', () => {
  const makeRes = () => {
    const res = { headersSent: false };
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  it('정상 핸들러는 next 미호출로 완료', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn();
    const req = {};
    const res = makeRes();

    await asyncRoute(handler)(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('헤더 미전송 시 에러는 handleError 로 위임', async () => {
    const err = new Error('db fail');
    const handler = vi.fn().mockRejectedValue(err);
    const next = vi.fn();
    const req = {};
    const res = makeRes();

    await asyncRoute(handler)(req, res, next);
    // handleError → res.json 호출됨
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('헤더 이미 전송된 경우 next(err) 호출', async () => {
    const err = new Error('stream error');
    const handler = vi.fn().mockRejectedValue(err);
    const next = vi.fn();
    const req = {};
    const res = makeRes();
    res.headersSent = true;

    await asyncRoute(handler)(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
