# OCI CRM AI — DB 테이블 설계서

| 항목 | 내용 |
|------|------|
| DB명 | oci_crm |
| DBMS | MySQL 8.x / MariaDB |
| 문자셋 | utf8mb4 / utf8mb4_general_ci |
| 스토리지 엔진 | InnoDB |
| 작성일 | 2026-05-09 |
| 테이블 수 | 16개 |

---

## 테이블 목록

| # | 테이블명 | 설명 | 데이터 건수 |
|---|----------|------|------------|
| 1 | users | 시스템 로그인 계정 | 5 |
| 2 | team_members | 영업팀 구성원 | 21 |
| 3 | customers | 고객사 마스터 | 34 |
| 4 | leads | 영업 기회 (파이프라인) | 63 |
| 5 | projects | 수주 프로젝트 | 19 |
| 6 | activities | 영업 활동 이력 | 244 |
| 7 | calendar_events | 영업 캘린더 일정 | 313 |
| 8 | meeting_minutes | AI 회의록 | 19 |
| 9 | products | 원자재/상품 단가 | 9 |
| 10 | cost_history | 원자재 가격 이력 | 49 |
| 11 | announcements | 게시판 공지사항 | 1 |
| 12 | comments | 게시판 댓글 (공통) | 0 |
| 13 | faq | 자주 묻는 질문 | 0 |
| 14 | ai_usage | AI 토큰 사용 로그 | 175 |
| 15 | access_logs | API 접근 로그 | 5,033 |
| 16 | system_settings | 시스템 설정 KV | 2 |

---

## 1. users — 시스템 로그인 계정

> 시스템에 접근하는 사용자 계정. OTP·WebAuthn 2FA 지원. role 기반 접근제어.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 계정 고유 ID |
| UQ | username | VARCHAR(50) | NO | - | 로그인 아이디 (유니크) |
| UQ | email | VARCHAR(100) | YES | NULL | 이메일 (유니크) |
| | password_hash | VARCHAR(255) | NO | - | bcrypt 해시 비밀번호 |
| | full_name | VARCHAR(100) | YES | NULL | 실명 |
| | role | ENUM | YES | manager | manager / team_lead / executive / superadmin |
| | is_active | TINYINT(1) | YES | 1 | 활성 여부 (1=활성) |
| | otp_secret | VARCHAR(100) | YES | NULL | TOTP 시크릿 키 |
| | otp_enabled | TINYINT(1) | YES | 0 | OTP 활성화 여부 |
| | webauthn_cred_id | VARCHAR(500) | YES | NULL | WebAuthn 자격증명 ID |
| | last_login | DATETIME | YES | NULL | 마지막 로그인 일시 |
| | department | VARCHAR(100) | YES | NULL | 부서명 |
| | avatar_url | VARCHAR(255) | YES | NULL | 프로필 이미지 URL |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

**인덱스**

| 인덱스명 | 컬럼 | 유형 |
|----------|------|------|
| PRIMARY | id | PK |
| username | username | UNIQUE |
| email | email | UNIQUE |
| idx_username | username | INDEX |
| idx_email | email | INDEX |

---

## 2. team_members — 영업팀 구성원

> 영업 활동을 수행하는 팀원. leads·activities·projects의 담당자 FK 대상. users와 별도 관리.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 팀원 고유 ID |
| | name | VARCHAR(50) | NO | - | 이름 |
| | role | ENUM('CS','Field','Sales') | NO | - | 역할 |
| | team | VARCHAR(50) | YES | NULL | 소속팀 (태양광/전기ESS/해외) |
| | email | VARCHAR(100) | YES | NULL | 이메일 |
| | phone | VARCHAR(50) | YES | NULL | 연락처 |
| | avatar_color | VARCHAR(20) | YES | #E63329 | 아바타 색상 |
| | is_active | TINYINT(1) | YES | 1 | 활성 여부 |
| | monthly_token_limit | INT(11) | YES | NULL | 월간 AI 토큰 한도 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

**인덱스**

| 인덱스명 | 컬럼 | 유형 |
|----------|------|------|
| PRIMARY | id | PK |
| idx_role | role | INDEX |
| idx_team | team | INDEX |

---

## 3. customers — 고객사 마스터

