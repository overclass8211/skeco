'use strict';
// =============================================================
// scripts/seed-360-demo.js — 고객360뷰/포캐스트용 양질 데모 시드 (추가형·멱등)
//
//   npm run db:seed-360
//
// 대상 DB 는 .env 의 DB_NAME (DB명 하드코딩 없음).
//
// 설계(단계 비례 퍼널):
//   - 신규 고객사 10곳, 각 2~3개 딜(leads)
//   - 딜 단계에 맞춰 산출물 생성 (비현실적 조합 방지)
//       lead/review        → 산출물 없음
//       proposal/bidding   → 견적(sent) + 제안(sent)
//       negotiation        → 견적(sent) + 제안(review)
//       won                → 견적(accepted) + 제안(accepted) + 계약(active)
//   - 기존 후기단계 딜 일부에도 산출물 보강(기존 고객 360뷰도 채워짐)
//
// 멱등성:
//   - 고객사: name 으로 존재 확인 후 없을 때만 INSERT
//   - 딜(leads): (customer_id, project_name) 으로 존재 확인
//   - 견적/제안/계약: 고유번호(quote_no/proposal_no/contract_no) INSERT IGNORE
//   - quote_items: 해당 quote 에 항목 없을 때만 INSERT
//   → 재실행해도 중복 생성 없음. DROP/DELETE 없음(기존 데이터 보존).
//
// 금액 단위: 원(₩) 풀값 (억 → ×100,000,000)
// =============================================================
require('dotenv').config({ override: true });
const pool = require('../src/db');
const config = require('../config');

const EOK = 100000000;

// 사업유형별 담당자(국내) / 해외는 한해외(6)
const OWNER_BY_BIZ = {
  식각가스: 1,
  프리커서: 2,
  디스플레이소재: 3,
  포토소재: 4,
  통합서비스: 5,
  'Wet Chemical': 7,
};
const ownerFor = (biz, region) => (region === '해외' ? 6 : OWNER_BY_BIZ[biz] || 1);

// 사업유형별 대표 품목/단위/연간물량(견적 라인용)
const ITEM_BY_BIZ = {
  식각가스: { item: '식각가스 C4F6 (반도체 etch용)', spec: '99.999%', unit: 'kg', qty: 5000 },
  프리커서: { item: '프리커서 Hf 전구체 (HfCl4계)', spec: 'ALD급', unit: 'kg', qty: 1200 },
  'Wet Chemical': { item: '고선택비 인산 (Wet Chemical)', spec: 'SEMI급', unit: 'L', qty: 80000 },
  디스플레이소재: { item: 'OLED 발광/수송 소재', spec: '승화정제', unit: 'g', qty: 4500 },
  포토소재: { item: 'ArF PR / SOC 하드마스크', spec: 'EUV/ArF', unit: 'L', qty: 600 },
  통합서비스: { item: 'Gas+물류 통합공급(BSGS)', spec: '연간계약', unit: '식', qty: 1 },
};

