# 🔌 OCI CRM AI — API 문서

> **버전**: 2026.05 (Phase G3 + Contract Phase 0/1/2/3/4/5)
> **Base URL**: `https://<your-domain>/api` (Production) / `http://localhost:3001/api` (Dev)
> **인증 방식**: JWT Bearer Token + HttpOnly Refresh Cookie

---

## 📑 목차

1. [공통 사항](#1-공통-사항)
2. [인증 API](#2-인증-api-auth)
3. [대시보드 API](#3-대시보드-api-dashboard)
4. [리드 API](#4-리드-api-leads)
5. [고객사 API](#5-고객사-api-customers)
6. [프로젝트 API](#6-프로젝트-api-projects)
7. [활동 이력 API](#7-활동-이력-api-activities)
8. [캘린더 API](#8-캘린더-api-calendar)
9. [회의록 / STT API](#9-회의록--stt-api-meetings)
10. [AI API](#10-ai-api-ai)
11. [Google 연동 API](#11-google-연동-api-google)
12. [Gmail 통합 API](#12-gmail-통합-api-gmail-g1g2g3)
13. [관리자 API](#13-관리자-api-admin)
14. [다국어 라벨 API](#14-다국어-라벨-api-admin-labels)
15. [알림 / 검색 / 게시판](#15-알림--검색--게시판)
16. [WebSocket 이벤트](#16-websocket-이벤트)

---

## 1. 공통 사항

### 1.1 인증 헤더

```http
Authorization: Bearer <JWT_ACCESS_TOKEN>
Cookie: oci_refresh=<REFRESH_TOKEN>  # HttpOnly, 자동 전송
```

- **Access Token**: 15분 만료, 모든 API 요청에 포함
- **Refresh Token**: 7일 유효, HttpOnly 쿠키로 자동 관리

### 1.2 표준 응답 포맷

**성공 (2xx):**
```json
{
  "success": true,
  "data": { /* ... */ },
  "page": 1,
  "limit": 50,
  "total": 120,
  "totalPages": 3
}
```

**실패 (4xx/5xx):**
```json
{
  "success": false,
  "error": "에러 메시지 (한국어)",
  "code": "ERROR_CODE",
  "field": "유효성 검증 실패 필드 (선택)"
}
```

### 1.3 HTTP 상태 코드

| Code | 의미 | 발생 케이스 |
|------|------|-----------|
| `200` | OK | 일반 성공 |
| `201` | Created | 리소스 생성 (POST) |
| `400` | Bad Request | 필수 필드 누락, 유효성 검증 실패 |
| `401` | Unauthorized | 토큰 없음/만료/무효 |
| `403` | Forbidden | RBAC 권한 부족 |
| `404` | Not Found | 리소스 없음 |
| `413` | Payload Too Large | 파일 크기 초과 (25MB) |
| `429` | Too Many Requests | Rate Limit 초과 |
| `500` | Internal Server Error | 서버 오류 |
| `503` | Service Unavailable | DB 미연결 |

### 1.4 페이지네이션

```http
GET /api/leads?page=1&limit=50
```

응답에 `page`, `limit`, `total`, `totalPages` 포함.

### 1.5 Rate Limit

| 환경 | 일반 API | AI API |
|------|---------|--------|
| Production | 300/15min | 20/min |
| Development | 3000/15min | 100/min |
| Test | skip | skip |

---

## 2. 인증 API (`/auth`)

### 2.1 로그인

```http
POST /api/auth/login
Content-Type: application/json
```

**Request:**
```json
{
  "username": "user@oci.co.kr",
  "password": "password123"
}
```

**Response (OTP 미활성, 200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "15m",
  "user": {
    "id": 1,
    "username": "user@oci.co.kr",
    "full_name": "김영업",
    "email": "user@oci.co.kr",
    "role": "manager",
    "roleLabel": "관리자",
    "roleColor": "#ff5722",
    "pages": ["dashboard", "leads", "projects", "..."]
  }
}
```

**Response (OTP 활성 — 2단계 필요, 200):**
```json
{
  "success": true,
  "requireOtp": true,
  "userId": 1
}
```

### 2.2 OTP 로그인 (2단계)

```http
POST /api/auth/login-otp
```

**Request:**
```json
{
  "userId": 1,
  "otp": "123456"
}
```

### 2.3 WebAuthn 로그인 (생체인증)

```http
POST /api/auth/login-webauthn
```

### 2.4 Refresh Token

```http
POST /api/auth/refresh
Cookie: oci_refresh=<refresh_token>
```

**Response:**
```json
{
  "success": true,
  "token": "<new_access_token>",
  "expiresIn": "15m"
}
```

### 2.5 로그아웃

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

→ JTI를 `token_blacklist`에 기록 + Refresh Token 무효화

### 2.6 OTP 설정

```http
POST /api/auth/otp/setup
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "qr_code_url": "otpauth://totp/...",
  "secret": "ABCDEFGHIJK..."
}
```

---

## 3. 대시보드 API (`/dashboard`)

### 3.1 종합 통계

```http
GET /api/dashboard?year=2026
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "active_leads": 45,
      "bidding_in_progress": 12,
      "ytd_won_amount": 8500.5,
      "ytd_win_rate": 23.5
    },
    "funnel": [
      { "stage": "lead", "count": 30, "amount": 1500 },
      { "stage": "review", "count": 15, "amount": 2000 }
    ],
    "monthly_leads": [
      { "month": "2026-01", "count": 8 }
    ],
    "recent_activities": [ /* ... */ ]
  }
}
```

### 3.2 기타 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/dashboard/stats` | 선택 연도 통계 |
| GET | `/dashboard/funnel` | 단계별 펀넬 |
| GET | `/dashboard/monthly` | 월별/분기별/연간 통계 |
| GET | `/dashboard/activities` | 최근 활동 |

---

## 4. 리드 API (`/leads`)

### 4.1 목록 조회

```http
GET /api/leads
  ?page=1
  &limit=50
  &stage=bidding
  &region=국내
  &assigned_to=1
  &business_type=EPC
  &search=한국전력
  &date_from=2026-01-01
  &date_to=2026-12-31
  &date_field=close  # close|stage|created|updated
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "customer_id": 5,
      "customer_name": "한국동서발전",
      "project_name": "30MW EPC 입찰",
      "business_type": "EPC",
      "region": "국내",
      "capacity_mw": 30.0,
      "expected_amount": 150.0,
      "currency": "KRW",
      "stage": "bidding",
      "assigned_to": 1,
      "assigned_name": "김영업",
      "expected_close_date": "2026-06-30",
      "bidding_deadline": "2026-05-31",
      "notes": "긴급 입찰",
      "created_at": "2026-01-15T08:30:00Z",
      "updated_at": "2026-05-17T14:22:00Z"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 120,
  "totalPages": 3
}
```

### 4.2 생성

```http
POST /api/leads
```

**Required:**
- `customer_name` (string)
- `project_name` (string)

**Optional:**
```json
{
  "customer_id": 5,
  "business_type": "태양광",  // 태양광|모듈|EPC|ESS|전기|설치
  "region": "국내",            // 국내|해외
  "capacity_mw": 30.0,
  "expected_amount": 150.0,
  "currency": "KRW",
  "stage": "lead",
  "assigned_to": 1,
  "expected_close_date": "2026-06-30",
  "bidding_deadline": "2026-05-31",
  "source": "전시회",
  "notes": "추가 정보"
}
```

### 4.3 수정 / 삭제

```http
PUT /api/leads/:id
DELETE /api/leads/:id
```

### 4.4 대량 등록 (Copy & Paste)

```http
POST /api/leads/bulk
```

**Request:**
```json
{
  "rows": [
    { "customer_name": "...", "project_name": "...", "..." },
    { "customer_name": "...", "project_name": "...", "..." }
  ]
}
```

### 4.5 내보내기

```http
GET /api/leads/export?format=xlsx|csv
```

---

## 5. 고객사 API (`/customers`)

### 5.1 목록

```http
GET /api/customers?page=1&limit=50&search=동서&region=국내&industry=에너지
```

### 5.2 생성

```http
POST /api/customers
```

**Body:**
```json
{
  "name": "한국동서발전",
  "region": "국내",
  "country": "대한민국",
  "industry": "에너지",
  "contact_person": "박팀장",
  "phone": "02-1234-5678",
  "email": "contact@example.com",
  "address": "서울특별시 중구 ...",
  "notes": "주력 고객"
}
```

| Method | Path | 설명 |
|--------|------|------|
| PUT | `/customers/:id` | 수정 |
| DELETE | `/customers/:id` | 삭제 |
| POST | `/customers/bulk` | 대량 등록 |
| GET | `/customers/export` | 내보내기 |

---

## 6. 프로젝트 API (`/projects`)

### 6.1 목록

```http
GET /api/projects?status=진행중&search=...
```

### 6.2 생성

```http
POST /api/projects
```

**Body:**
```json
{
  "name": "프로젝트명",
  "customer_id": 5,
  "customer_name": "...",
  "project_type": "EPC",
  "contract_amount": 150.0,
  "estimated_cost": 120.0,
  "margin_pct": 20.0,  // 자동 계산
  "status": "진행중",   // 진행중|제조중|납기지연|완료|취소
  "due_date": "2026-12-31",
  "assigned_to": 1,
  "lead_id": 101
}
```

---

## 7. 활동 이력 API (`/activities`)

### 7.1 목록

```http
GET /api/activities?lead_id=101&project_id=10
```

### 7.2 생성

```http
POST /api/activities
```

**Body:**
```json
{
  "lead_id": 101,
  "project_id": null,
  "activity_type": "미팅",  // 미팅|전화|이메일|제안서|입찰|수주|드롭|기타
  "title": "킥오프 미팅",
  "content": "주요 요구사항 논의 ...",
  "performed_by": 1,
  "performed_at": "2026-05-17T14:00:00Z",
  "calendar_event_id": null
}
```

### 7.3 캘린더 후보 조회

```http
GET /api/activities/:id/calendar-candidates
```

### 7.4 자동 일정화

```http
POST /api/activities/auto-link
```

---

## 8. 캘린더 API (`/calendar`)

### 8.1 이벤트 목록

```http
GET /api/calendar/events?start=2026-05-01&end=2026-05-31&assigned_to=1
```

### 8.2 이벤트 생성

```http
POST /api/calendar/events
```

**Body:**
```json
{
  "title": "고객 미팅",
  "description": "...",
  "start_datetime": "2026-05-17T14:00:00Z",
  "end_datetime": "2026-05-17T15:00:00Z",
  "all_day": false,
  "event_type": "meeting",
  "lead_id": 101,
  "assigned_to": 1,
  "color": "#1a73e8",
  "recurrence": null
}
```

| Method | Path | 설명 |
|--------|------|------|
| GET | `/calendar/events/:id` | 상세 |
| PUT | `/calendar/events/:id` | 수정 |
| DELETE | `/calendar/events/:id` | 삭제 |

---

## 9. 회의록 / STT API (`/meetings`)

### 9.1 동기 STT (짧은 녹음, ~20분)

```http
POST /api/meetings/transcribe
Content-Type: multipart/form-data

audio: <File>  # MP3/WAV/M4A/WEBM/OGG, 최대 25MB
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transcript": "회의 텍스트...",
    "speakers": [
      { "speaker": "스피커1", "text": "..." }
    ],
    "duration_sec": 1245
  }
}
```

### 9.2 비동기 STT (긴 녹음, 20~120분)

```http
POST /api/meetings/transcribe-async
Content-Type: multipart/form-data

audio: <File>
```

**Response (즉시 반환):**
```json
{
  "success": true,
  "data": {
    "jobId": "stt_job_xyz789",
    "status": "processing"
  }
}
```

### 9.3 작업 상태 폴링

```http
GET /api/meetings/transcribe-status/:jobId
```

**Response (진행 중):**
```json
{
  "success": true,
  "data": {
    "jobId": "stt_job_xyz789",
    "status": "processing"
  }
}
```

**Response (완료):**
```json
{
  "success": true,
  "data": {
    "jobId": "stt_job_xyz789",
    "status": "completed",
    "transcript": "...",
    "speakers": [ /* ... */ ],
    "duration_sec": 5400
  }
}
```

### 9.4 회의록 저장

```http
POST /api/meetings
```

**Body:**
```json
{
  "title": "5월 17일 영업 미팅",
  "meeting_date": "2026-05-17",
  "raw_transcript": "...",
  "speakers_json": [ /* ... */ ],
  "summary_md": "## 핵심 내용\n- ...",
  "action_items": "...",
  "customer_name": "...",
  "lead_id": 101,
  "calendar_event_id": null
}
```

| Method | Path | 설명 |
|--------|------|------|
| GET | `/meetings` | 회의록 목록 |
| GET | `/meetings/:id` | 상세 |
| PUT | `/meetings/:id` | 수정 |
| DELETE | `/meetings/:id` | 삭제 |

---

## 10. AI API (`/ai`)

### 10.1 챗봇 (스트리밍 SSE)

```http
POST /api/ai/chat
Content-Type: application/json
Accept: text/event-stream
```

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "이번 분기 입찰 마감 임박 리드 알려줘" }
  ]
}
```

**Response (text/event-stream):**
```
data: {"text":"이번 분기"}

data: {"text":"에 입찰 마감이"}

data: {"text":" 임박한 리드는 ..."}

data: [DONE]
```

**자동 주입 컨텍스트:**
- 활성 리드 수 / 입찰 진행 / 올해 수주
- 최근 주요 리드 5건
- 긴박한 입찰 일정

### 10.2 고객사 AI 브리핑

```http
GET /api/ai/briefing/:customerId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "briefing_md": "## 한국동서발전 브리핑\n\n### 진행 중인 리드\n- ...\n\n### 추천 액션\n- ...",
    "generated_at": "2026-05-17T15:00:00Z",
    "model": "gemini-2.5-pro"
  }
}
```

### 10.3 토큰 사용량 확인

```http
GET /api/ai/token-usage
```

**Response:**
```json
{
  "success": true,
  "data": {
    "month_used": 125000,
    "month_limit": 500000,
    "usage_pct": 25.0,
    "auto_recharge_enabled": true
  }
}
```

---

## 11. Google 연동 API (`/google`)

### 11.1 OAuth 시작

```http
GET /api/google/auth
```

→ Google OAuth 동의 화면으로 리다이렉트

### 11.2 OAuth 콜백

```http
GET /api/google/callback?code=<authorization_code>&state=<state>
```

→ 팝업 자동 닫힘 + 부모 창에 postMessage

### 11.3 연결 상태

```http
GET /api/google/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "google_email": "user@gmail.com"
  }
}
```

### 11.4 연결 해제

```http
POST /api/google/disconnect
```

### 11.5 Google Meet 링크 생성

```http
POST /api/google/calendar/create
```

**Body:**
```json
{
  "title": "영업 미팅",
  "scheduled_at": "2026-05-18T10:00:00Z",
  "duration_min": 60
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "google_event_id": "...",
    "meet_link": "https://meet.google.com/abc-defg-hij",
    "session_id": 42
  }
}
```

---

## 12. Gmail 통합 API (`/gmail`) — G1/G2/G3

### 12.1 Scope 보유 확인 (G1)

```http
GET /api/gmail/scope-status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "hasGmailScope": true,
    "google_email": "user@gmail.com"
  }
}
```

### 12.2 메시지 조회 (G1)

```http
GET /api/gmail/messages?email=contact@example.com&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "msg_id",
      "threadId": "thread_id",
      "from": "박팀장 <contact@example.com>",
      "to": "user@gmail.com",
      "subject": "재견적 요청",
      "snippet": "...",
      "date": "2026-05-17T10:00:00Z",
      "direction": "inbound",
      "gmail_url": "https://mail.google.com/mail/u/0/#all/thread_id"
    }
  ],
  "count": 5,
  "email": "contact@example.com"
}
```

### 12.3 리드 / 고객 자동 매칭 (G1)

```http
GET /api/gmail/match/lead/:id?limit=10
GET /api/gmail/match/customer/:id?limit=10
```

**Response (이메일 없음):**
```json
{
  "success": true,
  "data": [],
  "count": 0,
  "reason": "no_contact_email",
  "message": "고객 담당자 이메일이 등록되어 있지 않습니다"
}
```

### 12.4 Gmail 발송 (G2)

```http
POST /api/gmail/send
```

**Body:**
```json
{
  "to": "contact@example.com",
  "subject": "재견적서 송부드립니다",
  "body": "안녕하세요 ...",
  "cc": "team@oci.co.kr",   // 선택
  "bcc": null                // 선택
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message_id": "...",
    "thread_id": "...",
    "from": "user@gmail.com"
  }
}
```

### 12.5 동기화 설정 (G3)

```http
GET /api/gmail/sync-settings
PUT /api/gmail/sync-settings
POST /api/gmail/sync-now
```

**PUT Body:**
```json
{ "enabled": true }
```

**POST /sync-now Response:**
```json
{
  "success": true,
  "data": {
    "matched": 3,
    "inserted": 2,
    "skipped": 1,
    "error": null
  }
}
```

---

## 13. 관리자 API (`/admin`)

> ⚠️ 모든 `/admin/*` 경로는 권한 레벨 3 (executive) 이상 필요. 일부는 레벨 4 (admin) 이상.

### 13.1 사용자 / 팀원

| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | `/admin/users` | 3 | 사용자 목록 |
| GET | `/admin/team-stats` | 3 | 팀원 현황 |
| GET | `/admin/team-members` | 4 | 팀원 관리 |
| PATCH | `/admin/team-members/:id/token-limit` | 4 | 토큰 한도 설정 |

### 13.2 토큰 모니터링

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/token-usage-by-user` | 사용자별 토큰 사용량 |
| GET | `/admin/token-monitor` | 실시간 모니터링 |
| PUT | `/admin/token-recharge-settings/:id` | 자동충전 설정 |
| POST | `/admin/token-recharge/:id` | 수동 충전 |

### 13.3 시스템 통계 / 로그

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/stats` | 시스템 통계 |
| GET | `/admin/access-logs` | API 호출 로그 |
| GET | `/admin/daily-logs` | 일별 통계 |
| GET | `/admin/top-paths` | 인기 엔드포인트 |
| DELETE | `/admin/access-logs` | 로그 삭제 |

### 13.4 시스템 설정

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/settings` | 설정 조회 |
| PUT | `/admin/settings` | 설정 수정 |

---

## 14. 다국어 라벨 API (`/admin/labels`)

### 14.1 공개 조회

```http
GET /api/labels?locale=ko  # 모든 인증 사용자
```

### 14.2 관리자 전용

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/labels?locale=ko` | 전체 라벨 |
| GET | `/admin/labels/scope/:scope` | 특정 scope |
| PUT | `/admin/labels` | 일괄 저장 |
| PUT | `/admin/labels/:scope/:key` | 단건 저장 |
| POST | `/admin/labels/reset` | 초기화 |
| GET | `/admin/labels/audit` | 변경 이력 |
| GET | `/admin/labels/locales` | 지원 언어 |
| PUT | `/admin/labels/system-locale` | 기본 언어 변경 |

### 14.3 단건 저장 예시

```http
PUT /api/admin/labels/leads/expected_amount
```

**Body:**
```json
{
  "ko": "예상 수주액",
  "en": "Expected Award",
  "ja": "予想受注額",
  "zh": "预期中标额"
}
```

---

## 15. 알림 / 검색 / 게시판

### 15.1 알림

```http
GET /api/notifications
GET /api/notifications?extended=true  # 30일 확장
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overdue": [ /* 마감 초과 리드 */ ],
    "bidding_deadline": [ /* 입찰 마감 임박 */ ],
    "close_deadline": [ /* 마감 임박 */ ],
    "project_due": [ /* 납기 임박 */ ],
    "today_events": [ /* 오늘 일정 */ ]
  }
}
```

### 15.2 글로벌 검색 (`Cmd+K`)

```http
GET /api/search?q=한국동서발전&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": {
    "leads": [ /* ... */ ],
    "customers": [ /* ... */ ],
    "projects": [ /* ... */ ],
    "meetings": [ /* ... */ ],
    "activities": [ /* ... */ ]
  }
}
```

### 15.3 게시판

| Method | Path | 설명 |
|--------|------|------|
| GET | `/board` | 인덱스 (공지+FAQ 메타) |
| GET | `/board/announcements` | 공지 목록 |
| POST | `/board/announcements` | 공지 생성 |
| PUT | `/board/announcements/:id` | 공지 수정 |
| DELETE | `/board/announcements/:id` | 공지 삭제 |
| GET | `/board/faq` | FAQ 목록 |
| POST | `/board/faq` | FAQ 생성 |
| GET | `/board/comments?ref_type=lead&ref_id=101` | 댓글 조회 |
| POST | `/board/comments` | 댓글 작성 |

---

## 16. WebSocket 이벤트

### 16.1 연결

```javascript
const ws = new WebSocket(`wss://<domain>/?token=${JWT_TOKEN}`);
```

**미인증 시:** 즉시 종료 (코드 4001)

### 16.2 헬스맵 구독 (관리자)

**Client → Server:**
```json
{ "type": "healthmap-subscribe" }
```

**Server → Client (1초 간격):**
```json
{
  "type": "healthmap-snapshot",
  "data": {
    "cpu": 23.5,
    "memory": 1024,
    "db_connections": 5,
    "ws_clients": 3
  }
}
```

### 16.3 공지사항 푸시 (자동)

**Server → All Clients:**
```json
{
  "type": "announcement",
  "id": 42,
  "title": "시스템 점검 안내",
  "preview": "5월 18일 새벽 2~4시 점검 예정...",
  "is_pinned": true,
  "author": "관리자"
}
```

---

## 📎 부록: 에러 코드 참조

| Code | 설명 |
|------|------|
| `VALIDATION_ERROR` | 필수 필드 누락 또는 형식 오류 |
| `AUTH_FAILED` | 로그인 실패 (ID/PW 불일치) |
| `TOKEN_EXPIRED` | Access Token 만료 |
| `TOKEN_INVALID` | Token 서명 불일치 |
| `PERMISSION_DENIED` | RBAC 권한 부족 |
| `NOT_FOUND` | 리소스 없음 |
| `DUPLICATE_KEY` | 중복 제약 위반 |
| `RATE_LIMIT` | 요청 횟수 초과 |
| `API_KEY_INVALID` | 외부 API 키 (Gemini) 무효 |
| `OAUTH_INVALID_GRANT` | Google OAuth 토큰 만료/회수 |
| `DB_DISCONNECTED` | DB 연결 끊김 |

---

## 📎 부록: 라우트 전체 맵 (27개 파일)

| 라우트 파일 | 주요 Prefix | 엔드포인트 수 |
|------------|------------|--------------|
| auth.js | `/auth` | 8 |
| dashboard.js | `/dashboard` | 5 |
| leads.js | `/leads` | 7 |
| customers.js | `/customers` | 6 |
| projects.js | `/projects` | 5 |
| activities.js | `/activities` | 7 |
| notifications.js | `/notifications` | 2 |
| calendar.js | `/calendar` | 5 |
| meetings.js | `/meetings` | 7 |
| ai.js | `/ai` | 4 |
| google.js | `/google` | 6 |
| gmail.js | `/gmail` | 9 |
| products.js | `/products` | 5 |
| admin.js | `/admin` | 14 |
| admin-labels.js | `/admin/labels`, `/labels` | 8 |
| board.js | `/board` | 9 |
| search.js | `/search` | 1 |
| team.js | `/team` | 2 |
| healthmap.js | `/healthmap` | 2 |
| pipeline-stages.js | `/pipeline-stages` | 1 |
| menu-config.js | `/menu-config` | 1 |
| schema-export.js | `/schema-export` | 1 |
| email-templates.js | `/email-templates` | 2 |
| webhooks.js | `/webhooks` | 3 |
| exchange.js | `/exchange` | (예약) |
| logo.js | `/system/logo`, `/admin/logo` | 3 |
| report-builder.js | `/report-builder` | 7 |

> 총 **100+ 엔드포인트** 제공

---

# 🆕 v5.0 추가 엔드포인트

## 17. 로고 관리 API

### 17.1 현재 로고 조회 (Public)
```http
GET /api/system/logo
```
응답: `{ url, is_custom }`

### 17.2 로고 업로드 (admin 4+)
```http
POST /api/admin/logo/upload
Content-Type: multipart/form-data
logo: <File>  # PNG/JPG/SVG, 2MB
```
**자동 최적화 결과**:
```json
{
  "success": true,
  "data": {
    "url": "/uploads/logos/logo-1779030773885.png",
    "optimization": {
      "original_size": 1745920,
      "optimized_size": 234567,
      "savings_percent": 86,
      "type": "raster",
      "width": 600, "height": 165,
      "trimmed": true
    }
  }
}
```

### 17.3 기본 로고로 복원
```http
DELETE /api/admin/logo
```

---

## 18. 리포트 빌더 API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/report-builder/fields` | 필드 카탈로그 (차원 8 + 지표 4) |
| POST | `/report-builder/query` | 리포트 실행 (config_json 기반) |
| GET | `/report-builder/saved` | 본인 저장 리포트 목록 |
| GET | `/report-builder/saved/:id` | 단건 조회 |
| POST | `/report-builder/saved` | 신규 저장 |
| PUT | `/report-builder/saved/:id` | 수정 |
| DELETE | `/report-builder/saved/:id` | 삭제 |

