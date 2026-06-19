'use strict';
// =============================================================
// scripts/seed-360-lifecycle.js — 고객·제품 360뷰(라이프사이클) 데모 시드
//
//   npm run db:seed-360-lc
//
// 기존 leads 를 기반으로 소재 라이프사이클을 생성(정합성 보장):
//   customer_materials  : 고객의 진행/수주 딜 → 소재 라이프사이클 단계
//   demand_forecasts    : 소재별 3개월 수요/생산가능/예상매출 (CAPA 갭 일부 의도적)
//   quality_cases       : 일부 양산 소재에 품질 이슈
//
// 멱등: customer_materials(고객+소재명), demand_forecasts(UNIQUE), quality_cases(case_no)
//   DROP/DELETE 없음. 금액 단위: 원(₩).
// =============================================================
require('dotenv').config({ override: true });
const pool = require('../src/db');
const config = require('../config');

// CRM stage → 라이프사이클 단계
const STAGE_MAP = {
  lead: 'discovery',
  review: 'sample',
  proposal: 'evaluation',
  bidding: 'evaluation',
  negotiation: 'specin',
  won: 'massprod',
};
// 사업유형 → 소재명/단위/월수요(대표)
const MAT_BY_BIZ = {
  식각가스: { name: '식각가스 C4F6', unit: 'kg', demand: 2000 },
  프리커서: { name: '프리커서 Hf 전구체', unit: 'kg', demand: 1200 },
  'Wet Chemical': { name: '고선택비 인산', unit: 'L', demand: 9000 },
  디스플레이소재: { name: 'OLED 발광소재', unit: 'g', demand: 500 },
  포토소재: { name: 'SOC 하드마스크', unit: 'L', demand: 120 },
  통합서비스: { name: 'Gas 통합공급(BSGS)', unit: '식', demand: 1 },
};
const MONTHS = ['2026-07', '2026-08', '2026-09'];

let QSEQ = 2000;
const pad = n => String(n).padStart(4, '0');

async function upsertMaterial(conn, lead) {
  const meta = MAT_BY_BIZ[lead.business_type] || { name: lead.business_type || '소재', unit: 'kg', demand: 1000 };
  const matName = `${meta.name} · ${lead.project_name.slice(0, 18)}`;
  const [ex] = await conn.query(
    'SELECT id FROM customer_materials WHERE customer_id=? AND material_name=? LIMIT 1',
    [lead.customer_id, matName]
  );
  if (ex.length) return { id: ex[0].id, meta, isNew: false };
  const stage = STAGE_MAP[lead.stage] || 'discovery';
  const fab = lead.region === '해외' ? 'Overseas Fab' : '국내 Fab/라인';
  const [r] = await conn.query(
    `INSERT INTO customer_materials
       (customer_id, material_name, business_type, fab_line, lifecycle_stage,
        expected_mp_date, monthly_demand, demand_unit, win_probability, status, notes)
     VALUES (?,?,?,?,?,?,?,?,?, 'active', ?)`,
    [
      lead.customer_id, matName, lead.business_type, fab, stage,
      lead.expected_close_date || null, meta.demand, meta.unit,
      lead.prob || null, '데모 시드 — 라이프사이클',
    ]
  );
  return { id: r.insertId, meta, isNew: true, stage };
}

async function upsertForecasts(conn, lead, matId, meta) {
  const monthlyRev = Math.round((Number(lead.expected_amount) || 0) / 12);
  // CAPA 갭: 일부(짝수 customer_id)는 8월 생산가능 < 수요 → 부족
  const tightCapa = lead.customer_id % 2 === 0;
  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i];
    const custFc = Math.round(meta.demand * (1 + i * 0.12)); // 월 증가
    const internalFc = Math.round(custFc * 0.92);
    let capa = Math.round(custFc * 1.05);
    if (tightCapa && i === 1) capa = Math.round(custFc * 0.8); // 8월 부족
    await conn.query(
      `INSERT INTO demand_forecasts
         (customer_material_id, customer_id, month, customer_forecast, internal_forecast,
          production_capacity, win_probability, expected_revenue, unit)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE customer_forecast=VALUES(customer_forecast),
         internal_forecast=VALUES(internal_forecast), production_capacity=VALUES(production_capacity),
         win_probability=VALUES(win_probability), expected_revenue=VALUES(expected_revenue)`,
      [matId, lead.customer_id, month, custFc, internalFc, capa, lead.prob || null, monthlyRev, meta.unit]
    );
  }
}