> 영업 대상 고객사. leads·projects의 상위 마스터 데이터.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 고객사 고유 ID |
| | name | VARCHAR(200) | NO | - | 고객사명 |
| | region | ENUM('국내','해외') | YES | 국내 | 지역 구분 |
| | country | VARCHAR(50) | YES | NULL | 국가 (해외 고객사) |
| | industry | VARCHAR(100) | YES | NULL | 산업 분류 |
| | contact_person | VARCHAR(100) | YES | NULL | 담당자명 |
| | phone | VARCHAR(50) | YES | NULL | 연락처 |
| | email | VARCHAR(100) | YES | NULL | 이메일 |
| | address | VARCHAR(500) | YES | NULL | 주소 |
| | notes | TEXT | YES | NULL | 비고 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

**인덱스**

| 인덱스명 | 컬럼 | 유형 |
|----------|------|------|
| PRIMARY | id | PK |
| idx_region | region | INDEX |
| idx_name | name | INDEX |

---

## 4. leads — 영업 기회 (파이프라인 핵심 테이블)

> 영업 파이프라인의 핵심 엔터티. 고객사에서 발생한 영업 기회를 stage로 관리.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 리드 고유 ID |
| **FK** | customer_id | INT(11) | YES | NULL | customers.id (SET NULL on delete) |
| | customer_name | VARCHAR(200) | NO | - | 고객사명 (비정규화 복사) |
| | project_name | VARCHAR(300) | NO | - | 프로젝트명 |
| | business_type | ENUM | YES | 태양광 | 태양광/모듈/EPC/ESS/전기/설치 |
| | region | ENUM('국내','해외') | YES | 국내 | 지역 |
| | capacity_mw | DECIMAL(10,2) | YES | NULL | 발전 용량 (MW) |
| | expected_amount | DECIMAL(15,2) | YES | NULL | 예상 수주 금액 (억원) |
| | currency | VARCHAR(10) | YES | KRW | 통화 |
| | stage | ENUM | YES | lead | lead→review→proposal→bidding→negotiation→won/lost/dropped |
| **FK** | assigned_to | INT(11) | YES | NULL | team_members.id (SET NULL on delete) |
| | expected_close_date | DATE | YES | NULL | 예상 수주 완료일 |
| | bidding_deadline | DATE | YES | NULL | 입찰 마감일 |
| | source | VARCHAR(100) | YES | NULL | 리드 소스 (전시회/소개/웹사이트 등) |
| | notes | TEXT | YES | NULL | 비고 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

**Stage 정의**

| Stage | 의미 |
|-------|------|
| lead | 리드 발굴 |
| review | 검토/미팅 |
| proposal | 제안/견적 |
| bidding | 입찰 진행 |
| negotiation | 협상/계약 |
| won | 수주 완료 ✅ |
| lost | 실주 ❌ |
| dropped | 드롭 🚫 |

**인덱스**

| 인덱스명 | 컬럼 | 유형 |
|----------|------|------|
| PRIMARY | id | PK |
| idx_customer_id | customer_id | INDEX + FK |
| idx_stage | stage | INDEX |
| idx_region | region | INDEX |
| idx_assigned | assigned_to | INDEX + FK |
| idx_business | business_type | INDEX |
| idx_stage_updated | (stage, updated_at) | 복합 INDEX |
| idx_assigned_stage | (assigned_to, stage) | 복합 INDEX |

---

## 5. projects — 수주 프로젝트

> 수주 확정 후 납기·원가·마진 관리용. leads.id와 1:1 연결 가능.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 프로젝트 고유 ID |
| | name | VARCHAR(300) | NO | - | 프로젝트명 |
| **FK** | customer_id | INT(11) | YES | NULL | customers.id |
| | customer_name | VARCHAR(200) | YES | NULL | 고객사명 (비정규화) |
| | project_type | VARCHAR(50) | YES | NULL | 프로젝트 유형 |
| | contract_amount | DECIMAL(15,2) | YES | NULL | 계약금액 (억원) |
| | estimated_cost | DECIMAL(15,2) | YES | NULL | 산정 원가 (억원) |
| | margin_pct | DECIMAL(6,2) | YES | NULL | 마진율 (%) |
| | status | ENUM | YES | 진행중 | 진행중/제조중/납기지연/완료/취소 |
| | due_date | DATE | YES | NULL | 납기일 |
| **FK** | assigned_to | INT(11) | YES | NULL | team_members.id |
| **FK** | lead_id | INT(11) | YES | NULL | leads.id |
| | notes | TEXT | YES | NULL | 비고 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

---

## 6. activities — 영업 활동 이력

