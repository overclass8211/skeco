// ============================================================
// Dashboard Page — AI Insights 포함
// ============================================================
const DashboardPage = {
  monthlyChart: null,
  selectedYear: new Date().getFullYear(),
  selectedPeriod: 'recent6', // annual | quarterly | monthly | recent6

  async render() {
    const curYear = new Date().getFullYear();
    const years = [];
    for (let y = curYear; y >= 2023; y--) years.push(y);

    const html = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-weight:600;font-size:15px;color:var(--text-1)" data-label="dashboard.title">영업 대시보드</div>
        <div class="year-selector" style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--text-3)" data-label="dashboard.year_filter">기준 연도</span>
          <div style="display:flex;gap:4px">
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
        </div>
      </div>

      <div class="metrics-grid" id="dashboard-metrics">
        <div class="metric-card"><div class="metric-label" data-label="common.loading">로딩...</div></div>
      </div>

      <div class="grid-65 mb-3">
        <div class="card">
          <div class="card-header" style="flex-wrap:wrap;gap:8px">
            <div class="card-title" id="monthly-chart-title" style="margin-right:auto" data-label="dashboard.monthly_chart_title">월별 영업기회 추이</div>
            <div style="display:flex;gap:3px;align-items:center">
              ${[
                { key: 'annual', label: '연간' },
                { key: 'quarterly', label: '분기' },
                { key: 'monthly', label: '월간' },
                { key: 'recent6', label: '최근 6개월' },
              ]
                .map(
                  p => `
                <button id="period-btn-${p.key}" data-period="${p.key}"
                  style="padding:3px 9px;border-radius:var(--radius);border:1px solid var(--border-2);
                         background:${p.key === 'recent6' ? 'var(--blue)' : 'var(--bg-2)'};
                         color:${p.key === 'recent6' ? '#fff' : 'var(--text-2)'};
                         font-size:11px;cursor:pointer;font-weight:${p.key === 'recent6' ? '600' : '400'};
                         white-space:nowrap">
                  ${p.label}
                </button>`
                )
                .join('')}
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="badge badge-amber">● <span data-label="business.solar">태양광</span></span>
              <span class="badge badge-blue">● <span data-label="business.electric">전기</span>/<span data-label="business.ess">ESS</span></span>
            </div>
          </div>
          <div class="card-body"><div class="chart-wrap"><canvas id="chart-monthly"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title" data-label="dashboard.funnel_title">파이프라인 단계별 현황</div></div>
          <div class="card-body" id="funnel-body"><div class="loading" data-label="common.loading">로딩...</div></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title" data-label="dashboard.recent_activities">최근 영업 활동</div>
            <button class="btn btn-ghost btn-sm" id="dash-pipeline-btn" data-label="topbar.see_all">전체보기</button>
          </div>
          <div class="card-body no-pad" id="activities-body"><div class="loading" data-label="common.loading">로딩...</div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title" data-label="dashboard.ai_insights">🤖 AI 인사이트</div>
            <button class="ai-gen-btn" id="dash-ai-refresh-btn">
              <svg viewBox="0 0 16 16" fill="currentColor" width="11"><path d="M8 3a5 5 0 100 10A5 5 0 008 3zM1 8a7 7 0 1114 0A7 7 0 011 8z"/><path d="M8 5v3l2 1-1 1.73L7 9V5h1z"/></svg>
              <span data-label="dashboard.ai_analyze">AI 분석</span>
            </button>
          </div>
          <div class="card-body no-pad" id="insights-body">
            <div class="loading" data-label="dashboard.ai_loading">AI 인사이트 로딩중...</div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // year buttons delegation
    document.querySelector('.year-selector')?.addEventListener('click', e => {
      const btn = e.target.closest('.year-btn[data-year]');
      if (btn) this.changeYear(parseInt(btn.dataset.year));
    });
    // period buttons delegation
    document.querySelector('.card-header')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-period]');
      if (btn) this.changePeriod(btn.dataset.period);
    });
    document
      .getElementById('dash-pipeline-btn')
      ?.addEventListener('click', () => App.navigate('pipeline'));
    document
      .getElementById('dash-ai-refresh-btn')
      ?.addEventListener('click', () => this.refreshAIInsights());

    await this.loadData();
  },

  async changeYear(year) {
    this.selectedYear = year;
    document.querySelectorAll('.year-btn').forEach(btn => {
      const btnYear = parseInt(btn.textContent.trim());
      btn.style.background = btnYear === year ? 'var(--blue)' : 'var(--bg-2)';
      btn.style.color = btnYear === year ? '#fff' : 'var(--text-2)';
      btn.style.fontWeight = btnYear === year ? '600' : '400';
    });
    document.getElementById('dashboard-metrics').innerHTML =
      '<div class="metric-card"><div class="metric-label">로딩...</div></div>';
    document.getElementById('funnel-body').innerHTML = '<div class="loading">로딩...</div>';
    document.getElementById('activities-body').innerHTML = '<div class="loading">로딩...</div>';
    await this.loadData();
  },

  async changePeriod(period) {
    this.selectedPeriod = period;
    const periodMeta = {
      annual: '연간',
      quarterly: '분기별',
      monthly: '월간',
      recent6: '최근 6개월',
    };
    // 버튼 스타일 업데이트
    Object.keys(periodMeta).forEach(k => {
      const btn = document.getElementById('period-btn-' + k);
      if (!btn) return;
      btn.style.background = k === period ? 'var(--blue)' : 'var(--bg-2)';
      btn.style.color = k === period ? '#fff' : 'var(--text-2)';
      btn.style.fontWeight = k === period ? '600' : '400';
    });
    // 차트만 리로드
    try {
      const res = await API.dashboard.monthly(this.selectedYear, period);
      this.renderMonthlyChart(res.data, this.selectedYear, period);
    } catch (err) {
      console.error(err);
    }
  },

  async loadData() {
    try {
      const y = this.selectedYear;
      const p = this.selectedPeriod;
      const [stats, funnel, monthly, activities] = await Promise.all([
        API.dashboard.stats(y),
        API.dashboard.funnel(y),
        API.dashboard.monthly(y, p),
        API.dashboard.activities(y),
      ]);
      this.renderMetrics(stats.data);
      this.renderFunnel(funnel.data);
      this.renderMonthlyChart(monthly.data, y, p);
      this.renderActivities(activities.data);
      this.loadAIInsights();
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  },

  // sessionStorage 캐시 — 30분 유효 (AI 토큰 절약 + 429 회피)
  AI_INSIGHTS_CACHE_KEY: 'oci_ai_insights_cache',
  AI_INSIGHTS_CACHE_TTL: 30 * 60 * 1000,

  _readAIInsightsCache() {
    try {
      const raw = sessionStorage.getItem(this.AI_INSIGHTS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.at || Date.now() - parsed.at > this.AI_INSIGHTS_CACHE_TTL) return null;
      return parsed;
    } catch {
      return null;
    }
  },
  _writeAIInsightsCache(text) {
    try {
      sessionStorage.setItem(this.AI_INSIGHTS_CACHE_KEY, JSON.stringify({ at: Date.now(), text }));
    } catch {
      /* ignore */
    }
  },

  async loadAIInsights(forceRefresh = false) {
    const el = document.getElementById('insights-body');
    if (!el) return;

    // 1) 캐시 우선 (forceRefresh 가 아닐 때)
    if (!forceRefresh) {
      const cached = this._readAIInsightsCache();
      if (cached) {
        this.renderAIInsights(cached.text, { cached: true, at: cached.at });
        return;
      }
    }

    // 2) API 호출 — 실패 시 정적 fallback (429 도 포함)
    try {
      const res = await API.ai.insights();
      if (res?.data) {
        this._writeAIInsightsCache(res.data);
        this.renderAIInsights(res.data);
      } else {
        this.renderStaticInsights();
      }
    } catch (err) {
      // 429 또는 토큰 초과 — 친절한 메시지 + 캐시 fallback
      const msg = String(err?.message || '');
      const isQuota = msg.includes('429') || msg.includes('한도') || msg.includes('Too Many');
      const cached = this._readAIInsightsCache();
      if (cached) {
        this.renderAIInsights(cached.text, { cached: true, at: cached.at, fallback: true });
      } else {
        this.renderStaticInsights(
          isQuota
            ? '🔋 AI 토큰 한도 초과 — 캐시된 분석이 없습니다. 잠시 후 새로고침해 주세요.'
            : null
        );
      }
    }
  },

  async refreshAIInsights() {
    const el = document.getElementById('insights-body');
    if (el) el.innerHTML = '<div class="loading">AI 분석 중...</div>';
    await this.loadAIInsights(true); // 강제 새로고침
  },

  renderAIInsights(text, opts = {}) {
    const el = document.getElementById('insights-body');
    if (!el) return;
    if (!text) {
      this.renderStaticInsights();
      return;
    }

    const lines = text.split('\n').filter(l => l.trim());
    const icons = {
      긴급: { ico: '🚨', cls: 'urgent' },
      주의: { ico: '⚠️', cls: 'warning' },
      정보: { ico: 'ℹ️', cls: 'info' },
    };

    // 캐시 표시 배너 (옵션)
    const cacheBanner = opts.cached
      ? `
      <div style="padding:6px 14px;font-size:11px;color:var(--text-3);background:var(--surface-2);border-bottom:1px solid var(--border)">
        ⚡ 캐시된 분석 · ${Math.round((Date.now() - opts.at) / 60000)}분 전
        ${opts.fallback ? '<span style="color:var(--oci-red)">(API 한도 초과로 fallback)</span>' : ''}
      </div>`
      : '';

    const items = lines
      .map(line => {
        let tag = 'info',
          ico = '📊';
        const content = line.replace(/^\[.*?\]\s*/, '');
        const m = line.match(/^\[(긴급|주의|정보)\]/);
        if (m && icons[m[1]]) {
          tag = icons[m[1]].cls;
          ico = icons[m[1]].ico;
        }
        return `
        <div class="ai-insight-item">
          <div class="insight-icon">${ico}</div>
          <div class="ai-insight-body">
            <span class="ai-insight-tag ${tag}">${tag === 'urgent' ? '긴급' : tag === 'warning' ? '주의' : '정보'}</span>
            <div class="ai-insight-text">${esc(content)}</div>
          </div>
        </div>`;
      })
      .join('');

    el.innerHTML =
      cacheBanner +
      items +
      `
      <div style="padding:10px 14px;border-top:1px solid var(--border)">
        <button class="ai-gen-btn" id="dash-weekly-report-btn" style="width:100%;justify-content:center">
          📊 주간 보고서 생성하기
        </button>
      </div>`;
    document.getElementById('dash-weekly-report-btn')?.addEventListener('click', () => {
      AI.open();
      AI.streamReport('weekly');
    });
  },

  renderStaticInsights(banner) {
    const el = document.getElementById('insights-body');
    if (!el) return;
    const bannerHtml = banner
      ? `
      <div style="padding:8px 14px;font-size:11px;color:var(--text-3);background:var(--surface-2);border-bottom:1px solid var(--border)">
        ${esc(banner)}
      </div>`
      : '';
    el.innerHTML =
      bannerHtml +
      `
      <div class="ai-insight-item">
        <div class="insight-icon">⚠️</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag warning">주의</span>
          <div class="ai-insight-text">원가 변동 알림 — 폴리실리콘 +7.15% 상승, 견적 재검토 필요</div>
        </div>
      </div>
      <div class="ai-insight-item">
        <div class="insight-icon">🚨</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag urgent">긴급</span>
          <div class="ai-insight-text">입찰 마감 임박 — 한국동서발전 30MW EPC 입찰 진행중</div>
        </div>
      </div>
      <div class="ai-insight-item">
        <div class="insight-icon">🌍</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag info">정보</span>
          <div class="ai-insight-text">해외 신규 리드 — VPL Corp 50MW · ReNew Power 200MW 진행중</div>
        </div>
      </div>
      <div style="padding:10px 14px;border-top:1px solid var(--border)">
        <button class="ai-gen-btn" id="dash-ai-open-btn" style="width:100%;justify-content:center">
          💬 AI 어시스턴트 열기
        </button>
      </div>`;
    document.getElementById('dash-ai-open-btn')?.addEventListener('click', () => AI.open());
  },

  renderMetrics(d) {
    const L = (k, fb) => (typeof Labels !== 'undefined' ? Labels.get(k, fb) : fb);
    const unitCount = L('units.count', '건');
    const newOppLabel = L('dashboard.new_opportunities', '신규 영업기회');
    const pipeLabel = L('dashboard.year_pipeline', '파이프라인');
    const wonLabel = L('dashboard.year_won', '수주 금액');
    const cumulativeLabel = L('dashboard.year_cumulative', '누적');
    const biddingLabel = L('dashboard.bidding', '입찰 진행');
    const biddingStageLabel = L('dashboard.bidding_stage', '입찰 단계 리드');
    const winRateLabel = L('dashboard.year_win_rate', '수주율');
    const winVsTotal = L('dashboard.win_vs_total', '전체 리드 대비 수주');
    const regionDomestic = L('region.domestic', '국내');
    const regionOverseas = L('region.overseas', '해외');

    document.getElementById('dashboard-metrics').innerHTML = `
      <div class="metric-card" style="--metric-color:#1664E5">
        <div class="metric-label">${d.year} · ${newOppLabel}</div>
        <div class="metric-value">${d.monthlyNew}<span class="metric-value-suffix">${unitCount}</span></div>
        <div class="metric-sub">${pipeLabel} ${regionDomestic} ${d.domestic} / ${regionOverseas} ${d.overseas}</div>
      </div>
      <div class="metric-card" style="--metric-color:#F59C00">
        <div class="metric-label">${d.year} · ${pipeLabel}</div>
        <div class="metric-value">${d.totalLeads}<span class="metric-value-suffix">${unitCount}</span></div>
        <div class="metric-sub">${biddingLabel} ${d.bidding}${unitCount}</div>
      </div>
      <div class="metric-card" style="--metric-color:#17A85A">
        <div class="metric-label">${d.year} · ${wonLabel}</div>
        <div class="metric-value" style="font-size:18px">${Fmt.amount(d.wonAmount)}</div>
        <div class="metric-sub">${d.year} · ${cumulativeLabel}</div>
      </div>
      <div class="metric-card" style="--metric-color:#E63329">
        <div class="metric-label">${biddingLabel}</div>
        <div class="metric-value">${d.bidding}<span class="metric-value-suffix">${unitCount}</span></div>
        <div class="metric-sub">${biddingStageLabel}</div>
      </div>
      <div class="metric-card" style="--metric-color:#7C4DFF">
        <div class="metric-label">${d.year} · ${winRateLabel}</div>
        <div class="metric-value">${d.winRate}<span class="metric-value-suffix">%</span></div>
        <div class="metric-sub">${winVsTotal}</div>
      </div>
    `;
  },

  renderFunnel(data) {
    const stageOrder = ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won'];
    const max = Math.max(...data.map(d => d.count), 1);
    const L = (k, fb) => (typeof Labels !== 'undefined' ? Labels.get(k, fb) : fb);
    const unitCount = L('units.count', '건');
    document.getElementById('funnel-body').innerHTML = stageOrder
      .map(stage => {
        const item = data.find(d => d.stage === stage) || { count: 0, amount: 0 };
        const meta = STAGES[stage] || { label: stage, color: '#ccc' };
        const stageLabel = L('stages.' + stage, meta.label);
        return `
        <div class="funnel-row">
          <div class="funnel-label">
            <span>${stageLabel}</span><strong>${item.count}${unitCount}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${(item.count / max) * 100}%;background:${meta.color}"></div>
          </div>
        </div>`;
      })
      .join('');
  },

  renderMonthlyChart(data, year, period) {
    const SOLAR = ['태양광', '모듈', 'EPC'];
    const ELEC = ['ESS', '전기', '설치'];
    const titleEl = document.getElementById('monthly-chart-title');
    let labels, solarData, elecData;

    if (period === 'annual') {
      // 연도별: x축 = 연도 목록
      const years = [...new Set(data.map(d => d.yr))].sort();
      labels = years.map(y => `${y}년`);
      solarData = years.map(y =>
        data
          .filter(d => d.yr === y && SOLAR.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      elecData = years.map(y =>
        data
          .filter(d => d.yr === y && ELEC.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      if (titleEl) titleEl.textContent = '연도별 영업기회 추이';
    } else if (period === 'quarterly') {
      // 분기별: x축 = Q1~Q4
      labels = ['Q1', 'Q2', 'Q3', 'Q4'];
      solarData = labels.map(q =>
        data
          .filter(d => d.qtr === q && SOLAR.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      elecData = labels.map(q =>
        data
          .filter(d => d.qtr === q && ELEC.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      if (titleEl) titleEl.textContent = `${year}년 분기별 영업기회 추이`;
    } else if (period === 'monthly') {
      // 월간: 선택 연도 12개월
      const months = Array.from({ length: 12 }, (_, i) => ({
        key: `${year}-${String(i + 1).padStart(2, '0')}`,
        label: `${i + 1}월`,
      }));
      labels = months.map(m => m.label);
      solarData = months.map(m =>
        data
          .filter(d => d.month === m.key && SOLAR.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      elecData = months.map(m =>
        data
          .filter(d => d.month === m.key && ELEC.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      if (titleEl) titleEl.textContent = `${year}년 월간 영업기회 추이`;
    } else {
      // recent6: 현재 기준 최근 6개월
      const now = new Date();
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return {
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: `${d.getMonth() + 1}월`,
        };
      });
      labels = months.map(m => m.label);
      solarData = months.map(m =>
        data
          .filter(d => d.month === m.key && SOLAR.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      elecData = months.map(m =>
        data
          .filter(d => d.month === m.key && ELEC.includes(d.business_type))
          .reduce((s, d) => s + d.count, 0)
      );
      if (titleEl) titleEl.textContent = '영업기회 추이 (최근 6개월)';
    }

    const ctx = document.getElementById('chart-monthly');
    if (this.monthlyChart) this.monthlyChart.destroy();
    this.monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '태양광/EPC', data: solarData, backgroundColor: '#F59C00', borderRadius: 4 },
          { label: '전기/ESS', data: elecData, backgroundColor: '#1664E5', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              footer: items => {
                const total = items.reduce((s, i) => s + i.raw, 0);
                return `합계: ${total}건`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { color: '#E8EAED' },
            ticks: { font: { size: 11 }, stepSize: 1 },
            beginAtZero: true,
          },
        },
      },
    });
  },

  renderActivities(activities) {
    const el = document.getElementById('activities-body');
    if (!activities.length) {
      const emptyMsg =
        typeof Labels !== 'undefined'
          ? Labels.get('dashboard.no_activities', '최근 활동 없음')
          : '최근 활동 없음';
      el.innerHTML = `<div class="empty" data-label="dashboard.no_activities">${emptyMsg}</div>`;
      return;
    }
    const iconMap = {
      미팅: '🤝',
      전화: '📞',
      이메일: '✉️',
      제안서: '📋',
      입찰: '📑',
      수주: '🏆',
      드롭: '❌',
      기타: '📌',
      note: '📝',
      meeting: '🤝',
      call: '📞',
      email: '✉️',
      proposal: '📋',
      site_visit: '🏗',
    };
    const bgMap = {
      미팅: 'var(--blue-light)',
      전화: 'var(--amber-light)',
      이메일: 'var(--blue-light)',
      수주: 'var(--green-light)',
      드롭: 'var(--red-light)',
      기타: 'var(--gray-light)',
    };
    el.innerHTML = activities
      .slice(0, 6)
      .map(
        a => `
      <div class="insight-item">
        <div class="insight-icon" style="background:${bgMap[a.activity_type] || 'var(--gray-light)'}">${iconMap[a.activity_type] || '📌'}</div>
        <div style="flex:1">
          <div class="insight-title">${esc(a.title)}</div>
          <div class="insight-text">${a.customer_name ? esc(a.customer_name) + ' · ' : ''}담당: ${esc(a.performer_name || '-')} · ${Fmt.relTime(a.performed_at)}</div>
        </div>
      </div>`
      )
      .join('');
  },
};
