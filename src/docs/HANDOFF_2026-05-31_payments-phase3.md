# 📋 작업 이력 & 내일 GitLab 커밋 계획 — 수금관리 Phase 3 (2026-05-31)

> 작성: 2026-05-31 작업 종료 시점 핸드오프.
> 목적: 오늘 완료한 미커밋 작업 보존 + **내일 GitLab 커밋/푸시 절차** 준비.
> ⚠️ 이 문서 자체는 핸드오프 기록이므로, 내일 기능 커밋에 포함할지(또는 별도/제외) 자유롭게 선택.

---

## 1. 형상 상태 (중요)

| 위치 | 커밋 | 비고 |
|------|------|------|
| 로컬 HEAD | `99761a4` + **미커밋 5개 기능** | 작업 트리에만 존재 (백업 없음) |
| **GitLab** `gitlab/master` | `053139c` | 2커밋 뒤 — `99761a4`(세금계산서)도 미반영 |
| GitHub `origin/master` | `99761a4` | **폐쇄 예정 → 더 이상 푸시 안 함** |

➡️ 내일 **`git push gitlab master` 한 번**이면 GitLab이 `053139c → 99761a4 → 신규 커밋`까지 **fast-forward로 일괄** 반영됨. (99761a4 따로 챙길 필요 없음)

- 향후 형상관리는 **GitLab 전용**. GitHub는 폐쇄 예정.

---

## 2. 오늘 완료한 작업 (미커밋, 전부 검증 완료)

모두 **DB 스키마 변경 없음 · API 형식 `{success,data,error}` 유지 · 기존 기능 보존**.

| # | 기능 | 내용 | 검증 |
|---|------|------|------|
| ① | **수금현황 계약별 그룹핑** | 부모(계약)/자식(단계) 2단 트리 + `[📂 계약별]↔[☰ 전체]` 토글(localStorage) + 펼침/접힘 + 모두 펼치기·접기. 그룹 정렬=다음 수금예정일. `contract_id` null이면 `고객사\|계약명` 폴백("계약 미연결"). 클라이언트 렌더 전용 | Lint·E2E 3 ✅ |
| ② | **매출분석 Chart.js + 손익 시뮬레이터** | 월별 예정vs실적(막대)·상태별 수금예정액(도넛)·연체 미수금 TOP5(가로막대) + 손익 시뮬레이터(매출−원가율−판관비율 → 매출총이익·영업이익·마진율, 시나리오 비교 보수/기본/낙관, 원가율·판관비율 localStorage 기억). 무저장·무스키마 | Lint·E2E 3 ✅ |
| ③ | **세금계산서 홈택스 가져오기** | `[⬆ 홈택스 가져오기]` 모달: 파일(.csv/.xlsx) 또는 붙여넣기 → 컬럼 자동추정+수동 매핑 → 미리보기 → `tax_invoices` issued 일괄 등록(승인번호 중복 스킵). 기존 tax_invoices 재사용(무스키마) | Lint·Vitest·E2E 1 ✅ |
| ④ | **수금 스케줄 계약 연결** | 등록/수정 모달 상단 '🔗 기존 계약 연결' Combobox(`API.contracts.list` 검색) → 선택 시 `contract_id` 연결 + 고객사/계약명 자동채움 + 연결해제. → 그룹 "계약 미연결" 라벨 해소 | Lint·Vitest·E2E 1 ✅ |

**누적 검증 결과**
- ESLint: **0 errors / 0 warnings**
- Vitest: `tests/payments.test.mjs` **22 passed** · `tests/auth.test.mjs` **8 passed**
- E2E(Playwright): payments 전체 **10 passed** (grouping 2건은 cold-start flaky → retries:2로 재시도 통과 = 알려진 CDN 부트스트랩 패턴, 로직 결함 아님)

---

## 3. 변경/신규 파일 (정확히 7개)

```
M  public/js/pages/payments.js        (+820 등 — 프론트 4기능)
M  src/routes/payments.js             (+143 — /import/parse·/tax-invoices/bulk·PUT 화이트리스트 contract_id·customer_id, 무스키마)
M  tests/payments.test.mjs            (+99 — 홈택스 4종·계약연결 영속 등)
?? e2e/payments-grouping.spec.js
?? e2e/payments-analysis-chart.spec.js
?? e2e/payments-hometax-import.spec.js
?? e2e/payments-contract-link.spec.js
```

> 참고: `tax-invoices` PUT/DELETE + 세금계산서 발행요청 UI는 **이미 `99761a4`에 커밋**되어 있음(오늘 미커밋분 아님).

