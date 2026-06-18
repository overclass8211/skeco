'use strict';
// =============================================================
// 계약 확정(completed) 시 자동 프로비저닝 — 프로젝트 + 매출계획(청구차수)
//
//   - 트리거: contracts.status → 'completed'(체결) 전이 시 PATCH /:id/status 에서 호출
//   - 멱등: 이미 생성됐으면 skip (contract_id 기준 존재검사 + auto_provisioned_at 가드)
//   - 트랜잭션: 호출자의 conn 을 받아 같은 트랜잭션에서 실행 (실패 시 호출자가 롤백)
//   - 매출계획 분할(P1 기본): 단일 100% 1차수 (사용자가 매출관리에서 차수 분할/조정)
//     · scheduled_amount = 계약금(VAT 포함), supply = round/1.1, tax = 나머지
//       (기존 POST /from-contract 규칙과 동일)
//     · revenue_status='예정' — 추후 세금계산서 발행 시 '확정' 전환(P2)
// =============================================================

// PRJ-YYYY-NNNN 채번 (projects.generateProjectCode 패턴 — 트랜잭션 conn 사용)
async function _genProjectCode(conn) {
  const yyyy = new Date().getFullYear();
  const prefix = `PRJ-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT project_code FROM projects WHERE project_code LIKE ? ORDER BY project_code DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.project_code) {
    const m = row.project_code.match(/PRJ-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

function _ymd(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _addDays(dateLike, days) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return _ymd(d);
}

/**
 * 계약 체결 시 프로젝트 + 매출계획 자동 생성. 호출자의 트랜잭션(conn) 내에서 실행.
 * @param {import('mysql2/promise').PoolConnection} conn 진행 중인 트랜잭션 커넥션
 * @param {number} contractId
 * @returns {Promise<{projectId:number|null, projectCreated:boolean, scheduleIds:number[], scheduleCreated:boolean, skipped?:string}>}
 */
async function provisionOnComplete(conn, contractId) {
  const [[c]] = await conn.query(`SELECT * FROM contracts WHERE id = ?`, [contractId]);
  if (!c)
    return {
      projectId: null,
      projectCreated: false,
      scheduleIds: [],
      scheduleCreated: false,
      skipped: 'no_contract',
    };
  if (c.auto_provisioned_at)
    return {
      projectId: null,
      projectCreated: false,
      scheduleIds: [],
      scheduleCreated: false,
      skipped: 'already_provisioned',
    };

  const out = { projectId: null, projectCreated: false, scheduleIds: [], scheduleCreated: false };

  // ── 1) 프로젝트 (contract_id 연결 없으면 생성) ──
  const [[pj]] = await conn.query(`SELECT id FROM projects WHERE contract_id = ? LIMIT 1`, [
    contractId,
  ]);
  if (pj) {
    out.projectId = pj.id;
  } else {
    const code = await _genProjectCode(conn);
    const [r] = await conn.query(
      `INSERT INTO projects
         (name, customer_id, customer_name, contract_id, contract_amount, currency,
          start_date, end_date, status, project_code, created_at)
       VALUES (?,?,?,?,?,?,?,?, '진행중', ?, NOW())`,
      [
        c.title || c.contract_no || '신규 프로젝트',
        c.customer_id || null,
        c.customer_name || null,
        contractId,
        c.contract_amount || null,
        c.currency || 'KRW',
        _ymd(c.start_date),
        _ymd(c.end_date),
        code,
      ]
    );
    out.projectId = r.insertId;
    out.projectCreated = true;
  }

  // ── 2) 매출계획(payment_schedules) (계약 단위 없으면 생성) ──
  const [[sch]] = await conn.query(
    `SELECT id FROM payment_schedules WHERE contract_id = ? LIMIT 1`,
    [contractId]
  );
  if (!sch) {
    const total = Number(c.contract_amount) || 0;
    const supply = Math.round(total / 1.1);
    const tax = total - supply;
    const due = _ymd(c.end_date) || _addDays(c.start_date, 30) || _addDays(null, 30);
    const [r] = await conn.query(
      `INSERT INTO payment_schedules
         (contract_id, customer_id, customer_name, contract_name,
          stage_name, stage_order, ratio,
          scheduled_amount, supply_amount, tax_amount,
          due_date, status, revenue_status, currency,
          contract_supply_amount, contract_start_date, contract_end_date, created_at)
       VALUES (?,?,?,?, '일시불', 1, 100, ?,?,?, ?, 'scheduled', '예정', ?, ?, ?, ?, NOW())`,
      [
        contractId,
        c.customer_id || null,
        c.customer_name || null,
        c.title || c.contract_no,
        total,
        supply,
        tax,
        due,
        c.currency || 'KRW',
        supply,
        _ymd(c.start_date),
        _ymd(c.end_date),
      ]
    );
    out.scheduleIds.push(r.insertId);
    out.scheduleCreated = true;
  }

  // ── 3) 멱등 가드 기록 (재확정·재호출 시 중복 생성 방지) ──
  await conn.query(`UPDATE contracts SET auto_provisioned_at = NOW() WHERE id = ?`, [contractId]);
  return out;
}

module.exports = { provisionOnComplete };
