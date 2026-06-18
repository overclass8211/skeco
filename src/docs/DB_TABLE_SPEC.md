# 🗄 DB 테이블 명세서

> **버전**: v5.0 (Phase G3 + 로고/리포트빌더/기능플래그 확장)
> **DBMS**: MariaDB 11 (InnoDB, utf8mb4)
> **총 테이블**: 27개

---

## 📑 테이블 목록 (도메인별)

### 🔐 인증 / 사용자 (5)
- `users` — 시스템 로그인 계정
- `team_members` — 영업조직 (사용자별)
- `refresh_tokens` — JWT Refresh Token (rotation)
- `token_blacklist` — 로그아웃/회수 토큰
- `access_logs` — API 접근 로그 (자동 정리 90일)

### 🎯 영업 도메인 (5)
- `customers` — 고객사
- `leads` — 영업 리드 (8단계)
- `projects` — 수주 후 프로젝트
- `activities` — 영업 활동 이력
- `pipeline_stages` — 단계 정의

### 📅 일정/회의 (3)
- `calendar_events` — 영업 일정
- `meeting_minutes` — 회의록 (STT + AI 요약)
- `google_meet_sessions` — Google Meet 세션

### 💰 원가/상품 (2)
- `products` — 상품/원가
- `cost_history` — 원가 변동 이력

### 📨 게시판 (3)
- `announcements` — 공지사항
- `comments` — 댓글 (범용)
- `faq` — FAQ

### 🤖 AI (2)
- `ai_usage` — AI 토큰 사용 로그
- `token_recharge_log` — 토큰 충전 이력

### 🌐 통합/시스템 (7)
- `google_oauth_tokens` — Google OAuth (AES-256 암호화)
- `admin_labels` — 다국어 라벨
- `admin_label_audit` — 라벨 변경 이력
- `system_settings` — 키-값 설정 (logo_path 포함)
- `dev_features` — 기능 플래그 (33개)
- `dev_features_audit` — 토글 변경 이력
- `report_definitions` — 사용자 정의 리포트

---

## 1. users — 시스템 로그인 계정

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INT AUTO_INCREMENT | PK | |
| `username` | VARCHAR(50) | UNIQUE NOT NULL | 로그인 ID |
| `email` | VARCHAR(100) | UNIQUE | |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt cost=10 |
| `full_name` | VARCHAR(100) | | |
| `role` | ENUM | 5단계 | manager/team_lead/executive/admin/superadmin |
| `otp_secret` | VARCHAR(255) | | AES-256 암호화 |
| `otp_enabled` | TINYINT(1) | DEFAULT 0 | |
| `webauthn_cred_id` | TEXT | | 생체인증 자격증명 |
| `is_active` | TINYINT(1) | DEFAULT 1 | |
| `created_at` | TIMESTAMP | | |
| `updated_at` | TIMESTAMP | | ON UPDATE |

**인덱스**: `(username)`, `(email)`

---

## 2. team_members — 영업조직

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `name` | VARCHAR(50) | |
| `role` | ENUM('CS','Field','Sales') | |
| `team` | VARCHAR(50) | |
| `email` | VARCHAR(100) | |
| `monthly_token_limit` | INT | 기본 500,000 |
| `auto_recharge_enabled` | TINYINT(1) | |
| `auto_recharge_threshold` | INT | 임계값 % |
| `auto_recharge_amount` | INT | 자동충전량 |
| `avatar_color` | VARCHAR(7) | hex |
| `is_active` | TINYINT(1) | |

---

## 3. customers — 고객사

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `name` | VARCHAR(200) NOT NULL | |
| `region` | ENUM('국내','해외') | |
| `country` | VARCHAR(50) | |
| `industry` | VARCHAR(100) | |
| `contact_person` | VARCHAR(100) | 담당자명 |
| `phone` | VARCHAR(50) | |
| `email` | VARCHAR(100) | **Gmail 매칭 키** |
| `address` | VARCHAR(500) | Kakao Map |
| `notes` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMP | |

