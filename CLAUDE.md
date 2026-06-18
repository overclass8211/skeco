# 🤖 CLAUDE.md — Claude 작업 지침서

> Claude Code 가 세션 시작 시 자동으로 로드하는 프로젝트별 작업 지침입니다.
> 이 파일의 모든 규칙은 **모든 세션에서 무조건 준수**해야 합니다.

---

## 🚦 기본 워크플로우 (필수 준수)

모든 코드 변경 작업은 다음 순서를 **예외 없이** 따른다:

```
1. 코드 수정 완료
2. Lint 검사  (npx eslint <변경 파일>)
3. 영향받는 테스트 실행 (변경 영향도별 — 아래 표 참조)
   3-1. Lint        — 모든 변경 필수
   3-2. Vitest      — 백엔드/단위 (정책 표 참조)
   3-3. Playwright E2E — UI 동작 변경 / 사용자 보고 버그 fix / 회귀 방지 (정책 표 참조)
4. 변경 사항 + Lint 결과 + Vitest 결과 + E2E 결과 요약 보고
5. "Commit 진행할까요?" 명시적 질문
6. 사용자 승인 대기 ("응" / "yes" / "진행해" / "commit 해" 등)
7. **Commit + Push 실행 (한 세트로 항상 함께)** ⚠️
   - `git commit ...` 직후 `git push origin <branch>` 까지 일괄 처리
   - push 누락 시 GCP 운영 환경 동기화 실패 → 실수 방지
8. 결과 보고 (commit hash + push 결과 + 운영 적용 명령)
```

### 🚫 절대 금지 사항

- ❌ **자체 판단으로 commit 진행 금지** — 매 commit 마다 사용자 승인 필수
- ❌ **테스트 실패 시 무시하고 commit 금지** — 원인 보고 + 사용자 결정 대기
- ❌ **E2E 테스트 작성 회피 금지** — 사용자 보고 UI 버그 fix 시 회귀 방지 e2e 필수
- ❌ **Lint warning 무시하고 commit 금지** — 모두 해결 후 진행
- ❌ **이전 승인이 있어도 추가 commit 자동 진행 금지** — 매번 새 승인
- ❌ **"긴급이니까 일단" 우회 금지** — 긴급 상황이라도 알리고 승인 받기
- ❌ **DB 스키마 변경 사전 제안 없이 진행 금지** — 사전 설명 + 승인 필수
- ❌ **환경변수/시크릿 하드코딩 금지** — 문서에도 placeholder 사용
- ❌ **husky/lint-staged 우회 금지** — `--no-verify` 같은 플래그 사용 금지
- ❌ **Commit 후 push 누락 금지** — commit 승인은 push 까지 포함. 별도 push 승인 불필요. 단 force-push (`--force`, `--force-with-lease`) 와 main/master 외 브랜치로의 push 는 별도 승인 필수
- ❌ **다른 브랜치로 임의 전환 금지** — 작업 브랜치(`master`)에서 벗어나려면 사용자 명시 요청 필수

---

## 🧪 변경 영향도별 테스트 정책

| 변경 종류 | Lint | Vitest (`tests/*.test.mjs`) | Playwright E2E (`e2e/*.spec.js`) |
|----------|:----:|:--------------------------:|:--------------------------------:|
| **Hotfix** (단일 라인, 명확한 버그) | ✅ | 관련 파일만 | ❌ |
| **백엔드 라우트/서비스 추가** | ✅ | ✅ 관련 + auth/RBAC | 선택 |
| **프론트엔드 페이지 추가** | ✅ | ❌ (없으면 skip) | ✅ **권장** (UI 동작 변경 시) |
| **DB 스키마 변경** | ✅ | ✅ **전체** | 선택 |
| **인증/권한 변경** | ✅ | ✅ **전체** | ✅ **필수** |
| **AI/STT/외부 API 통합** | ✅ | ✅ 관련 + mocking 확인 | 선택 |
| **🐛 사용자 보고 UI 버그 fix** | ✅ | 관련 | ✅ **필수** (회귀 방지) |
| **문서/주석만 변경** | ✅ | ❌ | ❌ |
| **운영 배포 직전 점검** | ✅ | ✅ **전체** | ✅ **필수** |

### 테스트 명령어

