// =============================================================
// E2E DB Seed Helper — 검색 테스트용 시드 데이터 삽입/정리
//
// 모든 시드 데이터는 unique prefix '__E2E_SRCH__' 를 가져서
// 다른 데이터와 충돌하지 않고, afterAll 에서 정확히 정리됨.
// =============================================================
'use strict';

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
  override: true,
});

const mysql = require('mysql2/promise');

const SEED_PREFIX = '__E2E_SRCH__';
const KEYWORD = SEED_PREFIX + 'KEY'; // 검색 시 사용할 키워드

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'oci_crm',
    connectionLimit: 4,
    multipleStatements: false,
  });
}

async function cleanupSeed(pool) {
  // FK CASCADE 에 의존하지 말고 명시적으로 자식 → 부모 순으로 삭제
  await pool.query(`DELETE FROM activities      WHERE title LIKE ?`, [`${SEED_PREFIX}%`]);
  await pool.query(`DELETE FROM leads           WHERE project_name LIKE ?`, [`${SEED_PREFIX}%`]);
  await pool.query(`DELETE FROM projects        WHERE name LIKE ?`, [`${SEED_PREFIX}%`]);
  await pool.query(`DELETE FROM meeting_minutes WHERE title LIKE ?`, [`${SEED_PREFIX}%`]);
  await pool.query(`DELETE FROM customers       WHERE name LIKE ?`, [`${SEED_PREFIX}%`]);
}

/**
 * 5개 엔티티에 동일한 키워드를 가진 시드 데이터 1개씩 삽입.
 * @returns {Promise<{ customer, lead, project, meeting, activity, keyword }>}
 */
async function insertSearchSeed(pool) {
  // 기존 잔재 정리
  await cleanupSeed(pool);

  const [c] = await pool.query(
    `INSERT INTO customers (name, region, industry, contact_person)
       VALUES (?, '국내', 'IT', ?)`,
    [`${KEYWORD}고객사`, `${KEYWORD}담당자`]
  );
  const customerId = c.insertId;

  const [l] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, stage)
       VALUES (?, ?, ?, '태양광', '국내', 'lead')`,
    [customerId, `${KEYWORD}고객사`, `${KEYWORD}리드프로젝트`]
  );
  const leadId = l.insertId;

  const [p] = await pool.query(
    `INSERT INTO projects (name, customer_id, customer_name, project_type, status)
       VALUES (?, ?, ?, '시공', '진행중')`,
    [`${KEYWORD}시공프로젝트`, customerId, `${KEYWORD}고객사`]
  );
  const projectId = p.insertId;

  const [m] = await pool.query(
    `INSERT INTO meeting_minutes (title, meeting_date, summary_md, key_points)
       VALUES (?, CURDATE(), ?, ?)`,
    [`${KEYWORD}회의록제목`, '요약 본문', `${KEYWORD}핵심내용`]
  );
  const meetingId = m.insertId;

  const [a] = await pool.query(
    `INSERT INTO activities (lead_id, activity_type, title, content)
       VALUES (?, '미팅', ?, ?)`,
    [leadId, `${KEYWORD}활동제목`, '활동 내용 텍스트']
  );
  const activityId = a.insertId;

  return {
    keyword: KEYWORD,
    customerId,
    leadId,
    projectId,
    meetingId,
    activityId,
  };
}

module.exports = {
  SEED_PREFIX,
  KEYWORD,
  createPool,
  cleanupSeed,
  insertSearchSeed,
};
