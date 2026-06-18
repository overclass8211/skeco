/**
 * Board API 통합 테스트 (공지사항, 댓글, FAQ)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let announcementId;
let commentId;
let faqId;

beforeAll(async () => {
  await pool.query("DELETE FROM announcements WHERE title LIKE '__TEST__%'");
  await pool.query("DELETE FROM faq WHERE question LIKE '__TEST__%'");
});

afterAll(async () => {
  if (announcementId) await pool.query('DELETE FROM announcements WHERE id = ?', [announcementId]);
  if (commentId) await pool.query('DELETE FROM comments WHERE id = ?', [commentId]);
  if (faqId) await pool.query('DELETE FROM faq WHERE id = ?', [faqId]);
});

describe('Board — Announcements', () => {
  it('GET /api/board/announcements — 목록 조회', async () => {
    const res = await api().get('/api/board/announcements');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/board/announcements — 공지 등록', async () => {
    const res = await api().post('/api/board/announcements').send({
      title: '__TEST__공지사항',
      content: '테스트 내용',
      is_pinned: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    announcementId = res.body.id;
  });

  it('PUT /api/board/announcements/:id — 수정', async () => {
    const res = await api().put(`/api/board/announcements/${announcementId}`).send({
      title: '__TEST__공지사항 수정',
      content: '수정된 내용',
      is_pinned: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/board/announcements/:id — 삭제', async () => {
    const res = await api().delete(`/api/board/announcements/${announcementId}`);
    expect(res.status).toBe(200);
    announcementId = null;
  });
});

describe('Board — Comments', () => {
  it('GET /api/board/comments — 목록 조회', async () => {
    const res = await api().get('/api/board/comments?ref_type=announcement&ref_id=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/board/comments — 댓글 등록', async () => {
    const res = await api().post('/api/board/comments').send({
      ref_type: 'announcement',
      ref_id: 1,
      content: '__TEST__댓글',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    commentId = res.body.id;
  });

  it('DELETE /api/board/comments/:id — 삭제', async () => {
    const res = await api().delete(`/api/board/comments/${commentId}`);
    expect(res.status).toBe(200);
    commentId = null;
  });
});

describe('Board — FAQ', () => {
  it('GET /api/board/faq — 목록 조회', async () => {
    const res = await api().get('/api/board/faq');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/board/faq — FAQ 등록', async () => {
    const res = await api().post('/api/board/faq').send({
      question: '__TEST__FAQ 질문',
      answer: '테스트 답변',
      category: '일반',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    faqId = res.body.id;
  });

  it('DELETE /api/board/faq/:id — 삭제', async () => {
    const res = await api().delete(`/api/board/faq/${faqId}`);
    expect(res.status).toBe(200);
    faqId = null;
  });
});
