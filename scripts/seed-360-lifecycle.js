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

    // ── Phase 3: 사업장/담당자/샘플 (멱등) ──
    counts.sites = 0;
    counts.contacts = 0;
    counts.samples = 0;
    const CONTACT_ROLES = [
      { role: '구매', dept: '구매팀', primary: 1 },
      { role: '기술', dept: '공정기술팀', primary: 0 },
      { role: '품질', dept: '품질보증팀', primary: 0 },
    ];
    for (const { customer_id } of custWithMat) {
      const [[cinfo]] = await conn.query('SELECT name, region FROM customers WHERE id=?', [customer_id]);
      if (!cinfo) continue;
      const [[sc]] = await conn.query('SELECT COUNT(*) AS n FROM customer_sites WHERE customer_id=?', [customer_id]);
      if (sc.n === 0) {
        const site = cinfo.region === '해외' ? 'Main Fab' : '평택 사업장';
        await conn.query(
          `INSERT INTO customer_sites (customer_id, site_name, line, process, region) VALUES (?,?,?,?,?)`,
          [customer_id, site, 'Line-1', '식각/증착', cinfo.region || null]
        );
        counts.sites += 1;
      }
      const [[cc]] = await conn.query('SELECT COUNT(*) AS n FROM customer_contacts WHERE customer_id=?', [customer_id]);
      if (cc.n === 0) {
        for (const r of CONTACT_ROLES) {
          await conn.query(
            `INSERT INTO customer_contacts (customer_id, name, role, dept, is_primary) VALUES (?,?,?,?,?)`,
            [customer_id, `${cinfo.name} ${r.role}담당`, r.role, r.dept, r.primary]
          );
          counts.contacts += 1;
        }
      }
    }
    // 샘플: 샘플/평가/Spec-in 단계 소재
    const [evalMats] = await conn.query(
      `SELECT id, customer_id, material_name, lifecycle_stage, demand_unit
         FROM customer_materials WHERE lifecycle_stage IN ('sample','evaluation','specin')`
    );
    const SMP_STATUS = { sample: 'sent', evaluation: 'evaluating', specin: 'passed' };
    for (const m of evalMats) {
      const sampleNo = `SMP-M${m.id}`;
      const [[ex]] = await conn.query('SELECT COUNT(*) AS n FROM sample_requests WHERE sample_no=?', [sampleNo]);
      if (ex.n > 0) continue;
      await conn.query(
        `INSERT INTO sample_requests
           (sample_no, customer_id, customer_material_id, requested_at, purpose, lot_no,
            sent_at, qty, unit, status, result)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sampleNo, m.customer_id, m.id, '2026-05-20', `${m.material_name.split(' · ')[0]} 고객 평가용`,
          `L2026${String(m.id).padStart(4, '0')}`, '2026-05-25', 5, m.demand_unit || 'kg',
          SMP_STATUS[m.lifecycle_stage] || 'requested',
          m.lifecycle_stage === 'specin' ? 'Spec-in 승인' : m.lifecycle_stage === 'evaluation' ? '평가 진행중' : '발송 완료',
        ]
      );
      counts.samples += 1;
    }

    // ── 2번 연계용: 생산예측(production_forecasts) 데모 (소재명 1:1, 멱등) ──
    counts.prodForecasts = 0;
    const [allMats] = await conn.query(
      `SELECT m.id, m.customer_id, c.name AS customer_name, m.material_name, m.business_type,
              m.monthly_demand, m.demand_unit
         FROM customer_materials m JOIN customers c ON c.id = m.customer_id
        WHERE m.status<>'closed'`
    );
    for (const m of allMats) {
      for (let i = 0; i < MONTHS.length; i++) {
        const period = MONTHS[i];
        const [[ex]] = await conn.query(
          `SELECT COUNT(*) AS n FROM production_forecasts WHERE customer_id=? AND product_name=? AND period=?`,
          [m.customer_id, m.material_name, period]
        );
        if (ex.n > 0) continue;
        // 생산계획 수량(실제 생산 가능량 관점): 수요 대비 약간 변동
        const qty = Math.round((Number(m.monthly_demand) || 1000) * (1 + i * 0.08));
        await conn.query(
          `INSERT INTO production_forecasts
             (customer_id, customer_name, product_name, business_type, period, forecast_qty, unit, status)
           VALUES (?,?,?,?,?,?,?, '예측')`,
          [m.customer_id, m.customer_name, m.material_name, m.business_type, period, qty, m.demand_unit || 'kg']
        );
        counts.prodForecasts += 1;
      }
    }

    // ── A탭 데모: 계약 기준 수금 스케줄/입금 (멱등) ──
    counts.payments = 0;
    const [contracts] = await conn.query(
      `SELECT id, customer_id, customer_name, contract_amount FROM contracts
        WHERE status IN ('active','signed','approved','completed')`
    );
    const PAY_STAGES = [
      ['착수금', 0.3, 'collected', '2026-07-15'],
      ['중도금', 0.4, 'invoiced', '2026-08-15'],
      ['잔금', 0.3, 'scheduled', '2026-09-15'],
    ];
    for (const ct of contracts) {
      const [[ex]] = await conn.query('SELECT COUNT(*) AS n FROM payment_schedules WHERE contract_id=?', [ct.id]);
      if (ex.n > 0) continue;
      const amt = Number(ct.contract_amount) || 0;
      let i = 0;
      for (const [nm, ratio, st, due] of PAY_STAGES) {
        const sched = Math.round(amt * ratio);
        const supply = Math.round(sched / 1.1);
        const recognized = st === 'scheduled' ? null : '2026-06-01';
        const [r] = await conn.query(
          `INSERT INTO payment_schedules
             (contract_id, customer_id, customer_name, contract_name, stage_name, stage_order, ratio,
              scheduled_amount, supply_amount, tax_amount, due_date, status, recognized_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ct.id, ct.customer_id, ct.customer_name, '공급계약', nm, i + 1, ratio * 100,
           sched, supply, sched - supply, due, st, recognized]
        );
        if (st === 'collected') {
          await conn.query(
            `INSERT INTO payment_records (schedule_id, contract_id, customer_id, paid_amount, paid_date)
             VALUES (?,?,?,?,?)`,
            [r.insertId, ct.id, ct.customer_id, sched, '2026-06-05']
          );
        }
        i += 1;
        counts.payments += 1;
      }
    }

    // ── 품질 문서(CoA) 데모: 양산/Spec-in 소재 (멱등) ──
    counts.docs = 0;
    const [docMats] = await conn.query(
      `SELECT id, customer_id, material_name FROM customer_materials
        WHERE lifecycle_stage IN ('massprod','specin') AND status<>'closed'`
    );
    for (const m of docMats) {
      const docNo = `CoA-M${m.id}`;
      const [[ex]] = await conn.query('SELECT COUNT(*) AS n FROM quality_documents WHERE doc_no=?', [docNo]);
      if (ex.n > 0) continue;
      await conn.query(
        `INSERT INTO quality_documents
           (customer_id, customer_material_id, doc_type, doc_no, issued_at, valid_until, note)
         VALUES (?,?, 'CoA', ?, '2026-06-01', '2027-06-01', ?)`,
        [m.customer_id, m.id, docNo, `${m.material_name.split(' · ')[0]} 성적서`]
      );
      counts.docs += 1;
    }

    // ── 품질 문서(MSDS) 데모: 만료/임박/유효가 섞이도록 분산 (멱등) ──
    //   문서 만료 추적 화면 데모용. doc_no = MSDS-M{id} 로 CoA 와 구분.
    const MSDS_SPREAD = [
      { issued: '2024-05-01', valid: '2026-05-01' }, // 만료 (과거)
      { issued: '2024-07-08', valid: '2026-07-08' }, // 임박 (≤30일)
      { issued: '2026-04-01', valid: '2028-04-01' }, // 유효 (여유)
    ];
    for (let i = 0; i < docMats.length; i++) {
      const m = docMats[i];
      const docNo = `MSDS-M${m.id}`;
      const [[ex]] = await conn.query('SELECT COUNT(*) AS n FROM quality_documents WHERE doc_no=?', [docNo]);
      if (ex.n > 0) continue;
      const sp = MSDS_SPREAD[i % MSDS_SPREAD.length];
      await conn.query(
        `INSERT INTO quality_documents
           (customer_id, customer_material_id, doc_type, doc_no, issued_at, valid_until, note)
         VALUES (?,?, 'MSDS', ?, ?, ?, ?)`,
        [m.customer_id, m.id, docNo, sp.issued, sp.valid, `${m.material_name.split(' · ')[0]} 물질안전보건자료`]
      );
      counts.docs += 1;
    }

    // ── 고객 만족도(NPS/CSAT) 데모 — Health 관계·만족도 축 시연용 (멱등) ──
    //   대표 고객 일부에 최근 NPS/CSAT 부여(높음/보통/낮음 분산). 이미 있으면 건너뜀.
    counts.satisfaction = 0;
    const SAT_DEMO = [
      { name: '삼성전자', nps: 9, csat: 4.6 }, // 높음
      { name: 'SK하이닉스', nps: 8, csat: 4.2 },
      { name: 'UMC', nps: 6, csat: 3.4 }, // 보통
      { name: '글로벌파운드리', nps: 4, csat: 2.8 }, // 낮음
    ];
    for (const sd of SAT_DEMO) {
      const [[c]] = await conn.query('SELECT MIN(id) AS id FROM customers WHERE name=?', [sd.name]);
      if (!c || !c.id) continue;
      const [[ex]] = await conn.query(
        'SELECT COUNT(*) AS n FROM customer_satisfaction WHERE customer_id=?',
        [c.id]
      );
      if (ex.n > 0) continue;
      await conn.query(
        `INSERT INTO customer_satisfaction (customer_id, survey_type, score, surveyed_at, respondent, channel, note)
         VALUES (?, 'NPS', ?, '2026-05-20', '구매팀', 'QBR', '분기 비즈니스 리뷰'),
                (?, 'CSAT', ?, '2026-05-20', '품질팀', '설문', '연 1회 만족도 설문')`,
        [c.id, sd.nps, c.id, sd.csat]
      );
      counts.satisfaction += 2;
    }

    // ── 소속 고객(동일 회사명 담당자) 보강: 회사당 총 3명(추가 2명) — 멱등 ──
    counts.members = 0;
    const ADD_CONTACTS = [
      { role: '구매', sur: '김', given: '상우' },
      { role: '기술', sur: '이', given: '지훈' },
    ];
    const [companies] = await conn.query(
      `SELECT MIN(id) AS id, name, MAX(region) AS region, MAX(country) AS country,
              MAX(industry) AS industry, MAX(email) AS email, COUNT(*) AS cnt
         FROM customers GROUP BY name`
    );
    for (const co of companies) {
      if (co.cnt >= 3) continue; // 이미 3명 이상이면 skip
      const domain = co.email && co.email.includes('@') ? co.email.split('@')[1] : 'partner.co.kr';
      for (const c of ADD_CONTACTS) {
        const person = `${c.sur}${c.given} (${c.role}팀)`;
        const [[ex]] = await conn.query(
          'SELECT COUNT(*) AS n FROM customers WHERE name=? AND contact_person=?',
          [co.name, person]
        );
        if (ex.n > 0) continue;
        const email = `${c.role === '구매' ? 'purchase' : 'tech'}.${co.id}@${domain}`;
        await conn.query(
          `INSERT INTO customers (name, region, country, industry, contact_person, phone, email)
           VALUES (?,?,?,?,?,?,?)`,
          [co.name, co.region, co.country, co.industry, person, '02-0000-0000', email]
        );
        counts.members += 1;
      }
    }

    // ── 고객사 국내 임의 주소 채우기 (주소 없는 회사만, 동일사명 동일 주소) ──
    counts.address = 0;
    const ADDR_POOL = [
      '경기 평택시 진위면 갈곶리 678',
      '경기 화성시 반월동 산 16',
      '경기 용인시 기흥구 농서로 1',
      '경기 이천시 부발읍 경충대로 2091',
      '충북 청주시 흥덕구 옥산면 과학산업3로 92',
      '충남 천안시 서북구 성환읍 연암율금로 21',
      '경기 파주시 월롱면 엘지로 245',
      '경북 구미시 1공단로 197',
      '경기 성남시 분당구 판교로 256번길 25',
      '서울 강남구 테헤란로 521',
      '경기 안성시 원곡면 섬바위길 84',
      '대전 유성구 가정로 218',
    ];
    const [addrCos] = await conn.query(
      `SELECT name FROM customers GROUP BY name
        HAVING SUM(CASE WHEN address IS NULL OR address='' THEN 1 ELSE 0 END) > 0
        ORDER BY MIN(id)`
    );
    let ai = 0;
    for (const co of addrCos) {
      const addr = ADDR_POOL[ai % ADDR_POOL.length];
      const [r] = await conn.query(
        `UPDATE customers SET address=? WHERE name=? AND (address IS NULL OR address='')`,
        [addr, co.name]
      );
      counts.address += r.affectedRows;
      ai += 1;
    }

    console.log('\n✅ 시드 완료(멱등):');
    console.log(`  · 소재(customer_materials): ${counts.materials} 신규`);
    console.log(`  · 수요예측(demand_forecasts): ${counts.forecasts} upsert`);
    console.log(`  · 품질이슈(quality_cases): ${counts.quality}`);
    console.log(`  · 기준 포캐스트 버전: ${counts.versions} 신규`);
    console.log(`  · 사업장: ${counts.sites} · 담당자: ${counts.contacts} · 샘플: ${counts.samples} 신규`);
    console.log(`  · 생산예측(production_forecasts): ${counts.prodForecasts} 신규`);
    console.log(`  · 수금 스케줄(payment_schedules): ${counts.payments} 신규`);
    console.log(`  · 품질 문서(quality_documents): ${counts.docs} 신규`);
    console.log(`  · 고객 만족도(customer_satisfaction): ${counts.satisfaction} 신규`);
    console.log(`  · 소속 고객(동일사명 담당자): ${counts.members} 신규`);
    console.log(`  · 국내 주소 채움: ${counts.address} 행`);
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