**Query Body**:
```json
{
  "datasource": "leads",
  "rows": ["stage"],
  "columns": ["region"],
  "filters": [{ "field": "business_type", "op": "eq", "value": "EPC" }],
  "measures": ["count", "sum_expected_amount"],
  "chartType": "auto"
}
```

---

## 19. 기능 플래그 / Preset API (superadmin)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/dev/presets` | 패키지 목록 (Minimal/Standard/Premium) |
| GET | `/admin/dev/presets/:key/preview` | 적용 시 변경 사항 미리보기 |
| POST | `/admin/dev/presets/:key/apply` | 일괄 적용 + audit log |
| GET | `/admin/dev/features/audit?limit=100` | 변경 이력 조회 |
| PUT | `/admin/dev/features/:key?force=1` | 토글 변경 (force=1: 의존성 강제) |
| DELETE | `/admin/dev/features/:key` | Deprecated 토글 정리 |

### 의존성 충돌 응답 (409)
```json
{
  "success": false,
  "error": "이 기능에 의존하는 다른 활성 기능이 있습니다",
  "dependents": [{ "key": "gmail.send", "name": "Gmail 발송" }],
  "hint": "강제 진행하려면 ?force=1"
}
```

---

## 20. 견적서 API (`/quotes`)

> 자동 채번 (`Q-YYYY-NNNN`), Combobox 영업리드 연결, 부가세 토글, PDF 미리보기/다운로드, 리비전 트리 지원.

