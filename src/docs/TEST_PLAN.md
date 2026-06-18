# 🧪 테스트 계획서 (Test Plan)

> **버전**: v5.0 | **대상**: QA, 개발자

---

## 1. 테스트 전략

### 1.1 테스트 피라미드

```
        ▲  Playwright E2E (11개 시나리오)
       ╱ ╲
      ╱   ╲ Vitest Integration (백엔드 28 파일 / 284 테스트)
     ╱─────╲
    ╱ Unit  ╲ (단위 테스트 — services, utils)
   ╱─────────╲
```

### 1.2 도구
- **Backend**: vitest + supertest
- **E2E**: Playwright
- **Lint**: ESLint + Prettier
- **Husky**: pre-commit hook (lint-staged)

---

## 2. 테스트 범위

### 2.1 백엔드 (vitest)

| 영역 | 파일 | 테스트 수 |
|------|------|----------|
| Auth | tests/auth.test.mjs | 8 |
| Leads | tests/leads.test.mjs | 5 |
| Customers | tests/customers.test.mjs | 6 |
| Projects | tests/projects.test.mjs | 5 |
| Activities | tests/activities.test.mjs | 9 |
| Calendar | tests/calendar.test.mjs | 4 |
| Dashboard | tests/dashboard.test.mjs | 4 |
| Products | tests/products.test.mjs | 6 |
| Team | tests/team.test.mjs | 5 |
| Meetings | tests/meetings.test.mjs | 8 |
| AI | tests/ai.test.mjs | 6 |
| Gmail | tests/gmail.test.mjs | 10 |
| Notifications | tests/notifications.test.mjs | 1 |
| Admin | tests/admin.test.mjs | 4 |
| Admin Labels | tests/admin-labels.test.mjs | 16 |
| Email Templates | tests/email-templates.test.mjs | 15 |
| Search | tests/search.test.mjs | 13 |
| Healthmap | tests/healthmap.test.mjs | 18 |
| Webhooks | tests/webhooks.test.mjs | 20 |
| Export | tests/export.test.mjs | 36 |
| PWA | tests/pwa.test.mjs | 5 |
| Board | tests/board.test.mjs | 10 |
| Edge Cases | tests/edge-cases.test.mjs | 11 |
| **Unit: authService** | tests/unit/authService.test.mjs | 19 |
| **Unit: rbac** | tests/unit/rbac.test.mjs | 9 |
| **Unit: validate** | tests/unit/validate.test.mjs | 12 |
| **Unit: routeHelper** | tests/unit/routeHelper.test.mjs | 9 |
| **Unit: appError** | tests/unit/appError.test.mjs | 10 |
| **합계** | **28 files** | **284** |

### 2.2 E2E (Playwright)

| 시나리오 | 파일 |
|---------|------|
| 이메일 템플릿 | e2e/email-templates.spec.js |
| 신규 사용자 온보딩 | e2e/empty-onboarding.spec.js |
| Excel 내보내기 | e2e/export.spec.js |
| 글로벌 검색 | e2e/global-search.spec.js |
| Healthmap | e2e/healthmap.spec.js |
| 모바일 UX | e2e/mobile-ux.spec.js |
| 모바일 기본 | e2e/mobile.spec.js |
| 오프라인 큐 | e2e/offline-queue.spec.js |
| 키보드 단축키 | e2e/shortcuts.spec.js |
| Webhook | e2e/webhooks.spec.js |
| 워드 사전 | e2e/word-repo.spec.js |

---

## 3. 변경 영향도별 테스트 정책

(상세는 [DEV_WORKFLOW.md](./DEV_WORKFLOW.md) 참조)

| 변경 종류 | Lint | Vitest | E2E |
|----------|:----:|:------:|:---:|
| Hotfix (단일 라인) | ✅ | 관련만 | ❌ |
| 백엔드 라우트 추가 | ✅ | 관련+auth | 선택 |
| 프론트엔드 페이지 추가 | ✅ | ❌ | 선택 |
| DB 스키마 변경 | ✅ | **전체** | 선택 |
| 인증/권한 변경 | ✅ | **전체** | ✅ |
| 문서/주석 | ✅ | ❌ | ❌ |
| 운영 배포 전 | ✅ | **전체** | ✅ |

---

## 4. 테스트 시나리오 (주요)

