const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit || 10,
  charset: 'utf8mb4',
});

// ── 방어: 커넥션 transient 에러 처리 ──────────────────────────
// mysql2 커넥션이 소켓 오류(PROTOCOL_CONNECTION_LOST/ECONNRESET 등) 발생 시
// 'error' 이벤트를 emit 하는데, 리스너가 없으면 Node 가 프로세스를 즉시 종료한다.
// (운영: 서버 다운 / 테스트: 워커 크래시) → 핸들러로 흡수, 풀이 새 커넥션 재생성.
try {
  pool.pool.on('connection', conn => {
    conn.on('error', err => {
      console.warn('[db] connection error (handled):', err && (err.code || err.message));
    });
  });
} catch (_) {
  /* 코어 풀 핸들 접근 실패 시 무시 */
}

module.exports = pool;