```bash
# Lint (필수, 모든 변경)
npx eslint <변경한 파일들>

# 관련 vitest 만
npm test -- tests/<관련>.test.mjs

# 전체 vitest
npm test

# Coverage
npm run test:coverage

# ── E2E (UI 버그 fix / 회귀 방지 시 필수) ───────────────────────
# 방식 1: 기존 로컬 서버 활용 (디버깅 좋음, 빠른 반복)
#   1) 별도 터미널: npm start (포트는 .env PORT 따름, 보통 3001)
#   2) e2e 실행:
E2E_BASE_URL=http://localhost:3001 npx playwright test e2e/<시나리오>.spec.js

# 방식 2: Playwright 자동 시작 (clean run)
npx playwright test e2e/<시나리오>.spec.js

# 단일 테스트 + 자세한 로그
npx playwright test e2e/<시나리오>.spec.js --reporter=list

# 실패 시 trace 보기 (test-results/.../trace.zip 자동 저장됨)
npx playwright show-trace test-results/<name>/trace.zip
```

---

## 📝 보고 형식 (표준)

코드 변경 후 사용자에게 다음 형식으로 보고:

```markdown
## 📝 변경 사항
- 파일1: 변경 이유
- 파일2: 변경 이유

## ✅ Lint
2개 파일 — 0 errors, 0 warnings

## ✅ Vitest
- tests/foo.test.mjs: 12 passed
- (또는) Skip — 영향 없음

## ✅ E2E
- e2e/foo.spec.js: 3 passed
- (또는) Skip — 백엔드/문서만 변경 (UI 무관)
- (또는) Skip — 영향 없음

## 🚦 Commit 진행할까요?
```

---

## 🎭 Playwright E2E 테스트 원칙

### 🧭 작성 트리거 (다음 경우 e2e 필수 작성)

1. **사용자가 동일/유사 버그 2회 이상 보고** — 회귀 방지 (최우선 트리거)
2. **사용자 보고 UI 동작 버그 fix** — 동일 시나리오 자동화로 재발 방지
3. **클릭/입력/드래그/포커스** 같은 UI 인터랙션 핵심 동작
4. **JS 로직만으로 검증 어려운 동작** (CSS `display`, 렌더링 타이밍, focus 트리거 등)
5. **인증/권한(RBAC) 변경** — 게이트 동작 확인 필수

### 📁 파일 구조

- 경로: `e2e/*.spec.js` (테스트 시나리오)
- 헬퍼:
  - `e2e/helpers/auth.js` — `loginAsAdmin(page)` 자동 로그인
  - `e2e/helpers/seed.js` — 테스트 데이터 시드 (필요시)
- 설정: `playwright.config.js` (baseURL, workers=1, retries=1, 직렬 실행)

### 🚀 실행 두 가지 방식

**방식 1 — 기존 서버 활용** (디버깅 좋음, 반복 빠름)
```bash
# 터미널 1: 서버 미리 띄움 (.env PORT 사용, 보통 3001)
npm start

# 터미널 2: e2e 실행 (baseURL 명시)
E2E_BASE_URL=http://localhost:3001 npx playwright test e2e/<시나리오>.spec.js
```

**방식 2 — Playwright 자동 시작** (clean run, CI 환경)
```bash
# playwright.config.js 의 webServer 가 자동으로 npm start + health check
npx playwright test e2e/<시나리오>.spec.js
```

### ✅ 통과 기준 / 실패 디버깅

- 통과: `N passed (Xs)` 형식 — flaky(재시도 후 통과)도 검토 권장 (잠재 시그널)
- 실패 시 자동 저장: `test-results/<name>/` 폴더에
  - `test-failed-1.png` (스크린샷)
  - `video.webm` (실행 영상)
  - `trace.zip` (시간순 실행 추적)
- trace 보기: `npx playwright show-trace test-results/<name>/trace.zip`

### 🐛 E2E 가 찾아낸 실제 케이스 (예시)

`e2e/report-builder-filter.spec.js` — 필터 드롭다운 fix 시:
- 사용자가 3회 보고 후 작성
- 정확한 원인 (Combobox onFocus 의 `items.length > 0` 함정) 즉시 식별
- 회귀 방지: 동일 버그 재발 시 즉시 감지

→ **사용자 신뢰 회복 + 작업 효율 동시에 확보**

---