### 20.1 목록 / 생성 / 수정 / 삭제
- `GET    /api/quotes?status=&search=&page=&pageSize=`
- `POST   /api/quotes` — body: `{ name, customer_name, lead_id?, quote_items[], vat_included, supplier_info?, customer_info?, ... }`
- `PUT    /api/quotes/:id`
- `DELETE /api/quotes/:id`

### 20.2 채번 + 리비전 + 상태
- `GET   /api/quotes/next-quote-no?year=YYYY` — 다음 자동 채번 미리보기
- `POST  /api/quotes/:id/revisions` — 리비전 생성
- `GET   /api/quotes/:id/revisions` — 리비전 트리 조회
- `PATCH /api/quotes/:id/status` — 상태 전환 (draft/review/sent/accepted/rejected)

---

## 21. 제안 API (`/proposals`)

> 자동 채번 (`P-YYYY-NNNN`), 4-탭 모달 (기본+RFP / AI / 자료+견적 / 발송+이력), AI 제안전략 + 평가 + Gmail 발송 + 공유 링크 통합.

### 21.1 CRUD + 채번 + 상태
- `GET    /api/proposals?status=&search=&page=&pageSize=&due_soon=`
- `GET    /api/proposals/:id` — 상세 (files, revisions, history, email_logs 포함)
- `POST   /api/proposals` — `{ proposal_title, customer_name, proposal_date, lead_id?, quote_id?, ... }`
- `PUT    /api/proposals/:id` — `ai_strategy_md` 저장 시 `ai_strategy_generated_at` 자동 갱신
- `PATCH  /api/proposals/:id/status` — draft/review/ready/sent/accepted/rejected/expired
- `DELETE /api/proposals/:id` — CASCADE (files/revisions/history/email_logs/evaluations 자동 삭제)
- `GET    /api/proposals/next-proposal-no?year=YYYY`