**인덱스**: `(region)`, `(name)`, `(email)`

---

## 4. leads — 영업 리드 (8단계 파이프라인)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `customer_id` | INT FK | customers.id |
| `customer_name` | VARCHAR(200) | |
| `project_name` | VARCHAR(300) | |
| `business_type` | ENUM | 태양광/모듈/EPC/ESS/전기/설치 |
| `region` | ENUM | 국내/해외 |
| `capacity_mw` | DECIMAL(10,2) | |
| `expected_amount` | DECIMAL(15,2) | 단위 정책에 따라 |
| `currency` | VARCHAR(10) | KRW/USD/EUR... |
| `amount_krw` | DECIMAL(20,2) | KRW 환산 |
| `stage` | VARCHAR(50) | lead/review/proposal/bidding/negotiation/won/lost/dropped |
| `assigned_to` | INT FK | team_members.id |
| `expected_close_date` | DATE | |
| `bidding_deadline` | DATE | |
| `source` | VARCHAR(100) | |
| `notes` | TEXT | |
| `stage_changed_at` | DATETIME | |

**인덱스**:
- `(stage, updated_at)` — 파이프라인 + 최근
- `(assigned_to, stage)` — 담당자별
- `(region)`, `(business_type)`

---

## 5. activities — 영업 활동 이력

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `lead_id` | INT FK | |
| `project_id` | INT FK | |
| `activity_type` | VARCHAR(50) | 미팅/전화/이메일/제안서/입찰/수주/드롭/기타 |
| `title` | VARCHAR(300) | |
| `content` | TEXT | |
| `performed_by` | INT FK | |
| `performed_at` | TIMESTAMP | |
| `calendar_event_id` | INT | |
| `gmail_message_id` | VARCHAR(64) | UNIQUE — Gmail 중복 차단 (G3) |

**인덱스**: `(lead_id, performed_at)`, `(gmail_message_id)` UNIQUE

---

## 6. meeting_minutes — 회의록

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `title` | VARCHAR(300) | |
| `meeting_date` | DATE | |
| `audio_filename` | VARCHAR(300) | |
| `audio_duration_sec` | INT | |
| `raw_transcript` | MEDIUMTEXT | STT 원문 |
| `speakers_json` | MEDIUMTEXT | 화자별 발화 (JSON) |
| `summary_md` | MEDIUMTEXT | AI 요약 (마크다운) |
| `agenda` | TEXT | |
| `key_points` | TEXT | |
| `action_items` | TEXT | |
| `customer_name` | VARCHAR(200) | |
| `lead_id` | INT FK | |
| `calendar_event_id` | INT | |
| `created_by` | INT | |

---

## 7. calendar_events — 영업 일정

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `title` | VARCHAR(200) | |
| `description` | TEXT | |
| `start_datetime` | DATETIME | |
| `end_datetime` | DATETIME | |
| `all_day` | TINYINT(1) | |
| `event_type` | VARCHAR(20) | |
| `status` | VARCHAR(20) | planned/completed |
| `lead_id` | INT | |
| `customer_name` | VARCHAR(200) | |
| `assigned_to` | INT | |
| `color` | VARCHAR(20) | |
| `recurrence` | VARCHAR(100) | |

**인덱스**: `(assigned_to, start_datetime)`, `(customer_name)`

---

## 8. projects — 수주 후 프로젝트

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `name` | VARCHAR(300) | |
| `customer_id` | INT FK | |
| `customer_name` | VARCHAR(200) | |
| `project_type` | VARCHAR(50) | |
| `contract_amount` | DECIMAL(15,2) | |
| `estimated_cost` | DECIMAL(15,2) | |
| `margin_pct` | DECIMAL(6,2) | 자동 계산 |
| `status` | ENUM | 진행중/제조중/납기지연/완료/취소 |
| `due_date` | DATE | |
| `assigned_to` | INT FK | |
| `lead_id` | INT FK | 원본 리드 |
| `notes` | TEXT | |

