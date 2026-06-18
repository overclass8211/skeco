/**
 * 관리자 + AI 사용량 API 통합 테스트.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api } from './helpers.mjs';

describe('Admin & AI Usage API', () => {
  it('GET /api/admin/settings — idle/token 정책 키 존재', async () => {
    const res = await api().get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('idle_timeout_min');
    expect(res.body.data).toHaveProperty('default_monthly_token_limit');
  });

  it('PUT — 변경 → 조회 → 원복', async () => {
    const original = (await api().get('/api/admin/settings')).body.data;
    const newVal = String(parseInt(original.idle_timeout_min) === 99 ? 30 : 99);

    const put = await api().put('/api/admin/settings').send({ idle_timeout_min: newVal });
    expect(put.status).toBe(200);

    const verify = (await api().get('/api/admin/settings')).body.data;
    expect(verify.idle_timeout_min).toBe(newVal);

    await api().put('/api/admin/settings').send({ idle_timeout_min: original.idle_timeout_min });
  });

  it('GET /api/admin/token-usage-by-user — 사용자 + defaultLimit', async () => {
    const res = await api().get('/api/admin/token-usage-by-user');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.defaultLimit).toBe('number');
  });

  it('GET /api/ai/usage/today — 오늘 누계 (숫자)', async () => {
    const res = await api().get('/api/ai/usage/today');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.total).toBe('number');
    expect(typeof res.body.data.calls).toBe('number');
  });

  // ── Phase 7: 공급사 기본 정보 ─────────────────────────────
  it('GET /api/admin/supplier-info — 모든 필드 키 존재 (빈값 포함)', async () => {
    const res = await api().get('/api/admin/supplier-info');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 7개 입력 필드 + 2개 메타 — 빈 문자열이라도 키는 있어야 함
    [
      'supplier_company_name',
      'supplier_address',
      'supplier_business_no',
      'supplier_ceo',
      'sales_rep_name',
      'sales_rep_contact',
      'sales_rep_email',
      'supplier_updated_by_name',
    ].forEach(k => {
      expect(res.body.data).toHaveProperty(k);
    });
  });

  it('PUT /api/admin/supplier-info — 정상 저장 + 다시 조회 시 반영', async () => {
    const payload = {
      supplier_company_name: '__TEST__OCI테스트',
      supplier_address: '__TEST__서울시 강남구',
      supplier_ceo: '__TEST__홍길동',
      sales_rep_email: 'test@oci.com',
    };
    const put = await api().put('/api/admin/supplier-info').send(payload);
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await api().get('/api/admin/supplier-info');
    expect(get.body.data.supplier_company_name).toBe('__TEST__OCI테스트');
    expect(get.body.data.supplier_address).toBe('__TEST__서울시 강남구');
    expect(get.body.data.supplier_ceo).toBe('__TEST__홍길동');
    expect(get.body.data.sales_rep_email).toBe('test@oci.com');
  });

  it('PUT /api/admin/supplier-info — 회사명 빈값 시 400', async () => {
    const res = await api()
      .put('/api/admin/supplier-info')
      .send({ supplier_company_name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/회사명/);
  });

  it('PUT /api/admin/supplier-info — 잘못된 이메일 시 400', async () => {
    const res = await api()
      .put('/api/admin/supplier-info')
      .send({ supplier_company_name: '__TEST__', sales_rep_email: 'invalid-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/이메일/);
  });

  it('PUT /api/admin/supplier-info — 화이트리스트 외 필드 무시', async () => {
    const res = await api()
      .put('/api/admin/supplier-info')
      .send({
        supplier_company_name: '__TEST__화이트',
        evil_key: '<script>alert(1)</script>', // 무시되어야 함
      });
    expect(res.status).toBe(200);
    // evil_key 는 저장 안 됨
    const get = await api().get('/api/admin/supplier-info');
    expect(get.body.data.evil_key).toBeUndefined();
  });
});
