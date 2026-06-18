/**
 * 엣지 케이스 테스트 — 404, 400, 잘못된 입력값 처리
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

describe('404 — 존재하지 않는 API 엔드포인트', () => {
  it('GET /api/nonexistent → 404 + success:false', async () => {
    const res = await api().get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('GET /api/leads/99999999 → 404 데이터 없음', async () => {
    const res = await api().get('/api/leads/99999999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('400 — 필수 필드 누락 및 잘못된 ID', () => {
  it('POST /api/leads — customer_name 누락 → 400', async () => {
    const res = await api().post('/api/leads').send({ project_name: '테스트' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.field).toBe('customer_name');
  });

  it('POST /api/leads — project_name 누락 → 400', async () => {
    const res = await api().post('/api/leads').send({ customer_name: '테스트고객사' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.field).toBe('project_name');
  });

  it('GET /api/leads/abc — 문자열 ID → 400', async () => {
    const res = await api().get('/api/leads/abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/leads/0 — 0 이하 ID → 400', async () => {
    const res = await api().get('/api/leads/0');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/leads/-1 — 음수 ID → 400', async () => {
    const res = await api().get('/api/leads/-1');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PATCH /api/leads/1/stage — stage 누락 → 400', async () => {
    const res = await api().patch('/api/leads/1/stage').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.field).toBe('stage');
  });

  it('POST /api/customers — name 누락 → 400', async () => {
    const res = await api().post('/api/customers').send({ region: '국내' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.field).toBe('name');
  });
});

describe('응답 포맷 일관성', () => {
  it('성공 응답은 success:true 를 포함', async () => {
    const res = await api().get('/api/leads');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('data');
  });

  it('GET /api/dashboard/stats — success:true + data 포함', async () => {
    const res = await api().get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
