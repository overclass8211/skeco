/**
 * Vitest 설정 — 통합 테스트는 단일 스레드 직렬 실행 (DB 충돌 방지).
 *
 * - `npm test`              : 한 번 실행
 * - `npm run test:watch`    : 파일 변경 감지 모드
 * - `npm run test:coverage` : 커버리지 리포트 생성
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.mjs', 'tests/unit/**/*.test.mjs'],
    globalSetup: ['./tests/global-setup.mjs'],
    testTimeout: 30000,
    hookTimeout: 15000,
    pool: 'forks',
    // singleFork: 단일 프로세스 직렬 (DB 충돌 방지). 워커 힙 상향(OOM 크래시 방지).
    poolOptions: { forks: { singleFork: true, execArgv: ['--max-old-space-size=2048'] } },
    // 단일 fork 내에서 파일 간 모듈을 공유 (mysql2 풀 1개 공유 → 파일별 풀 난립으로
    // 인한 잔여 커넥션 에러 / 워커 크래시 방지 + 속도↑). teardown 의 "공유 풀" 전제와 일치.
    isolate: false,
    environment: 'node',
    reporters: ['default'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/initTables.js'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 50,
        functions: 50,
      },
    },
  }
});
