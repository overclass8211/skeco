'use strict';
// =============================================================
// readReceipts — 모듈별 항목 읽음 상태 추적 (Gmail 패턴)
//
// 책임:
//   1. 사용자가 항목을 모달로 열람한 시점 기록 (markRead)
//   2. 목록 조회 시 사용자별 읽음 상태 일괄 조회 (getReadMap)
//   3. 업데이트 감지 (본인이 본 이후 다른 사람이 수정)
//
// 대상 모듈 (entity_type):
//   - 'lead'      | leads
//   - 'project'   | projects
//   - 'quote'     | quotes
//   - 'proposal'  | proposals
//   - 'contract'  | contracts
//
// DB: read_receipts 테이블 (idempotent 자가 마이그레이션 — initTables 또는 ensureSchema)
// =============================================================

const pool = require('../db');

const ALLOWED_ENTITY_TYPES = ['lead', 'project', 'quote', 'proposal', 'contract'];

/**
 * 자가 마이그레이션 — read_receipts 테이블 생성 (idempotent)
 * 서버 부팅 시 1회 호출.
 */
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS read_receipts (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      entity_type     VARCHAR(20) NOT NULL
                      COMMENT 'lead|project|quote|proposal|contract',
      entity_id       INT NOT NULL,
      first_read_at   DATETIME NOT NULL,
      last_read_at    DATETIME NOT NULL,
      read_count      INT DEFAULT 1,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_entity (user_id, entity_type, entity_id),
      INDEX idx_user_type (user_id, entity_type),
      INDEX idx_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

let _migrationPromise = null;
function _ensureSchemaOnce() {
  if (!_migrationPromise)
    _migrationPromise = ensureSchema().catch(e => {
      console.error('[readReceipts] 마이그레이션 실패:', e.message);
      _migrationPromise = null; // 재시도 가능하게
      throw e;
    });
  return _migrationPromise;
}

/**
 * 읽음 처리 (단일)
 * @param {number} userId
 * @param {string} entityType — ALLOWED_ENTITY_TYPES 중 하나
 * @param {number} entityId
 * @returns {Promise<{first_read_at, last_read_at, read_count}>}
 */
async function markRead(userId, entityType, entityId) {
  if (!userId || !entityType || !entityId) return null;
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
    console.warn(`[readReceipts] 알 수 없는 entity_type: ${entityType}`);
    return null;
  }
  await _ensureSchemaOnce();
  try {
    await pool.query(
      `INSERT INTO read_receipts (user_id, entity_type, entity_id, first_read_at, last_read_at)
       VALUES (?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         last_read_at = NOW(),
         read_count = read_count + 1`,
      [userId, entityType, entityId]
    );
    return { ok: true };
  } catch (e) {
    console.warn('[readReceipts] markRead 실패 (non-critical):', e.message);
    return null;
  }
}

/**
 * 일괄 읽음 처리 (현재 모듈 전체)
 * @param {number} userId
 * @param {string} entityType
 * @param {number[]} entityIds — 일괄 처리할 ID 목록 (없으면 entityType 의 모든 활성 항목)
 */
async function markManyRead(userId, entityType, entityIds = null) {
  if (!userId || !entityType) return { count: 0 };
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) return { count: 0 };
  await _ensureSchemaOnce();
  if (!Array.isArray(entityIds) || entityIds.length === 0) return { count: 0 };
  try {
    // 값 부분: (uid, type, id, NOW, NOW)
    const values = entityIds.map(id => [
      userId,
      entityType,
      parseInt(id, 10),
      new Date(),
      new Date(),
    ]);
    await pool.query(
      `INSERT INTO read_receipts (user_id, entity_type, entity_id, first_read_at, last_read_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         last_read_at = NOW(),
         read_count = read_count + 1`,
      [values]
    );
    return { count: entityIds.length };
  } catch (e) {
    console.warn('[readReceipts] markManyRead 실패:', e.message);
    return { count: 0 };
  }
}

