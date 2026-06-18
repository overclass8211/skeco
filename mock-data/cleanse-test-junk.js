// =============================================================
// 합성 테스트 데이터 클린징 (안전 절차)
//
//   node mock-data/cleanse-test-junk.js            # 백업 + 시뮬레이션(미삭제) — 기본
//   node mock-data/cleanse-test-junk.js --execute  # 백업 후 트랜잭션 삭제
//
// 원칙(= db-mutation-safety):
//   - SELECT 로만 패턴 탐지(REGEXP, 언더스코어 와일드카드 회피) → 명시적 id 목록 확보
//   - DELETE 는 오직 `WHERE id IN (?)` (LIKE 패턴 절대 금지)
//   - 전 과정 단일 트랜잭션 → 실패 시 전체 롤백(부분삭제 없음)
//   - 삭제 전 영향 테이블 전량 JSON 백업(복원 가능)
//   - 자식행은 FK ON DELETE CASCADE 가 DB 레벨에서 안전 처리
// =============================================================
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

// 합성 테스트 패턴(실고객명 보호): Bulk__TEST__ / __TEST__ / 테스트<숫자> / 테스트고객
const JUNK = '^(Bulk__TEST__|__TEST__|테스트[0-9]|테스트고객)';

// 부모 테이블 → 패턴 매칭 컬럼
const PARENTS = [
  { table: 'customers', col: 'name' },
  { table: 'leads', col: 'customer_name' },
  { table: 'contracts', col: 'customer_name' },
  { table: 'proposals', col: 'customer_name' },
  { table: 'quotes', col: 'customer_name' },
  { table: 'payment_schedules', col: 'customer_name' },
  { table: 'tax_invoices', col: 'customer_name' },
  { table: 'calendar_events', col: 'customer_name' },
  { table: 'meeting_minutes', col: 'customer_name' },
  { table: 'payment_notifications', col: 'customer_name' },
];

// 백업 대상(부모 + CASCADE 자식 + 연관) — 전량 덤프로 복원 가능
const BACKUP_TABLES = [
  ...PARENTS.map(p => p.table),
  'quote_items',
  'proposal_files', 'proposal_evaluations', 'proposal_email_logs', 'proposal_history', 'proposal_revisions',
  'contract_comments', 'contract_files', 'contract_history', 'contract_legal_reviews',
  'contract_notifications', 'contract_share_links', 'esign_events',
  'activities', 'lead_comments', 'lead_supports',
  'customer_briefs', 'customer_name_history', 'payment_records', 'projects',
];

async function main() {
  const execute = process.argv.includes('--execute');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 1) 패턴 매칭 id 목록 (명시적) 확보
  const manifest = {};
  let totalRows = 0;
  for (const { table, col } of PARENTS) {
    const [rows] = await pool.query(`SELECT id FROM \`${table}\` WHERE \`${col}\` REGEXP ?`, [JUNK]);
    manifest[table] = rows.map(r => r.id);
    totalRows += rows.length;
  }
  console.log('=== 삭제 대상(명시적 id) ===');
  for (const { table } of PARENTS) console.log(`  ${table}: ${manifest[table].length}`);
  console.log(`  합계 부모행: ${totalRows} (자식행은 CASCADE 자동)`);

  // 2) 백업 — 영향 테이블 전량 JSON 덤프
  const backup = { generatedAt: ts, pattern: JUNK, manifest, tables: {} };
  for (const t of BACKUP_TABLES) {
    try {
      const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
      backup.tables[t] = rows;
    } catch (e) {
      backup.tables[t] = { error: e.message };
    }
  }
  const file = path.join(__dirname, `backup-cleanse-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 0), 'utf8');
  const sizeMB = (fs.statSync(file).size / 1048576).toFixed(2);
  console.log(`\n✅ 백업 저장: ${file} (${sizeMB} MB)`);

  if (!execute) {
    console.log('\n💡 시뮬레이션 모드 — 삭제 안 함. 실제 삭제: --execute');
    process.exit(0);
  }

  // 3) 삭제 — 단일 트랜잭션, 명시적 id IN 만 (LIKE 금지)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const deleted = {};
    for (const { table } of PARENTS) {
      const ids = manifest[table];
      if (!ids.length) { deleted[table] = 0; continue; }
      const [res] = await conn.query(`DELETE FROM \`${table}\` WHERE id IN (?)`, [ids]);
      deleted[table] = res.affectedRows;
    }
    await conn.commit();
    console.log('\n✅ 삭제 완료(트랜잭션 커밋):');
    for (const { table } of PARENTS) console.log(`  ${table}: -${deleted[table]}`);
  } catch (e) {
    await conn.rollback();
    console.error('\n❌ 오류 — 전체 롤백(삭제 없음):', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
