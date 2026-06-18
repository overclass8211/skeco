-- ============================================================
-- OCI CRM AI — Database DDL
-- Database  : oci_crm
-- Engine    : MySQL 8.x / MariaDB
-- Charset   : utf8mb4 / utf8mb4_general_ci
-- Generated : 2026-05-09
-- ============================================================

CREATE DATABASE IF NOT EXISTS `oci_crm`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE `oci_crm`;

-- ============================================================
-- 1. users — 시스템 로그인 계정
-- ============================================================
CREATE TABLE `users` (
  `id`               INT(11)      NOT NULL AUTO_INCREMENT,
  `username`         VARCHAR(50)  NOT NULL,
  `email`            VARCHAR(100) DEFAULT NULL,
  `password_hash`    VARCHAR(255) NOT NULL,
  `full_name`        VARCHAR(100) DEFAULT NULL,
  `role`             ENUM('manager','team_lead','executive','superadmin') DEFAULT 'manager',
  `is_active`        TINYINT(1)   DEFAULT 1,
  `otp_secret`       VARCHAR(100) DEFAULT NULL,
  `otp_enabled`      TINYINT(1)   DEFAULT 0,
  `webauthn_cred_id` VARCHAR(500) DEFAULT NULL,
  `last_login`       DATETIME     DEFAULT NULL,
  `department`       VARCHAR(100) DEFAULT NULL,
  `avatar_url`       VARCHAR(255) DEFAULT NULL,
  `created_at`       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email`    (`email`),
  KEY `idx_username`    (`username`),
  KEY `idx_email`       (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 2. team_members — 영업팀 구성원
-- ============================================================
CREATE TABLE `team_members` (
  `id`                  INT(11)     NOT NULL AUTO_INCREMENT,
  `name`                VARCHAR(50) NOT NULL,
  `role`                ENUM('CS','Field','Sales') NOT NULL,
  `team`                VARCHAR(50) DEFAULT NULL COMMENT '태양광/전기ESS/해외',
  `email`               VARCHAR(100) DEFAULT NULL,
  `phone`               VARCHAR(50)  DEFAULT NULL,
  `avatar_color`        VARCHAR(20)  DEFAULT '#E63329',
  `is_active`           TINYINT(1)   DEFAULT 1,
  `monthly_token_limit` INT(11)      DEFAULT NULL,
  `created_at`          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role` (`role`),
  KEY `idx_team` (`team`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 3. customers — 고객사
-- ============================================================
CREATE TABLE `customers` (
  `id`             INT(11)      NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(200) NOT NULL,
  `region`         ENUM('국내','해외') DEFAULT '국내',
  `country`        VARCHAR(50)  DEFAULT NULL,
  `industry`       VARCHAR(100) DEFAULT NULL,
  `contact_person` VARCHAR(100) DEFAULT NULL,
  `phone`          VARCHAR(50)  DEFAULT NULL,
  `email`          VARCHAR(100) DEFAULT NULL,
  `address`        VARCHAR(500) DEFAULT NULL,
  `notes`          TEXT         DEFAULT NULL,
  `created_at`     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_region` (`region`),
  KEY `idx_name`   (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 4. leads — 영업 기회 (파이프라인 핵심 테이블)
-- ============================================================
CREATE TABLE `leads` (
  `id`                  INT(11)      NOT NULL AUTO_INCREMENT,
  `customer_id`         INT(11)      DEFAULT NULL,
  `customer_name`       VARCHAR(200) NOT NULL,
  `project_name`        VARCHAR(300) NOT NULL,
  `business_type`       ENUM('태양광','모듈','EPC','ESS','전기','설치') DEFAULT '태양광',
  `region`              ENUM('국내','해외') DEFAULT '국내',
  `capacity_mw`         DECIMAL(10,2) DEFAULT NULL COMMENT '용량 (MW)',
  `expected_amount`     DECIMAL(15,2) DEFAULT NULL COMMENT '예상 금액 (억원)',
  `currency`            VARCHAR(10)   DEFAULT 'KRW',
  `stage`               ENUM('lead','review','proposal','bidding','negotiation','won','lost','dropped') DEFAULT 'lead',
  `assigned_to`         INT(11)       DEFAULT NULL,
  `expected_close_date` DATE          DEFAULT NULL,
  `bidding_deadline`    DATE          DEFAULT NULL,
  `source`              VARCHAR(100)  DEFAULT NULL COMMENT '리드 소스 (전시회/소개/웹사이트 등)',
  `notes`               TEXT          DEFAULT NULL,
  `created_at`          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_id`    (`customer_id`),
  KEY `idx_stage`          (`stage`),
  KEY `idx_region`         (`region`),
  KEY `idx_assigned`       (`assigned_to`),
  KEY `idx_business`       (`business_type`),
  KEY `idx_stage_updated`  (`stage`, `updated_at`),
  KEY `idx_assigned_stage` (`assigned_to`, `stage`),
  CONSTRAINT `leads_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `leads_ibfk_2` FOREIGN KEY (`assigned_to`) REFERENCES `team_members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 5. projects — 수주 프로젝트 (납기/원가 관리)
-- ============================================================
CREATE TABLE `projects` (
  `id`              INT(11)      NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(300) NOT NULL,
  `customer_id`     INT(11)      DEFAULT NULL,
  `customer_name`   VARCHAR(200) DEFAULT NULL,
  `project_type`    VARCHAR(50)  DEFAULT NULL,
  `contract_amount` DECIMAL(15,2) DEFAULT NULL COMMENT '계약금액 (억원)',
  `estimated_cost`  DECIMAL(15,2) DEFAULT NULL COMMENT '산정 원가 (억원)',
  `margin_pct`      DECIMAL(6,2)  DEFAULT NULL COMMENT '마진율(%)',
  `status`          ENUM('진행중','제조중','납기지연','완료','취소') DEFAULT '진행중',
  `due_date`        DATE          DEFAULT NULL,
  `assigned_to`     INT(11)       DEFAULT NULL,
  `lead_id`         INT(11)       DEFAULT NULL,
  `notes`           TEXT          DEFAULT NULL,
  `created_at`      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_assigned_to` (`assigned_to`),
  KEY `idx_lead_id`     (`lead_id`),
  KEY `idx_status`      (`status`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`assigned_to`) REFERENCES `team_members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `projects_ibfk_3` FOREIGN KEY (`lead_id`)     REFERENCES `leads` (`id`)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 6. activities — 영업 활동 이력
-- ============================================================
CREATE TABLE `activities` (
  `id`                INT(11)      NOT NULL AUTO_INCREMENT,
  `lead_id`           INT(11)      DEFAULT NULL,
  `project_id`        INT(11)      DEFAULT NULL,
  `activity_type`     VARCHAR(50)  DEFAULT 'note',
  `title`             VARCHAR(300) DEFAULT NULL,
  `content`           TEXT         DEFAULT NULL,
  `performed_by`      INT(11)      DEFAULT NULL,
  `performed_at`      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  `activity_date`     DATETIME     DEFAULT NULL,
  `calendar_event_id` INT(11)      DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lead`          (`lead_id`),
  KEY `idx_project`       (`project_id`),
  KEY `idx_performed_by`  (`performed_by`),
  KEY `idx_performed_at`  (`performed_at`),
  KEY `idx_lead_performed`(`lead_id`, `performed_at`),
  CONSTRAINT `activities_ibfk_1` FOREIGN KEY (`lead_id`)      REFERENCES `leads`        (`id`) ON DELETE CASCADE,
  CONSTRAINT `activities_ibfk_2` FOREIGN KEY (`project_id`)   REFERENCES `projects`     (`id`) ON DELETE CASCADE,
  CONSTRAINT `activities_ibfk_3` FOREIGN KEY (`performed_by`) REFERENCES `team_members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 7. calendar_events — 영업 캘린더 일정
-- ============================================================
CREATE TABLE `calendar_events` (
  `id`             INT(11)      NOT NULL AUTO_INCREMENT,
  `title`          VARCHAR(200) NOT NULL,
  `description`    TEXT         DEFAULT NULL,
  `start_datetime` DATETIME     NOT NULL,
  `end_datetime`   DATETIME     DEFAULT NULL,
  `all_day`        TINYINT(1)   DEFAULT 0,
  `event_type`     VARCHAR(20)  DEFAULT '기타' COMMENT '미팅/영업방문/입찰/제안/내부/기타',
  `lead_id`        INT(11)      DEFAULT NULL,
  `customer_name`  VARCHAR(200) DEFAULT NULL,
  `assigned_to`    INT(11)      DEFAULT NULL,
  `color`          VARCHAR(20)  DEFAULT '#e63946',
  `recurrence`     VARCHAR(100) DEFAULT NULL,
  `status`         VARCHAR(20)  DEFAULT 'planned' COMMENT 'planned/completed',
  `created_at`     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_start_datetime` (`start_datetime`),
  KEY `idx_assignee_start` (`assigned_to`, `start_datetime`),
  KEY `idx_customer`       (`customer_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 8. meeting_minutes — AI 회의록
-- ============================================================
CREATE TABLE `meeting_minutes` (
  `id`                 INT(11)      NOT NULL AUTO_INCREMENT,
  `title`              VARCHAR(300) NOT NULL,
  `meeting_date`       DATE         DEFAULT NULL,
  `audio_filename`     VARCHAR(300) DEFAULT NULL,
  `audio_duration_sec` INT(11)      DEFAULT NULL,
  `raw_transcript`     MEDIUMTEXT   DEFAULT NULL,
  `speakers_json`      MEDIUMTEXT   DEFAULT NULL,
  `summary_md`         MEDIUMTEXT   DEFAULT NULL,
  `agenda`             TEXT         DEFAULT NULL,
  `key_points`         TEXT         DEFAULT NULL,
  `action_items`       TEXT         DEFAULT NULL,
  `customer_name`      VARCHAR(200) DEFAULT NULL,
  `lead_id`            INT(11)      DEFAULT NULL,
  `calendar_event_id`  INT(11)      DEFAULT NULL,
  `created_by`         INT(11)      DEFAULT NULL,
  `created_at`         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_meeting_date` (`meeting_date`),
  KEY `idx_customer`     (`customer_name`),
  KEY `idx_created_at`   (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 9. products — 원자재/상품 단가 관리
-- ============================================================
CREATE TABLE `products` (
  `id`             INT(11)       NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(150)  NOT NULL,
  `category`       VARCHAR(50)   DEFAULT NULL COMMENT '원자재/모듈/부품/인건비',
  `unit`           VARCHAR(20)   DEFAULT NULL COMMENT '$/kg, $/장, ₩/대 등',
  `current_price`  DECIMAL(15,4) DEFAULT NULL,
  `currency`       VARCHAR(10)   DEFAULT 'USD',
  `previous_price` DECIMAL(15,4) DEFAULT NULL,
  `change_pct`     DECIMAL(6,2)  DEFAULT NULL COMMENT '전월 대비 변동률(%)',
  `last_updated`   DATE          DEFAULT NULL,
  `notes`          TEXT          DEFAULT NULL,
  `created_at`     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 10. cost_history — 원자재 가격 이력
-- ============================================================
CREATE TABLE `cost_history` (
  `id`          INT(11)       NOT NULL AUTO_INCREMENT,
  `product_id`  INT(11)       NOT NULL,
  `price`       DECIMAL(15,4) NOT NULL,
  `recorded_at` DATE          NOT NULL,
  `notes`       VARCHAR(255)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_product_date` (`product_id`, `recorded_at`),
  CONSTRAINT `cost_history_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 11. announcements — 게시판 공지사항
-- ============================================================
CREATE TABLE `announcements` (
  `id`         INT(11)      NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(300) NOT NULL,
  `content`    TEXT         NOT NULL,
  `is_pinned`  TINYINT(1)   DEFAULT 0,
  `created_by` INT(11)      DEFAULT NULL,
  `created_at` TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 12. comments — 게시판 댓글 (공통 참조)
-- ============================================================
CREATE TABLE `comments` (
  `id`          INT(11)      NOT NULL AUTO_INCREMENT,
  `ref_type`    VARCHAR(30)  NOT NULL COMMENT '참조 대상 유형 (announcement/lead 등)',
  `ref_id`      INT(11)      NOT NULL COMMENT '참조 대상 ID',
  `content`     TEXT         NOT NULL,
  `author_name` VARCHAR(100) DEFAULT NULL,
  `created_at`  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 13. faq — 자주 묻는 질문
-- ============================================================
CREATE TABLE `faq` (
  `id`         INT(11)     NOT NULL AUTO_INCREMENT,
  `question`   TEXT        NOT NULL,
  `answer`     TEXT        NOT NULL,
  `category`   VARCHAR(50) DEFAULT '기타',
  `created_at` TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 14. ai_usage — AI 토큰 사용량 로그
-- ============================================================
CREATE TABLE `ai_usage` (
  `id`                INT(11)     NOT NULL AUTO_INCREMENT,
  `user_id`           INT(11)     DEFAULT NULL,
  `endpoint`          VARCHAR(100) DEFAULT NULL,
  `prompt_tokens`     INT(11)      DEFAULT 0,
  `completion_tokens` INT(11)      DEFAULT 0,
  `total_tokens`      INT(11)      DEFAULT 0,
  `model`             VARCHAR(50)  DEFAULT NULL,
  `created_at`        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user`    (`user_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 15. access_logs — API 접근 로그
-- ============================================================
CREATE TABLE `access_logs` (
  `id`          INT(11)      NOT NULL AUTO_INCREMENT,
  `action`      VARCHAR(300) DEFAULT NULL,
  `method`      VARCHAR(10)  DEFAULT NULL,
  `path`        VARCHAR(500) DEFAULT NULL,
  `ip`          VARCHAR(60)  DEFAULT NULL,
  `status_code` INT(11)      DEFAULT NULL,
  `duration_ms` INT(11)      DEFAULT NULL,
  `created_at`  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- 16. system_settings — 시스템 설정 (Key-Value)
-- ============================================================
CREATE TABLE `system_settings` (
  `setting_key`   VARCHAR(50)  NOT NULL,
  `setting_value` VARCHAR(255) DEFAULT NULL,
  `updated_at`    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- DML — 초기 기준 데이터 (시스템 설정)
-- ============================================================
INSERT INTO `system_settings` (`setting_key`, `setting_value`) VALUES
  ('ai_model',        'claude-opus-4-5'),
  ('default_currency','KRW');
