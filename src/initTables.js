const pool = require('./db');

async function initTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      title          VARCHAR(200) NOT NULL,
      description    TEXT,
      start_datetime DATETIME NOT NULL,
      end_datetime   DATETIME,
      all_day        TINYINT(1) DEFAULT 0,
      event_type     VARCHAR(20) DEFAULT '기타',
      status         VARCHAR(20) DEFAULT 'planned',
      lead_id        INT,
      customer_name  VARCHAR(200),
      assigned_to    INT,
      color          VARCHAR(20) DEFAULT '#e63946',
      recurrence     VARCHAR(100),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    try {
      await pool.query(
        `ALTER TABLE calendar_events ADD COLUMN status VARCHAR(20) DEFAULT 'planned'`
      );
    } catch (_) {
      /* column may already exist */
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS announcements (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(300) NOT NULL,
      content    TEXT NOT NULL,
      is_pinned  TINYINT(1) DEFAULT 0,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS comments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ref_type    VARCHAR(30) NOT NULL,
      ref_id      INT NOT NULL,
      content     TEXT NOT NULL,
      author_name VARCHAR(100),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ref (ref_type, ref_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS faq (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      category   VARCHAR(50) DEFAULT '기타',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS access_logs (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      action      VARCHAR(300),
      method      VARCHAR(10),
      path        VARCHAR(500),
      ip          VARCHAR(60),
      status_code INT,
      duration_ms INT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS meeting_minutes (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      title              VARCHAR(300) NOT NULL,
      meeting_date       DATE,
      audio_filename     VARCHAR(300),
      audio_duration_sec INT,
      raw_transcript     MEDIUMTEXT,
      speakers_json      MEDIUMTEXT,
      summary_md         MEDIUMTEXT,
      agenda             TEXT,
      key_points         TEXT,
      action_items       TEXT,
      customer_name      VARCHAR(200),
      lead_id            INT NULL,
      calendar_event_id  INT NULL,
      created_by         INT NULL,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_meeting_date (meeting_date),
      INDEX idx_customer (customer_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      user_id           INT NULL,
      endpoint          VARCHAR(100),
      prompt_tokens     INT DEFAULT 0,
      completion_tokens INT DEFAULT 0,
      total_tokens      INT DEFAULT 0,
      model             VARCHAR(50),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    try {
      await pool.query(`ALTER TABLE ai_usage ADD COLUMN user_id INT NULL AFTER id`);
    } catch (_) {
      /* column may already exist */
    }
    try {
      await pool.query(`ALTER TABLE ai_usage ADD INDEX idx_user (user_id)`);
    } catch (_) {
      /* index may already exist */
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
      setting_key   VARCHAR(50) PRIMARY KEY,
      setting_value TEXT,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
        ('idle_timeout_min', '30'),
        ('default_monthly_token_limit', '500000')`
    );

    // 자가 마이그레이션: setting_value VARCHAR(255) → TEXT (임원 AI 브리핑 등 긴 JSON 캐시)
    try {
      const [[col]] = await pool.query(
        `SELECT DATA_TYPE dt FROM information_schema.columns
          WHERE table_schema=DATABASE() AND table_name='system_settings' AND column_name='setting_value'`
      );
      if (col && String(col.dt).toLowerCase() === 'varchar') {
        await pool.query(`ALTER TABLE system_settings MODIFY setting_value TEXT`);
        console.log('[system_settings:migration] setting_value VARCHAR → TEXT 확장 완료');
      }
    } catch (e) {
      console.warn('[system_settings:migration] setting_value 확장 skip:', e.message);
    }

    try {
      await pool.query(`ALTER TABLE team_members ADD COLUMN monthly_token_limit INT NULL`);
    } catch (_) {
      /* column may already exist */
    }

    // ── 메뉴 구조 설정 (관리자가 사이드바 순서/가시성/라벨 커스터마이즈) ──
    await pool.query(`CREATE TABLE IF NOT EXISTS menu_sections (
      section_key   VARCHAR(50) PRIMARY KEY,
      section_label VARCHAR(100) NOT NULL,
      display_order INT DEFAULT 0,
      is_visible    TINYINT DEFAULT 1,
      is_system     TINYINT DEFAULT 0,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (
      menu_key       VARCHAR(50) PRIMARY KEY,
      section_key    VARCHAR(50) NOT NULL,
      display_order  INT DEFAULT 0,
      is_visible     TINYINT DEFAULT 1,
      label_override VARCHAR(100) DEFAULT NULL,
      is_system      TINYINT DEFAULT 0,
      updated_by     INT NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_section_order (section_key, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 동적 매핑 (관리자가 우클릭 → 매핑 추가) ──────────────
    // 정적 카탈로그(DFD.tables/a2t) 외의 신규 테이블을 API 와 연결
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_mappings (
      table_name VARCHAR(100) PRIMARY KEY,
      api_keys   TEXT NOT NULL COMMENT 'JSON array e.g. ["api-leads","api-admin"]',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 무시 목록 (관리자가 알림만 끄고 매핑은 안 함) ────────
    // 미분류 테이블 중 "확인은 했지만 매핑할 필요 없음" 으로 표시한 항목
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_dismissed (
      table_name   VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD API 동적 매핑 (테이블과 동일 패턴 — API → 페이지) ─────
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_api_mappings (
      api_id     VARCHAR(100) PRIMARY KEY COMMENT 'e.g. api-leads, api-exchange',
      page_keys  TEXT NOT NULL COMMENT 'JSON array e.g. ["pg-dashboard","pg-admin"]',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_api_dismissed (
      api_id       VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 페이지 동적 메타 + 매핑 (API/테이블과 동일 패턴) ─────
    // 신규 발견된 페이지 파일에 대한 라벨·아이콘·API 매핑 저장
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_page_mappings (
      page_id    VARCHAR(100) PRIMARY KEY,
      label      VARCHAR(100) NULL COMMENT '사용자 정의 표시명 (NULL=파일명 기반)',
      icon       VARCHAR(20)  NULL COMMENT '사용자 정의 이모지',
      api_keys   TEXT NULL COMMENT 'JSON array — 이 페이지가 호출하는 API 들',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_page_dismissed (
      page_id      VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 스키마 스냅샷 영구 저장 (변경 이력 비교 baseline) ──────────
    // 메모리 기반 _lastSnap 의 단점(페이지 새로고침 시 초기화) 해결
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_snapshots (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      snapshot_json LONGTEXT NOT NULL,
      recorded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      recorded_by   INT NULL,
      INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 소스 모니터 스냅샷 (추이 추적용) ──────────────────────
    // Phase 1-3 의 통계를 시계열로 저장 → 그래프/리포트 생성
    await pool.query(`CREATE TABLE IF NOT EXISTS source_monitor_snapshots (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      total_files     INT NOT NULL DEFAULT 0,
      total_loc       INT NOT NULL DEFAULT 0,
      total_size      BIGINT NOT NULL DEFAULT 0,
      total_functions INT NULL,
      avg_complexity  DECIMAL(6,2) NULL,
      max_complexity  INT NULL,
      cx_over_10      INT NULL,
      cx_over_20      INT NULL,
      cx_over_50      INT NULL,
      eslint_errors   INT NULL,
      eslint_warnings INT NULL,
      audit_critical  INT NULL,
      audit_high      INT NULL,
      audit_moderate  INT NULL,
      audit_low       INT NULL,
      audit_total     INT NULL,
      categories_json TEXT NULL,    -- by_category 압축 JSON
      recorded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      recorded_by     INT NULL,
      note            VARCHAR(200) NULL,
      INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 운영 헬스맵 — 노드별 트러블슈팅 가이드 ─────────────
    // node_type: 'api' | 'db' | 'external' | 'process' | 'page'
    // node_key:  특정 노드 식별자 (예: '/api/leads', 'db.mariadb', 'ext.gemini')
    //            NULL 이면 node_type 전체에 적용되는 범용 가이드
    // severity:  guide 가 트리거되는 상태 ('warn' | 'critical' | 'down' | 'any')
    await pool.query(`CREATE TABLE IF NOT EXISTS healthmap_guides (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      node_type   VARCHAR(20)  NOT NULL,
      node_key    VARCHAR(200) NULL,
      severity    VARCHAR(20)  NOT NULL DEFAULT 'any',
      title       VARCHAR(200) NOT NULL,
      symptom     TEXT         NULL,
      diagnosis   TEXT         NULL,
      remedy      TEXT         NULL,
      prevention  TEXT         NULL,
      is_system   TINYINT(1)   NOT NULL DEFAULT 0,
      created_by  INT          NULL,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_node (node_type, node_key),
      INDEX idx_severity (severity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 시드 가이드 (시스템) — 일반적인 트러블슈팅 패턴
    const { DEFAULT_HEALTHMAP_GUIDES } = require('./data/healthmapGuideDefaults');
    for (const g of DEFAULT_HEALTHMAP_GUIDES) {
      await pool.query(
        `INSERT INTO healthmap_guides
           (node_type, node_key, severity, title, symptom, diagnosis, remedy, prevention, is_system)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM healthmap_guides
           WHERE node_type <=> ? AND node_key <=> ? AND title = ? AND is_system = 1
         )`,
        [
          g.node_type,
          g.node_key || null,
          g.severity,
          g.title,
          g.symptom,
          g.diagnosis,
          g.remedy,
          g.prevention,
          g.node_type,
          g.node_key || null,
          g.title,
        ]
      );
    }

    // ── 운영 헬스맵 — AI 해석 캐시 (24h TTL) ─────────────────
    // node_key + log_hash 조합으로 같은 패턴 재해석 방지
    await pool.query(`CREATE TABLE IF NOT EXISTS healthmap_ai_cache (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      cache_key    VARCHAR(255) NOT NULL UNIQUE,
      interpretation TEXT         NOT NULL,
      tokens_used  INT          DEFAULT 0,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── Webhook 등록 (외부 시스템 통합) ──────────────────────
    // event_types: JSON array (예: ["lead.won","project.completed"])
    // secret: HMAC-SHA256 서명용
    await pool.query(`CREATE TABLE IF NOT EXISTS webhooks (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(150) NOT NULL,
      url          VARCHAR(500) NOT NULL,
      event_types  TEXT NOT NULL,
      secret       VARCHAR(100) NULL,
      is_active    TINYINT(1) NOT NULL DEFAULT 1,
      failure_count INT NOT NULL DEFAULT 0,
      last_status  VARCHAR(20) NULL,
      last_sent_at TIMESTAMP NULL,
      created_by   INT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── Webhook 발송 로그 ────────────────────────────────────
    // 최근 1,000건 유지 (자동 cleanup)
    await pool.query(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      webhook_id     INT NOT NULL,
      event_type     VARCHAR(50) NOT NULL,
      delivery_id    VARCHAR(50) NOT NULL,
      status         VARCHAR(20) NOT NULL DEFAULT 'pending',
      http_status    INT NULL,
      response_ms    INT NULL,
      attempt        INT NOT NULL DEFAULT 1,
      error_message  VARCHAR(500) NULL,
      payload_preview VARCHAR(500) NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_webhook  (webhook_id, created_at),
      INDEX idx_delivery (delivery_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 이메일 템플릿 — Mailto 발송용 ─────────────────────────
    // 카테고리: lead | customer | project | general
    // is_system=1 시드 템플릿은 수정/삭제 불가 (UI 에서 제한)
    await pool.query(`CREATE TABLE IF NOT EXISTS email_templates (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(150) NOT NULL,
      category     VARCHAR(20)  NOT NULL DEFAULT 'general',
      subject      VARCHAR(300) NOT NULL,
      body         TEXT         NOT NULL,
      is_system    TINYINT(1)   NOT NULL DEFAULT 0,
      created_by   INT          NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_system   (is_system)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 시드 5개 — 한국 B2B 영업 표준 패턴 (시스템 템플릿)
    const { DEFAULT_EMAIL_TEMPLATES } = require('./data/emailTemplateDefaults');
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      // 이름 + is_system 조합으로 중복 방지 — 멱등성
      await pool.query(
        `INSERT INTO email_templates (name, category, subject, body, is_system)
         SELECT ?, ?, ?, ?, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM email_templates WHERE name = ? AND is_system = 1
         )`,
        [t.name, t.category, t.subject, t.body, t.name]
      );
    }

    // 시드 (INSERT IGNORE 로 멱등성 보장 — 기존 설정 덮어쓰지 않음)
    const { DEFAULT_SECTIONS, DEFAULT_ITEMS } = require('./data/menuDefaults');
    for (const s of DEFAULT_SECTIONS) {
      await pool.query(
        `INSERT IGNORE INTO menu_sections (section_key, section_label, display_order, is_visible, is_system)
         VALUES (?, ?, ?, 1, ?)`,
        [s.section_key, s.section_label, s.display_order, s.is_system]
      );
    }
    for (const it of DEFAULT_ITEMS) {
      await pool.query(
        `INSERT IGNORE INTO menu_items (menu_key, section_key, display_order, is_visible, is_system)
         VALUES (?, ?, ?, 1, ?)`,
        [it.menu_key, it.section_key, it.display_order, it.is_system]
      );
    }

    // ── 고객지원(cs) 섹션 위치 보정 (1회 self-heal) ────────────────
    // 구버전 시드 DB 는 cs(display_order=4)가 기존 섹션과 충돌 → 분석 뒤로 밀려 보임.
    // display_order 충돌이 있을 때만 동작 → 영업관리(sales) 직후로 이동.
    // 정상 배치(충돌 없음) 후엔 재실행 안 함 → 관리자 수동 정렬·신규 설치 보존.
    try {
      const [coll] = await pool.query(
        `SELECT 1 FROM menu_sections a
           JOIN menu_sections b ON a.display_order = b.display_order AND b.section_key <> 'cs'
          WHERE a.section_key = 'cs' LIMIT 1`
      );
      if (coll.length) {
        const [salesRows] = await pool.query(
          `SELECT display_order FROM menu_sections WHERE section_key = 'sales'`
        );
        const after = salesRows.length ? salesRows[0].display_order : 2;
        await pool.query(
          `UPDATE menu_sections SET display_order = display_order + 1
            WHERE display_order > ? AND section_key <> 'cs'`,
          [after]
        );
        await pool.query(`UPDATE menu_sections SET display_order = ? WHERE section_key = 'cs'`, [
          after + 1,
        ]);
        console.log('[menu] 고객지원(cs) 섹션을 영업관리 직후로 위치 보정');
      }
    } catch (e) {
      console.warn('[menu] cs 섹션 위치 보정 skip:', e.message);
    }

    // 성능 인덱스 (idempotent)
    const idx = [
      `ALTER TABLE calendar_events ADD INDEX idx_start_datetime (start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_assignee_start (assigned_to, start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_customer (customer_name)`,
      `ALTER TABLE meeting_minutes ADD INDEX idx_created_at (created_at)`,
      `ALTER TABLE leads ADD INDEX idx_stage_updated (stage, updated_at)`,
      `ALTER TABLE leads ADD INDEX idx_assigned_stage (assigned_to, stage)`,
      // v6.0.0: 고객사 카드 "관련 딜" 카운트 (customer_name 매칭) 가속용
      `ALTER TABLE leads ADD INDEX idx_customer_name (customer_name)`,
      `ALTER TABLE activities ADD INDEX idx_lead_performed (lead_id, performed_at)`,
      `ALTER TABLE activities ADD INDEX idx_performed_at (performed_at)`,
    ];
    for (const sql of idx) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (!String(e.message).includes('Duplicate'))
          console.warn('⚠ 인덱스 추가 경고:', e.message);
      }
    }

    // ── PK AUTO_INCREMENT 무결성 보장 (idempotent) ──────────────
    // 과거 외부 마이그레이션으로 AUTO_INCREMENT가 빠진 테이블 자가 복구
    // (예: leads.id AUTO_INCREMENT 누락으로 INSERT 시 "Field 'id' doesn't have a default value" 오류)
    const aiGuards = ['leads'];
    for (const t of aiGuards) {
      try {
        const [cols] = await pool.query('SHOW COLUMNS FROM `' + t + "` WHERE Field='id'");
        if (!cols.length) continue;
        const hasAI = (cols[0].Extra || '').toLowerCase().includes('auto_increment');
        if (!hasAI) {
          const [[m]] = await pool.query('SELECT COALESCE(MAX(id),0)+1 AS next FROM `' + t + '`');
          await pool.query('ALTER TABLE `' + t + '` MODIFY id INT(11) NOT NULL AUTO_INCREMENT');
          await pool.query('ALTER TABLE `' + t + '` AUTO_INCREMENT = ' + m.next);
          console.log('  ✓ ' + t + '.id AUTO_INCREMENT 자가 복구 (시작값=' + m.next + ')');
        }
      } catch (e) {
        console.warn('⚠ AI 가드 경고(' + t + '):', e.message);
      }
    }

    // ── DB 스키마 변경 이력 테이블 ────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_change_log (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      change_type   VARCHAR(20)  NOT NULL,        -- new_table/drop_table/add_col/drop_col/mod_col
      table_name    VARCHAR(100) NOT NULL,
      column_name   VARCHAR(100) DEFAULT NULL,
      risk          VARCHAR(10)  DEFAULT 'LOW',   -- LOW/MEDIUM/HIGH
      message       VARCHAR(500) NOT NULL,
      mitigation    TEXT         DEFAULT NULL,
      before_def    VARCHAR(500) DEFAULT NULL,
      after_def     VARCHAR(500) DEFAULT NULL,
      detected_by   INT          DEFAULT NULL,    -- user id
      changed_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_changed_at (changed_at DESC),
      INDEX idx_table      (table_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 파이프라인 단계 정의 테이블 (사용자 정의) ─────────
    await pool.query(`CREATE TABLE IF NOT EXISTS pipeline_stages (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      stage_key    VARCHAR(50)  NOT NULL UNIQUE,        -- DB 저장 키 (불변)
      label        VARCHAR(100) NOT NULL,                -- 사용자 표시명 (변경 가능)
      role         VARCHAR(20)  NOT NULL DEFAULT 'active',  -- active/won/lost/dropped
      sort_order   INT          NOT NULL DEFAULT 0,
      color        VARCHAR(20)  DEFAULT '#93B4F9',
      win_probability TINYINT UNSIGNED NULL,                -- 매출 포캐스트: 단계 기본 수주확률(%)
      is_active    TINYINT(1)   DEFAULT 1,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_sort (sort_order, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기본 시드 (idempotent — stage_key UNIQUE) · 반도체 소재 영업 단계 라벨
    const defaultStages = [
      {
        key: 'lead',
        label: '발굴/니즈파악',
        role: 'active',
        order: 10,
        color: '#93B4F9',
        prob: 10,
      },
      { key: 'review', label: '샘플 평가', role: 'active', order: 20, color: '#5585F5', prob: 25 },
      {
        key: 'proposal',
        label: 'Spec-in/승인',
        role: 'active',
        order: 30,
        color: '#2357E8',
        prob: 50,
      },
      { key: 'bidding', label: '가격 협의', role: 'active', order: 40, color: '#F59C00', prob: 65 },
      {
        key: 'negotiation',
        label: '공급계약',
        role: 'active',
        order: 50,
        color: '#17A85A',
        prob: 80,
      },
      { key: 'won', label: '양산/정기수주', role: 'won', order: 90, color: '#0F7A3F', prob: 100 },
      { key: 'lost', label: '실주', role: 'lost', order: 95, color: '#6B7280', prob: 0 },
      { key: 'dropped', label: '드롭', role: 'dropped', order: 99, color: '#E63329', prob: 0 },
    ];
    for (const s of defaultStages) {
      await pool.query(
        `INSERT IGNORE INTO pipeline_stages (stage_key, label, role, sort_order, color, win_probability)
         VALUES (?,?,?,?,?,?)`,
        [s.key, s.label, s.role, s.order, s.color, s.prob]
      );
    }
    // 반도체 영업 단계 라벨 적용 (기존 DB) — 옛 기본 라벨일 때만 갱신(관리자 커스텀 보존)
    const stageRelabel = [
      ['lead', '발굴/니즈파악', '리드 발굴'],
      ['review', '샘플 평가', '검토/미팅'],
      ['proposal', 'Spec-in/승인', '제안/견적'],
      ['bidding', '가격 협의', '입찰'],
      ['negotiation', '공급계약', '협상/계약'],
      ['won', '양산/정기수주', '수주 완료'],
    ];
    for (const [key, neu, old] of stageRelabel) {
      await pool.query('UPDATE pipeline_stages SET label=? WHERE stage_key=? AND label=?', [
        neu,
        key,
        old,
      ]);
    }

    // ── 매출 포캐스트: 단계 확률 컬럼/시드 (idempotent) ──────────
    // 기존 DB(컬럼 없음)에 ALTER, NULL 인 단계에 기본 확률 주입(사용자 편집 보존)
    try {
      const [pc] = await pool.query(
        "SHOW COLUMNS FROM pipeline_stages WHERE Field='win_probability'"
      );
      if (!pc.length) {
        await pool.query(
          'ALTER TABLE pipeline_stages ADD COLUMN win_probability TINYINT UNSIGNED NULL AFTER color'
        );
      }
      for (const s of defaultStages) {
        await pool.query(
          'UPDATE pipeline_stages SET win_probability=? WHERE stage_key=? AND win_probability IS NULL',
          [s.prob, s.key]
        );
      }
      // 딜별 확률 override 컬럼 (NULL = 단계 기본값)
      const [lc] = await pool.query("SHOW COLUMNS FROM leads WHERE Field='win_probability'");
      if (!lc.length) {
        await pool.query(
          'ALTER TABLE leads ADD COLUMN win_probability TINYINT UNSIGNED NULL AFTER stage'
        );
      }
      // business_type ENUM → VARCHAR (stage와 동일 — 사업영역 자유 확장 + 호환)
      const [bc] = await pool.query("SHOW COLUMNS FROM leads WHERE Field='business_type'");
      if (/enum/i.test(bc[0]?.Type || '')) {
        await pool.query(`ALTER TABLE leads MODIFY business_type VARCHAR(50) DEFAULT '식각가스'`);
      }
    } catch (e) {
      console.warn('  ⚠ 포캐스트 확률 컬럼 마이그레이션 스킵:', e.message);
    }

    // ── Phase B: 생산예측 (마케팅 demand plan) ───────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS production_forecasts (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      customer_id       INT NULL,
      customer_name     VARCHAR(200) NOT NULL,
      product_id        INT NULL,
      product_name      VARCHAR(150) NOT NULL,
      business_type     VARCHAR(50) NULL,
      period            CHAR(7) NOT NULL COMMENT 'YYYY-MM (생산/납품 예측월)',
      forecast_qty      DECIMAL(15,2) DEFAULT 0,
      unit              VARCHAR(20) DEFAULT 'kg',
      unit_price        DECIMAL(15,2) DEFAULT 0 COMMENT '단가(원)',
      expected_revenue  DECIMAL(18,2) DEFAULT 0 COMMENT '예상매출(원) = 수량×단가',
      currency          VARCHAR(10) DEFAULT 'KRW',
      status            VARCHAR(20) DEFAULT '예측' COMMENT '예측 | 수주전환 | 취소',
      converted_lead_id INT NULL,
      assigned_to       INT NULL,
      note              TEXT,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_period (period),
      INDEX idx_status (status),
      INDEX idx_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── Phase B: 월별 포캐스트 스냅샷 (정밀 전년/추세 비교) ───────
    await pool.query(`CREATE TABLE IF NOT EXISTS forecast_snapshots (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      snapshot_month CHAR(7) NOT NULL COMMENT '스냅샷 시점(YYYY-MM)',
      target_month   CHAR(7) NOT NULL COMMENT '예측 대상월(YYYY-MM)',
      expected_krw   DECIMAL(18,2) DEFAULT 0,
      weighted_krw   DECIMAL(18,2) DEFAULT 0,
      committed_krw  DECIMAL(18,2) DEFAULT 0,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_snap (snapshot_month, target_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── leads.stage ENUM → VARCHAR 마이그레이션 (idempotent) ──
    // ENUM은 단계 추가/삭제 불가 → VARCHAR로 변환하여 자유로운 stage_key 허용
    try {
      const [colInfo] = await pool.query("SHOW COLUMNS FROM leads WHERE Field='stage'");
      const colType = colInfo[0]?.Type || '';
      if (/enum/i.test(colType)) {
        await pool.query(`ALTER TABLE leads MODIFY stage VARCHAR(50) DEFAULT 'lead'`);
        console.log('  ✓ leads.stage ENUM → VARCHAR(50) 마이그레이션 완료');
      }
    } catch (e) {
      console.warn('⚠ leads.stage 마이그레이션:', e.message);
    }

    // ── v6.0.0: 데이터 정합성 백필 (idempotent) ──────────────
    // 두 단계로 진행:
    // (1) customer_name 직접 매칭 — lead.customer_id 가 NULL 이어도 동작 (가장 강력)
    // (2) lead → customer 경유 매칭 — customer_name 이 다르거나 비어있는 경우
    // 매번 실행되어도 NULL 행만 매칭되므로 idempotent.
    const backfills = [
      // ── 1단계: customer_name 직접 매칭 (가장 광범위) ─────
      {
        label: 'quotes (via customer_name)',
        sql: `UPDATE quotes q
                JOIN customers c ON c.name = q.customer_name
                 SET q.customer_id = c.id
               WHERE q.customer_id IS NULL
                 AND q.customer_name IS NOT NULL AND q.customer_name != ''`,
      },
      {
        label: 'proposals (via customer_name)',
        sql: `UPDATE proposals p
                JOIN customers c ON c.name = p.customer_name
                 SET p.customer_id = c.id
               WHERE p.customer_id IS NULL
                 AND p.customer_name IS NOT NULL AND p.customer_name != ''`,
      },
      {
        label: 'contracts (via customer_name)',
        sql: `UPDATE contracts ct
                JOIN customers c ON c.name = ct.customer_name
                 SET ct.customer_id = c.id
               WHERE ct.customer_id IS NULL
                 AND ct.customer_name IS NOT NULL AND ct.customer_name != ''`,
      },
      {
        label: 'leads (via customer_name)',
        sql: `UPDATE leads l
                JOIN customers c ON c.name = l.customer_name
                 SET l.customer_id = c.id
               WHERE l.customer_id IS NULL
                 AND l.customer_name IS NOT NULL AND l.customer_name != ''`,
      },
      {
        label: 'payment_schedules (via customer_name)',
        sql: `UPDATE payment_schedules ps
                JOIN customers c ON c.name = ps.customer_name
                 SET ps.customer_id = c.id
               WHERE ps.customer_id IS NULL
                 AND ps.customer_name IS NOT NULL AND ps.customer_name != ''`,
      },
      {
        label: 'tax_invoices (via customer_name)',
        sql: `UPDATE tax_invoices ti
                JOIN customers c ON c.name = ti.customer_name
                 SET ti.customer_id = c.id
               WHERE ti.customer_id IS NULL
                 AND ti.customer_name IS NOT NULL AND ti.customer_name != ''`,
      },
      {
        label: 'projects (via customer_name)',
        sql: `UPDATE projects pj
                JOIN customers c ON c.name = pj.customer_name
                 SET pj.customer_id = c.id
               WHERE pj.customer_id IS NULL
                 AND pj.customer_name IS NOT NULL AND pj.customer_name != ''`,
      },
      // ── 2단계: lead/proposal/quote 경유 매칭 (customer_name 이 비어있거나 다른 경우) ──
      {
        label: 'quotes',
        sql: `UPDATE quotes q
                JOIN leads l ON l.id = q.lead_id
                 SET q.customer_id = COALESCE(q.customer_id, l.customer_id),
                     q.customer_name = COALESCE(NULLIF(q.customer_name, ''), l.customer_name)
               WHERE q.lead_id IS NOT NULL
                 AND (q.customer_id IS NULL OR q.customer_name IS NULL OR q.customer_name = '')`,
      },
      {
        label: 'proposals',
        sql: `UPDATE proposals p
                JOIN leads l ON l.id = p.lead_id
                 SET p.customer_id = COALESCE(p.customer_id, l.customer_id),
                     p.customer_name = COALESCE(NULLIF(p.customer_name, ''), l.customer_name)
               WHERE p.lead_id IS NOT NULL
                 AND (p.customer_id IS NULL OR p.customer_name IS NULL OR p.customer_name = '')`,
      },
      {
        label: 'contracts (via proposals)',
        sql: `UPDATE contracts c
                JOIN proposals p ON p.id = c.proposal_id
                 SET c.customer_id = COALESCE(c.customer_id, p.customer_id),
                     c.customer_name = COALESCE(NULLIF(c.customer_name, ''), p.customer_name)
               WHERE c.proposal_id IS NOT NULL
                 AND (c.customer_id IS NULL OR c.customer_name IS NULL OR c.customer_name = '')`,
      },
      {
        label: 'contracts (via leads)',
        sql: `UPDATE contracts c
                JOIN leads l ON l.id = c.lead_id
                 SET c.customer_id = COALESCE(c.customer_id, l.customer_id),
                     c.customer_name = COALESCE(NULLIF(c.customer_name, ''), l.customer_name)
               WHERE c.lead_id IS NOT NULL
                 AND (c.customer_id IS NULL OR c.customer_name IS NULL OR c.customer_name = '')`,
      },
      {
        label: 'contracts (via quotes)',
        sql: `UPDATE contracts c
                JOIN quotes q ON q.id = c.quote_id
                 SET c.customer_id = COALESCE(c.customer_id, q.customer_id),
                     c.customer_name = COALESCE(NULLIF(c.customer_name, ''), q.customer_name)
               WHERE c.quote_id IS NOT NULL
                 AND (c.customer_id IS NULL OR c.customer_name IS NULL OR c.customer_name = '')`,
      },
    ];
    for (const { label, sql } of backfills) {
      try {
        const [r] = await pool.query(sql);
        if (r.affectedRows > 0) {
          console.log(`  ✓ customer_id 백필 ${label}: ${r.affectedRows} rows`);
        }
      } catch (e) {
        // 테이블/컬럼 부재 등은 무시 (조용한 실패)
        if (!String(e.message).match(/doesn't exist|Unknown column|Unknown table/i)) {
          console.warn(`⚠ ${label} 백필 경고:`, e.message);
        }
      }
    }

    // ── 환율 시계열 캐시 테이블 ──────────────────────────
    // 수출입은행(primary) + frankfurter(fallback) 통합 캐시
    await pool.query(`CREATE TABLE IF NOT EXISTS exchange_rates (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      currency_code VARCHAR(3)    NOT NULL,
      rate_to_krw   DECIMAL(15,4) NOT NULL,
      source        VARCHAR(20)   NOT NULL,         -- 'exim' | 'frankfurter' | 'manual'
      rate_date     DATE          NOT NULL,
      fetched_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_curr_date (currency_code, rate_date),
      INDEX idx_curr_latest (currency_code, rate_date DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // KRW=1 시드 (idempotent)
    await pool.query(`INSERT IGNORE INTO exchange_rates (currency_code, rate_to_krw, source, rate_date)
                      VALUES ('KRW', 1, 'manual', CURRENT_DATE)`);

    // ── leads 통화 환산 확장 컬럼 (idempotent) ─────────
    const leadsFxCols = [
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS amount_krw     DECIMAL(20,2) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_rate        DECIMAL(15,4) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_locked_at   TIMESTAMP    NULL DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_lock_policy VARCHAR(20)  DEFAULT 'live'`,
    ];
    for (const sql of leadsFxCols) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (!String(e.message).includes('Duplicate')) console.warn('⚠ FX 컬럼:', e.message);
      }
    }

    // ── 고객사 AI 브리핑 캐시 + 이력 테이블 ──────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_briefs (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      customer_id   INT          NOT NULL,
      headline      VARCHAR(255) DEFAULT NULL,
      key_points    TEXT         DEFAULT NULL,        -- JSON array
      next_action   VARCHAR(255) DEFAULT NULL,
      risk          VARCHAR(500) DEFAULT NULL,
      stats         TEXT         DEFAULT NULL,        -- JSON object
      generated_by  INT          DEFAULT NULL,
      generated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cust_gen (customer_id, generated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 고객·제품 360뷰 (라이프사이클) 테이블 3종 ──────────────
    // 척추: 고객사 × 소재 × Fab/라인 의 적용 라이프사이클 단계
    //   lifecycle_stage: discovery/sample/evaluation/specin/massprod/delivery
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_materials (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      customer_id     INT          NOT NULL,
      product_id      INT          DEFAULT NULL,
      material_name   VARCHAR(200) NOT NULL,
      business_type   VARCHAR(50)  DEFAULT NULL,
      fab_line        VARCHAR(120) DEFAULT NULL,          -- 사업장/Fab/라인/공정
      lifecycle_stage VARCHAR(20)  NOT NULL DEFAULT 'discovery',
      expected_mp_date DATE        DEFAULT NULL,          -- 예상 양산(MP) 시점
      monthly_demand  DECIMAL(15,2) DEFAULT NULL,         -- 월 수요(수량)
      demand_unit     VARCHAR(10)  DEFAULT 'kg',
      win_probability TINYINT UNSIGNED DEFAULT NULL,
      status          VARCHAR(20)  DEFAULT 'active',       -- active/onhold/closed
      notes           VARCHAR(500) DEFAULT NULL,
      created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cm_customer (customer_id),
      INDEX idx_cm_stage (lifecycle_stage)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 수요 → 생산가능 → 수주: 소재×월 Forecast (고객/내부 분리)
    await pool.query(`CREATE TABLE IF NOT EXISTS demand_forecasts (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      customer_material_id INT         NOT NULL,
      customer_id         INT          DEFAULT NULL,
      month               VARCHAR(7)   NOT NULL,           -- YYYY-MM
      customer_forecast   DECIMAL(15,2) DEFAULT 0,         -- 고객 제공 수요
      internal_forecast   DECIMAL(15,2) DEFAULT 0,         -- 영업/마케팅 보정
      production_capacity DECIMAL(15,2) DEFAULT NULL,      -- 생산 가능량(CAPA)
      win_probability     TINYINT UNSIGNED DEFAULT NULL,
      expected_revenue    DECIMAL(20,2) DEFAULT 0,         -- 예상 매출(원)
      unit                VARCHAR(10)  DEFAULT 'kg',
      created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cm_month (customer_material_id, month),
      INDEX idx_df_customer (customer_id),
      INDEX idx_df_month (month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 품질/VOC/NCR/Audit/PCN 이슈
    await pool.query(`CREATE TABLE IF NOT EXISTS quality_cases (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      case_no             VARCHAR(30)  NOT NULL UNIQUE,
      customer_id         INT          NOT NULL,
      customer_material_id INT         DEFAULT NULL,
      type                VARCHAR(20)  NOT NULL DEFAULT 'VOC',   -- VOC/NCR/Audit/PCN/CoA
      severity            VARCHAR(10)  DEFAULT 'medium',          -- high/medium/low
      status              VARCHAR(20)  DEFAULT 'open',            -- open/in_progress/resolved
      title               VARCHAR(255) NOT NULL,
      opened_at           DATE         DEFAULT NULL,
      resolved_at         DATE         DEFAULT NULL,
      owner_id            INT          DEFAULT NULL,
      notes               VARCHAR(500) DEFAULT NULL,
      created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_qc_customer (customer_id),
      INDEX idx_qc_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 포캐스트 버전관리 (시점 스냅샷) ────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS forecast_versions (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      customer_id   INT          NOT NULL,
      label         VARCHAR(120) NOT NULL,                 -- 예: 2026-06 제출본
      version_type  VARCHAR(20)  DEFAULT 'baseline',       -- baseline/customer/internal/production
      note          VARCHAR(500) DEFAULT NULL,
      created_by    INT          DEFAULT NULL,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fv_customer (customer_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS forecast_version_items (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      version_id          INT          NOT NULL,
      customer_material_id INT         NOT NULL,
      month               VARCHAR(7)   NOT NULL,
      customer_forecast   DECIMAL(15,2) DEFAULT 0,
      internal_forecast   DECIMAL(15,2) DEFAULT 0,
      production_capacity DECIMAL(15,2) DEFAULT NULL,
      win_probability     TINYINT UNSIGNED DEFAULT NULL,
      expected_revenue    DECIMAL(20,2) DEFAULT 0,
      unit                VARCHAR(10)  DEFAULT 'kg',
      INDEX idx_fvi_version (version_id),
      INDEX idx_fvi_mat (customer_material_id, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── Phase 3: 사업장/담당자/샘플평가 ───────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_sites (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      customer_id   INT          NOT NULL,
      site_name     VARCHAR(120) NOT NULL,                 -- 사업장/Fab (예: 평택)
      line          VARCHAR(120) DEFAULT NULL,             -- 라인 (예: P3)
      process       VARCHAR(120) DEFAULT NULL,             -- 공정 (식각/증착/포토/세정)
      region        VARCHAR(60)  DEFAULT NULL,
      note          VARCHAR(500) DEFAULT NULL,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cs_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS customer_contacts (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      customer_id   INT          NOT NULL,
      name          VARCHAR(80)  NOT NULL,
      role          VARCHAR(30)  DEFAULT 'etc',            -- 구매/기술/품질/SCM/기타
      dept          VARCHAR(120) DEFAULT NULL,
      email         VARCHAR(160) DEFAULT NULL,
      phone         VARCHAR(40)  DEFAULT NULL,
      is_primary    TINYINT(1)   DEFAULT 0,
      note          VARCHAR(500) DEFAULT NULL,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cc_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 샘플 요청→발송→평가→승인 (qualification = status 로 표현)
    await pool.query(`CREATE TABLE IF NOT EXISTS sample_requests (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      sample_no           VARCHAR(30)  NOT NULL UNIQUE,
      customer_id         INT          NOT NULL,
      customer_material_id INT         DEFAULT NULL,
      requested_at        DATE         DEFAULT NULL,
      purpose             VARCHAR(255) DEFAULT NULL,
      lot_no              VARCHAR(60)  DEFAULT NULL,
      sent_at             DATE         DEFAULT NULL,
      qty                 DECIMAL(12,2) DEFAULT NULL,
      unit                VARCHAR(10)  DEFAULT 'kg',
      status              VARCHAR(20)  DEFAULT 'requested',  -- requested/sent/evaluating/passed/conditional/failed
      result              VARCHAR(500) DEFAULT NULL,
      eval_criteria       VARCHAR(500) DEFAULT NULL,         -- 평가 기준
      eval_equipment      VARCHAR(200) DEFAULT NULL,         -- 평가 장비/공정
      fail_reason         VARCHAR(500) DEFAULT NULL,         -- 불합격 사유
      resample            TINYINT(1)   DEFAULT 0,            -- 재샘플 여부
      owner_id            INT          DEFAULT NULL,
      note                VARCHAR(500) DEFAULT NULL,
      created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_sr_customer (customer_id),
      INDEX idx_sr_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 기존 sample_requests 에 상세 컬럼 보강 (idempotent — 이미 있으면 무시)
    for (const col of [
      'ADD COLUMN eval_criteria VARCHAR(500) DEFAULT NULL',
      'ADD COLUMN eval_equipment VARCHAR(200) DEFAULT NULL',
      'ADD COLUMN fail_reason VARCHAR(500) DEFAULT NULL',
      'ADD COLUMN resample TINYINT(1) DEFAULT 0',
    ]) {
      try {
        await pool.query(`ALTER TABLE sample_requests ${col}`);
      } catch (e) {
        if (!String(e.message).includes('Duplicate'))
          console.warn('⚠ sample_requests 컬럼:', e.message);
      }
    }

    // 품질 문서이력 (CoA/MSDS/CoC 발행·제공 이력)
    await pool.query(`CREATE TABLE IF NOT EXISTS quality_documents (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      customer_id         INT          NOT NULL,
      customer_material_id INT         DEFAULT NULL,
      doc_type            VARCHAR(20)  NOT NULL DEFAULT 'CoA',   -- CoA/MSDS/CoC/기타
      doc_no              VARCHAR(60)  DEFAULT NULL,
      issued_at           DATE         DEFAULT NULL,             -- 발행/제공일
      valid_until         DATE         DEFAULT NULL,             -- 유효기한
      file_url            VARCHAR(500) DEFAULT NULL,
      note                VARCHAR(500) DEFAULT NULL,
      created_by          INT          DEFAULT NULL,
      created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_qd_customer (customer_id),
      INDEX idx_qd_type (doc_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 사용자 인증 테이블 ──────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      username         VARCHAR(50) UNIQUE NOT NULL,
      email            VARCHAR(100) UNIQUE,
      password_hash    VARCHAR(255) NOT NULL,
      full_name        VARCHAR(100),
      role             ENUM('manager','team_lead','executive','superadmin') DEFAULT 'manager',
      is_active        TINYINT(1) DEFAULT 1,
      otp_secret       VARCHAR(100),
      otp_enabled      TINYINT(1) DEFAULT 0,
      webauthn_cred_id VARCHAR(500),
      last_login       DATETIME,
      department       VARCHAR(100),
      avatar_url       VARCHAR(255),
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기본 superadmin 계정 생성 (없을 때만)
    const [[adminExists]] = await pool.query(
      `SELECT id FROM users WHERE username = 'admin' LIMIT 1`
    );
    if (!adminExists) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin1234!', 12);
      await pool.query(
        `INSERT INTO users (username, email, full_name, password_hash, role)
         VALUES ('admin', 'admin@oci.com', 'IT운영 관리자', ?, 'superadmin')`,
        [hash]
      );
      console.log('✅ 기본 관리자 계정 생성: admin / admin1234!');
    }

    // ── JWT 보안: Refresh Token 관리 테이블 ─────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      token_hash  VARCHAR(255) NOT NULL,         -- bcrypt 해시 (원문 미저장)
      jti         VARCHAR(36)  NOT NULL,         -- 연결된 access token JTI
      user_agent  VARCHAR(500),
      ip          VARCHAR(45),
      expires_at  DATETIME NOT NULL,
      revoked     TINYINT(1) DEFAULT 0,
      revoked_at  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user    (user_id),
      INDEX idx_jti     (jti),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── JWT 보안: 즉시 무효화 블랙리스트 ────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS token_blacklist (
      jti        VARCHAR(36) PRIMARY KEY,
      user_id    INT NOT NULL,
      expires_at DATETIME NOT NULL,            -- 이 시각 이후 자동 정리 가능
      reason     VARCHAR(50) DEFAULT 'logout',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 개발자 옵션: 기능 플래그 테이블 ─────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS dev_features (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      feature_key VARCHAR(100) NOT NULL UNIQUE,
      feature_name VARCHAR(200) NOT NULL,
      description TEXT,
      category    VARCHAR(50) DEFAULT 'general',
      is_enabled  TINYINT(1)  DEFAULT 1,
      is_experimental TINYINT(1) DEFAULT 0,
      affects_routes  VARCHAR(500),
      affects_tables  VARCHAR(500),
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    // ── 확장 컬럼 추가 (idempotent ALTER) ──────────────────────
    // risk_level, required_features, is_deprecated, last_changed_by/at
    const devFeaturesAlters = [
      `ALTER TABLE dev_features
         ADD COLUMN IF NOT EXISTS risk_level
         ENUM('safe','medium','high','critical') DEFAULT 'safe'
         COMMENT '토글 위험도 — UI에 배지 표시'`,
      `ALTER TABLE dev_features
         ADD COLUMN IF NOT EXISTS required_features VARCHAR(500) NULL
         COMMENT 'JSON 배열 [feature_key,...] — 의존성'`,
      `ALTER TABLE dev_features
         ADD COLUMN IF NOT EXISTS is_deprecated TINYINT(1) DEFAULT 0
         COMMENT '매니페스트에서 제거된 기능 (수동 정리 대기)'`,
      `ALTER TABLE dev_features
         ADD COLUMN IF NOT EXISTS last_changed_by INT NULL`,
      `ALTER TABLE dev_features
         ADD COLUMN IF NOT EXISTS last_changed_at TIMESTAMP NULL`,
    ];
    for (const sql of devFeaturesAlters) {
      try {
        await pool.query(sql);
      } catch (_) {
        /* 이미 존재 — 무시 */
      }
    }

    // ── 변경 audit 로그 테이블 ─────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS dev_features_audit (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      feature_key VARCHAR(100) NOT NULL,
      old_enabled TINYINT(1),
      new_enabled TINYINT(1),
      changed_by  INT NULL,
      changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reason      VARCHAR(255),
      INDEX idx_feature_date (feature_key, changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 기능 플래그 자동 동기화 (매니페스트 → DB) ─────────────
    // 정책:
    //   1) 매니페스트에 있는 기능 → UPSERT (메타데이터 갱신, is_enabled 보존)
    //   2) DB 에 있는데 매니페스트에 없으면 → is_deprecated = 1
    //   3) Deprecated 자동 삭제 안 함 (수동 정리만)
    try {
      const { FEATURE_REGISTRY } = require('./data/featureRegistry');

      for (const f of FEATURE_REGISTRY) {
        const requiredJson = JSON.stringify(f.required_features || []);
        await pool.query(
          `INSERT INTO dev_features
             (feature_key, feature_name, description, category,
              risk_level, required_features, affects_routes, affects_tables,
              is_experimental, is_enabled, is_deprecated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE
             feature_name       = VALUES(feature_name),
             description        = VALUES(description),
             category           = VALUES(category),
             risk_level         = VALUES(risk_level),
             required_features  = VALUES(required_features),
             affects_routes     = VALUES(affects_routes),
             affects_tables     = VALUES(affects_tables),
             is_experimental    = VALUES(is_experimental),
             is_deprecated      = 0`,
          [
            f.key,
            f.name,
            f.description || '',
            f.category || 'general',
            f.risk_level || 'safe',
            requiredJson,
            f.affects_routes || '',
            f.affects_tables || '',
            f.is_experimental ? 1 : 0,
            f.default_enabled === false ? 0 : 1,
          ]
        );
      }

      // 매니페스트에 없는 옛 기능 → deprecated 표시
      const keys = FEATURE_REGISTRY.map(f => f.key);
      if (keys.length > 0) {
        const placeholders = keys.map(() => '?').join(',');
        await pool.query(
          `UPDATE dev_features
              SET is_deprecated = 1
            WHERE feature_key NOT IN (${placeholders})
              AND is_deprecated = 0`,
          keys
        );
      }

      console.log(`✅ Feature flags sync: ${FEATURE_REGISTRY.length} registered`);
    } catch (err) {
      console.error('⚠️ Feature flags sync 실패:', err.message);
    }

    // ── v6.0.0: customers 사업자등록번호(BRN) + 이름 변경 이력 ─────
    // 목적: 고객사 이름이 바뀌어도 BRN 으로 동일 고객 인식 → 중복 방지 + 알림
    try {
      await pool.query(
        `ALTER TABLE customers ADD COLUMN business_no VARCHAR(13) DEFAULT NULL COMMENT '사업자등록번호'`
      );
    } catch (_) {
      /* column may already exist */
    }
    try {
      // 정규화 컬럼 — 입력 형식 다양성(하이픈 유무) 흡수 + 매칭 정확도 보장
      // GENERATED STORED → 자동 채움 + INDEX 가능
      await pool.query(
        `ALTER TABLE customers ADD COLUMN business_no_normalized CHAR(10)
           GENERATED ALWAYS AS (REGEXP_REPLACE(IFNULL(business_no,''), '[^0-9]', '')) STORED
           COMMENT '하이픈 제거 정규화'`
      );
    } catch (_) {
      /* column may already exist */
    }
    try {
      // UNIQUE — NULL 은 허용 (해외 고객사 + 기존 데이터 호환)
      // 정규화 컬럼 기준 → '123-45-67890' vs '1234567890' 동일 처리
      await pool.query(
        `ALTER TABLE customers ADD UNIQUE KEY uniq_business_no (business_no_normalized)`
      );
    } catch (_) {
      /* index may already exist */
    }
    try {
      // 검증 메타 — 국세청 API 미사용 시점에는 NULL 유지
      await pool.query(
        `ALTER TABLE customers ADD COLUMN brn_verified_at DATETIME DEFAULT NULL COMMENT '국세청 검증 시점'`
      );
    } catch (_) {
      /* exists */
    }

    // ── P2: 세금계산서 수신 담당자 (청구차수 상세 모달에서 인라인 편집) ──
    //   가산·멱등 — 기존 데이터 무영향(전부 NULL 시작). 고객사 단위 1세트.
    try {
      await pool.query(
        `ALTER TABLE customers ADD COLUMN tax_recipient_name VARCHAR(100) DEFAULT NULL COMMENT '세금계산서 수신 담당자명'`
      );
    } catch (_) {
      /* exists */
    }
    try {
      await pool.query(
        `ALTER TABLE customers ADD COLUMN tax_recipient_dept VARCHAR(100) DEFAULT NULL COMMENT '세금계산서 수신 담당자 부서'`
      );
    } catch (_) {
      /* exists */
    }
    try {
      await pool.query(
        `ALTER TABLE customers ADD COLUMN tax_recipient_email VARCHAR(200) DEFAULT NULL COMMENT '세금계산서 수신 담당자 메일'`
      );
    } catch (_) {
      /* exists */
    }

    // 고객사 이름 변경 이력 — BRN 동일 + 이름 다를 때 알림 근거
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_name_history (
      id          BIGINT       NOT NULL AUTO_INCREMENT,
      customer_id INT          NOT NULL,
      old_name    VARCHAR(200) NOT NULL,
      new_name    VARCHAR(200) NOT NULL,
      changed_by  INT          DEFAULT NULL,
      changed_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
      source      VARCHAR(50)  DEFAULT 'manual'
                                COMMENT 'manual|bulk_paste|ocr|nts_api',
      PRIMARY KEY (id),
      KEY idx_customer (customer_id, changed_at),
      CONSTRAINT fk_cnh_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    console.log('✅ DB 확장 테이블 + 인덱스 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 오류:', err.message);
  }
}

module.exports = { initTables };