---

## 9. products, cost_history — 원가

### products
| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `name` | VARCHAR(150) |
| `category` | VARCHAR(50) — 원자재/모듈/부품/인건비 |
| `current_price` | DECIMAL(15,4) |
| `previous_price` | DECIMAL(15,4) |
| `change_pct` | DECIMAL(6,2) |
| `currency` | VARCHAR(10) |
| `last_updated` | DATE |

### cost_history
| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `product_id` | FK |
| `price` | DECIMAL |
| `recorded_at` | TIMESTAMP |

---

## 10. google_oauth_tokens — OAuth (암호화 저장)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `user_id` | INT PK | |
| `access_token` | TEXT | **AES-256-GCM 암호화** |
| `refresh_token` | TEXT | **AES-256-GCM 암호화** |
| `expiry_date` | BIGINT | |
| `google_email` | VARCHAR(100) | |
| `gmail_sync_enabled` | TINYINT(1) | G3 |
| `gmail_last_polled_at` | TIMESTAMP | |
| `gmail_sync_error` | VARCHAR(500) | invalid_grant 등 |

---

## 11. ai_usage — AI 토큰 사용 로그

| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `user_id` | INT |
| `endpoint` | VARCHAR(100) |
| `prompt_tokens` | INT |
| `completion_tokens` | INT |
| `total_tokens` | INT |
| `model` | VARCHAR(50) — gemini-2.5-flash/pro |
| `created_at` | TIMESTAMP |

**인덱스**: `(user_id)`, `(created_at)`

---

