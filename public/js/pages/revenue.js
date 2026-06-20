'use strict';
// =============================================================
// 매출관리 (Revenue) 페이지 [P2]
//   · 청구차수(매출 라인) 목록 · 매출 예정/확정 KPI · 매출 추이(월별)
//   · 매출확정 = 세금계산서 발행 시 (수금관리에서 발행 → 여기 '확정' 자동 반영)
//   · 단일 소스(payment_schedules)를 '매출 렌즈'로 조회 — /api/revenue
// =============================================================
const RevenuePage = {
  _summary: null,
  _filter: { revenue_status: '', from: '', to: '', q: '' },
  _tab: 'schedules', // schedules | trend
  _charts: {},

  async render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="loading" style="padding:40px;text-align:center;color:var(--text-3)">매출 데이터 로딩중...</div>`;
    await this._loadSummary();
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h2 style="margin:0;font-size:20px">📊 매출관리</h2>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px">청구차수 · 매출 예정/확정 · 실적 집계 — 매출확정 = 세금계산서 발행 시</div>
        </div>
      </div>
      <div style="display:inline-flex;align-items:center;gap:6px;background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;border-radius:8px;padding:7px 11px;font-size:12px;line-height:1.4;margin-bottom:14px">
        <span aria-hidden="true">📋</span>
        <span><b>매출 인식 관점</b> — 세금계산서 발행 기준. 현금 회수(입금) 현황은 <b>수금관리</b>에서 관리합니다.</span>
      </div>
      <div id="rev-sched-controls">
        <div id="rev-kpi"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <select id="rev-fl-status" class="form-input" style="width:130px;font-size:12px;padding:5px 8px">
            <option value="">매출상태 전체</option>
            <option value="예정">예정</option>
            <option value="확정">확정</option>
            <option value="취소">취소</option>
          </select>
          <input id="rev-fl-from" type="date" class="form-input" style="width:140px;font-size:12px;padding:5px 8px" title="예정일 시작">
          <input id="rev-fl-to" type="date" class="form-input" style="width:140px;font-size:12px;padding:5px 8px" title="예정일 종료">
          <input id="rev-fl-q" class="form-input" placeholder="🔍 고객사/계약명" style="width:200px;font-size:12px;padding:5px 8px">
          <button id="rev-fl-apply" class="btn btn-sm btn-primary">조회</button>
        </div>
      </div>
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:14px;flex-wrap:wrap">
        <button class="rev-tab" data-tab="schedules" style="${this._tabStyle('schedules')}">📋 청구차수</button>
        <button class="rev-tab" data-tab="trend" style="${this._tabStyle('trend')}">📈 매출 추이</button>
        <button class="rev-tab" data-tab="tax" style="${this._tabStyle('tax')}">🧾 세금계산서</button>
        <button class="rev-tab" data-tab="analysis" style="${this._tabStyle('analysis')}">📊 매출분석</button>
      </div>
      <div id="rev-tab-content"></div>
    `;

    const $ = id => document.getElementById(id);
    $('rev-fl-status').value = this._filter.revenue_status;
    $('rev-fl-from').value = this._filter.from;
    $('rev-fl-to').value = this._filter.to;
    $('rev-fl-q').value = this._filter.q;
    $('rev-fl-apply').addEventListener('click', () => this._applyFilter());
    $('rev-fl-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._applyFilter();
    });
    document.querySelectorAll('.rev-tab').forEach(b =>
      b.addEventListener('click', () => {
        this._tab = b.dataset.tab;
        this._syncTabs();
        this._renderTab();
      })
    );
    this._renderKpi();
    this._renderTab();
  },

  _applyFilter() {
    const $ = id => document.getElementById(id);
    this._filter = {
      revenue_status: $('rev-fl-status').value,
      from: $('rev-fl-from').value,
      to: $('rev-fl-to').value,
      q: $('rev-fl-q').value.trim(),
    };
    this._loadSummary().then(() => {
      this._renderKpi();
      this._renderTab();
    });
  },

  async _loadSummary() {
    try {
      const res = await API.revenue.summary({ from: this._filter.from, to: this._filter.to });
      this._summary = res?.data || null;
    } catch (_) {
      this._summary = null;
    }
  },

  _fmt(n) {
    return (Number(n) || 0).toLocaleString('ko-KR');
  },
  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  _fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  },

  // 공통 KpiBar 로 통일 (고객사/영업딜 등과 동일 톤)
  _renderKpi() {
    if (!document.getElementById('rev-kpi')) return;
    const k = this._summary?.kpi || {};
    const planned = k['예정'] || { cnt: 0, amount: 0 };
    const confirmed = k['확정'] || { cnt: 0, amount: 0 };
    const cancelled = k['취소'] || { cnt: 0, amount: 0 };
    const totalAmt = (planned.amount || 0) + (confirmed.amount || 0);
    const rate = totalAmt ? Math.round(((confirmed.amount || 0) / totalAmt) * 100) : 0;
    const won = n => '₩' + this._fmtKrwCompact(n);
    KpiBar.render({
      containerSel: '#rev-kpi',
      cards: [
        { icon: 'clock', label: '매출 예정', valueText: won(planned.amount), color: '#1664E5', sub: `${planned.cnt || 0}건` },
        { icon: 'money', label: '매출 확정', valueText: won(confirmed.amount), color: '#E63329', sub: `${confirmed.cnt || 0}건 · 세금계산서 발행` },
        { icon: 'trophy', label: '확정률', valueText: `${rate}%`, color: '#7C4DFF', sub: '확정 / (예정+확정)' },
        { icon: 'ban', label: '취소', valueText: won(cancelled.amount), color: '#6B7280', sub: `${cancelled.cnt || 0}건` },
      ],
    });
  },

  // ₩ 금액을 억/만 단위로 압축 (KPI 카드 가독성)
  _fmtKrwCompact(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1_0000_0000) return (v / 1_0000_0000).toFixed(1).replace(/\.0$/, '') + '억';
    if (Math.abs(v) >= 1_0000) return Math.round(v / 1_0000).toLocaleString('ko-KR') + '만';
    return v.toLocaleString('ko-KR');
  },

  _tabStyle(t) {
    const active = this._tab === t;
    return `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid ${active ? 'var(--oci-red,#E63329)' : 'transparent'};margin-bottom:-2px;color:${active ? 'var(--oci-red,#E63329)' : 'var(--text-3)'}`;
  },
  _syncTabs() {
    document.querySelectorAll('.rev-tab').forEach(b => b.setAttribute('style', this._tabStyle(b.dataset.tab)));
  },

  _renderTab() {
    this._destroyCharts();
    // 위임 탭(수금관리 모듈)의 차트도 정리
    if (typeof PaymentsPage !== 'undefined') PaymentsPage._destroyCharts?.();
    // 매출 컨트롤(KPI/필터)은 청구차수/추이에서만 표시. 위임 탭(세금계산서·매출분석)에서는 숨김.
    const controls = document.getElementById('rev-sched-controls');
    const delegated = this._tab === 'tax' || this._tab === 'analysis';
    if (controls) controls.style.display = delegated ? 'none' : '';
    if (this._tab === 'tax') this._renderTaxTab();
    else if (this._tab === 'analysis') this._renderAnalysisTab();
    else if (this._tab === 'trend') this._renderTrend();
    else this._renderSchedules();
  },

  // 세금계산서 탭 — 수금관리(PaymentsPage)의 렌더를 매출관리 컨테이너로 위임 [이동]
  async _renderTaxTab() {
    const wrap = document.getElementById('rev-tab-content');
    if (!wrap) return;
    if (typeof PaymentsPage === 'undefined') {
      wrap.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--text-3)">세금계산서 모듈을 불러올 수 없습니다.</div>';
      return;
    }
    wrap.innerHTML =
      '<div class="loading" style="padding:24px;text-align:center;color:var(--text-3)">불러오는 중...</div>';
    PaymentsPage._ensureInit();
    try {
      await PaymentsPage._loadConfig();
    } catch (_) {
      /* 모달용 설정 — 실패해도 기본값 */
    }
    await PaymentsPage._renderTax('rev-tab-content');
  },

  // 매출분석 탭 — 수금관리(PaymentsPage)의 분석 렌더를 매출관리 컨테이너로 위임 [이동]
  async _renderAnalysisTab() {
    const wrap = document.getElementById('rev-tab-content');
    if (!wrap) return;
    if (typeof PaymentsPage === 'undefined') {
      wrap.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--text-3)">매출분석 모듈을 불러올 수 없습니다.</div>';
      return;
    }
    wrap.innerHTML =
      '<div class="loading" style="padding:24px;text-align:center;color:var(--text-3)">불러오는 중...</div>';
    PaymentsPage._ensureInit();
    try {
      // 분석에 필요한 대시보드/스케줄/설정 로드 (KPI 렌더는 #pay-kpi 부재로 자동 무시)
      await Promise.all([
        PaymentsPage._loadDashboard(),
        PaymentsPage._loadSchedules(),
        PaymentsPage._loadConfig(),
      ]);
    } catch (_) {
      /* 일부 로드 실패해도 가능한 범위 렌더 */
    }
    PaymentsPage._renderAnalysis('rev-tab-content');
  },

  async _renderSchedules() {
    const wrap = document.getElementById('rev-tab-content');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loading" style="padding:24px;text-align:center;color:var(--text-3)">불러오는 중...</div>`;
    let rows;
    try {
      const res = await API.revenue.schedules({ ...this._filter, limit: 200 });
      rows = res?.data || [];
    } catch (err) {
      wrap.innerHTML = `<div style="padding:16px;color:#dc2626">조회 실패: ${this._esc(err?.message || err)}</div>`;
      return;
    }
    if (!rows.length) {
      wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3)">청구차수가 없습니다. 계약을 체결하면 매출계획이 자동 생성됩니다.</div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text-3)">행을 클릭하면 상세 정보를 볼 수 있습니다</div>
        <button id="rev-col-settings" class="btn btn-sm" style="font-size:11px;background:#fff;border:1px solid var(--border)">⚙ 컬럼 설정</button>
      </div>
      <table class="data-table" style="font-size:12px">
      <thead><tr>
        <th>고객사</th><th>계약 / 차수</th>
        <th style="text-align:right">공급가</th><th style="text-align:right">세액</th><th style="text-align:right">합계</th>
        <th style="width:96px">예정일</th><th style="width:74px;text-align:center">매출상태</th><th style="width:82px;text-align:center">세금계산서</th>
      </tr></thead>
      <tbody>${rows.map(r => this._rowHtml(r)).join('')}</tbody>
    </table>`;
    document
      .getElementById('rev-col-settings')
      ?.addEventListener('click', () => this._openColumnSettings());
    wrap.querySelectorAll('.rev-row').forEach(tr => {
      tr.addEventListener('click', () => this._openScheduleDetail(parseInt(tr.dataset.id, 10)));
    });
  },

  _rowHtml(r) {
    const badge =
      r.revenue_status === '확정'
        ? `<span class="badge badge-green" style="font-size:10px">확정</span>`
        : r.revenue_status === '취소'
          ? `<span class="badge badge-gray" style="font-size:10px">취소</span>`
          : `<span class="badge badge-blue" style="font-size:10px">예정</span>`;
    const inv =
      Number(r.issued_cnt) > 0
        ? `<span class="badge badge-green" style="font-size:10px">발행</span>`
        : `<span style="color:var(--text-3);font-size:11px">미발행</span>`;
    const stage = [r.contract_name, r.stage_name].filter(Boolean).join(' · ');
    return `<tr class="rev-row" data-id="${r.id}" style="cursor:pointer">
      <td>${this._esc(r.customer_name || '-')}</td>
      <td>${this._esc(stage || '-')}</td>
      <td style="text-align:right;font-family:monospace">${this._fmt(r.supply_amount)}</td>
      <td style="text-align:right;font-family:monospace">${this._fmt(r.tax_amount)}</td>
      <td style="text-align:right;font-family:monospace;font-weight:600">${this._fmt(r.scheduled_amount)} ${this._esc(r.currency || 'KRW')}</td>
      <td style="font-size:11px">${this._fmtDate(r.due_date)}</td>
      <td style="text-align:center">${badge}</td>
      <td style="text-align:center">${inv}</td>
    </tr>`;
  },

  _renderTrend() {
    const wrap = document.getElementById('rev-tab-content');
    if (!wrap) return;
    const m = this._summary?.monthly || { planned: [], confirmed: [] };
    const months = [
      ...new Set([...(m.planned || []).map(x => x.ym), ...(m.confirmed || []).map(x => x.ym)]),
    ].sort();
    if (!months.length) {
      wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3)">표시할 매출 추이가 없습니다.</div>`;
      return;
    }
    const pMap = Object.fromEntries((m.planned || []).map(x => [x.ym, Number(x.amount)]));
    const cMap = Object.fromEntries((m.confirmed || []).map(x => [x.ym, Number(x.amount)]));
    wrap.innerHTML = `<div style="height:340px;position:relative"><canvas id="rev-trend-chart"></canvas></div>`;
    if (typeof Chart === 'undefined') return;
    this._charts.trend = new Chart(document.getElementById('rev-trend-chart'), {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          { label: '매출 예정', data: months.map(ym => pMap[ym] || 0), backgroundColor: 'rgba(59,130,246,0.6)' },
          { label: '매출 확정', data: months.map(ym => cMap[ym] || 0), backgroundColor: 'rgba(230,51,41,0.75)' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: { label: c => `${c.dataset.label}: ${Number(c.raw).toLocaleString('ko-KR')}원` },
          },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('ko-KR') } } },
      },
    });
  },

  _destroyCharts() {
    Object.keys(this._charts).forEach(k => {
      try {
        this._charts[k]?.destroy();
      } catch (_) {
        /* skip */
      }
      delete this._charts[k];
    });
  },

  // ── 청구차수 상세 모달 + 컬럼 설정 [P2b] ─────────────────────
  _colsDefault() {
    return { cust_biz: true, cust_addr: true, sup_biz: true, sup_addr: true, tax_recipient: true };
  },
  _loadCols() {
    try {
      const raw = localStorage.getItem('oci_revenue_detail_cols');
      if (raw) return { ...this._colsDefault(), ...JSON.parse(raw) };
    } catch (_) {
      /* 기본값 사용 */
    }
    return this._colsDefault();
  },
  _saveCols(cols) {
    try {
      localStorage.setItem('oci_revenue_detail_cols', JSON.stringify(cols));
    } catch (_) {
      /* 무시 */
    }
  },

  _openColumnSettings() {
    const cols = this._loadCols();
    const opt = (key, label) =>
      `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer">
        <input type="checkbox" class="rev-col-opt" data-key="${key}" ${cols[key] ? 'checked' : ''}/>
        <span>${label}</span>
      </label>`;
    Modal.open({
      title: '⚙ 상세 컬럼 설정',
      size: 'sm',
      body: `
        <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">청구차수 상세 모달에 표시할 추가 항목을 선택하세요.</div>
        ${opt('cust_biz', '고객사 사업자번호')}
        ${opt('cust_addr', '고객사 주소지')}
        ${opt('sup_biz', '공급자 사업자번호')}
        ${opt('sup_addr', '공급자 주소지')}
        ${opt('tax_recipient', '세금계산서 수신 담당자 (명·부서·메일)')}`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">닫기</button>
        <button id="rev-col-save" class="btn btn-primary">저장</button>`,
      onOpen: () => {
        document.getElementById('rev-col-save')?.addEventListener('click', () => {
          const next = this._colsDefault();
          document.querySelectorAll('.rev-col-opt').forEach(cb => {
            next[cb.dataset.key] = cb.checked;
          });
          this._saveCols(next);
          Toast.success?.('컬럼 설정이 저장됐습니다');
          Modal.close();
        });
      },
    });
  },

  async _openScheduleDetail(id) {
    let d;
    try {
      const res = await API.revenue.detail(id);
      if (!res.success) throw new Error(res.error || '상세 조회 실패');
      d = res.data;
    } catch (err) {
      Toast.error?.('상세 조회 실패: ' + (err?.message || err));
      return;
    }
    const cols = this._loadCols();
    const s = d.schedule || {};
    const c = d.customer || {};
    const sup = d.supplier || {};
    const stage = [s.contract_name, s.stage_name].filter(Boolean).join(' · ');
    const revBadge =
      s.revenue_status === '확정'
        ? '<span class="badge badge-green">확정</span>'
        : s.revenue_status === '취소'
          ? '<span class="badge badge-gray">취소</span>'
          : '<span class="badge badge-blue">예정</span>';
    const inv = Number(s.issued_cnt) > 0 ? '발행' : '미발행';
    const row = (label, val) =>
      `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">
        <div style="width:130px;flex-shrink:0;font-size:12px;color:var(--text-3)">${label}</div>
        <div style="font-size:13px">${val}</div>
      </div>`;
    const ext = [];
    if (cols.cust_biz) ext.push(row('고객사 사업자번호', this._esc(c.business_no || '-')));
    if (cols.cust_addr) ext.push(row('고객사 주소지', this._esc(c.address || '-')));
    if (cols.sup_biz) ext.push(row('공급자 사업자번호', this._esc(sup.business_no || '-')));
    if (cols.sup_addr) ext.push(row('공급자 주소지', this._esc(sup.address || '-')));
    const taxBlock = cols.tax_recipient
      ? `<div style="margin-top:12px;padding:10px;background:#F9FAFB;border:1px solid var(--border);border-radius:8px">
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">🧾 세금계산서 수신 담당자</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <input id="rev-tax-name" class="form-input" placeholder="담당자명" value="${this._esc(c.tax_recipient_name || '')}" style="font-size:13px;padding:5px 8px"/>
            <input id="rev-tax-dept" class="form-input" placeholder="부서" value="${this._esc(c.tax_recipient_dept || '')}" style="font-size:13px;padding:5px 8px"/>
          </div>
          <input id="rev-tax-email" type="email" class="form-input" placeholder="메일주소" value="${this._esc(c.tax_recipient_email || '')}" style="font-size:13px;padding:5px 8px;width:100%;margin-bottom:6px"/>
          <button id="rev-tax-save" class="btn btn-sm btn-primary" style="font-size:12px">담당자 저장</button>
          <div style="font-size:10px;color:var(--text-3);margin-top:4px">고객사(${this._esc(c.name || '')}) 단위로 저장 — 동일 고객사의 다른 청구차수에도 공유됩니다.</div>
        </div>`
      : '';
    Modal.open({
      title: '📋 청구차수 상세',
      size: 'md',
      body: `
        <div style="margin-bottom:8px">${revBadge} <span style="font-size:11px;color:var(--text-3)">· 세금계산서 ${inv}</span></div>
        ${row('고객사', this._esc(s.customer_name || c.name || '-'))}
        ${row('계약 / 차수', this._esc(stage || '-'))}
        ${row('공급가', this._fmt(s.supply_amount) + ' ' + this._esc(s.currency || 'KRW'))}
        ${row('세액', this._fmt(s.tax_amount))}
        ${row('합계', '<b>' + this._fmt(s.scheduled_amount) + ' ' + this._esc(s.currency || 'KRW') + '</b>')}
        ${row('예정일', this._fmtDate(s.due_date))}
        ${ext.join('')}
        ${taxBlock}`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">닫기</button>${
        s.contract_id
          ? '<button id="rev-flow-btn" class="btn btn-primary" style="background:#0891B2;border-color:#0891B2">💧 계약 흐름</button>'
          : ''
      }`,
      onOpen: () => {
        document
          .getElementById('rev-flow-btn')
          ?.addEventListener('click', () => this._openFlowModal(s.contract_id));
        document.getElementById('rev-tax-save')?.addEventListener('click', async () => {
          const payload = {
            name: (document.getElementById('rev-tax-name')?.value || '').trim(),
            dept: (document.getElementById('rev-tax-dept')?.value || '').trim(),
            email: (document.getElementById('rev-tax-email')?.value || '').trim(),
          };
          const btn = document.getElementById('rev-tax-save');
          if (btn) btn.disabled = true;
          try {
            const r = await API.revenue.saveTaxRecipient(id, payload);
            if (r.success) Toast.success?.('세금계산서 수신 담당자가 저장됐습니다');
            else Toast.error?.(r.error || '저장 실패');
          } catch (err) {
            Toast.error?.('저장 실패: ' + (err?.message || err));
          } finally {
            if (btn) btn.disabled = false;
          }
        });
      },
    });
  },

  // ── 드릴다운: 계약→프로젝트→매출→수금 흐름 모달 [P4-B] ────────
  async _openFlowModal(contractId) {
    let d;
    try {
      const res = await API.get('/payments/flow/' + contractId);
      if (!res.success) throw new Error(res.error || '흐름 조회 실패');
      d = res.data;
    } catch (err) {
      Toast.error?.('흐름 조회 실패: ' + (err?.message || err));
      return;
    }
    const c = d.contract || {};
    const p = d.project || null;
    const t = d.totals || {};
    const cur = c.currency || 'KRW';
    const card = (icon, title, lines, color) =>
      `<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--border);border-top:3px solid ${color};border-radius:8px;padding:10px 12px">
        <div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px">${icon} ${title}</div>
        ${lines}
      </div>`;
    const arrow = `<div style="align-self:center;font-size:16px;color:var(--text-3);flex:none">→</div>`;
    const chain = [
      card(
        '📜',
        '계약',
        `<div style="font-size:13px;font-weight:600">${this._esc(c.title || '-')}</div>
         <div style="font-size:11px;color:var(--text-3)">${this._esc(c.contract_no || '')} · ${this._esc(c.status || '')}</div>
         <div style="font-size:12px;margin-top:2px">${this._fmt(c.contract_amount)} ${this._esc(cur)}</div>`,
        '#7c3aed'
      ),
      card(
        '🏗',
        '프로젝트',
        p
          ? `<div style="font-size:13px;font-weight:600">${this._esc(p.name || p.project_code || '-')}</div>
             <div style="font-size:11px;color:var(--text-3)">${this._esc(p.project_code || '')} · ${this._esc(p.status || '')}</div>`
          : `<div style="font-size:12px;color:var(--text-3)">연결된 프로젝트 없음</div>`,
        '#0891B2'
      ),
      card(
        '📋',
        '매출(청구차수)',
        `<div style="font-size:13px;font-weight:600">${d.schedules.length}건</div>
         <div style="font-size:11px;color:var(--text-3)">확정 ${this._fmt(t.revenue_confirmed)} / 예정 ${this._fmt(t.scheduled)}</div>`,
        '#16a34a'
      ),
      card(
        '💰',
        '수금',
        `<div style="font-size:13px;font-weight:700;color:#0F7A3F">${this._fmt(t.collected)}</div>
         <div style="font-size:11px;color:#E63329">미수 ${this._fmt(t.outstanding)} ${this._esc(cur)}</div>`,
        '#E63329'
      ),
    ].join(arrow);
    const schedRows = d.schedules
      .map(s => {
        const remain = Number(s.scheduled_amount) - Number(s.paid_amount || 0);
        const rb =
          s.revenue_status === '확정'
            ? 'badge-green'
            : s.revenue_status === '취소'
              ? 'badge-gray'
              : 'badge-blue';
        return `<tr>
          <td style="padding:6px 10px">${this._esc(s.stage_name || '-')}</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace">${this._fmt(s.scheduled_amount)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace;color:#0F7A3F">${this._fmt(s.paid_amount)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace;color:${remain > 0 ? '#E63329' : 'var(--text-3)'}">${this._fmt(remain)}</td>
          <td style="padding:6px 10px;font-size:11px">${this._fmtDate(s.due_date)}</td>
          <td style="padding:6px 10px;text-align:center"><span class="badge ${rb}" style="font-size:10px">${this._esc(s.revenue_status || '예정')}</span></td>
        </tr>`;
      })
      .join('');
    Modal.open({
      title: '💧 수금 흐름 (계약 → 프로젝트 → 매출 → 수금)',
      wide: true,
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${chain}</div>
        ${
          d.schedules.length
            ? `<table class="data-table" style="font-size:12px;width:100%">
            <thead><tr>
              <th>차수</th><th style="text-align:right">예정액</th><th style="text-align:right">수금</th>
              <th style="text-align:right">미수</th><th>예정일</th><th style="text-align:center">매출상태</th>
            </tr></thead><tbody>${schedRows}</tbody></table>`
            : '<div style="text-align:center;padding:24px;color:var(--text-3)">청구차수가 없습니다</div>'
        }`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">닫기</button>`,
    });
  },
};