### 21.2 파일 업로드 (다중 + 드롭존)

`multipart/fields` — `file` (단일, 호환) 또는 `files[]` (다중, Phase 4-B).

- `POST   /api/proposals/:id/rfp` — RFP 파일 + 메타 (rfp_title/rfp_received_date/rfp_due_date)
- `POST   /api/proposals/:id/files` — 일반 자료 (file_type/revision_no/is_final/include_in_email)
- `GET    /api/proposals/:id/files/:fileId/download`
- `DELETE /api/proposals/:id/files/:fileId`

**응답 형식 (다중 지원):**
```json
{
  "success": true,
  "data": {
    "uploaded": [{ "id": 1, "original_filename": "...", "file_size": 1024 }],
    "failed": [{ "original_filename": "x.exe", "error": "허용되지 않은 확장자" }]
  }
}
```

**허용 형식:** pdf, ppt, pptx, doc, docx, xls, xlsx, png, jpg, jpeg, hwp, hwpx (파일당 100MB)

### 21.3 리비전
- `POST  /api/proposals/:id/revisions` — `{ title, description }` → version_no 자동 증가

### 21.4 🤖 AI RFP 분석 (Phase 4-A → Phase 8-A → Phase 9-1 확장)
- `POST  /api/proposals/:id/rfp/analyze` — `{ file_id }`

Gemini 2.5 Pro Multimodal — 호환 형식 (PDF/이미지/텍스트) 만 분석.

