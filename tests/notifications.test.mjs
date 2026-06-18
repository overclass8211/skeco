/**
 * Notifications API 통합 테스트
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

describe('Notifications API', () => {
  it('GET /api/notifications — 목록 조회', async () => {
    const res = await api().get('/api/notifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
