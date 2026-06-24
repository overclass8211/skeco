'use strict';
// =============================================================
// 반도체 수급 FCST 시드 (엑셀 "반도체 포캐스트 로데이터4.xlsx" 기반)
//
//   - production_forecasts: MI 수요 17(고객×제품) × 12개월 = 204행
//        forecast_qty=수요량(L), unit_price=판가($/L), currency=USD,
//        demand_source=market_intel, region, supply_qty/expected_revenue 산출 저장
//   - production_capacity: 5제품 × 12개월 = 60행 (nameplate·utilization)
//   - 고객 매핑: Samsung→삼성전자, SK hynix→SK하이닉스, Micron/Intel(영문 존재),
//        TSMC(대만)·YMTC(중국) 신규 생성
//
//   ⚠️ 정리(요구사항 6): 기존 KRW 더미(production_forecasts) + 직전 semicon 시드 제거.
//      KRW 더미가 수주전환한 leads 도 함께 정리 (보고 후 승인 하에 실행).
//
//   실행: node scripts/seed-fcst-semicon.js
// =============================================================
require('dotenv').config();
const pool = require('../src/db');

const YEAR = 2026;
const M = (i) => `${YEAR}-${String(i + 1).padStart(2, '0')}`; // 0→2026-01

// ── 엑셀 ① MI 수요 (지역·고객·제품·판가·12개월 수요량 L) ──────────
const DEMAND = [
  { region: '한국', cust: 'Samsung', prod: 'D1b ArF PR', price: 4500, m: [8000, 8200, 8500, 8800, 9000, 9300, 9600, 9900, 10200, 10500, 10800, 11000] },
  { region: '한국', cust: 'SK hynix', prod: 'D1b ArF PR', price: 4400, m: [6000, 6200, 6400, 6700, 6900, 7100, 7400, 7600, 7900, 8100, 8300, 8500] },
  { region: '미국', cust: 'Micron', prod: 'D1b ArF PR', price: 4600, m: [3000, 3100, 3200, 3350, 3450, 3550, 3700, 3800, 3900, 4000, 4100, 4200] },
  { region: '한국', cust: 'Samsung', prod: 'V8 SOC Thick PR', price: 3800, m: [5000, 5100, 5300, 5450, 5600, 5750, 5900, 6050, 6200, 6350, 6500, 6600] },
  { region: '한국', cust: 'SK hynix', prod: 'V8 SOC Thick PR', price: 3750, m: [4000, 4100, 4200, 4350, 4450, 4600, 4700, 4850, 4950, 5100, 5200, 5300] },
  { region: '미국', cust: 'Micron', prod: 'V8 SOC Thick PR', price: 3900, m: [2000, 2050, 2120, 2180, 2250, 2300, 2380, 2450, 2520, 2580, 2650, 2700] },
  { region: '한국', cust: 'Samsung', prod: 'D1c EUV PR', price: 12000, m: [1500, 1650, 1850, 2050, 2250, 2450, 2700, 2900, 3100, 3300, 3450, 3600] },
  { region: '한국', cust: 'SK hynix', prod: 'D1c EUV PR', price: 11800, m: [1200, 1350, 1500, 1650, 1850, 2050, 2250, 2400, 2600, 2750, 2900, 3000] },
  { region: '대만', cust: 'TSMC', prod: 'D1c EUV PR', price: 13500, m: [2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000, 4200, 4350, 4500] },
  { region: '미국', cust: 'Intel', prod: 'D1c EUV PR', price: 13000, m: [800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 1950, 2050, 2150, 2200] },
  { region: '한국', cust: 'Samsung', prod: 'Eco Thinner', price: 1200, m: [12000, 12300, 12600, 12900, 13200, 13500, 13800, 14100, 14400, 14700, 15100, 15500] },
  { region: '한국', cust: 'SK hynix', prod: 'Eco Thinner', price: 1180, m: [9000, 9250, 9500, 9750, 10000, 10250, 10500, 10800, 11050, 11300, 11550, 11800] },
  { region: '대만', cust: 'TSMC', prod: 'Eco Thinner', price: 1250, m: [7000, 7180, 7360, 7540, 7720, 7900, 8080, 8260, 8440, 8620, 8900, 9100] },
  { region: '한국', cust: 'Samsung', prod: 'V9 Etch-resist PR', price: 5200, m: [3000, 3120, 3250, 3380, 3500, 3650, 3780, 3900, 4050, 4200, 4350, 4500] },
  { region: '한국', cust: 'SK hynix', prod: 'V9 Etch-resist PR', price: 5150, m: [2500, 2600, 2700, 2820, 2920, 3050, 3150, 3280, 3400, 3520, 3650, 3800] },
  { region: '미국', cust: 'Micron', prod: 'V9 Etch-resist PR', price: 5300, m: [1500, 1560, 1620, 1690, 1750, 1820, 1890, 1960, 2030, 2100, 2200, 2300] },
  { region: '중국', cust: 'YMTC', prod: 'V9 Etch-resist PR', price: 5000, m: [1000, 1060, 1120, 1180, 1240, 1310, 1380, 1450, 1520, 1580, 1640, 1700] },
];

