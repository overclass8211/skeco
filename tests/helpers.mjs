/**
 * 테스트 헬퍼 — 서버 앱과 DB 풀에 접근하는 단일 진입점.
 *
 * server.js 는 CommonJS 라 `createRequire` 로 안전하게 로드.
 */
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, pool, server } = require('../server.js');

export const api = () => request(app);
export { pool };

/** 모든 테스트 종료 시 호출 — DB/WebSocket 연결 정리 */
export async function teardown() {
  try {
    await pool.end();
  } catch (_) {}
  try {
    server.close();
  } catch (_) {}
}