// 신규 고객사 + 딜
const CUSTOMERS = [
  {
    name: '글로벌파운드리', region: '해외', country: '미국', industry: '반도체(파운드리)',
    contact: 'Tom Becker', phone: '+1-518-305-9013', email: 'tbecker@gf.com',
    deals: [
      { project: 'Fab8 식각가스 C4F6 연간공급', biz: '식각가스', amt: 65, stage: 'proposal', close: '2026-09-20' },
      { project: 'Malta Wet Chemical 인산 평가', biz: 'Wet Chemical', amt: 28, stage: 'review', close: '2026-11-10' },
    ],
  },
  {
    name: 'UMC', region: '해외', country: '대만', industry: '반도체(파운드리)',
    contact: 'Chen Wei', phone: '+886-3-578-2258', email: 'chenwei@umc.com',
    deals: [
      { project: 'Fab12A 프리커서 Hf 공급', biz: '프리커서', amt: 72, stage: 'negotiation', close: '2026-08-05' },
      { project: 'Tainan SOC 하드마스크 PoC', biz: '포토소재', amt: 40, stage: 'lead', close: '2026-12-01' },
      { project: 'Fab12 식각가스 CH3F 연간계약', biz: '식각가스', amt: 88, stage: 'won', close: '2026-05-15' },
    ],
  },
  {
    name: '르네사스', region: '해외', country: '일본', industry: '반도체',
    contact: 'Tanaka Hiro', phone: '+81-3-6773-3000', email: 'tanaka@renesas.com',
    deals: [
      { project: 'Naka 식각가스 통합공급', biz: '통합서비스', amt: 55, stage: 'proposal', close: '2026-09-30' },
      { project: 'Kofu 프리커서 Zr 공급', biz: '프리커서', amt: 33, stage: 'bidding', close: '2026-07-22', deadline: '2026-07-18' },
    ],
  },
  {
    name: '인피니언', region: '해외', country: '독일', industry: '반도체',
    contact: 'Klaus Weber', phone: '+49-89-234-0', email: 'kweber@infineon.com',
    deals: [
      { project: 'Dresden ArF PR 국산대체 평가', biz: '포토소재', amt: 48, stage: 'review', close: '2026-10-25' },
      { project: 'Villach Wet Chemical 공급', biz: 'Wet Chemical', amt: 30, stage: 'proposal', close: '2026-09-12' },
    ],
  },
  {
    name: '매그나칩반도체', region: '국내', country: '대한민국', industry: '반도체',
    contact: '김상무', phone: '02-6903-3000', email: 'smkim@magnachip.com',
    deals: [
      { project: '구미 식각가스 C4F6 공급', biz: '식각가스', amt: 36, stage: 'won', close: '2026-04-28' },
      { project: '청주 Wet Chemical 인산', biz: 'Wet Chemical', amt: 22, stage: 'negotiation', close: '2026-07-28' },
    ],
  },
  {
    name: '네패스', region: '국내', country: '대한민국', industry: '반도체(패키징)',
    contact: '이부장', phone: '043-879-7000', email: 'blee@nepes.co.kr',
    deals: [
      { project: '음성 포토 SOC 하드마스크', biz: '포토소재', amt: 26, stage: 'proposal', close: '2026-09-18' },
      { project: 'WLP Wet Chemical 공급', biz: 'Wet Chemical', amt: 18, stage: 'lead', close: '2026-12-10' },
    ],
  },
  {
    name: '비전옥스', region: '해외', country: '중국', industry: '디스플레이',
    contact: 'Zhang Min', phone: '+86-10-8260-8888', email: 'zhangmin@visionox.com',
    deals: [
      { project: 'V3 OLED 블루도판트 공급', biz: '디스플레이소재', amt: 50, stage: 'proposal', close: '2026-09-25' },
      { project: 'V3 HTL 소재 평가', biz: '디스플레이소재', amt: 24, stage: 'review', close: '2026-11-05' },
      { project: 'Hefei OLED 소재 패키지', biz: '디스플레이소재', amt: 62, stage: 'won', close: '2026-05-08' },
    ],
  },
  {
    name: 'JDI', region: '해외', country: '일본', industry: '디스플레이',
    contact: 'Suzuki Ken', phone: '+81-3-6732-7700', email: 'suzuki@j-display.com',
    deals: [
      { project: 'Mobara HTL/ETL 공급', biz: '디스플레이소재', amt: 29, stage: 'bidding', close: '2026-07-26', deadline: '2026-07-20' },
      { project: 'OLED 블루도판트 초도', biz: '디스플레이소재', amt: 20, stage: 'lead', close: '2026-12-15' },
    ],
  },
  {
    name: '이노룩스', region: '해외', country: '대만', industry: '디스플레이',
    contact: 'Lin Jie', phone: '+886-3-598-3000', email: 'linjie@innolux.com',
    deals: [
      { project: 'Tainan OLED 소재 평가', biz: '디스플레이소재', amt: 34, stage: 'proposal', close: '2026-09-08' },
      { project: 'Fab 디스플레이 Wet Chemical', biz: 'Wet Chemical', amt: 19, stage: 'review', close: '2026-11-18' },
    ],
  },
  {
    name: '어보브반도체', region: '국내', country: '대한민국', industry: '반도체',
    contact: '최과장', phone: '02-2106-2000', email: 'choi@abov.co.kr',
    deals: [
      { project: '판교 프리커서 Hf 공급', biz: '프리커서', amt: 27, stage: 'negotiation', close: '2026-07-30' },
      { project: 'MCU 식각가스 공급', biz: '식각가스', amt: 21, stage: 'proposal', close: '2026-09-15' },
    ],
  },
];

// 기존 후기단계 딜 보강 (project_name 으로 매칭)
const ENRICH_EXISTING = [
  { project: '평택 P4 식각가스 C4F6 연간공급', biz: '식각가스', amt: 120, stage: 'bidding', close: '2026-07-15' },
  { project: 'M16 프리커서 Hf 전구체 공급', biz: '프리커서', amt: 95, stage: 'proposal', close: '2026-08-20' },
  { project: 'OLED 블루도판트 초도물량', biz: '디스플레이소재', amt: 24, stage: 'won', close: '2026-05-30' },
];

