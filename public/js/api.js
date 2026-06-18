// ============================================================
// API Client - 백엔드 통신 모듈
// ============================================================

// 내부 헬퍼 — fetch Response → Blob 다운로드 트리거
// Content-Disposition 헤더에서 파일명 추출 (UTF-8 인코딩 지원)
async function _downloadBlob(resp, format = 'xlsx', name = '') {
  const cd = resp.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="([^"]+)"/i);
  const filename = match ? decodeURIComponent(match[1]) : `${name || 'report'}.${format}`;
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename };
}

const API = {
  base: '/api',
  _refreshing: false, // 중복 갱신 방지 플래그
  _refreshQueue: [], // 갱신 대기 큐

  // ── Circuit Breaker: 기능 토글 OFF 시 네트워크 요청 차단 ───
  // 백엔드 featureGuard 가 어차피 403 차단하지만, 클라이언트에서 미리
  // 막아서 ① 불필요한 네트워크 트래픽 절약 ② 일관된 에러 처리 ③ 빠른 UI 응답
  _checkFeature(featureKey) {
    if (typeof Features !== 'undefined' && !Features.isEnabled(featureKey)) {
      const err = new Error(`이 기능은 현재 비활성화 상태입니다 (${featureKey})`);
      err.code = 'FEATURE_DISABLED';
      err.feature = featureKey;
      throw err;
    }
  },

  // ── Access Token 갱신 (Refresh Token 쿠키 사용) ─────────
  async _tryRefresh() {
    if (this._refreshing) {
      // 갱신 중이면 완료 대기
      return new Promise((resolve, reject) => this._refreshQueue.push({ resolve, reject }));
    }
    this._refreshing = true;
    try {
      const res = await fetch(this.base + '/auth/refresh', {
        method: 'POST',
        credentials: 'include', // 쿠키 자동 전송
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.token) throw new Error('refresh_failed');

      // 새 Access Token 저장
      const storage = localStorage.getItem('oci_token') ? localStorage : sessionStorage;
      storage.setItem('oci_token', data.token);

      this._refreshQueue.forEach(p => p.resolve(data.token));
      return data.token;
    } catch (e) {
      this._refreshQueue.forEach(p => p.reject(e));
      throw e;
    } finally {
      this._refreshing = false;
      this._refreshQueue = [];
    }
  },

  async request(method, path, body = null, _isRetry = false) {
    const headers = { 'Content-Type': 'application/json' };
    const uid = localStorage.getItem('current_user_id');
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(this.base + path, opts);
      const data = await res.json();

      // ── 401: Access Token 만료 → 자동 갱신 후 1회 재시도 ──
      if (res.status === 401 && (data.expired || data.revoked) && !_isRetry) {
        try {
          await this._tryRefresh();
          return this.request(method, path, body, true); // 재시도
        } catch (_) {
          // 갱신 실패 → 로그인 페이지
          this._forceLogout();
          throw new Error('세션이 만료되었습니다. 다시 로그인하세요.');
        }
      }

      if (!data.success) {
        const err = new Error(data.message || data.error || 'API Error');
        Object.assign(err, data, { status: res.status });
        throw err;
      }
      return data;
    } catch (err) {
      if (!err.status) console.error(`API ${method} ${path}:`, err);
      if (!err.duplicate) Toast.error(err.message);
      throw err;
    }
  },

  _forceLogout() {
    localStorage.removeItem('oci_token');
    sessionStorage.removeItem('oci_token');
    localStorage.removeItem('current_user_id');
    localStorage.removeItem('oci_remember'); // 로그인 유지 플래그 정리 (refresh 실패=세션 종료)
    window.location.href = '/login';
  },

  // multipart 업로드 — Content-Type 헤더 미설정 (브라우저가 boundary 자동 추가)
  async _upload(path, formData) {
    const headers = {};
    const uid = localStorage.getItem('current_user_id');
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(this.base + path, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const err = new Error(data.message || data.error || '업로드 실패');
        Object.assign(err, data, { status: res.status });
        throw err;
      }
      return data;
    } catch (err) {
      if (!err.status) console.error(`API UPLOAD ${path}:`, err);
      if (!err.duplicate) Toast.error(err.message);
      throw err;
    }
  },

  get(path) {
    return this.request('GET', path);
  },
  post(path, body) {
    return this.request('POST', path, body);
  },
  put(path, body) {
    return this.request('PUT', path, body);
  },
  patch(path, body) {
    return this.request('PATCH', path, body);
  },
  del(path) {
    return this.request('DELETE', path);
  },

  // 대시보드
  dashboard: {
    stats: year => API.get(`/dashboard/stats${year ? '?year=' + year : ''}`),
    funnel: year => API.get(`/dashboard/funnel${year ? '?year=' + year : ''}`),
    monthly: (year, period) => {
      const p = new URLSearchParams();
      if (year) p.set('year', year);
      if (period) p.set('period', period);
      const qs = p.toString();
      return API.get('/dashboard/monthly' + (qs ? '?' + qs : ''));
    },
    activities: year => API.get(`/dashboard/activities${year ? '?year=' + year : ''}`),
  },

  // 리드
  leads: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      ).toString();
      return API.get('/leads' + (qs ? '?' + qs : ''));
    },
    get: id => API.get(`/leads/${id}`),
    create: body => API.post('/leads', body),
    update: (id, body) => API.put(`/leads/${id}`, body),
    setStage: (id, stage) => API.patch(`/leads/${id}/stage`, { stage }),
    delete: id => API.del(`/leads/${id}`),
    // v6.0.0 Step 2: 연결된 계약 역방향 조회
    contracts: id => API.get(`/leads/${id}/contracts`),
    // v6.0.0 Step 2: 자동완성 (계약 모달 Combobox 용)
    autocomplete: (q, limit = 10) =>
      API.get(`/leads?autocomplete=1&search=${encodeURIComponent(q)}&limit=${limit}`),
    // v6.0.0: KPI 대시보드 (5개 모듈 통일)
    dashboard: () => API.get('/leads/dashboard'),
    // v6.0.0: 댓글 (계약 패턴 통일)
    comments: {
      list: id => API.get(`/leads/${id}/comments`),
      create: (id, body) => API.post(`/leads/${id}/comments`, body),
    },
    // v6.0.0 Phase A: 고객지원 항목 (통합 타임라인 '고객지원' 칩)
    supports: {
      list: id => API.get(`/leads/${id}/supports`),
      create: (id, body) => API.post(`/leads/${id}/supports`, body),
    },
    // v6.0.0 Phase A: 연결된 견적/제안 역방향 조회 (모달 통합 타임라인)
    quotes: id => API.get(`/leads/${id}/quotes`),
    proposals: id => API.get(`/leads/${id}/proposals`),
    // v6.0.0 Phase 2: 주 담당자 변경 (PUT /api/leads/:id/primary-owner)
    primaryOwner: (id, newOwnerId) =>
      API.put(`/leads/${id}/primary-owner`, { new_owner_id: newOwnerId }),
  },

  // 상품/원가
  products: {
    list: () => API.get('/products'),
    create: body => API.post('/products', body),
    update: (id, body) => API.put(`/products/${id}`, body),
    delete: id => API.del(`/products/${id}`),
    history: id => API.get(`/products/${id}/history`),
  },

  // 프로젝트
  projects: {
    list: () => API.get('/projects'),
    create: body => API.post('/projects', body),
    update: (id, body) => API.put(`/projects/${id}`, body),
    delete: id => API.del(`/projects/${id}`),
  },

  // 팀
  team: {
    list: () => API.get('/team'),
    create: body => API.post('/team', body),
    update: (id, body) => API.put(`/team/${id}`, body),
    delete: id => API.del(`/team/${id}`),
  },

  // 고객사
  customers: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/customers' + (qs ? '?' + qs : ''));
    },
    create: body => API.post('/customers', body),
    update: (id, body) => API.put(`/customers/${id}`, body),
    // 자동완성 (Smart Ranking 포함) — 캘린더 등에서 사용
    autocomplete: (q, limit = 10) =>
      API.get(`/customers?autocomplete=1&search=${encodeURIComponent(q)}&limit=${limit}`),
    // v6.0.0 Step 2: 연결된 계약 역방향 조회
    contracts: id => API.get(`/customers/${id}/contracts`),
    // v6.0.0: 연결된 견적/제안 역방향 조회 (모달 탭용)
    quotes: id => API.get(`/customers/${id}/quotes`),
    proposals: id => API.get(`/customers/${id}/proposals`),
    // 연결된 수금일정 역방향 조회 (모달 [💳 수금] 탭용)
    payments: id => API.get(`/customers/${id}/payments`),
    // 고객 360뷰 — 모든 접점 통합 집계 + 최근 타임라인 (모달 [🎯 360뷰] 탭용)
    view360: id => API.get(`/customers/${id}/360view`),
    // v6.0.0 Phase A4: AI 추출 회사명 → 정규화 매칭 (계약 등록 시 자동 연결용)
    match: name => API.get(`/customers/match?name=${encodeURIComponent(name)}`),
    // v6.0.0: KPI 대시보드 (5개 모듈 통일)
    dashboard: () => API.get('/customers/dashboard'),
  },

  // 매출 포캐스트 (파이프라인 가중 예측)
  forecast: {
    get: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/forecast' + (qs ? '?' + qs : ''));
    },
    probabilities: () => API.get('/forecast/probabilities'),
    saveProbabilities: items => API.put('/forecast/probabilities', { items }),
    snapshot: (snapshot_month, year) => API.post('/forecast/snapshot', { snapshot_month, year }),
  },

  // 생산예측 (Phase B — 마케팅 demand plan → 수주 전환)
  productionForecasts: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/production-forecasts' + (qs ? '?' + qs : ''));
    },
    create: body => API.post('/production-forecasts', body),
    update: (id, body) => API.put(`/production-forecasts/${id}`, body),
    remove: id => API.del(`/production-forecasts/${id}`),
    convert: id => API.post(`/production-forecasts/${id}/convert`, {}),
  },

  // 활동
  activities: {
    create: body => API.post('/activities', body),
    update: (id, body) => API.put(`/activities/${id}`, body),
    delete: id => API.del(`/activities/${id}`),
  },

  // 알림 (crm.notifications 토글 가드)
  notifications: {
    list: () => {
      API._checkFeature('crm.notifications');
      return API.get('/notifications');
    },
  },

  // v6.0.0: 읽음 표시 (5개 모듈 공통)
  readReceipts: {
    mark: (entityType, entityId) =>
      API.post('/read-receipts/mark', { entity_type: entityType, entity_id: entityId }),
    markMany: (entityType, entityIds) =>
      API.post('/read-receipts/mark-many', { entity_type: entityType, entity_ids: entityIds }),
    unreadCounts: () => API.get('/read-receipts/unread-counts'),
  },

  // 캘린더
  calendar: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return API.get('/calendar/events' + (qs ? '?' + qs : ''));
    },
    create: body => API.post('/calendar/events', body),
    update: (id, body) => API.put(`/calendar/events/${id}`, body),
    delete: id => API.del(`/calendar/events/${id}`),
    seedDemo: () => API.post('/calendar/seed-demo', {}),
    // 제목 자동완성 (Step 2) — 과거 이벤트 + 고객사+동사 템플릿
    titleSuggestions: (q, limit = 8) =>
      API.get(`/calendar/title-suggestions?q=${encodeURIComponent(q)}&limit=${limit}`),
  },

  // 제안 (crm.proposals)
  proposals: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/proposals' + (qs ? '?' + qs : ''));
    },
    get: id => API.get(`/proposals/${id}`),
    create: body => API.post('/proposals', body),
    update: (id, body) => API.put(`/proposals/${id}`, body),
    delete: id => API.del(`/proposals/${id}`),
    setStatus: (id, status) => API.patch(`/proposals/${id}/status`, { status }),
    // v6.0.0: KPI 대시보드 (5개 모듈 통일)
    dashboard: () => API.get('/proposals/dashboard'),
    nextProposalNo: year =>
      API.get(`/proposals/next-proposal-no${year ? '?year=' + year : ''}`),
    // Phase 3 — 파일 / 리비전
    uploadRfp: (id, formData) =>
      API._upload(`/proposals/${id}/rfp`, formData),
    uploadFile: (id, formData) =>
      API._upload(`/proposals/${id}/files`, formData),
    deleteFile: (id, fileId) => API.del(`/proposals/${id}/files/${fileId}`),
    downloadFileUrl: (id, fileId) =>
      `/api/proposals/${id}/files/${fileId}/download`,
    createRevision: (id, body) => API.post(`/proposals/${id}/revisions`, body),
    // Phase 4-A — AI RFP 분석 (사용자가 선택한 RFP 파일 1건 분석)
    analyzeRfp: (id, fileId) =>
      API.post(`/proposals/${id}/rfp/analyze`, { file_id: fileId }),
    // Phase 5-B — 이메일 발송 (Gmail 첨부)
    sendEmail: (id, body) => API.post(`/proposals/${id}/email/send`, body),
    // Phase 5-C — 공유 링크 발급 / 무효화
    createShare: (id, expiresDays = 7) =>
      API.post(`/proposals/${id}/share`, { expires_days: expiresDays }),
    revokeShare: id => API.del(`/proposals/${id}/share`),
    // Phase 6-B — AI 제안서 평가 (RFP 대비 커버율 + 코칭)
    evaluate: (id, proposalFileId) =>
      API.post(`/proposals/${id}/evaluate`, { proposal_file_id: proposalFileId }),
    evaluations: id => API.get(`/proposals/${id}/evaluations`),
    // Phase 9-3 — AI 제안전략 요약 Word(.docx) 다운로드 URL (브라우저가 직접 다운로드)
    aiStrategyWordUrl: id => `/api/proposals/${id}/ai-strategy/word`,
    // v6.0.0 Step 2: 연결된 계약 역방향 조회
    contracts: id => API.get(`/proposals/${id}/contracts`),
    // v6.0.0 Step 2: 자동완성 (계약 모달 Combobox 용)
    autocomplete: (q, limit = 10) =>
      API.get(`/proposals?autocomplete=1&search=${encodeURIComponent(q)}&limit=${limit}`),
  },

  // 계약 (crm.contracts) — v6.0.0 슬림화: CRUD + 파일 + AI 법무 검토 + 4단계 상태
  contracts: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/contracts' + (qs ? '?' + qs : ''));
    },
    get: id => API.get(`/contracts/${id}`),
    create: body => API.post('/contracts', body),
    update: (id, body) => API.put(`/contracts/${id}`, body),
    delete: id => API.del(`/contracts/${id}`),
    nextContractNo: year => API.get(`/contracts/next-contract-no${year ? '?year=' + year : ''}`),
    // v6.0.0 Phase C: KPI 대시보드 (만료 임박 + 상태별 카운트)
    dashboard: () => API.get('/contracts/dashboard'),
    // 파일
    uploadFile: (id, formData) => API._upload(`/contracts/${id}/files`, formData),
    deleteFile: (id, fileId) => API.del(`/contracts/${id}/files/${fileId}`),
    downloadFileUrl: (id, fileId) => `/api/contracts/${id}/files/${fileId}/download`,
    // AI 법무 검토 (Gemini 2.5 Pro · 약 500-1000원/회)
    legalReview: (id, fileId) =>
      API.post(`/contracts/${id}/files/${fileId}/legal-review`, {}),
    legalReviews: id => API.get(`/contracts/${id}/legal-reviews`),
    // CLM 4단계 상태 전이 (draft → review → approved → completed)
    setStatus: (id, status) => API.patch(`/contracts/${id}/status`, { status }),
    // v6.0.0 Step 4: Modusign 전자서명
    esign: {
      connect: () => API.get('/contracts/esign/oauth/connect'),
      status: () => API.get('/contracts/esign/status'),
      disconnect: () => API.del('/contracts/esign/disconnect'),
      request: (id, body) => API.post(`/contracts/${id}/esign/request`, body),
      getStatus: id => API.get(`/contracts/${id}/esign/status`),
      signedPdfUrl: id => `/api/contracts/${id}/esign/signed-pdf`,
      cancel: id => API.post(`/contracts/${id}/esign/cancel`, {}),
    },
    // v6.0.0 Phase B: 공유 링크 (등록자용 — 내부 인증)
    share: {
      create: (id, body) => API.post(`/contracts/${id}/share`, body),
      list: id => API.get(`/contracts/${id}/share`),
      recipients: (id, linkId) => API.get(`/contracts/${id}/share/${linkId}/recipients`),
      revoke: (id, linkId) => API.del(`/contracts/${id}/share/${linkId}`),
    },
    // v6.0.0 Phase D: 댓글 (내부 인증)
    comments: {
      list: id => API.get(`/contracts/${id}/comments`),
      create: (id, body) => API.post(`/contracts/${id}/comments`, body),
    },
  },

  // 매출관리 (crm.revenue) — P2
  revenue: {
    schedules: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/revenue/schedules' + (qs ? '?' + qs : ''));
    },
    summary: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/revenue/summary' + (qs ? '?' + qs : ''));
    },
    detail: id => API.get('/revenue/schedules/' + id),
    saveTaxRecipient: (id, payload) => API.put('/revenue/schedules/' + id + '/tax-recipient', payload),
  },

  // 고객지원 (crm.support) — A/S 티켓
  support: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/support' + (qs ? '?' + qs : ''));
    },
    get: id => API.get(`/support/${id}`),
    dashboard: () => API.get('/support/dashboard'), // SLA KPI (미해결/오늘예정/기한초과/내담당)
    checkDue: () => API.post('/support/check-due', {}), // [SLA-3] 진입 시 기한 도래 알림 (하루 1회)
    create: body => API.post('/support', body),
    update: (id, body) => API.put(`/support/${id}`, body),
    delete: id => API.del(`/support/${id}`),
    assign: (id, userId, note) => API.patch(`/support/${id}/assign`, { assigned_to: userId, note }),
    // 설정형 (상태/유형/우선순위/채널)
    settings: kind => API.get(`/support/settings${kind ? '/' + kind : ''}`),
    settingCreate: (kind, body) => API.post(`/support/settings/${kind}`, body),
    settingUpdate: (id, body) => API.put(`/support/settings/${id}`, body),
    settingDelete: id => API.del(`/support/settings/${id}`),
    settingReorder: (kind, order) => API.post(`/support/settings/${kind}/reorder`, { order }),
    // 댓글 / 첨부 / 이력
    comments: id => API.get(`/support/${id}/comments`),
    addComment: (id, body) => API.post(`/support/${id}/comments`, body),
    files: id => API.get(`/support/${id}/files`),
    uploadFiles: (id, formData) => API._upload(`/support/${id}/files`, formData),
    downloadFileUrl: (id, fileId) => `/api/support/${id}/files/${fileId}`,
    deleteFile: (id, fileId) => API.del(`/support/${id}/files/${fileId}`),
    history: id => API.get(`/support/${id}/history`),
    // 인앱 알림 [W2]
    notifications: () => API.get('/support/notifications'),
    markNotificationRead: id => API.post(`/support/notifications/${id}/read`, {}),
    markAllNotificationsRead: () => API.post('/support/notifications/read-all', {}),
  },

  // 견적서 (crm.quotes)
  quotes: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return API.get('/quotes' + (qs ? '?' + qs : ''));
    },
    get: id => API.get(`/quotes/${id}`),
    create: body => API.post('/quotes', body),
    update: (id, body) => API.put(`/quotes/${id}`, body),
    delete: id => API.del(`/quotes/${id}`),
    // v6.0.0: KPI 대시보드 (5개 모듈 통일)
    dashboard: () => API.get('/quotes/dashboard'),
    duplicate: id => API.post(`/quotes/${id}/duplicate`, {}),
    // Phase 5
    nextQuoteNo: year => API.get(`/quotes/next-quote-no${year ? '?year=' + year : ''}`),
    revisions: id => API.get(`/quotes/${id}/revisions`),
    setStatus: (id, status) => API.patch(`/quotes/${id}/status`, { status }),
    // v6.0.0 Step 2: 연결된 계약 역방향 조회
    contracts: id => API.get(`/quotes/${id}/contracts`),
    // v6.0.0 Step 2: 자동완성 (계약 모달 Combobox 용)
    autocomplete: (q, limit = 10) =>
      API.get(`/quotes?autocomplete=1&search=${encodeURIComponent(q)}&limit=${limit}`),
  },

  // 게시판
  board: {
    announcements: {
      list: () => API.get('/board/announcements'),
      create: body => API.post('/board/announcements', body),
      update: (id, body) => API.put(`/board/announcements/${id}`, body),
      delete: id => API.del(`/board/announcements/${id}`),
    },
    comments: {
      list: (refType, refId) => API.get(`/board/comments?ref_type=${refType}&ref_id=${refId}`),
      create: body => API.post('/board/comments', body),
      delete: id => API.del(`/board/comments/${id}`),
    },
    faq: {
      list: () => API.get('/board/faq'),
      create: body => API.post('/board/faq', body),
      delete: id => API.del(`/board/faq/${id}`),
    },
  },

  // 관리자
  admin: {
    stats: () => API.get('/admin/stats'),
    logs: (limit, offset) =>
      API.get(`/admin/access-logs?limit=${limit || 100}&offset=${offset || 0}`),
    clearLogs: () => API.del('/admin/access-logs'),
    teamStats: () => API.get('/admin/team-stats'),
    dailyLogs: () => API.get('/admin/daily-logs'),
    topPaths: () => API.get('/admin/top-paths'),
    getSettings: () => API.get('/admin/settings'),
    saveSettings: body => API.put('/admin/settings', body),
    tokenByUser: () => API.get('/admin/token-usage-by-user'),
    setTokenLimit: (id, limit) =>
      API.patch(`/admin/team-members/${id}/token-limit`, { monthly_token_limit: limit }),
    // 토큰 모니터링
    tokenMonitor: (year, month) =>
      API.get(`/admin/token-monitor?year=${year || ''}&month=${month || ''}`),
    saveRechargeSettings: (id, body) => API.put(`/admin/token-recharge-settings/${id}`, body),
    manualRecharge: (id, amount) => API.post(`/admin/token-recharge/${id}`, { amount }),
  },

  // 회의록 (목록/조회는 자유, 생성/요약은 ai.meeting 가드)
  meetings: {
    list: () => API.get('/meetings'),
    get: id => API.get(`/meetings/${id}`),
    create: body => API.post('/meetings', body),
    delete: id => API.del(`/meetings/${id}`),
    summarize: body => {
      API._checkFeature('ai.meeting');
      return API.post('/meeting/summarize', body);
    },
    registerCalendar: (id, body) => API.post(`/meetings/${id}/register-calendar`, body),
    // transcribe 는 multipart 라 fetch 직접 사용
  },

  // AI (각 기능별 토글 가드)
  ai: {
    insights: () => API.get('/ai/insights'),
    chat: body => {
      API._checkFeature('ai.assistant');
      return API.post('/ai/chat', body);
    },
    report: type => {
      API._checkFeature('ai.assistant');
      return API.post('/ai/report', { type });
    },
    meetingNotes: body => {
      API._checkFeature('ai.meeting');
      return API.post('/ai/meeting-notes', body);
    },
    usageToday: () => API.get('/ai/usage/today'),
  },

  // Google Meet 연동
  google: {
    status: () => API.get('/google/status'),
    authUrl: () => API.get('/google/auth-url'),
    disconnect: () => API.del('/google/disconnect'),
    meet: {
      create: body => API.post('/google/meet/create', body),
      list: () => API.get('/google/meet/list'),
      linkMinutes: (id, body) => API.patch(`/google/meet/${id}/link-minutes`, body),
    },
  },

  // ── 로고 관리 ─────────────────────────────────────────────
  logo: {
    get: () => API.get('/system/logo'),
    // upload 는 multipart — 별도 fetch 사용 (settings.js 에서 직접 호출)
    restore: () => API.del('/admin/logo'),
  },

  // ── 리포트 페이지 사용자 정의 위젯 (crm.reports 가드) ──────
  // report_definitions 의 reference + display_order — 빌더와 분리
  reports: {
    widgets: {
      list: () => {
        API._checkFeature('crm.reports');
        return API.get('/reports/widgets');
      },
      // 단일 또는 다중 추가: { report_id: 1 } 또는 { report_ids: [1, 2] }
      add: body => {
        API._checkFeature('crm.reports');
        return API.post('/reports/widgets', body);
      },
      // 드래그 후 새 순서로 재배치: { ids: [w1, w2, w3] }
      reorder: ids => {
        API._checkFeature('crm.reports');
        return API.put('/reports/widgets/order', { ids });
      },
      delete: id => {
        API._checkFeature('crm.reports');
        return API.del(`/reports/widgets/${id}`);
      },
    },
  },

  // ── 리포트 빌더 (crm.report_builder 가드) ───────────────────
  reportBuilder: {
    fields: datasource => {
      API._checkFeature('crm.report_builder');
      return API.get(
        '/report-builder/fields' +
          (datasource ? `?datasource=${encodeURIComponent(datasource)}` : '')
      );
    },
    values: (datasource, field, limit = 100) => {
      API._checkFeature('crm.report_builder');
      return API.get(
        `/report-builder/values?datasource=${encodeURIComponent(datasource || 'leads')}&field=${encodeURIComponent(field)}&limit=${limit}`
      );
    },
    query: config => {
      API._checkFeature('crm.report_builder');
      return API.post('/report-builder/query', config);
    },
    listSaved: () => {
      API._checkFeature('crm.report_builder');
      return API.get('/report-builder/saved');
    },
    getSaved: id => {
      API._checkFeature('crm.report_builder');
      return API.get(`/report-builder/saved/${id}`);
    },
    save: data => {
      API._checkFeature('crm.report_builder');
      return API.post('/report-builder/saved', data);
    },
    update: (id, data) => {
      API._checkFeature('crm.report_builder');
      return API.put(`/report-builder/saved/${id}`, data);
    },
    delete: id => {
      API._checkFeature('crm.report_builder');
      return API.del(`/report-builder/saved/${id}`);
    },
    // 내보내기 (Excel/CSV/JSON) — config_json POST + Blob 다운로드
    // PDF 는 클라이언트에서 html2canvas+jspdf 로 별도 생성
    // 인증 헤더는 API.request 와 동일 패턴 (token: localStorage→sessionStorage / X-User-Id 포함)
    export: async (config, format = 'xlsx', name = '') => {
      API._checkFeature('crm.report_builder');
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
      const uid = localStorage.getItem('current_user_id');
      const qs = new URLSearchParams({ format, name }).toString();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (uid) headers['X-User-Id'] = uid;
      const resp = await fetch(`${API.base}/report-builder/export?${qs}`, {
        method: 'POST',
        headers,
        credentials: 'include', // Refresh token 쿠키 (401 자동 갱신 호환)
        body: JSON.stringify(config),
      });
      // 401 + 토큰 만료 → 자동 갱신 후 1회 재시도
      if (resp.status === 401) {
        try {
          await API._tryRefresh();
          const newToken =
            localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
          if (newToken) headers['Authorization'] = `Bearer ${newToken}`;
          const retry = await fetch(`${API.base}/report-builder/export?${qs}`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(config),
          });
          if (!retry.ok) {
            const errBody = await retry.json().catch(() => ({}));
            throw new Error(errBody.error || `내보내기 실패 (${retry.status})`);
          }
          return _downloadBlob(retry, format, name);
        } catch (_) {
          throw new Error('세션이 만료되었습니다. 다시 로그인하세요.');
        }
      }
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `내보내기 실패 (${resp.status})`);
      }
      return _downloadBlob(resp, format, name);
    },
  },

  // ── Gmail (G1=gmail.read / G2=gmail.send / G3=gmail.sync) ──
  gmail: {
    scopeStatus: () => API.get('/gmail/scope-status'), // OAuth 상태 확인은 가드 없음 (UI 분기용)
    messages: (email, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/messages?email=${encodeURIComponent(email)}&limit=${limit}`);
    },
    matchLead: (id, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/match/lead/${id}?limit=${limit}`);
    },
    matchCustomer: (id, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/match/customer/${id}?limit=${limit}`);
    },
    send: body => {
      API._checkFeature('gmail.send');
      return API.post('/gmail/send', body);
    },
    // G3 — 자동 동기화
    syncSettings: () => API.get('/gmail/sync-settings'), // 설정 조회는 가드 없음 (관리자가 켜기 위해 필요)
    setSync: enabled => API.put('/gmail/sync-settings', { enabled: !!enabled }),
    syncNow: () => {
      API._checkFeature('gmail.sync');
      return API.post('/gmail/sync-now');
    },
  },

  // ── 엑셀 다운로드 헬퍼 (인증 헤더 포함) — 레거시 ────────────────
  // downloadExport 가 이미 async 라 동일하게 Promise 반환됨
  downloadExcel(path, filename) {
    return this.downloadExport(path, filename, 'xlsx');
  },

  // ── 통합 다운로드 헬퍼 (xlsx/csv/json) ─────────────────────────
  // path 에 ?format= 이 이미 있으면 형식 무시, 없으면 자동 추가
  async downloadExport(path, filename, format = 'xlsx') {
    const fmt = ['xlsx', 'csv', 'json'].includes(format) ? format : 'xlsx';
    const sep = path.includes('?') ? '&' : '?';
    const finalPath = path.includes('format=') ? path : `${path}${sep}format=${fmt}`;
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const uid = localStorage.getItem('current_user_id');
    const headers = {};
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(this.base + finalPath, { headers });
      if (!res.ok) {
        const text = await res.text();
        let msg = res.status;
        try {
          msg = JSON.parse(text)?.message || msg;
        } catch (_) {
          /* ignore */
        }
        Toast.error('다운로드 실패: ' + msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: filename + '.' + fmt,
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      Toast.error('다운로드 오류: ' + e.message);
    }
  },
};
