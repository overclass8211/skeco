'use strict';
// =============================================================
// scripts/purge-test-data.js — 테스트 잔재(고아 데이터) 정리
//
//   node scripts/purge-test-data.js --dry   # 미리보기(삭제 안 함)
//   node scripts/purge-test-data.js         # 실제 삭제 (트랜잭션)
//
// vitest/e2e 가 개발 DB 에 생성한 픽스처(__TEST__/__C360/__QCASE 마커)가
// teardown 누락으로 누적 → FK 고아 + 카운트 오염. 이를 일괄 제거한다.
//
// 안전장치:
//   - 마커는 '리터럴' 매칭 (LIKE ESCAPE — '_' 와일드카드 오탐 방지)
//   - 자식 → 부모 순서로 트랜잭션 삭제 (없는 컬럼은 자동 skip)
//   - before/after 카운트 + FK 고아 재검 출력. 멱등(재실행 안전).
//   - 핵심 마스터(customers/leads/customer_materials)는 손대지 않음
// =============================================================
require('dotenv').config({ override: true });
const pool = require('../src/db');

const DRY = process.argv.includes('--dry');

// 리터럴 마커 매칭 — JS '\\_' → SQL '\_' (이스케이프된 underscore = 문자 '_')
const T = col =>
  `(${col} LIKE '%\\_\\_TEST%' OR ${col} LIKE '%\\_\\_C360%' OR ${col} LIKE '%\\_\\_QCASE%')`;

// 부모 테이블 + 마커 컬럼 + 자식 [테이블, FK컬럼]
const PLAN = [
  { t: 'quotes', col: 'customer_name', children: [['quote_items', 'quote_id']] },
  {
    t: 'proposals',
    col: 'customer_name',
    children: [
      ['proposal_files', 'proposal_id'],
      ['proposal_evaluations', 'proposal_id'],
      ['proposal_revisions', 'proposal_id'],
      ['proposal_history', 'proposal_id'],
      ['proposal_email_logs', 'proposal_id'],
    ],
  },
  {
    t: 'contracts',
    col: 'customer_name',
    children: [
      ['contract_comments', 'contract_id'],
      ['contract_files', 'contract_id'],
      ['contract_history', 'contract_id'],
      ['contract_legal_reviews', 'contract_id'],
      ['contract_notifications', 'contract_id'],
      ['contract_share_links', 'contract_id'], // → share_recipients 는 CASCADE
      ['esign_events', 'contract_id'],
    ],
  },
  {
    t: 'payment_schedules',
    col: 'customer_name',
    children: [
      ['payment_records', 'schedule_id'],
      ['payment_notifications', 'schedule_id'],
    ],
  },
  {
    t: 'projects',
    col: 'customer_name',
    children: [
      ['project_milestone_files', 'project_id'],
      ['project_milestones', 'project_id'],
      ['project_stage_history', 'project_id'],
      ['activities', 'project_id'],
    ],
  },
];

async function colExists(table, col) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`,
    [table, col]
  );
  return r.n > 0;
}

(async () => {
  console.log(`\n=== 테스트 잔재 정리 ${DRY ? '(DRY-RUN — 삭제 안 함)' : '(실제 삭제)'} ===\n`);

  // 1) before 카운트
  const before = {};
  for (const { t, col } of PLAN) {
    const [[r]] = await pool.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE ${T(col)}`);
    before[t] = r.n;
  }
  console.log('대상 행 (마커 일치):', JSON.stringify(before));

  if (DRY) {
    console.log('\nDRY-RUN 종료 — 실제 삭제하려면 --dry 없이 실행하세요.');
    process.exit(0);
  }

  const conn = await pool.getConnection();
  let deletedChildren = 0;
  let deletedParents = 0;
  try {
    await conn.beginTransaction();
    for (const { t, col, children } of PLAN) {
      // 대상 부모 id 수집
      const [ids] = await conn.query(`SELECT id FROM \`${t}\` WHERE ${T(col)}`);
      const idList = ids.map(r => r.id);
      if (!idList.length) continue;
      // 자식 먼저 삭제 (컬럼 존재 시)
      for (const [ct, cc] of children) {
        if (!(await colExists(ct, cc))) {
          console.log(`  · skip ${ct}.${cc} (컬럼 없음)`);
          continue;
        }
        const [r] = await conn.query(`DELETE FROM \`${ct}\` WHERE \`${cc}\` IN (?)`, [idList]);
        if (r.affectedRows) {
          deletedChildren += r.affectedRows;
          console.log(`  - ${ct}: ${r.affectedRows}`);
        }
      }
      // 부모 삭제
      const [pr] = await conn.query(`DELETE FROM \`${t}\` WHERE ${T(col)}`);
      deletedParents += pr.affectedRows;
      console.log(`  = ${t}: ${pr.affectedRows}`);
    }
    await conn.commit();
    console.log(`\n커밋 완료 — 부모 ${deletedParents}행 + 자식 ${deletedChildren}행 삭제`);
  } catch (e) {
    await conn.rollback();
    console.error('롤백 — 삭제 실패:', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }

  // 2) FK 고아 재검 (도메인 FK)
  const checks = [
    ['payment_schedules', 'contract_id', 'contracts'],
    ['projects', 'contract_id', 'contracts'],
    ['proposals', 'quote_id', 'quotes'],
    ['quotes', 'customer_id', 'customers'],
    ['quotes', 'lead_id', 'leads'],
  ];
  const remain = [];
  for (const [ch, c, p] of checks) {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) n FROM \`${ch}\` x WHERE x.\`${c}\` IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM \`${p}\` pp WHERE pp.id=x.\`${c}\`)`
    );
    if (r.n) remain.push(`${ch}.${c}=${r.n}`);
  }
  console.log('\nFK 고아 재검:', remain.length ? remain.join(', ') : '0 (모두 해소)');
  process.exit(0);
})().catch(e => {
  console.error('ERR', e.message);
  process.exit(1);
});