// 단계 → 산출물 규칙
function artifactsFor(stage) {
  switch (stage) {
    case 'proposal':
    case 'bidding':
      return { quote: 'sent', proposal: 'sent', contract: null };
    case 'negotiation':
      return { quote: 'sent', proposal: 'review', contract: null };
    case 'won':
      return { quote: 'accepted', proposal: 'accepted', contract: 'active' };
    default:
      return { quote: null, proposal: null, contract: null };
  }
}

let SEQ = 1000; // 고유번호 시퀀스 (결정적)
const pad = n => String(n).padStart(4, '0');

async function upsertCustomer(conn, c) {
  const [rows] = await conn.query('SELECT id FROM customers WHERE name=? LIMIT 1', [c.name]);
  if (rows.length) return rows[0].id;
  const [r] = await conn.query(
    `INSERT INTO customers (name, region, country, industry, contact_person, phone, email)
     VALUES (?,?,?,?,?,?,?)`,
    [c.name, c.region, c.country, c.industry, c.contact, c.phone, c.email]
  );
  return r.insertId;
}

async function upsertLead(conn, custId, custName, d) {
  const [rows] = await conn.query(
    'SELECT id, expected_amount, stage FROM leads WHERE customer_id<=>? AND project_name=? LIMIT 1',
    [custId, d.project]
  );
  const amountWon = d.amt * EOK;
  const owner = ownerFor(d.biz, d.region);
  if (rows.length) return rows[0].id;
  const [r] = await conn.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region,
                        capacity_mw, expected_amount, currency, stage, assigned_to,
                        expected_close_date, bidding_deadline, notes)
     VALUES (?,?,?,?,?,0,?,'KRW',?,?,?,?,?)`,
    [custId, custName, d.project, d.biz, d.region, amountWon, d.stage, owner,
     d.close, d.deadline || null, '데모 시드 — 단계 비례 퍼널']
  );
  return r.insertId;
}

async function ensureQuote(conn, { leadId, custId, custName, d, status }) {
  SEQ += 1;
  const quoteNo = `Q-2026-${pad(SEQ)}`;
  const amountWon = d.amt * EOK;
  const subtotal = amountWon;
  const vat = Math.round(amountWon * 0.1);
  const total = subtotal + vat;
  await conn.query(
    `INSERT IGNORE INTO quotes (quote_no, name, lead_id, customer_id, customer_name,
        quote_date, vat_included, subtotal, vat_amount, total_amount, created_by, status)
     VALUES (?,?,?,?,?,?,1,?,?,?,?,?)`,
    [quoteNo, `${d.project} 견적`, leadId, custId, custName, d.close, subtotal, vat, total, ownerFor(d.biz, d.region), status]
  );
  const [q] = await conn.query('SELECT id FROM quotes WHERE quote_no=? LIMIT 1', [quoteNo]);
  const quoteId = q[0].id;
  // quote_items — 항목 없을 때만
  const [items] = await conn.query('SELECT COUNT(*) AS n FROM quote_items WHERE quote_id=?', [quoteId]);
  if (items[0].n === 0) {
    const it = ITEM_BY_BIZ[d.biz] || { item: d.biz, spec: '-', unit: '식', qty: 1 };
    const unitPrice = Math.round(subtotal / it.qty);
    await conn.query(
      `INSERT INTO quote_items (quote_id, display_order, item_name, spec, unit_price,
          discount_pct, supply_price, quantity, proposed_amount, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [quoteId, 1, it.item, it.spec, unitPrice, 0, subtotal, it.qty, subtotal, `${d.project} 연간 공급물량`]
    );
  }
  return { quoteId, quoteNo, total };
}

async function ensureProposal(conn, { leadId, custId, custName, d, status, quoteId, quoteNo }) {
  SEQ += 1;
  const proposalNo = `P-2026-${pad(SEQ)}`;
  const amountWon = d.amt * EOK;
  const owner = ownerFor(d.biz, d.region);
  await conn.query(
    `INSERT IGNORE INTO proposals (proposal_no, proposal_title, lead_id, customer_id, customer_name,
        quote_id, quote_no, proposal_date, due_date, status, owner_id, expected_amount, currency, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'KRW',?)`,
    [proposalNo, `${d.project} 제안서`, leadId, custId, custName, quoteId || null, quoteNo || null,
     d.close, d.close, status, owner, amountWon, '데모 시드']
  );
  const [p] = await conn.query('SELECT id FROM proposals WHERE proposal_no=? LIMIT 1', [proposalNo]);
  return { proposalId: p[0].id, proposalNo };
}

