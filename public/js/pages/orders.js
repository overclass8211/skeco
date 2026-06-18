// ============================================================
// OMS (주문관리) Page — 인터페이스 플레이스홀더
// ERP 연동 후 실 기능 구현 예정
// ============================================================
const OrdersPage = {
  // 현재 활성 탭
  activeTab: 'input',

  render() {
    document.getElementById('content').innerHTML = `
      <!-- OMS 탭 네비게이션 -->
      <div class="oms-tab-bar">
        <button class="oms-tab active" data-tab="input">📥 주문 입력</button>
        <button class="oms-tab"        data-tab="approval">✅ 주문 승인</button>
        <button class="oms-tab"        data-tab="history">📋 주문 조회/사후관리</button>
      </div>

      <!-- 탭 컨텐츠 -->
      <div id="oms-tab-content"></div>
    `;
    document.querySelector('.oms-tab-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.oms-tab[data-tab]');
      if (btn) this.switchTab(btn.dataset.tab);
    });
    this.switchTab('input');
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.oms-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    const fn = {
      input: this.renderInput,
      approval: this.renderApproval,
      history: this.renderHistory,
    };
    fn[tab].call(this);
  },

  // ── 탭1: 주문 입력 ───────────────────────────────────────
  renderInput() {
    document.getElementById('oms-tab-content').innerHTML = `
      <div class="oms-coming-soon">
        <div class="oms-cs-icon">📥</div>
        <div class="oms-cs-title">주문 입력 관리</div>
        <div class="oms-cs-desc">ERP 연동 후 구현 예정</div>
        <div class="oms-cs-features">
          <div class="oms-feature-group">
            <div class="oms-feature-title">📌 구현 예정 기능</div>
            <ul>
              <li>대리점 최소 정보 입력 후 ERP 오더 내역 자동 매핑</li>
              <li>거래처명, 품목, 수량, 납기일 입력 폼</li>
              <li>최근 발주 이력 기반 자동완성</li>
              <li>AI-7: 텍스트 발주 인식 → 오더 자동 생성</li>
            </ul>
          </div>
          <div class="oms-feature-group">
            <div class="oms-feature-title">🔗 연동 시스템</div>
            <ul>
              <li>ERP 오더 시스템 (오더번호 자동 채번)</li>
              <li>재고 시스템 (출하 가능 여부 실시간 체크)</li>
            </ul>
          </div>
        </div>
        <div class="oms-cs-badge">🚧 ERP 연동 스펙 정의 필요</div>
      </div>

      <!-- 프로토타입 폼 (입력 구조 미리보기) -->
      <div class="card mt-3">
        <div class="card-header">
          <div class="card-title">주문 입력 폼 — 프로토타입 (비활성)</div>
          <span class="badge badge-amber">미연동</span>
        </div>
        <div class="card-body oms-proto-form">
          <div class="oms-form-grid">
            <div class="form-group">
              <label class="form-label">거래처명 *</label>
              <input class="form-input" disabled placeholder="ERP 연동 후 자동완성">
            </div>
            <div class="form-group">
              <label class="form-label">품목 코드 *</label>
              <input class="form-input" disabled placeholder="ERP 품목 코드">
            </div>
            <div class="form-group">
              <label class="form-label">주문 수량 *</label>
              <input class="form-input" type="number" disabled placeholder="0">
            </div>
            <div class="form-group">
              <label class="form-label">희망 납기일</label>
              <input class="form-input" type="date" disabled>
            </div>
            <div class="form-group">
              <label class="form-label">출하 창고</label>
              <select class="form-select" disabled>
                <option>ERP 연동 후 자동 조회</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">ERP 오더번호</label>
              <input class="form-input" disabled placeholder="승인 시 자동 채번">
            </div>
          </div>
          <div class="form-group mt-2">
            <label class="form-label">비고</label>
            <textarea class="form-input" rows="2" disabled placeholder="특이사항 입력"></textarea>
          </div>
          <div class="oms-form-actions">
            <button class="btn btn-ghost" disabled>임시저장</button>
            <button class="btn btn-primary" disabled>주문 제출</button>
          </div>
        </div>
      </div>
    `;
  },

  // ── 탭2: 주문 승인 ───────────────────────────────────────
  renderApproval() {
    document.getElementById('oms-tab-content').innerHTML = `
      <div class="oms-coming-soon">
        <div class="oms-cs-icon">✅</div>
        <div class="oms-cs-title">주문 승인 관리</div>
        <div class="oms-cs-desc">ERP 연동 후 구현 예정</div>
        <div class="oms-cs-features">
          <div class="oms-feature-group">
            <div class="oms-feature-title">📌 구현 예정 기능</div>
            <ul>
              <li>거래처별 주문 승인 담당자 설정 및 권한 관리</li>
              <li>승인/반려 워크플로우 (1차 팀장 → 2차 본부장)</li>
              <li>승인 시 ERP I/F 자동 전송 + 오더번호 채번</li>
              <li>승인 처리 시 주문자 실시간 알림 발송</li>
            </ul>
          </div>
          <div class="oms-feature-group">
            <div class="oms-feature-title">🔗 연동 시스템</div>
            <ul>
              <li>ERP 주문 승인 API</li>
              <li>알림 시스템 (SMS / 이메일 / 시스템 내 알림)</li>
            </ul>
          </div>
        </div>
        <div class="oms-cs-badge">🚧 ERP 연동 스펙 정의 필요</div>
      </div>

      <!-- 승인 대기 목록 (프로토타입) -->
      <div class="card mt-3">
        <div class="card-header">
          <div class="card-title">승인 대기 목록 — 프로토타입 (비활성)</div>
          <span class="badge badge-amber">미연동</span>
        </div>
        <div class="card-body no-pad">
          <table class="data-table oms-disabled-table">
            <thead>
              <tr>
                <th>주문번호</th><th>거래처</th><th>품목</th><th>수량</th>
                <th>주문일시</th><th>주문자</th><th>상태</th><th>처리</th>
              </tr>
            </thead>
            <tbody>
              <tr class="oms-placeholder-row">
                <td colspan="8" style="text-align:center;color:var(--text-3);padding:40px">
                  ERP 연동 후 주문 데이터가 표시됩니다
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ── 탭3: 주문 조회 / 사후관리 ───────────────────────────
  renderHistory() {
    document.getElementById('oms-tab-content').innerHTML = `
      <div class="oms-coming-soon">
        <div class="oms-cs-icon">📋</div>
        <div class="oms-cs-title">주문 조회 / 사후관리</div>
        <div class="oms-cs-desc">ERP · TMS · 물류 시스템 연동 후 구현 예정</div>
        <div class="oms-cs-features">
          <div class="oms-feature-group">
            <div class="oms-feature-title">📌 구현 예정 기능</div>
            <ul>
              <li>오더 정보 및 상태 (입력·승인·출하·완료) 조회</li>
              <li>TMS 배차정보 연동 조회</li>
              <li>ERP 출하정보 / 매출(여신)정보 / 재고정보 연동</li>
              <li>CoA(성적서) · 계근표 · 세금계산서 연동 출력</li>
              <li>주문 클릭 시 전체 연동 정보 통합 팝업</li>
            </ul>
          </div>
          <div class="oms-feature-group">
            <div class="oms-feature-title">🔗 연동 시스템</div>
            <ul>
              <li>ERP (출하·매출·여신·재고·성적서)</li>
              <li>TMS (주문·배차 정보)</li>
              <li>전자세금계산서 시스템</li>
              <li>AI-8: ERP 연동 레포트 (LLM 매출/원가 분석)</li>
            </ul>
          </div>
        </div>
        <div class="oms-cs-badge">🚧 ERP / TMS 연동 스펙 정의 필요</div>
      </div>

      <!-- 주문 통합 조회 (프로토타입) -->
      <div class="card mt-3">
        <div class="card-header">
          <div class="card-title">주문 통합 조회 — 프로토타입 (비활성)</div>
          <span class="badge badge-amber">미연동</span>
        </div>
        <div class="card-body no-pad">
          <div class="filter-bar" style="position:relative">
            <input class="search-input" disabled placeholder="오더번호 / 거래처명 검색...">
            <select class="filter-select" disabled><option>전체 상태</option></select>
            <select class="filter-select" disabled><option>전체 품목</option></select>
            <input class="form-input" type="date" disabled style="font-size:12px;padding:7px 10px;border:1px solid var(--border-2);border-radius:var(--radius)">
            <span style="font-size:12px;color:var(--text-3)">~</span>
            <input class="form-input" type="date" disabled style="font-size:12px;padding:7px 10px;border:1px solid var(--border-2);border-radius:var(--radius)">
          </div>
          <table class="data-table oms-disabled-table">
            <thead>
              <tr>
                <th>ERP 오더번호</th><th>거래처</th><th>품목</th><th>수량</th>
                <th>출하일</th><th>배차</th><th>여신</th><th>상태</th><th>상세</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="9" style="text-align:center;color:var(--text-3);padding:40px">
                  ERP · TMS 연동 후 데이터가 표시됩니다
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
};