> 리드 또는 프로젝트에 연결된 영업 활동 기록 (미팅, 전화, 이메일 등).

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 활동 고유 ID |
| **FK** | lead_id | INT(11) | YES | NULL | leads.id (CASCADE delete) |
| **FK** | project_id | INT(11) | YES | NULL | projects.id (CASCADE delete) |
| | activity_type | VARCHAR(50) | YES | note | 활동 유형 (note/meeting/call/email 등) |
| | title | VARCHAR(300) | YES | NULL | 활동 제목 |
| | content | TEXT | YES | NULL | 활동 내용 |
| **FK** | performed_by | INT(11) | YES | NULL | team_members.id (SET NULL on delete) |
| | performed_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 활동 일시 |
| | activity_date | DATETIME | YES | NULL | 활동 날짜 (별도 기록) |
| | calendar_event_id | INT(11) | YES | NULL | calendar_events.id (논리적 참조) |

---

## 7. calendar_events — 영업 캘린더 일정

> FullCalendar 기반 영업 일정 관리. 리드·담당자 연결.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 일정 고유 ID |
| | title | VARCHAR(200) | NO | - | 일정 제목 |
| | description | TEXT | YES | NULL | 상세 내용 |
| | start_datetime | DATETIME | NO | - | 시작 일시 |
| | end_datetime | DATETIME | YES | NULL | 종료 일시 |
| | all_day | TINYINT(1) | YES | 0 | 종일 일정 여부 |
| | event_type | VARCHAR(20) | YES | 기타 | 미팅/영업방문/입찰/제안/내부/기타 |
| | lead_id | INT(11) | YES | NULL | leads.id (논리적 참조) |
| | customer_name | VARCHAR(200) | YES | NULL | 고객사명 |
| | assigned_to | INT(11) | YES | NULL | team_members.id (논리적 참조) |
| | color | VARCHAR(20) | YES | #e63946 | 캘린더 표시 색상 |
| | recurrence | VARCHAR(100) | YES | NULL | 반복 규칙 |
| | status | VARCHAR(20) | YES | planned | planned / completed |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 8. meeting_minutes — AI 회의록

> 음성 녹음 → STT → AI 요약으로 생성된 회의록. 화자분리(speakers_json) 포함.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 회의록 고유 ID |
| | title | VARCHAR(300) | NO | - | 회의록 제목 |
| | meeting_date | DATE | YES | NULL | 미팅 날짜 |
| | audio_filename | VARCHAR(300) | YES | NULL | 원본 음성 파일명 |
| | audio_duration_sec | INT(11) | YES | NULL | 음성 길이 (초) |
| | raw_transcript | MEDIUMTEXT | YES | NULL | STT 원문 텍스트 |
| | speakers_json | MEDIUMTEXT | YES | NULL | 화자분리 결과 JSON |
| | summary_md | MEDIUMTEXT | YES | NULL | AI 요약 (Markdown) |
| | agenda | TEXT | YES | NULL | 회의 안건 |
| | key_points | TEXT | YES | NULL | 핵심 논의사항 |
| | action_items | TEXT | YES | NULL | 후속 조치 항목 |
| | customer_name | VARCHAR(200) | YES | NULL | 고객사명 |
| | lead_id | INT(11) | YES | NULL | leads.id (논리적 참조) |
| | calendar_event_id | INT(11) | YES | NULL | calendar_events.id (논리적 참조) |
| | created_by | INT(11) | YES | NULL | team_members.id (논리적 참조) |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 9. products — 원자재/상품 단가

> 폴리실리콘, 모듈, ESS 등 원자재 현재 단가 및 변동률 관리.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 상품 고유 ID |
| | name | VARCHAR(150) | NO | - | 상품/원자재명 |
| | category | VARCHAR(50) | YES | NULL | 분류 (원자재/모듈/부품/인건비) |
| | unit | VARCHAR(20) | YES | NULL | 단위 ($/kg, $/장 등) |
| | current_price | DECIMAL(15,4) | YES | NULL | 현재 단가 |
| | currency | VARCHAR(10) | YES | USD | 통화 |
| | previous_price | DECIMAL(15,4) | YES | NULL | 이전 단가 |
| | change_pct | DECIMAL(6,2) | YES | NULL | 전월 대비 변동률 (%) |
| | last_updated | DATE | YES | NULL | 마지막 업데이트일 |
| | notes | TEXT | YES | NULL | 비고 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

---

## 10. cost_history — 원자재 가격 이력

> products 테이블의 단가 변동 이력. 시계열 트렌드 분석용.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 이력 고유 ID |
| **FK** | product_id | INT(11) | NO | - | products.id (CASCADE delete) |
| | price | DECIMAL(15,4) | NO | - | 기록 단가 |
| | recorded_at | DATE | NO | - | 기록일 |
| | notes | VARCHAR(255) | YES | NULL | 비고 |

---

