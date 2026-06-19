'use strict';
// =============================================================
// scripts/cleanup-dummy-customers.js — 더미/OCI 잔재 고객사 정리기
//
//   npm run db:cleanup-dummy            # DRY-RUN (조회만, 삭제 X)
//   npm run db:cleanup-dummy -- --apply # 실제 삭제 실행
//
// 대상 DB 는 .env 의 DB_NAME (DB명 하드코딩 없음).
//
// 정리 대상(보수적 · 명시적 패턴만):
//   1) email 이 @example.com (전형적 더미 시드)
//   2) email 이 @oci.co.kr (OCI 잔재)
//   3) 고객사명 = 'OCI 주식회사' 또는 'OCI ' 로 시작 (OCI 잔재)
//
// 안전장치:
//   - 기본 DRY-RUN. --apply 없이는 한 건도 삭제하지 않는다.
//   - 삭제 전 대상 목록 + 연관 레코드(영업딜/견적/제안/계약) 건수를 보고.
//   - customers 의 customer_id 는 하드 FK/CASCADE 가 아니므로 연관 레코드는
//     customer_name 으로 보존됨(고아 참조만 발생, 제약 위반 없음).
//   - 삭제 시 해당 고객의 AI 브리핑 캐시(customer_briefs)도 함께 제거.
//   - 트랜잭션으로 묶어 실패 시 전체 롤백.
// =============================================================
require('dotenv').config({ override: true });
const pool = require('../src/db');
const config = require('../config');

const APPLY = process.argv.includes('--apply');

// 명시적 정리 조건 (OR)
const WHERE = `
  (LOWER(email) LIKE '%@example.com')
  OR (LOWER(email) LIKE '%@oci.co.kr')
  OR (name = 'OCI 주식회사')
  OR (name LIKE 'OCI %')
`;

async function countLinked(conn, ids) {
  if (!ids.length) return {};
  const tables = [
    ['leads', '영업딜'],
    ['quotes', '견적'],
    ['proposals', '제안'],
    ['contracts', '계약'],
    ['customer_briefs', 'AI브리핑캐시'],
  ];
  const out = {};
  for (const [tbl, label] of tables) {
    try {
      const [r] = await conn.query(
        `SELECT COUNT(*) AS n FROM \`${tbl}\` WHERE customer_id IN (?)`,
        [ids]
      );
      out[label] = r[0].n;
    } catch (e) {
      out[label] = `(조회 불가: ${e.code || e.message})`;
    }
  }
  return out;
}

(async () => {
  let code = 0;
  const conn = await pool.getConnection();
  try {
    console.log(
      `▶ 더미/OCI 고객사 정리 — target=${config.db.database} · mode=${APPLY ? 'APPLY(삭제)' : 'DRY-RUN(조회만)'}`
    );

    const [rows] = await conn.query(
      `SELECT id, name, email, region, industry FROM customers WHERE ${WHERE} ORDER BY name`
    );

    if (!rows.length) {
      console.log('✅ 정리 대상 없음 — DB 가 이미 깨끗합니다.');
      return;
    }

    const ids = rows.map(r => r.id);
    console.log(`\n발견된 정리 대상: ${rows.length}건`);
    rows.forEach(r =>
      console.log(`  · [${r.id}] ${r.name} <${r.email || '-'}> (${r.region || '-'}/${r.industry || '-'})`)
    );

    const linked = await countLinked(conn, ids);
    console.log('\n연관 레코드(삭제되지 않고 customer_name 으로 보존, AI브리핑캐시만 함께 삭제):');
    Object.entries(linked).forEach(([k, v]) => console.log(`  · ${k}: ${v}`));

    if (!APPLY) {
      console.log(
        '\n💡 DRY-RUN 입니다. 실제 삭제하려면:  npm run db:cleanup-dummy -- --apply'
      );
      return;
    }

    await conn.beginTransaction();
    const [briefDel] = await conn.query(
      `DELETE FROM customer_briefs WHERE customer_id IN (?)`,
      [ids]
    );
    const [custDel] = await conn.query(`DELETE FROM customers WHERE id IN (?)`, [ids]);
    await conn.commit();

    console.log(
      `\n✅ 삭제 완료 — 고객사 ${custDel.affectedRows}건, AI브리핑캐시 ${briefDel.affectedRows}건 제거 (트랜잭션 커밋)`
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      /* noop */
    }
    console.error('❌ 정리 실패 (롤백됨):', e.message);
    code = 1;
  } finally {
    conn.release();
    await pool.end();
    process.exit(code);
  }
})();
