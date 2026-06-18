# SK ecoplant materials CRM — 커스터마이징 개발 가이드

> OCI CRM 소스를 **별도 포크**하여 SK에코플랜트 머티리얼즈 고객사용 B2B CRM으로
> 커스터마이징하기 위한 개발 가이드입니다. (1차 목표: **데모/PoC**)

---

## 0. 전략 한눈에

| 항목 | 결정 | 근거 |
|---|---|---|
| 코드베이스 | OCI 소스 → **별도 포크** (이 폴더) | OCI와 완전 분리 운영, 리스크 격리 |
| DB | 신규 DB **`sk_mat_crm`** | OCI 데이터 오염 방지 |
| 1차 목표 | **데모/PoC** (목업 데이터 + 데모 시나리오) | 영업 제안용 빠른 산출 |
| 빌드 순서 | 리브랜딩 → 도메인 재구성 → 3대 기능 | 보이는 것부터, 위험한 것은 뒤로 |

### 기술 스택 (상속)
- Backend: Node.js 20 + Express + MariaDB 11 (mysql2/promise)
- Frontend: Vanilla JS SPA (프레임워크 미사용)
- Auth: JWT(15m) + Refresh(7d) + bcrypt + TOTP + WebAuthn
- AI: Google Gemini 2.5 (→ **AWS Bedrock 전환 검토 중**, §3-3)
- PWA: Service Worker + IndexedDB

---

## 1. 고객 요청사항 (확정 범위)

| # | 요청 | 비고 |
|---|---|---|
| R1 | **매출 포캐스트** — 마케팅 생산예측 → 수주 → 매출로 이어지는 파이프라인 | 예: 삼성전자 납품건 (유키퀘스트 사례와 동일) — §3-1 |
| R2 | **360뷰** — 고객 단일 화면 통합 | §3-2 |
| R3 | **AI-Agent** — AWS Bedrock 기반, 향후 CRM 연계 고려 | §3-3 |
| R4 | 브랜딩 (로고/색상/명칭) | **완료** — §2 |
| R5 | 도메인 용어/메뉴 재구성 | §4 |
| R6 | 데이터 모델/필드 추가 | §4, §3-1 (스키마 변경은 사전 승인) |
| R7 | 신규 기능 개발 | §3 |

---

## 2. ✅ Phase 0 + Phase 1 (완료 내역)

### Phase 0 — git 격리 & 환경 분리
- **OCI 원격 제거**: `origin`(github), `gcp`(운영 배포), `gitlab` 3개 모두 제거.
  → 이 폴더에서 실수로 push해도 **OCI 운영이 오염되지 않음**.
  → 되돌리려면: `git remote add origin <SK용 새 원격>` (OCI 원격은 재추가 금지 권장)
- **`.env` 격리**: `DB_NAME=sk_mat_crm`, JWT/Refresh/Encryption 시크릿 **신규 생성** (OCI와 분리).
- **`.gitignore`**: `*.Zip`, `C:*` 등 OCI 작업 잔재 제외 추가.
- **신규 DB 생성**: `sk_mat_crm` (utf8mb4) + `schema.sql` 적용 (23개 코어 테이블 + 시드).
  나머지 메뉴/스테이지 테이블은 서버 부팅 시 `src/initTables.js`가 자동 생성.
- **`schema.sql` 수정**: 내부 하드코딩을 `oci_crm` → `sk_mat_crm`으로 교체.
- **`.claude/launch.json`**: `sk-crm` / port **3002** (OCI 로컬 3001 충돌 회피).

> ⚠️ **주의 기록**: `schema.sql`은 상단에 `DROP DATABASE ...; CREATE DATABASE ...; USE ...;`를
> 하드코딩한다. 최초 적용 시 이 줄이 `oci_crm`을 가리켜 **로컬 oci_crm DB가 1회 드롭/재시드**되었다.
> 현재는 `sk_mat_crm`으로 교체 완료. 앞으로 `schema.sql` 재실행은 항상 sk_mat_crm만 영향.