**응답 (Phase 9-1 — 고객사/제안 기본정보 + 6섹션 마크다운):**
```json
{
  "success": true,
  "data": {
    "rfp_title": "...",
    "rfp_received_date": "YYYY-MM-DD",
    "rfp_due_date": "YYYY-MM-DD",
    "rfp_summary": "...",
    "customer_name": "(주)NICE피앤아이",
    "proposal_title": "(주)NICE피앤아이 CRM 솔루션 구축 제안서",
    "expected_amount": 50000000,
    "currency": "KRW",
    "ai_strategy_md": "## 제안 목표\n...\n## 제안 주요 일정\n...\n## 제안 핵심사항\n...\n## 제안 준비사항 (체크리스트)\n- [ ] ...\n## 예상 리스크\n...\n## 독소조항과 회피방안\n..."
  }
}
```

**Phase 8-A + Phase 9-1 신규 필드:**
- `customer_name` (string, max 200자): 발주처/고객사명 자동 추출 (Phase 9-1 신규)
- `proposal_title` (string, max 300자): 제안서 제목 자동 생성
- `expected_amount` (number|null): RFP 예산/추정 금액 (0 이상)
- `currency` (string): 'KRW' / 'USD' / 'EUR' / 'JPY' / 'CNY' — 기본 'KRW'
- `ai_strategy_md`: 6섹션 마크다운 (제안목표/주요일정/핵심사항/준비사항/예상리스크/독소조항)

⚠️ DB 자동 저장 X — 클라이언트가 검토 후 `PUT /:id` 로 별도 반영.

### 21.5 📊 AI 제안서 평가 (Phase 6-B → Phase 8-B 확장)
- `POST  /api/proposals/:id/evaluate` — `{ proposal_file_id }`
- `GET   /api/proposals/:id/evaluations` — 평가 이력 50건

RFP 자동 선택 (`file_type='rfp'` + 호환 형식 첫 파일). Gemini Pro 가 RFP + 제안서 동시 분석.

**응답 (Phase 8-B — 수주확률 + 정성 메트릭 + 승리/리스크 요인):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "coverage_score": 78,
    "covered_count": 12,
    "missing_count": 3,
    "covered_items": [{ "requirement": "...", "evidence": "..." }],
    "missing_items": [
      { "requirement": "...", "severity": "high|medium|low", "suggestion": "..." }
    ],
    "improvement_suggestions": [{ "section": "...", "suggestion": "..." }],
    "overall_assessment": "## 1. 종합 평가...",
    "win_probability": 72,
    "quality_metrics": {
      "clarity": 8,
      "completeness": 7,
      "differentiation": 6,
      "feasibility": 9,
      "price_competitiveness": 5
    },
    "win_factors": ["강력한 레퍼런스", "빠른 납기", "24/7 SLA"],
    "risk_factors": ["가격 경쟁력 부족", "인증 부족"],
    "target_filename": "proposal_v1.pdf",
    "rfp_filename": "rfp_doc.pdf"
  }
}
```

**Phase 8-B 신규 필드:**
- `win_probability` (number 0-100): 예상 수주확률 (%)
- `quality_metrics` (object, 각 0-10): 정성 평가 5종
  - `clarity` 명확성 / `completeness` 완결성 / `differentiation` 차별성
  - `feasibility` 실현가능성 / `price_competitiveness` 가격경쟁력
- `win_factors` (string[], 최대 5건): 승리 요인 (각 100자 이내)
- `risk_factors` (string[], 최대 5건): 리스크 요인 (각 100자 이내)

### 21.6 📄 AI 제안전략 Word(.docx) 다운로드 (Phase 9-3)
- `GET  /api/proposals/:id/ai-strategy/word`

`ai_strategy_md` 의 6섹션 markdown 을 docx 파일로 변환해 다운로드.

**응답:**
- 정상 (200): docx 파일 binary stream
  - `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...` (한글 파일명 RFC 5987)
  - 파일명 형식: `[proposal_no]_AI제안전략요약_YYYYMMDD.docx`
- 400: `ai_strategy_md` 비어있음
- 404: proposal 없음

**docx 변환 규칙:**
- 표지: 제안번호 / 제안명 / 고객사 / 최근 AI 분석 일시
- `## 제목` → Heading 2 (bold, size 28pt)
- `### 부제목` → Heading 3 (bold, size 24pt)
- `- [ ]` / `- [x]` → 체크박스 (☐ / ☑)
- `- 항목` → 불릿 리스트
- `1. 항목` → 번호 리스트
- 일반 텍스트 → 문단 (size 22pt)
- 기본 폰트: 맑은 고딕 (한국어 안전)

### 21.7 📨 이메일 발송 (Phase 5-B, Gmail OAuth 필요)
- `POST  /api/proposals/:id/email/send`
- body: `{ to, cc?, subject, body, file_ids?: number[] }`
- 첨부 합계 25MB 한도 + 파일 소유 검증
- `proposal_email_logs` 자동 기록 (sent/failed 상태)

### 21.8 🔗 공유 링크 (Phase 5-C)
- `POST  /api/proposals/:id/share` — `{ expires_days? = 7 }` (0/음수 = 무제한)
- `DELETE /api/proposals/:id/share` — 무효화

**외부 접근 (인증 우회):**
- `GET   /api/proposals/share/:token` — 최소 정보 노출 (제목/고객/RFP 요약/`include_in_email=1` 파일만)
- `GET   /api/proposals/share/:token/files/:fileId/download`
- 만료 시 410 Gone

### 21.9 응답 / 에러 코드
| 코드 | 의미 |
|------|------|
| 400 | 필수값 누락 / 비호환 파일 형식 / 25MB 초과 / 잘못된 file_id |
| 401 | 인증 필요 |
| 403 | Gmail 권한 부족 (OAuth scope 미보유) |
| 404 | 제안/파일/토큰 없음 |
| 410 | 공유 링크 만료 (Gone) |
| 500 | Gemini API 호출 실패 / 서버 오류 |

### 21.10 history action_types
`create` / `update` / `status_change` / `rfp_upload` / `file_upload` / `file_download` / `file_delete` / `revision_create` / `ai_analyze` / `evaluate` / `email_send` / `share_create` / `share_revoke` / `share_view` / `share_download`

---

## 22-A. 계약 API (`/contracts`) — Contract Phase 0 (v5.9.0)

**기능 플래그**: `crm.contracts`
**권한**: manager+ (기본 CRUD), team_lead+ (확장 — Phase 2+)
**테이블**: contracts, contract_files, contract_history, contract_templates, contract_legal_reviews, contract_alerts (자가 마이그레이션)

### 22-A.1 GET `/contracts/next-contract-no`

다음 자동 채번 미리보기 (C-YYYY-NNNN).

**Query**:
- `year` (선택): 기본 현재 연도

**Response**:
```json
{ "success": true, "data": { "contract_no": "C-2026-0042", "year": 2026 } }
```

### 22-A.2 GET `/contracts`

목록 조회 (검색/필터/페이징).

**Query**:
- `search`: 계약번호/제목/고객사
- `status`: draft | review | negotiation | signing | active | renewal | expired | terminated
- `contract_type`: NDA | MSA | SLA | SOW | service | purchase | license | employment | etc
- `customer_id` / `proposal_id` / `lead_id`: 연결 ID
- `date_from` / `date_to`: 시작일 범위
- `expiring_soon=1`: 30일 이내 만료 (status=active 만)
- `page` / `limit`: 페이징

**Response**: `{ success, data: [...], pagination: { total, page, limit, totalPages } }`

### 22-A.3 GET `/contracts/:id`

단건 + 파일/이력 포함.

**Response**:
```json
{ "success": true, "data": {
  "id": 1, "contract_no": "C-2026-0001", "title": "A사 NDA",
  "customer_name": "A사", "contract_type": "NDA", "status": "draft",
  "start_date": "2026-05-23", "end_date": "2027-05-22",
  "contract_amount": 30000000, "currency": "KRW",
  "files": [...], "history": [...]
}}
```

### 22-A.4 POST `/contracts`

