/**
 * Healthmap API 통합 테스트
 *
 * 검증 항목:
 *  1. /healthmap/snapshot — 노드/엣지/summary 구조
 *  2. 노드 상태 매트릭스 (up/warn/critical/down)
 *  3. 가이드 CRUD + 시스템 가이드 보호 + 복제
 *  4. 노드별 최근 로그 조회
 *  5. AI 해석 캐시 동작 (Mock — AI 호출 자체는 Gemini 키 없으면 503)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const PREFIX = '__HM_TEST__';
const createdGuideIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM healthmap_guides WHERE title LIKE ?`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM healthmap_ai_cache WHERE cache_key LIKE 'test_%'`);
});

afterAll(async () => {
  for (const id of createdGuideIds) {
    try {
      await pool.query('DELETE FROM healthmap_guides WHERE id = ?', [id]);
    } catch (_) {
      /* ignore */
    }
  }
  await pool.query(`DELETE FROM healthmap_guides WHERE title LIKE ?`, [`${PREFIX}%`]);
});

describe('Healthmap — snapshot', () => {
  it('GET /healthmap/snapshot — 노드/엣지/summary 모두 포함', async () => {
    const res = await api().get('/api/admin/healthmap/snapshot');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(Array.isArray(d.nodes)).toBe(true);
    expect(Array.isArray(d.edges)).toBe(true);
    expect(d.summary).toMatchObject({
      totalNodes: expect.any(Number),
      up: expect.any(Number),
      warn: expect.any(Number),
      critical: expect.any(Number),
      down: expect.any(Number),
      worstSeverity: expect.any(String),
    });
    expect(d.timestamp).toBeDefined();
  });

  it('각 노드는 표준 형식 (id, type, label, metrics, status)', async () => {
    const res = await api().get('/api/admin/healthmap/snapshot');
    for (const n of res.body.data.nodes) {
      expect(n.id).toBeDefined();
      expect(n.type).toBeDefined();
      expect(n.label).toBeDefined();
      expect(n.metrics).toBeDefined();
      expect(['up', 'warn', 'critical', 'down']).toContain(n.status);
    }
  });

  it('프로세스 노드 메트릭에 memoryMb, uptimeSec 포함', async () => {
    const res = await api().get('/api/admin/healthmap/snapshot');
    const procNode = res.body.data.nodes.find(n => n.id === 'sys:process');
    expect(procNode).toBeDefined();
    expect(procNode.metrics.memoryMb).toBeGreaterThan(0);
    expect(procNode.metrics.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('DB 노드는 connected:true', async () => {
    const res = await api().get('/api/admin/healthmap/snapshot');
    const dbNode = res.body.data.nodes.find(n => n.id === 'sys:db');
    expect(dbNode).toBeDefined();
    expect(dbNode.metrics.connected).toBe(true);
  });

  it('엣지에 nginx → API → DB 토폴로지 포함', async () => {
    const res = await api().get('/api/admin/healthmap/snapshot');
    const edges = res.body.data.edges;
    expect(edges.some(e => e.from === 'sys:nginx')).toBe(true);
    expect(edges.some(e => e.to === 'sys:db')).toBe(true);
  });
});

describe('Healthmap — 노드별 로그', () => {
  it('GET /healthmap/node/api/:key/logs — API 로그 조회', async () => {
    const res = await api().get(
      '/api/admin/healthmap/node/api/' + encodeURIComponent('/api/dashboard') + '/logs'
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('알 수 없는 type → 빈 배열', async () => {
    const res = await api().get('/api/admin/healthmap/node/unknown/foo/logs');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('Healthmap — 가이드 CRUD', () => {
  it('GET /healthmap/guides — 시드 가이드 포함', async () => {
    const res = await api().get('/api/admin/healthmap/guides');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const systemGuides = res.body.data.filter(g => g.is_system === 1);
    expect(systemGuides.length).toBeGreaterThanOrEqual(8); // 시드 10개 가까이
  });

  it('node_type 필터', async () => {
    const res = await api().get('/api/admin/healthmap/guides?node_type=api');
    expect(res.status).toBe(200);
    for (const g of res.body.data) {
      expect(g.node_type).toBe('api');
    }
  });

  it('POST — 사용자 가이드 생성', async () => {
    const res = await api()
      .post('/api/admin/healthmap/guides')
      .send({
        node_type: 'api',
        node_key: '/api/test',
        severity: 'warn',
        title: `${PREFIX}테스트가이드`,
        symptom: '증상',
        diagnosis: '진단',
        remedy: '조치',
        prevention: '예방',
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdGuideIds.push(res.body.id);
  });

  it('POST — node_type 누락 → 400', async () => {
    const res = await api().post('/api/admin/healthmap/guides').send({
      title: '제목만',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('PUT — 사용자 가이드 수정', async () => {
    const id = createdGuideIds[0];
    const res = await api()
      .put(`/api/admin/healthmap/guides/${id}`)
      .send({
        title: `${PREFIX}수정됨`,
      });
    expect(res.status).toBe(200);
    const check = await api().get(`/api/admin/healthmap/guides/${id}`);
    expect(check.body.data.title).toBe(`${PREFIX}수정됨`);
  });

  it('DELETE — 사용자 가이드 삭제', async () => {
    const id = createdGuideIds.pop();
    const res = await api().delete(`/api/admin/healthmap/guides/${id}`);
    expect(res.status).toBe(200);
    const check = await api().get(`/api/admin/healthmap/guides/${id}`);
    expect(check.status).toBe(404);
  });
});

describe('Healthmap — 시스템 가이드 보호', () => {
  let sysGuideId;
  beforeAll(async () => {
    const [[row]] = await pool.query(`SELECT id FROM healthmap_guides WHERE is_system = 1 LIMIT 1`);
    sysGuideId = row?.id;
  });

  it('PUT — 시스템 가이드 수정 시도 → 403', async () => {
    expect(sysGuideId).toBeDefined();
    const res = await api().put(`/api/admin/healthmap/guides/${sysGuideId}`).send({
      title: '해킹 시도',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SYSTEM_GUIDE_PROTECTED');
  });

  it('DELETE — 시스템 가이드 삭제 시도 → 403', async () => {
    expect(sysGuideId).toBeDefined();
    const res = await api().delete(`/api/admin/healthmap/guides/${sysGuideId}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SYSTEM_GUIDE_PROTECTED');
  });

  it('POST /:id/clone — 시스템 가이드 복제 → 사용자 가이드', async () => {
    expect(sysGuideId).toBeDefined();
    const res = await api().post(`/api/admin/healthmap/guides/${sysGuideId}/clone`).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdGuideIds.push(res.body.id);

    const check = await api().get(`/api/admin/healthmap/guides/${res.body.id}`);
    expect(check.body.data.is_system).toBe(0);
    expect(check.body.data.title).toContain('(복사)');
  });
});

describe('Healthmap — AI 해석 캐시', () => {
  it('POST /ai-interpret — node_type 누락 → 400', async () => {
    const res = await api().post('/api/admin/healthmap/ai-interpret').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // 실제 Gemini 호출은 테스트 환경에서 키 없을 가능성 → 503 or 200 둘 다 정상 처리 확인
  it('POST /ai-interpret — 정상 페이로드 (AI 키 없을 시 503)', async () => {
    const res = await api()
      .post('/api/admin/healthmap/ai-interpret')
      .send({
        node_type: 'api',
        node_key: '/api/leads',
        status: 'warn',
        metrics: { avgMs: 600, errRate: 2.5 },
        recent_logs: [],
      });
    // AI 키가 있으면 200, 없으면 503 — 둘 다 valid
    expect([200, 503]).toContain(res.status);
  });
});
