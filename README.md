# ♻️ SK ecoplant materials CRM

> **SK에코플랜트 머티리얼즈** 영업 조직을 위한 통합 CRM + AI 어시스턴트 풀스택 웹 애플리케이션
> Node.js + Express + MariaDB + Vanilla JS SPA + PWA
>
> 본 프로젝트는 **OCI CRM 소스를 포크**하여 SK에코플랜트 머티리얼즈 고객사에 맞게
> 커스터마이징한 별도 인스턴스입니다. (1차 목표: 데모/PoC)
> 커스터마이징 방향·진행 현황은 **[📗 docs/SK_CUSTOMIZATION_GUIDE.md](./docs/SK_CUSTOMIZATION_GUIDE.md)** 참고.

![Status](https://img.shields.io/badge/status-PoC-orange)
![Node](https://img.shields.io/badge/node-20.x%2B-339933)
![DB](https://img.shields.io/badge/MariaDB-11.x-003545)
![Brand](https://img.shields.io/badge/SK%20Red-%23EA002C-EA002C)
![License](https://img.shields.io/badge/license-Internal-lightgrey)

---

## 📖 빠른 시작

```bash
# 1) 클론
git clone https://github.com/overclass8211/skeco.git
cd skeco

# 2) 환경 변수 설정
cp .env.example .env
#  → DB_NAME=sk_mat_crm, JWT_SECRET, GEMINI_API_KEY 등 설정

# 3) DB 초기화 (schema.sql 이 sk_mat_crm 을 생성/초기화)
mysql -u root -p < schema.sql

# 4) 의존성 설치 + 실행
npm ci
npm run dev

# 5) 브라우저
#  http://localhost:3002   (.env 의 PORT — OCI 로컬 3001 과 충돌 회피)
```

> ⚠️ `schema.sql` 은 상단에서 `DROP DATABASE IF EXISTS sk_mat_crm; CREATE DATABASE ...` 를
> 수행합니다. **재실행 시 sk_mat_crm 데이터가 초기화**되므로 운영 데이터 주의.

상세 설정은 [🛠 docs/ADMIN_SETUP_GUIDE.md](./src/docs/ADMIN_SETUP_GUIDE.md) 참고.

---

## ✨ 주요 기능

### 🎯 영업 관리
- **대시보드** — 핵심 KPI, 월별 추이, 파이프라인 펀넬, 실시간 알림
- **칸반 파이프라인** — 드래그&드롭, 변경 이력 자동 기록
- **리드 / 고객 / 프로젝트** — CRUD + 대량 등록(Copy & Paste) + Excel 내보내기
- **활동 이력** — 미팅/통화/이메일 자동 추적

### 🤖 AI 기능
- **AI 챗봇** — 스트리밍 SSE, CRM 컨텍스트 자동 주입 (현재 Gemini 2.5)
- **고객사 AI 브리핑** — 자동 영업 인사이트 생성
- **회의록 STT** — 음성 → 텍스트 (장시간, 화자분리, AI 요약)

### 📧 Google 통합
- Google Calendar 양방향 동기화 / Google Meet 링크 생성 / Gmail 읽기·발송·동기화

### 📱 모바일 / PWA
- PWA 설치 · 오프라인 녹음(IndexedDB 큐) · iOS/Android 최적화

### 🔐 보안 / 권한
- **5단계 RBAC** (매니저 → Superadmin)
- 비밀번호 + 2FA(TOTP) + WebAuthn / JWT(15m) + Refresh Rotation(7d) / AES-256 암호화

---

## 🚧 SK 커스터마이징 로드맵

> 상세: [docs/SK_CUSTOMIZATION_GUIDE.md](./docs/SK_CUSTOMIZATION_GUIDE.md)

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | git 격리 + 환경 분리(`sk_mat_crm`) | ✅ 완료 |
| Phase 1 | 리브랜딩 (SK 로고/컬러/명칭) | ✅ 완료 |
| Phase 2 | 도메인 용어/메뉴 재구성 | ⬜ 예정 |
| R2 | **고객 360뷰** (단일 화면 통합) | ⬜ 예정 |
| R1 | **매출 포캐스트** (생산예측→수주→매출) | ⬜ 예정 (스키마 설계 승인 필요) |
| R3 | **AWS Bedrock AI-Agent** (provider 추상화) | ⬜ 예정 |

---

## 🏗 아키텍처

```
[Browser] Vanilla JS SPA · Service Worker(PWA) · IndexedDB · WebSocket
   │ HTTPS / WSS
[Nginx] SSL · CORS · Rate Limit
   │
[Node.js + Express :3002]
   ├── routes / endpoints
   ├── Middleware: Helmet · CORS · JWT · RBAC · Rate Limit
   └── Services: Auth · Gemini(AI) · STT · Gmail · WebSocket
   │
[MariaDB 11]  sk_mat_crm · InnoDB · utf8mb4
   │
[External] Google Gemini · Google Calendar/Meet/Gmail · Kakao Map(선택)
```

상세 아키텍처는 [🏛 docs/PROGRAM_DESIGN.md](./src/docs/PROGRAM_DESIGN.md) 참고.

---

## 🔧 기술 스택

- **Backend**: Node.js 20.x+ · Express 4 · MariaDB 11(mysql2/promise) · JWT · bcrypt · otplib(TOTP) · WebAuthn · googleapis · Helmet · ws
- **AI**: Google Generative AI SDK (Gemini 2.5) — *향후 AWS Bedrock 전환 검토*
- **Frontend**: Vanilla JS(ES2020+) · Chart.js 4 · FullCalendar 6 · Service Worker · IndexedDB · Kakao Map
- **Infra**: PM2 / Docker Compose · Nginx Reverse Proxy · Let's Encrypt

---

## 📦 디렉토리 구조 (요약)

```
skeco/
├── README.md                  # 이 문서
├── package.json
├── .env.example
├── schema.sql                 # MariaDB 스키마 (sk_mat_crm)
├── server.js                  # Express 엔트리
├── config/index.js            # 환경변수 통합
├── src/
│   ├── routes/                # API 라우트
│   ├── services/              # 비즈니스 로직 (Auth, AI(gemini), Gmail, ...)
│   ├── middleware/            # Auth, RBAC, ErrorHandler, ...
│   ├── data/ · utils/         # 메뉴/라벨 기본값, 헬퍼
│   ├── db.js · ws.js · initTables.js
│   └── docs/                  # 개발 산출물 문서
├── public/                    # 정적 자원 (index.html, css, js/pages, assets, manifest)
├── docs/                      # SK 커스터마이징 가이드
├── mock-data/                 # PoC 시드/목업 스크립트
├── tests/  (vitest)  ·  e2e/  (Playwright)
└── migrations/                # 증분 스키마 변경
```

---

## 🚀 NPM Scripts

| Script | 용도 |
|--------|------|
| `npm start` | 프로덕션 실행 |
| `npm run dev` | 개발 모드 (nodemon 자동 재시작) |
| `npm test` | 테스트 (vitest) |
| `npm run test:coverage` | 커버리지 |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier |

---

## 🎨 디자인 가이드

- **메인 컬러**: SK Red `#EA002C` / **보조 강조**: SK Orange `#F58220`
- **레이아웃**: 사이드바(220px) + 메인 영역
- **폰트**: Noto Sans KR(본문) + IBM Plex Mono(숫자/금액)
- **반응형**: 1100px 이하 축소, 768px 이하 모바일 UI
- **PWA 테마**: `#EA002C`, standalone

---

## 🤝 개발 워크플로우

- 작업 브랜치: **`main`** (GitHub: `overclass8211/skeco`)
- 모든 변경: Lint → 영향 테스트 → 보고 → **commit 승인** → commit(+push)
- DB 스키마 변경: **사전 설계서 + 승인** 필수 (`migrations/` 증분)
- UI 동작 버그 fix: Playwright E2E 회귀 테스트 필수
- 상세 규칙: [`CLAUDE.md`](./CLAUDE.md)

---

## 📄 라이선스

**Internal Use Only** — SK에코플랜트 머티리얼즈 전용

> Made for SK ecoplant materials Sales Team · OCI CRM 소스 기반 포크
