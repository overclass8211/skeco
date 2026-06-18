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
  team VARCHAR(50) COMMENT '식각가스/프리커서/디스플레이소재/포토소재/통합서비스/해외영업',
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
  business_type ENUM('식각가스', '프리커서', 'Wet Chemical', '디스플레이소재', '포토소재', '통합서비스') DEFAULT '식각가스',
  region ENUM('국내', '해외') DEFAULT '국내',
  capacity_mw DECIMAL(10,2) COMMENT '용량 (MW)',
  expected_amount DECIMAL(15,2) COMMENT '예상 금액 (억원)',
  currency VARCHAR(10) DEFAULT 'KRW',
  stage ENUM('lead','review','proposal','bidding','negotiation','won','lost','dropped') DEFAULT 'lead',
  win_probability TINYINT UNSIGNED NULL COMMENT '딜별 수주확률 override(%) — NULL이면 단계 기본값',
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
  category VARCHAR(50) COMMENT '식각가스/프리커서/Wet Chemical/디스플레이 소재/포토소재/통합서비스',
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
  activity_date DATETIME NULL COMMENT '활동 예정/수행일 (캘린더 연동)',
  calendar_event_id INT NULL COMMENT '연결된 캘린더 이벤트',
  status VARCHAR(20) DEFAULT 'planned' COMMENT 'planned | done',
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

-- 팀원 (SK에코플랜트 머티리얼즈 반도체·디스플레이 소재 영업조직)
INSERT INTO team_members (name, role, team, email, avatar_color) VALUES
('이식각', 'Sales', '식각가스', 'lee.etch@skecomaterials.com', '#EA002C'),
('박전구체', 'Sales', '프리커서', 'park.precursor@skecomaterials.com', '#1e5fe8'),
('정디스플', 'Field', '디스플레이소재', 'jung.display@skecomaterials.com', '#7c4dff'),
('김포토', 'Sales', '포토소재', 'kim.photo@skecomaterials.com', '#17a85a'),
('최통합', 'Sales', '통합서비스', 'choi.svc@skecomaterials.com', '#F58220'),
('한해외', 'Field', '해외영업', 'han.global@skecomaterials.com', '#e83535'),
('윤웨트', 'Sales', 'Wet Chemical', 'yoon.wet@skecomaterials.com', '#0ea5e9'),
('서기술', 'CS', '기술지원', 'seo.tech@skecomaterials.com', '#10b981');

-- 고객사 (반도체·디스플레이 제조사)
INSERT INTO customers (name, region, country, industry, contact_person, phone, email) VALUES
('삼성전자', '국내', '대한민국', '반도체', '김상무', '031-200-1114', 'kim@samsung.com'),
('SK하이닉스', '국내', '대한민국', '반도체', '이부장', '031-630-4114', 'lee@skhynix.com'),
('삼성디스플레이', '국내', '대한민국', '디스플레이', '박팀장', '041-535-1114', 'park@samsung.com'),
('LG디스플레이', '국내', '대한민국', '디스플레이', '정수석', '02-3777-1114', 'jung@lgdisplay.com'),
('DB하이텍', '국내', '대한민국', '반도체(파운드리)', '최과장', '041-630-1114', 'choi@dbhitek.com'),
('키파운드리', '국내', '대한민국', '반도체(파운드리)', '한차장', '043-270-1114', 'han@keyfoundry.com'),
('Micron', '해외', '미국', '반도체', 'John Carter', '+1-208-368-4000', 'jcarter@micron.com'),
('BOE', '해외', '중국', '디스플레이', 'Wang Lei', '+86-10-6436-8888', 'wanglei@boe.com'),
('TCL CSOT', '해외', '중국', '디스플레이', 'Li Hua', '+86-755-3331-8888', 'lihua@tcl.com'),
('Kioxia', '해외', '일본', '반도체', 'Sato Kenji', '+81-3-6478-2700', 'sato@kioxia.com'),
('Intel', '해외', '미국', '반도체', 'Mark Davis', '+1-408-765-8080', 'mdavis@intel.com');

