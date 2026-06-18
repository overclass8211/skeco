// ============================================================
// Reports Page - 영업 리포트 / 분석
// ============================================================
const ReportsPage = {
  charts: {},
  widgetCharts: {}, // 위젯별 Chart.js 인스턴스 (key: widget id)
  widgets: [], // 현재 사용자 위젯 목록 (API 응답 캐시)
  selectedYear: new Date().getFullYear(),

  async render() {
    const curYear = new Date().getFullYear();
    const years = [];
    for (let y = curYear; y >= 2023; y--) years.push(y);

    const html = `
      <div class="filter-bar">
        <div class="card-title" style="margin-right:auto" id="reports-title">영업 리포트 (${this.selectedYear}년)</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${years
            .map(
              y => `
            <button class="year-btn ${y === this.selectedYear ? 'active' : ''}"
              data-year="${y}"
              style="padding:4px 10px;border-radius:var(--radius);border:1px solid var(--border-2);
                     background:${y === this.selectedYear ? 'var(--blue)' : 'var(--bg-2)'};
                     color:${y === this.selectedYear ? '#fff' : 'var(--text-2)'};
                     font-size:12px;cursor:pointer;font-weight:${y === this.selectedYear ? '600' : '400'}">
              ${y}
            </button>`
            )
            .join('')}
        </div>
        <button class="ai-gen-btn" id="reports-weekly-btn">📊 주간보고서 AI생성</button>
        <button class="ai-gen-btn" id="reports-monthly-btn">📈 월간보고서 AI생성</button>
        <button class="btn btn-ghost btn-sm" id="reports-export-btn">CSV 내보내기</button>
      </div>

      <!-- AI 보고서 출력 영역 -->
      <div class="card mb-3" id="ai-report-card" style="display:none">
        <div class="card-header">
          <div class="card-title" id="ai-report-title">🤖 AI 보고서</div>
          <div style="display:flex;gap:6px">
            <button class="ai-gen-btn" id="reports-copy-btn">📋 복사</button>
            <button class="btn btn-ghost btn-sm" id="reports-close-report-btn">닫기</button>
          </div>
        </div>
        <div class="card-body" id="ai-report-body" style="font-size:13px;line-height:1.8;white-space:pre-wrap;max-height:400px;overflow-y:auto"></div>
      </div>

      <div class="metrics-grid mb-3" id="reports-kpis">
        <div class="metric-card"><div class="metric-label">로딩...</div></div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header">
            <div class="card-title">국내 / 해외 비중</div>
          </div>
          <div class="card-body">
            <div class="chart-wrap" style="height:280px"><canvas id="chart-region"></canvas></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">사업유형별 매출 기여</div>
          </div>
          <div class="card-body">
            <div class="chart-wrap" style="height:280px"><canvas id="chart-business"></canvas></div>
          </div>
        </div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header">
            <div class="card-title">단계별 전환율 (Funnel)</div>
          </div>
          <div class="card-body" id="reports-funnel">
            <div class="loading">로딩...</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">담당자별 수주 실적 TOP 5</div>
          </div>
          <div class="card-body no-pad" id="reports-top">
            <div class="loading">로딩...</div>
          </div>
        </div>
      </div>

      <!-- ★ 내 리포트 위젯 영역 (사용자 정의) ────────────────── -->
      <div class="rp-widgets-section" data-feature="crm.report_builder">
        <div class="rp-widgets-header">
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            ⭐ 내 리포트 위젯
            <span id="rp-widget-count" style="font-size:11px;color:var(--text-3);font-weight:400"></span>
          </div>
          <button class="btn btn-primary btn-sm" id="rp-add-widget-btn" title="리포트 빌더에서 만든 리포트를 위젯으로 추가">
            + 위젯 추가
          </button>
        </div>
        <div class="rp-widgets-grid" id="rp-widgets-grid">
          <div class="loading" style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-3)">위젯 로딩 중...</div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // year buttons delegation
    document.querySelector('.filter-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.year-btn[data-year]');
      if (btn) this.changeYear(parseInt(btn.dataset.year));
    });
    document
      .getElementById('reports-weekly-btn')
      ?.addEventListener('click', () => this.generateWeekly());
    document
      .getElementById('reports-monthly-btn')
      ?.addEventListener('click', () => this.generateMonthly());
    document
      .getElementById('reports-export-btn')
      ?.addEventListener('click', () => this.exportCsv());
    document.getElementById('reports-copy-btn')?.addEventListener('click', () => this.copyReport());
    document.getElementById('reports-close-report-btn')?.addEventListener('click', () => {
      document.getElementById('ai-report-card').style.display = 'none';
    });
    // ★ 위젯 추가 버튼
    document
      .getElementById('rp-add-widget-btn')
      ?.addEventListener('click', () => this._openAddWidgetModal());

    await this.loadData();
    // 위젯은 별도 비동기 로드 (기존 대시보드와 독립 — 실패해도 KPI 영향 없음)
    this._loadWidgets().catch(err => console.warn('[Widgets] 로드 실패:', err.message));
  },

  async changeYear(year) {
    this.selectedYear = year;
    document.querySelectorAll('.year-btn').forEach(btn => {
      const btnYear = parseInt(btn.textContent.trim());
      btn.style.background = btnYear === year ? 'var(--blue)' : 'var(--bg-2)';
      btn.style.color = btnYear === year ? '#fff' : 'var(--text-2)';
      btn.style.fontWeight = btnYear === year ? '600' : '400';
    });
    const titleEl = document.getElementById('reports-title');
    if (titleEl) titleEl.textContent = `영업 리포트 (${year}년)`;
    document.getElementById('reports-kpis').innerHTML =
      '<div class="metric-card"><div class="metric-label">로딩...</div></div>';
    document.getElementById('reports-funnel').innerHTML = '<div class="loading">로딩...</div>';
    document.getElementById('reports-top').innerHTML = '<div class="loading">로딩...</div>';
    await this.loadData();
  },

  async loadData() {
    try {
      const y = this.selectedYear;
      // 해당 연도 리드만 가져오기
      const [statsRes, leadsRes, teamRes, funnelRes] = await Promise.all([
        API.dashboard.stats(y),
        API.leads.list({ date_from: `${y}-01-01`, date_to: `${y}-12-31`, date_field: 'created' }),
        API.team.list(),
        API.dashboard.funnel(y),
      ]);
      this.renderKpis(statsRes.data, leadsRes.data);
      this.renderRegionChart(leadsRes.data);
      this.renderBusinessChart(leadsRes.data);
      this.renderFunnel(funnelRes.data);
      this.renderTopTeam(teamRes.data);
    } catch (err) {
      console.error(err);
    }
  },

  renderKpis(stats, leads) {
    const yearTarget = 1500; // 연 목표 1,500억
    const wonAmount = parseFloat(stats.wonAmount || 0);
    const wonLeads = leads.filter(l => l.stage === 'won');
    const wonCount = wonLeads.length;
    const totalCount = leads.length;
    const droppedCount = leads.filter(l => l.stage === 'dropped' || l.stage === 'lost').length;
    const dropRate = totalCount ? (droppedCount / totalCount) * 100 : 0;
    const avgWon = wonCount ? wonAmount / wonCount : 0;
    const achievement = (wonAmount / yearTarget) * 100;
    const curYear = new Date().getFullYear();
    const monthDivisor =
      this.selectedYear === curYear ? Math.max(new Date().getMonth() + 1, 1) : 12;

    document.getElementById('reports-kpis').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">연간 목표 달성률</div>
        <div class="metric-value">${achievement.toFixed(1)}<span class="metric-unit">%</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(achievement, 100)}%"></div></div>
        <div class="metric-sub">목표 ${yearTarget}억 / 누적 ${Fmt.amount(wonAmount)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${this.selectedYear}년 수주 건수</div>
        <div class="metric-value">${wonCount}<span class="metric-unit">건</span></div>
        <div class="metric-sub">월평균 ${(wonCount / monthDivisor).toFixed(1)}건</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">평균 수주 단가</div>
        <div class="metric-value">${Fmt.amount(avgWon)}</div>
        <div class="metric-sub">건당 평균</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">드롭 / 실주율</div>
        <div class="metric-value">${dropRate.toFixed(1)}<span class="metric-unit">%</span></div>
        <div class="metric-sub">총 ${droppedCount} / ${totalCount}건</div>
      </div>
    `;
  },

  renderRegionChart(leads) {
    const wonLeads = leads.filter(l => l.stage === 'won');
    const domestic = wonLeads.filter(l => l.region === '국내').length;
    const overseas = wonLeads.filter(l => l.region === '해외').length;
    const ctx = document.getElementById('chart-region').getContext('2d');
    if (this.charts.region) this.charts.region.destroy();
    this.charts.region = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['국내', '해외'],
        datasets: [
          {
            data: [domestic, overseas],
            backgroundColor: ['#2357E8', '#A855F7'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        cutout: '60%',
      },
    });
  },

  renderBusinessChart(leads) {
    const wonLeads = leads.filter(l => l.stage === 'won');
    const groups = {};
    wonLeads.forEach(l => {
      const key = l.business_type || '기타';
      groups[key] = (groups[key] || 0) + parseFloat(l.expected_amount || 0);
    });
    const labels = Object.keys(groups);
    const data = labels.map(k => groups[k]);
    const colors = ['#F59C00', '#2357E8', '#A855F7', '#17A85A', '#E63329', '#6B7280'];

    const ctx = document.getElementById('chart-business').getContext('2d');
    if (this.charts.business) this.charts.business.destroy();
    this.charts.business = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '수주 금액 (억)',
            data,
            backgroundColor: labels.map((_, i) => colors[i % colors.length]),
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: '#F1F2F4' } } },
      },
    });
  },

  renderFunnel(funnel) {
    const order = ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won'];
    const map = {};
    funnel.forEach(f => (map[f.stage] = parseInt(f.count) || 0));
    const max = Math.max(...order.map(s => map[s] || 0), 1);

    const html = order
      .map(s => {
        const c = map[s] || 0;
        const pct = (c / max) * 100;
        return `
        <div class="funnel-row">
          <div class="funnel-label">${STAGES[s].label}</div>
          <div class="funnel-bar-wrap">
            <div class="funnel-bar" style="width:${pct}%;background:${STAGES[s].color}"></div>
          </div>
          <div class="funnel-count">${c}건</div>
        </div>
      `;
      })
      .join('');

    document.getElementById('reports-funnel').innerHTML = html;
  },

  renderTopTeam(team) {
    const sorted = [...team]
      .sort((a, b) => parseFloat(b.won_amount || 0) - parseFloat(a.won_amount || 0))
      .slice(0, 5);

    if (!sorted.length || !sorted[0].won_amount) {
      document.getElementById('reports-top').innerHTML =
        '<div class="empty"><div class="empty-icon">📊</div>수주 실적이 없습니다</div>';
      return;
    }

    const html = `
      <table class="data-table">
        <thead>
          <tr><th>순위</th><th>담당자</th><th>역할</th><th class="text-right">수주건수</th><th class="text-right">수주금액</th></tr>
        </thead>
        <tbody>
          ${sorted
            .map(
              (m, i) => `
            <tr>
              <td><strong>#${i + 1}</strong></td>
              <td><strong>${esc(m.name)}</strong></td>
              <td><span class="badge badge-gray">${esc(m.role)}</span></td>
              <td class="text-right mono">${m.won_count || 0}</td>
              <td class="text-right mono"><strong>${Fmt.amount(m.won_amount)}</strong></td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    document.getElementById('reports-top').innerHTML = html;
  },

  async generateWeekly() {
    await this._generateReport('weekly', '주간 보고서');
  },
  async generateMonthly() {
    await this._generateReport('monthly', '월간 보고서');
  },

  async _generateReport(type, label) {
    const card = document.getElementById('ai-report-card');
    const body = document.getElementById('ai-report-body');
    const title = document.getElementById('ai-report-title');
    card.style.display = 'block';
    title.textContent = `🤖 AI ${label} 생성중...`;
    body.innerHTML = '<span style="color:var(--text-3)">AI가 보고서를 작성하고 있습니다...</span>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let fullText = '';
    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      body.innerHTML = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const { text } = JSON.parse(data);
            fullText += text;
            body.textContent = fullText;
            body.scrollTop = body.scrollHeight;
          } catch (_) {
            /* skip */
          }
        }
      }
      title.textContent = `✅ AI ${label} 완료`;
    } catch (err) {
      body.innerHTML = `<span style="color:var(--red)">보고서 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  copyReport() {
    const text = document.getElementById('ai-report-body').textContent;
    navigator.clipboard
      .writeText(text)
      .then(() => Toast.success('보고서가 클립보드에 복사되었습니다'));
  },

  async exportCsv() {
    try {
      const y = this.selectedYear;
      const result = await API.leads.list({
        date_from: `${y}-01-01`,
        date_to: `${y}-12-31`,
        date_field: 'created',
      });
      const rows = result.data;
      const headers = [
        '고객사',
        '프로젝트',
        '사업유형',
        '지역',
        '단계',
        '담당자',
        '예상금액',
        '통화',
        '예상마감일',
      ];
      const lines = [headers.join(',')];
      rows.forEach(r => {
        lines.push(
          [
            r.customer_name,
            r.project_name,
            r.business_type,
            r.region,
            STAGES[r.stage]?.label || r.stage,
            r.assigned_name || '',
            r.expected_amount || '',
            r.currency || '',
            r.expected_close_date || '',
          ]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      });
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OCI_Power_영업리포트_${y}_${Fmt.date(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('CSV 파일이 다운로드되었습니다');
    } catch (err) {
      console.error(err);
    }
  },

  // ═══════════════════════════════════════════════════════════
  // ★ 내 리포트 위젯 (사용자 정의)
  // ═══════════════════════════════════════════════════════════

  // 위젯 목록 로드 + 렌더 + 각 위젯 차트 비동기 실행
  async _loadWidgets() {
    try {
      const r = await API.reports.widgets.list();
      this.widgets = r.data || [];
      this._renderWidgets();
      // 차트는 비동기 (Promise.allSettled — 한 위젯 실패해도 다른 위젯 계속)
      const tasks = this.widgets.map(w => this._renderWidgetChart(w));
      await Promise.allSettled(tasks);
    } catch (err) {
      console.warn('[Widgets] list 실패:', err.message);
      const grid = document.getElementById('rp-widgets-grid');
      if (grid)
        grid.innerHTML = `<div class="rp-widgets-empty">위젯 목록을 불러올 수 없습니다 (${err.message})</div>`;
    }
  },

  _renderWidgets() {
    const grid = document.getElementById('rp-widgets-grid');
    const countEl = document.getElementById('rp-widget-count');
    if (!grid) return;
    if (countEl) countEl.textContent = this.widgets.length > 0 ? `(${this.widgets.length}개)` : '';

    // 이전 차트 인스턴스 정리
    Object.values(this.widgetCharts).forEach(c => {
      try {
        c.destroy();
      } catch (_) {}
    });
    this.widgetCharts = {};

    if (this.widgets.length === 0) {
      grid.innerHTML = `
        <div class="rp-widgets-empty">
          <div style="font-size:32px;margin-bottom:10px;opacity:0.4">📊</div>
          <div style="font-size:13px;color:var(--text-2);margin-bottom:4px">아직 추가된 위젯이 없습니다</div>
          <div style="font-size:11px;color:var(--text-3)">
            리포트 빌더에서 만든 리포트를 위젯으로 추가하거나, 새 리포트를 만들어보세요.
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:14px" id="rp-empty-add-btn">+ 첫 위젯 추가</button>
        </div>
      `;
      document
        .getElementById('rp-empty-add-btn')
        ?.addEventListener('click', () => this._openAddWidgetModal());
      return;
    }

    grid.innerHTML = this.widgets.map(w => this._widgetCardHtml(w)).join('');

    // 카드 액션 이벤트 바인딩
    grid.querySelectorAll('[data-widget-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const widgetId = parseInt(btn.dataset.widgetId, 10);
        const reportId = parseInt(btn.dataset.reportId, 10);
        const action = btn.dataset.widgetAction;
        if (action === 'edit') this._editWidget(reportId);
        else if (action === 'remove') this._removeWidget(widgetId);
        else if (action === 'refresh') {
          const w = this.widgets.find(x => x.id === widgetId);
          if (w) this._renderWidgetChart(w, true);
        }
      });
    });

    // Sortable.js 드래그 재배치 (이미 index.html 에서 로드됨)
    if (typeof Sortable !== 'undefined') {
      new Sortable(grid, {
        animation: 150,
        handle: '.rp-widget-drag-handle',
        ghostClass: 'rp-widget-ghost',
        onEnd: () => this._onReorder(),
      });
    }
  },

  _widgetCardHtml(w) {
    return `
      <div class="rp-widget-card" data-widget-id="${w.id}" data-report-id="${w.report_id}">
        <div class="rp-widget-header">
          <div class="rp-widget-drag-handle" title="드래그하여 재배치">⋮⋮</div>
          <div class="rp-widget-title" title="${esc(w.description || '')}">${esc(w.name)}</div>
          <div class="rp-widget-actions">
            <button data-widget-action="refresh" data-widget-id="${w.id}" data-report-id="${w.report_id}" title="새로고침">🔄</button>
            <button data-widget-action="edit" data-widget-id="${w.id}" data-report-id="${w.report_id}" title="리포트 빌더에서 편집">✏️</button>
            <button data-widget-action="remove" data-widget-id="${w.id}" data-report-id="${w.report_id}" title="위젯 제거" class="rp-widget-remove">✕</button>
          </div>
        </div>
        <div class="rp-widget-body">
          <canvas id="rp-widget-canvas-${w.id}"></canvas>
        </div>
        <div class="rp-widget-footer" id="rp-widget-meta-${w.id}">로딩 중...</div>
      </div>
    `;
  },

  // 위젯 차트 렌더 — config_json 으로 빌더 query 실행 후 Chart.js
  async _renderWidgetChart(widget, isRefresh = false) {
    const canvas = document.getElementById(`rp-widget-canvas-${widget.id}`);
    const metaEl = document.getElementById(`rp-widget-meta-${widget.id}`);
    if (!canvas) return;
    try {
      // 기존 차트 destroy
      if (this.widgetCharts[widget.id]) {
        try {
          this.widgetCharts[widget.id].destroy();
        } catch (_) {}
        delete this.widgetCharts[widget.id];
      }
      if (isRefresh && metaEl) metaEl.textContent = '새로고침 중...';

      const cfg =
        typeof widget.config_json === 'string'
          ? JSON.parse(widget.config_json)
          : widget.config_json || {};
      const r = await API.reportBuilder.query(cfg);
      const result = r.data;
      this._drawWidgetChart(canvas, cfg, result);
      if (metaEl) {
        const ds = cfg.datasource || 'leads';
        const dsLabel =
          {
            leads: '영업 리드',
            projects: '프로젝트',
            customers: '고객사',
            activities: '영업 활동',
          }[ds] || ds;
        metaEl.textContent = `${dsLabel} · ${result.rows.length}건 · ${new Date().toLocaleTimeString('ko-KR')}`;
      }
    } catch (err) {
      if (metaEl) metaEl.textContent = `오류: ${err.message || '데이터 로드 실패'}`;
      console.warn('[Widget] 차트 실패:', widget.id, err);
    }
  },

  // 위젯 차트 그리기 (빌더의 _renderChart 단순화 버전 — bar/pie/line만)
  _drawWidgetChart(canvas, cfg, result) {
    const ctx = canvas.getContext('2d');
    const rows = result.rows || [];
    if (rows.length === 0) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.fillText('데이터 없음', canvas.width / 2, canvas.height / 2);
      return;
    }
    const measures = cfg.measures || [];
    const colKey = cfg.columns?.[0];
    const labels = rows.map(r => String(r.row_key ?? '(없음)'));
    const colors = ['#E63329', '#1A73E8', '#34A853', '#FBBC04', '#9C27B0', '#FF6B35'];
    let chartType = cfg.chartType === 'auto' || !cfg.chartType ? 'bar' : cfg.chartType;
    if (chartType === 'pie') chartType = 'doughnut';

    let config;
    if (chartType === 'doughnut') {
      const data = rows.map(r => Number(r[measures[0]] || 0));
      config = {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } },
        },
      };
    } else if (chartType === 'stacked-bar' && colKey) {
      const rowKeys = [...new Set(rows.map(r => String(r.row_key)))];
      const colKeys = [...new Set(rows.map(r => String(r.col_key)))];
      const m = measures[0];
      const pivot = {};
      rowKeys.forEach(rk => {
        pivot[rk] = {};
      });
      rows.forEach(r => {
        pivot[String(r.row_key)][String(r.col_key)] = Number(r[m] || 0);
      });
      config = {
        type: 'bar',
        data: {
          labels: rowKeys,
          datasets: colKeys.map((ck, i) => ({
            label: ck,
            data: rowKeys.map(rk => pivot[rk][ck] || 0),
            backgroundColor: colors[i % colors.length],
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true } },
          plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
        },
      };
    } else {
      // bar / line — 단일/다중 measure 모두 지원
      const datasets = measures.map((m, i) => ({
        label: m,
        data: rows.map(r => Number(r[m] || 0)),
        backgroundColor: colors[i % colors.length],
        borderColor: colors[i % colors.length],
        tension: 0.3,
      }));
      config = {
        type: chartType === 'line' ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
        },
      };
    }
    this.widgetCharts[canvas.id.replace('rp-widget-canvas-', '')] = new Chart(ctx, config);
  },

  // 빌더로 이동 → 해당 리포트 편집
  _editWidget(reportId) {
    // App.navigate 가 hash 사용 — 별도 query string 으로 reportId 전달
    location.hash = `#report-builder?edit=${reportId}&returnTo=reports`;
    if (typeof App !== 'undefined' && App.navigate) {
      App.navigate('report-builder');
    }
  },

  async _removeWidget(widgetId) {
    if (!confirm('이 위젯을 제거하시겠습니까?')) return;
    try {
      await API.reports.widgets.delete(widgetId);
      Toast.success('위젯이 제거되었습니다');
      // 차트 인스턴스 정리
      if (this.widgetCharts[widgetId]) {
        try {
          this.widgetCharts[widgetId].destroy();
        } catch (_) {}
        delete this.widgetCharts[widgetId];
      }
      this.widgets = this.widgets.filter(w => w.id !== widgetId);
      this._renderWidgets();
      // 위젯이 제거되어 차트가 다시 그려져야 함
      await Promise.allSettled(this.widgets.map(w => this._renderWidgetChart(w)));
    } catch (err) {
      Toast.error('위젯 제거 실패: ' + (err.message || ''));
    }
  },

  async _onReorder() {
    const grid = document.getElementById('rp-widgets-grid');
    if (!grid) return;
    const ids = [...grid.querySelectorAll('[data-widget-id]')].map(el =>
      parseInt(el.dataset.widgetId, 10)
    );
    try {
      await API.reports.widgets.reorder(ids);
      // 메모리 widgets 도 동일 순서로 정렬
      const orderMap = new Map(ids.map((id, idx) => [id, idx]));
      this.widgets.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));
    } catch (err) {
      Toast.error('재배치 저장 실패: ' + (err.message || ''));
    }
  },

  // 위젯 추가 모달 — 기존 리포트 선택 or 새로 만들기
  async _openAddWidgetModal() {
    try {
      // 사용자의 저장된 리포트 목록 fetch
      const r = await API.reportBuilder.listSaved();
      const savedReports = r.data || [];
      // 이미 위젯으로 추가된 report_id 표시 (체크박스 비활성)
      const alreadyAdded = new Set(this.widgets.map(w => w.report_id));

      Modal.open({
        title: '⭐ 위젯 추가',
        width: 560,
        body: `
          <p style="font-size:13px;color:var(--text-2);margin:0 0 14px">
            리포트 빌더에서 만든 리포트를 위젯으로 추가하거나, 새 리포트를 만들 수 있습니다.
          </p>
          ${
            savedReports.length === 0
              ? `
            <div style="padding:24px;text-align:center;background:var(--surface-2);border-radius:8px;margin-bottom:14px">
              <div style="font-size:24px;margin-bottom:6px;opacity:0.4">📝</div>
              <div style="font-size:13px;color:var(--text-2)">아직 저장된 리포트가 없습니다.</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:4px">먼저 리포트 빌더에서 리포트를 만들어 보세요.</div>
            </div>
          `
              : `
            <div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--text-2)">📊 기존 리포트에서 추가</div>
            <div class="rp-add-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:14px">
              ${savedReports
                .map(rep => {
                  const disabled = alreadyAdded.has(rep.id);
                  return `
                  <label class="rp-add-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:${disabled ? 'not-allowed' : 'pointer'};border-bottom:1px solid var(--border);opacity:${disabled ? '0.5' : '1'}">
                    <input type="checkbox" name="rp-add-rep" value="${rep.id}" ${disabled ? 'disabled' : ''} style="cursor:${disabled ? 'not-allowed' : 'pointer'}">
                    <div style="flex:1;min-width:0">
                      <div style="font-size:13px;font-weight:600;color:var(--text-1)">${esc(rep.name)}${disabled ? ' <span style="font-size:10px;color:var(--text-3);font-weight:400">(이미 추가됨)</span>' : ''}</div>
                      ${rep.description ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px">${esc(rep.description)}</div>` : ''}
                    </div>
                  </label>
                `;
                })
                .join('')}
            </div>
          `
          }
          <div style="text-align:center;padding-top:10px;border-top:1px dashed var(--border)">
            <button class="btn btn-ghost" id="rp-add-new-btn" style="padding:8px 18px">
              ➕ 새 리포트 만들기 (빌더로 이동)
            </button>
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" id="rp-add-cancel">취소</button>
          ${savedReports.length > 0 ? `<button class="btn btn-primary" id="rp-add-ok">선택한 리포트 추가</button>` : ''}
        `,
        bind: {
          '#rp-add-cancel': () => Modal.close(),
          '#rp-add-new-btn': () => {
            Modal.close();
            // 빌더로 이동 — 저장 후 자동으로 reports 로 돌아오도록 returnTo 표시
            location.hash = '#report-builder?returnTo=reports';
            if (typeof App !== 'undefined' && App.navigate) App.navigate('report-builder');
          },
          '#rp-add-ok': async () => {
            const checked = [...document.querySelectorAll('input[name="rp-add-rep"]:checked')];
            if (checked.length === 0) {
              Toast.warn('하나 이상 선택하세요');
              return;
            }
            const reportIds = checked.map(c => parseInt(c.value, 10));
            try {
              const res = await API.reports.widgets.add({ report_ids: reportIds });
              Toast.success(`${res.data.length}개 위젯이 추가되었습니다`);
              Modal.close();
              await this._loadWidgets();
            } catch (err) {
              Toast.error('위젯 추가 실패: ' + (err.message || ''));
            }
          },
        },
      });
    } catch (err) {
      Toast.error('리포트 목록 로드 실패: ' + (err.message || ''));
    }
  },
};

// 전역 노출 — e2e 테스트 및 다른 페이지에서 ReportsPage._openAddWidgetModal 등 호출 가능
window.ReportsPage = ReportsPage;
