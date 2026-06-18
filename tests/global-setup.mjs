/**
 * Vitest 전역 setup/teardown — DB 풀과 HTTP 서버는
 * 단일 fork 안에서 한 번만 정리되어야 함.
 *
 * 각 테스트 파일이 개별로 pool.end() 를 호출하면
 * 다음 파일에서 "Pool is closed" 에러가 발생하므로,
 * 종료 시점을 전역으로 끌어올림.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export async function teardown() {
  const { pool, server } = require('../server.js');
  try {
    await pool.end();
  } catch (_) {}
  try {
    server.close();
  } catch (_) {}
  // wsClients Set 안의 소켓이 남아있으면 프로세스가 종료되지 않음
  try {
    server.getConnections((err, count) => {
      if (count > 0) server.unref();
    });
  } catch (_) {}
}