async function ensureContract(conn, { leadId, custId, custName, d, status, quoteId, proposalId }) {
  SEQ += 1;
  const contractNo = `C-2026-${pad(SEQ)}`;
  const amountWon = d.amt * EOK;
  const start = d.close;
  const end = `${Number(d.close.slice(0, 4)) + 1}${d.close.slice(4)}`; // +1년
  await conn.query(
    `INSERT IGNORE INTO contracts (contract_no, title, customer_id, customer_name, proposal_id,
        lead_id, quote_id, contract_type, status, start_date, end_date, contract_amount,
        currency, owner_id, notes)
     VALUES (?,?,?,?,?,?,?,'supply',?,?,?,?,'KRW',?,?)`,
    [contractNo, `${d.project} 공급계약`, custId, custName, proposalId || null, leadId, quoteId || null,
     status, start, end, amountWon, ownerFor(d.biz, d.region), '데모 시드 — 연간 공급계약']
  );
}

async function buildArtifacts(conn, { leadId, custId, custName, d }) {
  const rule = artifactsFor(d.stage);
  let quoteId = null;
  let quoteNo = null;
  let proposalId = null;
  if (rule.quote) {
    const q = await ensureQuote(conn, { leadId, custId, custName, d, status: rule.quote });
    quoteId = q.quoteId;
    quoteNo = q.quoteNo;
  }
  if (rule.proposal) {
    const p = await ensureProposal(conn, { leadId, custId, custName, d, status: rule.proposal, quoteId, quoteNo });
    proposalId = p.proposalId;
  }
  if (rule.contract) {
    await ensureContract(conn, { leadId, custId, custName, d, status: rule.contract, quoteId, proposalId });
  }
  return rule;
}

(async () => {
  let code = 0;
  const conn = await pool.getConnection();
  const counts = { customers: 0, leads: 0, quotes: 0, proposals: 0, contracts: 0 };
  try {
    console.log(`▶ 고객360 데모 시드 — target=${config.db.database} (추가형·멱등, DROP 없음)`);

    // 1) 신규 고객사 + 딜 + 산출물
    for (const c of CUSTOMERS) {
      const before = (await conn.query('SELECT id FROM customers WHERE name=?', [c.name]))[0].length;
      const custId = await upsertCustomer(conn, c);
      if (!before) counts.customers += 1;
      for (const d of c.deals) {
        d.region = c.region;
        const leadId = await upsertLead(conn, custId, c.name, d);
        counts.leads += 1;
        const rule = await buildArtifacts(conn, { leadId, custId, custName: c.name, d });
        if (rule.quote) counts.quotes += 1;
        if (rule.proposal) counts.proposals += 1;
        if (rule.contract) counts.contracts += 1;
      }
    }

    // 2) 기존 후기단계 딜 보강
    for (const d of ENRICH_EXISTING) {
      const [rows] = await conn.query(
        'SELECT id, customer_id, customer_name FROM leads WHERE project_name=? LIMIT 1',
        [d.project]
      );
      if (!rows.length) {
        console.log(`  · (건너뜀) 기존 딜 없음: ${d.project}`);
        continue;
      }
      const lead = rows[0];
      d.region = '국내';
      const rule = await buildArtifacts(conn, {
        leadId: lead.id, custId: lead.customer_id, custName: lead.customer_name, d,
      });
      if (rule.quote) counts.quotes += 1;
      if (rule.proposal) counts.proposals += 1;
      if (rule.contract) counts.contracts += 1;
    }

    // customer_id 백필 (기존 매칭 로직과 동일하게 quotes/proposals/contracts 의 customer_id 보강)
    console.log('\n✅ 시드 완료(멱등):');
    console.log(`  · 신규 고객사: ${counts.customers}`);
    console.log(`  · 딜(leads) 처리: ${counts.leads}`);
    console.log(`  · 견적: ${counts.quotes} · 제안: ${counts.proposals} · 계약: ${counts.contracts}`);
    const [[tot]] = await conn.query('SELECT COUNT(*) AS n FROM customers');
    console.log(`  · 현재 총 고객사: ${tot.n}`);
  } catch (e) {
    console.error('❌ 시드 실패:', e.message);
    code = 1;
  } finally {
    conn.release();
    await pool.end();
    process.exit(code);
  }
})();
