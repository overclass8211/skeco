/**
 * 워드 사전(Word Repository) API 테스트
 *
 * 검증:
 *   - GET  /api/admin/labels           — 도메인 목록 + 라벨 dict + 기본값/현재값
 *   - PUT  /api/admin/labels/:scope/:k — 단건 저장 + audit 기록
 *   - PUT  /api/admin/labels (bulk)    — 일괄 저장
 *   - POST /api/admin/labels/reset     — scope 단위 / 전체 초기화
 *   - GET  /api/admin/labels/audit     — 변경 이력 조회
 *   - GET  /api/labels (public)        — 평탄화된 dict (모든 인증 사용자)
 *   - 알 수 없는 scope/key 거부 (400)
 *   - 빈 라벨 거부 (400)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

beforeAll(async () => {
  // 테스트 영향 격리 — 영업리드 도메인 오버라이드/이력 제거 + 시스템 locale 초기화
  await pool.query("DELETE FROM admin_labels WHERE scope = 'leads'");
  await pool.query("DELETE FROM admin_label_audit WHERE scope = 'leads'");
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('system_locale','ko')
     ON DUPLICATE KEY UPDATE setting_value='ko'`
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM admin_labels WHERE scope = 'leads'");
  await pool.query("DELETE FROM admin_label_audit WHERE scope = 'leads'");
  await pool.query(
    `UPDATE system_settings SET setting_value='ko' WHERE setting_key='system_locale'`
  );
});

describe('Word Repository — /api/admin/labels', () => {
  it('GET / — 도메인 목록 + 기본값 dict 반환', async () => {
    const r = await api().get('/api/admin/labels');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.scopes)).toBe(true);
    expect(r.body.data.scopes).toContain('leads');
    expect(r.body.data.labels.leads.customer_name).toBeDefined();
    expect(r.body.data.labels.leads.customer_name.default).toBe('고객사');
    expect(r.body.data.labels.leads.customer_name.current).toBe('고객사');
    expect(r.body.data.labels.leads.customer_name.overridden).toBe(false);
  });

  it('GET /scope/:scope — 특정 도메인만', async () => {
    const r = await api().get('/api/admin/labels/scope/leads');
    expect(r.status).toBe(200);
    expect(r.body.data.customer_name).toBeDefined();
  });

  it('GET /scope/UNKNOWN — 404', async () => {
    const r = await api().get('/api/admin/labels/scope/__nope__');
    expect(r.status).toBe(404);
  });

  it('PUT /:scope/:key — 단건 저장 + audit 기록', async () => {
    const r = await api().put('/api/admin/labels/leads/customer_name').send({ label: '거래처' });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);

    // overridden 반영 확인
    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.customer_name.current).toBe('거래처');
    expect(g.body.data.customer_name.overridden).toBe(true);

    // audit 1건 이상
    const a = await api().get('/api/admin/labels/audit?limit=10');
    expect(a.status).toBe(200);
    const last = a.body.data.find(x => x.scope === 'leads' && x.key_name === 'customer_name');
    expect(last).toBeDefined();
    expect(last.new_label).toBe('거래처');
  });

  it('PUT / (bulk) — 여러 라벨 일괄 저장', async () => {
    const r = await api()
      .put('/api/admin/labels')
      .send({
        items: [
          { scope: 'leads', key: 'project_name', label: '사업명' },
          { scope: 'leads', key: 'business_type', label: '제품군' },
        ],
      });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(2);

    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.project_name.current).toBe('사업명');
    expect(g.body.data.business_type.current).toBe('제품군');
  });

  it('PUT — 알 수 없는 scope.key 거부 (400)', async () => {
    const r = await api().put('/api/admin/labels/leads/__nope__').send({ label: 'X' });
    expect(r.status).toBe(400);
  });

  it('PUT — 빈 라벨 거부 (400)', async () => {
    const r = await api().put('/api/admin/labels/leads/customer_name').send({ label: '   ' });
    expect(r.status).toBe(400);
  });

  it('POST /reset — scope 단위 초기화', async () => {
    // 사전 조건: 위에서 overridden 상태
    const r = await api().post('/api/admin/labels/reset').send({ scope: 'leads' });
    expect(r.status).toBe(200);
    expect(r.body.reset).toBeGreaterThan(0);

    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.customer_name.current).toBe('고객사');
    expect(g.body.data.customer_name.overridden).toBe(false);
  });

  it('GET /api/labels (public) — 평탄화 dict', async () => {
    // 오버라이드 1건 다시 적용
    await api().put('/api/admin/labels/leads/customer_name').send({ label: '거래처' });

    const r = await api().get('/api/labels');
    expect(r.status).toBe(200);
    expect(r.body.data.leads.customer_name).toBe('거래처');
    expect(r.body.data.leads.project_name).toBe('프로젝트');
    expect(typeof r.body.ts).toBe('number');
  });
});

// ─── 다국어 (i18n) ──────────────────────────────────────────
describe('Word Repository — Multilingual', () => {
  it('GET /locales — 지원 언어 + 시스템 locale', async () => {
    const r = await api().get('/api/admin/labels/locales');
    expect(r.status).toBe(200);
    const codes = r.body.data.supported.map(l => l.code);
    expect(codes).toEqual(expect.arrayContaining(['ko', 'en', 'ja', 'zh']));
    expect(r.body.data.system_locale).toBe('ko');
  });

  it('GET /?locale=en — 영문 기본값 반환', async () => {
    // leads 도메인 모두 초기화
    await api().post('/api/admin/labels/reset').send({ scope: 'leads' });

    const r = await api().get('/api/admin/labels?locale=en');
    expect(r.status).toBe(200);
    expect(r.body.data.locale).toBe('en');
    expect(r.body.data.labels.leads.customer_name.default).toBe('Customer');
    expect(r.body.data.labels.leads.customer_name.current).toBe('Customer');
  });

  it('PUT /:scope/:key — 언어별 독립 저장', async () => {
    // 한글 변경
    const rKo = await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: '거래처', locale: 'ko' });
    expect(rKo.status).toBe(200);

    // 영문 변경
    const rEn = await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: 'Client', locale: 'en' });
    expect(rEn.status).toBe(200);

    // 각 언어별 조회
    const gKo = await api().get('/api/admin/labels/scope/leads?locale=ko');
    const gEn = await api().get('/api/admin/labels/scope/leads?locale=en');
    expect(gKo.body.data.customer_name.current).toBe('거래처');
    expect(gEn.body.data.customer_name.current).toBe('Client');
    // 일본어는 미오버라이드 → 기본값
    const gJa = await api().get('/api/admin/labels/scope/leads?locale=ja');
    expect(gJa.body.data.customer_name.current).toBe('顧客');
  });

  it('PUT /system-locale — 시스템 기본 언어 변경', async () => {
    const r = await api().put('/api/admin/labels/system-locale').send({ locale: 'en' });
    expect(r.status).toBe(200);
    expect(r.body.system_locale).toBe('en');

    // 퍼블릭 GET /api/labels (locale 미지정) → 시스템 locale 반영
    const pub = await api().get('/api/labels');
    expect(pub.body.locale).toBe('en');
    expect(pub.body.system_locale).toBe('en');

    // 복원
    await api().put('/api/admin/labels/system-locale').send({ locale: 'ko' });
  });

  it('GET /api/labels?locale=ja — 사용자 override locale', async () => {
    const r = await api().get('/api/labels?locale=ja');
    expect(r.status).toBe(200);
    expect(r.body.locale).toBe('ja');
    expect(r.body.data.menu.dashboard).toBe('ダッシュボード');
    expect(r.body.data.leads.customer_name).toBe('顧客');
  });

  it('PUT /system-locale — 잘못된 locale 은 ko 로 정규화', async () => {
    const r = await api().put('/api/admin/labels/system-locale').send({ locale: 'xx' });
    expect(r.status).toBe(200);
    expect(r.body.system_locale).toBe('ko');
  });

  it('POST /reset — locale 단위 초기화 (다른 언어 보존)', async () => {
    // 두 언어에 오버라이드
    await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: '거래처', locale: 'ko' });
    await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: 'Client', locale: 'en' });

    // 영문만 리셋
    const r = await api().post('/api/admin/labels/reset').send({ scope: 'leads', locale: 'en' });
    expect(r.status).toBe(200);

    // 영문 = 기본값, 한글 = 오버라이드 유지
    const gEn = await api().get('/api/admin/labels/scope/leads?locale=en');
    const gKo = await api().get('/api/admin/labels/scope/leads?locale=ko');
    expect(gEn.body.data.customer_name.current).toBe('Customer');
    expect(gEn.body.data.customer_name.overridden).toBe(false);
    expect(gKo.body.data.customer_name.current).toBe('거래처');
    expect(gKo.body.data.customer_name.overridden).toBe(true);

    // cleanup
    await api().post('/api/admin/labels/reset').send({ scope: 'leads' });
  });
});
