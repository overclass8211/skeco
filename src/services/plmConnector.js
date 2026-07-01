// =============================================================
// PLM 커넥터 (Phase 0 스캐폴드)
//
// 목적: 고객사 PLM 시스템에서 공정 라이프사이클(소재·게이트 실제 진행)을
//       동기화(pull)하기 위한 커넥터 뼈대. **실제 PLM 스펙은 미정**이므로
//       여기서는 인터페이스 + 안전한 no-op(미구성) 동작만 제공한다.
//
// 확정 후 채울 지점(TODO):
//   1) fetchFromPlm(cfg): provider별 REST/파일/SFTP 호출 + 인증(auth_ref → .env)
//   2) mapToMaterials(raw): PLM 레코드 → { external_ref, material_name, gates[{key,actual_date,status}] }
//   3) upsert: source='plm' 소재 upsert(external_ref 기준) + 게이트 actual_date 반영
//
// 원칙:
//   - PLM = 실제 게이트의 SoR → 동기화 값은 읽기전용(actual_date). 예정일/딜연결은 내부 유지.
//   - 시크릿은 DB에 저장하지 않음(auth_ref 로 .env 참조만).
//   - 미구성/실패해도 앱은 정상 동작(수동 모델 유지).
// =============================================================
'use strict';

const pool = require('../db');

/** 고객 PLM 연동 설정 조회 (없으면 null) */
async function getConfig(customerId) {
  try {
    const [[row]] = await pool.query('SELECT * FROM plm_integrations WHERE customer_id=?', [
      customerId,
    ]);
    return row || null;
  } catch (_) {
    return null;
  }
}

/** 연동 활성 여부 */
async function isEnabled(customerId) {
  const cfg = await getConfig(customerId);
  return !!(cfg && cfg.enabled);
}

/** 동기화 상태 기록 (last_sync_at/last_status/last_error) */
async function _recordStatus(customerId, status, error) {
  try {
    await pool.query(
      `INSERT INTO plm_integrations (customer_id, last_sync_at, last_status, last_error)
       VALUES (?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE last_sync_at=NOW(), last_status=VALUES(last_status), last_error=VALUES(last_error)`,
      [customerId, status, error || null]
    );
  } catch (_) {
    /* 설정 테이블 미존재 등 — 무시 */
  }
}

// ── 실제 구현 슬롯 (스펙 확정 시 채움) — _cfg/_raw 는 시그니처 유지용 ──────
function fetchFromPlm(_cfg) {
  // TODO: provider 별 호출. 예) REST GET, 파일 파싱, SFTP 수신
  throw new Error('PLM_NOT_IMPLEMENTED');
}
function mapToMaterials(_raw) {
  // TODO: PLM 원본 → [{ external_ref, material_name, business_type, gates:[{gate_key, actual_date, status}] }]
  return [];
}

/**
 * 고객 PLM 동기화 진입점.
 * 스펙 미정 단계: 구성돼 있지 않으면 not_configured, 구성돼 있어도 아직 미구현이면 not_implemented.
 * @returns {{ ok:boolean, reason?:string, synced?:number }}
 */
async function syncCustomer(customerId) {
  const cfg = await getConfig(customerId);
  if (!cfg || !cfg.enabled) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const raw = fetchFromPlm(cfg); // 미구현 → throw
    const materials = mapToMaterials(raw);
    // TODO: upsert(customerId, materials) — source='plm', external_ref 기준 병합 + 게이트 actual 반영
    await _recordStatus(customerId, 'ok', null);
    return { ok: true, synced: materials.length };
  } catch (err) {
    const reason = err && err.message === 'PLM_NOT_IMPLEMENTED' ? 'not_implemented' : 'failed';
    await _recordStatus(
      customerId,
      reason === 'not_implemented' ? 'pending' : 'failed',
      String(err && err.message)
    );
    return { ok: false, reason };
  }
}

module.exports = { getConfig, isEnabled, syncCustomer };
