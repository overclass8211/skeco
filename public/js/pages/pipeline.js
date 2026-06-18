// ============================================================
// Pipeline Page (Kanban with drag & drop)
// ============================================================
const PipelinePage = {
  filters: {
    search: '',
    region: '',
    business_type: '',
    assigned_to: '',
    date_field: 'stage',
    date_from: '',
    date_to: '',
  },
  team: [],

  async render() {
    const html = `
      <div class="filter-bar">
        <input type="text" class="search-input" id="pipe-search" placeholder="고객사, 프로젝트명 검색...">
        <select class="filter-select" id="pipe-region">
          <option value="">전체 지역</option>
          <option value="국내">국내</option>
          <option value="해외">해외</option>
        </select>
        <select class="filter-select" id="pipe-business">
          <option value="">전체 사업</option>
          <option value="태양광">태양광</option>
          <option value="모듈">모듈</option>
          <option value="EPC">EPC</option>
          <option value="ESS">ESS</option>
          <option value="전기">전기</option>
          <option value="설치">설치</option>
        </select>
        <select class="filter-select" id="pipe-assigned">
          <option value="">전체 담당자</option>
        </select>
        <div style="margin-left:auto;display:flex;align-items:center;gap:12px">
          <button class="btn btn-ghost btn-sm" id="pipe-export-btn"
            data-feature="data.excel_exp"
            title="현재 필터 결과를 엑셀 파일로 다운로드">
            📤 엑셀 다운로드
          </button>
          <button class="btn btn-primary" id="pipe-add-lead-btn">+ 리드 추가</button>
        </div>
      </div>

      <!-- 기간 필터 바 -->
      <div class="pipe-date-bar" id="pipe-date-bar">
        <span class="pipe-date-label">기간 기준</span>
        <div class="pipe-date-mode-wrap">
          <button class="pipe-date-mode-btn active" data-mode="stage"   id="pipe-mode-stage">단계변경일</button>
          <button class="pipe-date-mode-btn"        data-mode="created" id="pipe-mode-created">등록일</button>
        </div>
        <div class="pipe-date-range">
          <input type="date" class="pipe-date-input" id="pipe-date-from" title="시작일">
          <span class="pipe-date-sep">~</span>
          <input type="date" class="pipe-date-input" id="pipe-date-to"   title="종료일">
          <button class="pipe-date-clear-btn" id="pipe-date-clear" title="날짜 초기화">✕</button>
        </div>
        <span class="pipe-date-hint" id="pipe-date-hint"></span>
      </div>

      <div class="card mb-3">
        <div class="card-body" style="padding:12px 16px">
          <div class="flex gap-4" style="align-items:center">
            <div>
              <div class="fs-11 text-muted">파이프라인 총액</div>
              <div style="font-size:20px;font-weight:700" class="mono" id="pipe-total">₩0억</div>
            </div>
            <div class="flex-1">
              <div class="flex gap-2 fs-11 text-muted">
                <span>💡 칸반 카드를 드래그하여 단계를 변경할 수 있습니다</span>
              </div>
            </div>
            <div class="text-right">
              <div class="fs-11 text-muted">진행 건수</div>
              <div style="font-size:20px;font-weight:700" id="pipe-active-count">0</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 파이프라인 단계별 헬스체크 (스트림 시각화 + AI 코칭) -->
      <div class="card mb-3 pipe-funnel-card">
        <div class="card-body" style="padding:18px 22px 20px">
          <div class="pipe-funnel-header">
            <div>
              <div class="pipe-funnel-title">📊 파이프라인 헬스체크</div>
              <div class="pipe-funnel-subtitle">단계 클릭 시 AI가 진단·코칭합니다</div>
            </div>
            <div class="pipe-funnel-legend">
              <span class="lgd-item"><i class="lgd-dot" style="background:#17A85A"></i>정상</span>
              <span class="lgd-item"><i class="lgd-dot" style="background:#F59C00"></i>주의 7일+</span>
              <span class="lgd-item"><i class="lgd-dot" style="background:#E63329"></i>정체 14일+</span>
            </div>
          </div>
          <div id="pipe-funnel" class="pipe-funnel">
            <div style="text-align:center;color:var(--text-3);font-size:12px;padding:24px">불러오는 중...</div>
          </div>
        </div>
      </div>

      <div class="kanban-board" id="kanban-board">
        <div class="loading">로딩중...</div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // 팀원 로드
    const team = await API.team.list();
    this.team = team.data;
    const sel = document.getElementById('pipe-assigned');
    sel.innerHTML =
      '<option value="">전체 담당자</option>' +
      this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    // button listeners
    document.getElementById('pipe-export-btn')?.addEventListener('click', () => this.exportExcel());
    document
      .getElementById('pipe-add-lead-btn')
      ?.addEventListener('click', () => App.openLeadForm());

    // ── 기존 필터 이벤트 ────────────────────────────────────
    document.getElementById('pipe-search').addEventListener(
      'input',
      debounce(e => {
        this.filters.search = e.target.value;
        this.loadData();
      }, 300)
    );
    ['pipe-region', 'pipe-business', 'pipe-assigned'].forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        const key = id
          .replace('pipe-', '')
          .replace('region', 'region')
          .replace('business', 'business_type')
          .replace('assigned', 'assigned_to');
        this.filters[key] = e.target.value;
        this.loadData();
      });
    });

    // ── 기간 필터 이벤트 ─────────────────────────────────────
    // 기준 토글 (단계변경일 / 등록일)
    document.querySelectorAll('.pipe-date-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pipe-date-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filters.date_field = btn.dataset.mode;
        this._updateDateHint();
        if (this.filters.date_from || this.filters.date_to) this.loadData();
      });
    });

    // 날짜 입력
    document.getElementById('pipe-date-from').addEventListener('change', e => {
      this.filters.date_from = e.target.value;
      this._updateDateHint();
      this.loadData();
    });
    document.getElementById('pipe-date-to').addEventListener('change', e => {
      this.filters.date_to = e.target.value;
      this._updateDateHint();
      this.loadData();
    });

    // 초기화 버튼
    document.getElementById('pipe-date-clear').addEventListener('click', () => {
      this.filters.date_from = '';
      this.filters.date_to = '';
      document.getElementById('pipe-date-from').value = '';
      document.getElementById('pipe-date-to').value = '';
      this._updateDateHint();
      this.loadData();
    });

    await this.loadData();
  },

  // 날짜 힌트 텍스트 업데이트 (필터 적용 상태 표시)
  _updateDateHint() {
    const hint = document.getElementById('pipe-date-hint');
    if (!hint) return;
    const { date_from, date_to, date_field } = this.filters;
    const modeLabel = date_field === 'created' ? '등록일' : '단계변경일';
    if (date_from || date_to) {
      const from = date_from || '시작';
      const to = date_to || '현재';
      hint.textContent = `${modeLabel} ${from} ~ ${to} 필터 적용 중`;
      hint.style.display = 'inline';
      document.getElementById('pipe-date-bar').classList.add('active');
    } else {
      hint.textContent = '';
      hint.style.display = 'none';
      document.getElementById('pipe-date-bar').classList.remove('active');
    }
  },

  async loadData() {
    try {
      const result = await API.leads.list(this.filters);
      this.renderBoard(result.data);
    } catch (err) {
      console.error(err);
    }
  },

  renderBoard(leads) {
    const stages = ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won', 'dropped'];
    const grouped = {};
    stages.forEach(s => (grouped[s] = []));
    leads.forEach(l => {
      if (grouped[l.stage]) grouped[l.stage].push(l);
    });

    // 통계 — amount_krw 통합 합계 (다국가 통화 환산)
    const activeStages = ['lead', 'review', 'proposal', 'bidding', 'negotiation'];
    const activeCount = leads.filter(l => activeStages.includes(l.stage)).length;
    const totalAmount = leads
      .filter(l => activeStages.includes(l.stage))
      .reduce((sum, l) => {
        // amount_krw 우선, 없으면 currency='KRW'인 경우만 fallback
        const krw =
          l.amount_krw !== null && l.amount_krw !== undefined
            ? Number(l.amount_krw)
            : l.currency === 'KRW'
              ? Number(l.expected_amount || 0)
              : 0;
        return sum + krw;
      }, 0);
    // 환산 합계는 원 단위이므로 Fmt.krw 사용
    document.getElementById('pipe-total').textContent = Fmt.krw(totalAmount);
    document.getElementById('pipe-active-count').textContent = activeCount;

    // 파이프라인 헬스체크 (깔대기 시각화)
    this.renderFunnel(grouped);

    // 칸반 컬럼
    const board = document.getElementById('kanban-board');
    board.innerHTML = stages
      .map(stage => {
        const meta = STAGES[stage];
        const items = grouped[stage] || [];
        return `
        <div class="kanban-col" style="--col-color:${meta.color}" data-stage="${stage}">
          <div class="kanban-col-header">
            <div class="kanban-col-title">${meta.label}</div>
            <div class="kanban-count">${items.length}</div>
          </div>
          <div class="kanban-cards">
            ${items.map(l => this.renderCard(l)).join('')}
          </div>
        </div>
      `;
      })
      .join('');

    // 드래그앤드롭 바인딩
    this.bindDragDrop();
  },

  // ── 파이프라인 헬스체크 (세련된 cubic bezier 스트림 + AI 코칭) ─
  renderFunnel(grouped) {
    const funnelEl = document.getElementById('pipe-funnel');
    if (!funnelEl) return;

    const flowStages = ['lead', 'review', 'proposal', 'bidding', 'negotiation'];
    const now = Date.now();
    const DAY = 86400000;

    const analyze = (cards = []) => {
      if (!cards.length) return { cnt: 0, sum: 0, stuck7: 0, stuck14: 0, avgAge: 0 };
      let sum = 0,
        stuck7 = 0,
        stuck14 = 0,
        ageSum = 0;
      cards.forEach(c => {
        // KRW 환산 합계 (amount_krw 우선)
        sum +=
          c.amount_krw !== null && c.amount_krw !== undefined
            ? Number(c.amount_krw)
            : c.currency === 'KRW'
              ? Number(c.expected_amount || 0)
              : 0;
        const t = new Date(c.updated_at || c.created_at).getTime();
        const ageDays = Math.floor((now - t) / DAY);
        ageSum += ageDays;
        if (ageDays >= 14) stuck14++;
        else if (ageDays >= 7) stuck7++;
      });
      return { cnt: cards.length, sum, stuck7, stuck14, avgAge: Math.round(ageSum / cards.length) };
    };

    const stageData = flowStages.map(s => ({
      stage: s,
      meta: STAGES[s],
      ...analyze(grouped[s] || []),
    }));
    const wonData = analyze(grouped['won'] || []);
    const droppedData = analyze(grouped['dropped'] || []);
    const maxCnt = Math.max(1, ...stageData.map(s => s.cnt));

    // ⚠️ 시간 기반 진정한 전환율 — funnel 누적 도달 방식 (AI 코칭과 동일)
    // 단계 i의 누적 도달 = i 단계 + 이후 단계(won 포함) cnt 합
    // 전환율(i → i+1) = i+1의 누적 / i의 누적 (항상 0~100%)
    const funnelStagesWithWon = [...flowStages, 'won'];
    const reached = {};
    for (let i = 0; i < funnelStagesWithWon.length; i++) {
      let sum = 0;
      for (let j = i; j < funnelStagesWithWon.length; j++) {
        sum += (grouped[funnelStagesWithWon[j]] || []).length;
      }
      reached[funnelStagesWithWon[i]] = sum;
    }
    const conv = i => {
      // i 와 i+1 모두 flowStages 또는 won 까지의 흐름
      const from = funnelStagesWithWon[i];
      const to = funnelStagesWithWon[i + 1];
      if (!from || !to || reached[from] === 0) return null;
      return Math.round((reached[to] / reached[from]) * 100);
    };

    // SVG 좌표계
    const VB_W = 1200,
      VB_H = 220;
    const CY = VB_H / 2;
    const MAX_HALF = 70;
    const MIN_R = 0.12;
    const N = flowStages.length;
    const SW = VB_W / N;
    const halfH = c => Math.max(MIN_R, c / maxCnt) * MAX_HALF;

    // 단계별 cubic bezier path (부드러운 스트림)
    const streams = stageData.map((s, i) => {
      const leftCnt = i === 0 ? s.cnt : stageData[i - 1].cnt;
      const rightCnt = s.cnt;
      const xL = i * SW + 2; // 단계 사이 2px gap
      const xR = (i + 1) * SW - 2;
      const hL = halfH(leftCnt);
      const hR = halfH(rightCnt);
      const topL = CY - hL,
        topR = CY - hR;
      const botL = CY + hL,
        botR = CY + hR;
      const cx1 = xL + (xR - xL) * 0.5;
      const cx2 = xR - (xR - xL) * 0.5;
      // 좌상 → 우상 (cubic) → 우하 → 좌하 (cubic) → close
      const d = `M ${xL} ${topL}
                 C ${cx1} ${topL}, ${cx2} ${topR}, ${xR} ${topR}
                 L ${xR} ${botR}
                 C ${cx2} ${botR}, ${cx1} ${botL}, ${xL} ${botL} Z`;
      return { ...s, d, xL, xR, hR };
    });

    // 그라데이션 + 글로우 필터
    const defs = `
      <defs>
        ${streams
          .map(
            p => `
          <linearGradient id="strm-${p.stage}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="${p.meta.color}" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="${p.meta.color}" stop-opacity="0.42"/>
          </linearGradient>
          <linearGradient id="strm-hl-${p.stage}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#fff" stop-opacity="0.55"/>
            <stop offset="60%"  stop-color="#fff" stop-opacity="0"/>
          </linearGradient>`
          )
          .join('')}
        <filter id="softShadow" x="-10%" y="-20%" width="120%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
          <feOffset dx="0" dy="2"/>
          <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>`;

    // 스트림 + 위 highlight
    const svgStreams = streams
      .map(
        p => `
      <g class="pf-stream" data-stage="${p.stage}" filter="url(#softShadow)">
        <path d="${p.d}" fill="url(#strm-${p.stage})" stroke="${p.meta.color}" stroke-width="1.2" stroke-opacity="0.6"/>
        <path d="${p.d}" fill="url(#strm-hl-${p.stage})" opacity="0.9"/>
      </g>`
      )
      .join('');

    // hit areas
    const hitAreas = streams
      .map(
        (p, i) => `
      <rect class="pf-hit" data-stage="${p.stage}" data-idx="${i}"
            x="${i * SW}" y="0" width="${SW}" height="${VB_H}"
            fill="transparent" style="cursor:pointer"/>`
      )
      .join('');

    // 결과 (수주/드롭) - 더 세련된 표시
    const resultHtml = `
      <div class="pf-result">
        <div class="pf-result-item won" style="--clr:${STAGES.won.color}">
          <div class="pf-result-icon">🏆</div>
          <div class="pf-result-text">
            <div class="pf-result-label">수주 완료</div>
            <div class="pf-result-meta"><strong>${wonData.cnt}</strong>건 · ${wonData.sum > 0 ? Fmt.krw(wonData.sum) : '—'}</div>
          </div>
        </div>
        <div class="pf-result-item dropped" style="--clr:${STAGES.dropped.color}">
          <div class="pf-result-icon">⬇️</div>
          <div class="pf-result-text">
            <div class="pf-result-label">드롭</div>
            <div class="pf-result-meta"><strong>${droppedData.cnt}</strong>건</div>
          </div>
        </div>
      </div>`;

    // 카드 오버레이 (HTML absolute) — 단계 라벨/건수/금액
    const cardsHtml = streams
      .map((p, i) => {
        const s = stageData[i];
        const sumLabel = s.sum > 0 ? Fmt.krw(s.sum) : '—';
        const health = s.stuck14 > 0 ? 'critical' : s.stuck7 > 0 ? 'warn' : 'ok';
        const healthColor =
          health === 'critical' ? '#E63329' : health === 'warn' ? '#F59C00' : '#17A85A';
        // 좌측 % 기반
        const leftPct = ((i + 0.5) / N) * 100;
        return `
        <div class="pf-card" data-stage="${p.stage}" style="left:${leftPct}%;--accent:${p.meta.color}">
          <div class="pf-card-head">
            <span class="pf-card-name">${p.meta.label}</span>
            <span class="pf-card-health" style="background:${healthColor}" title="${health === 'ok' ? '정상' : health === 'warn' ? '7일+ 주의 ' + s.stuck7 + '건' : '14일+ 정체 ' + s.stuck14 + '건'}"></span>
          </div>
          <div class="pf-card-cnt">${s.cnt}</div>
          <div class="pf-card-sum">${sumLabel}</div>
          ${s.cnt > 0 ? `<div class="pf-card-age">⏱ 평균 ${s.avgAge}일</div>` : ''}
        </div>`;
      })
      .join('');

    // 전환율 캡슐 (단계 사이 absolute) — 누적 도달 기반 (항상 0~100%)
    const ratesHtml = streams
      .slice(0, -1)
      .map((p, i) => {
        const rate = conv(i);
        if (rate === null) return '';
        const tier = rate < 30 ? 'low' : rate < 60 ? 'mid' : 'high';
        const leftPct = ((i + 1) / N) * 100;
        const fromKey = funnelStagesWithWon[i];
        const toKey = funnelStagesWithWon[i + 1];
        const fromLabel = STAGES[fromKey]?.label || fromKey;
        const toLabel = STAGES[toKey]?.label || toKey;
        const fromReached = reached[fromKey] || 0;
        const toReached = reached[toKey] || 0;
        return `
        <div class="pf-rate pf-rate-${tier}" style="left:${leftPct}%"
             title="${fromLabel}을 거친 ${fromReached}건 중 ${toLabel} 이상 도달 ${toReached}건">
          <div class="pf-rate-label">전환율</div>
          <div class="pf-rate-pct">${rate}%</div>
        </div>`;
      })
      .join('');

    funnelEl.innerHTML = `
      <div class="pf-wrap">
        <svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none"
             width="100%" style="height:220px;display:block">
          ${defs}
          ${svgStreams}
          ${hitAreas}
        </svg>
        <div class="pf-overlay">
          ${cardsHtml}
          ${ratesHtml}
        </div>
      </div>
      ${resultHtml}
    `;

    // ── 인터랙션 ────────────────────────────────────────────
    const handleClick = stage => this.openStageCoach(stage, stageData);
    funnelEl.querySelectorAll('.pf-hit').forEach(el => {
      el.addEventListener('click', () => handleClick(el.dataset.stage));
    });
    funnelEl.querySelectorAll('.pf-card').forEach(el => {
      el.addEventListener('click', () => handleClick(el.dataset.stage));
    });
  },

  // ── 단계 클릭 → AI 헬스 코칭 모달 ─────────────────────────────
  async openStageCoach(stage, stageData) {
    const meta = STAGES[stage];
    const stat = stageData.find(s => s.stage === stage);
    const statusColors = { 정상: '#17A85A', 주의: '#F59C00', 시급: '#E63329' };

    Modal.open({
      title: `${meta.label} — AI 헬스 코칭`,
      compact: true,
      width: 720,
      body: `
        <div class="stage-coach">
          <!-- 통계 요약 -->
          <div class="sc-stats" style="border-left:3px solid ${meta.color}">
            <div class="sc-stat">
              <div class="sc-stat-label">현재 단계 딜</div>
              <div class="sc-stat-val">${stat?.cnt || 0}건</div>
            </div>
            <div class="sc-stat">
              <div class="sc-stat-label">누적 금액</div>
              <div class="sc-stat-val">${stat?.sum > 0 ? Fmt.krw(stat.sum) : '—'}</div>
            </div>
            <div class="sc-stat">
              <div class="sc-stat-label">평균 체류</div>
              <div class="sc-stat-val">${stat?.avgAge || 0}일</div>
            </div>
            <div class="sc-stat">
              <div class="sc-stat-label">정체 (14일+)</div>
              <div class="sc-stat-val" style="color:${stat?.stuck14 > 0 ? '#E63329' : 'inherit'}">${stat?.stuck14 || 0}건</div>
            </div>
          </div>

          <div id="sc-content" style="min-height:240px">
            <div style="display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:13px;padding:30px 0;justify-content:center">
              <div class="sc-spinner"></div>
              <span>AI 코치가 분석 중입니다... (약 5초)</span>
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="sc-close">닫기</button>
        <button class="btn btn-primary" id="sc-goto-stage">📋 단계 카드 보기</button>
      `,
      bind: {
        '#sc-close': () => Modal.close(),
        '#sc-goto-stage': () => {
          Modal.close();
          setTimeout(() => {
            const col = document.querySelector(`.kanban-col[data-stage="${stage}"]`);
            if (col) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }, 100);
        },
      },
    });

    // AI 분석 비동기 로드
    try {
      // 현재 페이지 필터를 함께 전달 — AI 코칭이 화면과 동일 모수 사용
      const r = await API.post('/leads/stage-coach', { stage, filters: this.filters });
      const d = r.data;
      const contentEl = document.getElementById('sc-content');
      if (!contentEl) return;
      const statusColor = statusColors[d.status] || '#999';

      contentEl.innerHTML = `
        <div class="sc-status" style="background:${statusColor}15;border-left:3px solid ${statusColor}">
          <div class="sc-status-badge" style="background:${statusColor}">${d.status}</div>
          <div class="sc-headline">${esc(d.headline || '')}</div>
        </div>

        ${
          d.going_well?.length
            ? `
        <div class="sc-section">
          <div class="sc-section-title">✨ 잘 가고 있는 점</div>
          <ul class="sc-list">${d.going_well.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>`
            : ''
        }

        ${
          d.warnings?.length
            ? `
        <div class="sc-section sc-section-warn">
          <div class="sc-section-title">⚠️ 주의할 점</div>
          <ul class="sc-list">${d.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>`
            : ''
        }

        ${
          d.urgent?.length
            ? `
        <div class="sc-section sc-section-urgent">
          <div class="sc-section-title">🚨 즉시 처리 필요</div>
          <ul class="sc-list">${d.urgent.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>`
            : ''
        }

        ${
          d.next_actions?.length
            ? `
        <div class="sc-section sc-section-action">
          <div class="sc-section-title">🎯 이번 주 실행 액션</div>
          <ol class="sc-list">${d.next_actions.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
        </div>`
            : ''
        }
      `;
    } catch (e) {
      const contentEl = document.getElementById('sc-content');
      if (contentEl)
        contentEl.innerHTML = `<div style="color:var(--oci-red);padding:20px;text-align:center">AI 분석 실패: ${esc(e.message)}</div>`;
    }
  },

  renderCard(lead) {
    const meta = STAGES[lead.stage];
    const days = Fmt.daysLeft(lead.bidding_deadline);
    const urgent = days !== null && days !== undefined && days >= 0 && days <= 7;
    return `
      <div class="kanban-card" draggable="true"
           data-id="${lead.id}" data-stage="${lead.stage}"
           style="--card-accent:${meta.color}">
        <div class="kc-company">${esc(lead.customer_name)}</div>
        <div class="kc-project">${esc(lead.project_name)}</div>
        <div class="kc-meta">
          <span class="kc-amount">${Fmt.amount(lead.expected_amount, lead.currency)}</span>
          <span class="kc-date">${lead.bidding_deadline ? '마감 ' + Fmt.date(lead.bidding_deadline).substring(5) : lead.expected_close_date ? Fmt.date(lead.expected_close_date).substring(5) : ''}</span>
        </div>
        ${
          lead.currency !== 'KRW' && lead.amount_krw
            ? `
          <div class="kc-krw-sub" title="환율 ${lead.fx_rate ? Number(lead.fx_rate).toLocaleString() + '원' : ''}${lead.fx_lock_policy === 'locked' ? ' · 확정' : ''}">
            ≈ ${Fmt.krw(Number(lead.amount_krw))}
            ${lead.fx_lock_policy === 'locked' ? '🔒' : ''}
          </div>`
            : ''
        }
        <div class="kc-tags">
          ${urgent ? `<span class="kc-tag urgent">D-${days}</span>` : ''}
          <span class="kc-tag">${esc(lead.business_type)}</span>
          <span class="kc-tag">${esc(lead.region)}</span>
          ${lead.assigned_name ? `<span class="kc-tag">${esc(lead.assigned_name)}</span>` : ''}
        </div>
      </div>
    `;
  },

  bindDragDrop() {
    let draggingId = null;
    let wasDragging = false;

    document.querySelectorAll('.kanban-card').forEach(card => {
      // 클릭 → 상세 팝업 (드래그와 분리)
      card.addEventListener('click', () => {
        if (!wasDragging) {
          App.openLeadDetail(parseInt(card.dataset.id));
        }
      });

      card.ondragstart = e => {
        draggingId = card.dataset.id;
        wasDragging = true;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      };
      card.ondragend = () => {
        card.classList.remove('dragging');
        // click 이벤트 발생 이후에 초기화 (드래그 직후 click 억제)
        setTimeout(() => {
          wasDragging = false;
        }, 200);
      };
    });

    document.querySelectorAll('.kanban-col').forEach(col => {
      col.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      };
      col.ondrop = async e => {
        e.preventDefault();
        if (!draggingId) return;
        const newStage = col.dataset.stage;
        const prevId = draggingId;
        draggingId = null;
        try {
          await API.leads.setStage(prevId, newStage);
          Toast.success(`단계가 "${STAGES[newStage].label}"(으)로 변경되었습니다`);
          this.loadData();
        } catch (_) {
          /* stage change error shown via Toast by API layer */
        }
      };
    });
  },

  // ── 엑셀 내보내기 (파이프라인 = 리드 데이터) ─────────────────
  exportExcel() {
    const f = this.filters;
    const qs = new URLSearchParams();
    if (f.search) qs.set('search', f.search);
    if (f.region) qs.set('region', f.region);
    if (f.business_type) qs.set('business_type', f.business_type);
    if (f.assigned_to) qs.set('assigned_to', f.assigned_to);
    const path = '/leads/export' + (qs.toString() ? '?' + qs.toString() : '');
    API.downloadExcel(path, '파이프라인_' + new Date().toISOString().slice(0, 10));
  },
};
