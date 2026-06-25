'use strict';
// =============================================================
// PLM 게이트 데모 시드 — 기존 customer_materials 에 게이트 진척(목표일/상태) 생성
//   lifecycle_stage 기준으로 이전 게이트=완료 / 현재=진행 / 이후=예정
//   멱등: material_gates 전체 재구성. 실행: node scripts/seed-plm-gates.js
// =============================================================
require('dotenv').config();
const pool = require('../src/db');

const STAGE_ORDER = ['discovery', 'sample', 'evaluation', 'specin', 'massprod', 'delivery'];
// 현재월 기준 n개월 가감한 'YYYY-MM-15'
const NOW = new Date();
function monthFromNow(n) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() + n, 15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [gates] = await conn.query(
      `SELECT gate_key, lifecycle_stage FROM plm_gates WHERE is_active=1 ORDER BY display_order ASC`
    );
    const [mats] = await conn.query(
      `SELECT id, lifecycle_stage FROM customer_materials WHERE status<>'closed'`
    );
    if (!gates.length || !mats.length) {
      console.log('게이트 정의 또는 소재 없음 — 스킵');
      await conn.rollback();
      return;
    }
    const del = await conn.query('DELETE FROM material_gates');
    console.log('기존 material_gates 정리:', del[0].affectedRows);

    let inserted = 0;
    for (const mat of mats) {
      const matIdx = Math.max(0, STAGE_ORDER.indexOf(mat.lifecycle_stage));
      // 현재 게이트 = 게이트 순서상 매핑 stage 가 소재 stage 이상인 첫 게이트 (단조 보장)
      let curIdx = gates.findIndex(g => Math.max(0, STAGE_ORDER.indexOf(g.lifecycle_stage)) >= matIdx);
      if (curIdx === -1) curIdx = gates.length; // 전부 완료
      // 소재별 진척 약간 분산 (id 기반 ±1개월), 현재 게이트 ≈ 현재월
      const jitter = (mat.id % 3) - 1;
      const rows = [];
      gates.forEach((g, i) => {
        const target = monthFromNow((i - curIdx) * 2 + jitter); // 완료=과거, 현재≈지금, 예정=미래
        let status, actual = null;
        if (i < curIdx) { status = 'done'; actual = target; }
        else if (i === curIdx) status = 'in_progress';
        else status = 'pending';
        rows.push([mat.id, g.gate_key, target, actual, status]);
      });
      await conn.query(
        `INSERT INTO material_gates (customer_material_id, gate_key, target_date, actual_date, status)
         VALUES ${rows.map(() => '(?,?,?,?,?)').join(',')}`,
        rows.flat()
      );
      inserted += rows.length;
    }
    await conn.commit();
    console.log(`✅ 게이트 시드 완료: 소재 ${mats.length} × 게이트 ${gates.length} = ${inserted}행`);
  } catch (e) {
    await conn.rollback();
    console.error('ERR', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
