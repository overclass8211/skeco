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

// 테스트 결정성: dev_features 토글을 모두 ON 으로 보장.
//   featureGuard 는 OFF 기능 API 를 403 으로 막으므로, 플래그가 (이전 런 중단 등으로)
//   OFF 로 오염되면 feature-gated 테스트가 순서/상태에 따라 비결정적으로 실패한다.
//   ⚠️ 테스트 전용(globalSetup) — 운영 DB/시드 기본값에는 영향 없음.
export async function setup() {
  const { pool } = require('../server.js');
  try {
    // CRM 핵심 기능은 ON (feature-gated 테스트 결정성 — payments/revenue/tax_invoice 등)
    await pool.query("UPDATE dev_features SET is_enabled = 1 WHERE feature_key LIKE 'crm.%'");
    // 외부 연동(실 API 호출) 기능은 seed 기본값(OFF) 로 — 테스트 중 외부 호출 경로 비활성화
    await pool.query(
      "UPDATE dev_features SET is_enabled = 0 WHERE feature_key IN ('erp.integration','gmail.sync','auth.biometric','ai.token_recharge')"
    );
  } catch (_) {
    /* dev_features 미생성 등은 무시 */
  }
}

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
