/**
 * Auth API 통합 테스트 — 로그인 실패 케이스 + 사용자 관리
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let createdUserId;

beforeAll(async () => {
  await pool.query("DELETE FROM team_members WHERE name LIKE '__TEST_AUTH_%'");
  await pool.query("DELETE FROM users WHERE username LIKE '__test_auth_%'");
});

afterAll(async () => {
  if (createdUserId) await pool.query('DELETE FROM users WHERE id = ?', [createdUserId]);
});

describe('Auth — 로그인', () => {
  it('username/password 누락 → 400', async () => {
    const res = await api().post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('잘못된 비밀번호 → 401', async () => {
    const res = await api().post('/api/auth/login').send({
      username: 'admin',
      password: 'wrongpassword_xyz_12345',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('존재하지 않는 계정 → 401', async () => {
    const res = await api().post('/api/auth/login').send({
      username: '__nonexistent_user__',
      password: 'anything',
    });
    expect(res.status).toBe(401);
  });
});

describe('Auth — 사용자 관리 (GET /users)', () => {
  it('GET /api/auth/users — 목록 조회', async () => {
    const res = await api().get('/api/auth/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/auth/users — 신규 계정 생성', async () => {
    // 먼저 team_member 생성
    const [tm] = await pool.query(
      "INSERT INTO team_members (name, role) VALUES ('__TEST_AUTH_홍길동', 'Sales')"
    );
    const tmId = tm.insertId;

    const res = await api().post('/api/auth/users').send({
      username: '__test_auth_hong',
      password: 'TestPass!1234',
      full_name: '__TEST_AUTH_홍길동',
      role: 'manager',
      email: '__test_auth_hong@oci.com',
      team_member_id: tmId,
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdUserId = res.body.id;

    // team_member 정리
    await pool.query('DELETE FROM team_members WHERE id = ?', [tmId]);
  });

  it('POST /api/auth/users — 중복 username → 409 또는 오류', async () => {
    const res = await api().post('/api/auth/users').send({
      username: '__test_auth_hong',
      password: 'AnotherPass!1',
      full_name: '중복테스트',
      role: 'manager',
    });
    expect([400, 409, 500]).toContain(res.status);
  });

  it('PUT /api/auth/users/:id — 정보 수정', async () => {
    if (!createdUserId) return;
    const res = await api().put(`/api/auth/users/${createdUserId}`).send({
      full_name: '__TEST_AUTH_수정됨',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/auth/users/:id — 비활성화', async () => {
    if (!createdUserId) return;
    const res = await api().delete(`/api/auth/users/${createdUserId}`);
    expect(res.status).toBe(200);
  });
});
