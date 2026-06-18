/**
 * Email Templates API 통합 테스트
 *
 * 검증 항목:
 *  1. 시드 5개 자동 생성 (initTables)
 *  2. 시드 템플릿 = is_system:1 (수정/삭제 시도 시 403)
 *  3. CRUD — 생성/조회/수정/삭제
 *  4. category 필터
 *  5. 입력 검증 — name/subject/body 누락, 잘못된 category
 *  6. 변수 placeholder 보존 (서버는 치환 안 함)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const PREFIX = '__EMAIL_TPL_TEST__';
const createdIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM email_templates WHERE name LIKE ?`, [`${PREFIX}%`]);
});

afterAll(async () => {
  for (const id of createdIds) {
    try {
      await pool.query('DELETE FROM email_templates WHERE id = ?', [id]);
    } catch (_) {
      /* ignore */
    }
  }
  await pool.query(`DELETE FROM email_templates WHERE name LIKE ?`, [`${PREFIX}%`]);
});

describe('Email Templates API — 시드', () => {
  it('GET / → 시드 5개 포함되어 있음 (is_system=1)', async () => {
    const res = await api().get('/api/email-templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const systemTpls = res.body.data.filter(t => t.is_system === 1);
    // 시드 최소 5개 (멱등성 — 중복 추가 안 됨)
    expect(systemTpls.length).toBeGreaterThanOrEqual(5);
    // 시드 이름 일부 확인
    const names = systemTpls.map(t => t.name);
    expect(names).toContain('첫 미팅 요청');
    expect(names).toContain('견적서 발송');
  });

  it('시드 템플릿은 변수 placeholder 를 포함', async () => {
    const res = await api().get('/api/email-templates');
    const meeting = res.body.data.find(t => t.name === '첫 미팅 요청');
    expect(meeting).toBeDefined();
    expect(meeting.body).toContain('{{customer_name}}');
    expect(meeting.body).toContain('{{my_name}}');
  });
});

describe('Email Templates API — CRUD', () => {
  it('POST — 신규 템플릿 추가', async () => {
    const res = await api()
      .post('/api/email-templates')
      .send({
        name: `${PREFIX}테스트템플릿`,
        category: 'lead',
        subject: '[테스트] {{customer_name}} 안내',
        body: '본문 {{my_name}}',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
    createdIds.push(res.body.id);
  });

  it('POST — name 누락 시 400', async () => {
    const res = await api().post('/api/email-templates').send({
      subject: '제목',
      body: '본문',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST — 잘못된 category → 400', async () => {
    const res = await api()
      .post('/api/email-templates')
      .send({
        name: `${PREFIX}잘못된카테고리`,
        category: 'invalid_category',
        subject: '제목',
        body: '본문',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /:id — 단건 조회', async () => {
    const id = createdIds[0];
    const res = await api().get(`/api/email-templates/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.subject).toContain('{{customer_name}}');
  });

  it('GET /:id — 존재하지 않는 id → 404', async () => {
    const res = await api().get('/api/email-templates/99999999');
    expect(res.status).toBe(404);
  });

  it('PUT — 사용자 템플릿 수정', async () => {
    const id = createdIds[0];
    const res = await api().put(`/api/email-templates/${id}`).send({
      subject: '[수정됨] 새 제목',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await api().get(`/api/email-templates/${id}`);
    expect(check.body.data.subject).toBe('[수정됨] 새 제목');
  });

  it('DELETE — 사용자 템플릿 삭제', async () => {
    const id = createdIds.pop(); // 마지막 id 사용 → 정리에서 제외
    const res = await api().delete(`/api/email-templates/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const check = await api().get(`/api/email-templates/${id}`);
    expect(check.status).toBe(404);
  });
});

describe('Email Templates API — 시스템 템플릿 보호', () => {
  let sysTplId;

  beforeAll(async () => {
    const res = await api().get('/api/email-templates');
    const sys = res.body.data.find(t => t.is_system === 1);
    sysTplId = sys?.id;
  });

  it('PUT — 시스템 템플릿 수정 시도 → 403', async () => {
    expect(sysTplId).toBeDefined();
    const res = await api().put(`/api/email-templates/${sysTplId}`).send({
      subject: '해킹 시도',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SYSTEM_TEMPLATE_PROTECTED');
  });

  it('DELETE — 시스템 템플릿 삭제 시도 → 403', async () => {
    expect(sysTplId).toBeDefined();
    const res = await api().delete(`/api/email-templates/${sysTplId}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SYSTEM_TEMPLATE_PROTECTED');
  });
});

describe('Email Templates API — 복제 (clone)', () => {
  let sysTplId;

  beforeAll(async () => {
    const res = await api().get('/api/email-templates');
    const sys = res.body.data.find(t => t.is_system === 1 && t.name === '첫 미팅 요청');
    sysTplId = sys?.id;
  });

  it('POST /:id/clone — 시스템 템플릿을 사용자 템플릿으로 복제', async () => {
    expect(sysTplId).toBeDefined();
    const res = await api().post(`/api/email-templates/${sysTplId}/clone`).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
    createdIds.push(res.body.id);

    // 복제된 행 검증 — is_system=0, 이름은 "원이름 (복사)"
    const check = await api().get(`/api/email-templates/${res.body.id}`);
    expect(check.body.data.is_system).toBe(0);
    expect(check.body.data.name).toBe('첫 미팅 요청 (복사)');
    // 본문/제목은 원본과 동일
    expect(check.body.data.subject).toContain('{{customer_name}}');
  });

  it('POST /:id/clone — name 수동 지정', async () => {
    const customName = `${PREFIX}내가지은이름`;
    const res = await api()
      .post(`/api/email-templates/${sysTplId}/clone`)
      .send({ name: customName });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdIds.push(res.body.id);

    const check = await api().get(`/api/email-templates/${res.body.id}`);
    expect(check.body.data.name).toBe(customName);
  });

  it('POST /:id/clone — 존재하지 않는 id → 404', async () => {
    const res = await api().post('/api/email-templates/99999999/clone').send({});
    expect(res.status).toBe(404);
  });
});

describe('Email Templates API — category 필터', () => {
  it('GET ?category=lead → lead 카테고리만 반환', async () => {
    const res = await api().get('/api/email-templates?category=lead');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const t of res.body.data) {
      expect(t.category).toBe('lead');
    }
  });
});
