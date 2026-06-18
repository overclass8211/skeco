-- =====================================================
-- SK ecoplant materials CRM Database Schema (MariaDB)
-- (OCI CRM 소스 기반 포크 — DB명 sk_mat_crm 으로 격리)
-- =====================================================
-- 사용법:
--   mysql -u root -p < schema.sql
-- 또는:
--   mysql -u root -p
--   source schema.sql;
-- =====================================================

DROP DATABASE IF EXISTS sk_mat_crm;
CREATE DATABASE sk_mat_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sk_mat_crm;

-- ---------------------------------------------------
-- 1. 팀원 (영업조직: CS 2명 / Field 9명 / Sales 10명)
-- ---------------------------------------------------
CREATE TABLE team_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  role ENUM('CS', 'Field', 'Sales') NOT NULL,
  team VARCHAR(50) COMMENT '태양광/전기ESS/해외',
  email VARCHAR(100),
  monthly_token_limit INT DEFAULT 100000,
  phone VARCHAR(50),
  avatar_color VARCHAR(20) DEFAULT '#E63329',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_role (role),
  INDEX idx_team (team)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 2. 고객사
-- ---------------------------------------------------
CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  region ENUM('국내', '해외') DEFAULT '국내',
  country VARCHAR(50),
  industry VARCHAR(100),
  contact_person VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(100),
  address VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_region (region),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 3. 영업 리드 (Pipeline)
-- ---------------------------------------------------
CREATE TABLE leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT,
  customer_name VARCHAR(200) NOT NULL,
  project_name VARCHAR(300) NOT NULL,
  business_type ENUM('태양광', '모듈', 'EPC', 'ESS', '전기', '설치') DEFAULT '태양광',
  region ENUM('국내', '해외') DEFAULT '국내',
  capacity_mw DECIMAL(10,2) COMMENT '용량 (MW)',
  expected_amount DECIMAL(15,2) COMMENT '예상 금액 (억원)',
  currency VARCHAR(10) DEFAULT 'KRW',
  stage ENUM('lead','review','proposal','bidding','negotiation','won','lost','dropped') DEFAULT 'lead',
  assigned_to INT,
  expected_close_date DATE,
  bidding_deadline DATE,
  source VARCHAR(100) COMMENT '리드 소스 (전시회/소개/웹사이트 등)',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL,
  INDEX idx_stage (stage),
  INDEX idx_region (region),
  INDEX idx_assigned (assigned_to),
  INDEX idx_business (business_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 4. 상품/원가 (OnERP 연동 항목)
-- ---------------------------------------------------
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) COMMENT '원자재/모듈/부품/인건비',
  unit VARCHAR(20) COMMENT '$/kg, $/장, ₩/대 등',
  current_price DECIMAL(15,4),
  currency VARCHAR(10) DEFAULT 'USD',
  previous_price DECIMAL(15,4),
  change_pct DECIMAL(6,2) COMMENT '전월 대비 변동률(%)',
  last_updated DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 5. 원가 변동 이력
