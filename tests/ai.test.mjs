/**
 * AI 엔드포인트 테스트 — NODE_ENV=test 의 runStream mock 으로 실제 Gemini 호출 없이 검증.
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

/** SSE 스트림을 버퍼링해 문자열로 반환하는 supertest 커스텀 파서 */
function sseBuffer(res, callback) {
  let buf = '';
  res.on('data', chunk => {
    buf += chunk.toString();
  });
  res.on('end', () => callback(null, buf));
  res.on('error', err => callback(err));
}

describe('AI Chat 엔드포인트', () => {
  it('POST /api/ai/chat — 정상 요청 → 200 + SSE Content-Type', async () => {
    const res = await api()
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '안녕하세요' }] })
      .buffer(true)
      .parse(sseBuffer);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('data:');
  });

  it('POST /api/ai/chat — messages 없이 전송 → 200 + [DONE]', async () => {
    const res = await api().post('/api/ai/chat').send({}).buffer(true).parse(sseBuffer);

    expect(res.status).toBe(200);
    expect(res.body).toContain('[DONE]');
  });
});

describe('AI Report 엔드포인트', () => {
  it('POST /api/ai/report — type:weekly → 200 + SSE + [DONE]', async () => {
    const res = await api()
      .post('/api/ai/report')
      .send({ type: 'weekly' })
      .buffer(true)
      .parse(sseBuffer);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('[DONE]');
  });

  it('POST /api/ai/report — type:monthly → 200 + [DONE]', async () => {
    const res = await api()
      .post('/api/ai/report')
      .send({ type: 'monthly' })
      .buffer(true)
      .parse(sseBuffer);

    expect(res.status).toBe(200);
    expect(res.body).toContain('[DONE]');
  });
});

describe('AI Briefing 엔드포인트 — 에러 케이스', () => {
  it('GET /api/ai/briefing/99999 — 존재하지 않는 고객사 → 404', async () => {
    const res = await api().get('/api/ai/briefing/99999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('AI Summary 엔드포인트 — 에러 케이스', () => {
  it('GET /api/ai/summary/99999 — 존재하지 않는 리드 → 404', async () => {
    const res = await api().get('/api/ai/summary/99999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
