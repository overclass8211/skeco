// ============================================================
// Payments Page — 수금관리 (SFR-011) v8.0.0
// F1. 수금현황  F2. 미수금  F3. 세금계산서  F4. 매출분석
// ============================================================
/* global API, Toast, Modal, Chart */
const PaymentsPage = {
  activeTab: 'overview',

  // ── 상태 ────────────────────────────────────────────────────
  _schedules: [],
  _overdue: [],
  _taxInvoices: [],   // 세금계산서 목록 — /payments/tax-invoices
  _dashboard: null,
  _filter: { status: '', search: '', due_from: '', due_to: '' },
  _sort: { key: 'due_date', dir: 'asc' },
  _filterTimer: null,
  _config: null,      // 수금 설정 (품목유형 + 기본통화) — /payments/config
  _ms: [],            // 현재 모달의 마일스톤 배열
  _msDeleted: [],     // 편집 중 삭제된 기존 마일스톤 id
  _msCurrency: 'KRW', // 현재 모달 통화
  _groupView: true,            // 수금현황: 계약별 그룹(기본) ↔ 전체(평면)
  _collapsedGroups: new Set(), // 접힌 계약 그룹 키 (기본=모두 펼침)
  _charts: {},                 // 매출분석 Chart.js 인스턴스 (재렌더 시 파기)
  _trendMode: 'monthly',       // 월별 추이 차트 모드: 'monthly'(막대) ↔ 'cum'(누적 라인)

  // 수금 상태 메타 (배지 라벨/색상) — 평면·그룹 공용
  _STATUS_META: {
    scheduled:   { label: '예정',     color: '#6B7280', bg: '#F3F4F6' },
    invoiced:    { label: '청구',     color: '#1664E5', bg: '#EFF6FF' },
    partial:     { label: '부분수금', color: '#F59C00', bg: '#FFFBEB' },
    collected:   { label: '수금완료', color: '#0F7A3F', bg: '#ECFDF5' },
    overdue:     { label: '연체',     color: '#E63329', bg: '#FFF5F5' },
    written_off: { label: '대손처리', color: '#374151', bg: '#F9FAFB' },
  },

  // ── 진입점 ──────────────────────────────────────────────────
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2 style="margin:0;font-size:18px;font-weight:700">💰 수금관리</h2>
        <div style="display:flex;gap:8px">
          <button id="pay-btn-bank" class="btn btn-sm" style="background:#F0FDF4;color:#0F7A3F;border:1px solid #A7F3D0">🏦 은행 거래내역</button>
          <button id="pay-btn-from-contract" class="btn btn-sm" style="background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE">📄 계약에서 생성</button>
          <button id="pay-btn-new" class="btn btn-primary btn-sm">+ 수금 스케줄 등록</button>
        </div>
      </div>

      <!-- KPI 카드 영역 -->
      <div id="pay-kpi" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
      </div>

      <!-- 탭 바 -->
      <div class="tab-bar" style="margin-bottom:12px">
        <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">💰 수금현황</button>
        <button class="tab-btn ${this.activeTab === 'overdue' ? 'active' : ''}" data-tab="overdue">⚠️ 미수금</button>
      </div>

      <div id="pay-tab-content"></div>
    `;

    // 탭 이벤트
    document.querySelector('.tab-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn[data-tab]');
      if (!btn) return;
      this.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._renderTab();
    });

    // 신규 등록 버튼
    document.getElementById('pay-btn-new')?.addEventListener('click', () => this._openScheduleModal());
    document
      .getElementById('pay-btn-from-contract')
      ?.addEventListener('click', () => this._openFromContractModal());
    document
      .getElementById('pay-btn-bank')
      ?.addEventListener('click', () => this._openBankImportModal());

    // 필터/정렬 초기화 (페이지 진입 시 리셋)
    this._filter = { status: '', search: '', due_from: '', due_to: '' };
    this._sort   = { key: 'due_date', dir: 'asc' };
    // 뷰 모드 복원 (계약별 그룹 기본, '0' 저장 시 평면)
    try { this._groupView = localStorage.getItem('oci_pay_groupview') !== '0'; } catch (_) { /* 무시 */ }

    // 데이터 로드
    await Promise.all([this._loadDashboard(), this._loadSchedules(), this._loadConfig()]);
    this._renderTab();
  },

  // ── 탭 렌더 분기 ────────────────────────────────────────────
  _renderTab() {
    this._destroyCharts(); // 탭 전환/재렌더 시 기존 Chart.js 인스턴스 정리 (메모리 누수 방지)
    switch (this.activeTab) {
      case 'overview':  this._renderOverview();  break;
      case 'overdue':   this._renderOverdue();   break;
      case 'analysis':  this._renderAnalysis();  break;
      // 'tax' 는 매출관리(RevenuePage)로 이동 — 위임 렌더
    }
  },

  // 타 페이지(매출관리)에서 탭 위임 시 필수 상태 보장 (idempotent)
  _ensureInit() {
    if (!this._filter) this._filter = { status: '', search: '', due_from: '', due_to: '' };
    if (!this._sort) this._sort = { key: 'due_date', dir: 'asc' };
    if (this._groupView === undefined) {
      try {
        this._groupView = localStorage.getItem('oci_pay_groupview') !== '0';
      } catch (_) {
        this._groupView = true;
      }
    }
    if (!this._charts) this._charts = {};
  },

  // ── 데이터 로드 ─────────────────────────────────────────────
  async _loadDashboard() {
    try {
      const res = await API.get('/payments/dashboard');
      if (res.success) {
        this._dashboard = res.data;
        this._renderKpi(res.data.kpi);
      }
    } catch (e) {
      console.error('[payments] dashboard 로드 실패', e);
    }
  },

  // 수금 설정 로드 (품목유형 + 기본통화) — 실패 시 안전한 기본값
  async _loadConfig() {
    try {
      const res = await API.get('/payments/config');
      if (res.success) this._config = res.data;
    } catch (e) {
      console.error('[payments] config 로드 실패', e);
    }
    if (!this._config) {
      this._config = {
        stage_types: ['착수금', '중도금', '잔금', '기타'],
        default_currency: 'KRW',
        allowed_currencies: ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'AUD', 'SGD', 'HKD', 'VND'],
      };
    }
  },

  async _loadSchedules() {
    try {
      const p = new URLSearchParams();
      if (this._filter.status)   p.set('status',   this._filter.status);
      if (this._filter.due_from) p.set('due_from', this._filter.due_from);
      if (this._filter.due_to)   p.set('due_to',   this._filter.due_to);
      const qs = p.toString() ? '?' + p.toString() : '';
      const res = await API.get('/payments' + qs);
      if (res.success) this._schedules = res.data;
    } catch (e) {
      console.error('[payments] 스케줄 로드 실패', e);
    }
  },

  async _loadOverdue() {
    try {
      const res = await API.get('/payments/overdue');
      if (res.success) this._overdue = res.data;
    } catch (e) {
      console.error('[payments] 미수금 로드 실패', e);
    }
  },

  async _loadTaxInvoices() {
    try {
      const res = await API.get('/payments/tax-invoices');
      if (res.success) this._taxInvoices = res.data;
    } catch (e) {
      console.error('[payments] 세금계산서 로드 실패', e);
      this._taxInvoices = [];
    }
  },

  // ── KPI 카드 ────────────────────────────────────────────────
  _renderKpi(kpi) {
    if (!kpi) return;
    const elKpi = document.getElementById('pay-kpi');
    if (!elKpi) return; // 타 페이지(매출관리) 위임 시 #pay-kpi 부재 — KPI는 해당 페이지 자체 영역 사용
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    elKpi.innerHTML = `
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">수주잔액 (미수금)</div>
        <div style="font-size:20px;font-weight:700;color:#1664E5">₩${fmt(kpi.outstanding_amount)}</div>
      </div>
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번달 예정수금</div>
        <div style="font-size:20px;font-weight:700;color:#0F7A3F">₩${fmt(kpi.this_month_scheduled)}</div>
      </div>
      <div class="pay-kpi-card" style="background:${kpi.overdue_amount > 0 ? '#FFF5F5' : '#fff'};border:1px solid ${kpi.overdue_amount > 0 ? '#FECACA' : 'var(--border)'};border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">연체 미수금 (${kpi.overdue_count}건)</div>
        <div style="font-size:20px;font-weight:700;color:${kpi.overdue_amount > 0 ? '#E63329' : '#6B7280'}">₩${fmt(kpi.overdue_amount)}</div>
      </div>
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">수금 달성률</div>
        <div style="font-size:20px;font-weight:700;color:#7C4DFF">${kpi.collection_rate ?? 0}%</div>
        <div style="height:4px;background:#EDE9FE;border-radius:2px;margin-top:6px">
          <div style="height:100%;width:${Math.min(kpi.collection_rate ?? 0, 100)}%;background:#7C4DFF;border-radius:2px"></div>
        </div>
      </div>
    `;
  },

  // ── F1. 수금현황 탭 ─────────────────────────────────────────
  _renderOverview() {
    const el = document.getElementById('pay-tab-content');
    const STATUS_META = this._STATUS_META;

    // 필터+정렬 적용 목록
    const list = this._filteredAndSorted();
    const { key: sKey, dir: sDir } = this._sort;
    const sarr = col => sKey === col ? (sDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
    const thS  = 'padding:8px 12px;text-align:left;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';
    const thSR = 'padding:8px 12px;text-align:right;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';

    // 기간 프리셋 계산
    const now  = new Date();
    const p2   = n => String(n).padStart(2, '0');
    const thisM1 = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`;
    const thisM2 = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const nxtM1  = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    const nxtM2  = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    const isThisM = this._filter.due_from === thisM1 && this._filter.due_to === thisM2;
    const isNextM = this._filter.due_from === nxtM1  && this._filter.due_to === nxtM2;
    const isAll   = !this._filter.due_from && !this._filter.due_to;

    const pBtn = (lbl, f, t, on) =>
      `<button class="pay-period btn btn-sm" data-f="${f}" data-t="${t}"
         style="font-size:12px;${on ? 'background:var(--primary,#E63329);color:#fff;border-color:var(--primary,#E63329)' : ''}">${lbl}</button>`;

    // 합계
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const totSch  = list.reduce((s, r) => s + Number(r.scheduled_amount || 0), 0);
    const totPaid = list.reduce((s, r) => s + Number(r.paid_amount || 0), 0);

    // 본문: 계약별 그룹뷰(기본) / 전체 평면뷰 — 자식행은 _scheduleRowHtml 공용
    const EMPTY = `<tr><td colspan="8" style="text-align:center;padding:48px 20px;color:var(--text-3)">
      <div style="font-size:32px;margin-bottom:8px">💰</div>
      <div style="font-weight:600;margin-bottom:4px">수금 스케줄이 없습니다</div>
      <div style="font-size:12px">상단 [+ 수금 스케줄 등록] 버튼을 클릭하세요</div>
    </td></tr>`;
    const footHtml = leftLabel => `<tr style="background:#F0F4FF;font-size:12px;font-weight:600;border-top:2px solid #BFDBFE">
        <td colspan="3" style="padding:8px 12px;color:var(--text-3)">${leftLabel}</td>
        <td style="padding:8px 12px;text-align:right;color:#1664E5">₩${fmt(totSch)}</td>
        <td colspan="4" style="padding:8px 12px;color:#0F7A3F">수금 ₩${fmt(totPaid)}</td>
      </tr>`;

    let groups = [];
    let bodyRows;
    let footRow;
    if (this._groupView) {
      groups = this._groupSchedules(list);
      bodyRows = groups
        .map((g, gi) => {
          const collapsed = this._collapsedGroups.has(g.key);
          const gm = STATUS_META[g.status] || STATUS_META.scheduled;
          const gd = g.nextDue ? this._dDay(g.nextDue) : null;
          const cur = g.currency === 'KRW' ? '₩' : `${g.currency} `;
          const parent = `
        <tr class="pay-grp" data-gi="${gi}" style="cursor:pointer;background:#F8FAFF;border-top:2px solid #DBEAFE;border-bottom:1px solid #DBEAFE">
          <td style="padding:10px 12px">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="pay-grp-caret" style="font-size:11px;color:#1664E5;width:10px;display:inline-block">${collapsed ? '▸' : '▾'}</span>
              <div>
                <div style="font-weight:700;font-size:13px">${this._esc(g.contract_name || '—')}</div>
                <div style="font-size:11px;color:var(--text-3)">${
                  g.linked
                    ? this._esc(g.contract_no || '')
                    : '<span style="color:#9CA3AF">직접 등록(계약 없음)</span>'
                }</div>
              </div>
            </div>
          </td>
          <td style="padding:10px 12px">
            <div style="font-weight:600;font-size:13px">🏢 ${this._esc(g.customer_name || '—')}</div>
          </td>
          <td style="padding:10px 12px;font-size:11px;color:var(--text-3);white-space:nowrap">${g.children.length}개 단계</td>
          <td style="padding:10px 12px;text-align:right">
            <div style="font-weight:700;font-size:13px">${cur}${fmt(g.totSch)}</div>
            ${this._gapLine(g)}
          </td>
          <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${
            g.nextDue
              ? `${g.nextDue} <span style="margin-left:4px;font-size:11px;font-weight:600;color:${gd.color}">${gd.label}</span>`
              : '<span style="color:#0F7A3F;font-size:11px;font-weight:600">완료</span>'
          }</td>
          <td style="padding:10px 12px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:${gm.bg};color:${gm.color};font-weight:600">${gm.label}</span></td>
          <td style="padding:10px 12px;min-width:90px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:5px;background:#E5E7EB;border-radius:3px"><div style="height:100%;width:${g.pct}%;background:#1664E5;border-radius:3px"></div></div>
              <span style="font-size:11px;color:var(--text-3);min-width:28px">${g.pct}%</span>
            </div>
          </td>
          <td style="padding:10px 12px"></td>
        </tr>`;
          const children = g.children
            .map(s => this._scheduleRowHtml(s, { gi, hidden: collapsed }))
            .join('');
          return parent + children;
        })
        .join('');
      footRow = list.length ? footHtml(`계약 ${groups.length}건 · 단계 ${list.length}건`) : '';
    } else {
      bodyRows = list.map(s => this._scheduleRowHtml(s)).join('');
      footRow = list.length ? footHtml(`합계 ${list.length}건`) : '';
    }
    const allCollapsed =
      this._groupView && groups.length > 0 && groups.every(g => this._collapsedGroups.has(g.key));

    el.innerHTML = `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;border-radius:8px;padding:7px 11px;font-size:12px;line-height:1.4;margin-bottom:12px">
        <span aria-hidden="true">💰</span>
        <span><b>현금 회수 관점</b> — 입금 기준. 매출 인식(세금계산서 발행) 현황은 <b>매출관리</b>에서 관리합니다.</span>
      </div>
      <!-- 필터 바 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div style="display:flex;gap:3px">
            ${pBtn('이번달', thisM1, thisM2, isThisM)}
            ${pBtn('다음달', nxtM1,  nxtM2,  isNextM)}
            ${pBtn('전체',   '',      '',     isAll)}
          </div>
          <div style="width:1px;height:22px;background:var(--border)"></div>
          <select id="pay-fl-status" class="form-input" style="width:110px;font-size:12px;padding:4px 8px">
            <option value="">전체 상태</option>
            <option value="scheduled" ${this._filter.status === 'scheduled' ? 'selected' : ''}>예정</option>
            <option value="invoiced"  ${this._filter.status === 'invoiced'  ? 'selected' : ''}>청구</option>
            <option value="partial"   ${this._filter.status === 'partial'   ? 'selected' : ''}>부분수금</option>
            <option value="collected" ${this._filter.status === 'collected' ? 'selected' : ''}>수금완료</option>
            <option value="overdue"   ${this._filter.status === 'overdue'   ? 'selected' : ''}>연체</option>
          </select>
          <input id="pay-fl-search" class="form-input" placeholder="🔍 고객사/계약명"
            value="${this._esc(this._filter.search)}" style="width:160px;font-size:12px;padding:4px 8px">
          <input id="pay-fl-from" type="date" class="form-input" value="${this._filter.due_from}"
            style="width:130px;font-size:12px;padding:4px 8px">
          <span style="color:var(--text-3);font-size:12px">~</span>
          <input id="pay-fl-to" type="date" class="form-input" value="${this._filter.due_to}"
            style="width:130px;font-size:12px;padding:4px 8px">
          <div style="margin-left:auto;font-size:12px;color:var(--text-3);white-space:nowrap">
            총 <b style="color:var(--text-1)">${list.length}건</b>
            &nbsp;·&nbsp;예정 <b style="color:#1664E5">₩${fmt(totSch)}</b>
            &nbsp;·&nbsp;수금 <b style="color:#0F7A3F">₩${fmt(totPaid)}</b>
          </div>
        </div>
      </div>

      <!-- 뷰 토글 -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <button id="pay-view-group" class="btn btn-sm" style="font-size:12px;border:none;border-radius:0;${this._groupView ? 'background:var(--primary,#E63329);color:#fff' : 'background:#fff;color:var(--text-2)'}">📂 계약별</button>
          <button id="pay-view-flat" class="btn btn-sm" style="font-size:12px;border:none;border-radius:0;border-left:1px solid var(--border);${!this._groupView ? 'background:var(--primary,#E63329);color:#fff' : 'background:#fff;color:var(--text-2)'}">☰ 전체</button>
        </div>
        ${this._groupView && groups.length ? `<button id="pay-expand-all" class="btn btn-sm" style="font-size:12px">${allCollapsed ? '⊞ 모두 펼치기' : '⊟ 모두 접기'}</button>` : ''}
        <button id="pay-export" class="btn btn-sm" style="margin-left:auto;font-size:12px;background:#ECFDF5;color:#0F7A3F;border:1px solid #A7F3D0">⤓ 엑셀</button>
      </div>

      <!-- 테이블 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th id="pay-th-contract" style="${thS}">계약${this._groupView ? '' : sarr('contract_name')}</th>
              <th id="pay-th-cust"  style="${thS}">고객사${this._groupView ? '' : sarr('customer_name')}</th>
              <th id="pay-th-stage" style="${thS}">단계${this._groupView ? '' : sarr('stage_name')}</th>
              <th id="pay-th-amt"   style="${thSR}">수금예정액${sarr('scheduled_amount')}</th>
              <th id="pay-th-due"   style="${thS}">예정일${sarr('due_date')}</th>
              <th style="padding:8px 12px;font-weight:600">상태</th>
              <th style="padding:8px 12px;font-weight:600">진행률</th>
              <th style="padding:8px 12px;width:90px"></th>
            </tr>
          </thead>
          <tbody id="pay-tbody">
            ${bodyRows || EMPTY}
          </tbody>
          ${footRow ? `<tfoot>${footRow}</tfoot>` : ''}
        </table>
      </div>
    `;

    // ── 이벤트 바인딩 ──────────────────────────────────────────

    // 기간 프리셋 → 서버 재조회
    el.querySelectorAll('.pay-period').forEach(btn => {
      btn.addEventListener('click', async () => {
        this._filter.due_from = btn.dataset.f;
        this._filter.due_to   = btn.dataset.t;
        await this._reloadAndRender();
      });
    });

    // 상태 필터 → 서버 재조회
    document.getElementById('pay-fl-status')?.addEventListener('change', async e => {
      this._filter.status = e.target.value;
      await this._reloadAndRender();
    });

    // 검색 → 클라이언트 즉시 반영 (200ms debounce)
    document.getElementById('pay-fl-search')?.addEventListener('input', e => {
      this._filter.search = e.target.value;
      clearTimeout(this._filterTimer);
      this._filterTimer = setTimeout(() => this._renderOverview(), 200);
    });

    // 날짜 범위 → 서버 재조회
    document.getElementById('pay-fl-from')?.addEventListener('change', async e => {
      this._filter.due_from = e.target.value;
      await this._reloadAndRender();
    });
    document.getElementById('pay-fl-to')?.addEventListener('change', async e => {
      this._filter.due_to = e.target.value;
      await this._reloadAndRender();
    });

    // 정렬 헤더 클릭
    [['pay-th-contract', 'contract_name'], ['pay-th-cust', 'customer_name'], ['pay-th-stage', 'stage_name'],
     ['pay-th-amt', 'scheduled_amount'], ['pay-th-due', 'due_date']
    ].forEach(([thId, col]) => {
      document.getElementById(thId)?.addEventListener('click', () => this._setSortKey(col));
    });

    // 행 클릭 → 상세
    el.querySelectorAll('.pay-row').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('.pay-btn-record,.pay-btn-edit,.pay-btn-delete')) return;
        this._openScheduleDetail(parseInt(tr.dataset.id, 10));
      });
    });

    // 입금 등록
    el.querySelectorAll('.pay-btn-record').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._openRecordModal(parseInt(btn.dataset.id, 10));
      });
    });

    // 수정
    el.querySelectorAll('.pay-btn-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const s = this._schedules.find(x => x.id === parseInt(btn.dataset.id, 10));
        if (s) this._openScheduleModal(s);
      });
    });

    // 삭제
    el.querySelectorAll('.pay-btn-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._deleteSchedule(parseInt(btn.dataset.id, 10));
      });
    });

    // 뷰 토글 (계약별 그룹 ↔ 전체 평면) — localStorage 기억
    document.getElementById('pay-view-group')?.addEventListener('click', () => {
      if (this._groupView) return;
      this._groupView = true;
      try { localStorage.setItem('oci_pay_groupview', '1'); } catch (_) { /* 무시 */ }
      this._renderOverview();
    });
    document.getElementById('pay-view-flat')?.addEventListener('click', () => {
      if (!this._groupView) return;
      this._groupView = false;
      try { localStorage.setItem('oci_pay_groupview', '0'); } catch (_) { /* 무시 */ }
      this._renderOverview();
    });

    // 모두 펼치기 / 접기 (현재 표시 그룹 기준)
    document.getElementById('pay-expand-all')?.addEventListener('click', () => {
      const keys = this._groupSchedules(this._filteredAndSorted()).map(g => g.key);
      const allCol = keys.length > 0 && keys.every(k => this._collapsedGroups.has(k));
      if (allCol) this._collapsedGroups.clear();
      else keys.forEach(k => this._collapsedGroups.add(k));
      this._renderOverview();
    });

    // 엑셀 내보내기 (현재 필터 반영)
    document.getElementById('pay-export')?.addEventListener('click', () => this._exportExcel());

    // 계약 그룹 헤더 클릭 → 펼침/접힘 (DOM display 토글, 재조회 없음)
    el.querySelectorAll('.pay-grp').forEach(tr => {
      tr.addEventListener('click', () => {
        const gi = tr.dataset.gi;
        const grp = groups[Number(gi)];
        if (!grp) return;
        const willCollapse = !this._collapsedGroups.has(grp.key);
        if (willCollapse) this._collapsedGroups.add(grp.key);
        else this._collapsedGroups.delete(grp.key);
        el.querySelectorAll(`.pay-row[data-gi="${gi}"]`).forEach(c => {
          c.style.display = willCollapse ? 'none' : '';
        });
        const caret = tr.querySelector('.pay-grp-caret');
        if (caret) caret.textContent = willCollapse ? '▸' : '▾';
      });
    });
  },

  // 표시용 계약명/고객사 — 연결된 계약이면 contracts 신뢰값(비정규화 드리프트 차단),
  //   미연결(직접 등록)이면 스케줄 비정규화값 사용
  _dispContract(s) {
    return s.contract_id && s.contract_title ? s.contract_title : s.contract_name || '';
  },
  _dispCustomer(s) {
    return s.contract_id && s.linked_customer_name ? s.linked_customer_name : s.customer_name || '';
  },

  // 계약금액 대비 수금계획 정합성 라인 (그룹 부모행 — Step 3)
  //   양수 gap=미편성(계획<계약금), 음수=초과편성. contract_amount/scheduled_amount 동일 VAT포함 기준.
  _gapLine(g) {
    if (!g.linked || !(g.contract_amount > 0)) return '';
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const cur = g.currency === 'KRW' ? '₩' : `${g.currency} `;
    const thr = Math.max(10000, g.contract_amount * 0.005); // 0.5% 또는 1만원 이상만 갭 표기
    let badge;
    if (g.gap > thr) badge = `<span style="color:#E63329;font-weight:600">▲ 미편성 ${cur}${fmt(g.gap)}</span>`;
    else if (g.gap < -thr)
      badge = `<span style="color:#F59C00;font-weight:600">▼ 초과 ${cur}${fmt(-g.gap)}</span>`;
    else badge = `<span style="color:#0F7A3F;font-weight:600">✓ 계획일치</span>`;
    return `<div style="font-size:10px;color:var(--text-3);white-space:nowrap">계약금 ${cur}${fmt(g.contract_amount)}</div>
            <div style="font-size:10px;white-space:nowrap">${badge}</div>`;
  },

  // 자식(단계) 행 HTML — 평면뷰/그룹뷰 공용
  //   opts.gi 가 있으면 그룹 자식(들여쓰기 + data-gi), opts.hidden 이면 접힘 상태
  _scheduleRowHtml(s, opts = {}) {
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const m = this._STATUS_META[s.status] || this._STATUS_META.scheduled;
    const pct =
      s.scheduled_amount > 0
        ? Math.min(Math.round((Number(s.paid_amount) / Number(s.scheduled_amount)) * 100), 100)
        : 0;
    const dDay = this._dDay(s.due_date);
    const grouped = opts.gi !== undefined;
    const giAttr = grouped ? ` data-gi="${opts.gi}"` : '';
    const hide = opts.hidden ? 'display:none;' : '';
    // 1~3열: 평면=계약/고객사/단계, 그룹=빈칸·빈칸·들여쓴 단계(계약·고객사는 부모행)
    const lead = grouped
      ? `<td style="padding:8px 12px"></td>
          <td style="padding:8px 12px"></td>
          <td style="padding:8px 12px 8px 24px;font-size:13px"><span style="color:#CBD5E1;margin-right:4px">└</span>${this._esc(s.stage_name)}</td>`
      : `<td style="padding:10px 12px">
            <div style="font-weight:600;font-size:13px">${this._esc(this._dispContract(s) || '—')}</div>
            <div style="font-size:11px;color:var(--text-3)">${this._esc(s.contract_no || (s.contract_id ? '' : '직접 등록'))}</div>
          </td>
          <td style="padding:10px 12px;font-size:13px">${this._esc(this._dispCustomer(s) || '—')}</td>
          <td style="padding:10px 12px;font-size:13px">${this._esc(s.stage_name)}</td>`;
    return `
        <tr class="pay-row" data-id="${s.id}"${giAttr} style="${hide}cursor:pointer;border-bottom:1px solid var(--border)">
          ${lead}
          <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:600">₩${fmt(s.scheduled_amount)}</td>
          <td style="padding:10px 12px;font-size:12px;white-space:nowrap">
            ${s.due_date || '—'}
            <span style="margin-left:4px;font-size:11px;font-weight:600;color:${dDay.color}">${dDay.label}</span>
          </td>
          <td style="padding:10px 12px">
            <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:${m.bg};color:${m.color};font-weight:600">${m.label}</span>
          </td>
          <td style="padding:10px 12px;min-width:90px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:4px;background:#E5E7EB;border-radius:2px">
                <div style="height:100%;width:${pct}%;background:#1664E5;border-radius:2px"></div>
              </div>
              <span style="font-size:11px;color:var(--text-3);min-width:28px">${pct}%</span>
            </div>
          </td>
          <td style="padding:10px 12px;white-space:nowrap">
            <button class="pay-btn-record btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE;border-radius:6px;margin-right:3px" title="입금 등록">💳</button>
            <button class="pay-btn-edit btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#F3F4F6;color:#374151;border:1px solid var(--border);border-radius:6px;margin-right:3px" title="수정">✏️</button>
            <button class="pay-btn-delete btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#FFF5F5;color:#E63329;border:1px solid #FECACA;border-radius:6px" title="삭제">🗑️</button>
          </td>
        </tr>`;
  },

  // 계약 단위 그룹핑 (contract_id 우선, null 이면 고객사|계약명 폴백)
  //   합계 예정액/수금액·진행률·롤업 상태·다음 수금예정일 계산 → 다음 예정일 오름차순 정렬
  _groupSchedules(list) {
    const map = new Map();
    for (const s of list) {
      const linked = s.contract_id !== null && s.contract_id !== undefined;
      const key = linked
        ? `c:${s.contract_id}`
        : `m:${s.customer_name || ''}|${s.contract_name || ''}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          linked,
          customer_name: this._dispCustomer(s),
          contract_name: this._dispContract(s),
          contract_no: s.contract_no,
          contract_amount: Number(s.contract_amount || 0), // 연결 계약의 계약금액 (Step 3 정합성)
          currency: s.currency || 'KRW',
          children: [],
        });
      }
      map.get(key).children.push(s);
    }
    const groups = [...map.values()].map(g => {
      const totSch = g.children.reduce((a, c) => a + Number(c.scheduled_amount || 0), 0);
      const totPaid = g.children.reduce((a, c) => a + Number(c.paid_amount || 0), 0);
      const pct = totSch > 0 ? Math.min(Math.round((totPaid / totSch) * 100), 100) : 0;
      const sts = g.children.map(c => c.status);
      let status = 'scheduled';
      if (sts.includes('overdue')) status = 'overdue';
      else if (sts.length && sts.every(x => x === 'collected')) status = 'collected';
      else if (sts.some(x => x === 'partial' || x === 'collected')) status = 'partial';
      else if (sts.includes('invoiced')) status = 'invoiced';
      const pendingDue = g.children
        .filter(c => c.status !== 'collected' && c.status !== 'written_off' && c.due_date)
        .map(c => String(c.due_date).slice(0, 10))
        .sort();
      const nextDue = pendingDue.length ? pendingDue[0] : null;
      // 정합성: 계약금액(VAT별도 기준) 대비 수금계획(VAT포함 scheduled_amount) 갭
      //   양수=미편성(계획<계약금), 음수=초과편성. 연결 계약 + 계약금액 입력시만.
      const gap = g.linked && g.contract_amount > 0 ? g.contract_amount - totSch : 0;
      return { ...g, totSch, totPaid, pct, status, nextDue, gap };
    });
    // 그룹 정렬: 다음 수금예정일 빠른 순, 완료(nextDue 없음)는 하단
    groups.sort((a, b) => {
      if (a.nextDue && b.nextDue) return a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0;
      if (a.nextDue) return -1;
      if (b.nextDue) return 1;
      return 0;
    });
    return groups;
  },

  // ── F3. 미수금 탭 ───────────────────────────────────────────
  async _renderOverdue() {
    await this._loadOverdue();
    const el = document.getElementById('pay-tab-content');

    // 연체 알림 액션바 (목록 유무와 무관하게 항상 표시 — 설정/스캔 접근성)
    const notifyEmail = this._esc(this._config?.notify_email || '');
    const actionBar = `
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:center">
          <button id="pay-btn-alerts" class="btn btn-sm" style="background:#FFF7ED;color:#C2410C;border:1px solid #FED7AA">
            🔔 연체 알림<span id="pay-alert-badge" style="display:none;margin-left:6px;background:#E63329;color:#fff;border-radius:9px;padding:1px 6px;font-size:11px;font-weight:700">0</span>
          </button>
          <button id="pay-btn-scan" class="btn btn-sm" style="background:#F3F4F6;border:1px solid var(--border)">↻ 지금 스캔</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <label for="pay-notify-email" style="font-size:12px;color:var(--text-3)">📧 재무팀 알림 메일</label>
          <input id="pay-notify-email" type="email" value="${notifyEmail}" placeholder="finance@company.com"
            style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;width:210px"/>
          <button id="pay-notify-save" class="btn btn-sm btn-primary">저장</button>
        </div>
      </div>
      <div id="pay-dunning-panel" style="margin-bottom:12px"></div>`;

    if (!this._overdue.length) {
      el.innerHTML =
        actionBar +
        `<div style="text-align:center;padding:48px;color:var(--text-3)">
          <div style="font-size:40px;margin-bottom:12px">✅</div>
          <div>현재 연체된 미수금이 없습니다</div>
        </div>`;
      this._bindOverdueActions();
      return;
    }
    const rows = this._overdue.map(s => `
      <tr>
        <td style="padding:10px 12px">
          <div style="font-weight:600">${this._esc(s.customer_name || '—')}</div>
          <div style="font-size:11px;color:var(--text-3)">${this._esc(s.stage_name)}</div>
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#E63329;font-weight:700">
          ₩${Number(s.scheduled_amount).toLocaleString('ko-KR')}
        </td>
        <td style="padding:10px 12px;font-size:13px">${s.due_date}</td>
        <td style="padding:10px 12px">
          <span style="background:#FEF2F2;color:#E63329;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">
            D+${s.overdue_days}일 연체
          </span>
        </td>
        <td style="padding:10px 12px">
          <button class="pay-btn-record btn btn-sm" data-id="${s.id}"
            style="font-size:11px;padding:3px 8px;background:#FFF5F5;color:#E63329;border:1px solid #FECACA;border-radius:6px">
            💳 입금등록
          </button>
        </td>
      </tr>
    `).join('');

    el.innerHTML =
      actionBar +
      `
      <div style="background:#FFF5F5;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <span style="font-size:16px">⚠️</span>
        <span style="font-size:13px;color:#E63329;font-weight:600">연체 ${this._overdue.length}건 — 즉시 수금 조치가 필요합니다</span>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th style="padding:8px 12px;text-align:left;font-weight:600">고객사 / 단계</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">연체금액</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">예정일</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">연체일수</th>
              <th style="padding:8px 12px"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    el.querySelectorAll('.pay-btn-record').forEach(btn => {
      btn.addEventListener('click', () => this._openRecordModal(parseInt(btn.dataset.id, 10)));
    });
    this._bindOverdueActions();
  },

  // 연체 알림 액션바 이벤트 바인딩 (목록 유무 공용) + 배지 갱신
  _bindOverdueActions() {
    document.getElementById('pay-btn-alerts')?.addEventListener('click', () => this._openAlertsModal());
    document.getElementById('pay-btn-scan')?.addEventListener('click', () => this._runScan());
    document.getElementById('pay-notify-save')?.addEventListener('click', () => this._saveNotifyEmail());
    this._refreshAlertBadge();
    this._renderDunningPanel(); // [P3-B] 독촉 단계 패널
  },

  // 미읽음 알림 수 배지 갱신
  async _refreshAlertBadge() {
    try {
      const res = await API.get('/payments/notifications?status=unread&limit=1');
      const n = Number(res?.unread_count || 0);
      const badge = document.getElementById('pay-alert-badge');
      if (badge) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.style.display = n > 0 ? 'inline-block' : 'none';
      }
    } catch (_) {
      /* 배지는 보조 정보 — 실패해도 무시 */
    }
  },

  // 재무팀 알림 메일 저장 (빈 값 = 해제)
  async _saveNotifyEmail() {
    const input = document.getElementById('pay-notify-email');
    const email = (input?.value || '').trim();
    try {
      const res = await API.put('/payments/config', { notify_email: email });
      if (res.success) {
        if (this._config) this._config.notify_email = email;
        Toast.success?.(email ? '재무팀 알림 메일이 저장됐습니다' : '재무팀 알림 메일이 해제됐습니다');
      } else {
        Toast.error?.(res.error || '저장 실패');
      }
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err?.message || err));
    }
  },

  // 연체 즉시 스캔 (인앱 알림 + 재무팀 메일 발송/큐잉)
  async _runScan() {
    const btn = document.getElementById('pay-btn-scan');
    if (btn) { btn.disabled = true; btn.textContent = '스캔 중…'; }
    try {
      const res = await API.post('/payments/notifications/scan', {});
      if (res.success) {
        const d = res.data || {};
        const parts = [`연체 ${d.overdue_total || 0}건`, `신규 알림 ${d.created_inapp || 0}건`];
        if (d.created_email) parts.push(d.emailed ? '재무팀 메일 발송' : '재무팀 메일 대기');
        Toast.success?.('스캔 완료: ' + parts.join(' · '));
      } else {
        Toast.error?.(res.error || '스캔 실패');
      }
    } catch (err) {
      Toast.error?.('스캔 실패: ' + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ 지금 스캔'; }
      await this._loadOverdue();
      this._renderOverdue();
    }
  },

  // 연체 알림 목록 모달 (인앱) — 읽음/모두읽음
  async _openAlertsModal() {
    let list = [];
    try {
      const res = await API.get('/payments/notifications?limit=100');
      if (res.success) list = res.data || [];
    } catch (err) {
      Toast.error?.('알림 조회 실패: ' + (err?.message || err));
      return;
    }
    const body = list.length
      ? list
          .map(n => {
            const payload = this._parseJson(n.payload_json);
            const unread = n.status === 'unread';
            const cust = this._esc(n.customer_name || '—');
            const ctx = this._esc(payload.contract_name || '') + (payload.stage ? ' · ' + this._esc(payload.stage) : '');
            const amt =
              n.amount !== null && n.amount !== undefined
                ? '₩' + Number(n.amount).toLocaleString('ko-KR')
                : '';
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);${unread ? 'background:#FFFBF5' : 'opacity:.65'}">
                <div style="min-width:0">
                  <div style="font-weight:600;font-size:13px">${cust}
                    <span style="background:#FEF2F2;color:#E63329;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;margin-left:6px">D+${n.overdue_days || 0}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ctx || '—'}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span style="font-size:13px;color:#E63329;font-weight:700">${amt}</span>
                  ${unread ? `<button class="pay-alert-read btn btn-sm" data-id="${n.id}" style="font-size:11px;padding:2px 8px">읽음</button>` : '<span style="font-size:11px;color:var(--text-3)">읽음</span>'}
                </div>
              </div>`;
          })
          .join('')
      : `<div style="text-align:center;padding:40px;color:var(--text-3)">알림이 없습니다</div>`;

    Modal.open({
      title: '🔔 연체 미수금 알림',
      size: 'md',
      body: `<div id="pay-alerts-list" style="max-height:50vh;overflow:auto;border:1px solid var(--border);border-radius:8px">${body}</div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">닫기</button>
        <button id="pay-alerts-readall" class="btn btn-primary">모두 읽음</button>`,
      onOpen: () => {
        document.querySelectorAll('.pay-alert-read').forEach(b => {
          b.addEventListener('click', async () => {
            await this._markAlertRead(b.dataset.id);
            Modal.close();
            this._openAlertsModal();
          });
        });
        document.getElementById('pay-alerts-readall')?.addEventListener('click', async () => {
          await this._markAlertRead('all');
          Modal.close();
          this._refreshAlertBadge();
          Toast.success?.('모든 알림을 읽음 처리했습니다');
        });
      },
    });
  },

  async _markAlertRead(id) {
    try {
      await API.put('/payments/notifications/' + encodeURIComponent(id) + '/read', {});
      this._refreshAlertBadge();
    } catch (err) {
      Toast.error?.('읽음 처리 실패: ' + (err?.message || err));
    }
  },

  // ─── 독촉(dunning) 단계 패널 [P3-B] ─────────────────────────
  //   미수금 탭 actionBar 아래 삽입(#pay-dunning-panel). 기존 연체 테이블과 독립.
  //   /dunning/list 에서 '도래한 단계'만 노출 + 스캔/미리보기/이력.
  _dunningStageBadge(kind) {
    const M = {
      dunning_1st: { label: '1차 안내', bg: '#FFF7ED', color: '#C2410C', bd: '#FED7AA' },
      dunning_2nd: { label: '2차 경고', bg: '#FFEDD5', color: '#EA580C', bd: '#FDBA74' },
      dunning_3rd: { label: '3차 최종통보', bg: '#FEF2F2', color: '#DC2626', bd: '#FECACA' },
      _pending: { label: '독촉 전', bg: '#F3F4F6', color: '#6B7280', bd: '#E5E7EB' },
    };
    return M[kind] || M._pending;
  },

  async _renderDunningPanel() {
    const wrap = document.getElementById('pay-dunning-panel');
    if (!wrap) return;
    let list = [];
    try {
      const res = await API.get('/payments/dunning/list');
      if (res.success) list = res.data || [];
    } catch (_) {
      /* 보조 패널 — 실패 시 빈 상태 */
    }
    const staged = list.filter(r => r.dunning_kind);
    const byStage = {};
    list.forEach(r => {
      const k = r.dunning_kind || '_pending';
      byStage[k] = byStage[k] || { count: 0, amount: 0 };
      byStage[k].count++;
      byStage[k].amount += Number(r.remaining) || 0;
    });
    const chips = ['dunning_1st', 'dunning_2nd', 'dunning_3rd', '_pending']
      .filter(k => byStage[k])
      .map(k => {
        const b = this._dunningStageBadge(k);
        return `<span style="display:inline-flex;align-items:center;background:${b.bg};color:${b.color};border:1px solid ${b.bd};border-radius:9px;padding:2px 9px;font-size:11px;font-weight:700">${b.label} ${byStage[k].count}건</span>`;
      })
      .join(' ');
    const header = `
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:700;color:var(--text)">📢 단계별 독촉</span>
          ${chips || '<span style="font-size:12px;color:var(--text-3)">도래한 독촉 단계 없음</span>'}
        </div>
        <div style="display:flex;gap:6px">
          <button id="pay-dun-scan" class="btn btn-sm" style="background:#F3F4F6;border:1px solid var(--border)">↻ 독촉 스캔</button>
          <button id="pay-dun-history" class="btn btn-sm" style="background:#fff;border:1px solid var(--border)">📜 이력</button>
          <button id="pay-dun-settings" class="btn btn-sm" style="background:#fff;border:1px solid var(--border)">⚙ 설정</button>
        </div>
      </div>`;
    let tableHtml = '';
    if (staged.length) {
      const rows = staged
        .map(r => {
          const b = this._dunningStageBadge(r.dunning_kind);
          return `
            <tr>
              <td style="padding:8px 12px">
                <div style="font-weight:600;font-size:13px">${this._esc(r.customer_name || '—')}</div>
                <div style="font-size:11px;color:var(--text-3)">${this._esc(r.contract_name || '')}${r.stage_name ? ' · ' + this._esc(r.stage_name) : ''}</div>
              </td>
              <td style="padding:8px 12px;font-size:13px;color:#E63329;font-weight:700">₩${Number(r.remaining).toLocaleString('ko-KR')}</td>
              <td style="padding:8px 12px;font-size:12px">${this._esc(r.due_date)} <span style="color:var(--text-3)">(D+${r.overdue_days})</span></td>
              <td style="padding:8px 12px"><span style="background:${b.bg};color:${b.color};border:1px solid ${b.bd};padding:2px 8px;border-radius:9px;font-size:11px;font-weight:700">${b.label}</span></td>
              <td style="padding:8px 12px">
                <button class="pay-dun-preview btn btn-sm" data-id="${r.schedule_id}" data-kind="${r.dunning_kind}" style="font-size:11px;padding:3px 8px">✉ 미리보기</button>
              </td>
            </tr>`;
        })
        .join('');
      tableHtml = `
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th style="padding:8px 12px;text-align:left;font-weight:600">고객사 / 계약·단계</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">미수금</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">예정일</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">독촉 단계</th>
              <th style="padding:8px 12px"></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
    wrap.innerHTML = `
      <div style="background:#FFFBF5;border:1px solid #FDE8D0;border-radius:8px;padding:10px 14px">
        ${header}
        ${tableHtml}
      </div>`;
    document.getElementById('pay-dun-scan')?.addEventListener('click', () => this._runDunningScan());
    document.getElementById('pay-dun-history')?.addEventListener('click', () => this._openDunningHistory());
    document.getElementById('pay-dun-settings')?.addEventListener('click', () => this._openDunningSettings());
    wrap.querySelectorAll('.pay-dun-preview').forEach(btn => {
      btn.addEventListener('click', () =>
        this._openDunningPreview(parseInt(btn.dataset.id, 10), btn.dataset.kind)
      );
    });
  },

  async _runDunningScan() {
    const btn = document.getElementById('pay-dun-scan');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '스캔 중…';
    }
    try {
      const res = await API.post('/payments/dunning/scan', {});
      if (res.success) {
        const d = res.data || {};
        const bs = d.by_stage || {};
        const parts = Object.keys(bs).length
          ? Object.entries(bs).map(([k, v]) => `${this._dunningStageBadge(k).label} ${v}건`)
          : ['신규 없음'];
        Toast.success?.(`독촉 스캔: 생성 ${d.created || 0}건 (${parts.join(' · ')})`);
      } else {
        Toast.error?.(res.error || '스캔 실패');
      }
    } catch (err) {
      Toast.error?.('스캔 실패: ' + (err?.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '↻ 독촉 스캔';
      }
      await this._renderDunningPanel();
      this._refreshAlertBadge();
    }
  },

  async _openDunningPreview(scheduleId, kind) {
    let data;
    try {
      const res = await API.post('/payments/dunning/preview', { schedule_id: scheduleId, kind });
      if (!res.success) throw new Error(res.error || '미리보기 실패');
      data = res.data;
    } catch (err) {
      Toast.error?.('미리보기 실패: ' + (err?.message || err));
      return;
    }
    const b = this._dunningStageBadge(kind);
    Modal.open({
      title: '✉ 독촉 메시지 미리보기',
      size: 'md',
      body: `
        <div style="margin-bottom:8px"><span style="background:${b.bg};color:${b.color};border:1px solid ${b.bd};padding:2px 8px;border-radius:9px;font-size:11px;font-weight:700">${b.label}</span></div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:4px">제목</div>
        <div style="background:#F9FAFB;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;font-weight:600;margin-bottom:10px">${this._esc(data.subject)}</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:4px">본문</div>
        <pre style="background:#F9FAFB;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;max-height:40vh;overflow:auto">${this._esc(data.body)}</pre>
        <div style="margin-top:10px;display:flex;gap:6px;align-items:center">
          <label style="font-size:12px;color:var(--text-3);white-space:nowrap">수신 이메일</label>
          <input id="pay-dun-to" type="email" placeholder="customer@corp.com" style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px"/>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">💡 담당자 검토 후 발송됩니다 · Google(Gmail) 연동 필요.</div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">닫기</button>
        <button id="pay-dun-copy" class="btn">📋 본문 복사</button>
        <button id="pay-dun-send" class="btn btn-primary">✉ 메일 발송</button>`,
      onOpen: () => {
        document.getElementById('pay-dun-copy')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(`${data.subject}\n\n${data.body}`);
            Toast.success?.('독촉 메시지를 복사했습니다');
          } catch (_) {
            Toast.error?.('복사 실패 — 직접 선택해 복사하세요');
          }
        });
        document.getElementById('pay-dun-send')?.addEventListener('click', async () => {
          const to = (document.getElementById('pay-dun-to')?.value || '').trim();
          if (!to) {
            Toast.error?.('수신 이메일을 입력하세요');
            return;
          }
          if (!confirm(`${to} 에게 독촉 메일을 발송하시겠습니까?`)) return;
          const sendBtn = document.getElementById('pay-dun-send');
          if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = '발송 중…';
          }
          try {
            const r = await API.post('/payments/dunning/send', { schedule_id: scheduleId, kind, to });
            if (r.success) {
              Toast.success?.(`독촉 메일 발송 완료: ${to}`);
              Modal.close();
              this._renderDunningPanel();
            } else {
              Toast.error?.(r.error || '발송 실패');
              if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = '✉ 메일 발송';
              }
            }
          } catch (err) {
            Toast.error?.('발송 실패: ' + (err?.message || err));
            if (sendBtn) {
              sendBtn.disabled = false;
              sendBtn.textContent = '✉ 메일 발송';
            }
          }
        });
      },
    });
  },

  async _openDunningHistory() {
    let list = [];
    try {
      const res = await API.get('/payments/dunning/history?limit=200');
      if (res.success) list = res.data || [];
    } catch (err) {
      Toast.error?.('이력 조회 실패: ' + (err?.message || err));
      return;
    }
    const body = list.length
      ? list
          .map(n => {
            const b = this._dunningStageBadge(n.kind);
            const cust = this._esc(n.customer_name || '—');
            const when = this._esc(String(n.created_at || '').slice(0, 16).replace('T', ' '));
            const amt =
              n.amount !== null && n.amount !== undefined
                ? '₩' + Number(n.amount).toLocaleString('ko-KR')
                : '';
            const ch = n.channel === 'email' ? '메일' : '인앱';
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border)">
                <div style="min-width:0">
                  <div style="font-size:13px;font-weight:600">${cust}
                    <span style="background:${b.bg};color:${b.color};border:1px solid ${b.bd};padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;margin-left:6px">${b.label}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-3)">${when} · ${ch} · ${this._esc(n.status)}</div>
                </div>
                <span style="font-size:13px;color:#E63329;font-weight:700;flex-shrink:0">${amt}</span>
              </div>`;
          })
          .join('')
      : `<div style="text-align:center;padding:40px;color:var(--text-3)">독촉 이력이 없습니다</div>`;
    Modal.open({
      title: '📜 독촉 이력',
      size: 'md',
      body: `<div style="max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:8px">${body}</div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">닫기</button>`,
    });
  },

  // 독촉 설정 — 단계 정책(연체 일수) + 메시지 템플릿 편집 [P3-C]
  async _openDunningSettings() {
    let policy = [];
    let templates = {};
    try {
      const [pRes, tRes] = await Promise.all([
        API.get('/payments/dunning/policy'),
        API.get('/payments/dunning/templates'),
      ]);
      policy = pRes?.data?.policy || [];
      templates = tRes?.data || {};
    } catch (err) {
      Toast.error?.('설정 조회 실패: ' + (err?.message || err));
      return;
    }
    const policyRows = policy
      .map(
        s => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span style="width:96px;font-size:12px;font-weight:600">${this._esc(s.label)}</span>
          <span style="font-size:12px;color:var(--text-3)">연체</span>
          <input class="pay-dun-mindays" data-kind="${s.kind}" type="number" min="0" value="${s.min_days}"
            style="width:72px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px"/>
          <span style="font-size:12px;color:var(--text-3)">일 이상</span>
        </div>`
      )
      .join('');
    const tplRows = policy
      .map(s => {
        const t = templates[s.kind] || { subject: '', body: '' };
        return `
        <div style="margin-bottom:12px">
          <div style="font-size:12px;font-weight:700;margin-bottom:4px">${this._esc(s.label)}</div>
          <input class="pay-dun-tpl-subject" data-kind="${s.kind}" value="${this._esc(t.subject)}" placeholder="제목"
            style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-bottom:4px"/>
          <textarea class="pay-dun-tpl-body" data-kind="${s.kind}" rows="4" placeholder="본문"
            style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;resize:vertical">${this._esc(t.body)}</textarea>
        </div>`;
      })
      .join('');
    Modal.open({
      title: '⚙ 독촉 설정',
      size: 'md',
      body: `
        <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">치환자: {customer_name} {contract_name} {stage} {amount} {currency} {due_date} {overdue_days} {company}</div>
        <div style="font-weight:700;font-size:13px;margin:6px 0">단계 정책 (연체 경과일)</div>
        ${policyRows}
        <div style="font-weight:700;font-size:13px;margin:14px 0 6px">메시지 템플릿</div>
        ${tplRows}`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">닫기</button>
        <button id="pay-dun-settings-save" class="btn btn-primary">저장</button>`,
      onOpen: () => {
        document
          .getElementById('pay-dun-settings-save')
          ?.addEventListener('click', () => this._saveDunningSettings(policy));
      },
    });
  },

  async _saveDunningSettings(policy) {
    const stages = policy.map(s => {
      const inp = document.querySelector(`.pay-dun-mindays[data-kind="${s.kind}"]`);
      const days = inp ? parseInt(inp.value, 10) : s.min_days;
      return { kind: s.kind, label: s.label, min_days: Number.isFinite(days) ? days : s.min_days };
    });
    const templates = {};
    document.querySelectorAll('.pay-dun-tpl-subject').forEach(inp => {
      const k = inp.dataset.kind;
      const bodyEl = document.querySelector(`.pay-dun-tpl-body[data-kind="${k}"]`);
      templates[k] = { subject: inp.value || '', body: bodyEl ? bodyEl.value : '' };
    });
    try {
      await API.put('/payments/dunning/policy', { stages });
      await API.put('/payments/dunning/templates', { templates });
      Toast.success?.('독촉 설정이 저장됐습니다');
      Modal.close();
      this._renderDunningPanel();
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err?.message || err));
    }
  },

  // payload_json 안전 파싱
  _parseJson(s) {
    if (!s) return {};
    if (typeof s === 'object') return s;
    try {
      return JSON.parse(s);
    } catch (_) {
      return {};
    }
  },

  // ── F4. 세금계산서 탭 ───────────────────────────────────────
  //   상태: draft(작성중) → requested(발행요청) → issued(발행완료) → cancelled(취소)
  //   ※ 발행완료는 "수동 기록" — 바로빌 자동발행/국세청 전송은 API 키 등록 후(Phase 2)
  async _renderTax(containerId) {
    // 매출관리 위임 대응: 컨테이너 id 를 받아 기억(재렌더 시 재사용). 기본은 수금관리 컨테이너.
    containerId = containerId || this._taxContainer || 'pay-tab-content';
    this._taxContainer = containerId;
    await this._loadTaxInvoices();
    const el = document.getElementById(containerId);
    if (!el) return; // 대상 컨테이너가 현재 화면에 없으면 무시(타 탭/페이지)
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const TAX_META = {
      draft:     { label: '작성중',   color: '#6B7280', bg: '#F3F4F6' },
      requested: { label: '발행요청', color: '#1664E5', bg: '#EFF6FF' },
      issued:    { label: '발행완료', color: '#0F7A3F', bg: '#ECFDF5' },
      cancelled: { label: '취소',     color: '#9CA3AF', bg: '#F9FAFB' },
    };
    const actBlue  = 'font-size:11px;padding:3px 7px;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE;border-radius:6px;margin-right:3px';
    const actGreen = 'font-size:11px;padding:3px 7px;background:#ECFDF5;color:#0F7A3F;border:1px solid #A7F3D0;border-radius:6px;margin-right:3px';
    const actGray  = 'font-size:11px;padding:3px 7px;background:#F3F4F6;color:#374151;border:1px solid var(--border);border-radius:6px;margin-right:3px';
    const actRed   = 'font-size:11px;padding:3px 7px;background:#FFF5F5;color:#E63329;border:1px solid #FECACA;border-radius:6px';

    const rows = this._taxInvoices.map(t => {
      const m    = TAX_META[t.status] || TAX_META.draft;
      const acts = [];
      if (t.status === 'draft')
        acts.push(`<button class="tax-act btn btn-sm" data-id="${t.id}" data-to="requested" style="${actBlue}">발행요청</button>`);
      if (t.status === 'requested')
        acts.push(`<button class="tax-act btn btn-sm" data-id="${t.id}" data-to="issued" style="${actGreen}" title="발행완료로 표시(수동)">발행완료</button>`);
      if (t.status === 'draft' || t.status === 'requested')
        acts.push(`<button class="tax-edit btn btn-sm" data-id="${t.id}" style="${actGray}" title="수정">✏️</button>`);
      if (t.status === 'requested' || t.status === 'issued')
        acts.push(`<button class="tax-act btn btn-sm" data-id="${t.id}" data-to="cancelled" style="${actGray}" title="취소">취소</button>`);
      if (t.status !== 'issued')
        acts.push(`<button class="tax-del btn btn-sm" data-id="${t.id}" style="${actRed}" title="삭제">🗑️</button>`);
      return `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:10px 12px">
            <div style="font-weight:600;font-size:13px">${this._esc(t.customer_name || '—')}</div>
            <div style="font-size:11px;color:var(--text-3)">${this._esc(t.contract_no || '')}${t.invoice_no ? ' · No.' + this._esc(t.invoice_no) : ''}</div>
          </td>
          <td style="padding:10px 12px;text-align:right;font-size:13px">₩${fmt(t.supply_amount)}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;color:var(--text-3)">₩${fmt(t.tax_amount)}</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:600">₩${fmt(t.total_amount)}</td>
          <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${(t.issue_date || '').slice(0, 10) || '—'}</td>
          <td style="padding:10px 12px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:${m.bg};color:${m.color};font-weight:600">${m.label}</span></td>
          <td style="padding:10px 12px;white-space:nowrap">${acts.join(' ')}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:15px">🧾</span>
        <span style="font-size:12px;color:#92400E;line-height:1.5">세금계산서 <b>발행 상태를 수동으로 기록</b>합니다 (수금 ↔ 계산서 연동).
          바로빌 자동발행·국세청 전송은 <b>API 키 등록 후(Phase 2)</b> 제공됩니다.</span>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
        <button id="tax-btn-import" class="btn btn-sm" style="background:#ECFDF5;color:#0F7A3F;border:1px solid #A7F3D0">⬆ 홈택스 가져오기</button>
        <button id="tax-btn-new" class="btn btn-primary btn-sm">+ 발행요청 생성</button>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th style="padding:8px 12px;text-align:left;font-weight:600">고객사 / 계약</th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">공급가액</th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">세액</th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">합계</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">발행일</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">상태</th>
              <th style="padding:8px 12px"></th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7" style="text-align:center;padding:48px 20px;color:var(--text-3)">
              <div style="font-size:32px;margin-bottom:8px">🧾</div>
              <div style="font-weight:600;margin-bottom:4px">세금계산서가 없습니다</div>
              <div style="font-size:12px">[+ 발행요청 생성] 또는 수금 상세에서 발행요청을 만드세요</div>
            </td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('tax-btn-new')?.addEventListener('click', () => this._openTaxModal());
    document.getElementById('tax-btn-import')?.addEventListener('click', () => this._openHometaxImportModal());
    el.querySelectorAll('.tax-act').forEach(b =>
      b.addEventListener('click', () => this._taxStatusAction(parseInt(b.dataset.id, 10), b.dataset.to))
    );
    el.querySelectorAll('.tax-edit').forEach(b =>
      b.addEventListener('click', () => {
        const inv = this._taxInvoices.find(x => x.id === parseInt(b.dataset.id, 10));
        if (inv) this._openTaxModal(inv);
      })
    );
    el.querySelectorAll('.tax-del').forEach(b =>
      b.addEventListener('click', () => this._deleteTaxInvoice(parseInt(b.dataset.id, 10)))
    );
  },

  // 세금계산서 발행요청/수정 모달 (invoice=수정, prefill=수금 스케줄에서 연동 생성)
  _openTaxModal(invoice = null, prefill = null) {
    const isEdit = !!(invoice && invoice.id);
    const src    = invoice || prefill || {};
    const today  = new Date().toISOString().slice(0, 10);
    const supply0 = Number(src.supply_amount || 0);
    const tax0 =
      src.tax_amount !== undefined && src.tax_amount !== null
        ? Number(src.tax_amount)
        : Math.round(supply0 * 0.1);

    Modal.open({
      title: isEdit ? '🧾 세금계산서 수정' : '🧾 세금계산서 발행요청',
      size: 'sm',
      body: `
        ${
          src.customer_name || src.contract_name
            ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:9px 12px;margin-bottom:12px;font-size:12px;color:#1664E5">
                 🔗 연동: <b>${this._esc(src.customer_name || '')}</b>${src.contract_name ? ' · ' + this._esc(src.contract_name) : ''}
               </div>`
            : ''
        }
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">고객사 *</label>
            <input id="tax-cust" class="form-input" value="${this._esc(src.customer_name || '')}" placeholder="고객사명">
          </div>
          <div>
            <label class="form-label">공급가액 (VAT 별도) *</label>
            <input id="tax-supply" type="number" class="form-input" value="${supply0 || ''}" placeholder="0">
          </div>
          <div>
            <label class="form-label">세액 (VAT)</label>
            <div style="display:flex;gap:8px">
              <input id="tax-tax" type="number" class="form-input" value="${tax0 || ''}" placeholder="0" style="flex:1">
              <button type="button" id="tax-vat10" class="btn btn-sm" style="white-space:nowrap;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE">VAT 10%</button>
            </div>
          </div>
          <div>
            <label class="form-label">발행일</label>
            <input id="tax-date" type="date" class="form-input" value="${this._esc((src.issue_date || '').slice(0, 10) || today)}" min="1000-01-01" max="9999-12-31">
          </div>
          <div>
            <label class="form-label">계산서 번호 (선택)</label>
            <input id="tax-no" class="form-input" value="${this._esc(src.invoice_no || '')}" placeholder="자사 발행번호 (발행 시 입력)">
          </div>
          <div>
            <label class="form-label">비고</label>
            <input id="tax-note" class="form-input" value="${this._esc(src.note || '')}" placeholder="메모">
          </div>
        </div>
      `,
      footer: `
        <button id="tax-cancel" class="btn btn-secondary">취소</button>
        <button id="tax-save" class="btn btn-primary">${isEdit ? '저장' : '발행요청 생성'}</button>
      `,
      onOpen: () => {
        document.getElementById('tax-vat10')?.addEventListener('click', () => {
          const s = Number(document.getElementById('tax-supply')?.value || 0);
          document.getElementById('tax-tax').value = Math.round(s * 0.1);
        });
        document.getElementById('tax-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('tax-save')?.addEventListener('click', async () => {
          const customer_name = document.getElementById('tax-cust')?.value?.trim();
          const supply_amount = document.getElementById('tax-supply')?.value;
          if (!customer_name) { Toast.error?.('고객사를 입력하세요'); return; }
          if (!supply_amount) { Toast.error?.('공급가액을 입력하세요'); return; }
          const issue_date = document.getElementById('tax-date')?.value || '';
          if (issue_date && !/^\d{4}-\d{2}-\d{2}$/.test(issue_date)) {
            Toast.error?.('발행일의 연도를 4자리로 입력하세요'); return;
          }
          const body = {
            schedule_id: src.schedule_id || null,
            contract_id: src.contract_id || null,
            customer_id: src.customer_id || null,
            customer_name,
            invoice_no: document.getElementById('tax-no')?.value?.trim() || null,
            supply_amount: Number(supply_amount),
            tax_amount: Number(document.getElementById('tax-tax')?.value || 0),
            issue_date: issue_date || null,
            note: document.getElementById('tax-note')?.value?.trim() || null,
          };
          try {
            if (isEdit) {
              await API.put(`/payments/tax-invoices/${invoice.id}`, body);
              Toast.success?.('세금계산서가 수정됐습니다');
            } else {
              await API.post('/payments/tax-invoices', body);
              Toast.success?.('발행요청이 생성됐습니다 (작성중)');
            }
            Modal.close();
            this._renderTax(); // 기억된 컨테이너에 재렌더(매출관리/수금관리 무관). 미표시 시 no-op.
          } catch (err) {
            Toast.error?.('저장 실패: ' + (err?.message || err));
          }
        });
      },
    });
  },

  // 세금계산서 상태 전환 (requested / issued / cancelled)
  async _taxStatusAction(id, newStatus) {
    const LABELS = { requested: '발행요청', issued: '발행완료', cancelled: '취소' };
    if (newStatus === 'issued' &&
        !confirm('발행완료로 표시하시겠습니까?\n\n※ 상태 기록(수동)이며, 실제 국세청 전송이 아닙니다.')) return;
    if (newStatus === 'cancelled' && !confirm('이 세금계산서를 취소 상태로 변경하시겠습니까?')) return;
    try {
      await API.put(`/payments/tax-invoices/${id}`, { status: newStatus });
      Toast.success?.(`상태가 '${LABELS[newStatus] || newStatus}'(으)로 변경됐습니다`);
      this._renderTax();
    } catch (err) {
      Toast.error?.('상태 변경 실패: ' + (err?.message || err));
    }
  },

  async _deleteTaxInvoice(id) {
    if (!confirm('이 세금계산서를 삭제하시겠습니까?')) return;
    try {
      await API.del(`/payments/tax-invoices/${id}`);
      Toast.success?.('삭제됐습니다');
      this._renderTax();
    } catch (err) {
      Toast.error?.('삭제 실패: ' + (err?.message || err));
    }
  },

  // 홈택스 세금계산서 가져오기 모달 (파일 .csv/.xlsx 또는 붙여넣기 → 컬럼 매핑 → tax_invoices 일괄 등록)
  _openHometaxImportModal() {
    const esc = s => this._esc(s);
    const TARGETS = [
      { key: 'issue_date', label: '작성일자(발행일)', req: false, guess: ['작성일자', '발행일', '일자', 'date'] },
      { key: 'customer_name', label: '상호(공급받는자)', req: false, guess: ['공급받는자', '상호', '거래처', 'customer'] },
      { key: 'supply_amount', label: '공급가액', req: true, guess: ['공급가액', '공급가', 'supply'] },
      { key: 'tax_amount', label: '세액', req: false, guess: ['세액', '부가세', 'tax', 'vat'] },
      { key: 'invoice_no', label: '승인번호', req: false, guess: ['승인번호', '승인', '번호'] },
      { key: 'note', label: '비고', req: false, guess: ['비고', '품목', 'note'] },
    ];
    let headers = [];
    let rows = [];

    // 붙여넣기 텍스트 파싱 (탭 우선, 없으면 콤마)
    const parsePaste = text => {
      const lines = String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .filter(l => l.trim() !== '');
      if (!lines.length) return { headers: [], rows: [] };
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const split = l => l.split(delim).map(c => c.trim());
      return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
    };

    // 컬럼 자동 추정 (헤더 키워드 매칭)
    const guessMap = () => {
      const map = {};
      TARGETS.forEach(t => {
        map[t.key] = headers.findIndex(h => {
          const hl = (h || '').toLowerCase();
          return t.guess.some(g => hl.includes(g.toLowerCase()));
        });
      });
      return map;
    };

    const doImport = async () => {
      const map = {};
      document.querySelectorAll('.ht-map').forEach(sel => {
        map[sel.dataset.key] = parseInt(sel.value, 10);
      });
      if (map.supply_amount === undefined || map.supply_amount < 0) {
        Toast.error?.('공급가액 컬럼을 매핑하세요');
        return;
      }
      const toNum = s => {
        const n = Number(String(s ?? '').replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? '' : n;
      };
      const normDate = s => {
        const t = String(s ?? '').trim();
        const mt = t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
        if (mt) return `${mt[1]}-${String(mt[2]).padStart(2, '0')}-${String(mt[3]).padStart(2, '0')}`;
        return t.slice(0, 10);
      };
      const pick = (r, idx) => (idx >= 0 ? r[idx] || '' : '');
      const payload = rows.map(r => ({
        issue_date: map.issue_date >= 0 ? normDate(r[map.issue_date]) : null,
        customer_name: pick(r, map.customer_name),
        supply_amount: toNum(r[map.supply_amount]),
        tax_amount: map.tax_amount >= 0 ? toNum(r[map.tax_amount]) : 0,
        invoice_no: pick(r, map.invoice_no),
        note: pick(r, map.note),
      }));
      try {
        const res = await API.post('/payments/tax-invoices/bulk', { rows: payload });
        const d = res?.data || {};
        const parts = [`${d.created || 0}건 등록`];
        if (d.duplicates) parts.push(`${d.duplicates}건 중복 스킵`);
        if (d.errors?.length) parts.push(`${d.errors.length}건 오류`);
        Toast.success?.('홈택스 가져오기: ' + parts.join(' · '));
        Modal.close();
        this._renderTax();
      } catch (err) {
        Toast.error?.('가져오기 실패: ' + (err?.message || err));
      }
    };

    const renderMapping = () => {
      const body = document.getElementById('ht-body');
      const foot = document.getElementById('ht-foot');
      if (!body || !foot) return;
      const m = guessMap();
      const idxs = [...headers.keys()];
      const opt = sel =>
        headers
          .map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `(열 ${i + 1})`)}</option>`)
          .join('');
      const mapRows = TARGETS.map(
        t => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <label style="width:140px;font-size:12px">${t.label}${t.req ? ' <span style="color:#E63329">*</span>' : ''}</label>
          <select class="form-input ht-map" data-key="${t.key}" style="flex:1;font-size:12px;padding:4px 8px">
            <option value="-1">— 매핑 안 함 —</option>${opt(m[t.key])}
          </select>
        </div>`
      ).join('');
      const prev = rows.slice(0, 5);
      const pHead = idxs.map(i => `<th style="padding:4px 6px;border:1px solid var(--border);font-size:11px;white-space:nowrap">${esc(headers[i])}</th>`).join('');
      const pBody = prev
        .map(r => `<tr>${idxs.map(i => `<td style="padding:4px 6px;border:1px solid var(--border);font-size:11px;white-space:nowrap">${esc(r[i] || '')}</td>`).join('')}</tr>`)
        .join('');
      body.innerHTML = `
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#0F7A3F">
          ✓ <b>${rows.length}행</b> 분석됨 · 발행번호 중복은 자동 스킵 · status=발행완료로 등록
        </div>
        <div style="margin-bottom:12px">${mapRows}</div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">미리보기 (상위 ${prev.length}행)</div>
        <div style="overflow:auto;max-height:170px;border:1px solid var(--border);border-radius:6px">
          <table style="border-collapse:collapse"><thead><tr style="background:#F9FAFB">${pHead}</tr></thead><tbody>${pBody}</tbody></table>
        </div>`;
      foot.innerHTML = `
        <button id="ht-back" class="btn btn-secondary">← 다시</button>
        <button id="ht-import" class="btn btn-primary">가져오기 (${rows.length}행)</button>`;
      document.getElementById('ht-back')?.addEventListener('click', () => {
        headers = [];
        rows = [];
        renderInput();
      });
      document.getElementById('ht-import')?.addEventListener('click', doImport);
    };

    const renderInput = () => {
      const body = document.getElementById('ht-body');
      const foot = document.getElementById('ht-foot');
      if (!body || !foot) return;
      const onStyle = 'font-size:12px;background:var(--primary,#E63329);color:#fff';
      body.innerHTML = `
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn btn-sm ht-src active" data-src="file" style="${onStyle}">📄 파일(.csv/.xlsx)</button>
          <button class="btn btn-sm ht-src" data-src="paste" style="font-size:12px">📋 붙여넣기</button>
        </div>
        <div id="ht-src-file">
          <input id="ht-file" type="file" accept=".csv,.xlsx,.xls" class="form-input" style="font-size:12px">
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">홈택스에서 내려받은 전자세금계산서 CSV/Excel 파일을 선택하세요 (첫 행 = 헤더).</div>
        </div>
        <div id="ht-src-paste" style="display:none">
          <textarea id="ht-paste" class="form-input" rows="8" placeholder="홈택스 표를 복사해 붙여넣으세요 (첫 행 = 헤더, 탭/콤마 구분)" style="font-size:12px;font-family:monospace"></textarea>
        </div>`;
      foot.innerHTML = `
        <button class="btn btn-secondary" onclick="Modal.close()">취소</button>
        <button id="ht-analyze" class="btn btn-primary">분석 →</button>`;
      body.querySelectorAll('.ht-src').forEach(b =>
        b.addEventListener('click', () => {
          body.querySelectorAll('.ht-src').forEach(x => {
            x.classList.remove('active');
            x.style.background = '';
            x.style.color = '';
          });
          b.classList.add('active');
          b.style.background = 'var(--primary,#E63329)';
          b.style.color = '#fff';
          const src = b.dataset.src;
          document.getElementById('ht-src-file').style.display = src === 'file' ? '' : 'none';
          document.getElementById('ht-src-paste').style.display = src === 'paste' ? '' : 'none';
        })
      );
      document.getElementById('ht-analyze')?.addEventListener('click', async () => {
        const src = body.querySelector('.ht-src.active')?.dataset.src || 'file';
        if (src === 'paste') {
          const parsed = parsePaste(document.getElementById('ht-paste')?.value);
          headers = parsed.headers;
          rows = parsed.rows;
          if (!rows.length) {
            Toast.error?.('헤더 + 1행 이상 붙여넣으세요');
            return;
          }
          renderMapping();
        } else {
          const f = document.getElementById('ht-file')?.files?.[0];
          if (!f) {
            Toast.error?.('파일을 선택하세요');
            return;
          }
          const fd = new FormData();
          fd.append('file', f);
          try {
            const res = await API._upload('/payments/import/parse', fd);
            headers = res?.data?.headers || [];
            rows = res?.data?.rows || [];
            if (!rows.length) {
              Toast.error?.('데이터 행이 없습니다 (헤더만 있거나 빈 파일)');
              return;
            }
            renderMapping();
          } catch (err) {
            Toast.error?.('파일 분석 실패: ' + (err?.message || err));
          }
        }
      });
    };

    Modal.open({
      title: '⬆ 홈택스 세금계산서 가져오기',
      size: 'md',
      body: `<div id="ht-body"></div>`,
      footer: `<div id="ht-foot" style="display:flex;gap:8px;justify-content:flex-end;width:100%"></div>`,
      onOpen: () => renderInput(),
    });
  },

  // ── 은행 거래내역 가져오기 (자동 매칭 → 입금 일괄 등록) ────────
  //   입력(file/paste) → 컬럼 매핑(입금일·입금액·입금자명·적요) →
  //   /bank/match(자동 매칭) → 확정(스케줄 선택) → /bank/apply(입금 등록)
  _openBankImportModal() {
    const esc = s => this._esc(s);
    const TARGETS = [
      { key: 'date', label: '입금일', req: true, guess: ['입금일', '거래일', '거래일시', '일자', '날짜', 'date'] },
      { key: 'amount', label: '입금액', req: true, guess: ['입금액', '입금', '맡기신', '금액', 'amount', 'deposit'] },
      { key: 'name', label: '입금자명', req: false, guess: ['입금자', '보낸분', '보낸이', '거래처', '내용', 'name'] },
      { key: 'memo', label: '적요/메모', req: false, guess: ['적요', '메모', '비고', '내용', 'memo'] },
    ];
    let headers = [];
    let rows = [];
    let matchData = null;

    const parsePaste = text => {
      const lines = String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .filter(l => l.trim() !== '');
      if (!lines.length) return { headers: [], rows: [] };
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const split = l => l.split(delim).map(c => c.trim());
      return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
    };
    const guessMap = () => {
      const map = {};
      TARGETS.forEach(t => {
        let bestIdx = -1;
        let bestScore = 0;
        headers.forEach((h, i) => {
          const hl = (h || '').toLowerCase();
          let s = 0;
          t.guess.forEach(g => {
            const gl = g.toLowerCase();
            if (hl === gl) s = Math.max(s, 100);
            else if (hl.includes(gl)) s = Math.max(s, gl.length); // 더 긴(구체적) 매칭 우선 — '입금'<'입금액'
          });
          if (s > bestScore) {
            bestScore = s;
            bestIdx = i;
          }
        });
        map[t.key] = bestIdx;
      });
      return map;
    };
    const toNum = s => {
      const n = Number(String(s ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isNaN(n) ? 0 : n;
    };
    const normDate = s => {
      const t = String(s ?? '').trim();
      const mt = t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
      if (mt) return `${mt[1]}-${String(mt[2]).padStart(2, '0')}-${String(mt[3]).padStart(2, '0')}`;
      return t.slice(0, 10);
    };
    const pick = (r, idx) => (idx >= 0 ? r[idx] || '' : '');

    // Step 3 — 매칭 확정 → 입금 등록
    const doApply = async () => {
      const applies = [];
      (matchData?.matches || []).forEach((m, i) => {
        const sel = document.querySelector(`.bk-sched[data-row="${i}"]`);
        const amtEl = document.querySelector(`.bk-amt[data-row="${i}"]`);
        const sid = sel ? parseInt(sel.value, 10) : 0;
        const amt = toNum(amtEl?.value);
        if (sid > 0 && amt > 0)
          applies.push({ schedule_id: sid, paid_amount: amt, paid_date: m.bank.date, name: m.bank.name, memo: m.bank.memo });
      });
      if (!applies.length) {
        Toast.error?.('등록할 매칭을 1건 이상 선택하세요');
        return;
      }
      try {
        const res = await API.post('/payments/bank/apply', { applies });
        Toast.success?.(`은행 입금 등록: ${res?.data?.created || 0}건 반영`);
        Modal.close();
        await Promise.all([this._loadSchedules(), this._loadDashboard()]);
        this._renderTab();
      } catch (err) {
        Toast.error?.('입금 등록 실패: ' + (err?.message || err));
      }
    };

    const renderMatch = () => {
      const body = document.getElementById('bk-body');
      const foot = document.getElementById('bk-foot');
      if (!body || !foot) return;
      const matches = matchData?.matches || [];
      const sum = matchData?.summary || { total: matches.length, matched: 0 };
      const schedOptions = m => {
        const opts = ['<option value="0">— 제외 —</option>'];
        (m.candidates || []).forEach(c => {
          const sel = c.schedule_id === m.suggested_schedule_id ? 'selected' : '';
          const tag = c.confidence === 'high' ? '🟢' : c.confidence === 'medium' ? '🟡' : '⚪';
          opts.push(
            `<option value="${c.schedule_id}" ${sel}>${tag} ${esc(c.customer_name || '-')} · ${esc(c.stage_name || '')} · ₩${Number(c.remaining).toLocaleString('ko-KR')}</option>`
          );
        });
        return opts.join('');
      };
      const trs = matches
        .map((m, i) => {
          const hasCand = (m.candidates || []).length > 0;
          return `
          <tr style="${hasCand ? '' : 'opacity:.6'}">
            <td style="padding:6px 8px;border:1px solid var(--border);font-size:12px;white-space:nowrap">${esc(m.bank.date || '-')}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);font-size:12px;text-align:right;white-space:nowrap">₩${Number(m.bank.amount || 0).toLocaleString('ko-KR')}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);font-size:12px;white-space:nowrap">${esc(m.bank.name || '-')}</td>
            <td style="padding:6px 8px;border:1px solid var(--border)">
              <select class="form-input bk-sched" data-row="${i}" style="font-size:11px;padding:3px 6px;min-width:220px">${schedOptions(m)}</select>
            </td>
            <td style="padding:6px 8px;border:1px solid var(--border)">
              <input class="form-input bk-amt" data-row="${i}" type="number" value="${m.suggested_amount || ''}" style="font-size:11px;padding:3px 6px;width:110px;text-align:right">
            </td>
          </tr>`;
        })
        .join('');
      body.innerHTML = `
        <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#0F7A3F">
          ✓ <b>${sum.total}건</b> 중 <b>${sum.matched}건</b> 자동 매칭 · 🟢높음/🟡보통/⚪낮음 · 스케줄을 확인·수정 후 등록하세요
        </div>
        <div style="overflow:auto;max-height:50vh;border:1px solid var(--border);border-radius:6px">
          <table style="border-collapse:collapse;width:100%">
            <thead><tr style="background:#F9FAFB">
              <th style="padding:6px 8px;border:1px solid var(--border);font-size:11px">입금일</th>
              <th style="padding:6px 8px;border:1px solid var(--border);font-size:11px">입금액</th>
              <th style="padding:6px 8px;border:1px solid var(--border);font-size:11px">입금자명</th>
              <th style="padding:6px 8px;border:1px solid var(--border);font-size:11px">매칭 수금 건</th>
              <th style="padding:6px 8px;border:1px solid var(--border);font-size:11px">등록 금액</th>
            </tr></thead>
            <tbody>${trs}</tbody>
          </table>
        </div>`;
      foot.innerHTML = `
        <button id="bk-back2" class="btn btn-secondary">← 다시</button>
        <button id="bk-apply" class="btn btn-primary">입금 등록</button>`;
      document.getElementById('bk-back2')?.addEventListener('click', () => {
        matchData = null;
        renderMapping();
      });
      document.getElementById('bk-apply')?.addEventListener('click', doApply);
    };

    // Step 2 — 컬럼 매핑 → /bank/match
    const doMatch = async () => {
      const map = {};
      document.querySelectorAll('.bk-map').forEach(sel => {
        map[sel.dataset.key] = parseInt(sel.value, 10);
      });
      if (!(map.date >= 0) || !(map.amount >= 0)) {
        Toast.error?.('입금일·입금액 컬럼을 매핑하세요');
        return;
      }
      const payload = rows
        .map(r => ({
          date: normDate(r[map.date]),
          amount: toNum(r[map.amount]),
          name: pick(r, map.name),
          memo: pick(r, map.memo),
        }))
        .filter(x => x.amount > 0);
      if (!payload.length) {
        Toast.error?.('유효한 입금액 행이 없습니다');
        return;
      }
      try {
        const res = await API.post('/payments/bank/match', { rows: payload });
        matchData = res?.data;
        renderMatch();
      } catch (err) {
        Toast.error?.('매칭 실패: ' + (err?.message || err));
      }
    };

    const renderMapping = () => {
      const body = document.getElementById('bk-body');
      const foot = document.getElementById('bk-foot');
      if (!body || !foot) return;
      const m = guessMap();
      const idxs = [...headers.keys()];
      const opt = sel =>
        headers
          .map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `(열 ${i + 1})`)}</option>`)
          .join('');
      const mapRows = TARGETS.map(
        t => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <label style="width:120px;font-size:12px">${t.label}${t.req ? ' <span style="color:#E63329">*</span>' : ''}</label>
          <select class="form-input bk-map" data-key="${t.key}" style="flex:1;font-size:12px;padding:4px 8px">
            <option value="-1">— 매핑 안 함 —</option>${opt(m[t.key])}
          </select>
        </div>`
      ).join('');
      const prev = rows.slice(0, 5);
      const pHead = idxs.map(i => `<th style="padding:4px 6px;border:1px solid var(--border);font-size:11px;white-space:nowrap">${esc(headers[i])}</th>`).join('');
      const pBody = prev
        .map(r => `<tr>${idxs.map(i => `<td style="padding:4px 6px;border:1px solid var(--border);font-size:11px;white-space:nowrap">${esc(r[i] || '')}</td>`).join('')}</tr>`)
        .join('');
      body.innerHTML = `
        <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#0F7A3F">
          ✓ <b>${rows.length}행</b> 분석됨 · 입금일·입금액 컬럼을 지정하면 미수금과 자동 매칭합니다
        </div>
        <div style="margin-bottom:12px">${mapRows}</div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">미리보기 (상위 ${prev.length}행)</div>
        <div style="overflow:auto;max-height:160px;border:1px solid var(--border);border-radius:6px">
          <table style="border-collapse:collapse"><thead><tr style="background:#F9FAFB">${pHead}</tr></thead><tbody>${pBody}</tbody></table>
        </div>`;
      foot.innerHTML = `
        <button id="bk-back" class="btn btn-secondary">← 다시</button>
        <button id="bk-match" class="btn btn-primary">자동 매칭 →</button>`;
      document.getElementById('bk-back')?.addEventListener('click', () => {
        headers = [];
        rows = [];
        renderInput();
      });
      document.getElementById('bk-match')?.addEventListener('click', doMatch);
    };

    // Step 1 — 입력 (파일/붙여넣기)
    const renderInput = () => {
      const body = document.getElementById('bk-body');
      const foot = document.getElementById('bk-foot');
      if (!body || !foot) return;
      const onStyle = 'font-size:12px;background:var(--primary,#E63329);color:#fff';
      body.innerHTML = `
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn btn-sm bk-src active" data-src="file" style="${onStyle}">📄 파일(.csv/.xlsx)</button>
          <button class="btn btn-sm bk-src" data-src="paste" style="font-size:12px">📋 붙여넣기</button>
        </div>
        <div id="bk-src-file">
          <input id="bk-file" type="file" accept=".csv,.xlsx,.xls" class="form-input" style="font-size:12px">
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">은행에서 내려받은 거래내역 CSV/Excel 파일을 선택하세요 (첫 행 = 헤더).</div>
        </div>
        <div id="bk-src-paste" style="display:none">
          <textarea id="bk-paste" class="form-input" rows="8" placeholder="은행 거래내역 표를 복사해 붙여넣으세요 (첫 행 = 헤더, 탭/콤마 구분)" style="font-size:12px;font-family:monospace"></textarea>
        </div>`;
      foot.innerHTML = `
        <button class="btn btn-secondary" onclick="Modal.close()">취소</button>
        <button id="bk-analyze" class="btn btn-primary">분석 →</button>`;
      body.querySelectorAll('.bk-src').forEach(b =>
        b.addEventListener('click', () => {
          body.querySelectorAll('.bk-src').forEach(x => {
            x.classList.remove('active');
            x.style.background = '';
            x.style.color = '';
          });
          b.classList.add('active');
          b.style.background = 'var(--primary,#E63329)';
          b.style.color = '#fff';
          const src = b.dataset.src;
          document.getElementById('bk-src-file').style.display = src === 'file' ? '' : 'none';
          document.getElementById('bk-src-paste').style.display = src === 'paste' ? '' : 'none';
        })
      );
      document.getElementById('bk-analyze')?.addEventListener('click', async () => {
        const src = body.querySelector('.bk-src.active')?.dataset.src || 'file';
        if (src === 'paste') {
          const parsed = parsePaste(document.getElementById('bk-paste')?.value);
          headers = parsed.headers;
          rows = parsed.rows;
          if (!rows.length) {
            Toast.error?.('헤더 + 1행 이상 붙여넣으세요');
            return;
          }
          renderMapping();
        } else {
          const f = document.getElementById('bk-file')?.files?.[0];
          if (!f) {
            Toast.error?.('파일을 선택하세요');
            return;
          }
          const fd = new FormData();
          fd.append('file', f);
          try {
            const res = await API._upload('/payments/import/parse', fd);
            headers = res?.data?.headers || [];
            rows = res?.data?.rows || [];
            if (!rows.length) {
              Toast.error?.('데이터 행이 없습니다 (헤더만 있거나 빈 파일)');
              return;
            }
            renderMapping();
          } catch (err) {
            Toast.error?.('파일 분석 실패: ' + (err?.message || err));
          }
        }
      });
    };

    Modal.open({
      title: '🏦 은행 거래내역 가져오기 (자동 매칭)',
      size: 'md',
      body: `<div id="bk-body"></div>`,
      footer: `<div id="bk-foot" style="display:flex;gap:8px;justify-content:flex-end;width:100%"></div>`,
      onOpen: () => renderInput(),
    });
  },

  // ── F5. 매출분석 탭 ─────────────────────────────────────────
  _renderAnalysis(containerId) {
    // 매출관리 위임 대응: 컨테이너 id 를 받아 기억(재렌더 시 재사용). 기본은 수금관리 컨테이너.
    containerId = containerId || this._analysisContainer || 'pay-tab-content';
    this._analysisContainer = containerId;
    const el = document.getElementById(containerId);
    if (!el) return; // 대상 컨테이너가 현재 화면에 없으면 무시(타 탭/페이지)
    const d = this._dashboard;
    if (!d) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3)">데이터 로드 중...</div>`;
      return;
    }

    const trend = d.monthly_trend || [];
    const overdueByCust = d.overdue_by_customer || [];

    // 상태별 수금예정액 집계 (현재 로드된 스케줄 기준 — 클라이언트 계산)
    const statusAgg = {};
    (this._schedules || []).forEach(s => {
      const k = s.status || 'scheduled';
      statusAgg[k] = (statusAgg[k] || 0) + Number(s.scheduled_amount || 0);
    });
    const statusKeys = Object.keys(statusAgg).filter(k => statusAgg[k] > 0);

    const hasTrend = trend.length > 0;
    const hasStatus = statusKeys.length > 0;
    const hasOverdue = overdueByCust.length > 0;
    const noData = msg =>
      `<div style="text-align:center;padding:40px;color:var(--text-3);font-size:12px">${msg}</div>`;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
            <div id="pay-trend-title" style="font-weight:600;font-size:13px">📈 월별 수금 현황 (예정 vs 실적, 최근 6개월)</div>
            ${hasTrend ? `
            <div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;flex:none">
              <button id="pay-trend-monthly" class="btn btn-sm" style="font-size:12px;border:none;border-radius:0">월별</button>
              <button id="pay-trend-cum" class="btn btn-sm" style="font-size:12px;border:none;border-radius:0;border-left:1px solid var(--border)">누적</button>
            </div>` : ''}
          </div>
          <div style="position:relative;height:240px">${hasTrend ? '<canvas id="pay-chart-trend"></canvas>' : noData('데이터 없음')}</div>
        </div>
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-weight:600;margin-bottom:12px;font-size:13px">🍩 상태별 수금예정액 비중</div>
          <div style="position:relative;height:240px">${hasStatus ? '<canvas id="pay-chart-status"></canvas>' : noData('데이터 없음')}</div>
        </div>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
        <div style="font-weight:600;margin-bottom:12px;font-size:13px">⚠️ 연체 미수금 TOP 5 (고객사별)</div>
        <div style="position:relative;height:${Math.max(overdueByCust.length * 38 + 16, 80)}px">${hasOverdue ? '<canvas id="pay-chart-overdue"></canvas>' : noData('연체 미수금 없음')}</div>
      </div>

      <!-- AR aging (미수금 연령분석) [P4-A] — async 채움 -->
      <div id="pay-ar-aging" style="margin-top:16px"></div>

      <!-- 손익 시뮬레이터 (A+B): 탭에는 저장 비율 기준 한 줄 요약만, 도구는 모달 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-weight:600;font-size:13px;flex:none">🧮 손익 시뮬레이터</div>
        <div id="pnl-summary" style="flex:1;min-width:220px;font-size:12px;color:var(--text-2)"></div>
        <button id="pnl-open" class="btn btn-sm" style="flex:none;font-size:12px;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE">⚙️ 시뮬레이터 열기</button>
      </div>
    `;

    // ── 손익 시뮬레이터 (A+B) — 탭 요약 렌더 + 모달 열기 ──
    this._renderPnlSummary();
    document.getElementById('pnl-open')?.addEventListener('click', () => this._openPnlModal());

    // ── AR aging (미수금 연령분석) [P4-A] — 비동기 채움 ──
    this._renderArAging();

    // Chart.js 미로드 시 캔버스만 비워둠 (안전장치)
    if (typeof Chart === 'undefined') return;
    const won = v => '₩' + Number(v || 0).toLocaleString('ko-KR');
    const krw = v => Number(v || 0).toLocaleString('ko-KR');

    // ① 월별 예정 vs 실적 — 월별(막대) ↔ 누적(라인) 토글 (localStorage 기억)
    try {
      this._trendMode = localStorage.getItem('oci_pay_trendmode') === 'cum' ? 'cum' : 'monthly';
    } catch (_) {
      /* 무시 */
    }
    this._renderTrendChart(trend);
    const setTrendMode = mode => {
      if (this._trendMode === mode) return;
      this._trendMode = mode;
      try {
        localStorage.setItem('oci_pay_trendmode', mode);
      } catch (_) {
        /* 무시 */
      }
      this._renderTrendChart(trend);
    };
    document.getElementById('pay-trend-monthly')?.addEventListener('click', () => setTrendMode('monthly'));
    document.getElementById('pay-trend-cum')?.addEventListener('click', () => setTrendMode('cum'));

    // ② 상태별 수금예정액 비중 (도넛)
    const statusEl = document.getElementById('pay-chart-status');
    if (statusEl) {
      this._charts.status = new Chart(statusEl, {
        type: 'doughnut',
        data: {
          labels: statusKeys.map(k => (this._STATUS_META[k] || {}).label || k),
          datasets: [
            {
              data: statusKeys.map(k => statusAgg[k]),
              backgroundColor: statusKeys.map(k => (this._STATUS_META[k] || {}).color || '#9CA3AF'),
              borderColor: '#fff',
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.label}: ${won(c.parsed)}` } },
          },
        },
      });
    }

    // ③ 연체 미수금 TOP 5 (가로 막대)
    const overdueEl = document.getElementById('pay-chart-overdue');
    if (overdueEl) {
      this._charts.overdue = new Chart(overdueEl, {
        type: 'bar',
        data: {
          labels: overdueByCust.map(c => c.customer_name || '—'),
          datasets: [
            { label: '연체 미수금', data: overdueByCust.map(c => Number(c.overdue_amount || 0)), backgroundColor: '#E63329', borderRadius: 4 },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => won(c.parsed.x) } },
          },
          scales: {
            x: { beginAtZero: true, ticks: { callback: krw, font: { size: 10 } } },
            y: { ticks: { font: { size: 11 } } },
          },
        },
      });
    }
  },

  // ── 손익 시뮬레이터 (A+B 조합) ──────────────────────────────
  //   탭 = 저장된 비율 기준 한 줄 요약(경영진 뷰), 실험 도구 = 모달(실무자).
  //   비율(원가율/판관비율)은 localStorage 기억, 매출 기본 = 수금 예정 합계.
  _pnlSavedRates() {
    let cost = 70;
    let sga = 10;
    try {
      cost = Math.max(0, Math.min(100, Number(localStorage.getItem('oci_pnl_cost') || 70)));
      sga = Math.max(0, Math.min(100, Number(localStorage.getItem('oci_pnl_sga') || 10)));
    } catch (_) {
      /* 무시 */
    }
    return { cost, sga };
  },

  _pnlDefaultRevenue() {
    return (this._schedules || []).reduce((a, s) => a + Number(s.scheduled_amount || 0), 0);
  },

  _pnlCompute(rev, costPct, sgaPct) {
    const cr = costPct / 100;
    const sr = sgaPct / 100;
    const cost = rev * cr;
    const sga = rev * sr;
    const gross = rev - cost;
    const op = gross - sga;
    const pct = v => (rev > 0 ? (v / rev) * 100 : 0);
    // 시나리오: 원가율 ±10%p (판관비 고정)
    const scen = crp => rev - rev * crp - sga;
    return {
      cost,
      sga,
      gross,
      op,
      grossPct: pct(gross),
      opPct: pct(op),
      crUp: Math.min(100, costPct + 10),
      crDn: Math.max(0, costPct - 10),
      consv: scen(Math.min(1, cr + 0.1)),
      optm: scen(Math.max(0, cr - 0.1)),
    };
  },

  // 탭 요약 바 — 모달에서 비율 변경 시에도 즉시 동기화됨
  _renderPnlSummary() {
    const el = document.getElementById('pnl-summary');
    if (!el) return;
    const rev = this._pnlDefaultRevenue();
    const { cost, sga } = this._pnlSavedRates();
    const r = this._pnlCompute(rev, cost, sga);
    const won = v => '₩' + Math.round(v).toLocaleString('ko-KR');
    const opColor = r.op >= 0 ? '#0F7A3F' : '#E63329';
    el.innerHTML = `영업이익 <b style="color:${opColor}">${won(r.op)} (${r.opPct.toFixed(1)}%)</b>
      <span style="color:var(--text-3)">· 원가율 ${cost}% · 판관비 ${sga}% · 매출 = 수금 예정 합계 ${won(rev)}</span>`;
  },

  // 시뮬레이터 모달 (B) — 슬라이더 what-if + 콤마 매출액 + 압축 출력(핵심 2지표 + 시나리오 범위)
  _openPnlModal() {
    const { cost, sga } = this._pnlSavedRates();
    const defaultRev = this._pnlDefaultRevenue();
    const comma = v => Number(v || 0).toLocaleString('ko-KR');

    const body = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px">
        <div>
          <label class="form-label">매출액 (원)</label>
          <input id="pnl-rev" type="text" inputmode="numeric" class="form-input" value="${comma(defaultRev)}" style="text-align:right">
          <div id="pnl-rev-hint" style="font-size:11px;color:var(--text-3);margin-top:2px"></div>
        </div>
        <div>
          <label class="form-label">원가율 <b id="pnl-cost-val">${cost}%</b></label>
          <input id="pnl-cost" type="range" min="0" max="100" step="1" value="${cost}" style="width:100%;margin-top:12px">
        </div>
        <div>
          <label class="form-label">판관비율 <b id="pnl-sga-val">${sga}%</b></label>
          <input id="pnl-sga" type="range" min="0" max="100" step="1" value="${sga}" style="width:100%;margin-top:12px">
        </div>
      </div>
      <div id="pnl-out"></div>`;

    Modal.open({
      title: '🧮 손익 시뮬레이터',
      body,
      footer: `<button id="pnl-close" class="btn btn-secondary" onclick="Modal.close()">닫기</button>`,
      confirmOnClose: false, // 저장할 폼 데이터 없음 — 슬라이더 조작이 dirty 컨펌을 띄우지 않도록
      onOpen: box => {
        const revEl = box.querySelector('#pnl-rev');
        const costEl = box.querySelector('#pnl-cost');
        const sgaEl = box.querySelector('#pnl-sga');
        const rawRev = () => Number((revEl.value || '').replace(/[^\d]/g, '')) || 0;
        const won = v => '₩' + Math.round(v).toLocaleString('ko-KR');

        const recalc = () => {
          const costPct = Number(costEl.value || 0);
          const sgaPct = Number(sgaEl.value || 0);
          const cv = document.getElementById('pnl-cost-val');
          const sv = document.getElementById('pnl-sga-val');
          if (cv) cv.textContent = `${costPct}%`;
          if (sv) sv.textContent = `${sgaPct}%`;
          try {
            localStorage.setItem('oci_pnl_cost', String(costPct));
            localStorage.setItem('oci_pnl_sga', String(sgaPct));
          } catch (_) {
            /* 무시 */
          }
          const rev = rawRev();
          const eok = rev / 100000000;
          const hint = document.getElementById('pnl-rev-hint');
          if (hint) hint.textContent = `기본 = 수금 예정 합계${eok >= 0.1 ? ` (≈ ${eok.toFixed(1)}억)` : ''}`;
          const r = this._pnlCompute(rev, costPct, sgaPct);
          const opColor = r.op >= 0 ? '#0F7A3F' : '#E63329';
          const seg = (w, c) =>
            `<div style="width:${Math.max(0, Math.min(100, w))}%;background:${c};height:100%"></div>`;
          const out = document.getElementById('pnl-out');
          if (out)
            out.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px">
              <div style="background:#ECFDF5;border-radius:6px;padding:12px"><div style="font-size:11px;color:var(--text-3)">매출총이익</div><div style="font-weight:700;font-size:16px;color:#0F7A3F">${won(r.gross)} <span style="font-size:11px;font-weight:400">${r.grossPct.toFixed(1)}%</span></div></div>
              <div style="background:${r.op >= 0 ? '#ECFDF5' : '#FFF5F5'};border-radius:6px;padding:12px"><div style="font-size:11px;color:var(--text-3)">영업이익</div><div style="font-weight:700;font-size:16px;color:${opColor}">${won(r.op)} <span style="font-size:11px;font-weight:400">${r.opPct.toFixed(1)}%</span></div></div>
            </div>
            <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;background:#E5E7EB">
              ${seg(costPct, '#F59C00')}${seg(sgaPct, '#FBBF24')}${seg(r.op >= 0 ? r.opPct : 0, '#0F7A3F')}
            </div>
            <div style="display:flex;gap:14px;font-size:11px;color:var(--text-3);margin-top:6px;flex-wrap:wrap">
              <span><span style="display:inline-block;width:10px;height:10px;background:#F59C00;border-radius:1px;margin-right:4px"></span>원가 ${won(r.cost)}</span>
              <span><span style="display:inline-block;width:10px;height:10px;background:#FBBF24;border-radius:1px;margin-right:4px"></span>판관비 ${won(r.sga)}</span>
              <span><span style="display:inline-block;width:10px;height:10px;background:#0F7A3F;border-radius:1px;margin-right:4px"></span>영업이익</span>
            </div>
            <div style="font-size:12px;margin-top:14px;padding:10px 12px;background:#F9FAFB;border-radius:6px">
              시나리오 <span style="color:var(--text-3)">(원가율 ±10%p · 판관비 고정)</span> :
              보수(${r.crUp}%) <b style="color:${r.consv >= 0 ? '#0F7A3F' : '#E63329'}">${won(r.consv)}</b>
              ~ 낙관(${r.crDn}%) <b style="color:${r.optm >= 0 ? '#0F7A3F' : '#E63329'}">${won(r.optm)}</b>
            </div>`;
          this._renderPnlSummary(); // 탭 요약 바 즉시 동기화 (닫기 훅 불필요)
        };

        revEl?.addEventListener('input', () => {
          const raw = (revEl.value || '').replace(/[^\d]/g, '');
          revEl.value = raw ? comma(raw) : '';
          recalc();
        });
        costEl?.addEventListener('input', recalc);
        sgaEl?.addEventListener('input', recalc);
        recalc();
      },
    });
  },

  // ── 월별 추이 차트 (매출분석 ①) — 월별(막대) ↔ 누적(라인) ──
  //   누적 = 이미 로드된 monthly_trend 를 클라이언트 합산 (백엔드 무변경).
  //   막대↔라인 타입 전환은 dataset 옵션 충돌이 있어 destroy 후 재생성 (6포인트라 비용 무시 가능).
  _renderTrendChart(trend) {
    const el = document.getElementById('pay-chart-trend');
    if (!el || typeof Chart === 'undefined') return;
    const isCum = this._trendMode === 'cum';

    // 헤더 동기화: 제목 + 토글 활성 스타일 (수금현황 계약별/전체 토글과 동일 패턴)
    const title = document.getElementById('pay-trend-title');
    if (title)
      title.textContent = isCum
        ? '📈 누적 수금 현황 (최근 6개월 누적)'
        : '📈 월별 수금 현황 (예정 vs 실적, 최근 6개월)';
    const ACT = 'background:var(--primary,#E63329);color:#fff';
    const OFF = 'background:#fff;color:var(--text-2)';
    const btnM = document.getElementById('pay-trend-monthly');
    const btnC = document.getElementById('pay-trend-cum');
    if (btnM) btnM.style.cssText = `font-size:12px;border:none;border-radius:0;${isCum ? OFF : ACT}`;
    if (btnC)
      btnC.style.cssText = `font-size:12px;border:none;border-radius:0;border-left:1px solid var(--border);${isCum ? ACT : OFF}`;

    if (this._charts.trend) {
      try {
        this._charts.trend.destroy();
      } catch (_) {
        /* 무시 */
      }
    }

    const won = v => '₩' + Number(v || 0).toLocaleString('ko-KR');
    const krw = v => Number(v || 0).toLocaleString('ko-KR');
    const labels = trend.map(t => t.month || '');
    const sched = trend.map(t => Number(t.scheduled || 0));
    const coll = trend.map(t => Number(t.collected || 0));
    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: krw, font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } },
      },
    };

    if (isCum) {
      const cum = arr => {
        let acc = 0;
        return arr.map(v => {
          acc += v;
          return acc;
        });
      };
      this._charts.trend = new Chart(el, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '누적 예정', data: cum(sched), borderColor: '#BFDBFE', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], pointRadius: 2.5, tension: 0.3, fill: false },
            { label: '누적 실적', data: cum(coll), borderColor: '#1664E5', backgroundColor: 'rgba(22,100,229,0.12)', borderWidth: 2.5, pointRadius: 2.5, tension: 0.3, fill: 'origin' },
          ],
        },
        options: {
          ...baseOpts,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                // 누적값 + 당월 증가분 함께 표시
                label: c => {
                  const prev = c.dataIndex > 0 ? Number(c.dataset.data[c.dataIndex - 1] || 0) : 0;
                  return `${c.dataset.label}: ${won(c.parsed.y)} (당월 +${krw(c.parsed.y - prev)})`;
                },
              },
            },
          },
        },
      });
    } else {
      this._charts.trend = new Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '예정', data: sched, backgroundColor: '#BFDBFE', borderRadius: 4 },
            { label: '실적', data: coll, backgroundColor: '#1664E5', borderRadius: 4 },
          ],
        },
        options: {
          ...baseOpts,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${won(c.parsed.y)}` } },
          },
        },
      });
    }
  },

  // 매출분석 Chart.js 인스턴스 일괄 파기 (재렌더·탭 전환 시 메모리 누수 방지)
  // ── AR aging (미수금 연령분석) [P4-A] ───────────────────────
  async _renderArAging() {
    const wrap = document.getElementById('pay-ar-aging');
    if (!wrap) return;
    let d;
    try {
      const res = await API.get('/payments/ar-aging');
      if (!res.success) throw new Error(res.error || 'AR aging 조회 실패');
      d = res.data;
    } catch (_) {
      wrap.innerHTML = '';
      return;
    }
    const buckets = d.buckets || [];
    const fmt = n => '₩' + Number(n || 0).toLocaleString('ko-KR');
    const COLORS = { not_due: '#9CA3AF', d30: '#F59E0B', d60: '#F97316', d90: '#EF4444', d90p: '#B91C1C' };
    const cards = buckets
      .map(
        b => `
        <div style="flex:1;min-width:118px;background:#fff;border:1px solid var(--border);border-top:3px solid ${COLORS[b.key] || '#9CA3AF'};border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--text-3)">${b.label}</div>
          <div style="font-size:15px;font-weight:700;margin-top:2px">${fmt(b.amount)}</div>
          <div style="font-size:11px;color:var(--text-3)">${b.count}건</div>
        </div>`
      )
      .join('');
    const custRows = (d.by_customer || [])
      .map(
        c => `
        <tr>
          <td style="padding:6px 10px">${this._esc(c.customer_name || '-')}</td>
          <td style="padding:6px 10px;text-align:right">${fmt(c.not_due)}</td>
          <td style="padding:6px 10px;text-align:right">${fmt(c.d30)}</td>
          <td style="padding:6px 10px;text-align:right">${fmt(c.d60)}</td>
          <td style="padding:6px 10px;text-align:right;color:#EF4444">${fmt(c.d90)}</td>
          <td style="padding:6px 10px;text-align:right;color:#B91C1C;font-weight:600">${fmt(c.d90p)}</td>
          <td style="padding:6px 10px;text-align:right;font-weight:700">${fmt(c.total)}</td>
        </tr>`
      )
      .join('');
    wrap.innerHTML = `
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <div style="font-weight:600;font-size:13px">📅 미수금 연령분석 (AR Aging)</div>
          <div style="font-size:12px;color:var(--text-3)">총 미수 <b style="color:#E63329">${fmt(d.total_outstanding)}</b></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${cards}</div>
        <div style="position:relative;height:200px;margin-bottom:${custRows ? '14px' : '0'}"><canvas id="pay-chart-aging"></canvas></div>
        ${
          custRows
            ? `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#F9FAFB;color:var(--text-3)">
              <th style="padding:6px 10px;text-align:left">고객사</th>
              <th style="padding:6px 10px;text-align:right">미도래</th>
              <th style="padding:6px 10px;text-align:right">1-30</th>
              <th style="padding:6px 10px;text-align:right">31-60</th>
              <th style="padding:6px 10px;text-align:right">61-90</th>
              <th style="padding:6px 10px;text-align:right">90일+</th>
              <th style="padding:6px 10px;text-align:right">합계</th>
            </tr></thead><tbody>${custRows}</tbody></table></div>`
            : ''
        }
      </div>`;
    if (typeof Chart === 'undefined') return;
    const el = document.getElementById('pay-chart-aging');
    if (!el) return;
    this._charts.aging = new Chart(el, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [
          {
            label: '미수금',
            data: buckets.map(b => b.amount),
            backgroundColor: buckets.map(b => COLORS[b.key] || '#9CA3AF'),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => fmt(c.raw) } },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('ko-KR') } } },
      },
    });
  },

  _destroyCharts() {
    if (this._charts) {
      Object.keys(this._charts).forEach(k => {
        try {
          this._charts[k].destroy();
        } catch (_) {
          /* 무시 */
        }
      });
    }
    this._charts = {};
  },

  // ── 계약 → 수금 일정 자동 생성 모달 (비율 템플릿 기반) ───────
  //   기존 백엔드 from-contract(stages 경로) 활용 — 프론트에서 금액(=총액×ratio)·예정일(=기준일+offset_days) 계산
  _openFromContractModal() {
    const esc = s => this._esc(s);
    const today = new Date().toISOString().slice(0, 10);
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    let templates = [];
    let picked = null; // 선택된 계약 { id, name, customer_name, amount }

    const addDays = (base, days) => {
      const d = new Date(`${base}T00:00:00`);
      if (Number.isNaN(d.getTime())) return '';
      d.setDate(d.getDate() + Number(days || 0));
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const stagesOf = () => {
      const sel = document.getElementById('fc-template');
      const t = templates.find(x => String(x.id) === String(sel?.value));
      return t?.stages || [];
    };
    const buildRows = () => {
      const amount = Math.max(0, Number(document.getElementById('fc-amount')?.value || 0));
      const base = document.getElementById('fc-base')?.value || today;
      return stagesOf().map(s => ({
        name: s.name,
        ratio: Number(s.ratio || 0),
        amount: Math.round((amount * Number(s.ratio || 0)) / 100),
        due_date: addDays(base, s.offset_days),
        note: s.note || '',
      }));
    };
    const renderPreview = () => {
      const el = document.getElementById('fc-preview');
      if (!el) return;
      if (!picked) {
        el.innerHTML =
          '<div style="color:var(--text-3);font-size:12px;padding:12px;text-align:center">계약을 먼저 선택하세요</div>';
        return;
      }
      const rows = buildRows();
      if (!rows.length) {
        el.innerHTML =
          '<div style="color:var(--text-3);font-size:12px;padding:12px;text-align:center">템플릿을 선택하세요</div>';
        return;
      }
      const sum = rows.reduce((a, r) => a + r.amount, 0);
      el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#F9FAFB;color:var(--text-3)">
            <th style="padding:6px 8px;text-align:left">단계</th><th style="padding:6px 8px;text-align:right">비율</th>
            <th style="padding:6px 8px;text-align:right">금액</th><th style="padding:6px 8px;text-align:left">예정일</th>
          </tr></thead>
          <tbody>${rows
            .map(
              r => `<tr style="border-top:1px solid var(--border)">
              <td style="padding:6px 8px">${esc(r.name)}</td>
              <td style="padding:6px 8px;text-align:right">${r.ratio}%</td>
              <td style="padding:6px 8px;text-align:right;font-weight:600">₩${fmt(r.amount)}</td>
              <td style="padding:6px 8px">${r.due_date || '—'}</td></tr>`
            )
            .join('')}</tbody>
          <tfoot><tr style="background:#F0F4FF;font-weight:600">
            <td style="padding:6px 8px">합계 ${rows.length}단계</td><td></td>
            <td style="padding:6px 8px;text-align:right;color:#1664E5">₩${fmt(sum)}</td><td></td></tr></tfoot>
        </table>`;
    };

    Modal.open({
      title: '📄 계약에서 수금 일정 생성',
      size: 'md',
      body: `
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">계약 선택 *</label>
            <input id="fc-contract" class="form-input" autocomplete="off" placeholder="계약명·번호·고객사 검색 (2글자 이상)">
            <div id="fc-contract-info" style="font-size:11px;color:var(--text-3);margin-top:4px">계약을 검색해 선택하세요</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="form-label">비율 템플릿 *</label>
              <select id="fc-template" class="form-input"><option value="">불러오는 중…</option></select>
            </div>
            <div>
              <label class="form-label">기준일 (1단계 기산)</label>
              <input id="fc-base" type="date" class="form-input" value="${today}" min="1000-01-01" max="9999-12-31">
            </div>
          </div>
          <div>
            <label class="form-label">총 계약금액 (수금 기준, 원)</label>
            <input id="fc-amount" type="number" class="form-input" placeholder="계약 선택 시 자동" min="0">
            <div style="font-size:11px;color:var(--text-3);margin-top:4px">템플릿 비율을 이 금액에 적용해 단계별 금액을 계산합니다.</div>
          </div>
          <div>
            <label class="form-label">미리보기</label>
            <div id="fc-preview" style="border:1px solid var(--border);border-radius:6px;overflow:hidden"></div>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">취소</button>
        <button id="fc-create" class="btn btn-primary">수금 일정 생성</button>`,
      onOpen: async () => {
        // 비율 템플릿 로드
        try {
          const r = await API.get('/payments/templates');
          templates = (r.data || []).map(t => ({ ...t, stages: t.stages || [] }));
        } catch (_) {
          templates = [];
        }
        const tsel = document.getElementById('fc-template');
        if (tsel) {
          tsel.innerHTML = templates.length
            ? templates
                .map((t, i) => `<option value="${t.id}" ${i === 0 ? 'selected' : ''}>${esc(t.name)}</option>`)
                .join('')
            : '<option value="">템플릿 없음</option>';
        }

        // 계약 Combobox
        this._fcCombobox?.destroy?.();
        const cEl = document.getElementById('fc-contract');
        if (cEl && window.Combobox) {
          this._fcCombobox = Combobox.attach({
            inputEl: cEl,
            minChars: 2,
            allowCustom: false,
            fetchFn: async q => {
              try {
                const r = await API.contracts.list({ search: q, limit: 10 });
                return (r.data || []).map(c => ({
                  id: c.id,
                  name: c.title || c.contract_no || `계약 #${c.id}`,
                  contract_no: c.contract_no || '',
                  customer_name: c.customer_name || '',
                  amount: Number(c.contract_amount || 0),
                }));
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, query, { highlightMatch }) =>
              `<div style="font-size:13px">${highlightMatch(item.name, query)}</div>
               <div style="font-size:11px;color:var(--text-3)">${item.contract_no ? esc(item.contract_no) + ' · ' : ''}${esc(item.customer_name)}</div>`,
            onSelect: item => {
              picked = item;
              const info = document.getElementById('fc-contract-info');
              if (info)
                info.innerHTML = `🔗 <b>${esc(item.name)}</b>${item.customer_name ? ' · ' + esc(item.customer_name) : ''}`;
              const amtEl = document.getElementById('fc-amount');
              if (amtEl && item.amount > 0 && !amtEl.value) amtEl.value = item.amount;
              renderPreview();
            },
          });
        }

        document.getElementById('fc-template')?.addEventListener('change', renderPreview);
        document.getElementById('fc-base')?.addEventListener('change', renderPreview);
        document.getElementById('fc-amount')?.addEventListener('input', renderPreview);
        renderPreview();

        document.getElementById('fc-create')?.addEventListener('click', async () => {
          if (!picked) {
            Toast.error?.('계약을 선택하세요');
            return;
          }
          const rows = buildRows();
          if (!rows.length) {
            Toast.error?.('비율 템플릿을 선택하세요');
            return;
          }
          if (rows.some(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.due_date))) {
            Toast.error?.('예정일 계산 오류 — 기준일을 확인하세요');
            return;
          }
          try {
            const res = await API.post(`/payments/from-contract/${picked.id}`, {
              stages: rows.map(r => ({
                name: r.name,
                ratio: r.ratio,
                amount: r.amount,
                due_date: r.due_date,
                note: r.note,
              })),
            });
            const n = res?.data?.created || 0;
            Toast.success?.(`수금 일정 ${n}건이 생성됐습니다`);
            this._fcCombobox?.destroy?.();
            Modal.close();
            await this._reloadAndRender();
          } catch (err) {
            Toast.error?.('생성 실패: ' + (err?.message || err));
          }
        });
      },
    });
  },

  // ── 수금 스케줄 등록·수정 모달 (재설계: 2단 레이아웃) ─────────
  // 상단 = 계약 기본 정보(총계약금/통화/기간), 하단 = 마일스톤(N개 수금단계)
  _openScheduleModal(schedule = null) {
    const isEdit = !!schedule;
    const cfg = this._config || {
      stage_types: ['착수금', '중도금', '잔금', '기타'],
      default_currency: 'KRW',
      allowed_currencies: ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'AUD', 'SGD', 'HKD', 'VND'],
    };

    // 편집 그룹 로드 — model A(평면): 같은 contract_id 형제 행을 한 모달로 묶어 편집.
    // contract_id 가 없으면 단일 행만 편집.
    let group, shared;
    if (isEdit) {
      group = schedule.contract_id
        ? this._schedules.filter(s => s.contract_id === schedule.contract_id)
        : [schedule];
      if (!group.length) group = [schedule];
      shared = group[0];
    } else {
      group = [];
      shared = {};
    }

    // 통화: 편집 시 기존값, 신규 시 기본통화
    this._msCurrency = shared.currency || cfg.default_currency || 'KRW';
    this._msDeleted = [];
    this._msContractId = shared.contract_id || null; // 연결된 계약 id (계약 연결 Combobox)
    this._msCustomerId = shared.customer_id || null;

    // 마일스톤 배열 구성
    this._ms = isEdit
      ? group.map(s => ({
          id: s.id,
          stage_name: s.stage_name || '',
          ratio: s.ratio !== null ? Number(s.ratio) : null,
          due_date: this._dateVal(s.due_date),
          supply_amount: s.supply_amount !== null ? Number(s.supply_amount) : null,
          tax_amount: s.tax_amount !== null ? Number(s.tax_amount) : null,
          scheduled_amount: s.scheduled_amount !== null ? Number(s.scheduled_amount) : null,
        }))
      : [{ stage_name: cfg.stage_types[0] || '착수금', ratio: null, due_date: '',
           supply_amount: null, tax_amount: null, scheduled_amount: null }];

    const cur = this._msCurrency;
    const curOpts = (cfg.allowed_currencies || ['KRW']).map(c =>
      `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
    const csupply =
      shared.contract_supply_amount !== null && shared.contract_supply_amount !== undefined
        ? Number(shared.contract_supply_amount)
        : null;
    const ctotal = csupply !== null ? Math.round(csupply * 1.1) : null;

    Modal.open({
      title: isEdit ? '✏️ 수금 스케줄 수정' : '➕ 수금 스케줄 등록',
      wide: true,
      disableOverlayClose: true,
      body: `
        <div style="display:flex;flex-direction:column;gap:0">

          <!-- ═══ 상단: 계약 기본 정보 ═══ -->
          <div style="border:1px solid var(--border);border-radius:10px;padding:16px;background:#FAFBFC">
            <div style="font-size:13px;font-weight:700;color:var(--text-1);margin-bottom:12px;
                        display:flex;align-items:center;gap:6px">📄 계약 기본 정보</div>

            <!-- 기존 계약 연결 (선택) -->
            <div style="margin-bottom:12px">
              <label class="form-label">🔗 기존 계약 연결 (선택)</label>
              <input id="pay-m-contract-link" class="form-input" autocomplete="off"
                placeholder="계약명·계약번호·고객사로 검색 (2글자 이상)">
              <div id="pay-m-link-status" style="font-size:11px;margin-top:4px;color:var(--text-3)">${
                shared.contract_id
                  ? `🔗 <b>${this._esc(shared.contract_name || `계약 #${shared.contract_id}`)}</b> 연결됨 <button type="button" id="pay-m-unlink" style="margin-left:6px;font-size:11px;background:none;border:none;color:#E63329;cursor:pointer;text-decoration:underline">연결 해제</button>`
                  : '미연결 — 계약을 검색해 연결하거나, 아래에 직접 입력하세요'
              }</div>
            </div>

            <!-- 고객사명 | 계약/프로젝트명 -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label class="form-label">고객사명 *</label>
                <input id="pay-m-customer" class="form-input"
                  value="${this._esc(shared.customer_name || '')}" placeholder="고객사 이름">
              </div>
              <div>
                <label class="form-label">계약/프로젝트명</label>
                <input id="pay-m-contract-name" class="form-input"
                  value="${this._esc(shared.contract_name || '')}" placeholder="계약명 또는 프로젝트명">
              </div>
            </div>

            <!-- 총계약금(VAT별도) | 계약금(VAT포함) | 통화 -->
            <div style="display:grid;grid-template-columns:1.2fr 1.2fr 0.8fr;gap:12px;margin-bottom:12px">
              <div>
                <label class="form-label">총계약금 (VAT별도)</label>
                <div style="position:relative">
                  <input id="pay-m-contract-supply" type="text" inputmode="numeric" class="form-input"
                    value="${csupply !== null ? csupply.toLocaleString('en-US') : ''}"
                    placeholder="0" style="padding-right:38px">
                  <span id="pay-unit-csupply" style="position:absolute;right:10px;top:50%;
                    transform:translateY(-50%);font-size:12px;color:var(--text-3);pointer-events:none">${this._curUnit(cur)}</span>
                </div>
              </div>
              <div>
                <label class="form-label">계약금 (VAT포함 자동)</label>
                <div style="position:relative">
                  <input id="pay-m-contract-total" type="text" class="form-input" readonly
                    value="${ctotal !== null ? ctotal.toLocaleString('en-US') : ''}" placeholder="자동계산"
                    style="padding-right:38px;background:#F1F3F5;color:var(--text-2);cursor:default">
                  <span id="pay-unit-ctotal" style="position:absolute;right:10px;top:50%;
                    transform:translateY(-50%);font-size:12px;color:var(--text-3);pointer-events:none">${this._curUnit(cur)}</span>
                </div>
              </div>
              <div>
                <label class="form-label">통화</label>
                <select id="pay-m-currency" class="form-input">${curOpts}</select>
              </div>
            </div>

            <!-- 계약 시작일 | 종료일 -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label class="form-label">계약 시작일</label>
                <input id="pay-m-start" type="date" class="form-input"
                  min="1000-01-01" max="9999-12-31"
                  value="${this._dateVal(shared.contract_start_date)}">
              </div>
              <div>
                <label class="form-label">계약 종료일</label>
                <input id="pay-m-end" type="date" class="form-input"
                  min="1000-01-01" max="9999-12-31"
                  value="${this._dateVal(shared.contract_end_date)}">
              </div>
            </div>
          </div>

          <!-- ═══ 구분 밴드: 수금 품목 구분 ═══ -->
          <div style="display:flex;align-items:center;justify-content:space-between;
                      margin:16px 0 12px;padding:10px 14px;border-radius:8px;
                      background:linear-gradient(90deg,#FEF2F2,#FFF5F5);border:1px solid #FECACA">
            <div style="font-size:13px;font-weight:700;color:#E63329;display:flex;align-items:center;gap:6px">
              📋 수금 품목 구분
            </div>
            <button id="pay-ms-add" type="button"
              style="font-size:12px;padding:5px 12px;background:#E63329;color:#fff;
                     border:none;border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:600">
              + 수금 단계 추가
            </button>
          </div>

          <!-- ═══ 하단: 마일스톤 카드 목록 ═══ -->
          <div id="pay-ms-list" style="display:flex;flex-direction:column;gap:10px"></div>

          <!-- 합계 요약 -->
          <div id="pay-ms-summary" style="margin-top:14px"></div>

          <!-- 비고 (계약 전체) -->
          <div style="margin-top:14px">
            <label class="form-label">비고 (계약 전체)</label>
            <textarea id="pay-m-note" class="form-input" rows="2"
              placeholder="메모">${this._esc(shared.note || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button id="pay-m-cancel" class="btn btn-secondary">취소</button>
        <button id="pay-m-save" class="btn btn-primary">${isEdit ? '저장' : '등록'}</button>
      `,
      onOpen: () => {
        const csupplyEl  = document.getElementById('pay-m-contract-supply');
        const ctotalEl   = document.getElementById('pay-m-contract-total');
        const currencyEl = document.getElementById('pay-m-currency');
        const listEl     = document.getElementById('pay-ms-list');

        // 기존 계약 연결 Combobox (선택 시 contract_id + 고객사/계약명 자동 채움)
        this._contractCombobox?.destroy?.();
        const linkEl = document.getElementById('pay-m-contract-link');
        if (linkEl && window.Combobox) {
          this._contractCombobox = Combobox.attach({
            inputEl: linkEl,
            minChars: 2,
            allowCustom: false,
            fetchFn: async q => {
              try {
                const r = await API.contracts.list({ search: q, limit: 10 });
                return (r.data || []).map(c => ({
                  id: c.id,
                  name: c.title || c.contract_no || `계약 #${c.id}`,
                  contract_no: c.contract_no || '',
                  customer_id: c.customer_id || null,
                  customer_name: c.customer_name || '',
                }));
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, query, { highlightMatch }) =>
              `<div style="font-size:13px">${highlightMatch(item.name, query)}</div>
               <div style="font-size:11px;color:var(--text-3)">${item.contract_no ? this._esc(item.contract_no) + ' · ' : ''}${this._esc(item.customer_name || '')}</div>`,
            onSelect: item => {
              this._msContractId = item.id;
              this._msCustomerId = item.customer_id;
              const cuEl = document.getElementById('pay-m-customer');
              const cnEl = document.getElementById('pay-m-contract-name');
              if (cuEl && item.customer_name) cuEl.value = item.customer_name;
              if (cnEl) cnEl.value = item.name;
              const st = document.getElementById('pay-m-link-status');
              if (st)
                st.innerHTML = `🔗 <b>${this._esc(item.name)}</b> 연결됨 <button type="button" id="pay-m-unlink" style="margin-left:6px;font-size:11px;background:none;border:none;color:#E63329;cursor:pointer;text-decoration:underline">연결 해제</button>`;
              linkEl.value = '';
              this._bindUnlink();
            },
          });
        }
        this._bindUnlink();

        // 고객사 Combobox — customers 마스터 검색·선택 시 customer_id 연결 (Step 2-2)
        //   직접 타이핑(미선택)은 free-text 허용(customer_id 해제). 계약 연결로 채워진 값은 유지.
        this._customerCombobox?.destroy?.();
        const custEl = document.getElementById('pay-m-customer');
        if (custEl && window.Combobox && API.customers?.autocomplete) {
          this._customerCombobox = Combobox.attach({
            inputEl: custEl,
            minChars: 2,
            allowCustom: true,
            fetchFn: async q => {
              try {
                const r = await API.customers.autocomplete(q, 10);
                return (r.data || []).map(c => ({
                  id: c.id,
                  name: c.name,
                  industry: c.industry || '',
                  region: c.region || '',
                }));
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, query, { highlightMatch }) =>
              `<div style="font-size:13px">${highlightMatch(item.name, query)}</div>
               <div style="font-size:11px;color:var(--text-3)">${this._esc([item.industry, item.region].filter(Boolean).join(' · '))}</div>`,
            onSelect: item => {
              this._msCustomerId = item.id; // 마스터 연결
            },
          });
          // 사용자가 직접 입력하면 마스터 연결 해제(free-text) — programmatic value 세팅은 input 미발생이라 영향 없음
          custEl.addEventListener('input', () => {
            this._msCustomerId = null;
          });
        }

        // 총계약금 입력 → 콤마 포맷 + 계약금(VAT포함) 재계산 + 비율기반 마일스톤 재계산
        csupplyEl?.addEventListener('input', () => {
          this._formatCommaEl(csupplyEl);
          const v = this._unComma(csupplyEl.value);
          ctotalEl.value = v > 0 ? Math.round(v * 1.1).toLocaleString('en-US') : '';
          this._ms.forEach((m, i) => {
            if (Number(m.ratio) > 0) this._recalcMilestone(i, { fromRatio: true });
          });
        });

        // 통화 변경 → 단위 표기 갱신 + 마일스톤 재렌더
        currencyEl?.addEventListener('change', () => {
          this._msCurrency = currencyEl.value;
          const u = this._curUnit(this._msCurrency);
          const us = document.getElementById('pay-unit-csupply');
          const ut = document.getElementById('pay-unit-ctotal');
          if (us) us.textContent = u;
          if (ut) ut.textContent = u;
          this._renderMilestones();
        });

        // 계약 시작일 변경 → 수금예정일 하한(min) 동기화 (과거 선택 차단)
        document.getElementById('pay-m-start')?.addEventListener('change', () => {
          const sv = document.getElementById('pay-m-start')?.value || '';
          document.querySelectorAll('.pay-ms-due').forEach(el => {
            if (sv) el.min = sv;
            else el.removeAttribute('min');
          });
        });

        // 수금 단계 추가
        document.getElementById('pay-ms-add')?.addEventListener('click', () => {
          this._ms.push({ stage_name: (this._config?.stage_types?.[0]) || '착수금',
            ratio: null, due_date: '', supply_amount: null, tax_amount: null, scheduled_amount: null });
          this._renderMilestones();
        });

        // 이벤트 위임: 마일스톤 입력 (text/number/date)
        listEl?.addEventListener('input', e => {
          const card = e.target.closest('.pay-ms-card');
          if (!card) return;
          const i = parseInt(card.dataset.mi, 10);
          if (isNaN(i) || !this._ms[i]) return;
          const m = this._ms[i];
          const t = e.target;
          if (t.classList.contains('pay-ms-type-custom')) { m.stage_name = t.value; return; }
          if (t.classList.contains('pay-ms-ratio')) {
            m.ratio = t.value === '' ? null : Number(t.value);
            this._recalcMilestone(i, { fromRatio: true });
            return;
          }
          if (t.classList.contains('pay-ms-supply')) {
            this._formatCommaEl(t);
            m.supply_amount = this._unComma(t.value);
            this._recalcMilestone(i, { fromSupply: true });
            return;
          }
          if (t.classList.contains('pay-ms-due')) { m.due_date = t.value; return; }
        });

        // 이벤트 위임: 품목유형 select 변경
        listEl?.addEventListener('change', e => {
          const card = e.target.closest('.pay-ms-card');
          if (!card) return;
          const i = parseInt(card.dataset.mi, 10);
          if (isNaN(i) || !this._ms[i]) return;
          if (e.target.classList.contains('pay-ms-type')) {
            const v = e.target.value;
            if (v === '__custom__') {
              this._ms[i].stage_name = '';
              this._renderMilestones();
            } else {
              this._ms[i].stage_name = v;
            }
          }
        });

        // 이벤트 위임: 마일스톤 삭제
        listEl?.addEventListener('click', e => {
          const btn = e.target.closest('.pay-ms-del');
          if (!btn) return;
          const i = parseInt(btn.dataset.mi, 10);
          if (isNaN(i) || !this._ms[i]) return;
          if (this._ms.length <= 1) { Toast.error?.('최소 1개 수금 단계가 필요합니다'); return; }
          if (this._ms[i].id) this._msDeleted.push(this._ms[i].id);
          this._ms.splice(i, 1);
          this._renderMilestones();
        });

        // 취소 / 저장
        document.getElementById('pay-m-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('pay-m-save')?.addEventListener('click', () => this._saveSchedule(schedule));

        // 초기 렌더
        this._renderMilestones();
      },
    });
  },

  // ── 마일스톤 카드 전체 재렌더 (추가/삭제/통화변경 시) ─────────
  _renderMilestones() {
    const list = document.getElementById('pay-ms-list');
    if (!list) return;
    const cfg = this._config || { stage_types: ['착수금', '중도금', '잔금', '기타'] };
    const cur = this._msCurrency;
    const unit = this._curUnit(cur);
    // 수금예정일 하한 = 계약 시작일(있으면) — 과거 선택 방지(브라우저 + 저장 검증 이중 가드)
    const startMin = document.getElementById('pay-m-start')?.value || '';

    list.innerHTML = this._ms.map((m, i) => {
      const isCustom = !cfg.stage_types.includes(m.stage_name);
      const typeOpts = cfg.stage_types.map(t =>
        `<option value="${this._esc(t)}" ${!isCustom && m.stage_name === t ? 'selected' : ''}>${this._esc(t)}</option>`
      ).join('') + `<option value="__custom__" ${isCustom ? 'selected' : ''}>기타(직접입력)…</option>`;

      const supplyStr = m.supply_amount !== null ? Number(m.supply_amount).toLocaleString('en-US') : '';
      const taxStr    = m.tax_amount !== null ? Number(m.tax_amount).toLocaleString('en-US') : '';
      const totalStr  = m.scheduled_amount !== null ? Number(m.scheduled_amount).toLocaleString('en-US') : '';

      return `
        <div class="pay-ms-card" data-mi="${i}"
          style="border:1px solid var(--border);border-radius:10px;padding:14px;background:#fff;
                 box-shadow:0 1px 2px rgba(0,0,0,0.03)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-size:11px;font-weight:700;color:#E63329;background:#FEF2F2;
                         padding:2px 10px;border-radius:10px">수금 단계 ${i + 1}</span>
            <button type="button" class="pay-ms-del" data-mi="${i}"
              style="background:none;border:none;cursor:pointer;color:#E63329;font-size:16px;
                     line-height:1;padding:2px 6px" title="이 단계 삭제">×</button>
          </div>

          <!-- 1행: 수금품목유형 | 지급율 | 수금예정일 -->
          <div style="display:grid;grid-template-columns:2fr 1fr 1.2fr;gap:10px;margin-bottom:10px">
            <div>
              <label class="form-label">수금품목 유형 *</label>
              <select class="form-input pay-ms-type">${typeOpts}</select>
              <input class="form-input pay-ms-type-custom" placeholder="유형 직접입력"
                value="${isCustom ? this._esc(m.stage_name || '') : ''}"
                style="margin-top:6px;${isCustom ? '' : 'display:none'}">
            </div>
            <div>
              <label class="form-label">지급율 (%)</label>
              <input class="form-input pay-ms-ratio" type="number" min="0" max="100" step="0.01"
                value="${m.ratio !== null ? m.ratio : ''}" placeholder="0.00">
            </div>
            <div>
              <label class="form-label">수금 예정일 *</label>
              <input class="form-input pay-ms-due" type="date"
                min="${startMin}" max="9999-12-31" value="${m.due_date || ''}">
            </div>
          </div>

          <!-- 2행: 수금예정액(VAT별도) | 부가세(10%) | 수금예정액(VAT포함) -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <div>
              <label class="form-label">수금예정액 (VAT별도) *</label>
              <div style="position:relative">
                <input class="form-input pay-ms-supply" type="text" inputmode="numeric"
                  value="${supplyStr}" placeholder="0" style="padding-right:34px">
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                  font-size:12px;color:var(--text-3);pointer-events:none">${unit}</span>
              </div>
            </div>
            <div>
              <label class="form-label">부가세 (10%)</label>
              <div style="position:relative">
                <input class="form-input pay-ms-tax" type="text" readonly
                  value="${taxStr}" placeholder="자동"
                  style="padding-right:34px;background:#F1F3F5;color:var(--text-2);cursor:default">
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                  font-size:12px;color:var(--text-3);pointer-events:none">${unit}</span>
              </div>
            </div>
            <div>
              <label class="form-label">수금예정액 (VAT포함)</label>
              <div style="position:relative">
                <input class="form-input pay-ms-total" type="text" readonly
                  value="${totalStr}" placeholder="자동"
                  style="padding-right:34px;background:#F0F4FF;color:#1664E5;font-weight:600;cursor:default">
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                  font-size:12px;color:#1664E5;pointer-events:none">${unit}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this._renderMsSummary();
  },

  // ── 단일 마일스톤 재계산 (포커스 유지: 해당 카드 셀만 갱신) ──
  _recalcMilestone(i, opts = {}) {
    const m = this._ms[i];
    if (!m) return;
    // 비율 기반 공급가 산정 (총계약금 입력 시)
    if (opts.fromRatio) {
      const contractV = this._unComma(document.getElementById('pay-m-contract-supply')?.value);
      if (contractV > 0 && Number(m.ratio) > 0) {
        m.supply_amount = Math.round(contractV * Number(m.ratio) / 100);
      }
    }
    const supply = Number(m.supply_amount) || 0;
    m.tax_amount = supply > 0 ? Math.round(supply * 0.1) : 0;
    m.scheduled_amount = supply > 0 ? supply + m.tax_amount : 0;

    // 해당 카드 셀만 갱신 (입력 포커스 유지)
    const card = document.querySelector(`.pay-ms-card[data-mi="${i}"]`);
    if (card) {
      const supplyEl = card.querySelector('.pay-ms-supply');
      const taxEl    = card.querySelector('.pay-ms-tax');
      const totalEl  = card.querySelector('.pay-ms-total');
      // fromRatio 시엔 공급가 input 도 갱신 (직접입력 중이 아니므로 안전)
      if (opts.fromRatio && supplyEl) {
        supplyEl.value = supply > 0 ? supply.toLocaleString('en-US') : '';
      }
      if (taxEl)   taxEl.value   = m.tax_amount > 0 ? m.tax_amount.toLocaleString('en-US') : '';
      if (totalEl) totalEl.value = m.scheduled_amount > 0 ? m.scheduled_amount.toLocaleString('en-US') : '';
    }
    this._renderMsSummary();
  },

  // ── 합계 요약 (Σ지급율 + Σ수금예정액 vs 총계약금) ────────────
  _renderMsSummary() {
    const box = document.getElementById('pay-ms-summary');
    if (!box) return;
    const cur = this._msCurrency;
    const sumRatio  = this._ms.reduce((s, m) => s + (Number(m.ratio) || 0), 0);
    const sumSupply = this._ms.reduce((s, m) => s + (Number(m.supply_amount) || 0), 0);
    const sumTotal  = this._ms.reduce((s, m) => s + (Number(m.scheduled_amount) || 0), 0);
    const contractV = this._unComma(document.getElementById('pay-m-contract-supply')?.value);

    // 지급율 배지 색상: ≈100 녹색, <100 amber, >100 red
    let ratioColor = '#16A34A', ratioBg = '#F0FDF4';
    if (sumRatio > 100.01) { ratioColor = '#E63329'; ratioBg = '#FEF2F2'; }
    else if (sumRatio < 99.99 && sumRatio > 0) { ratioColor = '#D97706'; ratioBg = '#FFFBEB'; }

    // 공급가 합계 vs 총계약금 일치 여부
    let matchNote = '';
    if (contractV > 0) {
      const diff = sumSupply - contractV;
      if (Math.abs(diff) < 1) {
        matchNote = `<span style="color:#16A34A;font-size:11px">✓ 총계약금과 일치</span>`;
      } else {
        const sign = diff > 0 ? '초과' : '부족';
        matchNote = `<span style="color:#D97706;font-size:11px">⚠ 총계약금 대비 ${this._money(Math.abs(diff), cur)} ${sign}</span>`;
      }
    }

    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;
                  padding:12px 16px;border-radius:10px;background:#F8FAFC;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--text-3)">수금 단계 <b style="color:var(--text-1)">${this._ms.length}</b>개</div>
          <div style="font-size:12px;color:var(--text-3)">Σ 지급율
            <span style="font-weight:700;color:${ratioColor};background:${ratioBg};
              padding:2px 8px;border-radius:8px;margin-left:2px">${sumRatio.toFixed(2)}%</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          ${matchNote}
          <div style="font-size:12px;color:var(--text-3)">Σ VAT별도
            <b style="color:var(--text-1)">${this._money(sumSupply, cur)}</b></div>
          <div style="font-size:13px;color:var(--text-3)">Σ VAT포함
            <b style="color:#1664E5;font-size:14px">${this._money(sumTotal, cur)}</b></div>
        </div>
      </div>
    `;
  },

  // ── 통화/포맷 헬퍼 ──────────────────────────────────────────
  _CUR_SYMBOL: {
    KRW: '원', USD: '$', JPY: '¥', EUR: '€', GBP: '£',
    CNY: '¥', AUD: 'A$', SGD: 'S$', HKD: 'HK$', VND: '₫',
  },
  _curUnit(code) {
    return this._CUR_SYMBOL[code] || code || '원';
  },
  _curIsSuffix(code) {
    // 원(KRW)/동(VND)은 금액 뒤에 단위, 나머지는 앞에 기호
    return code === 'KRW' || code === 'VND';
  },
  _money(n, code) {
    const v = Number(n) || 0;
    const s = v.toLocaleString('en-US');
    const u = this._curUnit(code);
    return this._curIsSuffix(code) ? `${s}${u}` : `${u}${s}`;
  },
  _unComma(s) {
    return Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0;
  },
  // 콤마 포맷 + 캐럿 위치 보존 (정수만)
  _formatCommaEl(el) {
    if (!el) return;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, caret).replace(/[^\d]/g, '').length;
    const num = raw.replace(/[^\d]/g, '');
    if (num === '') { el.value = ''; return; }
    const formatted = Number(num).toLocaleString('en-US');
    el.value = formatted;
    // 캐럿 복원: 앞쪽 digit 수만큼 위치 재계산
    let seen = 0, pos = 0;
    for (; pos < formatted.length; pos++) {
      if (/\d/.test(formatted[pos])) seen++;
      if (seen >= digitsBefore) { pos++; break; }
    }
    try { el.setSelectionRange(pos, pos); } catch (_e) { /* 일부 input type 미지원 */ }
  },
  // 날짜값 정규화 → 'YYYY-MM-DD'
  _dateVal(v) {
    if (!v) return '';
    const str = String(v);
    const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  // 계약 연결 해제 버튼 바인딩 (연결 상태 표시 내 버튼은 재생성되므로 매번 재바인딩)
  _bindUnlink() {
    const btn = document.getElementById('pay-m-unlink');
    if (!btn) return;
    btn.onclick = () => {
      this._msContractId = null;
      this._msCustomerId = null;
      const st = document.getElementById('pay-m-link-status');
      if (st) st.textContent = '미연결 — 계약을 검색해 연결하거나, 아래에 직접 입력하세요';
    };
  },

  // ── 저장: 모달 → POST /payments/batch (계약 1건 → 마일스톤 N행) ──
  async _saveSchedule(originalSchedule = null) {
    const customer_name = document.getElementById('pay-m-customer')?.value.trim();
    const contract_name = document.getElementById('pay-m-contract-name')?.value.trim();
    const contract_supply_amount = this._unComma(document.getElementById('pay-m-contract-supply')?.value) || null;
    const currency = document.getElementById('pay-m-currency')?.value || 'KRW';
    const contract_start_date = document.getElementById('pay-m-start')?.value || null;
    const contract_end_date = document.getElementById('pay-m-end')?.value || null;
    const note = document.getElementById('pay-m-note')?.value.trim() || null;

    if (!customer_name) { Toast.error?.('고객사명을 입력하세요'); return; }
    if (!this._ms.length) { Toast.error?.('최소 1개 수금 단계가 필요합니다'); return; }

    // 날짜 유효성: 계약 시작/종료일 연도는 4자리 (입력 시에만 검사)
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    if (contract_start_date && !YMD.test(contract_start_date)) {
      Toast.error?.('계약 시작일의 연도를 4자리로 입력하세요'); return;
    }
    if (contract_end_date && !YMD.test(contract_end_date)) {
      Toast.error?.('계약 종료일의 연도를 4자리로 입력하세요'); return;
    }

    // 마일스톤 검증 + 정규화
    const milestones = [];
    for (let i = 0; i < this._ms.length; i++) {
      const m = this._ms[i];
      const stage_name = (m.stage_name || '').trim();
      if (!stage_name) { Toast.error?.(`${i + 1}번 수금 단계: 품목 유형을 입력하세요`); return; }
      if (!m.due_date) { Toast.error?.(`${i + 1}번 수금 단계: 수금 예정일을 입력하세요`); return; }
      if (!YMD.test(m.due_date)) {
        Toast.error?.(`${i + 1}번 수금 단계: 수금 예정일의 연도를 4자리로 입력하세요`); return;
      }
      if (contract_start_date && m.due_date < contract_start_date) {
        Toast.error?.(`${i + 1}번 수금 단계: 수금 예정일은 계약 시작일(${contract_start_date}) 이후여야 합니다`); return;
      }
      const supply = Number(m.supply_amount) || 0;
      if (supply <= 0) { Toast.error?.(`${i + 1}번 수금 단계: 수금예정액(VAT별도)을 입력하세요`); return; }
      const tax = Math.round(supply * 0.1);
      milestones.push({
        id: m.id || undefined,
        stage_name,
        ratio: m.ratio !== null ? Number(m.ratio) : null,
        due_date: m.due_date,
        supply_amount: supply,
        tax_amount: tax,
        scheduled_amount: supply + tax,
        note, // 계약 전체 비고를 각 행에 비정규화 (model A)
      });
    }

    // 단계 순서 검증: 착수금 ≤ 중도금 ≤ 잔금 (기본 유형에 한함, 직접입력 유형은 제외)
    const downArr = [], interimArr = [], finalArr = [];
    for (const m of milestones) {
      if (m.stage_name === '착수금') downArr.push(m.due_date);
      else if (m.stage_name === '중도금') interimArr.push(m.due_date);
      else if (m.stage_name === '잔금') finalArr.push(m.due_date);
    }
    downArr.sort(); interimArr.sort(); finalArr.sort();
    const downMax    = downArr.length ? downArr[downArr.length - 1] : null;
    const interimMin = interimArr.length ? interimArr[0] : null;
    const interimMax = interimArr.length ? interimArr[interimArr.length - 1] : null;
    const finalMin   = finalArr.length ? finalArr[0] : null;
    if (downMax && interimMin && interimMin < downMax) {
      Toast.error?.('중도금 수금 예정일은 착수금보다 빠를 수 없습니다'); return;
    }
    if (downMax && finalMin && finalMin < downMax) {
      Toast.error?.('잔금 수금 예정일은 착수금보다 빠를 수 없습니다'); return;
    }
    if (interimMax && finalMin && finalMin < interimMax) {
      Toast.error?.('잔금 수금 예정일은 중도금보다 빠를 수 없습니다'); return;
    }

    const payload = {
      shared: {
        contract_id: this._msContractId || originalSchedule?.contract_id || null,
        customer_id: this._msCustomerId || originalSchedule?.customer_id || null,
        customer_name,
        contract_name: contract_name || null,
        contract_supply_amount,
        currency,
        contract_start_date,
        contract_end_date,
      },
      milestones,
      delete_ids: this._msDeleted,
    };

    try {
      const res = await API.post('/payments/batch', payload);
      const r = res?.data || {};
      const parts = [];
      if (r.created) parts.push(`${r.created}건 등록`);
      if (r.updated) parts.push(`${r.updated}건 수정`);
      if (r.deleted) parts.push(`${r.deleted}건 삭제`);
      Toast.success?.(parts.length ? `수금 스케줄 ${parts.join(' · ')}` : '수금 스케줄이 저장됐습니다');
      this._contractCombobox?.destroy?.();
      this._customerCombobox?.destroy?.();
      Modal.close();
      await this._reloadAndRender();
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err?.message || err));
    }
  },

  // ── 입금 등록 모달 ──────────────────────────────────────────
  _openRecordModal(scheduleId) {
    const schedule = this._schedules.find(s => s.id === scheduleId)
      || this._overdue.find(s => s.id === scheduleId);
    const remaining = schedule
      ? Math.max(0, Number(schedule.scheduled_amount) - Number(schedule.paid_amount || 0))
      : 0;

    Modal.open({
      title: '💳 입금 등록',
      size: 'sm',
      body: `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px">
          <b>${this._esc(schedule?.customer_name || '')}</b> · ${this._esc(schedule?.stage_name || '')}
          <span style="float:right;color:#0F7A3F;font-weight:700">잔여: ₩${remaining.toLocaleString('ko-KR')}</span>
        </div>
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">입금일 *</label>
            <input id="rec-date" type="date" class="form-input" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div>
            <label class="form-label">입금액 *</label>
            <div style="display:flex;gap:8px">
              <input id="rec-amount" type="number" class="form-input" placeholder="0" style="flex:1">
              <button type="button" id="rec-full" class="btn btn-sm" style="white-space:nowrap;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE">전액</button>
            </div>
          </div>
          <div>
            <label class="form-label">입금 방법</label>
            <select id="rec-method" class="form-input">
              <option value="bank_transfer">계좌이체</option>
              <option value="card">카드</option>
              <option value="cash">현금</option>
              <option value="other">기타</option>
            </select>
          </div>
          <div>
            <label class="form-label">참조번호 (선택)</label>
            <input id="rec-ref" class="form-input" placeholder="입금 이체번호">
          </div>
          <div>
            <label class="form-label">비고</label>
            <input id="rec-note" class="form-input" placeholder="메모">
          </div>
        </div>
      `,
      footer: `
        <button id="rec-cancel" class="btn btn-secondary">취소</button>
        <button id="rec-save" class="btn btn-primary">입금 등록</button>
      `,
      onOpen: () => {
        document.getElementById('rec-full')?.addEventListener('click', () => {
          document.getElementById('rec-amount').value = remaining;
        });
        document.getElementById('rec-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('rec-save')?.addEventListener('click', async () => {
          const paid_date = document.getElementById('rec-date')?.value;
          const paid_amount = document.getElementById('rec-amount')?.value;
          if (!paid_date || !paid_amount) { Toast.error?.('입금일과 입금액을 입력하세요'); return; }
          try {
            const res = await API.post(`/payments/${scheduleId}/records`, {
              paid_date,
              paid_amount: Number(paid_amount),
              payment_method: document.getElementById('rec-method')?.value,
              reference_no: document.getElementById('rec-ref')?.value,
              note: document.getElementById('rec-note')?.value,
            });
            Toast.success?.(`입금 등록 완료 — 상태: ${res.data?.new_status || '갱신됨'}`);
            Modal.close();
            await Promise.all([this._loadSchedules(), this._loadDashboard()]);
            this._renderTab();
          } catch (err) {
            Toast.error?.('입금 등록 실패: ' + (err?.message || err));
          }
        });
      },
    });
  },

  // ── 스케줄 상세 모달 ────────────────────────────────────────
  async _openScheduleDetail(scheduleId) {
    try {
      const res = await API.get(`/payments/${scheduleId}`);
      if (!res.success) { Toast.error?.('조회 실패'); return; }
      const s = res.data;
      const fmt = n => Number(n || 0).toLocaleString('ko-KR');
      const records = s.records || [];
      const recRows = records.map(r => `
        <tr>
          <td style="padding:6px 8px;font-size:12px">${r.paid_date}</td>
          <td style="padding:6px 8px;font-size:12px;font-weight:600;color:#0F7A3F">₩${fmt(r.paid_amount)}</td>
          <td style="padding:6px 8px;font-size:12px">${r.payment_method === 'bank_transfer' ? '계좌이체' : r.payment_method}</td>
          <td style="padding:6px 8px;font-size:12px;color:var(--text-3)">${r.reference_no || '—'}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text-3);font-size:12px">입금 내역 없음</td></tr>';

      // 연동(수금→계산서): 이 스케줄에 연결된 세금계산서
      const taxList  = s.tax_invoices || [];
      const TAX_LABEL = { draft: '작성중', requested: '발행요청', issued: '발행완료', cancelled: '취소' };
      const TAX_COLOR = { draft: '#6B7280', requested: '#1664E5', issued: '#0F7A3F', cancelled: '#9CA3AF' };
      const taxRows = taxList.map(t => `
        <tr>
          <td style="padding:6px 8px;font-size:12px">${(t.issue_date || '').slice(0, 10) || '—'}</td>
          <td style="padding:6px 8px;font-size:12px;font-weight:600">₩${fmt(t.total_amount)}</td>
          <td style="padding:6px 8px;font-size:12px"><span style="color:${TAX_COLOR[t.status] || '#6B7280'};font-weight:600">${TAX_LABEL[t.status] || t.status}</span></td>
          <td style="padding:6px 8px;font-size:12px;color:var(--text-3)">${this._esc(t.invoice_no || '—')}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" style="text-align:center;padding:10px;color:var(--text-3);font-size:12px">발행된 세금계산서 없음</td></tr>';

      Modal.open({
        title: `📋 수금 상세 — ${s.customer_name || ''}`,
        size: 'md',
        body: `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 단계</div>
              <div style="font-weight:600">${this._esc(s.stage_name)}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 예정일</div>
              <div style="font-weight:600">${s.due_date}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 예정액</div>
              <div style="font-weight:600;color:#1664E5">₩${fmt(s.scheduled_amount)}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">실제 수금액</div>
              <div style="font-weight:600;color:#0F7A3F">₩${fmt(s.paid_amount)}</div>
            </div>
          </div>
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">입금 이력</div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <thead>
              <tr style="background:#F9FAFB;font-size:11px;color:var(--text-3)">
                <th style="padding:6px 8px;text-align:left">입금일</th>
                <th style="padding:6px 8px;text-align:left">금액</th>
                <th style="padding:6px 8px;text-align:left">방법</th>
                <th style="padding:6px 8px;text-align:left">참조번호</th>
              </tr>
            </thead>
            <tbody>${recRows}</tbody>
          </table>

          <div style="font-weight:600;font-size:13px;margin:16px 0 8px">🧾 세금계산서</div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <thead>
              <tr style="background:#F9FAFB;font-size:11px;color:var(--text-3)">
                <th style="padding:6px 8px;text-align:left">발행일</th>
                <th style="padding:6px 8px;text-align:left">합계</th>
                <th style="padding:6px 8px;text-align:left">상태</th>
                <th style="padding:6px 8px;text-align:left">번호</th>
              </tr>
            </thead>
            <tbody>${taxRows}</tbody>
          </table>
        `,
        footer: `
          <button class="btn btn-secondary" id="sd-close" onclick="Modal.close()">닫기</button>
          <button class="btn" id="sd-add-tax" style="background:#FFFBEB;color:#92400E;border:1px solid #FDE68A">🧾 세금계산서 발행요청</button>
          <button class="btn btn-primary" id="sd-add-record">💳 입금등록</button>
        `,
        onOpen: () => {
          document.getElementById('sd-add-record')?.addEventListener('click', () => {
            Modal.close();
            this._openRecordModal(scheduleId);
          });
          document.getElementById('sd-add-tax')?.addEventListener('click', () => {
            Modal.close();
            this._openTaxModal(null, {
              schedule_id: s.id,
              contract_id: s.contract_id || null,
              customer_id: s.customer_id || null,
              customer_name: s.customer_name || '',
              contract_name: s.contract_name || s.contract_no || '',
              supply_amount: s.supply_amount ?? s.scheduled_amount,
              tax_amount: s.tax_amount,
            });
          });
        },
      });
    } catch (err) {
      Toast.error?.('조회 실패: ' + (err?.message || err));
    }
  },

  // ── 필터+정렬 적용 목록 ─────────────────────────────────────
  _filteredAndSorted() {
    const { key, dir } = this._sort;
    const kw = (this._filter.search || '').toLowerCase();
    const list = kw
      ? this._schedules.filter(s =>
          (s.customer_name  || '').toLowerCase().includes(kw) ||
          (s.contract_name  || '').toLowerCase().includes(kw) ||
          (s.stage_name     || '').toLowerCase().includes(kw)
        )
      : this._schedules;

    return [...list].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'scheduled_amount' || key === 'paid_amount') {
        va = Number(va || 0); vb = Number(vb || 0);
      } else {
        va = String(va || ''); vb = String(vb || '');
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  },

  // ── 정렬 키 토글 ─────────────────────────────────────────────
  _setSortKey(key) {
    if (this._sort.key === key) {
      this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sort.key = key;
      this._sort.dir = 'asc';
    }
    this._renderTab();
  },

  // ── 서버 재조회 후 탭 재렌더 ─────────────────────────────────
  async _reloadAndRender() {
    await Promise.all([this._loadSchedules(), this._loadDashboard()]);
    this._renderTab();
  },

  // ── 수금현황 엑셀 내보내기 (현재 필터 반영) ─────────────────
  _exportExcel() {
    const p = new URLSearchParams();
    if (this._filter.status) p.set('status', this._filter.status);
    if (this._filter.due_from) p.set('due_from', this._filter.due_from);
    if (this._filter.due_to) p.set('due_to', this._filter.due_to);
    if (this._filter.search) p.set('search', this._filter.search);
    const qs = p.toString() ? '?' + p.toString() : '';
    const name = '수금현황_' + new Date().toISOString().slice(0, 10);
    if (API.downloadExport) API.downloadExport('/payments/export' + qs, name, 'xlsx');
    else window.open('/api/payments/export' + qs, '_blank');
  },

  // ── 스케줄 삭제 ─────────────────────────────────────────────
  async _deleteSchedule(id) {
    const s    = this._schedules.find(x => x.id === id);
    const name = s ? `${s.customer_name || ''} · ${s.stage_name || ''}` : `#${id}`;
    if (!confirm(`수금 스케줄을 삭제하시겠습니까?\n${name}\n\n⚠️ 입금 이력도 함께 삭제됩니다`)) return;
    try {
      await API.del(`/payments/${id}`);
      Toast.success?.('삭제됐습니다');
      await this._reloadAndRender();
    } catch (err) {
      Toast.error?.('삭제 실패: ' + (err?.message || err));
    }
  },

  // ── 유틸 ─────────────────────────────────────────────────────
  _esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _dDay(dueDateStr) {
    if (!dueDateStr) return { label: '', color: 'var(--text-3)' };
    const diff = Math.ceil((new Date(dueDateStr) - new Date()) / 86400000);
    if (diff < 0) return { label: `D+${Math.abs(diff)}`, color: '#E63329' };
    if (diff === 0) return { label: 'D-Day', color: '#E63329' };
    if (diff <= 7) return { label: `D-${diff}`, color: '#F59C00' };
    return { label: `D-${diff}`, color: 'var(--text-3)' };
  },
};