생성. `proposal_id` 전달 시 customer_id/customer_name/expected_amount/currency 자동 반영.

**Body** (필수: title):
```json
{ "title": "A사 NDA 계약", "customer_name": "A사", "contract_type": "NDA",
  "start_date": "2026-05-23", "end_date": "2027-05-22",
  "contract_amount": 30000000, "currency": "KRW",
  "auto_renewal": true, "renewal_notice_days": 60,
  "proposal_id": 42 }
```

**Response**: `{ success, id, data: { id, contract_no } }`

### 22-A.5 PUT `/contracts/:id`

수정. 변경된 필드만 history 에 diff 자동 기록 (field_name/old_value/new_value).

**허용 필드**: title, customer_id, customer_name, proposal_id, lead_id,
contract_type, status, start_date, end_date, contract_amount, currency,
language, auto_renewal, renewal_notice_days, template_id, version_no,
parent_contract_id, owner_id, owner_name, notes

### 22-A.6 DELETE `/contracts/:id`

CASCADE 삭제 (파일 디스크 + history 자동 정리).

### 22-A.7 POST `/contracts/:id/files`

다중 파일 업로드 (FormData).

**FormData**:
- `files[]`: 다중 파일 (또는 `file` 단일)
- `file_type`: contract | draft | signed | amendment | attachment | etc (기본 contract)
- `version_no`, `is_final`, `description` (선택)

**제한**: 100MB/파일, 확장자 pdf/ppt/doc/xls/hwp/png/jpg/jpeg/txt/md

**Response**: `{ success, data: { uploaded: [...], failed: [...] } }`

### 22-A.8 GET `/contracts/:id/files/:fileId/download`

파일 다운로드 (Content-Disposition: attachment).

### 22-A.9 DELETE `/contracts/:id/files/:fileId`

파일 삭제 (디스크 + DB row + history 기록).

### 22-A.10 history action_types
**Phase 0**: `create` / `update` / `status_change` / `file_upload` / `file_delete`
**Phase 1** (v5.9.2): `status_change` 강화 — description 에 한글 라벨 + 이모지 (`✅ 발효 / 🔄 갱신 / ⏰ 만료 / ❌ 해지`)
**Phase 2** (v5.9.1): `legal_review` — AI 법무 검토 실행 시 자동 기록
**Phase 3** (v5.9.3): `template_apply` — 템플릿 기반 계약 생성 시 자동 기록 (description: `템플릿 적용: ⃝⃝ (STD-NDA) — C-2026-NNNN`)
**Phase 4** (v5.9.4): 알림 이력은 별도 `contract_alerts` 테이블에 영속 (history 와 분리). cron 처리 결과는 서버 로그 (`[contractAlerts] 처리: N건`)
**Phase 5** (v5.9.5): `negotiation_coach` — ❌ v6.0.0 에서 제거됨
**Phase 6** (v5.9.6): `translate` — ❌ v6.0.0 에서 제거됨
**v6.0.0** (2026.05.24): 4단계 상태로 슬림화 — `negotiation_coach`/`translate` 액션 제거, 기존 `status_change` 만 유지

---

## ⚠️ v6.0.0 슬림화 — 제거된 endpoint (아래 22-A.16 ~ 22-A.19 는 모두 제거됨)

| 구 endpoint | 상태 | 비고 |
|------------|:----:|------|
| `GET /contracts/templates` 외 (계약 템플릿 CRUD) | ❌ | `contract_templates` 테이블 DROP |
| `POST /contracts/from-template/:id` | ❌ | 변수 치환 + 자동 생성 제거 |
| `GET /contracts/:id/alerts` 외 (만료 알림 큐) | ❌ | `contract_alerts` 테이블 DROP |
| `POST /contracts/:id/negotiation-coach` 외 (AI 협상 코칭) | ❌ | `contract_negotiation_coaches` 테이블 DROP |
| `POST /contracts/:id/files/:fileId/translate` 외 (다국어 번역) | ❌ | `contract_translations` 테이블 DROP |

신규: `contracts.quote_id INT NULL` (견적 연결 컬럼)
4단계 상태 (`draft` / `review` / `approved` / `completed`) + 자동 마이그레이션 (서버 부팅 시 1회)

아래 섹션은 참고용으로 유지 — 향후 부활 시 갱신.

---

### 22-A.19 ❌ (제거됨) AI 다국어 번역 (v5.9.6 ~ v5.9.6)

**비용**: 약 500-1500원/회 (Gemini 2.5 Pro)
**소요 시간**: 30-60초
**지원 형식**: PDF / PNG / JPG / WEBP / TXT / MD
**지원 언어**: ko (한국어) / en (English)

#### POST `/contracts/:id/files/:fileId/translate`
AI 번역 실행.

**Request Body**:
```json
{ "target_language": "ko" }
```
- `target_language`: "ko" | "en" (기본 "ko")
- `source_language`: (선택) 원문 언어 힌트 — 미지정 시 Gemini 자동 감지

**자동 동작**:
- Gemini 호출 → detected_language / summary_md / key_clauses / full_translation_md
- `contract_translations` INSERT (target_file_id 로 원본 파일과 연결)
- `contract_history` 에 `translate` 액션 자동 기록

**Response**:
```json
{ "success": true, "data": {
  "id": 7, "target_file_id": 42, "target_filename": "NDA_eng.pdf",
  "target_language": "ko",
  "detected_language": "en",
  "summary_md": "## 1. 계약 개요\n- NDA 양방향\n\n## 2. 주요 당사자 및 의무\n...",
  "key_clauses": [
    {
      "original": "Both parties shall maintain strict confidentiality.",
      "translated": "양 당사자는 엄격한 비밀유지 의무를 부담한다.",
      "section": "비밀유지",
      "importance": "high"
    }
  ],
  "full_translation_md": "## 비밀유지계약서\n\n본 계약은...",
  "generated_at": "2026-05-24T08:30:00.000Z"
}}
```

**에러 응답**:
| HTTP | 사유 |
|------|------|
| 400 | 유효하지 않은 ID |
| 404 | 계약 / 파일 없음 |
| 500 | Gemini API 실패 |

#### GET `/contracts/:id/translations`
번역 이력 조회 (최대 20건).

**Response**:
```json
{ "success": true, "data": [
  { "id": 7, "target_file_id": 42, "target_filename": "NDA_eng.pdf",
    "source_language": null, "target_language": "ko",
    "detected_language": "en", "summary_md": "...",
    "full_translation_md": "...", "key_clauses": [...],
    "generated_by": 1, "generated_by_name": "관리자",
    "generated_at": "2026-05-24T08:30:00.000Z" }
]}
```

#### GET `/contracts/:id` 응답 확장
- `latest_translation` 필드 신규 (없으면 null)
- 모달 재진입 시 자동 prefill

#### 신뢰성 가드 (v5.9.6)
- key_clauses 최대 10개 + importance 3종(high/medium/low) 강제
- summary_md 3000자 / full_translation_md 10000자 clip
- JSON 파싱 fallback (Phase 12-C 패턴 재사용)
- 빈 응답·파싱 실패 시 `_parseError: true` + 친절한 안내문

---

### 22-A.18 AI 협상 코칭 (v5.9.5 — Phase 5)

**비용**: 약 500-1000원/회 (Gemini 2.5 Pro)
**소요 시간**: 30-60초
**전제조건**: 최신 `contract_legal_reviews` 1건 이상 (없으면 400)

#### POST `/contracts/:id/negotiation-coach`
협상 코칭 실행.