-- 상품 / 단가 (반도체·디스플레이 핵심소재 — OnERP 연동 항목)
INSERT INTO products (name, category, unit, current_price, currency, previous_price, change_pct, last_updated) VALUES
('식각가스 C4F6', '식각가스', '$/kg', 1250.0000, 'USD', 1180.0000, 5.93, '2026-06-10'),
('식각가스 CH3F', '식각가스', '$/kg', 980.0000, 'USD', 1010.0000, -2.97, '2026-06-10'),
('프리커서 Hf 전구체 (HfCl4계)', '프리커서', '$/kg', 4200.0000, 'USD', 3950.0000, 6.33, '2026-06-08'),
('프리커서 Zr 전구체', '프리커서', '$/kg', 3850.0000, 'USD', 3700.0000, 4.05, '2026-06-08'),
('Wet Chemical 고선택비 인산', 'Wet Chemical', '₩/L', 18500.00, 'KRW', 17800.00, 3.93, '2026-06-05'),
('OLED 블루 도판트', '디스플레이 소재', '₩/g', 4200000.00, 'KRW', 4350000.00, -3.45, '2026-06-05'),
('HTL 정공수송층 소재', '디스플레이 소재', '₩/g', 1850000.00, 'KRW', 1790000.00, 3.35, '2026-06-02'),
('ArF 포토레지스트 (PR)', '포토소재', '₩/L', 9800000.00, 'KRW', 9500000.00, 3.16, '2026-06-09'),
('SOC 하드마스크', '포토소재', '₩/kg', 2750000.00, 'KRW', 2680000.00, 2.61, '2026-06-09');

-- 단가 변동 이력 (최근 3개월) — product 1: C4F6, product 4: Zr 전구체
INSERT INTO cost_history (product_id, price, recorded_at) VALUES
(1, 1120.00, '2026-03-10'), (1, 1150.00, '2026-04-10'), (1, 1180.00, '2026-05-10'),
(1, 1210.00, '2026-05-25'), (1, 1230.00, '2026-06-05'), (1, 1250.00, '2026-06-10'),
(4, 3600.00, '2026-03-08'), (4, 3650.00, '2026-04-08'), (4, 3700.00, '2026-05-08'),
(4, 3780.00, '2026-05-25'), (4, 3820.00, '2026-06-05'), (4, 3850.00, '2026-06-08');