## 🛠 프로젝트 핵심 정보

### 기술 스택
- **Backend**: Node.js 20 + Express + MariaDB 11 (mysql2/promise)
- **Frontend**: Vanilla JS SPA (프레임워크 미사용)
- **Auth**: JWT(15m) + Refresh Token(7d) + bcrypt + TOTP + WebAuthn
- **AI**: Google Gemini 2.5 Flash/Pro
- **External**: Google OAuth (Calendar/Meet/Gmail), Kakao Map
- **PWA**: Service Worker + IndexedDB (오프라인 큐)
- **Test**: vitest + supertest (백엔드), Playwright (E2E)

### 권한 (RBAC) 5단계
1. `manager` (매니저) - 기본 CRUD
2. `team_lead` (팀장) - 팀 분석, 리포트, 리포트 빌더
3. `executive` (경영진) - 관리자 콘솔 조회
4. `admin` (IT운영관리자) - 사용자/라벨/토큰 관리
5. `superadmin` (시스템담당자) - 개발자 옵션, 기능 플래그

### 운영 환경
- **URL**: https://oci-crm.duckdns.org (Nginx → Node :3000)
- **배포**: `cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env`
- **PM2**: oci-ai (fork mode)
- **DB**: localhost:3306, `sudo mysql oci_crm` 로 접속

### Service Worker 캐시
- 서버 부팅 시각으로 CACHE_VERSION 자동 주입 (`server.js`)
- PM2 restart 마다 자동 새 버전 → 사용자 브라우저 캐시 자동 무효화

---

## 🔒 사용자 핵심 원칙 (재명시)

이전 세션에서 사용자가 명시한 원칙 — **변경 시 반드시 준수**:

1. **기존 기능 보존**: 대규모로 갈아엎지 말고 **최소 변경**으로 안정화
2. **추측 금지**: 현재 구조 확인 후 변경 (Read/Grep 으로 사전 확인)
3. **API 응답 형식 유지**: `{success, data, error}` 표준 유지
4. **인증/JWT 로직 임의 수정 금지**: 변경 필요 시 사전 보고
5. **DB 스키마 변경**: 꼭 필요한 경우만 **사전 제안 + 승인** 후 진행
6. **시크릿 하드코딩 금지**: `.env` 사용, 문서엔 placeholder
7. **UI 전체 개편 금지**: OCI Red(#E63329) + 사이드바 220px 디자인 유지
8. **commit 전 사용자 승인**: 위 워크플로우의 단계 5~6 필수

---

## 🌍 언어 정책

- **사용자 응답**: 한국어 우선 (사용자가 영어로 물으면 영어로)
- **commit message**: 한국어 OK (기존 패턴 유지)
- **코드 주석**: 한국어 (기존 패턴 따름)
- **문서**: 사용자 대상 = 한국어, 개발자 대상 = 한/영 혼용 가능

---

## 📚 관련 문서

- 📘 [src/docs/USER_MANUAL.md](./src/src/docs/USER_MANUAL.md) - 사용자 매뉴얼
- 🏛 [src/docs/PROGRAM_DESIGN.md](./src/src/docs/PROGRAM_DESIGN.md) - 프로그램 설계서
- 🔌 [src/docs/API_DOCUMENTATION.md](./src/src/docs/API_DOCUMENTATION.md) - API 명세
- 🛠 [src/docs/ADMIN_SETUP_GUIDE.md](./src/src/docs/ADMIN_SETUP_GUIDE.md) - 관리자 셋업
- 🔧 [src/docs/TROUBLESHOOTING_GUIDE.md](./src/src/docs/TROUBLESHOOTING_GUIDE.md) - 트러블슈팅
- 🔄 [src/docs/DEV_WORKFLOW.md](./src/src/docs/DEV_WORKFLOW.md) - 개발 워크플로우 (이 파일 사람용 버전)

---

## 🔄 이 파일 수정 시

- 새 규칙 추가 시: 사용자 승인 후 수정
- 기존 규칙 변경 시: 사용자에게 사유 설명 + 승인 후 수정
- 절대 자의적으로 규칙 완화/삭제 금지

---

> 본 파일은 Claude 가 세션 시작 시 자동 로드합니다.
> 사용자가 명시적으로 변경 요청하지 않는 한 위 규칙은 **불변**입니다.