### Phase 1 — 리브랜딩 (로고/색상/명칭)
- **로고**: `public/assets/sk-ecoplant-logo.svg` 제작 + `default-logo.svg`를 SK 워드마크로 교체.
  (동적 로고 시스템 `__LOGO_URL__` + admin 업로드 그대로 활용)
- **색상**: `public/css/styles.css` `:root` — 변수명(`--oci-red` 등)은 **유지**하고 값만 SK 팔레트로 교체(최소 변경).
- **명칭**: `index.html` / `manifest.json` / `login.html` 타이틀·메타·테마컬러·라벨 교체.
- **검증**: 프리뷰 서버에서 로고/색상/타이틀 반영 + 콘솔 에러 0 확인.

#### SK 브랜드 팔레트
| 토큰 | 값 | 용도 |
|---|---|---|
| `--oci-red` / `--primary` / `--brand` | `#EA002C` | SK Red (주색) |
| `--oci-red-dark` | `#C00020` | hover/강조 |
| `--oci-red-light` | `#FDE7EB` | 배경 틴트 |
| `--sk-orange` / `--brand-accent` | `#F58220` | SK 오렌지 (리본/보조 강조) |
| login `--accent` | `#EA002C` | 로그인 페이지 |

> 🎨 **UX/UI 메모**: SK Red 단색만 쓰면 단조로워, 리본 마크의 오렌지를 **보조 강조색**으로 도입
> ("CRM **AI**" 라벨에 적용). 빨강=주요 CTA/상태, 오렌지=AI/하이라이트로 역할 분리.
> SK Red(#EA002C)는 흰 배경 대비 명도 충분(대형 텍스트/UI AA 충족).

> 🖼 **공식 자산 교체**: 현재 로고는 첨부 이미지 기반 **SVG 재현본**. 공식 벡터/PNG 확보 시
> 관리자 콘솔 → 로고 업로드로 교체하면 픽셀 단위로 정확. (코드 변경 불필요)

#### 잔여 항목 (PoC 단계 후순위)
- 코드 주석/내부 문자열의 `OCI` (사용자 비노출) — 대량이라 PoC에선 생략.
- `schema.sql` 시드 콘솔 메시지("OCI CRM Database 초기화 완료") — 비노출 로그.
- `public/assets/oci_logo*.png`, `pwa-icon*.svg` — 미사용/아이콘. 필요 시 교체.

---

## 3. 핵심 요청 기능 (로드맵)

### 3-1. 매출 포캐스트 파이프라인 (R1) ⭐ 최우선
> 마케팅이 **생산예측** 입력 → **수주** 전환 → **매출 포캐스트** 집계
> (예: 삼성전자 납품건 — 고객사×품목×월 매트릭스 → 월별 매출 곡선)

```
[생산예측 forecast]  →  [수주 order]  →  [매출 인식 revenue]
  고객사/품목/월별        확정 수량·단가     월별 매출 롤업
  예측 수량·확률          납기             forecast vs actual 비교
```
- **신규 테이블(승인 필요)**: `sales_forecasts(customer_id, product_id, period 'YYYY-MM', qty, unit_price, probability, status, ...)`
- 기존 `src/routes/revenue.js` + `public/js/pages/revenue.js` 확장 → **forecast vs actual** 대비 뷰
- 신규 `public/js/pages/forecast.js` + 매출관리 탭에 포캐스트 추가
- ⚠️ DB 스키마 변경 → **착수 전 테이블 설계서 별도 승인** (CLAUDE.md 규칙)

### 3-2. 360뷰 (R2)
> 한 고객의 모든 접점(리드·활동·견적·제안·계약·수금·지원·회의록)을 단일 화면 통합.
- 데이터 이미 존재 → **신규 스키마 거의 불필요** (가성비 최고)
- 신규 백엔드: `GET /api/customers/:id/360` — 관련 엔티티 조인/집계
- 프론트: `customers.js` 상세에 360 탭 — 기존 `linked*.js` 컴포넌트 재사용
  (`linkedContracts/Payments/Proposals/Quotes/Support`)

### 3-3. AWS Bedrock AI-Agent (R3)
> 현재 AI는 `src/services/gemini.js` 단일 모듈 → **provider 추상화**로 교체.
```
src/services/ai/
  index.js          ← provider 선택 (env: AI_PROVIDER=gemini|bedrock)
  geminiProvider.js ← 기존 gemini.js 이전
  bedrockProvider.js← 신규 (@aws-sdk/client-bedrock-runtime, Claude on Bedrock)
```
- 공통 인터페이스(`runStream`, `analyze*` 등) 유지 → 라우트 `src/routes/ai.js` **무변경**
- SSE 스트리밍 패턴 동일 유지(`sseStart/Send/End`)
- 권장 모델: **Bedrock의 Claude** (tool-use 강함 → 향후 CRM 데이터 연계 확장 용이)
- PoC: Gemini 유지 → 추상화 레이어 먼저 구축, Bedrock은 AWS 자격증명 확보 후 스위치

---

## 4. 도메인 재구성 (R5, R6)

### 메뉴/용어 (DB 기반 — 코드 무변경)
- `menu_sections` / `menu_items`의 `label_override`로 admin 화면에서 메뉴명 변경.
- 기본값 변경은 `src/data/menuDefaults.js`.
- 단계/상태: `pipeline-stages`, `project-stages`, `project-statuses` 라우트로 CRUD → SK 영업단계 시드.

### 데이터 모델/필드 추가 (증분 마이그레이션)
- **`schema.sql` 직접 수정 금지** → `migrations/`에 증분 파일 추가.
- 소재사업 후보 필드: `products`에 grade(등급)/spec(규격)/unit(ton·kg)/원료구분 등.
- ⚠️ 모든 스키마 변경은 **사전 설계서 + 승인** 후 진행.

---

## 5. PoC 데이터 & 데모 시나리오

- `mock-data/`의 생성 스크립트 패턴(`gen-*.js`, `seed-*.js`)을 본떠 일관된 목업 시드 작성.
- 가상 고객사(삼성전자 포함) + 소재 품목 + 생산예측→수주→매출 흐름.
- **데모 시나리오**:
  "삼성전자 납품건 — 생산예측 입력 → 수주 전환 → 매출 포캐스트 곡선 →
   360뷰에서 전체 접점 확인 → AI-Agent에게 '이 고객 올해 매출 전망 요약' 질의"

---

## 6. 권장 진행 순서 & 일정 (PoC 기준)

| 순서 | 작업 | 상태 | 예상 |
|---|---|---|---|
| 1 | Phase 0 포크/격리 | ✅ 완료 | — |
| 2 | Phase 1 리브랜딩 | ✅ 완료 | — |
| 3 | Phase 2 메뉴/용어 (§4) | ⬜ | 1일 |
| 4 | 360뷰 (§3-2, 재사용 多) | ⬜ | 1.5일 |
| 5 | 매출 포캐스트 (§3-1, 스키마 설계 승인 후) | ⬜ | 3~4일 |
| 6 | AI provider 추상화 (§3-3, Bedrock 스위치 후속) | ⬜ | 1.5일 |
| 7 | 목업 시드 + 데모 리허설 (§5) | ⬜ | 1일 |

---

## 7. 운영 워크플로우 (CLAUDE.md 준수)
- 모든 변경: Lint → 영향 테스트 → 보고 → **commit 승인 질문** → 승인 후 commit(+push 세트).
- DB 스키마 변경: **사전 제안 + 승인** 필수.
- UI 동작 버그 fix: Playwright E2E 회귀 테스트 필수.
- SK 포크는 OCI 원격과 분리됨 → push 대상(SK 전용 원격)은 별도 구성 필요.
