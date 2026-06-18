# 🏛 OCI CRM AI — 프로그램 설계서

> **버전**: 2026.05 (Phase G3)
> **대상**: 아키텍트, 개발자, 시스템 분석가
> **목적**: 시스템 아키텍처, 모듈 설계, 데이터 흐름, 보안 설계 등 전체 설계 문서화

---

## 📑 목차

1. [시스템 개요](#1-시스템-개요)
2. [전체 아키텍처](#2-전체-아키텍처)
3. [기술 스택](#3-기술-스택)
4. [데이터베이스 설계](#4-데이터베이스-설계)
5. [백엔드 모듈 설계](#5-백엔드-모듈-설계)
6. [프론트엔드 설계](#6-프론트엔드-설계)
7. [인증 & 권한 설계 (RBAC)](#7-인증--권한-설계-rbac)
8. [외부 통합 설계](#8-외부-통합-설계)
9. [AI 통합 설계](#9-ai-통합-설계)
10. [PWA / 오프라인 설계](#10-pwa--오프라인-설계)
11. [실시간 통신 (WebSocket)](#11-실시간-통신-websocket)
12. [보안 설계](#12-보안-설계)
13. [배포 아키텍처](#13-배포-아키텍처)
14. [확장성 & 성능](#14-확장성--성능)
15. [향후 확장 계획](#15-향후-확장-계획)

---

## 1. 시스템 개요

### 1.1 프로젝트 정의

OCI CRM AI는 **태양광·EPC 영업 조직**을 위한 통합 CRM 시스템으로, AI 어시스턴트, 회의록 자동화, Google 워크스페이스 연동을 통합 제공하는 풀스택 웹 애플리케이션이다.

### 1.2 설계 원칙

| 원칙 | 적용 |
|------|------|
| **Minimal Change** | 기존 API 응답 형식 / DB 스키마 유지, 자가 마이그레이션 |
| **Defensive Programming** | 모든 외부 호출에 try-catch + fallback |
| **Idempotency** | DB 마이그레이션, 재시도 안전성 |
| **Security First** | JWT + RBAC + AES-256 암호화 |
| **Progressive Enhancement** | PWA, 오프라인 우선, 점진적 기능 추가 |
| **API-First** | 명확한 REST + SSE + WebSocket 인터페이스 |
| **Modular** | 라우트/서비스 단위 분리, 의존성 최소화 |

### 1.3 비기능 요구사항

| 항목 | 목표 |
|------|------|
| **응답 시간** | 95th percentile < 500ms (API), STT < 30s/분량 1분 |
| **가용성** | 99.5% (월 다운타임 < 3.6시간) |
| **동시 사용자** | 100명 (피크) |
| **데이터 보존** | 5년 (영업 데이터), 90일 (access logs) |
| **국제화** | 한/영/일/중 4개 언어 |
| **모바일** | iOS Safari 16+ / Chrome Android 100+ |

---

## 2. 전체 아키텍처

### 2.1 시스템 컨텍스트 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                      외부 사용자                              │
│   영업담당자 · 팀장 · 경영진 · 관리자 · IT운영자                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Nginx Reverse Proxy                          │
│                (SSL 종료, CORS, Rate Limiting)                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js + Express Application                    │
│ ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│ │  REST API   │  │  WebSocket   │  │  Service Worker      │ │
│ │  (라우트 27)│  │  (실시간)    │  │  (PWA 캐싱)          │ │
│ └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘ │
│        └─────────────────┴─────────────────────┘             │
│                         │                                     │
│ ┌──────────────────────────────────────────────────────────┐│
│ │              Middleware Stack                              ││
│ │  Helmet · CORS · JWT Auth · RBAC · Rate Limit · Logger    ││
│ └────────────────────────┬─────────────────────────────────┘│
│                          │                                    │
│ ┌────────────────────────────────────────────────────────┐  │
│ │              Service Layer                              │  │
│ │  Auth · Gemini · STT · Gmail · GmailSync · Webhooks     │  │
│ └────────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
│   MariaDB    │   │ External     │   │  File Storage    │
│              │   │ APIs         │   │                  │
│ • 24 tables  │   │ • Gemini AI  │   │ • public/uploads │
│ • InnoDB     │   │ • Google     │   │ • IndexedDB      │
│ • UTF-8 MB4  │   │   Calendar   │   │   (브라우저)     │
│              │   │ • Gmail API  │   │                  │
│              │   │ • Kakao Map  │   │                  │
└──────────────┘   └──────────────┘   └──────────────────┘
```

### 2.2 4-계층 아키텍처

```
┌────────────────────────────────────────────────────────────┐
│  Layer 4: Presentation (브라우저)                            │
│  • Vanilla JS SPA · Service Worker · IndexedDB             │
│  • 17개 페이지 모듈 · Chart.js · FullCalendar              │
└────────────────────────────────────────────────────────────┘
                          ▲
                          │ REST + SSE + WS
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 3: API (Express Router)                              │
│  • 라우트 27개 · 100+ 엔드포인트                            │
│  • 미들웨어: Auth · RBAC · Rate Limit · Validation         │
└────────────────────────────────────────────────────────────┘
                          ▲
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 2: Business Logic (Services)                         │
│  • authService · geminiService · sttService                 │
│  • gmailService · webhookDispatcher                         │
└────────────────────────────────────────────────────────────┘
                          ▲
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Layer 1: Data Access (Repository)                          │
│  • mysql2/promise connection pool                           │
│  • 직접 SQL (ORM 미사용 — 단순성)                          │
└────────────────────────────────────────────────────────────┘
                          ▲
                          ▼
                       MariaDB
```

### 2.3 데이터 흐름 예시 — 회의록 STT

```
[1] 사용자 녹음 (브라우저)
    ↓ MediaRecorder API
[2] WebM Blob 생성
    ↓ multipart/form-data
[3] POST /api/meetings/transcribe-async
    ↓ Multer 파일 저장 (public/uploads/)
[4] sttJobs 큐에 등록 (in-memory)
    ↓ jobId 즉시 반환
[5] 백그라운드 워커
    ├─ 파일 < 10MB → Gemini inline base64
    └─ 파일 ≥ 10MB → Gemini Files API 업로드 → URI 참조
    ↓
[6] Gemini 멀티모달 호출 (화자분리 프롬프트)
    ↓
[7] JSON 파싱 (transcript + speakers)
    ↓
[8] AI 요약 생성 (Gemini Pro)
    ↓
[9] 결과 캐시 (sttJobs)
    
[10] 클라이언트 폴링
     ↓ GET /api/meetings/transcribe-status/:jobId
[11] 결과 반환 + 저장 옵션
     ↓ POST /api/meetings
[12] DB INSERT (meeting_minutes)
```

---

## 3. 기술 스택

### 3.1 Backend

| 계층 | 기술 | 버전 | 용도 |
|------|------|------|------|
| Runtime | Node.js | 20.x LTS | JavaScript 서버 |
| Framework | Express | 4.x | HTTP 라우팅 |
| DB Driver | mysql2 | 3.x | MariaDB 비동기 클라이언트 |
| 인증 | jsonwebtoken | 9.x | JWT 토큰 |
| 인증 | bcryptjs | 2.x | 비밀번호 해싱 |
| 인증 | otplib | 12.x | TOTP 2FA |
| 인증 | @simplewebauthn/server | 9.x | WebAuthn |
| AI | @google/generative-ai | 0.x | Gemini SDK |
| Google | googleapis | 144.x | OAuth + Calendar + Gmail |
| 보안 | helmet | 7.x | HTTP 보안 헤더 |
| 보안 | express-rate-limit | 7.x | DDoS 방어 |
| 업로드 | multer | 1.x | multipart/form-data |
| WS | ws | 8.x | WebSocket 서버 |
| Logger | morgan | 1.x | HTTP 액세스 로그 |

### 3.2 Frontend

| 계층 | 기술 | 용도 |
|------|------|------|
| 프레임워크 | Vanilla JS (ES2020+) | SPA (프레임워크 미도입 — 의존성 최소화) |
| 라우팅 | 자체 hash 기반 | `app.js` 라우터 |
| 차트 | Chart.js 4.x | 대시보드 / 리포트 |
| 캘린더 | FullCalendar 6.x | 일정 UI |
| 지도 | Kakao Map JS API | 주소 검색 |
| 폰트 | Noto Sans KR + IBM Plex Mono | 본문 + 숫자 |
| PWA | Service Worker | 오프라인 캐싱 |
| 저장 | IndexedDB | 오프라인 큐 |
| 캐시 | sessionStorage | 라벨 캐시 (10분 TTL) |

### 3.3 Infrastructure

| 항목 | 옵션 1 | 옵션 2 |
|------|--------|--------|
| Process Mgr | PM2 (cluster mode) | Docker Compose |
| DB | MariaDB 11 | MariaDB 11 (Docker) |
| Reverse Proxy | Nginx | Traefik (Docker) |
| SSL | Let's Encrypt (certbot) | Let's Encrypt |
| Backup | crontab + mysqldump | Docker volume backup |
| Monitoring | PM2 + Uptime Robot | Docker healthcheck |

---

## 4. 데이터베이스 설계

### 4.1 스키마 개요

**총 24개 테이블**, **InnoDB**, **utf8mb4 (CHARSET) / utf8mb4_unicode_ci (COLLATE)**

### 4.2 도메인별 그룹화

```
🔐 인증 / 사용자
├── users (로그인 계정)
├── team_members (영업조직)
├── refresh_tokens
├── token_blacklist
└── access_logs

🎯 영업 도메인 (Core)
├── customers (고객사)
├── leads (영업 리드)
├── projects (프로젝트)
├── activities (활동 이력)
└── pipeline_stages (단계 정의)

📅 일정 / 회의
├── calendar_events
├── meeting_minutes
└── google_meet_sessions

💰 원가 / 상품
├── products
└── cost_history

📨 게시판
├── announcements
├── comments
└── faq

🤖 AI
├── ai_usage
└── token_recharge_log

🌐 통합 / 시스템
├── google_oauth_tokens
├── admin_labels (다국어)
├── admin_label_audit
├── system_settings
└── dev_features
```

### 4.3 핵심 관계 (ER)

```
users (1) ────< (M) team_members
                         │
                         ▼
                    leads (M) ───< (M) activities
                      │                     │
                      ▼                     ▼
                  customers           calendar_events
                      │                     │
                      └──────────────┴──── projects

users (1) ────< (1) google_oauth_tokens
                         │
                         ▼
                    google_meet_sessions ──> meeting_minutes
```

### 4.4 주요 인덱스 전략

| 테이블 | 인덱스 | 용도 |
|--------|--------|------|
| `leads` | `(stage, updated_at)` | 파이프라인 + 최근 변경 |
| `leads` | `(assigned_to, stage)` | 담당자별 단계별 조회 |
| `leads` | `(region)`, `(business_type)` | 필터링 |
| `activities` | `(lead_id, performed_at)` | 활동 타임라인 |
| `activities` | `(gmail_message_id)` UNIQUE | Gmail 중복 차단 |
| `calendar_events` | `(assigned_to, start_datetime)` | 캘린더 조회 |
| `ai_usage` | `(user_id)`, `(created_at)` | 토큰 집계 |
| `access_logs` | `(created_at)`, `(user_id)` | 로그 분석 |
| `users` | `(username)` UNIQUE, `(email)` UNIQUE | 로그인 |
| `refresh_tokens` | `(jti)`, `(user_id)` | 토큰 회전 |
| `admin_labels` | `(scope, key_name, locale)` UNIQUE | 다국어 라벨 |

### 4.5 데이터 수명 정책

| 데이터 | 보존 기간 | 정리 방식 |
|--------|----------|----------|
| `access_logs` | 90일 | 매일 새벽 3시 cron |
| `refresh_tokens` (revoked) | 30일 | cron |
| `token_blacklist` (expired) | 즉시 | cron |
| `ai_usage` | 영구 | (수동 정리) |
| `meeting_minutes` | 영구 | (수동 정리) |
| `uploads/audio` | 영구 | (수동 정리) |
| `admin_label_audit` | 영구 | 감사 추적 |

---

## 5. 백엔드 모듈 설계

### 5.1 디렉토리 구조

```
src/
├── routes/              # API 라우트 (27개 파일)
│   ├── auth.js          # 인증 (login, refresh, OTP, WebAuthn)
│   ├── leads.js
│   ├── customers.js
│   ├── projects.js
│   ├── activities.js
│   ├── calendar.js
│   ├── meetings.js      # STT 동기/비동기
│   ├── ai.js            # Gemini 챗봇 + 브리핑
│   ├── google.js        # OAuth + Calendar + Meet
│   ├── gmail.js         # G1/G2/G3
│   ├── admin.js
│   ├── admin-labels.js  # 다국어 워드 사전
│   ├── dashboard.js
│   ├── notifications.js
│   ├── search.js
│   ├── board.js
│   └── ...
│
├── services/            # 비즈니스 로직
│   ├── authService.js   # JWT + bcrypt + TOTP + WebAuthn
│   ├── geminiService.js # Gemini SDK 래퍼
│   ├── sttService.js    # 음성 → 텍스트
│   ├── sttJobs.js       # 비동기 작업 큐
│   ├── gmailService.js  # Gmail API
│   ├── gmailSync.js     # 백그라운드 동기화
│   └── webhookDispatcher.js
│
├── middleware/
│   ├── auth.js          # JWT 검증
│   ├── rbac.js          # 권한 레벨 체크
│   ├── errorHandler.js  # 통합 에러 처리
│   ├── upload.js        # Multer 설정
│   └── rateLimit.js
│
├── data/
│   └── labelDefaults.js # 4개국어 라벨 기본값
│
├── ws.js                # WebSocket 서버
├── db.js                # mysql2 connection pool
└── initTables.js        # 자가 마이그레이션 (런타임)
```

### 5.2 라우트 패턴

모든 라우트는 다음 패턴을 따른다:

```javascript
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');

router.use(requireAuth);   // JWT 검증

router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    // ... 비즈니스 로직
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
```

### 5.3 미들웨어 체인

```
요청 → helmet (CSP)
     → cors (도메인 화이트리스트)
     → express.json (body 파싱)
     → morgan (액세스 로그)
     → rateLimit (DDoS 방어)
     → /api/auth (인증 - public)
     → authenticate (JWT 검증)
     → autoLevel (RBAC)
     → 라우트 핸들러
     → errorHandler (캐치)
     → logAccess (DB 로깅)
```

### 5.4 서비스 모듈 책임

| 서비스 | 책임 | 의존성 |
|--------|------|--------|
| `authService` | JWT 발급/검증, bcrypt, TOTP, WebAuthn, 블랙리스트 | jsonwebtoken, bcryptjs, otplib |
| `geminiService` | Gemini API 래퍼, 토큰 사용량 로깅, 자동충전 | @google/generative-ai |
| `sttService` | 음성 → 텍스트 (inline/Files API 분기) | geminiService |
| `sttJobs` | 비동기 작업 큐 (in-memory + TTL) | sttService |
| `gmailService` | Gmail API 호출 + 이메일 파싱 | googleapis |
| `gmailSync` | 5분 주기 자동 동기화 + 매칭 | gmailService, pool |
| `webhookDispatcher` | 외부 Webhook 라우팅 (예약) | - |

---

## 6. 프론트엔드 설계

### 6.1 디렉토리 구조

```
public/
├── index.html              # SPA 엔트리
├── manifest.json           # PWA 매니페스트
├── sw.js                   # Service Worker
├── offline.html            # 오프라인 폴백
├── assets/                 # 로고, 아이콘
├── css/
│   └── styles.css          # 단일 통합 CSS (OCI Red #E63329)
└── js/
    ├── api.js              # API 클라이언트 (fetch + 토큰 갱신)
    ├── app.js              # 메인 라우터 + 공통 모달
    ├── utils.js            # Fmt, STAGES, Modal, Toast 유틸
    ├── labels.js           # 다국어 라벨 모듈
    ├── offlineQueue.js     # IndexedDB 오프라인 큐
    ├── google-oauth-callback.js  # OAuth 팝업 핸들러
    └── pages/              # 페이지별 모듈 (17개)
        ├── dashboard.js
        ├── pipeline.js
        ├── leads.js
        ├── customers.js
        ├── projects.js
        ├── calendar.js
        ├── meeting.js      # STT + Google Meet
        ├── meeting-list.js
        ├── team.js
        ├── reports.js
        ├── board.js
        ├── cost.js
        ├── orders.js
        ├── settings.js
        ├── admin.js
        └── dev.js
```

### 6.2 SPA 라우팅

해시 기반 라우팅 (예: `#leads`, `#meeting`, `#admin`)

```javascript
// app.js
function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  const [page, ...params] = hash.split('/');
  const handler = PAGES[page];
  if (handler) handler.render(params);
}
window.addEventListener('hashchange', route);
```

### 6.3 페이지 모듈 인터페이스

각 페이지는 다음 인터페이스 구현:

```javascript
const PAGE = {
  async render(params) { /* DOM 렌더링 */ },
  async refresh() { /* 데이터 재로딩 */ },
  destroy() { /* 이벤트 리스너 정리 */ }
};
```

### 6.4 API 클라이언트 패턴

```javascript
// api.js
const API = {
  async get(path) {
    return this._request('GET', path);
  },
  async post(path, body) {
    return this._request('POST', path, body);
  },
  async _request(method, path, body) {
    const token = sessionStorage.getItem('access_token');
    let res = await fetch(`/api${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',  // Refresh Token 쿠키
    });
    
    if (res.status === 401) {
      // 자동 토큰 갱신
      await this._refresh();
      return this._request(method, path, body);
    }
    
    return res.json();
  }
};
```

### 6.5 상태 관리

- **글로벌 상태**: `sessionStorage` (토큰, 사용자 정보, 라벨 캐시)
- **페이지 로컬 상태**: 각 모듈 내 closure 변수
- **DOM 상태**: 데이터 속성 (`data-id`, `data-stage` 등)

> 외부 상태 관리 라이브러리 미도입 (Redux/Zustand 등) — 단순성 우선

---

## 7. 인증 & 권한 설계 (RBAC)

### 7.1 인증 흐름

```
[Login] → POST /api/auth/login
            ↓
       bcrypt.compare(password, hash)
            ↓
       OTP 활성 여부 체크
       ├─ 활성: { requireOtp: true, userId }
       │  ↓ POST /api/auth/login-otp
       │  otplib.verify(otp, secret)
       │  ↓
       └─ 비활성: 직접 토큰 발급
            ↓
       JWT.sign({ id, username, role, jti }, JWT_SECRET, { exp: 15m })
       Refresh Token: 랜덤 64bytes → bcrypt → DB 저장
            ↓
       Set-Cookie: oci_refresh=<token>; HttpOnly; SameSite=Lax
       Response: { token: <access>, user: {...} }
```

### 7.2 토큰 갱신 흐름

```
[API 요청] → 401 Unauthorized
              ↓
[Client] → POST /api/auth/refresh
            (Cookie: oci_refresh=<refresh_token>)
              ↓
[Server] → bcrypt.compare(refresh_token, db_hash)
              ↓
       JTI 블랙리스트 확인
              ↓
       기존 토큰 revoke + 새 Refresh Token 발급 (rotation)
              ↓
       새 Access Token 발급
              ↓
[Client] → 원래 API 재시도
```

### 7.3 RBAC 매트릭스

```
Level 5: superadmin  (시스템담당자) — 모든 권한
   ↑
Level 4: admin       (IT운영관리자) — 사용자/라벨/토큰 관리
   ↑
Level 3: executive   (경영진)       — 관리자 콘솔 조회
   ↑
Level 2: team_lead   (팀장)         — 팀 분석/리포트
   ↑
Level 1: manager     (매니저)       — 기본 CRUD
```

### 7.4 API 권한 매핑 (`API_LEVEL_MAP`)

```javascript
{
  '/admin/team-members':  4,  // admin 이상
  '/admin/labels':        4,
  '/admin':               3,  // executive 이상
  '/team':                2,  // team_lead 이상
  '/reports':             2,
  '/dev':                 5,  // superadmin
}
```

### 7.5 페이지 가시성 (`pages` 배열)

로그인 응답에 `user.pages: [...]` 포함 → 프론트엔드 사이드바 메뉴 가시성 결정.

```javascript
// 매니저
pages: ['dashboard', 'pipeline', 'leads', 'customers', 'calendar', 'meeting', 'board', 'settings']

// 관리자
pages: [..., 'admin', 'team', 'reports', 'projects']

// Superadmin
pages: ['*']  // 모든 페이지
```

---

## 8. 외부 통합 설계

### 8.1 Google OAuth 2.0

**Authorization Code Flow with PKCE**:

```
[1] 사용자 → "Google 연결" 클릭
[2] 팝업 열림 → GET /api/google/auth
[3] Google 로그인 + 동의 화면
[4] 콜백 → GET /api/google/callback?code=...
[5] code → access_token + refresh_token 교환
[6] 토큰 AES-256-GCM 암호화 → google_oauth_tokens 테이블 저장
[7] 팝업 닫힘 + 부모창에 postMessage
```

**저장 컬럼:**
- `access_token`: AES-256 암호화
- `refresh_token`: AES-256 암호화 (장기 보관)
- `expiry_date`: access_token 만료 시각
- `google_email`: 연결된 이메일
- `gmail_sync_enabled`, `gmail_sync_error`: Gmail 동기화 상태

**Scope 목록:**
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

### 8.2 Gmail 통합 (G1/G2/G3)

**G1: 읽기 + 매칭**
```
이메일 주소 → Gmail Search Query (from: OR to:)
           ↓
       메시지 ID 목록 (최대 50건)
           ↓
       각 메시지 메타데이터 fetch (병렬)
           ↓
       From/To 헤더 파싱 → direction 판별
           ↓
       응답: [{id, subject, snippet, date, direction, gmail_url}, ...]
```

**G2: 발송 (RFC 2822)**
```
{ to, subject, body, cc?, bcc? }
       ↓
   RFC 2822 raw 메시지 구성
   ├─ From: <본인 이메일>
   ├─ To: <수신자>
   ├─ Subject: =?UTF-8?B?<base64>?=  (RFC 2047 — 한국어 안전)
   ├─ Content-Type: text/plain; charset=UTF-8
   ├─ Content-Transfer-Encoding: base64
   └─ <body base64>
       ↓
   base64url 인코딩 (+/= 치환)
       ↓
   POST gmail.users.messages.send({ raw })
       ↓
   { message_id, thread_id, from }
```

**G3: 백그라운드 동기화**
```
[Cron: 5분 주기] → pollAll()
                    ↓
              gmail_sync_enabled=1 사용자 목록
                    ↓
              각 사용자별 pollOne(userId)
                    ↓
              gmail.users.messages.list({ q: `after:${lastPolled}` })
                    ↓
              메시지별:
              ├─ From/To 주소 추출
              ├─ customers.email 매칭 검색
              ├─ 매칭 시: 최근 활성 lead 조회
              └─ activities INSERT (gmail_message_id UNIQUE)
                    ↓
              gmail_last_polled_at 갱신
```

**중복 차단:**
- `activities.gmail_message_id` UNIQUE 인덱스
- `INSERT` 시 `ER_DUP_ENTRY` 무시 (idempotent)

**에러 처리:**
- `invalid_grant` 감지 시 → `gmail_sync_enabled=0` 자동 비활성화
- 사용자 재연결 시 → `gmail_sync_error=NULL` 자동 클리어 (OAuth 콜백)

### 8.3 Google Calendar 통합

```
POST /api/google/calendar/create
       ↓
   calendar.events.insert({
     summary, start, end,
     conferenceData: { createRequest: {...} }  // Meet 자동 생성
   })
       ↓
   { google_event_id, meet_link, ... }
       ↓
   google_meet_sessions 테이블 INSERT
       ↓
   응답 → 회의록 페이지에서 클릭 가능
```

### 8.4 Kakao Map (선택)

- 고객사 주소 검색용 외부 JavaScript API
- 좌표 + 주소 → `customers.address` 저장
- CSP `connect-src`에 `*.daum.net`, `*.kakao.com` 허용

---

## 9. AI 통합 설계

### 9.1 Gemini API 통합

**모델 선택:**
- `gemini-2.5-flash`: 챗봇 (저레이턴시, 저비용)
- `gemini-2.5-pro`: 분석 / 브리핑 (정확도 우선)

### 9.2 챗봇 (SSE 스트리밍)

```
POST /api/ai/chat
{ messages: [{role, content}] }
       ↓
   시스템 프롬프트 + 컨텍스트 자동 주입:
   - 활성 리드 수, 입찰 진행, 올해 수주
   - 최근 주요 리드 5건
   - 긴박한 입찰 일정
       ↓
   Gemini Flash 호출 (streamGenerateContent)
       ↓
   응답을 SSE로 즉시 전달:
   data: {"text": "안녕"}
   data: {"text": "하세요"}
   ...
   data: [DONE]
       ↓
   토큰 사용량 로깅 (ai_usage 테이블)
```

### 9.3 회의록 STT

**파일 크기별 분기:**

```
파일 < 10MB?
├─ Yes: inline base64
│       buffer.toString('base64')
│       Gemini.generateContent({
│         parts: [{ text: prompt }, { inlineData: { data, mimeType } }]
│       })
│
└─ No:  Files API
        File = await gemini.files.upload({ file })
        Gemini.generateContent({
          parts: [{ text: prompt }, { fileData: { fileUri, mimeType } }]
        })
```

**프롬프트 패턴:**
```
다음 음성을 한국어로 전사하되, 화자별로 구분하시오.
출력은 JSON 형식: {
  "transcript": "전체 전사 텍스트",
  "speakers": [
    { "speaker": "스피커1", "text": "..." },
    ...
  ]
}
```

**비동기 작업 큐 (sttJobs):**

```javascript
const jobs = new Map();  // jobId → { status, result, createdAt }

function enqueue(audioPath, userId) {
  const jobId = generateId();
  jobs.set(jobId, { status: 'processing', startedAt: Date.now() });
  
  process(audioPath, jobId).catch(err => {
    jobs.set(jobId, { status: 'error', error: err.message });
  });
  
  return jobId;
}

// 25분 워치독
setInterval(() => {
  for (const [id, job] of jobs) {
    if (job.status === 'processing' && Date.now() - job.startedAt > 25 * 60 * 1000) {
      jobs.set(id, { status: 'error', error: 'timeout' });
    }
  }
}, 60 * 1000);

// TTL 정리 (완료 후 1시간)
```

### 9.4 토큰 관리

**자동충전 로직:**
```
[Gemini 호출 후]
   ↓
ai_usage INSERT (user_id, tokens, ...)
   ↓
team_members.monthly_used 갱신
   ↓
monthly_used / monthly_token_limit >= threshold (80%)?
   ↓
auto_recharge_enabled = 1?
   ↓
team_members.monthly_token_limit += auto_recharge_amount
   ↓
token_recharge_log INSERT (triggered_by='auto')
```

---

## 10. PWA / 오프라인 설계

### 10.1 Service Worker 전략

```javascript
// public/sw.js
const CACHE_VERSION = 'v1';

// 캐싱 전략 결정
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // API: 캐시 안 함
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }
  
  // HTML: Network-First
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(event.request));
  }
  // 정적 자원: Cache-First
  else {
    event.respondWith(cacheFirst(event.request));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    cache.put(req, res.clone());
    return res;
  } catch {
    return cache.match(req) || cache.match('/offline.html');
  }
}
```

### 10.2 IndexedDB 오프라인 큐

**스키마:**
```
DB: oci_meeting_offline
Object Store: queue
  id (auto)
  blob (Blob)
  filename
  status: pending | uploading | transcribing | done | error
  createdAt
  updatedAt
  error?
```

**상태 머신:**
```
[녹음 완료] → pending
              ↓
         [온라인 감지]
              ↓
           uploading (POST /transcribe-async)
              ↓
           transcribing (폴링 /transcribe-status)
              ↓
              done — DB INSERT 완료
              ↓
              error — 사용자에게 재시도 옵션
```

**자동 처리 (online 이벤트):**
```javascript
window.addEventListener('online', () => {
  OfflineQueue.processNext();
});
```

### 10.3 Manifest 핵심 설정

```json
{
  "name": "OCI CRM AI",
  "short_name": "OCI CRM",
  "display": "standalone",
  "theme_color": "#E63329",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/assets/icon-192.png", "sizes": "192x192" },
    { "src": "/assets/icon-512.png", "sizes": "512x512" },
    { "src": "/assets/icon-mask.png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

---

## 11. 실시간 통신 (WebSocket)

### 11.1 연결 인증

```
Client → ws://server?token=<JWT>
         ↓
      Server: jwt.verify(token, JWT_SECRET)
         ↓
      성공: req.user 설정 + 연결 유지
      실패: ws.close(4001, 'unauthorized')
```

### 11.2 메시지 타입

**Client → Server:**
```json
{ "type": "healthmap-subscribe" }
```

**Server → Client:**
```json
// 헬스맵 (1초 간격, 구독자만)
{ "type": "healthmap-snapshot", "data": { cpu, memory, ... } }

// 공지사항 (모든 클라이언트 브로드캐스트)
{ "type": "announcement", "id", "title", "preview", ... }
```

### 11.3 브로드캐스트 패턴

```javascript
// 공지사항 발행 시
const allClients = wss.clients;
for (const ws of allClients) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'announcement',
      ...announcementData
    }));
  }
}
```

---

## 12. 보안 설계

### 12.1 보안 계층

```
[1] Network
    ├─ HTTPS only (Nginx → 443)
    ├─ HTTP → HTTPS 리다이렉트
    └─ HSTS 헤더 (max-age=31536000)

[2] Application
    ├─ Helmet (CSP, X-Frame-Options, X-Content-Type-Options)
    ├─ CORS (whitelist ALLOWED_ORIGINS)
    ├─ Rate Limit (300/15min)
    └─ Body 크기 제한 (25MB)

[3] Authentication
    ├─ JWT + Refresh Token Rotation
    ├─ bcrypt (cost=10) 비밀번호
    ├─ TOTP 2FA
    ├─ WebAuthn (생체인증)
    ├─ Token 블랙리스트 (즉시 무효화)
    └─ Refresh Token DB 저장 + bcrypt 해시

[4] Authorization
    ├─ RBAC 5단계
    ├─ API 레벨 매핑 (Hard-coded)
    └─ 페이지 가시성 (pages 배열)

[5] Data
    ├─ AES-256-GCM (OAuth 토큰, OTP secret)
    ├─ SQL Injection 방지 (Parameterized queries)
    ├─ XSS 방지 (escape HTML)
    └─ CSRF 방지 (SameSite=Lax 쿠키)

[6] Logging / Audit
    ├─ access_logs (모든 API 호출)
    ├─ admin_label_audit (라벨 변경 이력)
    ├─ token_recharge_log
    └─ refresh_tokens.user_agent + ip
```

### 12.2 CSP 설정

```javascript
helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://*.daum.net"],
    styleSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc:    ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "wss:", "https://*.daum.net", "https://*.kakao.com"],
    fontSrc:   ["'self'", "https://fonts.gstatic.com"],
    frameAncestors: ["'none'"],
  }
})
```

### 12.3 토큰 회전 (Token Rotation)

```
[Login] → access_token_v1 + refresh_token_v1
[15분 후] → POST /refresh (refresh_token_v1)
            ↓
        DB: refresh_token_v1 → revoked=1
        새 발급: access_token_v2 + refresh_token_v2
[15분 후] → POST /refresh (refresh_token_v2)
            ↓
        DB: refresh_token_v2 → revoked=1
        ...
```

**탈취 감지:**
- 이미 revoked된 토큰으로 갱신 시도 → 모든 사용자 세션 무효화

### 12.4 OAuth 토큰 암호화

```javascript
// AES-256-GCM
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
```

---

## 13. 배포 아키텍처

### 13.1 운영 환경 (Production)

```
┌──────────────────────────────────────────┐
│              Internet                     │
└─────────────────┬────────────────────────┘
                  │ HTTPS (443)
                  ▼
┌──────────────────────────────────────────┐
│        GCP / AWS / Azure VM              │
│  ┌────────────────────────────────────┐  │
│  │     Nginx (Reverse Proxy)          │  │
│  │     • SSL Termination              │  │
│  │     • HTTP→HTTPS Redirect          │  │
│  │     • client_max_body_size: 30M    │  │
│  │     • proxy_read_timeout: 1000s    │  │
│  └────────────┬───────────────────────┘  │
│               │ HTTP (3001)               │
│               ▼                            │
│  ┌────────────────────────────────────┐  │
│  │     PM2 Cluster (Node.js)          │  │
│  │     • instances: max               │  │
│  │     • exec_mode: cluster           │  │
│  │     • max_memory_restart: 1G       │  │
│  └────────────┬───────────────────────┘  │
│               │ TCP (3306)                │
│               ▼                            │
│  ┌────────────────────────────────────┐  │
│  │     MariaDB 11                     │  │
│  │     • localhost only               │  │
│  │     • InnoDB                       │  │
│  └────────────────────────────────────┘  │
│                                            │
│  ┌────────────────────────────────────┐  │
│  │     File System                    │  │
│  │     /app/public/uploads/  (오디오) │  │
│  │     /app/logs/            (로그)   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### 13.2 Docker Compose 환경 (대안)

```
┌──────────────────────────────────────────┐
│  Docker Host                              │
│                                            │
│  ┌──────────────┐   ┌──────────────┐    │
│  │   app        │←→│      db      │    │
│  │ (Node 20)    │   │ (MariaDB 11) │    │
│  │ Port: 3001   │   │ Port: 3306   │    │
│  └──────┬───────┘   └──────┬───────┘    │
│         │                   │             │
│         ▼                   ▼             │
│  ┌──────────────┐   ┌──────────────┐    │
│  │   uploads    │   │   db-data    │    │
│  │   (volume)   │   │   (volume)   │    │
│  └──────────────┘   └──────────────┘    │
└──────────────────────────────────────────┘
```

### 13.3 환경별 설정 매트릭스

| 항목 | Development | Test | Production |
|------|------------|------|-----------|
| `NODE_ENV` | development | test | production |
| DB Pool | 5 | 3 | 20 |
| Rate Limit | 3000/15min | skip | 300/15min |
| AI Limit | 100/min | skip | 20/min |
| HTTPS | 선택 | 비활성 | 활성 |
| CORS | 모든 Origin | skip | `ALLOWED_ORIGINS` |
| 로그 레벨 | debug | error | warn |
| Source Maps | enabled | enabled | disabled |

### 13.4 CI/CD (예시)

```yaml
# .github/workflows/deploy.yml (예시 — 실제 미구현)
on:
  push:
    branches: [master]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - name: Deploy
        run: |
          ssh user@prod 'cd /app && git pull && npm install --production && pm2 reload all'
```

---

## 14. 확장성 & 성능

### 14.1 수직 확장 (Scale Up)

| 단계 | 사양 | 처리 능력 |
|------|------|----------|
| Small | 2 vCPU / 2GB | ~30 사용자 |
| Medium | 4 vCPU / 4GB | ~100 사용자 |
| Large | 8 vCPU / 8GB | ~300 사용자 |
| XLarge | 16 vCPU / 16GB | ~1000 사용자 |

### 14.2 수평 확장 (Scale Out) — 향후

**현재 제약:**
- `sttJobs` 큐는 in-memory (PM2 cluster 모드에서 인스턴스 간 공유 안 됨)
- WebSocket 연결은 인스턴스에 종속

**확장 방안:**
1. **Redis 도입**: sttJobs 공유, WebSocket pub/sub
2. **Sticky Session**: Nginx `ip_hash`
3. **Load Balancer**: 다중 VM
4. **Read Replica**: MariaDB 읽기 분산
5. **CDN**: 정적 자원 가속 (Cloudflare)

### 14.3 성능 최적화 포인트

| 영역 | 최적화 |
|------|--------|
| **DB** | 적절한 인덱스, prepared statement |
| **API** | Gzip 압축 (`compression` 미들웨어) |
| **프론트** | Service Worker 캐싱, sessionStorage |
| **AI** | Gemini Flash (저비용) + Pro (고정확도) 모델 분리 |
| **STT** | inline (<10MB) vs Files API (≥10MB) |
| **WebSocket** | 헬스맵 구독 시에만 푸시 |
| **로그** | access_logs 90일 자동 정리 |

### 14.4 모니터링 지표

```
시스템:
  • CPU: < 70%
  • Memory: < 80%
  • Disk: < 80%

애플리케이션:
  • API p95: < 500ms
  • Error rate: < 1%
  • WebSocket 연결 수
  • DB pool 사용률

비즈니스:
  • DAU / MAU
  • AI 토큰 일일 소비
  • Gmail 동기화 성공률
  • STT 평균 처리 시간
```

---

## 15. 향후 확장 계획

### 15.1 단기 (3개월)

- **G4 Outlook 통합**: Microsoft Graph API
- **활동 자동 분류**: AI로 이메일/통화 → 단계 변경 제안
- **OAuth 검증 완료**: 운영 환경에서 unverified 경고 제거
- **알림 푸시**: Web Push API (브라우저 알림)

### 15.2 중기 (6개월)

- **Redis 도입**: 분산 큐 + 캐시
- **Mobile 네이티브 앱** (Capacitor 또는 React Native)
- **AI Voice Assistant**: 음성 명령으로 CRM 조작
- **자동 견적서 생성**: 리드 정보 → AI로 견적서 PDF 생성

### 15.3 장기 (1년+)

- **Multi-tenancy**: 여러 회사 입주
- **Marketplace**: 외부 통합 플러그인 (SAP, Salesforce, ...)
- **데이터 웨어하우스**: BI 도구 연동 (Tableau, Power BI)
- **온프레미스 옵션**: 폐쇄망 배포 패키지

---

## 📎 부록 A: 주요 디자인 결정 (Architectural Decision Records)

### ADR-001: ORM 미도입
- **결정**: mysql2 직접 사용 (Sequelize/Prisma 미도입)
- **이유**: 의존성 최소화, 명시적 쿼리, 학습 곡선 낮음
- **트레이드오프**: 마이그레이션 도구 부재 → `initTables.js`로 자체 구현

### ADR-002: Vanilla JS (프레임워크 미도입)
- **결정**: React/Vue 등 미사용
- **이유**: 빌드 파이프라인 단순, 즉시 디버깅, 의존성 최소화
- **트레이드오프**: 컴포넌트 재사용성 낮음 → 페이지 모듈 패턴으로 보완

### ADR-003: JWT + Refresh Token (Session 미사용)
- **결정**: stateless JWT + DB Refresh Token
- **이유**: 수평 확장 용이, 모바일 친화적
- **트레이드오프**: 즉시 무효화 어려움 → 블랙리스트 + 짧은 만료(15분)로 보완

### ADR-004: in-memory sttJobs (Redis 미도입)
- **결정**: Node.js 메모리에 작업 큐
- **이유**: 단순성, 초기 사용자 적음
- **트레이드오프**: PM2 cluster 모드 미지원 → 1인스턴스 운영 또는 향후 Redis

### ADR-005: 다국어를 DB로 저장 (코드 외부화)
- **결정**: `admin_labels` 테이블 + `labelDefaults.js`
- **이유**: 코드 변경 없이 라벨 커스터마이징 가능
- **트레이드오프**: 캐시 무효화 복잡 → sessionStorage TTL 10분으로 절충

---

## 📎 부록 B: 디렉토리 구조 전체

```
oci-crm-ai/
├── README.md                  # 프로젝트 진입점
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── .eslintrc.js / eslint.config.js
├── .prettierrc
├── Dockerfile
├── docker-compose.yml
├── schema.sql                 # MariaDB 스키마
├── server.js                  # Express 엔트리
│
├── config/
│   └── index.js               # 환경변수 통합
│
├── src/
│   ├── db.js                  # mysql2 pool
│   ├── ws.js                  # WebSocket 서버
│   ├── initTables.js          # 자가 마이그레이션
│   ├── data/
│   │   └── labelDefaults.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── rbac.js
│   │   ├── errorHandler.js
│   │   ├── upload.js
│   │   └── rateLimit.js
│   ├── routes/                # 27개 라우트 파일
│   │   ├── auth.js
│   │   ├── leads.js
│   │   └── ...
│   ├── services/              # 비즈니스 로직
│   │   ├── authService.js
│   │   ├── geminiService.js
│   │   ├── sttService.js
│   │   ├── sttJobs.js
│   │   ├── gmailService.js
│   │   ├── gmailSync.js
│   │   └── webhookDispatcher.js
│   └── utils/
│       └── routeHelper.js
│
├── public/                    # 정적 자원 (브라우저)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── offline.html
│   ├── assets/
│   ├── css/
│   ├── js/
│   │   ├── api.js
│   │   ├── app.js
│   │   ├── utils.js
│   │   ├── labels.js
│   │   ├── offlineQueue.js
│   │   └── pages/             # 17개 페이지 모듈
│   └── uploads/               # 회의록 오디오 (gitignore)
│
├── scripts/
│   ├── seed-2025.js
│   └── init-db.js
│
├── tests/
│   └── (vitest + supertest)
│
├── docs/                      # 모든 개발 문서
│   ├── README.md              # docs 인덱스
│   ├── USER_MANUAL.md
│   ├── PROGRAM_DESIGN.md      # 본 문서
│   ├── API_DOCUMENTATION.md
│   ├── ADMIN_SETUP_GUIDE.md
│   ├── TROUBLESHOOTING_GUIDE.md
│   ├── db-ddl.sql
│   ├── db-erd.md
│   └── db-table-design.md
│
└── logs/                      # PM2 로그 (gitignore)
```

---

## 📎 부록 C: 용어집

| 용어 | 정의 |
|------|------|
| **RBAC** | Role-Based Access Control — 역할 기반 접근 제어 |
| **JWT** | JSON Web Token — 자체 포함형 인증 토큰 |
| **JTI** | JWT ID — 토큰 고유 식별자 (블랙리스트 키) |
| **TOTP** | Time-based One-Time Password — 시간 기반 OTP |
| **PWA** | Progressive Web App |
| **SSE** | Server-Sent Events — 단방향 스트리밍 |
| **SPA** | Single Page Application |
| **STT** | Speech-to-Text — 음성 → 텍스트 변환 |
| **CSP** | Content Security Policy — XSS 방어 헤더 |
| **CORS** | Cross-Origin Resource Sharing |
| **AES-256-GCM** | 대칭키 암호화 (인증 태그 포함) |
| **invalid_grant** | OAuth Refresh Token 만료/회수 에러 |
| **Lead** | 영업 기회 (CRM 용어) |
| **Pipeline** | 영업 단계 진행 흐름 |
| **Funnel** | 단계별 전환율 깔때기 |

---

## 📮 변경 이력

| 버전 | 일자 | 주요 변경 |
|------|------|----------|
| v1.0 | 2025.Q1 | 초기 CRM (8 테이블, 9 페이지) |
| v2.0 | 2025.Q3 | AI 어시스턴트 + 회의록 STT |
| v3.0 | 2025.Q4 | 다국어 + 워드 사전 |
| v3.5 | 2026.Q1 | STT 비동기 (120분 대응) |
| v4.0 | 2026.Q1 | PWA 1~3 (오프라인 녹음) |
| v4.5 | 2026.Q2 | Gmail G1+G2+G3 통합 |
| **v5.0** | **2026.05** | **현재 — Phase G3 완료** |

---

> 본 설계 문서는 시스템 변경 시 함께 갱신되어야 한다.
> 변경 시 `docs/PROGRAM_DESIGN.md` 의 변경 이력 섹션에 기록.
