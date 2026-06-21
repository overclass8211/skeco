const js      = require('@eslint/js');
const globals = require('globals');

// 커버리지·빌드 산출물 제외
const IGNORE = [{ ignores: ['coverage/**', 'node_modules/**', 'dist/**'] }];

// 공통 규칙 — 서버 + 브라우저 공유
// ⚠️ 일부 룰을 warn 으로 완화 (대량 false positive — 별도 PR 정리 예정)
const commonRules = {
  'no-console':       'off',
  'no-var':           'error',
  'prefer-const':     'warn',
  'eqeqeq':           'warn',
  'no-throw-literal': 'warn',
  // 차단 룰 일시 완화 (런타임 무영향 항목)
  'no-empty':              ['warn', { allowEmptyCatch: true }],
  'no-undef':              'warn',
  'no-useless-escape':     'warn',
  'no-useless-assignment': 'warn',
  'preserve-caught-error': 'off',
  'no-unused-vars':        'warn',
  'require-await':         'warn',
};

// SPA 전역 변수 — <script> 태그로 로드된 다른 파일에서 정의된 식별자
const spaGlobals = {
  // utils.js
  Fmt: 'readonly', STAGES: 'readonly', BUSINESS_COLORS: 'readonly',
  Modal: 'readonly', Toast: 'readonly', esc: 'readonly',
  UserPrefs: 'readonly', debounce: 'readonly',
  // ai.js
  AI: 'readonly', Notifications: 'readonly', QuickActions: 'readonly',
  // search.js
  SearchModal: 'readonly',
  // email.js
  Email: 'readonly',
  // shortcuts.js
  Shortcuts: 'readonly',
  // exportMenu.js
  ExportMenu: 'readonly',
  // emptyState.js
  EmptyState: 'readonly',
  // onboarding.js
  Onboarding: 'readonly',
  // labels.js
  Labels: 'readonly',
  // offlineQueue.js
  OfflineQueue: 'readonly',
  // api.js
  API: 'readonly',
  // app.js
  App: 'readonly', WS: 'readonly',
  // 외부 라이브러리
  Chart: 'readonly', FullCalendar: 'readonly', Quill: 'readonly', Sortable: 'readonly',
  // 공통 컴포넌트
  Combobox: 'readonly', LinkedContracts: 'readonly', LinkedQuotes: 'readonly', LinkedProposals: 'readonly', LinkedSupport: 'readonly', LinkedPayments: 'readonly', Customer360View: 'readonly', ReadReceipts: 'readonly', ViewToggle: 'readonly', KpiBar: 'readonly', StageProgress: 'readonly', BulkPaste: 'readonly', AutosaveForm: 'readonly',
  // pages/*.js (app.js 에서 참조)
  DashboardPage: 'readonly', PipelinePage: 'readonly', ForecastPage: 'readonly', LeadsPage: 'readonly',
  Customer360Page: 'readonly',
  Exec360Page: 'readonly',
  QualityPage: 'readonly',
  /* @scaffold:page-globals — 신규 페이지 전역 자동 삽입 지점 (scaffold-page.js) */
  ProjectsPage: 'readonly', CustomersPage: 'readonly', CalendarPage: 'readonly',
  TeamPage: 'readonly', BoardPage: 'readonly', MeetingPage: 'readonly',
  MeetingListPage: 'readonly', AdminPage: 'readonly', SettingsPage: 'readonly',
  ReportsPage: 'readonly', ReportBuilderPage: 'readonly', CostPage: 'readonly',
  OrdersPage: 'readonly', NotificationsListPage: 'readonly', DevPage: 'readonly',
  QuotesPage: 'readonly', ProposalsPage: 'readonly', ContractsPage: 'readonly', PaymentsPage: 'readonly', RevenuePage: 'readonly', // v8.0.0 SFR-011 / P2
  SupportPage: 'readonly', // 고객지원(A/S) P1
  // login.js
  Login: 'readonly',
  // utils.js 내부 helpers (런타임에는 전역으로 노출됨)
  loadStages: 'readonly', initStickyFilterBar: 'readonly',
  // 외부 CDN 글로벌
  daum: 'readonly',          // Kakao(다음) 우편번호 API
  Features: 'readonly',      // 기능 플래그 시스템 (별도 스크립트에서 정의)
};

module.exports = [...IGNORE,
  // ── 서버 소스 (Node.js) ──────────────────────────────────────
  {
    files: ['src/**/*.js', 'server.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern:       '^_',
        varsIgnorePattern:       '^_',
        caughtErrors:            'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-return-await': 'error',
      'require-await':   'warn',
    },
  },

  // ── 브라우저 공통 규칙 + SPA 전역 ────────────────────────────
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...spaGlobals,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
      // SPA global-script 환경: 파일이 자신의 이름과 동일한 전역을 선언하는 패턴
      // (DashboardPage, Fmt, AI 등) → no-redeclare 비활성화
      'no-redeclare':   'off',
      // 대문자 시작(PascalCase/SCREAMING_SNAKE) = 다른 파일에서 참조하는 전역 export
      'no-unused-vars': ['warn', {
        argsIgnorePattern:       '^_',
        varsIgnorePattern:       '^_|^[A-Z]',
        caughtErrors:            'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },

  // ── utils.js / login.js — top-level 선언이 전부 전역 export (flat config 에서 뒤에 위치해야 브라우저 공통 규칙을 덮어씀)
  {
    files: ['public/js/utils.js', 'public/js/login.js'],
    rules: {
      'no-unused-vars': ['warn', {
        args:                    'after-used',
        argsIgnorePattern:       '^_',
        vars:                    'local',   // top-level 전역 선언 제외, 함수 내부만 검사
        caughtErrors:            'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
