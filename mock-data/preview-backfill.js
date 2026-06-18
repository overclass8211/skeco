/* Step 2-1 백필 dry-run 미리보기 (읽기 전용 — DB 미변경)
 * payment_schedules 의 customer_id/contract_id NULL 행을
 *   ① 계약→고객 파생(안전)  ② 고객명→customers 퍼지  ③ 계약명→contracts.title 퍼지
 * 로 자동연결 예상치를 산출해 리포트만 출력.
 * 실행: node mock-data/preview-backfill.js
 */
const pool = require('../src/db');

// customers.js normalizeCompanyName 미러 + lowercase
function norm(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/[(〔（]\s*(주식회사|유한회사|재단법인|사단법인|주|유)\s*[)〕）]/gi, '');
  s = s.replace(/㈜|㈕|㈐|㉾/g, '');
  s = s.replace(/(주식회사|유한회사|재단법인|사단법인)\s*/gi, '');
  s = s.replace(
    /\s*[,.]?\s*(Inc\.?|Co\.?|Ltd\.?|Corp\.?|LLC|GmbH|S\.A\.?|Limited|Corporation|Company)\b\.?/gi,
    ''
  );
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

(async () => {
  const [scheds] = await pool.query(
    `SELECT id, customer_id, contract_id, customer_name, contract_name
       FROM payment_schedules
      WHERE customer_id IS NULL OR contract_id IS NULL
      ORDER BY id`
  );
  const [customers] = await pool.query(`SELECT id, name FROM customers`);
  const [contracts] = await pool.query(`SELECT id, title, customer_id, customer_name FROM contracts`);
  const custN = customers.map(c => ({ id: c.id, name: c.name, n: norm(c.name) }));
  const conN = contracts.map(c => ({ id: c.id, title: c.title, n: norm(c.title), customer_id: c.customer_id, customer_name: c.customer_name }));

  let cust1 = 0, cust2exact = 0, cust2partial = 0, con3 = 0, none = 0;
  const lines = [];
  for (const s of scheds) {
    const parts = [];
    // ① 계약→고객 파생
    let derived = null;
    if (s.contract_id) {
      const c = contracts.find(x => x.id === s.contract_id);
      if (c && c.customer_id) derived = { id: c.customer_id, name: c.customer_name };
    }
    // ② 고객명 퍼지 (파생 없고 customer_id null 일 때)
    let custMatch = null;
    if (!s.customer_id && !derived && s.customer_name) {
      const q = norm(s.customer_name);
      const exact = custN.find(c => c.n && c.n === q);
      const partial = custN.find(c => c.n && (c.n.includes(q) || q.includes(c.n)));
      custMatch = exact ? { ...exact, conf: 'exact' } : partial ? { ...partial, conf: 'partial' } : null;
    }
    // ③ 계약명 퍼지 (contract_id null)
    let conMatch = null;
    if (!s.contract_id && s.contract_name) {
      const q = norm(s.contract_name);
      const exact = conN.find(c => c.n && c.n === q);
      conMatch = exact || null;
    }

    if (!s.customer_id) {
      if (derived) { parts.push(`고객←계약파생 #${derived.id}(${derived.name || '?'})`); cust1++; }
      else if (custMatch && custMatch.conf === 'exact') { parts.push(`고객←정확 #${custMatch.id}(${custMatch.name})`); cust2exact++; }
      else if (custMatch) { parts.push(`고객←부분 #${custMatch.id}(${custMatch.name})`); cust2partial++; }
    }
    if (!s.contract_id && conMatch) { parts.push(`계약←정확 #${conMatch.id}(${conMatch.title})`); con3++; }
    if (!parts.length) none++;

    lines.push(
      `  #${s.id} [고객:${s.customer_name || '-'} / 계약:${s.contract_name || '-'}${s.contract_id ? ' (계약#' + s.contract_id + ')' : ''}] → ${parts.length ? parts.join(' · ') : '✖ 매칭 없음'}`
    );
  }

  console.log(`대상(연결 누락) 스케줄: ${scheds.length}건`);
  console.log(lines.join('\n'));
  console.log('\n── 요약 ──');
  console.log(`고객 연결: 계약파생 ${cust1} · 정확 ${cust2exact} · 부분 ${cust2partial}`);
  console.log(`계약 연결(정확): ${con3}`);
  console.log(`매칭 전무: ${none}`);
  await pool.end();
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