**자동 동작**:
- 최신 법무 검토 결과 조회 → toxic_clauses + missing_clauses + legal_compliance 추출
- 과거 유사 계약 조회: 동일 `contract_type` + `contract_amount` ± 30%, 본인 제외, 최대 10건
- Gemini 호출 → priority_clauses / give_take_matrix / similar_contracts_comparison / alternative_clauses / scenarios / overall_strategy
- `contract_negotiation_coaches` INSERT (target_review_id 로 법무 결과와 연결)
- `contract_history` 에 `negotiation_coach` 액션 자동 기록

**Response**:
```json
{ "success": true, "data": {
  "id": 5, "target_review_id": 12,
  "priority_clauses": [
    { "clause": "책임 한계", "priority": 1, "reason": "...", "target_outcome": "..." }
  ],
  "give_take_matrix": {
    "willing_to_concede": ["가격 조정 3-5%", ...],
    "must_protect": ["손해배상 상한", ...]
  },
  "similar_contracts_comparison": {
    "samples_count": 3,
    "avg_amount": 50000000,
    "our_position": "above_avg",
    "gap_analysis": "..."
  },
  "alternative_clauses": [
    { "original": "...", "alternative": "...", "justification": "..." }
  ],
  "scenarios": { "best": "...", "realistic": "...", "worst": "..." },
  "overall_strategy": "## 1. 핵심 메시지...",
  "generated_at": "2026-05-24T08:30:00.000Z"
}}
```

**에러 응답**:
| HTTP | 사유 |
|------|------|
| 400 | "먼저 AI 법무 검토를 실행하세요" |
| 404 | 계약 없음 |
| 500 | Gemini API 실패 |

#### GET `/contracts/:id/negotiation-coaches`
협상 코칭 이력 조회 (최대 20건).

#### GET `/contracts/:id` 응답 확장
- `latest_negotiation_coach` 필드 신규 (없으면 null)
- 모달 재진입 시 자동 prefill

#### 신뢰성 가드 (v5.9.5)
- priority 1-5 강제 (clampPriority)
- our_position 4종 검증 (above_avg/avg/below_avg/no_data)
- JSON 파싱 fallback (Phase 12-C 패턴)
- 과거 계약 조회 실패 시 빈 배열로 진행 (best-effort)

---

### 22-A.17 만료 알림 큐 (v5.9.4 — Phase 4)

**자동 cron**: 매일 09:00 KST 에 `processAlertQueue()` 실행
**2회 알림**: `D-renewal_notice_days` (기본 30) + `D-7` (최종 경고, 중복 시 1건)
**채널**: `inapp` (기본 항상) + `email` (`.env CONTRACT_ALERT_EMAIL_ENABLED=1` 시)

#### GET `/contracts/:id/alerts`
계약별 알림 조회 (pending + sent + cancelled 전체).

**Response**:
```json
{ "success": true, "data": [
  { "id": 1, "contract_id": 42, "alert_type": "notice_30",
    "scheduled_for": "2026-04-25", "sent_at": null,
    "status": "pending", "channel": "inapp",
    "created_at": "2026-03-24T10:00:00.000Z" },
  { "id": 2, "contract_id": 42, "alert_type": "notice_7",
    "scheduled_for": "2026-05-18", "sent_at": null,
    "status": "pending", "channel": "inapp",
    "created_at": "2026-03-24T10:00:00.000Z" }
]}
```

#### DELETE `/contracts/alerts/:alertId`
개별 알림 취소 (pending → cancelled).
- 400: 이미 sent / cancelled 상태인 알림 (취소 불가)
- 404: 알림 없음

#### POST `/contracts/alerts/process`
큐 수동 처리 (cron 트리거 대신, 테스트/admin용).

**Response**:
```json
{ "success": true, "data": {
  "processed": 5,
  "errors": [],
  "total_candidates": 5
}}
```

#### 자동 enqueue/cancel 동작

| 트리거 | 동작 |
|--------|------|
| POST `/contracts` (end_date 있음) | enqueue 2건 |
| POST `/contracts/from-template/:id` (end_date 있음) | enqueue 2건 |
| PUT `/contracts/:id` (end_date 변경) | pending cancel + 재 enqueue |
| PUT `/contracts/:id` (renewal_notice_days 변경) | 재 enqueue |
| PUT `/contracts/:id` (end_date NULL) | pending 모두 cancel |
| PATCH `/contracts/:id/status` (→ terminated/expired) | pending 모두 cancel |

모두 best-effort — 알림 실패해도 계약 작업 성공.

#### 환경변수
- `CONTRACT_ALERT_EMAIL_ENABLED=0|1` (기본 0)
  - 1 일 때 계약 owner 의 Gmail OAuth 토큰 사용 → 자가 알림 발송
  - 토큰 미연동 시 skip (in-app 만)

---

### 22-A.16 계약 템플릿 라이브러리 (v5.9.3 — Phase 3)

**시드 5종** (서버 부팅 시 자동 등록): `STD-NDA` / `STD-MSA` / `STD-SLA` / `STD-SOW` / `STD-SERVICE`
**시드 보호**: `template_code` 가 `STD-` 로 시작하면 DELETE 403 / 신규 생성 시 거부 (USR- 접두 자동 채번)

#### GET `/contracts/templates`
목록 조회 (활성/유형 필터).

**Query**:
- `contract_type` (선택): NDA / MSA / SLA / SOW / service / etc 등
- `is_active` (선택): `1` / `0`

**Response**:
```json
{ "success": true, "data": [
  { "id": 1, "template_code": "STD-NDA", "name": "NDA — 비밀유지계약서 (표준)",
    "contract_type": "NDA", "language": "ko",
    "variables": [{ "name": "을_회사명", "label": "을(고객사) 상호", "type": "text", "required": true, "autofill": "customer_name" }, ...],
    "is_seed": true, "is_active": 1, "version_no": 1, "created_at": "..." },
  ...
]}
```

#### GET `/contracts/templates/:templateId`
단건 조회 (`body_md` + `variables` 포함).

#### POST `/contracts/templates`
신규 사용자 템플릿 생성. `template_code` 미지정 시 `USR-{timestamp}` 자동.

**Body** (필수: `name`, `body_md`):
```json
{
  "name": "우리회사 NDA (커스텀)",
  "contract_type": "NDA",
  "language": "ko",
  "body_md": "# 비밀유지계약서\n...{{회사명}}...",
  "variables": [{ "name": "회사명", "label": "회사명", "type": "text", "required": true }]
}
```

**에러**:
- 400: `template_code` 가 `STD-` 로 시작 (시드 예약)
- 409: `template_code` 중복

#### PUT `/contracts/templates/:templateId`
수정. 허용 필드: `name` / `contract_type` / `language` / `body_md` / `is_active` / `variables`.

#### DELETE `/contracts/templates/:templateId`
삭제. **시드 (STD- 접두) 는 403** — 비활성화는 PUT `is_active=0` 사용.

#### POST `/contracts/from-template/:templateId` ⭐ 핵심
변수 치환 + 계약 자동 생성.

**Body**:
```json
{
  "title": "A사 NDA (선택, 미지정 시 자동)",
  "customer_name": "A주식회사",
  "contract_type": "NDA",
  "start_date": "2026-05-23",
  "end_date": "2027-05-22",
  "contract_amount": 30000000,
  "currency": "KRW",
  "variables": {
    "비밀유지_기간_년": 5,
    "갑_회사명": "우리회사 (자동 채움 안 할 때만)"
  }
}
```

**자동 채움 매핑** (`_resolveAutofill`):
- `customer_name` → `{{을_회사명}}`
- `system_settings.supplier_company_name` → `{{갑_회사명}}`
- 오늘 → `{{계약일}}`
- `start_date` → `{{시작일}}`, `{{착수일}}`
- `end_date` → `{{종료일}}`, `{{완료일}}`
- `contract_amount` → `{{금액}}`
- `currency` → `{{통화}}`
- 로그인 사용자 → `{{담당자명}}`