-- ---------------------------------------------------
CREATE TABLE cost_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  price DECIMAL(15,4) NOT NULL,
  recorded_at DATE NOT NULL,
  notes VARCHAR(255),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_date (product_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 6. 프로젝트 (수주 후 진행)
-- ---------------------------------------------------
CREATE TABLE projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(300) NOT NULL,
  customer_id INT,
  customer_name VARCHAR(200),
  project_type VARCHAR(50),
  contract_amount DECIMAL(15,2) COMMENT '계약금액 (억원)',
  estimated_cost DECIMAL(15,2) COMMENT '산정 원가 (억원)',
  margin_pct DECIMAL(6,2) COMMENT '마진율(%)',
  status ENUM('진행중','제조중','납기지연','완료','취소') DEFAULT '진행중',
  due_date DATE,
  assigned_to INT,
  lead_id INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------
-- 7. 영업 활동 이력
-- ---------------------------------------------------
CREATE TABLE activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT,
  project_id INT,
  activity_type ENUM('미팅','전화','이메일','제안서','입찰','수주','드롭','기타') DEFAULT '기타',
  title VARCHAR(300),
  content TEXT,
  performed_by INT,
  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (performed_by) REFERENCES team_members(id) ON DELETE SET NULL,
  INDEX idx_lead (lead_id),
  INDEX idx_performed (performed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================
-- 8. 캘린더 이벤트 (영업 일정 / 액션 아이템)
-- =====================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(200) NOT NULL                 COMMENT '일정 제목 (예: "삼성케미칼 견적서 발송")',
  description     TEXT                                  COMMENT '상세 설명 / 회의 안건 / 결과',
  start_datetime  DATETIME NOT NULL                     COMMENT '시작 일시',
  end_datetime    DATETIME                              COMMENT '종료 일시 (NULL 가능)',
  all_day         TINYINT(1) DEFAULT 0                  COMMENT '종일 일정 여부 (1=종일)',
  event_type      VARCHAR(20) DEFAULT '기타'             COMMENT '미팅/영업방문/입찰/제안/내부/기타',
  status          VARCHAR(20) DEFAULT 'planned'         COMMENT 'planned(계획) | completed(완료)',
  lead_id         INT                                   COMMENT '연결된 영업기회 ID',
  customer_name   VARCHAR(200)                          COMMENT '고객사명 (캐시)',
  assigned_to     INT                                   COMMENT '담당자 (team_members.id)',
  color           VARCHAR(20) DEFAULT '#1a73e8'         COMMENT '이벤트 색상 (hex)',
  recurrence      VARCHAR(100)                          COMMENT '반복 규칙 (RRULE)',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_start_datetime  (start_datetime),
  INDEX idx_assignee_start  (assigned_to, start_datetime),
  INDEX idx_customer        (customer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='영업 캘린더 이벤트 (FullCalendar 표시용)';

-- =====================================================
-- 9. 회의록 (Google STT + Gemini 요약)
-- =====================================================
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(300) NOT NULL             COMMENT '미팅 제목',
  meeting_date        DATE                              COMMENT '미팅 일자',
  audio_filename      VARCHAR(300)                      COMMENT '원본 오디오 파일명 (보관 안 함)',
  audio_duration_sec  INT                               COMMENT '오디오 길이 (초)',
  raw_transcript      MEDIUMTEXT                        COMMENT 'STT 원본 전사 텍스트',
  speakers_json       MEDIUMTEXT                        COMMENT '화자 분리 JSON [{speaker,text}]',
  summary_md          MEDIUMTEXT                        COMMENT 'Gemini 요약 (마크다운)',
  agenda              TEXT                              COMMENT '추출된 어젠다 (옵션)',
  key_points          TEXT                              COMMENT '핵심 내용 (옵션)',
  action_items        TEXT                              COMMENT '액션 아이템 (옵션)',
  customer_name       VARCHAR(200)                      COMMENT '연결된 고객사',
  lead_id             INT                               COMMENT '연결된 리드',
  calendar_event_id   INT                               COMMENT '캘린더 자동 등록 시 메인 이벤트 ID',
  created_by          INT                               COMMENT '작성자 (team_members.id)',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_meeting_date (meeting_date),
  INDEX idx_customer     (customer_name),
  INDEX idx_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AI 회의록 (음성 → 텍스트 → 요약)';

-- =====================================================
-- 10. AI 토큰 사용량 (사용자별 추적 + 한도 관리)
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  user_id             INT NULL                          COMMENT 'X-User-Id 헤더에서 추출 (team_members.id)',
  endpoint            VARCHAR(100)                      COMMENT '호출 엔드포인트 식별자 (chat/insights/ocr 등)',
  prompt_tokens       INT DEFAULT 0                     COMMENT '입력 토큰 수',
  completion_tokens   INT DEFAULT 0                     COMMENT '출력 토큰 수',
  total_tokens        INT DEFAULT 0                     COMMENT '합계 토큰 수',
  model               VARCHAR(50)                       COMMENT '사용된 Gemini 모델 ID',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at),
  INDEX idx_user    (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AI API 호출별 토큰 소비 로그';

-- =====================================================
-- 11. 시스템 정책 설정 (관리자 콘솔)
-- =====================================================
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(50) PRIMARY KEY                 COMMENT '키 (예: idle_timeout_min)',
  setting_value VARCHAR(255)                            COMMENT '값 (문자열로 저장)',
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='조직 정책 (idle 타임아웃, 토큰 기본 한도 등)';

-- 기본 정책 시드
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('idle_timeout_min',             '30'),
  ('default_monthly_token_limit',  '500000')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- =====================================================
-- 12. 게시판 (공지 / 댓글 / FAQ)
-- =====================================================
CREATE TABLE IF NOT EXISTS announcements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(300) NOT NULL,
  content     TEXT NOT NULL,
  is_pinned   TINYINT(1) DEFAULT 0,
  created_by  INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='조직 공지사항';

CREATE TABLE IF NOT EXISTS comments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ref_type    VARCHAR(30) NOT NULL                      COMMENT '댓글 대상 종류 (announcement/lead 등)',
  ref_id      INT NOT NULL,
  content     TEXT NOT NULL,
  author_name VARCHAR(100),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='범용 댓글 (공지사항/리드 등 어디에든 부착 가능)';

CREATE TABLE IF NOT EXISTS faq (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  category    VARCHAR(50) DEFAULT '기타',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='FAQ';

-- =====================================================
-- 13. 접근 로그 (관리자 모니터링용)
-- =====================================================
CREATE TABLE IF NOT EXISTS access_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  action      VARCHAR(300),
  method      VARCHAR(10),
  path        VARCHAR(500),
  ip          VARCHAR(60),
  status_code INT,
  duration_ms INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='/api 모든 호출의 응답 시간 로그';

-- =====================================================
-- 추가 성능 인덱스 (Phase 0 정리 — EXPLAIN 분석 결과)
--   기존 단일 인덱스에 더해 자주 쓰이는 쿼리의 정렬을
--   제거하기 위한 복합 인덱스.
-- =====================================================
ALTER TABLE leads      ADD INDEX idx_stage_updated   (stage, updated_at);
ALTER TABLE leads      ADD INDEX idx_assigned_stage  (assigned_to, stage);
ALTER TABLE activities ADD INDEX idx_lead_performed  (lead_id, performed_at);
-- 이미 추가됨 (CREATE TABLE 안): calendar_events.idx_start_datetime / idx_assignee_start / idx_customer
-- 이미 추가됨: meeting_minutes.idx_created_at, ai_usage.idx_user / idx_created

-- =====================================================
-- 14. 사용자 계정 (로그인 / 권한 관리)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  username         VARCHAR(50) UNIQUE NOT NULL,
  email            VARCHAR(100) UNIQUE,
  password_hash    VARCHAR(255) NOT NULL,
  full_name        VARCHAR(100),
  role             ENUM('manager','team_lead','executive','admin','superadmin') DEFAULT 'manager',
  is_active        TINYINT(1) DEFAULT 1,
  otp_secret       VARCHAR(100)  COMMENT 'AES-256 암호화된 TOTP 시크릿',
  otp_enabled      TINYINT(1) DEFAULT 0,
  webauthn_cred_id VARCHAR(500)  COMMENT 'WebAuthn 자격증명 ID',
  last_login       DATETIME,
  department       VARCHAR(100),
  avatar_url       VARCHAR(255),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='시스템 로그인 계정 (manager/team_lead/executive/admin/superadmin)';

-- =====================================================
-- 15. Refresh Token (JWT 갱신 / 세션 관리)
-- =====================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(255) NOT NULL  COMMENT 'bcrypt 해시 (원문 미저장)',
  jti         VARCHAR(36)  NOT NULL  COMMENT '연결된 access token JTI',
  user_agent  VARCHAR(500),
  ip          VARCHAR(45),
  expires_at  DATETIME NOT NULL,
  revoked     TINYINT(1) DEFAULT 0,
  revoked_at  DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user    (user_id),
  INDEX idx_jti     (jti),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Refresh Token (HttpOnly 쿠키 + DB 검증)';

-- =====================================================
-- 16. Token Blacklist (즉시 무효화)
-- =====================================================
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti        VARCHAR(36) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at DATETIME NOT NULL  COMMENT '이 시각 이후 자동 정리 가능',
  reason     VARCHAR(50) DEFAULT 'logout',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='로그아웃된 Access Token JTI 블랙리스트';

-- =====================================================
-- 17. 개발자 기능 플래그 (Feature Flags)
-- =====================================================
CREATE TABLE IF NOT EXISTS dev_features (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  feature_key      VARCHAR(100) NOT NULL UNIQUE,
  feature_name     VARCHAR(200) NOT NULL,
  description      TEXT,
  category         VARCHAR(50) DEFAULT 'general',
  is_enabled       TINYINT(1)  DEFAULT 1,
  is_experimental  TINYINT(1)  DEFAULT 0,
  affects_routes   VARCHAR(500),
  affects_tables   VARCHAR(500),
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='기능 토글 (superadmin 전용 개발자 옵션)';

-- =====================================================
-- 18. 공지사항 열람 기록
-- =====================================================
CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id INT NOT NULL,
  viewer_id       INT NOT NULL,
  viewed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (announcement_id, viewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='공지사항 열람 기록 (반복 열람 제외, PK 중복 방지)';

-- =====================================================
-- 19. 토큰 충전 로그
-- =====================================================
CREATE TABLE IF NOT EXISTS token_recharge_log (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          NOT NULL,
  recharge_amount INT          NOT NULL,
  new_limit       INT          NOT NULL,
  reason          VARCHAR(100) DEFAULT '자동충전',
  triggered_by    VARCHAR(20)  DEFAULT 'auto' COMMENT 'auto|admin',
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_date (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AI 토큰 충전 이력 (자동충전 + 수동충전)';

-- =====================================================
-- 20. Google OAuth 토큰
-- =====================================================
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  user_id       INT          NOT NULL,
  access_token  TEXT                   COMMENT 'AES-256 암호화',
  refresh_token TEXT                   COMMENT 'AES-256 암호화',
  expiry_date   BIGINT,
  google_email  VARCHAR(255),
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Google Calendar/Meet OAuth2 자격증명';

-- =====================================================
-- 21. Google Meet 세션
-- =====================================================
CREATE TABLE IF NOT EXISTS google_meet_sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT,
  google_event_id    VARCHAR(255),
  meet_link          VARCHAR(500) NOT NULL,
  title              VARCHAR(255),
  scheduled_at       DATETIME,
  duration_min       INT DEFAULT 60,
  meeting_minutes_id INT NULL      COMMENT '연결된 회의록 ID',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Google Meet 회의 세션 + 회의록 연동';

-- =====================================================
-- 22. team_members 자동충전 컬럼 (ALTER — 이미 적용됨)
-- =====================================================
-- ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_enabled   TINYINT(1) DEFAULT 0;
-- ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_threshold INT DEFAULT 80;
-- ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_amount    INT DEFAULT 100000;

-- =====================================================
-- 23. leads stage_changed_at 컬럼 (ALTER — 이미 적용됨)
-- =====================================================
-- ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME;

-- =====================================================
-- 샘플 데이터 INSERT
-- =====================================================

-- 팀원 (CS 2 / Field 9 / Sales 10 = 21명)
INSERT INTO team_members (name, role, team, email, avatar_color) VALUES
('이필드', 'Field', '태양광', 'lee.field@oci.co.kr', '#E63329'),
('박세일즈', 'Sales', '태양광', 'park.sales@oci.co.kr', '#1e5fe8'),
('정필드', 'Field', '해외', 'jung.field@oci.co.kr', '#7c4dff'),
('김CS', 'CS', '태양광', 'kim.cs@oci.co.kr', '#17a85a'),
('최세일즈', 'Sales', '전기/ESS', 'choi.sales@oci.co.kr', '#f59c00'),
('한필드', 'Field', '전기/ESS', 'han.field@oci.co.kr', '#e83535'),
('윤세일즈', 'Sales', '해외', 'yoon.sales@oci.co.kr', '#0ea5e9'),
('서CS', 'CS', '전기/ESS', 'seo.cs@oci.co.kr', '#10b981');

-- 고객사
INSERT INTO customers (name, region, country, industry, contact_person, phone, email) VALUES
('한국동서발전', '국내', '대한민국', '발전', '김부장', '02-1234-5678', 'kim@ewp.kr'),
('한화에너지', '국내', '대한민국', '에너지', '이팀장', '02-2345-6789', 'lee@hanwha.com'),
('SK에코플랜트', '국내', '대한민국', '건설', '박과장', '02-3456-7890', 'park@skeco.com'),
('GS E&R', '국내', '대한민국', '에너지', '정상무', '02-4567-8901', 'jung@gsenr.com'),
('SK이노베이션', '국내', '대한민국', '에너지', '최부장', '02-5678-9012', 'choi@skinc.com'),
('한국남부발전', '국내', '대한민국', '발전', '한차장', '051-111-2222', 'han@kospo.kr'),
('두산에너빌리티', '국내', '대한민국', '에너지', '강부장', '055-333-4444', 'kang@doosan.com'),
('VPL Corp', '해외', '베트남', '에너지', 'Nguyen Van', '+84-28-1234-5678', 'nguyen@vpl.vn'),
('ReNew Power', '해외', '인도', '에너지', 'Rajesh Kumar', '+91-11-2345-6789', 'rajesh@renew.in'),
('AGL Energy', '해외', '호주', '에너지', 'David Smith', '+61-2-3456-7890', 'david@agl.au'),
('SoftBank Energy', '해외', '일본', '에너지', 'Tanaka Hiroshi', '+81-3-4567-8901', 'tanaka@sbe.jp');

-- 상품 / 원가 (OnERP 연동 항목)
INSERT INTO products (name, category, unit, current_price, currency, previous_price, change_pct, last_updated) VALUES
('폴리실리콘 (Poly-Si)', '원자재', '$/kg', 7.8200, 'USD', 7.2980, 7.15, '2025-04-28'),
('웨이퍼 (Mono PERC)', '원자재', '$/개', 0.1420, 'USD', 0.1450, -2.07, '2025-04-25'),
('태양광 셀 (TOPCon)', '원자재', '$/W', 0.0680, 'USD', 0.0680, 0.00, '2025-04-20'),
('태양광 모듈 (500W)', '모듈', '$/장', 94.5000, 'USD', 91.0500, 3.79, '2025-04-28'),
('인버터 (100kW)', '부품', '₩/대', 4820000.00, 'KRW', 4888000.00, -1.39, '2025-04-22'),
('리튬 배터리 셀 (LFP)', '원자재', '$/kWh', 68.4000, 'USD', 72.1500, -5.20, '2025-04-28'),
('설치 인건비 (현장)', '인건비', '₩/인일', 185000.00, 'KRW', 180400.00, 2.55, '2025-04-01'),
('가대/구조물 (지상형)', '부품', '₩/kW', 78000.00, 'KRW', 76000.00, 2.63, '2025-04-15'),
('케이블/전선 (DC)', '부품', '₩/m', 4200.00, 'KRW', 4150.00, 1.20, '2025-04-10');

-- 원가 변동 이력 (최근 3개월)
INSERT INTO cost_history (product_id, price, recorded_at) VALUES
(1, 7.28, '2025-02-01'), (1, 7.35, '2025-02-15'), (1, 7.42, '2025-03-01'),
(1, 7.55, '2025-03-15'), (1, 7.68, '2025-04-01'), (1, 7.82, '2025-04-28'),
(4, 90.10, '2025-02-01'), (4, 90.80, '2025-02-15'), (4, 91.20, '2025-03-01'),
(4, 92.00, '2025-03-15'), (4, 93.10, '2025-04-01'), (4, 94.50, '2025-04-28');

-- 영업 리드 (파이프라인 단계별)
INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, capacity_mw, expected_amount, currency, stage, assigned_to, expected_close_date, bidding_deadline, notes) VALUES
(1, '한국동서발전', '30MW 태양광 EPC', 'EPC', '국내', 30.00, 88.00, 'KRW', 'bidding', 2, '2025-05-01', '2025-05-01', '입찰 마감 D-3'),
(2, '한화에너지', '충남 50MW 모듈 공급', '모듈', '국내', 50.00, 67.00, 'KRW', 'proposal', 1, '2025-06-15', NULL, '제안서 제출 완료'),
(9, 'ReNew Power', '라자스탄 200MW 모듈', '모듈', '해외', 200.00, 7280.00, 'USD', 'proposal', 2, '2025-07-30', NULL, '$52M 견적 진행중'),
(3, 'SK에코플랜트', '경북 상주 20MW 태양광', '태양광', '국내', 20.00, 42.00, 'KRW', 'lead', 1, '2025-09-01', NULL, '초기 접촉 단계'),
(4, 'GS E&R', '전남 해남 100MW EPC', 'EPC', '국내', 100.00, 220.00, 'KRW', 'review', 3, '2025-10-30', NULL, '기술 미팅 일정 조율중'),
(10, 'AGL Energy', 'NSW 80MW 모듈 공급', '모듈', '해외', 80.00, 4760.00, 'AUD', 'negotiation', 3, '2025-05-20', NULL, 'A$34M 협상중'),
(5, 'SK이노베이션', '울산 공장 지붕형 태양광', '설치', '국내', 5.00, 15.00, 'KRW', 'negotiation', 2, '2025-05-10', NULL, '계약 직전 단계'),
(8, 'VPL Corp', '호치민 50MW 태양광', '태양광', '해외', 50.00, 3920.00, 'USD', 'lead', 3, '2025-12-01', NULL, '베트남 초기 컨택'),
(6, '한국남부발전', '제주 해상풍력 연계 ESS', 'ESS', '국내', 0, 85.00, 'KRW', 'lead', 5, '2025-11-15', NULL, '연계 기술 검토중'),
(7, '두산에너빌리티', '부산 ESS 연계형 10MWh', 'ESS', '국내', 0, 31.00, 'KRW', 'proposal', 5, '2025-08-01', NULL, '견적 검토중'),
(11, 'SoftBank Energy', '도쿄 지역 전력망 공급', '전기', '해외', 0, 36400.00, 'JPY', 'review', 1, '2025-09-20', NULL, '¥4.2B 규모'),
(NULL, '한국서부발전', '새만금 100MW 태양광 EPC', 'EPC', '국내', 100.00, 241.00, 'KRW', 'bidding', 1, '2025-05-15', '2025-05-15', '대형 입찰 진행중'),
(NULL, '충남 태안 ESS', 'ESS 10MWh 공급', 'ESS', '국내', 0, 18.40, 'KRW', 'won', 2, '2025-04-27', NULL, '수주 완료'),
(NULL, '경기 안성 발전소', '20MW 태양광 (취소)', '태양광', '국내', 20.00, 34.00, 'KRW', 'dropped', 6, '2025-04-25', NULL, '예산 미확보로 드롭');

-- 프로젝트 (수주 완료 후)
INSERT INTO projects (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct, status, due_date, assigned_to) VALUES
('충남 태안 ESS 10MWh', '한국남부발전', 'ESS', 18.40, 14.20, 22.83, '진행중', '2025-09-30', 2),
('전북 군산 30MW EPC', '한국중부발전', '태양광', 72.00, 58.60, 18.61, '납기지연', '2025-04-30', 1),
('경남 진주 모듈 공급', 'LS Electric', '모듈', 28.00, 21.50, 23.21, '제조중', '2025-06-15', 3);

-- 영업 활동
INSERT INTO activities (lead_id, activity_type, title, content, performed_by) VALUES
(1, '입찰', '한국동서발전 입찰서 제출', '30MW EPC 입찰 서류 제출 완료', 2),
(2, '제안서', '한화에너지 50MW 제안서 제출', '태양광 모듈 공급 견적 제출', 1),
(7, '미팅', 'SK이노베이션 계약 협의', '울산 공장 현장 실사 및 계약 조건 협의', 2),
(13, '수주', '충남 태안 ESS 수주 완료', '계약금액 ₩18.4억', 2),
(14, '드롭', '경기 안성 프로젝트 드롭', '예산 미확보로 연기', 6),
(8, '전화', 'VPL Corp 초기 컨택', '베트남 호치민 사이트 50MW 가능성 논의', 3),
(5, '미팅', 'GS E&R 기술 미팅', '해남 100MW EPC 사양 검토', 3);

-- =====================================================
-- 완료
-- =====================================================
SELECT '✅ OCI CRM Database 초기화 완료' AS message;
SELECT
  (SELECT COUNT(*) FROM team_members) AS '팀원',
  (SELECT COUNT(*) FROM customers) AS '고객사',
  (SELECT COUNT(*) FROM leads) AS '리드',
  (SELECT COUNT(*) FROM products) AS '원가항목',
  (SELECT COUNT(*) FROM projects) AS '프로젝트',
  (SELECT COUNT(*) FROM activities) AS '활동';