### 4.1 인증
- ✅ 로그인 성공/실패
- ✅ JWT 만료 + Refresh Token 갱신
- ✅ 로그아웃 → 토큰 블랙리스트
- ✅ OTP 활성/검증
- ✅ 잘못된 패스워드 5회 → Rate Limit

### 4.2 영업 도메인
- ✅ 리드 CRUD + 단계 변경 (드래그&드롭)
- ✅ 대량 등록 (Copy & Paste)
- ✅ Excel/CSV 내보내기
- ✅ 활동 자동 기록 (단계 변경 시)
- ✅ 권한별 데이터 스코프 (manager는 본인 담당만)

### 4.3 AI
- ✅ Gemini 챗봇 SSE 스트리밍
- ✅ 토큰 한도 초과 시 거부
- ✅ STT 동기 (~20분) / 비동기 (~120분)
- ✅ 회의록 AI 요약

### 4.4 Gmail (G1/G2/G3)
- ✅ OAuth 연결/해제/재연결
- ✅ 메시지 매칭 (고객 이메일 → 활동)
- ✅ 메일 발송 (RFC 2822 + 한국어 제목)
- ✅ 5분 cron 동기화
- ✅ invalid_grant 자동 비활성화 + 친절 안내

### 4.5 기능 토글
- ✅ 토글 ON/OFF + 즉시 반영 (CSS + featureGuard)
- ✅ 의존성 위반 차단 (force 옵션)
- ✅ 위험도 critical 토글 confirm
- ✅ Configuration Preset 일괄 적용
- ✅ Audit log 자동 기록

### 4.6 로고 관리
- ✅ PNG/JPG/SVG 업로드 + Magic Bytes 검증
- ✅ Sharp trim() + resize 자동 최적화
- ✅ SVG XSS sanitize (script + on* 제거)
- ✅ Image Bomb 차단 (5000×5000 한도)
- ✅ Server-Side Inject (Flash 제거)

### 4.7 PWA / 오프라인
- ✅ Service Worker 등록
- ✅ 오프라인 폴백 페이지
- ✅ IndexedDB 큐 + 온라인 복귀 자동 동기화
- ✅ CACHE_VERSION 자동 갱신

---

## 5. 회귀 테스트 (Regression)

매 배포 전:
```bash
npm run lint                     # 0 errors
npm test                         # 28 files, 284 tests passed
npx playwright test              # 11 시나리오 (선택)
curl http://localhost:3000/api/health  # status: ok
```

---

## 6. 성능 테스트 (목표)

| 지표 | 목표 | 현재 |
|------|------|------|
| API p95 | < 500ms | ✅ (대부분 < 200ms) |
| 페이지 로드 | < 2s | ✅ |
| STT 1분 분량 | < 30s | ✅ |
| AI 챗봇 첫 토큰 | < 2s | ✅ |
| 동시 사용자 | 100 | 미검증 |

---

## 7. 보안 테스트

| 위협 | 검증 |
|------|------|
| SQL Injection | Parameterized query 강제 |
| XSS | esc() + Helmet CSP |
| CSRF | SameSite=Lax 쿠키 |
| Image Bomb | sharp limitInputPixels |
| SVG XSS | svgo removeScriptElement |
| Polyglot | Magic Bytes |
| Brute Force | Rate Limit (300/15min) |
| Token Theft | Refresh Rotation |

---

## 8. 테스트 환경

| 환경 | 용도 |
|------|------|
| 개발 (`NODE_ENV=development`) | 로컬 개발 |
| 테스트 (`NODE_ENV=test`) | vitest + supertest |
| 운영 (`NODE_ENV=production`) | 실제 사용 |

---

## 9. 알려진 한계

- **In-memory sttJobs**: PM2 cluster 시 공유 안 됨 (single instance 또는 향후 Redis)
- **WebSocket**: 단일 인스턴스 기준 (sticky session 또는 Redis pub/sub 필요 시)
- **Combinatorial Explosion**: 33개 토글 = 80억 조합 → Preset 으로 검증된 3개만 보장

---

## 📎 테스트 실행 명령

```bash
# 전체
npm test                              # vitest 28 files

# 단일 파일
npm test -- tests/auth.test.mjs

# 감시 모드 (개발 중)
npm run test:watch

# 커버리지
npm run test:coverage

# E2E 전체
npx playwright test

# E2E 단일
npx playwright test e2e/email-templates.spec.js

# E2E UI 모드
npx playwright test --ui
```
