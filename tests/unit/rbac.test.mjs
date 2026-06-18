/**
 * rbac 미들웨어 단위 테스트
 * process.env.NODE_ENV 변경은 반드시 try/finally 로 원복
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { signToken } = require('../../src/services/authService.js');
const rbac = require('../../src/middleware/rbac.js');

// 모든 테스트 후 NODE_ENV 반드시 'test' 로 복원
afterEach(() => {
  process.env.NODE_ENV = 'test';
});

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// ── authenticate ──────────────────────────────────────────────
describe('authenticate (non-test env)', () => {
  it('Authorization 헤더 없으면 401', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    const next = vi.fn();
    rbac.authenticate({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('유효한 JWT → req.user 주입 + next()', async () => {
    process.env.NODE_ENV = 'production';
    const { token } = signToken({
      id: 1,
      username: 'alice',
      full_name: '앨리스',
      role: 'manager',
      email: 'a@t.com',
    });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = vi.fn();
    await rbac.authenticate(req, makeRes(), next);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('위조 토큰 → 401', async () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    const next = vi.fn();
    await rbac.authenticate({ headers: { authorization: 'Bearer fake.token.here' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── requireLevel ──────────────────────────────────────────────
describe('requireLevel (non-test env)', () => {
  it('충분한 level → next()', () => {
    process.env.NODE_ENV = 'production';
    const next = vi.fn();
    rbac.requireLevel(2)({ user: { role: 'executive' } }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('level 부족 → 403', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    rbac.requireLevel(3)({ user: { role: 'manager' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('req.user 없으면 401', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    rbac.requireLevel(1)({ user: null }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── autoLevel ─────────────────────────────────────────────────
describe('autoLevel (non-test env)', () => {
  it('manager 가 /admin 접근 시 403 (req.path = /api 이후 경로)', () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();
    // app.use('/api', autoLevel) → req.path 는 '/admin/...'
    rbac.autoLevel({ user: { role: 'manager' }, path: '/admin/stats' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('executive 가 /admin 접근 허용', () => {
    process.env.NODE_ENV = 'production';
    const next = vi.fn();
    rbac.autoLevel({ user: { role: 'executive' }, path: '/admin/stats' }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('req.user 없으면 그냥 next (authenticate 가 먼저 막음)', () => {
    process.env.NODE_ENV = 'production';
    const next = vi.fn();
    rbac.autoLevel({ user: null, path: '/dashboard' }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
