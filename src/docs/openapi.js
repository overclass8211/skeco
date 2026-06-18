'use strict';

/**
 * OpenAPI 3.0 스펙 — OCI CRM REST API
 * GET /api/docs  → Swagger UI
 * GET /api/docs/spec → JSON 스펙 다운로드
 */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'OCI CRM API',
    version: '1.0.0',
    description: '핑거세일즈 기반 태양광·ESS 영업 관리 시스템 REST API',
    contact: { name: 'OCI', email: 'dev@oci.com' },
  },
  servers: [{ url: '/api', description: '현재 서버' }],
  tags: [
    { name: 'Auth', description: '인증 (로그인/OTP)' },
    { name: 'Dashboard', description: '대시보드 KPI·통계' },
    { name: 'Leads', description: '영업기회(리드) 관리' },
    { name: 'Customers', description: '고객사 관리' },
    { name: 'Projects', description: '프로젝트 관리' },
    { name: 'Products', description: '원가·제품 관리' },
    { name: 'Team', description: '팀원 관리' },
    { name: 'Activities', description: '영업 활동 기록' },
    { name: 'Calendar', description: '일정 관리' },
    { name: 'Meetings', description: '회의록 관리' },
    { name: 'Board', description: '게시판 (공지/댓글/FAQ)' },
    { name: 'AI', description: 'AI 어시스턴트 (Gemini)' },
    { name: 'Admin', description: '관리자 (통계/설정)' },
    { name: 'Health', description: '헬스체크' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '로그인 후 발급된 JWT 토큰을 입력하세요.',
      },
    },
    schemas: {
      // ── 공통 ───────────────────────────────────────────────
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: '오류 메시지' },
          code: { type: 'string', example: 'VALIDATION_ERROR' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 50 },
          total: { type: 'integer', example: 120 },
          totalPages: { type: 'integer', example: 3 },
        },
      },
      // ── Lead ───────────────────────────────────────────────
      Lead: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          customer_name: { type: 'string', example: '한국동서발전' },
          project_name: { type: 'string', example: '30MW EPC 입찰' },
          business_type: { type: 'string', enum: ['태양광', 'ESS', '전기', '설치', '모듈', 'EPC'] },
          region: { type: 'string', enum: ['국내', '해외'] },
          stage: {
            type: 'string',
            enum: [
              'lead',
              'review',
              'proposal',
              'bidding',
              'negotiation',
              'won',
              'lost',
              'dropped',
            ],
          },
          capacity_mw: { type: 'number', example: 30 },
          expected_amount: { type: 'number', example: 150 },
          currency: { type: 'string', example: 'KRW' },
          assigned_to: { type: 'integer', nullable: true },
          assigned_name: { type: 'string', nullable: true },
          updated_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      // ── Customer ───────────────────────────────────────────
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string', example: 'VPL Corp' },
          region: { type: 'string', example: '해외' },
          country: { type: 'string', nullable: true },
          industry: { type: 'string', nullable: true },
          contact_person: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
        },
      },
      // ── Project ────────────────────────────────────────────
      Project: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          customer_name: { type: 'string' },
          project_type: { type: 'string' },
          contract_amount: { type: 'number' },
          estimated_cost: { type: 'number' },
          margin_pct: { type: 'number' },
          status: { type: 'string', example: '진행중' },
          due_date: { type: 'string', format: 'date', nullable: true },
          assigned_name: { type: 'string', nullable: true },
        },
      },
    },
    parameters: {
      PageParam: { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
      LimitParam: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Health ─────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: '헬스체크',
        security: [],
        responses: {
          200: {
            description: '정상',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    db: { type: 'string', example: 'connected' },
                    uptime: { type: 'number' },
                  },
                },
              },
            },
          },
          503: { description: 'DB 연결 불가' },
        },
      },
    },
    // ── Auth ───────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: '로그인',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'JWT 토큰 + 사용자 정보 반환' },
          401: {
            description: '인증 실패',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    // ── Dashboard ──────────────────────────────────────────
    '/dashboard/stats': {
      get: {
        tags: ['Dashboard'],
        summary: 'KPI 지표 조회',
        responses: {
          200: {
            description: 'monthlyNew, domestic, overseas, totalLeads, bidding, wonAmount, winRate',
          },
        },
      },
    },
    '/dashboard/funnel': {
      get: {
        tags: ['Dashboard'],
        summary: '파이프라인 단계별 현황',
        responses: { 200: { description: 'stage별 count·amount 배열' } },
      },
    },
    '/dashboard/monthly': {
      get: {
        tags: ['Dashboard'],
        summary: '월별 영업기회 추이 (최근 6개월)',
        responses: { 200: { description: 'month·business_type·count 배열' } },
      },
    },
    '/dashboard/activities': {
      get: {
        tags: ['Dashboard'],
        summary: '최근 영업 활동 10건',
        responses: { 200: { description: '활동 배열' } },
      },
    },
    // ── Leads ──────────────────────────────────────────────
    '/leads': {
      get: {
        tags: ['Leads'],
        summary: '영업기회 목록 조회 (페이지네이션)',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          { name: 'stage', in: 'query', schema: { type: 'string' } },
          { name: 'region', in: 'query', schema: { type: 'string' } },
          { name: 'business_type', in: 'query', schema: { type: 'string' } },
          { name: 'assigned_to', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: '리드 목록 + pagination',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/SuccessResponse' },
                    {
                      type: 'object',
                      properties: {
                        data: { type: 'array', items: { $ref: '#/components/schemas/Lead' } },
                        pagination: { $ref: '#/components/schemas/Pagination' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Leads'],
        summary: '영업기회 등록',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['customer_name', 'project_name'],
                properties: {
                  customer_name: { type: 'string' },
                  project_name: { type: 'string' },
                  business_type: { type: 'string' },
                  region: { type: 'string' },
                  capacity_mw: { type: 'number' },
                  expected_amount: { type: 'number' },
                  stage: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '등록된 id 반환' },
          400: { description: '필수 항목 누락' },
        },
      },
    },
    '/leads/{id}': {
      get: {
        tags: ['Leads'],
        summary: '영업기회 상세 + 활동 이력',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'lead + activities 배열' },
          404: { description: '존재하지 않음' },
        },
      },
      put: {
        tags: ['Leads'],
        summary: '영업기회 수정',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Lead' } } },
        },
        responses: { 200: { description: '수정 완료' } },
      },
      delete: {
        tags: ['Leads'],
        summary: '영업기회 삭제',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '삭제 완료' } },
      },
    },
    '/leads/{id}/stage': {
      patch: {
        tags: ['Leads'],
        summary: '영업기회 단계 변경',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['stage'],
                properties: {
                  stage: {
                    type: 'string',
                    enum: [
                      'lead',
                      'review',
                      'proposal',
                      'bidding',
                      'negotiation',
                      'won',
                      'lost',
                      'dropped',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: '단계 변경 + 활동 자동 기록' } },
      },
    },
    // ── Customers ──────────────────────────────────────────
    '/customers': {
      get: {
        tags: ['Customers'],
        summary: '고객사 목록 (페이지네이션)',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: '고객사 목록 + pagination' } },
      },
      post: {
        tags: ['Customers'],
        summary: '고객사 등록',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  region: { type: 'string' },
                  industry: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: '등록 완료' }, 400: { description: 'name 누락' } },
      },
    },
    // ── Projects ───────────────────────────────────────────
    '/projects': {
      get: {
        tags: ['Projects'],
        summary: '프로젝트 목록 (페이지네이션)',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: '프로젝트 목록 + pagination' } },
      },
      post: {
        tags: ['Projects'],
        summary: '프로젝트 등록',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } },
        },
        responses: { 200: { description: '등록 완료' } },
      },
    },
    // ── Products ───────────────────────────────────────────
    '/products': {
      get: {
        tags: ['Products'],
        summary: '제품·원자재 목록 (페이지네이션)',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          { name: 'category', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: '제품 목록 + pagination' } },
      },
    },
    // ── Team ───────────────────────────────────────────────
    '/team': {
      get: {
        tags: ['Team'],
        summary: '팀원 목록 + 영업 실적 (페이지네이션)',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
        ],
        responses: { 200: { description: '팀원 목록 + pagination' } },
      },
    },
    // ── AI ─────────────────────────────────────────────────
    '/ai/chat': {
      post: {
        tags: ['AI'],
        summary: 'AI 어시스턴트 채팅 (SSE 스트리밍)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { messages: { type: 'array', items: { type: 'object' } } },
              },
            },
          },
        },
        responses: {
          200: { description: 'text/event-stream — data: {"text":"..."}\\ndata: [DONE]' },
        },
      },
    },
    '/ai/report': {
      post: {
        tags: ['AI'],
        summary: '주간·월간 보고서 생성 (SSE)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { type: { type: 'string', enum: ['weekly', 'monthly'] } },
              },
            },
          },
        },
        responses: { 200: { description: 'SSE 스트림' } },
      },
    },
  },
};

module.exports = spec;
