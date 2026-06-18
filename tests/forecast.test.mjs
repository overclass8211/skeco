/**
 * 매출 포캐스트 API 테스트 (Phase A)
 *   - GET /api/forecast         월별 추이 + 요약 + 상세 구조
 *   - GET /api/forecast/probabilities 단계 확률
 *   - 딜 1건이 예상완료월 버킷/Weighted 에 정확히 반영되는지
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let leadId;

beforeAll(async () => {
  const [r] = await pool.query(
    `INSERT INTO leads (customer_name, project_name, business_type, region, stage,
                        expected_amount, currency, expected_close_date)
     VALUES ('__FCST_T__','__FCST_PRJ__','식각가스','국내','proposal', 10.00, 'KRW', '2026-03-15')`
  );
  leadId = r.insertId;
});

afterAll(async () => {
  if (leadId) await pool.query('DELETE FROM leads WHERE id=?', [leadId]);
});

describe('Forecast API', () => {
  it('GET /api/forecast — 12개월 시리즈 + 요약 구조', async () => {
    const res = await api().get('/api/forecast?year=2026&base_month=2026-03').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit).toBe('백만원');
    expect(res.body.data.monthly).toHaveLength(12);
    expect(res.body.data.summary).toBeTruthy();
  });

  it('proposal(50%) 딜이 예상완료월 버킷/Weighted 에 반영', async () => {
    const res = await api().get('/api/forecast?year=2026&base_month=2026-03').set('X-User-Id', '1');
    const mar = res.body.data.monthly.find(m => m.month === '2026-03');
    // 10억 → 1000 백만, Weighted = 1000 × 50% = 500 (해당 딜 분)
    expect(mar.expected).toBeGreaterThanOrEqual(1000);
    expect(mar.weighted).toBeGreaterThanOrEqual(500);
    const row = res.body.data.details.find(d => d.lead_id === leadId);
    expect(row).toBeTruthy();
    expect(row.probability).toBe(50);
    expect(row.weighted).toBe(500);
  });

  it('GET /api/forecast/probabilities — 단계 기본 확률', async () => {
    const res = await api().get('/api/forecast/probabilities').set('X-User-Id', '1');
    expect(res.status).toBe(200);
    const proposal = res.body.data.find(s => s.stage_key === 'proposal');
    expect(proposal.win_probability).toBe(50);
  });
});
