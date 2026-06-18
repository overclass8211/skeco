# 🪄 OCI CRM AI

> **태양광·EPC 영업 조직**을 위한 통합 CRM + AI 어시스턴트 풀스택 웹 애플리케이션
> Node.js + Express + MariaDB + Vanilla JS SPA + PWA

![Status](https://img.shields.io/badge/status-active-success)
![Version](https://img.shields.io/badge/version-v5.0-blue)
![Node](https://img.shields.io/badge/node-20.x_LTS-339933)
![DB](https://img.shields.io/badge/MariaDB-11.x-003545)
![License](https://img.shields.io/badge/license-Internal-lightgrey)

---

## 📖 빠른 시작

```bash
# 1) 클론
git clone https://github.com/overclass8211/oci-ai.git
cd oci-ai

# 2) 환경 변수 설정
cp .env.example .env
nano .env  # DB, JWT_SECRET, GEMINI_API_KEY 등 설정

# 3) DB 초기화
mysql -u root -p < schema.sql

# 4) 의존성 설치 + 실행
npm install
npm run dev

# 5) 브라우저
open http://localhost:3001
```

상세 설정은 [📚 docs/ADMIN_SETUP_GUIDE.md](./src/docs/ADMIN_SETUP_GUIDE.md) 참고.

---

## ✨ 주요 기능

### 🎯 영업 관리
- **대시보드** — 5대 KPI, 월별 추이, 파이프라인 펀넬, 실시간 알림
- **8단계 칸반 파이프라인** — 드래그&드롭, 변경 이력 자동 기록
- **리드 / 고객 / 프로젝트** — CRUD + 대량 등록 (Copy & Paste) + Excel 내보내기
- **활동 이력** — 미팅/통화/이메일 자동 추적

### 🤖 AI 기능 (Gemini 2.5)
- **AI 챗봇** — 스트리밍 SSE, CRM 컨텍스트 자동 주입
- **고객사 AI 브리핑** — 자동 영업 인사이트 생성
- **회의록 STT** — 음성 → 텍스트 (최대 120분, 화자분리, AI 요약)
- **토큰 자동충전** — 임계값 도달 시 자동 한도 증액

### 📧 Google 통합
- **Google Calendar** — CRM 이벤트 양방향 동기화
- **Google Meet** — 미팅 링크 즉시 생성 + 회의록 연결
- **Gmail** — 읽기/발송/자동 매칭/백그라운드 동기화 (G1+G2+G3)

### 📱 모바일 / PWA
- **PWA 설치** — 홈 화면에 추가, 네이티브 앱처럼 사용
- **오프라인 녹음** — IndexedDB 큐 + 자동 동기화
- **iOS/Android 최적화** — 16px 폰트, 햄버거 메뉴

### 🌐 다국어 지원
- **4개 언어** — 한국어 / English / 日本語 / 中文
- **워드 사전** — DB 스키마 변경 없이 라벨 커스터마이징

### 🔐 보안 / 권한
- **5단계 RBAC** — 매니저 → Superadmin
- **다중 인증** — 비밀번호 + 2FA (TOTP) + WebAuthn
- **JWT + Refresh Token Rotation** — 15분/7일
- **AES-256 암호화** — OAuth 토큰, OTP 시크릿

### 📊 분석 / 리포트
- 매출 분석, 원가 추이, 리드 분석, 팀 성과 4종 차트
- 글로벌 검색 (`Cmd+K`) — 5개 카테고리
- 실시간 WebSocket 알림

---

## 🏗 아키텍처

```
[Browser]
  ├── Vanilla JS SPA (17개 페이지 모듈)
  ├── Service Worker (PWA, 오프라인 캐싱)
  ├── IndexedDB (오프라인 큐)
  └── WebSocket (실시간 알림)
       │
       ▼ HTTPS / WSS
       
[Nginx Reverse Proxy] (SSL, CORS, Rate Limit)
       │
       ▼
[Node.js + Express :3001]
  ├── 27 routes / 100+ endpoints
  ├── Middleware: Helmet · CORS · JWT · RBAC · Rate Limit
  ├── Services: Auth · Gemini · STT · Gmail · WebSocket
  └── PM2 Cluster (선택) 또는 Docker Compose
       │
       ▼
[MariaDB 11]
  └── 24 tables · InnoDB · utf8mb4
       │
       ▼
[External APIs]
  ├── Google Gemini AI (Flash + Pro)
  ├── Google Calendar / Meet / Gmail
  └── Kakao Map (선택)
```

상세 아키텍처는 [🏛 docs/PROGRAM_DESIGN.md](./src/docs/PROGRAM_DESIGN.md) 참고.

---

## 📚 문서

모든 개발 문서는 [`docs/`](./src/docs/) 폴더에서 통합 관리됩니다.

| 문서 | 설명 |
|------|------|
| 📘 [USER_MANUAL.md](./src/docs/USER_MANUAL.md) | 사용자 매뉴얼 (화면별 가이드, FAQ) |
| 🏛 [PROGRAM_DESIGN.md](./src/docs/PROGRAM_DESIGN.md) | 프로그램 설계서 (아키텍처, 모듈 설계, ADR) |
| 🔌 [API_DOCUMENTATION.md](./src/docs/API_DOCUMENTATION.md) | REST API + WebSocket 명세 |
| 🛠 [ADMIN_SETUP_GUIDE.md](./src/docs/ADMIN_SETUP_GUIDE.md) | 관리자 셋업 + 배포 가이드 |
| 🔧 [TROUBLESHOOTING_GUIDE.md](./src/docs/TROUBLESHOOTING_GUIDE.md) | 트러블슈팅 가이드 (에러 코드 + 진단) |
| 🗄 [db-erd.md](./src/docs/db-erd.md) | DB ER 다이어그램 |
| 🗄 [db-table-design.md](./src/docs/db-table-design.md) | 테이블 상세 설계 |

📌 **문서 인덱스**: [docs/README.md](./src/docs/README.md)

---

## 🔧 기술 스택

### Backend
- **Node.js** 20.x LTS + **Express** 4.x
- **MariaDB** 11 (mysql2/promise)
- **JWT** + **bcrypt** + **otplib** (TOTP) + **WebAuthn**
- **Google Generative AI** SDK (Gemini)
- **googleapis** (OAuth + Calendar + Gmail)
- **Helmet** + **express-rate-limit** + **multer**
- **WebSocket** (ws)

### Frontend
- **Vanilla JS (ES2020+)** — 프레임워크 미사용
- **Chart.js** 4 + **FullCalendar** 6
- **Service Worker** + **IndexedDB**
- **Kakao Map** JavaScript API

### Infrastructure
- **PM2** Cluster Mode 또는 **Docker Compose**
- **Nginx** Reverse Proxy + **Let's Encrypt** SSL
- **MariaDB** localhost only (외부 차단)

---

## 📦 디렉토리 구조

```
oci-crm-ai/
├── README.md                  # 이 문서
├── package.json
├── .env.example
├── schema.sql                 # MariaDB 스키마 (24 테이블)
├── server.js                  # Express 엔트리
├── Dockerfile
├── docker-compose.yml
│
├── config/
│   └── index.js               # 환경변수 통합
│
├── src/
│   ├── routes/                # 27개 API 라우트
│   ├── services/              # 비즈니스 로직 (Auth, AI, Gmail, ...)
│   ├── middleware/            # Auth, RBAC, ErrorHandler, featureGuard, ...
│   ├── data/                  # featureRegistry, featurePresets, labelDefaults 등
│   ├── utils/                 # logoCache, routeHelper 등
│   ├── docs/                  # 📚 모든 개발 산출물 (19개 문서)
│   ├── db.js                  # mysql2 pool
│   ├── ws.js                  # WebSocket 서버
│   └── initTables.js          # 자가 마이그레이션
│
├── public/                    # 정적 자원
│   ├── index.html             # SPA 엔트리
│   ├── manifest.json          # PWA
│   ├── sw.js                  # Service Worker
│   ├── offline.html
│   ├── assets/                # 로고/아이콘
│   ├── css/styles.css
│   ├── js/
│   │   ├── api.js
│   │   ├── app.js             # SPA 라우터
│   │   ├── utils.js
│   │   ├── labels.js          # 다국어 모듈
│   │   ├── offlineQueue.js
│   │   └── pages/             # 17개 페이지 모듈
│   └── uploads/               # 회의록 오디오 + 로고 (gitignore)
│
├── scripts/                   # 시드 / 마이그레이션 스크립트
├── tests/                     # vitest + supertest
└── e2e/                       # Playwright E2E 테스트
```

---

## 🚀 NPM Scripts

| Script | 용도 |
|--------|------|
| `npm start` | 프로덕션 실행 |
| `npm run dev` | 개발 모드 (nodemon 자동 재시작) |
| `npm test` | 테스트 실행 (vitest) |
| `npm run test:watch` | 테스트 감시 모드 |
| `npm run test:coverage` | 커버리지 분석 |
| `npm run lint` | ESLint 검사 |
| `npm run lint:fix` | ESLint 자동 수정 |
| `npm run format` | Prettier 포맷팅 |

---

## 🌟 주요 마일스톤

| 버전 | 시기 | 주요 변경 |
|------|------|----------|
| v1.0 | 2025.Q1 | 기본 CRM (8 테이블, 9 페이지) |
| v2.0 | 2025.Q3 | AI 어시스턴트 + 회의록 STT |
| v3.0 | 2025.Q4 | 다국어 + 워드 사전 |
| v3.5 | 2026.Q1 | STT 비동기 (120분 대응) |
| v4.0 | 2026.Q1 | PWA 1~3 (오프라인 녹음) |
| v4.5 | 2026.Q2 | Gmail G1+G2+G3 통합 |
| **v5.0** | **2026.05** | **Phase G3 완료 (현재)** |

---

## 🎨 디자인 가이드

- **메인 컬러**: OCI Red `#E63329`
- **레이아웃**: 사이드바(220px) + 메인 영역
- **폰트**: Noto Sans KR (본문) + IBM Plex Mono (숫자/금액)
- **반응형**: 1100px 이하 자동 축소, 768px 이하 모바일 UI
- **PWA 테마**: 컬러 `#E63329`, standalone display

---

## 🔐 보안

| 영역 | 적용 |
|------|------|
| Network | HTTPS only, HSTS, HTTP→HTTPS 리다이렉트 |
| Application | Helmet CSP, CORS whitelist, Rate Limit |
| Auth | JWT(15m) + Refresh Rotation(7d), bcrypt(cost=10), 2FA, WebAuthn |
| Data | AES-256-GCM (OAuth tokens, OTP secrets) |
| Audit | access_logs, admin_label_audit, token_recharge_log |

상세 보안 설계는 [PROGRAM_DESIGN.md § 12](./src/docs/PROGRAM_DESIGN.md#12-보안-설계) 참고.

---

## 🤝 기여

내부 사용 프로젝트로 외부 PR은 받지 않습니다. 사내 개발자는:

1. 기능 브랜치 생성 (`feature/xxx`)
2. 변경 시 관련 문서 (`docs/*.md`) 동시 갱신
3. PR 생성 + 코드 리뷰
4. master 머지 + 운영 배포

---

## 📮 문의

- **시스템 문제**: IT 운영팀
- **신규 기능 제안**: 게시판 > 건의사항
- **AI 토큰 한도 증액**: 관리자

---

## 📄 라이선스

**Internal Use Only** — OCI 영업조직 전용

---

> Made with 🪄 for OCI Sales Team
> Powered by Claude (Sonnet 4.6) + Gemini (2.5 Flash/Pro)