## 11. announcements — 게시판 공지사항

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 공지 고유 ID |
| | title | VARCHAR(300) | NO | - | 제목 |
| | content | TEXT | NO | - | 내용 |
| | is_pinned | TINYINT(1) | YES | 0 | 상단 고정 여부 |
| | created_by | INT(11) | YES | NULL | users.id (논리적 참조) |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

---

## 12. comments — 댓글 (공통 참조)

> ref_type + ref_id 조합으로 여러 엔터티에 댓글 연결 (polymorphic association).

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 댓글 고유 ID |
| | ref_type | VARCHAR(30) | NO | - | 대상 유형 (announcement/lead 등) |
| | ref_id | INT(11) | NO | - | 대상 레코드 ID |
| | content | TEXT | NO | - | 댓글 내용 |
| | author_name | VARCHAR(100) | YES | NULL | 작성자명 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 13. faq — 자주 묻는 질문

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | FAQ 고유 ID |
| | question | TEXT | NO | - | 질문 |
| | answer | TEXT | NO | - | 답변 |
| | category | VARCHAR(50) | YES | 기타 | 분류 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 14. ai_usage — AI 토큰 사용 로그

> Claude API 호출별 토큰 소비량 추적. 사용자별 월간 한도 관리에 활용.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 로그 고유 ID |
| | user_id | INT(11) | YES | NULL | users.id (논리적 참조) |
| | endpoint | VARCHAR(100) | YES | NULL | 호출 API 엔드포인트 |
| | prompt_tokens | INT(11) | YES | 0 | 입력 토큰 수 |
| | completion_tokens | INT(11) | YES | 0 | 출력 토큰 수 |
| | total_tokens | INT(11) | YES | 0 | 총 토큰 수 |
| | model | VARCHAR(50) | YES | NULL | 사용 AI 모델명 |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 15. access_logs — API 접근 로그

> Express 미들웨어에서 자동 기록되는 HTTP 요청 로그.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | id | INT(11) AUTO_INCREMENT | NO | - | 로그 고유 ID |
| | action | VARCHAR(300) | YES | NULL | 행위 설명 |
| | method | VARCHAR(10) | YES | NULL | HTTP 메서드 (GET/POST 등) |
| | path | VARCHAR(500) | YES | NULL | 요청 경로 |
| | ip | VARCHAR(60) | YES | NULL | 클라이언트 IP |
| | status_code | INT(11) | YES | NULL | HTTP 상태 코드 |
| | duration_ms | INT(11) | YES | NULL | 처리 시간 (ms) |
| | created_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 생성일시 |

---

## 16. system_settings — 시스템 설정

> 애플리케이션 전역 설정을 Key-Value 형태로 저장.

| PK/FK | 컬럼명 | 데이터 타입 | NULL | 기본값 | 설명 |
|-------|--------|------------|------|--------|------|
| **PK** | setting_key | VARCHAR(50) | NO | - | 설정 키 |
| | setting_value | VARCHAR(255) | YES | NULL | 설정 값 |
| | updated_at | TIMESTAMP | YES | CURRENT_TIMESTAMP | 수정일시 (자동갱신) |

**현재 설정값**

| setting_key | setting_value | 설명 |
|-------------|---------------|------|
| ai_model | claude-opus-4-5 | 사용 AI 모델 |
| default_currency | KRW | 기본 통화 |

---

## 외래 키(FK) 관계 요약

| 자식 테이블 | FK 컬럼 | 부모 테이블 | 참조 컬럼 | 삭제 정책 |
|------------|---------|------------|---------|-----------|
| leads | customer_id | customers | id | SET NULL |
| leads | assigned_to | team_members | id | SET NULL |
| projects | customer_id | customers | id | SET NULL |
| projects | assigned_to | team_members | id | SET NULL |
| projects | lead_id | leads | id | SET NULL |
| activities | lead_id | leads | id | CASCADE |
| activities | project_id | projects | id | CASCADE |
| activities | performed_by | team_members | id | SET NULL |
| cost_history | product_id | products | id | CASCADE |

---

## 논리적 참조 (FK 미선언)

| 컬럼 | 참조 대상 | 비고 |
|------|----------|------|
| activities.calendar_event_id | calendar_events.id | 일정 연결 |
| meeting_minutes.lead_id | leads.id | 리드 연결 |
| meeting_minutes.calendar_event_id | calendar_events.id | 일정 연결 |
| meeting_minutes.created_by | team_members.id | 작성자 |
| calendar_events.lead_id | leads.id | 리드 연결 |
| calendar_events.assigned_to | team_members.id | 담당자 |
| announcements.created_by | users.id | 작성자 |
| ai_usage.user_id | users.id | 사용자 |