// ── 엑셀 ② 생산 Capa (제품·Nameplate·12개월 가동률) ──────────────
const CAPA = [
  { prod: 'D1b ArF PR', nameplate: 24000, util: [0.86, 0.87, 0.88, 0.88, 0.89, 0.9, 0.9, 0.91, 0.91, 0.92, 0.92, 0.92] },
  { prod: 'V8 SOC Thick PR', nameplate: 16000, util: [0.88, 0.88, 0.89, 0.89, 0.9, 0.9, 0.91, 0.91, 0.92, 0.92, 0.93, 0.93] },
  { prod: 'D1c EUV PR', nameplate: 9000, util: [0.78, 0.8, 0.82, 0.84, 0.85, 0.86, 0.87, 0.88, 0.88, 0.89, 0.9, 0.9] },
  { prod: 'Eco Thinner', nameplate: 40000, util: [0.9, 0.9, 0.91, 0.91, 0.92, 0.92, 0.93, 0.93, 0.94, 0.94, 0.95, 0.95] },
  { prod: 'V9 Etch-resist PR', nameplate: 14000, util: [0.87, 0.88, 0.88, 0.89, 0.89, 0.9, 0.9, 0.91, 0.91, 0.92, 0.92, 0.93] },
];

// 엑셀 고객명 → 시스템 고객 (canonical) + 신규 생성 정보
const CUST_MAP = {
  Samsung: { name: '삼성전자' },
  'SK hynix': { name: 'SK하이닉스' },
  Micron: { name: 'Micron' },
  Intel: { name: 'Intel' },
  TSMC: { name: 'TSMC', create: { region: '해외', country: '대만', industry: '반도체(파운드리)' } },
  YMTC: { name: 'YMTC', create: { region: '해외', country: '중국', industry: '반도체(메모리)' } },
};

