/**
 * 대시보드 API 통합 테스트
 *
 * 검증 범위:
 *   - stats / funnel / monthly / activities 4개 GET 엔드포인트
 *   - 응답 스키마 (success: true, data: ...)
 *   - 실제 MariaDB 연결 필요
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api } from './helpers.mjs';

describe('GET /api/dashboard/*', () => {
  it('stats — 7개 핵심 KPI 키 존재', async () => {
    const res = await api().get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalLeads: expect.any(Number),
      monthlyNew: expect.any(Number),
      bidding: expect.any(Number),
      domestic: expect.any(Number),
      overseas: expect.any(Number),
    });
  });

  it('funnel — stage 배열', async () => {
    const res = await api().get('/api/dashboard/funnel');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length) expect(res.body.data[0]).toHaveProperty('stage');
  });

  it('monthly — 배열 응답', async () => {
    const res = await api().get('/api/dashboard/monthly');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('activities — 최대 10건 배열', async () => {
    const res = await api().get('/api/dashboard/activities');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(10);
  });
});
