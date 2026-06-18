/**
 * 활동(Activities) API 회귀 테스트
 *
 * 핵심 회귀 케이스:
 *   - 폼이 보내는 영문 activity_type ('meeting','call','email','site_visit',
 *     'proposal','note') 가 DB 한글 ENUM/VARCHAR 컬럼에 정확히 매핑되어 저장.
 *   - 이전에는 "Data truncated for column 'activity_type'" 500 에러 발생.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let leadId;
const createdActIds = [];

beforeAll(async () => {
  // 활동을 매달 lead 가 필요
  const [r] = await pool.query(
    `INSERT INTO leads (customer_name, project_name, business_type, region, stage)
     VALUES ('__TEST_ACT__', '__TEST_ACT_PRJ__', '태양광', '국내', 'lead')`
  );
  leadId = r.insertId;
});

afterAll(async () => {
  if (createdActIds.length) {
    await pool.query(
      `DELETE FROM activities WHERE id IN (${createdActIds.map(() => '?').join(',')})`,
      createdActIds
    );
  }
  if (leadId) {
    await pool.query('DELETE FROM activities WHERE lead_id = ?', [leadId]);
    await pool.query('DELETE FROM leads WHERE id = ?', [leadId]);
  }
});

describe('Activities API — activity_type 정규화', () => {
  // 영문 → 한글 매핑 케이스
  const cases = [
    { input: 'meeting', expected: '미팅' },
    { input: 'call', expected: '전화' },
    { input: 'email', expected: '이메일' },
    { input: 'site_visit', expected: '현장방문' },
    { input: 'proposal', expected: '제안' },
    { input: 'note', expected: '메모' },
  ];

  for (const { input, expected } of cases) {
    it(`POST — '${input}' → '${expected}' 매핑되어 저장`, async () => {
      const res = await api()
        .post('/api/activities')
        .send({
          lead_id: leadId,
          activity_type: input,
          title: `__TEST_ACT__ ${input}`,
          content: 'regression check',
          status: 'planned',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const id = res.body.id;
      createdActIds.push(id);

      const [rows] = await pool.query('SELECT activity_type FROM activities WHERE id = ?', [id]);
      expect(rows[0].activity_type).toBe(expected);
    });
  }

  it('POST — 한글 값 그대로 passthrough', async () => {
    const res = await api().post('/api/activities').send({
      lead_id: leadId,
      activity_type: '입찰',
      title: '__TEST_ACT__ kr passthrough',
      status: 'done',
    });
    expect(res.status).toBe(200);
    createdActIds.push(res.body.id);

    const [rows] = await pool.query('SELECT activity_type FROM activities WHERE id = ?', [
      res.body.id,
    ]);
    expect(rows[0].activity_type).toBe('입찰');
  });

  it('POST — 누락 시 기본값 "기타"', async () => {
    const res = await api().post('/api/activities').send({
      lead_id: leadId,
      title: '__TEST_ACT__ default type',
    });
    expect(res.status).toBe(200);
    createdActIds.push(res.body.id);

    const [rows] = await pool.query('SELECT activity_type FROM activities WHERE id = ?', [
      res.body.id,
    ]);
    expect(rows[0].activity_type).toBe('기타');
  });

  it('PUT — 영문 → 한글 매핑 UPDATE', async () => {
    // 먼저 하나 만들기
    const ins = await api().post('/api/activities').send({
      lead_id: leadId,
      activity_type: 'note',
      title: '__TEST_ACT__ update target',
    });
    const id = ins.body.id;
    createdActIds.push(id);

    // 영문으로 PUT
    const res = await api().put(`/api/activities/${id}`).send({
      activity_type: 'call',
    });
    expect(res.status).toBe(200);

    const [rows] = await pool.query('SELECT activity_type FROM activities WHERE id = ?', [id]);
    expect(rows[0].activity_type).toBe('전화');
  });
});