const BIZ_TYPE = {
  'D1b ArF PR': '포토레지스트',
  'V8 SOC Thick PR': '포토레지스트',
  'D1c EUV PR': '포토레지스트',
  'Eco Thinner': '신너',
  'V9 Etch-resist PR': '포토레지스트',
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function resolveCustomer(conn, sysName, createInfo) {
  const [[hit]] = await conn.query('SELECT MIN(id) AS id FROM customers WHERE name=?', [sysName]);
  if (hit && hit.id) return hit.id;
  if (!createInfo) throw new Error(`고객 미존재 + 생성정보 없음: ${sysName}`);
  const [r] = await conn.query(
    'INSERT INTO customers (name, region, country, industry) VALUES (?,?,?,?)',
    [sysName, createInfo.region, createInfo.country, createInfo.industry]
  );
  console.log(`  + 고객 신규 생성: ${sysName} (id=${r.insertId})`);
  return r.insertId;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1) 정리: 기존 KRW 더미 + 직전 semicon 시드 ────────────────
    const [[krw]] = await conn.query(
      "SELECT COUNT(*) AS n FROM production_forecasts WHERE currency='KRW'"
    );
    const [convLeads] = await conn.query(
      "SELECT DISTINCT converted_lead_id AS id FROM production_forecasts WHERE currency='KRW' AND converted_lead_id IS NOT NULL"
    );
    const leadIds = convLeads.map((x) => x.id).filter(Boolean);
    if (leadIds.length) {
      await conn.query(`DELETE FROM leads WHERE id IN (${leadIds.map(() => '?').join(',')})`, leadIds);
      console.log(`  - 더미 수주전환 leads 삭제: ${leadIds.length}건 (${leadIds.join(',')})`);
    }
    const [delPf] = await conn.query(
      "DELETE FROM production_forecasts WHERE currency='KRW' OR demand_source='market_intel'"
    );
    const [delCap] = await conn.query('DELETE FROM production_capacity');
    console.log(`  - production_forecasts 정리: ${delPf.affectedRows}건 (KRW 더미 ${krw.n} 포함)`);
    console.log(`  - production_capacity 정리: ${delCap.affectedRows}건`);

    // ── 2) 고객 해소(매핑/생성) ───────────────────────────────────
    const custId = {};
    for (const key of Object.keys(CUST_MAP)) {
      const info = CUST_MAP[key];
      custId[key] = await resolveCustomer(conn, info.name, info.create);
    }

    // ── 3) 공급 배분 사전 계산: 제품|월 총수요 → 충족률 ──────────
    const totDemand = {}; // prod|monthIdx → sum
    for (const d of DEMAND) {
      d.m.forEach((q, i) => {
        const k = `${d.prod}|${i}`;
        totDemand[k] = (totDemand[k] || 0) + q;
      });
    }
    const capaMap = {}; // prod|monthIdx → effective capa
    for (const c of CAPA) {
      c.util.forEach((u, i) => {
        capaMap[`${c.prod}|${i}`] = c.nameplate * u;
      });
    }

    // ── 4) production_forecasts 삽입 (204행) ──────────────────────
    const pfRows = [];
    for (const d of DEMAND) {
      const sysName = CUST_MAP[d.cust].name;
      d.m.forEach((qty, i) => {
        const k = `${d.prod}|${i}`;
        const eff = capaMap[k];
        const total = totDemand[k] || 0;
        const ratio = eff != null && total > 0 ? Math.min(1, eff / total) : 1;
        const supply = r2(qty * ratio);
        const revenue = r2(supply * d.price);
        pfRows.push([
          custId[d.cust], sysName, d.prod, BIZ_TYPE[d.prod] || '포토소재',
          M(i), qty, 'L', d.price, revenue, supply, 'USD', '예측', 'market_intel', d.region,
        ]);
      });
    }
    await conn.query(
      `INSERT INTO production_forecasts
        (customer_id, customer_name, product_name, business_type, period,
         forecast_qty, unit, unit_price, expected_revenue, supply_qty,
         currency, status, demand_source, region)
       VALUES ${pfRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      pfRows.flat()
    );

    // ── 5) production_capacity 삽입 (60행) ────────────────────────
    const capRows = [];
    for (const c of CAPA) {
      c.util.forEach((u, i) => {
        capRows.push([c.prod, M(i), c.nameplate, u, 'L']);
      });
    }
    await conn.query(
      `INSERT INTO production_capacity (product_name, period, nameplate, utilization, unit)
       VALUES ${capRows.map(() => '(?,?,?,?,?)').join(',')}`,
      capRows.flat()
    );

    await conn.commit();

    // ── 검증 요약 ─────────────────────────────────────────────────
    const annDemand = DEMAND.reduce((s, d) => s + d.m.reduce((a, b) => a + b, 0), 0);
    let annRev = 0;
    for (const row of pfRows) annRev += Number(row[8]); // expected_revenue
    console.log(`\n✅ 시드 완료`);
    console.log(`  production_forecasts: ${pfRows.length}행 (17 고객×제품 × 12월)`);
    console.log(`  production_capacity:  ${capRows.length}행 (5 제품 × 12월)`);
    console.log(`  연간 소재 수요: ${annDemand.toLocaleString()} L`);
    console.log(`  연간 FCST 매출: $${Math.round(annRev).toLocaleString()}K`);
  } catch (e) {
    await conn.rollback();
    console.error('ERR', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