async function maybeQuality(conn, lead, matId, idx) {
  // 양산/협상 소재 일부에 품질 이슈 (결정적: idx % 3 === 0)
  if (idx % 3 !== 0) return false;
  QSEQ += 1;
  const caseNo = `Q-2026-${pad(QSEQ)}`;
  const types = ['VOC', 'NCR', 'Audit'];
  const sev = ['high', 'medium', 'low'];
  const t = types[idx % types.length];
  const s = sev[idx % sev.length];
  await conn.query(
    `INSERT IGNORE INTO quality_cases
       (case_no, customer_id, customer_material_id, type, severity, status, title, opened_at)
     VALUES (?,?,?,?,?, 'open', ?, ?)`,
    [caseNo, lead.customer_id, matId, t, s, `${lead.business_type} ${t} — ${lead.project_name.slice(0, 16)}`, '2026-06-10']
  );
  return true;
}

(async () => {
  let code = 0;
  const conn = await pool.getConnection();
  const counts = { materials: 0, forecasts: 0, quality: 0 };
  try {
    console.log(`▶ 360 라이프사이클 데모 시드 — target=${config.db.database} (멱등, DROP 없음)`);
    // customer_id 가 있고 진행/수주 단계인 리드만 (정합 소재 생성)
    const [leads] = await conn.query(
      `SELECT l.id, l.customer_id, l.customer_name, l.project_name, l.business_type,
              l.region, l.stage, l.expected_amount, l.expected_close_date,
              COALESCE(l.win_probability, ps.win_probability, 0) AS prob
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.stage_key = l.stage
        WHERE l.customer_id IS NOT NULL
          AND l.stage NOT IN ('lost','dropped')
        ORDER BY l.customer_id, l.id`
    );
    let idx = 0;
    for (const lead of leads) {
      const { id: matId, meta, isNew } = await upsertMaterial(conn, lead);
      if (isNew) counts.materials += 1;
      await upsertForecasts(conn, lead, matId, meta);
      counts.forecasts += MONTHS.length;
      const q = await maybeQuality(conn, lead, matId, idx);
      if (q) counts.quality += 1;
      idx += 1;
    }

    // 기준 포캐스트 버전 1개 생성 (고객당, 없을 때만 — 멱등)
    counts.versions = 0;
    const [custWithMat] = await conn.query(
      `SELECT DISTINCT customer_id FROM customer_materials WHERE status<>'closed'`
    );
    for (const { customer_id } of custWithMat) {
      const [[ex]] = await conn.query(
        `SELECT COUNT(*) AS n FROM forecast_versions WHERE customer_id=?`,
        [customer_id]
      );
      if (ex.n > 0) continue;
      const [[mids]] = await conn.query(
        `SELECT GROUP_CONCAT(id) AS ids FROM customer_materials WHERE customer_id=?`,
        [customer_id]
      );
      if (!mids.ids) continue;
      const matIdList = mids.ids.split(',').map(Number);
      const [items] = await conn.query(
        `SELECT * FROM demand_forecasts WHERE customer_material_id IN (?)`,
        [matIdList]
      );
      if (!items.length) continue;
      const [v] = await conn.query(
        `INSERT INTO forecast_versions (customer_id, label, version_type, note) VALUES (?, '2026-06 기준본', 'baseline', '데모 시드 기준 스냅샷')`,
        [customer_id]
      );
      for (const it of items) {
        await conn.query(
          `INSERT INTO forecast_version_items
             (version_id, customer_material_id, month, customer_forecast, internal_forecast,
              production_capacity, win_probability, expected_revenue, unit)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [v.insertId, it.customer_material_id, it.month, it.customer_forecast, it.internal_forecast,
           it.production_capacity, it.win_probability, it.expected_revenue, it.unit]
        );
      }
      counts.versions += 1;
    }

    console.log('\n✅ 시드 완료(멱등):');
    console.log(`  · 소재(customer_materials): ${counts.materials} 신규`);
    console.log(`  · 수요예측(demand_forecasts): ${counts.forecasts} upsert`);
    console.log(`  · 품질이슈(quality_cases): ${counts.quality}`);
    console.log(`  · 기준 포캐스트 버전: ${counts.versions} 신규`);
    const [[m]] = await conn.query('SELECT COUNT(*) AS n FROM customer_materials');
    console.log(`  · 현재 총 소재: ${m.n}`);
  } catch (e) {
    console.error('❌ 시드 실패:', e.message);
    code = 1;
  } finally {
    conn.release();
    await pool.end();
    process.exit(code);
  }
})();
