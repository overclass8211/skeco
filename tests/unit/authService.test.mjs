/**
 * authService 단위 테스트 — DB 불필요
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  generateOtpSecret,
  generateOtpUri,
  verifyOtp,
  getRoleInfo,
  canAccessPage,
  getRequiredLevel,
  ROLES,
} = require('../../src/services/authService.js');

// ── 비밀번호 해시 ─────────────────────────────────────────────
describe('hashPassword / verifyPassword', () => {
  it('해시 후 검증 성공', async () => {
    const hash = await hashPassword('mysecret');
    expect(hash).not.toBe('mysecret');
    expect(await verifyPassword('mysecret', hash)).toBe(true);
  });

  it('틀린 비밀번호는 false', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

// ── JWT ───────────────────────────────────────────────────────
describe('signToken / verifyToken', () => {
  const user = {
    id: 1,
    username: 'alice',
    full_name: '앨리스',
    role: 'manager',
    email: 'a@test.com',
  };

  it('토큰 생성 후 검증 성공', () => {
    const { token, jti } = signToken(user);
    expect(typeof token).toBe('string');
    expect(typeof jti).toBe('string');
    const payload = verifyToken(token);
    expect(payload.id).toBe(1);
    expect(payload.username).toBe('alice');
    expect(payload.role).toBe('manager');
    // 중요 정보는 payload에 포함되지 않아야 함
    expect(payload.email).toBeUndefined();
    expect(payload.full_name).toBeUndefined();
  });

  it('위조된 토큰은 예외 발생', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('다른 secret으로 서명된 토큰은 거부', () => {
    const jwt = require('jsonwebtoken');
    const fakeToken = jwt.sign({ id: 99 }, 'wrong-secret');
    expect(() => verifyToken(fakeToken)).toThrow();
  });
});

// ── OTP ───────────────────────────────────────────────────────
describe('OTP', () => {
  it('secret 생성은 문자열 반환', () => {
    const secret = generateOtpSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(10);
  });

  it('keyUri 형식 검증', () => {
    const secret = generateOtpSecret();
    const uri = generateOtpUri(secret, 'testuser');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('testuser');
  });

  it('잘못된 OTP 코드는 false', () => {
    const secret = generateOtpSecret();
    expect(verifyOtp('000000', secret)).toBe(false);
  });
});

// ── RBAC 헬퍼 ─────────────────────────────────────────────────
describe('getRoleInfo', () => {
  it('알려진 역할 반환', () => {
    expect(getRoleInfo('manager').level).toBe(1);
    expect(getRoleInfo('superadmin').level).toBe(5);
  });

  it('알 수 없는 역할은 manager 반환', () => {
    expect(getRoleInfo('unknown').level).toBe(1);
  });

  it('ROLES 에 5개 역할 정의', () => {
    expect(Object.keys(ROLES)).toHaveLength(5);
  });
});

describe('canAccessPage', () => {
  it('manager는 dashboard 접근 가능', () => {
    expect(canAccessPage('manager', 'dashboard')).toBe(true);
  });

  it('manager는 admin 접근 불가', () => {
    expect(canAccessPage('manager', 'admin')).toBe(false);
  });

  it('superadmin은 모든 페이지 접근 가능', () => {
    expect(canAccessPage('superadmin', 'admin')).toBe(true);
    expect(canAccessPage('superadmin', 'any-page')).toBe(true);
  });

  it('알 수 없는 역할은 manager 정책 적용', () => {
    expect(canAccessPage('ghost', 'dashboard')).toBe(true);
    expect(canAccessPage('ghost', 'admin')).toBe(false);
  });
});

describe('getRequiredLevel', () => {
  // autoLevel 은 /api 하위 미들웨어 → req.path 에서 /api 가 제거된 경로를 전달
  it('/admin/team-members 는 level 4', () => {
    expect(getRequiredLevel('/admin/team-members')).toBe(4);
  });

  it('/admin 는 level 3', () => {
    expect(getRequiredLevel('/admin')).toBe(3);
  });

  it('/team 는 level 2', () => {
    expect(getRequiredLevel('/team')).toBe(2);
  });

  it('일반 경로는 level 1', () => {
    expect(getRequiredLevel('/leads')).toBe(1);
    expect(getRequiredLevel('/dashboard')).toBe(1);
  });
});