**우선순위**: 사용자 입력 `variables[name]` > 자동 채움 > 정의된 default

**Response**:
```json
{ "success": true, "id": 42,
  "data": {
    "id": 42, "contract_no": "C-2026-0042",
    "template_id": 1, "template_code": "STD-NDA",
    "applied_variables": { "을_회사명": "A주식회사", "비밀유지_기간_년": 5, ... }
}}
```

**동시 효과**:
- 새 계약 INSERT (자동 채번 + 변수 치환된 본문은 `notes` 컬럼에 저장)
- `template_id` 컬럼에 사용한 템플릿 id 기록
- `contract_history` 에 `template_apply` 액션 자동 기록

---

### 22-A.15 PATCH `/contracts/:id/status` — CLM 상태 전이 (v5.9.2)

8단계 전이 매트릭스 검증 + 자동 timestamp + history 강조.

**Body** (필수):
```json
{ "status": "review" }
```
허용값: `draft` / `review` / `negotiation` / `signing` / `active` / `renewal` / `expired` / `terminated`

**전이 매트릭스**:
```
draft       → review, terminated
review      → draft, negotiation, terminated
negotiation → review, signing, terminated
signing     → negotiation, active, terminated
active      → renewal, expired, terminated
renewal     → active, expired, terminated
expired     → terminated
terminated  → (없음, 종착점)
```

**Response (성공)**:
```json
{ "success": true,
  "data": {
    "id": 1,
    "from": "signing",
    "to": "active",
    "auto_start_date": "2026-05-23"  // signing→active 시 자동 채움 (있으면)
} }
```

**Response (실패)**:
| HTTP | error 메시지 | 원인 |
|------|-------------|------|
| 400 | "유효한 ID 필요" | id 파싱 실패 |
| 400 | "유효하지 않은 상태값" | ALLOWED_STATUS 외 값 |
| 400 | "이미 ⃝⃝ 상태입니다" | 동일 상태 |
| 400 | "잘못된 전이: A → B (허용: X, Y)" | 매트릭스 위배 |
| 404 | "계약을 찾을 수 없음" | 없는 id |

**자동 동작**:
- `signing → active` 시 `start_date` 가 NULL 이면 오늘로 자동 채움
- 모든 전이는 `contract_history` 에 `status_change` 액션 + 강조 description 기록:
  - `✅ 발효: 서명진행 → 발효 (start_date 자동 채움)`
  - `🔄 갱신 시작: 발효 → 갱신중`
  - `🔄 갱신 완료: 갱신중 → 발효`
  - `⏰ 만료 처리: 발효 → 만료`
  - `❌ 해지 처리: 발효 → 해지`

**하위 호환**:
- PUT `/contracts/:id` 로 status 변경 시 전이 검증 안 함
- 관리자 직접 수정 / 데이터 마이그레이션 등 우회 경로 보존

---

### 22-A.11 POST `/contracts/:id/files/:fileId/legal-review` ⭐⭐⭐ (v5.9.1)

AI 법무 검토 실행 (Gemini 2.5 Pro Multimodal · 한국법 특화).

**비용**: 1회 약 500-1000원 (Gemini Pro API 토큰)
**소요 시간**: 30-60초
**분석 가능 형식**: PDF / PNG / JPG / WEBP / TXT / MD

**Body** (선택):
```json
{ "language": "ko" }
```

**Response**:
```json
{ "success": true, "data": {
  "id": 42,
  "target_file_id": 7,
  "target_filename": "contract_v1.pdf",
  "review_score": 72,
  "risk_level": "medium",
  "toxic_clauses": [
    {
      "clause_type": "책임 한계",
      "severity": "high",
      "location": "제8조 1항",
      "original_text": "본 계약 위반으로 인한 손해배상은 최대 1만원으로...",
      "why_problematic": "손해배상 상한이 비현실적으로 낮음 — 공정거래법 무효 가능성",
      "suggested_fix": "계약금액의 100%를 한도로 한다 로 변경 권장"
    }
  ],
  "missing_clauses": [
    { "clause_type": "비밀유지", "importance": "high",
      "suggested_addition": "양 당사자는 본 계약 수행 중 알게 된 영업 비밀을..." }
  ],
  "legal_compliance": {
    "fair_trade_act": { "compliant": false, "issues": ["손해배상 상한 무효 가능성"] },
    "subcontract_act": { "compliant": true, "issues": [] },
    "privacy_act": { "compliant": true, "issues": [] }
  },
  "improvement_suggestions": [
    { "section": "제8조", "suggestion": "책임 한계 재협상 필요" }
  ],
  "overall_assessment": "## 1. 종합 평가\n- 중간 위험...",
  "generated_at": "2026-05-23T22:00:00.000Z"
}}
```

**동시 효과** (자동):
- `contract_legal_reviews` 테이블에 INSERT (영속)
- `contracts.legal_review_score` / `ai_review_summary` 자동 갱신
- `contract_history` 에 `legal_review` 액션 자동 기록

**에러 응답**:
| HTTP | 사유 |
|------|------|
| 400 | 유효한 ID 누락 |
| 404 | 계약/파일 없음 |
| 500 | Gemini API 키 미설정 / API 호출 실패 / 파일 손상 |

### 22-A.12 GET `/contracts/:id/legal-reviews` (v5.9.1)

검토 이력 조회 (최대 50건).

**Response**:
```json
{ "success": true, "data": [
  { "id": 42, "target_file_id": 7, "target_filename": "contract_v1.pdf",
    "review_score": 72, "risk_level": "medium",
    "toxic_clauses": [...], "missing_clauses": [...],
    "legal_compliance": {...}, "improvement_suggestions": [...],
    "overall_assessment": "...", "language": "ko",
    "generated_by": 1, "generated_by_name": "김매니저",
    "generated_at": "2026-05-23T22:00:00.000Z" },
  ...
]}
```

### 22-A.13 GET `/contracts/:id` — latest_legal_review 확장 (v5.9.1)

기존 단건 조회 응답에 `latest_legal_review` 필드 추가 (모달 재진입 시 prefill 용).

**Response 추가 필드**:
```json
{ "success": true, "data": {
  ...,
  "latest_legal_review": {
    "id": 42, "target_file_id": 7, "target_filename": "contract_v1.pdf",
    "review_score": 72, "risk_level": "medium",
    "toxic_clauses": [...], "missing_clauses": [...],
    "legal_compliance": {...}, "improvement_suggestions": [...],
    "overall_assessment": "...", "language": "ko",
    "generated_at": "2026-05-23T22:00:00.000Z"
  }
}}
```
- 검토 이력 없으면 `null`

### 22-A.14 신뢰성 가드 (v5.9.1)

**risk_level ↔ review_score 일관성 강제** (backend 후처리):
- `review_score < 40` → `risk_level = 'high'` 강제
- `40 ≤ score < 70` → `risk_level = 'medium'`
- `score ≥ 70` → `risk_level = 'low'`
- AI 가 일치하지 않게 반환 시 자동 보정 + 콘솔 `[gemini:analyzeContractLegal] risk_level 보정` 경고 로그

**JSON 파싱 fallback** (Phase 12-C 패턴):
- 1차: JSON.parse(raw text)
- 2차: markdown fence 제거 + 첫/마지막 brace 추출 후 재시도
- 3차 실패 → friendly fallback 응답 (`_parseError: true`, overall_assessment 에 안내 메시지)

---

## 22. 클라이언트 가드 (Circuit Breaker)

`API.gmail.send()` 등 11개 메서드 호출 시 토글 OFF면 즉시 throw:
```javascript
err.code = 'FEATURE_DISABLED';
err.feature = 'gmail.send';
```

네트워크 요청 0건 + 일관된 에러 처리.