---

## 4. 내일 실행 절차 (순서대로)

```powershell
cd C:\oci-crm-ai
git status                       # 위 7개 확인, HEAD=99761a4 확인

# (1) GitLab 접속 확인 (사내망)
git fetch gitlab                 # 성공해야 진행. 실패하면 아직 접속 불가 상태

# (2) 최종 검증 (커밋 전)
npx eslint public/js/pages/payments.js src/routes/payments.js tests/payments.test.mjs e2e/payments-grouping.spec.js e2e/payments-analysis-chart.spec.js e2e/payments-hometax-import.spec.js e2e/payments-contract-link.spec.js
npm test -- tests/payments.test.mjs tests/auth.test.mjs
#  E2E (서버 띄운 상태):
#  $env:E2E_BASE_URL="http://localhost:3001"; npx playwright test e2e/payments-grouping.spec.js e2e/payments-analysis-chart.spec.js e2e/payments-hometax-import.spec.js e2e/payments-contract-link.spec.js e2e/payments-tax-invoice.spec.js

# (3) 스테이징 (정확히 7개 — 이 핸드오프 문서 포함 여부는 선택)
git add public/js/pages/payments.js src/routes/payments.js tests/payments.test.mjs e2e/payments-grouping.spec.js e2e/payments-analysis-chart.spec.js e2e/payments-hometax-import.spec.js e2e/payments-contract-link.spec.js

# (4) 커밋 (pre-commit 훅 lint-staged 자동 실행 — --no-verify 금지)
git commit -m "..."              # §5 메시지 사용

# (5) GitLab 푸시 (053139c → 99761a4 → 신규커밋 일괄 fast-forward)
git push gitlab master
```

---

## 5. 준비된 커밋 메시지 (단일 커밋 권장)

```
feat(payments): 수금관리 Phase 3 일괄 — 그룹핑·매출차트·손익·홈택스 import·계약 연결

[프론트 public/js/pages/payments.js]
- 수금현황 계약별 그룹뷰(부모 계약/자식 단계) + 평면 토글 + 펼침/접힘 (클라이언트 그룹핑)
- 매출분석 Chart.js 3종(월별 예정vs실적·상태별 도넛·연체 TOP5) + 손익 시뮬레이터(시나리오 비교·localStorage)
- 세금계산서 [홈택스 가져오기] 모달(.csv/.xlsx·붙여넣기 → 컬럼 자동매핑 → 일괄 등록)
- 수금 스케줄 모달 '기존 계약 연결' Combobox → contract_id 연결("계약 미연결" 해소)

[백엔드 src/routes/payments.js — 무스키마]
- POST /import/parse(exceljs csv/xlsx 위치기반) + POST /tax-invoices/bulk(sanitize·중복스킵·트랜잭션 issued)
- PUT 화이트리스트 contract_id/customer_id 추가 (batch는 기존 반영)

[테스트] vitest payments 22 · e2e 4종 신규(grouping·analysis-chart·hometax-import·contract-link)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

> **분리 커밋(5개)을 원하면**: 5기능이 `payments.js` 한 파일에 인터리브돼 있어 `git add -p`(헝크 단위 스테이징) 필요 → 내일 헝크별로 나눠 5커밋 처리 가능. ("분리 커밋해"라고 요청)

---

## 6. 주의사항
- ⚠️ **GitHub 푸시 안 함** (폐쇄 예정) → `git push gitlab master`만. 추후 `git remote remove origin` 으로 origin 제거는 **별도 결정** 후.
- ⚠️ **CLAUDE.md 푸시 정책**이 현재 "GitHub+GitLab 둘 다"로 적혀 있음 → **GitLab 전용으로 갱신 필요(승인 후)**. 내일 커밋 전 같이 정리 권장.
- ⚠️ **분기 주의**: 그 사이 타인이 GitLab `master`에 푸시했다면 push 거부 가능 → `git fetch gitlab` 후 `git log gitlab/master..master` 확인, 필요 시 머지 후 푸시. **force-push 금지**.
- 운영 배포(원하면): GitLab 반영 후 `cd ~/oci-ai && git pull <gitlab-remote> master && pm2 restart oci-ai --update-env`

---

## 7. 후속(미완료) 항목
- **바로빌 2단계**(세금계산서 자동발행 + 발행상태 폴링): 바로빌 상용 API 키 필요 → 키 확보 후 진행 (Phase 2 잔여).
- **CLAUDE.md 푸시 정책** GitLab 전용 갱신 (승인 필요).
- (선택) GitHub `origin` 리모트 제거.
