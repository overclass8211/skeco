# 🖋 모두싸인(modusign) 전자서명 통합 설계서

> **목적**: v6.0.0 Step 4 — 계약 모듈에 전자서명 기능 통합
> **공급자**: [모두싸인](https://developers.modusign.co.kr) (국내 표준 전자서명 솔루션)
> **상태**: 📋 사전 설계 단계 (Step 4-1) — 구현은 Step 4-2 이후 사용자 승인 후 진행

---

## 1. 모두싸인 API 개요

### 1-1. 인증 방식 — 2가지 지원
| 방식 | 사용 시점 | 장단점 |
|------|----------|--------|
| **API Key** | 간단한 단일 계정 사용 | 셋업 쉬움, 단점: 모든 문서가 1개 모두싸인 계정 하위로 |
| **OAuth 2.0** ⭐ | 다중 사용자 (각자 본인 계정 사용) | 셋업 복잡, 사용자별 토큰 관리, 본인 명의 서명 정확 |

**권장**: **OAuth 2.0** — 사용자별로 자신의 모두싸인 계정 사용 (Google OAuth 패턴과 동일, 기존 `google_oauth_tokens` 패턴 재사용 가능)

### 1-2. 핵심 API 엔드포인트
| 기능 | 엔드포인트 | 메서드 | 설명 |
|------|----------|:------:|------|
| OAuth 인가 | `/oauth/authorize` | GET | 사용자를 모두싸인 인가 페이지로 redirect |
| Access Token 발급 | `/oauth/token` | POST | 인가 코드 → access_token 교환 |
| Token Refresh | `/oauth/token` | POST | refresh_token 으로 access_token 갱신 |
| **서명 요청 생성** | `/documents/request` | POST | 파일 + 서명자 → 서명 요청 시작 (최대 5MB) |
| 임베디드 서명 | `/documents/{id}/embedded-link` | POST | 우리 페이지에 iframe 으로 서명 |
| 문서 상태 조회 | `/documents/{id}` | GET | 현재 서명 상태 + 서명자별 진행 |
| 서명 완료 PDF | `/documents/{id}/download` | GET | 완료된 서명본 PDF 다운로드 |
| 알림 재전송 | `/documents/{id}/remind` | POST | 미서명자에게 이메일 재전송 |

### 1-3. Webhook (서명 완료 알림)
- **설정**: 모두싸인 관리자 화면 → 설정 → API → Webhook URL 등록
- **이벤트**: `document.signed`, `document.completed`, `document.rejected`, `document.expired` 등
- **요청**: 모두싸인 → 우리 서버 (POST + 이벤트 ID + 문서 ID)
- **운영**: `https://oci-crm.duckdns.org/api/webhooks/modusign` 같은 공개 endpoint 필요
- **보안**: webhook 서명 검증 (`X-Modusign-Signature` 헤더) — 필수 검증

---

## 2. CRM 통합 흐름

```
[사용자]                                  [CRM]                              [모두싸인]
    │                                        │                                    │
    1. 계약 모달 진입 (status=approved)        │                                    │
    │ ─────────────────────────────────────► │                                    │
    │                                        │                                    │
    2. [✍ 전자서명 요청] 클릭                  │                                    │
    │ ─────────────────────────────────────► │                                    │
    │                                        │  3. POST /:id/esign/request        │
    │                                        │ ─────────────────────────────────► │
    │                                        │     (계약서 PDF + 서명자 이메일)       │
    │                                        │ ◄───────────────────────────────── │
    │                                        │     (document_id 반환)              │
    │                                        │                                    │
    │  4. esign_status='requested' 표시        │                                    │
    │ ◄───────────────────────────────────── │                                    │
    │                                        │                                    │
    │                                        │                  (사용자가 이메일 받음) │
    │                                        │                                    │
    │                                        │  5. webhook (document.signed)        │
    │                                        │ ◄───────────────────────────────── │
    │                                        │  6. esign_status='signed' 갱신        │
    │                                        │     contracts.esign_signed_at 저장   │
    │                                        │                                    │
    7. 계약 모달 새로고침 → 진행률 100%          │                                    │
    │ ─────────────────────────────────────► │                                    │
    │  8. 서명 완료 PDF 다운로드                │                                    │
    │ ─────────────────────────────────────► │  GET /:id/esign/signed-pdf         │
    │                                        │ ─────────────────────────────────► │
    │                                        │ ◄───────────────────────────────── │
    │ ◄───────────────────────────────────── │     (서명본 PDF)                    │
```

---

## 3. DB 스키마 제안

### 3-1. 신규 테이블: `esign_oauth_tokens`
모두싸인 OAuth 토큰 저장 (Google OAuth 패턴 재사용 — 동일 암호화 사용)

```sql
CREATE TABLE IF NOT EXISTS esign_oauth_tokens (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  provider        VARCHAR(20) DEFAULT 'modusign',  -- 향후 docusign 등 확장 대비
  access_token    TEXT NOT NULL,                   -- AES-256 암호화 (기존 패턴)
  refresh_token   TEXT NULL,                       -- AES-256 암호화
  token_type      VARCHAR(20) DEFAULT 'Bearer',
  expires_at      DATETIME NULL,
  scope           VARCHAR(255) NULL,
  modusign_user_id VARCHAR(100) NULL,              -- 모두싸인 user 식별자
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_provider (user_id, provider),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3-2. 기존 `contracts` 활용 (이미 컬럼 존재)
v6.0.0 슬림화 후에도 `contracts` 테이블에 이미 다음 컬럼이 있음:
- `esign_provider VARCHAR(20) NULL` — 'modusign'
- `esign_request_id VARCHAR(100) NULL` — 모두싸인 document_id
- `esign_status VARCHAR(20) NULL` — 'requested' / 'in_progress' / 'signed' / 'rejected' / 'expired'

추가 컬럼 (idempotent ALTER):
- `esign_requested_at DATETIME NULL` — 요청 시각
- `esign_signed_at DATETIME NULL` — 완료 시각
- `esign_signed_pdf_path VARCHAR(500) NULL` — 다운로드된 서명본 PDF 경로 (선택)

### 3-3. 신규 테이블: `esign_events`
Webhook 이벤트 로그 (감사 추적 + 디버깅)

```sql
CREATE TABLE IF NOT EXISTS esign_events (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  contract_id     INT NOT NULL,
  provider        VARCHAR(20) DEFAULT 'modusign',
  external_id     VARCHAR(100) NOT NULL,        -- modusign document_id
  event_type      VARCHAR(50) NOT NULL,         -- document.signed / document.completed 등
  event_payload   MEDIUMTEXT NULL,              -- raw webhook JSON
  signer_email    VARCHAR(200) NULL,            -- 서명자 (event 발생자)
  received_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contract (contract_id, received_at),
  INDEX idx_external (external_id),
  CONSTRAINT fk_ee_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 4. 신규 endpoint 계획

### 4-1. OAuth 흐름
- `GET /api/contracts/esign/oauth/connect` — 사용자를 모두싸인 인가 페이지로 redirect
- `GET /api/contracts/esign/oauth/callback` — 인가 코드 → access_token 발급 + DB 저장
- `GET /api/contracts/esign/status` — 현재 사용자 OAuth 연결 상태 조회
- `DELETE /api/contracts/esign/disconnect` — OAuth 토큰 무효화 + DB 삭제

### 4-2. 서명 요청 / 상태 / 다운로드
- `POST /api/contracts/:id/esign/request` — 서명 요청 시작
  - body: `{ file_id, signers: [{name, email, phone}], message? }`
  - 사전 검증: `contracts.status='approved'`, OAuth 연결 필수, 분석 가능 파일 있음
  - 결과: `esign_status='requested'` + `esign_request_id` 저장 + history `esign_request` 기록
- `GET /api/contracts/:id/esign/status` — 모두싸인 API 로 실시간 상태 조회 (cache 5분)
- `GET /api/contracts/:id/esign/signed-pdf` — 서명 완료 PDF 다운로드
- `POST /api/contracts/:id/esign/remind` — 미서명자에게 알림 재전송
- `POST /api/contracts/:id/esign/cancel` — 서명 요청 취소

### 4-3. Webhook
- `POST /api/webhooks/modusign` — 모두싸인 이벤트 수신 (인증 우회 — 서명 검증으로 보호)
  - 헤더 `X-Modusign-Signature` 검증 (HMAC-SHA256)
  - 이벤트 종류별 처리:
    - `document.signed` → 진행률 갱신
    - `document.completed` → `esign_status='signed'`, `esign_signed_at`, history `esign_signed`, 자동 PDF 다운로드 (선택)
    - `document.rejected` → `esign_status='rejected'`, history `esign_rejected`
    - `document.expired` → `esign_status='expired'`
  - 모든 이벤트는 `esign_events` 에 raw payload 로그

---

## 5. 프론트 UI 계획

### 5-1. 사용자 설정 페이지 (`settings.js`)
신규 섹션 "🖋 전자서명 (모두싸인)":
- 미연결: [모두싸인 연결] 버튼 → OAuth 흐름
- 연결됨: ✅ 연결됨 (modusign_user_id) + [연결 해제]
- Google OAuth 와 동일한 UX 패턴

### 5-2. 계약 모달 — 신규 섹션 "✍ 전자서명"
**위치**: AI 법무 검토 카드 아래, 첨부 파일 위 (또는 상태별 동적)

#### 상태 1: 미요청 (esign_status=null)
```
┌─ ✍ 전자서명 (모두싸인) ────────────────────────┐
│ 계약 상태가 "승인" 이상이어야 서명 요청 가능       │
│                                                  │
│ ⚠️ 모두싸인 미연결 → [⚙ 설정에서 연결]           │
│ ✅ 연결됨 (user@email) → [✍ 서명 요청 시작]      │
└─────────────────────────────────────────────────┘
```

#### 상태 2: 진행 중 (esign_status=requested / in_progress)
```
┌─ ✍ 전자서명 진행 중 ─────────────────────────┐
│ 모두싸인 문서 ID: doc_abc123                   │
│ 요청일: 2026.05.24 14:30                       │
│                                                │
│ 서명 진행률:                                   │
│  ✅ 김갑동 (sales@oci.com) — 서명 완료          │
│  ⏳ 이을순 (buyer@a-corp.com) — 서명 대기       │
│                                                │
│ [🔔 알림 재전송] [❌ 요청 취소]                │
└───────────────────────────────────────────────┘
```

#### 상태 3: 완료 (esign_status=signed)
```
┌─ ✅ 서명 완료 ───────────────────────────────┐
│ 완료일: 2026.05.25 09:15                       │
│ 모든 서명자 서명 완료                          │
│                                                │
│ [📄 서명본 PDF 다운로드]                       │
└───────────────────────────────────────────────┘
```

### 5-3. 액션 매트릭스 자동 갱신
서명 완료 시 4단계 상태를 자동으로 `approved` → `completed` 전환 옵션 제공.

---

## 6. 환경변수 (`.env.example`)

```env
# ── 전자서명 (모두싸인) — v6.0.0 Step 4 ──────────────────────
# OAuth 2.0 클라이언트 (모두싸인 개발자 콘솔에서 발급)
MODUSIGN_CLIENT_ID=your-modusign-oauth-client-id
MODUSIGN_CLIENT_SECRET=your-modusign-oauth-client-secret
# OAuth 콜백 URL (운영: https://oci-crm.duckdns.org/api/contracts/esign/oauth/callback)
MODUSIGN_REDIRECT_URI=http://localhost:3001/api/contracts/esign/oauth/callback
# Webhook 서명 검증용 (모두싸인 관리자 화면에서 webhook 생성 시 발급)
MODUSIGN_WEBHOOK_SECRET=your-modusign-webhook-secret
# (선택) 토글 — 0 = OAuth 모드 / 1 = API Key 모드 (간단한 단일 계정용)
MODUSIGN_USE_API_KEY=0
MODUSIGN_API_KEY=
```

---

## 7. 보안 고려사항

| 항목 | 처리 |
|------|------|
| OAuth 토큰 저장 | AES-256 암호화 (기존 `google_oauth_tokens` 패턴 재사용) |
| Webhook 서명 검증 | `X-Modusign-Signature` HMAC-SHA256 검증 — 미검증 요청 401 거부 |
| Webhook URL 노출 | 인증 우회 endpoint, 단 모두싸인 IP 화이트리스트 + 서명 검증 |
| CORS / CSP | `connect-src` 에 `https://api.modusign.co.kr` 추가 |
| Rate Limit | OAuth callback / webhook 은 기본 rate limit 우회 |
| 토큰 만료 처리 | access_token 만료 시 refresh_token 자동 갱신 (best-effort) |

---

## 8. 운영 배포 가이드 (Step 4 완료 후 추가)

1. 모두싸인 개발자 콘솔 가입: https://developers.modusign.co.kr
2. OAuth 클라이언트 생성 → CLIENT_ID / SECRET 발급
3. Redirect URI 등록: `https://oci-crm.duckdns.org/api/contracts/esign/oauth/callback`
4. Webhook URL 등록: `https://oci-crm.duckdns.org/api/webhooks/modusign`
5. `.env` 에 키 입력 → `pm2 restart oci-ai`
6. 관리자 페이지 → "🖋 전자서명" 메뉴 → "모두싸인 연결" 클릭

---

## 9. 예상 작업량 (Step 4 commit 분할)

| Commit | 작업 | 예상 라인 변경 |
|:------:|------|:--------------:|
| 4-1 | **사전조사 + 설계 문서 (현재)** | docs +~250, .env.example +10 |
| 4-2 | DB 스키마 (esign_oauth_tokens, esign_events) + OAuth 백엔드 | backend +~400 |
| 4-3 | 서명 요청 백엔드 (`POST /:id/esign/request` 등) | backend +~300 |
| 4-4 | Webhook 수신 + 서명 검증 + 상태 갱신 | backend +~250 |
| 4-5 | 프론트 UI (계약 모달 전자서명 섹션 + 설정 페이지) | frontend +~500 |
| 4-6 | 문서 갱신 + e2e 시나리오 | docs/test +~150 |

**총 예상**: ~1850 라인 변경 + 외부 API 의존

---

## 10. 결정 사항 (사용자 승인 후 진행)

- [ ] 인증 방식: **OAuth 2.0** (권장) vs API Key (단순)
- [ ] DB 스키마: **2개 신규 테이블** + 기존 contracts 컬럼 활용
- [ ] Webhook URL: 운영 환경 `oci-crm.duckdns.org` 노출 필요
- [ ] 모두싸인 계정/플랜: 사용자 측 사전 가입 + 개발자 키 발급 필요
- [ ] Step 4-2 진행 전 위 결정사항 모두 승인 필요

---

> **이 문서는 v6.0.0 Step 4-1 사전 설계 결과물입니다. Step 4-2 이후의 구현은 본 설계서를 기반으로 진행하며, 변경사항은 본 문서에 누적 기록합니다.**

Sources:
- [모두싸인 API 소개](https://developers.modusign.co.kr/docs)
- [OAuth 연동 가이드](https://developers.modusign.co.kr/docs/oauth-%EC%97%B0%EB%8F%99%ED%95%98%EA%B8%B0)
- [API Reference](https://developers.modusign.co.kr/reference/api-reference)
- [Webhook 설정](https://developers.modusign.co.kr/docs/webhook-url-%EC%84%A4%EC%A0%95)
- [Webhook event 정의](https://developers.modusign.co.kr/docs/webhook-event)
- [서명 요청 (API Reference)](https://developers.modusign.co.kr/reference/documentcontroller_create)
