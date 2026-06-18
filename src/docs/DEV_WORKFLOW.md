# 🔄 OCI CRM AI — 개발 워크플로우

> **대상**: 개발팀, 외주/협력 개발자, AI 어시스턴트(Claude)
> **목적**: 코드 변경 → 테스트 → Commit → 배포까지 표준 절차 정의

---

## 📋 표준 워크플로우 (필수 준수)

모든 코드 변경은 **예외 없이** 다음 순서를 따릅니다:

```
1. 코드 수정
   ↓
2. Lint 검사 (필수)
   ↓
3. 관련 테스트 실행 (변경 영향도별)
   ↓
4. 변경 사항 + 결과 보고
   ↓
5. 코드 리뷰 또는 자체 검토
   ↓
6. 사용자/팀 승인 확인
   ↓
7. Commit + Push
   ↓
8. 운영 적용 (필요 시)
```

---

## 🧪 변경 영향도별 테스트 정책

| 변경 종류 | Lint | Vitest | Playwright | 비고 |
|----------|:----:|:------:|:----------:|------|
| **Hotfix** (단일 라인 버그 수정) | ✅ | 관련 파일 | ❌ | 핫픽스 우선 |
| **백엔드 라우트/서비스 추가** | ✅ | ✅ 관련 + auth | 선택 | API 테스트 권장 |
| **프론트엔드 페이지 추가** | ✅ | ❌ | 선택 | E2E 권장 |
| **DB 스키마 변경** | ✅ | ✅ **전체** | 선택 | 마이그레이션 검증 |
| **인증/권한 변경** | ✅ | ✅ **전체** | ✅ 권장 | 보안 영향도 큼 |
| **AI/STT/외부 API** | ✅ | ✅ 관련 | 선택 | mock 확인 |
| **문서/주석만 변경** | ✅ | ❌ | ❌ | 빠른 진행 가능 |
| **운영 배포 직전 점검** | ✅ | ✅ **전체** | ✅ | 모든 검증 필수 |

---

## 🛠 명령어 참조

### Lint
```bash
# 전체 lint
npm run lint

# 자동 수정 가능한 것만
npm run lint:fix

# 변경한 파일만 (가장 빠름)
npx eslint <파일1> <파일2>
```

### Vitest (백엔드 테스트)
```bash
# 전체 실행
npm test

# 특정 파일만
npm test -- tests/auth.test.mjs

# Watch 모드 (개발 중)
npm run test:watch

# Coverage
npm run test:coverage
```

### Playwright (E2E 테스트)
```bash
# 전체 실행
npx playwright test

# 특정 시나리오
npx playwright test e2e/email-templates.spec.js

# Headed 모드 (브라우저 보이게)
npx playwright test --headed

# UI 모드 (인터랙티브)
npx playwright test --ui
```

---

## 📝 변경 보고 표준 양식

코드 변경 후 다음 양식으로 작성:

```markdown
## 📝 변경 사항
- `src/routes/foo.js`: 영업 리드 자동 매칭 로직 추가
- `public/js/pages/bar.js`: 매칭 결과 UI 표시

## ✅ Lint
2개 파일 — 0 errors, 0 warnings

## ✅ Test
- tests/foo.test.mjs: 12 passed, 0 failed
- tests/auth.test.mjs: 8 passed (RBAC 영향 검증)
- E2E: skip (이번 변경은 백엔드만)

## 🚦 Commit 진행 의견
승인 요청 → "응" / "진행해" 답변 시 즉시 commit + push
```

---

## 🚫 금지 사항

### Commit 관련
- ❌ 테스트 실패 무시하고 commit
- ❌ Lint warning 무시하고 commit
- ❌ `--no-verify` 등 hook 우회
- ❌ `--amend` 로 이전 commit 변경 (특별 사유 없는 한)
- ❌ Force push to master (`-f` 또는 `--force`)

### 코드 관련
- ❌ 시크릿/API 키 하드코딩 → `.env` 사용
- ❌ DB 스키마 변경 사전 제안 없이 진행
- ❌ 기존 API 응답 형식 (`{success, data}`) 변경
- ❌ JWT/Refresh Token 로직 임의 수정
- ❌ Helmet CSP 헤더 약화

### 우회 관련
- ❌ "긴급이니까 일단" 식 우회
- ❌ husky/lint-staged 비활성화
- ❌ ESLint config 임의 약화

---

## 🚀 배포 절차 (운영 서버)

### 표준 배포

```bash
# 1) SSH 접속
ssh user@oci-crm.duckdns.org

# 2) 최신 코드 pull + 재시작
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env

# 3) 헬스체크
curl -i http://localhost:3000/api/health

# 4) (필요 시) 로그 확인
pm2 logs oci-ai --lines 50 --nostream
```

### 무중단 배포 (PM2 reload)

```bash
cd ~/oci-ai && git pull origin master && pm2 reload oci-ai
```

### 롤백

```bash
cd ~/oci-ai
git log --oneline -10               # 이전 commit hash 확인
git reset --hard <previous-hash>
pm2 reload oci-ai
```

---

## 🔍 코드 리뷰 체크리스트

PR 또는 자체 리뷰 시 확인:

### 보안
- [ ] 시크릿/API 키 하드코딩 없는가?
- [ ] SQL Injection 방어 (parameterized query)?
- [ ] XSS 방어 (HTML escape)?
- [ ] CSRF 방어 (SameSite 쿠키)?
- [ ] RBAC 권한 체크 누락 없는가?

### 성능
- [ ] N+1 쿼리 없는가?
- [ ] 필요한 인덱스가 있는가?
- [ ] 무한 루프 / 메모리 누수 가능성?

### 호환성
- [ ] 기존 API 응답 형식 유지?
- [ ] 기존 DB 컬럼명 유지 (또는 마이그레이션 포함)?
- [ ] 다국어 라벨 영향도 (4개 언어)?

### 테스트
- [ ] 신규 기능에 테스트 추가?
- [ ] 기존 테스트 모두 pass?
- [ ] E2E 시나리오 영향 확인?

### 문서
- [ ] CHANGELOG 또는 README 업데이트?
- [ ] API 변경 시 API_DOCUMENTATION.md 갱신?
- [ ] DB 스키마 변경 시 db-erd.md 갱신?

---

## 📚 관련 문서

- 📘 [USER_MANUAL.md](./USER_MANUAL.md) - 사용자 매뉴얼
- 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) - 프로그램 설계서
- 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - API 명세
- 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) - 관리자 셋업
- 🔧 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) - 트러블슈팅

---

## 🔄 이 문서 수정 시

- 새 규칙 추가: PR + 팀 리뷰 후 머지
- 기존 규칙 변경: 사유 명시 + 합의 후 변경
- 변경 이력은 git log 로 추적

---

> 본 문서는 모든 개발자가 따라야 하는 표준입니다.
> 예외 상황 발생 시 팀 합의 후에만 우회 가능.
