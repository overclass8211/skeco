'use strict';
// =============================================================
// scripts/migrate.js — 스키마 마이그레이션 단독 실행기
//
//   npm run db:migrate
//
// 서버 부팅과 분리해 initTables() 만 1회 실행한다.
// initTables 는 전부 idempotent(CREATE TABLE IF NOT EXISTS, 가드된 ALTER,
// INSERT IGNORE, UPDATE ... WHERE ... IS NULL) — DROP/TRUNCATE/DELETE 없음.
// 대상 DB 는 .env 의 DB_NAME (DB명 하드코딩 없음).
//
// → 스키마 변경 시 "재부팅 + 재시드" 없이 본 스크립트만 돌리면 된다.
// =============================================================
require('dotenv').config({ override: true });
const pool = require('../src/db');
const config = require('../config');
const { initTables } = require('../src/initTables');

(async () => {
  let code = 0;
  console.log(`▶ DB 마이그레이션 시작 — target=${config.db.database} (idempotent · DROP 없음)`);
  try {
    await initTables();
    console.log('✅ 마이그레이션 완료 (기존 데이터 보존)');
  } catch (e) {
    console.error('❌ 마이그레이션 실패:', e.message);
    code = 1;
  }
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(code);
})();
