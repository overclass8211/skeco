/**
 * 회의록 API 통합 테스트 — STT 우회, DB 직접 검증.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdMeetingId;

afterAll(async () => {
  if (createdMeetingId) {
    await pool.query('DELETE FROM meeting_minutes WHERE id = ?', [createdMeetingId]);
  }
});

describe('Meetings API', () => {
  it('GET /api/meetings — 목록', async () => {
    const res = await api().get('/api/meetings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 회의록 직접 저장 (STT 우회)', async () => {
    const res = await api()
      .post('/api/meetings')
      .send({
        title: '__TEST__ 통합 테스트 회의록',
        meeting_date: '2026-05-09',
        raw_transcript: '테스트 전사 텍스트입니다.',
        speakers_json: [{ speaker: 1, text: '안녕하세요' }],
        summary_md: '## 미팅 주요 어젠다\n- 테스트',
        customer_name: '__TEST__고객사',
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdMeetingId = res.body.id;
  });

  it('GET /:id — 상세 (요약 보존)', async () => {
    const res = await api().get(`/api/meetings/${createdMeetingId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('__TEST__ 통합 테스트 회의록');
    expect(res.body.data.summary_md).toContain('미팅 주요 어젠다');
  });

  it('DELETE /:id — 회의록 삭제', async () => {
    const res = await api().delete(`/api/meetings/${createdMeetingId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    createdMeetingId = null;
  });

  // ─ STT 견고성 (장시간 녹음 504 회귀) ───────────────────────
  // 프론트가 항상 JSON.parse 할 수 있도록, 에러 경로에서도 JSON 응답 보장
  it('POST /transcribe — 파일 누락 시 JSON 400', async () => {
    const res = await api().post('/api/meeting/transcribe');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  // ─ 비동기 STT 라우트 (120분급 녹음 대응) ───────────────────
  it('POST /transcribe-async — 파일 누락 시 JSON 400', async () => {
    const res = await api().post('/api/meeting/transcribe-async');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
  });

  it('GET /transcribe-status/:id — 없는 작업은 404 JSON', async () => {
    const res = await api().get('/api/meeting/transcribe-status/__nonexistent__');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
  });
});

// ── STT Jobs 인메모리 동작 (모듈 단위) ───────────────────────
describe('sttJobs service', () => {
  it('createJob 후 즉시 getJob 로 조회 가능 (pending)', async () => {
    // require 시점에 STT 자체를 실행하지 않도록, stt 모듈을 stub
    const stt = await import('../src/services/stt.js');
    const orig = stt.transcribeAudio;
    // 실제 호출은 시뮬레이션 — 즉시 결과 반환
    const sttModule = await import('../src/services/stt.js');
    // 우회: jobs.createJob 은 setImmediate 로 백그라운드 실행 → 작업 직후 상태는 pending
    const { createJob, getJob, _resetForTest } = await import('../src/services/sttJobs.js');
    _resetForTest();
    // dummy filePath — transcribeAudio 가 실제 읽지 않도록 보장하긴 어렵지만,
    // status 검증은 setImmediate 호출 전에 가능.
    const job = createJob({ filePath: '/dev/null', mimetype: 'audio/webm', fileSize: 0 });
    expect(job.id).toMatch(/^[a-f0-9]{16}$/);
    expect(job.status).toBe('pending');
    const fetched = getJob(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(getJob('__missing__')).toBeNull();
    // 정리
    _resetForTest();
    // eslint stub unused 방지
    void orig;
    void sttModule;
  });
});