-- 영업 리드 (파이프라인 단계별) — capacity_mw 미사용(소재사업) → 0
INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, capacity_mw, expected_amount, currency, stage, assigned_to, expected_close_date, bidding_deadline, notes) VALUES
(1, '삼성전자', '평택 P4 식각가스 C4F6 연간공급', '식각가스', '국내', 0, 120.00, 'KRW', 'bidding', 1, '2026-07-15', '2026-07-10', '연간 단가계약 입찰 진행'),
(2, 'SK하이닉스', 'M16 프리커서 Hf 전구체 공급', '프리커서', '국내', 0, 95.00, 'KRW', 'proposal', 2, '2026-08-20', NULL, 'DRAM 미세공정용 제안서 제출'),
(3, '삼성디스플레이', 'A6 OLED 블루도판트 공급', '디스플레이소재', '국내', 0, 60.00, 'KRW', 'proposal', 3, '2026-08-30', NULL, '고효율 발광소재 평가 통과'),
(4, 'LG디스플레이', '파주 HTL/ETL 소재 평가', '디스플레이소재', '국내', 0, 28.00, 'KRW', 'review', 3, '2026-10-30', NULL, '패널 신뢰성 평가 진행중'),
(1, '삼성전자', '화성 ArF PR 국산화 PoC', '포토소재', '국내', 0, 45.00, 'KRW', 'lead', 4, '2026-11-01', NULL, '국산화 초기 검토'),
(2, 'SK하이닉스', '청주 Wet Chemical 고선택비 인산', 'Wet Chemical', '국내', 0, 38.00, 'KRW', 'negotiation', 7, '2026-07-20', NULL, '단가 협상 진행중'),
(7, 'Micron', 'Hiroshima 식각가스 CH3F 공급', '식각가스', '해외', 0, 70.00, 'KRW', 'proposal', 6, '2026-09-30', NULL, '약 $5.2M 규모 견적 진행'),
(8, 'BOE', 'B12 OLED 소재 패키지', '디스플레이소재', '해외', 0, 42.00, 'KRW', 'lead', 6, '2026-12-01', NULL, '중국 패널사 초기 컨택'),
(5, 'DB하이텍', '부천 식각가스 통합공급(BSGS)', '통합서비스', '국내', 0, 52.00, 'KRW', 'negotiation', 5, '2026-07-25', NULL, 'Gas+물류 통합 패키지'),
(10, 'Kioxia', 'Yokkaichi 프리커서 Zr 공급', '프리커서', '해외', 0, 40.00, 'KRW', 'proposal', 6, '2026-09-10', NULL, '3D NAND 적층공정 대응'),
(11, 'Intel', 'Arizona SOC 하드마스크 공급', '포토소재', '해외', 0, 80.00, 'KRW', 'review', 1, '2026-10-15', NULL, 'EUV 공정 평가 협의'),
(NULL, '삼성전자 평택 P5', 'BSGS 통합서비스 + Gas 패키지', '통합서비스', '국내', 0, 180.00, 'KRW', 'bidding', 5, '2026-07-18', '2026-07-12', '대형 통합공급 입찰'),
(NULL, '삼성디스플레이 A5', 'OLED 블루도판트 초도물량', '디스플레이소재', '국내', 0, 24.00, 'KRW', 'won', 3, '2026-05-30', NULL, '초도물량 수주 완료'),
(NULL, '중국 신규 패널사', 'T9 식각가스 (보류)', '식각가스', '해외', 0, 30.00, 'KRW', 'dropped', 6, '2026-05-20', NULL, '수출규제 검토로 보류');

-- 프로젝트 (수주 완료 후) — 소재 양산공급
INSERT INTO projects (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct, status, due_date, assigned_to) VALUES
('평택 P4 C4F6 연간공급', '삼성전자', '식각가스', 120.00, 92.00, 23.33, '진행중', '2026-12-31', 1),
('M16 Hf 전구체 양산공급', 'SK하이닉스', '프리커서', 95.00, 74.50, 21.58, '제조중', '2026-09-30', 2),
('A6 OLED 블루도판트 공급', '삼성디스플레이', '디스플레이소재', 60.00, 47.00, 21.67, '진행중', '2026-08-31', 3);

-- 영업 활동
INSERT INTO activities (lead_id, activity_type, title, content, performed_by) VALUES
(1, '입찰', '삼성전자 평택 P4 식각가스 입찰', 'C4F6 연간 단가계약 입찰서 제출', 1),
(2, '제안서', 'SK하이닉스 Hf 전구체 제안서 제출', 'M16 DRAM 미세공정용 프리커서 제안', 2),
(6, '미팅', 'SK하이닉스 Wet Chemical 단가협의', '청주 고선택비 인산 단가 협상 미팅', 7),
(13, '수주', '삼성디스플레이 블루도판트 초도 수주', 'A5 OLED 블루도판트 초도물량 계약', 3),
(14, '드롭', '중국 패널사 식각가스 보류', '수출규제 검토로 진행 보류', 6),
(8, '전화', 'BOE 초기 컨택', 'B12 OLED 소재 패키지 가능성 논의', 6),
(4, '미팅', 'LG디스플레이 소재 평가 미팅', '파주 HTL/ETL 신뢰성 평가 검토', 3);

-- =====================================================
-- 완료
-- =====================================================
SELECT '✅ SK ecoplant materials CRM Database 초기화 완료' AS message;
SELECT
  (SELECT COUNT(*) FROM team_members) AS '팀원',
  (SELECT COUNT(*) FROM customers) AS '고객사',
  (SELECT COUNT(*) FROM leads) AS '리드',
  (SELECT COUNT(*) FROM products) AS '원가항목',
  (SELECT COUNT(*) FROM projects) AS '프로젝트',
  (SELECT COUNT(*) FROM activities) AS '활동';