/**
 * 읽음 상태 일괄 조회 — 목록 화면용
 * @param {number} userId
 * @param {string} entityType
 * @param {number[]} entityIds
 * @returns {Promise<Map<number, {first_read_at, last_read_at, read_count}>>}
 */
async function getReadMap(userId, entityType, entityIds) {
  if (!userId || !entityType || !Array.isArray(entityIds) || entityIds.length === 0) {
    return new Map();
  }
  await _ensureSchemaOnce();
  try {
    const [rows] = await pool.query(
      `SELECT entity_id, first_read_at, last_read_at, read_count
         FROM read_receipts
        WHERE user_id = ? AND entity_type = ? AND entity_id IN (?)`,
      [userId, entityType, entityIds]
    );
    const map = new Map();
    for (const r of rows) {
      map.set(r.entity_id, {
        first_read_at: r.first_read_at,
        last_read_at: r.last_read_at,
        read_count: r.read_count,
      });
    }
    return map;
  } catch (e) {
    console.warn('[readReceipts] getReadMap 실패:', e.message);
    return new Map();
  }
}

/**
 * 모듈별 안 읽은 건수 조회 (사이드바 배지용)
 * @param {number} userId
 * @returns {Promise<{lead, project, quote, proposal, contract}>}
 */
async function getUnreadCounts(userId) {
  const result = { lead: 0, project: 0, quote: 0, proposal: 0, contract: 0 };
  if (!userId) return result;
  await _ensureSchemaOnce();
  // 각 모듈별 LEFT JOIN 으로 안 읽은 건수 계산
  // 또는 module-specific helper로 분리 — 여기서는 통합 쿼리
  const TABLE_MAP = {
    lead: 'leads',
    project: 'projects',
    quote: 'quotes',
    proposal: 'proposals',
    contract: 'contracts',
  };
  for (const [type, table] of Object.entries(TABLE_MAP)) {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS cnt
           FROM \`${table}\` t
           LEFT JOIN read_receipts r
             ON r.entity_type = ? AND r.entity_id = t.id AND r.user_id = ?
          WHERE r.id IS NULL`,
        [type, userId]
      );
      result[type] = Number(row.cnt) || 0;
    } catch (e) {
      // 테이블이 없거나 (예: projects) 에러 시 0
      console.warn(`[readReceipts] ${table} unread count 실패:`, e.message);
    }
  }
  return result;
}

/**
 * 항목 객체에 읽음 상태 enrich
 * - is_read
 * - has_update_after_read (updated_at > last_read_at)
 * - last_read_at
 *
 * @param {object} item — DB row (id, updated_at, created_at 필수)
 * @param {Map} readMap — getReadMap 반환값
 * @returns {object} item + _read_status
 */
function enrichReadStatus(item, readMap) {
  const receipt = readMap.get(item.id);
  if (!receipt) {
    // 안 읽음 상태
    item.is_read = false;
    item.has_update_after_read = false;
    item.last_read_at = null;
  } else {
    item.is_read = true;
    item.last_read_at = receipt.last_read_at;
    // 업데이트 감지: item.updated_at > receipt.last_read_at
    const upd = item.updated_at ? new Date(item.updated_at).getTime() : 0;
    const rdt = receipt.last_read_at ? new Date(receipt.last_read_at).getTime() : 0;
    item.has_update_after_read = upd > rdt + 1000; // 1초 여유 (마이그 직후 false positive 방지)
  }
  return item;
}

/**
 * 목록 배열에 일괄 enrich (편의 함수)
 */
async function enrichListWithReadStatus(userId, entityType, items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const ids = items.map(i => i.id).filter(Boolean);
  if (ids.length === 0) return items;
  const map = await getReadMap(userId, entityType, ids);
  for (const item of items) enrichReadStatus(item, map);
  return items;
}

module.exports = {
  ALLOWED_ENTITY_TYPES,
  ensureSchema,
  markRead,
  markManyRead,
  getReadMap,
  getUnreadCounts,
  enrichReadStatus,
  enrichListWithReadStatus,
};
