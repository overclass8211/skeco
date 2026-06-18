/**
 * Team API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM team_members WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) await pool.query('DELETE FROM team_members WHERE id = ?', [createdId]);
});

describe('Team API', () => {
  it('GET /api/team — 목록 조회', async () => {
    const res = await api().get('/api/team');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 신규 팀원 등록', async () => {
    const res = await api().post('/api/team').send({
      name: '__TEST__홍길동',
      role: 'Sales',
      team: '국내팀',
      email: '__test__hong@oci.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('PUT /:id — 정보 수정', async () => {
    const res = await api().put(`/api/team/${createdId}`).send({ team: '해외팀' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /:id — 변경 없이 호출해도 200', async () => {
    const res = await api().put(`/api/team/${createdId}`).send({});
    expect(res.status).toBe(200);
  });

  it('DELETE /:id — 비활성화 (소프트 삭제)', async () => {
    const res = await api().delete(`/api/team/${createdId}`);
    expect(res.status).toBe(200);
  });
});