## 12. dev_features — 기능 플래그 (33개)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INT PK | |
| `feature_key` | VARCHAR(100) UNIQUE | 예: 'gmail.read' |
| `feature_name` | VARCHAR(200) | 표시명 |
| `description` | TEXT | |
| `category` | VARCHAR(50) | ai/auth/crm/data/integration/realtime/security/dev |
| `is_enabled` | TINYINT(1) DEFAULT 1 | |
| `is_experimental` | TINYINT(1) DEFAULT 0 | |
| `is_deprecated` | TINYINT(1) DEFAULT 0 | 매니페스트 제거됨 |
| `risk_level` | ENUM | safe/medium/high/critical |
| `required_features` | VARCHAR(500) | JSON 배열 [feature_key,...] |
| `affects_routes` | VARCHAR(500) | |
| `affects_tables` | VARCHAR(500) | |
| `last_changed_by` | INT | |
| `last_changed_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP ON UPDATE | |

---

## 13. dev_features_audit — 토글 변경 이력

| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `feature_key` | VARCHAR(100) |
| `old_enabled` | TINYINT(1) |
| `new_enabled` | TINYINT(1) |
| `changed_by` | INT |
| `changed_at` | TIMESTAMP |
| `reason` | VARCHAR(255) — '프리셋 적용: standard' 등 |

**인덱스**: `(feature_key, changed_at)`

---

## 14. report_definitions — 사용자 정의 리포트

| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `user_id` | INT |
| `name` | VARCHAR(150) |
| `description` | VARCHAR(500) |
| `config_json` | JSON — {datasource, rows, columns, filters, measures, chartType} |
| `is_shared` | TINYINT(1) DEFAULT 0 — Phase 2 대비 |
| `created_at`, `updated_at` | TIMESTAMP |

**인덱스**: `(user_id)`

---

## 15. admin_labels — 다국어 라벨

| 컬럼 | 타입 |
|------|------|
| `scope` | VARCHAR(50) — leads/customers/... |
| `key_name` | VARCHAR(100) — customer_name/email/... |
| `locale` | VARCHAR(5) — ko/en/ja/zh |
| `label` | VARCHAR(300) |
| `updated_by`, `updated_at` | |

**PK**: `(scope, key_name, locale)`

---

## 16. refresh_tokens / token_blacklist

### refresh_tokens
| 컬럼 | 설명 |
|------|------|
| `id` | PK |
| `user_id` | |
| `token_hash` | bcrypt 해시 (원문 미저장) |
| `jti` | UNIQUE |
| `user_agent`, `ip` | 탈취 감지 |
| `expires_at` | 7일 후 |
| `revoked`, `revoked_at` | |

### token_blacklist
| 컬럼 |
|------|
| `jti` (PK), `user_id`, `expires_at`, `reason`, `created_at` |

---

## 17. system_settings — 키-값 설정

| 컬럼 | 타입 |
|------|------|
| `setting_key` | VARCHAR(50) PK |
| `setting_value` | VARCHAR(255) |
| `updated_at` | TIMESTAMP |

**주요 키**:
- `idle_timeout_min` (기본 30)
- `default_monthly_token_limit` (기본 500,000)
- `logo_path` (커스텀 로고 URL — 신규)

---

## 18. access_logs — API 접근 로그

| 컬럼 | 타입 |
|------|------|
| `id` | PK |
| `user_id` | INT |
| `action` | VARCHAR(300) |
| `method` | VARCHAR(10) |
| `path` | VARCHAR(500) |
| `ip` | VARCHAR(60) |
| `status_code` | INT |
| `duration_ms` | INT |
| `created_at` | TIMESTAMP |

**자동 정리**: 매일 새벽 3시, 90일 초과 DELETE.

---

## 19. token_recharge_log

| 컬럼 |
|------|
| `id`, `user_id`, `recharge_amount`, `new_limit`, `reason`, `triggered_by` (auto/admin), `created_at` |

---

## 20. announcements, comments, faq

### announcements
- id, title, content, is_pinned, created_by, created_at, updated_at

### comments (범용)
- id, ref_type (announcement/lead/...), ref_id, content, author_name, created_at

### faq
- id, question, answer, category, created_at

---

## 21. admin_label_audit

- id, scope, key_name, locale, old_label, new_label, changed_by, changed_at

---

## 22. google_meet_sessions

- id, user_id, google_event_id, meet_link, title, scheduled_at, duration_min, meeting_minutes_id

---

## 📐 인덱스 전략 요약

| 테이블 | 인덱스 | 목적 |
|--------|--------|------|
| leads | (stage, updated_at) | 파이프라인 |
| leads | (assigned_to, stage) | 담당자별 |
| activities | (lead_id, performed_at) | 타임라인 |
| activities | (gmail_message_id) UNIQUE | Gmail 중복 차단 |
| calendar_events | (assigned_to, start_datetime) | 캘린더 |
| ai_usage | (user_id), (created_at) | 토큰 집계 |
| access_logs | (created_at), (user_id) | 로그 분석 |

---

## 🔒 데이터 보안

| 데이터 | 보호 방식 |
|-------|---------|
| 비밀번호 | bcrypt cost=10 |
| OAuth 토큰 | AES-256-GCM (ENCRYPTION_KEY) |
| OTP secret | AES-256-GCM |
| Refresh Token | bcrypt 해시 저장 (원문 X) |
| 모든 쿼리 | Parameterized (mysql2 prepared) |
| 접근 로그 | 90일 자동 정리 |

---

## 📊 데이터 수명 정책

| 데이터 | 보존 | 정리 방식 |
|--------|------|----------|
| access_logs | 90일 | 매일 3시 cron |
| refresh_tokens (revoked) | 30일 | cron |
| token_blacklist (expired) | 즉시 | cron |
| ai_usage | 영구 | (수동) |
| meeting_minutes | 영구 | (수동) |
| 업로드 오디오 | 영구 | (수동) |
| 로고 파일 | 새 업로드 시 이전 자동 삭제 | |
