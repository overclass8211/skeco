/* 수금관리 샘플 데이터 DB 시드 — payment_schedules (+ payment_records) 직접 주입
 *
 * 수금 일정은 UI 임포트 경로가 없으므로, 수금관리 모듈을 실제 화면에서 테스트하려면
 * 이 스크립트로 개발 DB 에 직접 주입한다. gen-payment-mock.js 의 동일 34건을 사용.
 *
 * ⚠️ 개발 DB 전용 — 운영 DB 에 실행 금지.
 * ⚠️ .env 의 DB 접속 정보를 사용 (config 경유).
 *
 * 실행(주입):  node mock-data/seed-payments.js
 * 실행(정리):  node mock-data/seed-payments.js --clean
 *
 * 식별: 모든 행 note 끝에 '[샘플데이터]' 태그 → --clean 으로 일괄 삭제 가능.
 */
'use strict';
require('dotenv').config();
const pool = require('../src/db');
const { ROWS } = require('./gen-payment-mock');

const TAG = '[샘플데이터]';

async function clean() {
  const [recDel] = await pool.query('DELETE FROM payment_records WHERE note LIKE ?', [`%${TAG}%`]);
  const [schDel] = await pool.query('DELETE FROM payment_schedules WHERE note LIKE ?', [`%${TAG}%`]);
  console.log(`🧹 정리 완료 — 입금기록 ${recDel.affectedRows}건 · 수금일정 ${schDel.affectedRows}건 삭제`);
}

async function seed() {
  let sched = 0;
  let rec = 0;
  for (const r of ROWS) {
    const note = `${r.note} ${TAG}`.trim();
    const [ins] = await pool.query(
      `INSERT INTO payment_schedules
         (contract_id, customer_id, customer_name, contract_name,
          stage_name, stage_order, ratio,
          supply_amount, tax_amount, scheduled_amount, currency,
          due_date, invoice_date, status, note)
       VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.customer_name,
        r.contract_name || null,
        r.stage_name,
        r.stage_order,
        r.ratio,
        r.supply_amount,
        r.tax_amount,
        r.scheduled_amount,
        r.currency,
        r.due_date,
        r.invoice_date || null,
        r.status,
        note,
      ]
    );
    sched++;
    // 부분/완료 수금 행은 입금기록도 함께 생성 (paid_amount = payment_records 합)
    if (Number(r.paid_amount) > 0) {
      const paidDate = r.invoice_date || r.due_date;
      await pool.query(
        `INSERT INTO payment_records
           (schedule_id, paid_amount, paid_date, payment_method, note)
         VALUES (?, ?, ?, 'bank_transfer', ?)`,
        [ins.insertId, r.paid_amount, paidDate, `자동입금 ${TAG}`]
      );
      rec++;
    }
  }
  const counts = ROWS.reduce((m, r) => {
    m[r.status] = (m[r.status] || 0) + 1;
    return m;
  }, {});
  console.log(`✅ 시드 완료 — 수금일정 ${sched}건 · 입금기록 ${rec}건 입력`);
  console.log('   상태분포:', JSON.stringify(counts));
  console.log('   ※ 연체 알림 테스트: 미수금 탭 → [↻ 지금 스캔]');
  console.log(`   ※ 정리: node mock-data/seed-payments.js --clean`);
}

(async () => {
  try {
    if (process.argv.includes('--clean')) await clean();
    else await seed();
  } catch (e) {
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
