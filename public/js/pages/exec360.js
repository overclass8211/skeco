'use strict';
// =============================================================
// Exec360Page — 임원 360 요약 (전사 대시보드)
//
// 전사 KPI + 공정 라이프사이클 단계 분포 + Top 계정 + 리스크 요약.
// Top 계정 행 클릭 → 고객·제품 360뷰로 드릴다운.
// 데이터: GET /api/customer360/exec-summary (집계, 무스키마변경)
// RBAC: executive+
// =============================================================
const Exec360Page = {
  _STAGE_COLOR: { discovery: '#93B4F9', sample: '#5585F5', evaluation: '#2357E8', specin: '#F59C00', massprod: '#17A85A', delivery: '#0F7A3F' },
  _won(v) {
    return Fmt.amount(Number(v) || 0, 'KRW');
  },
  _gradeColor(g) {
    if (g === 'A+' || g === 'A') return '#0F7A3F';
    if (g === 'B+' || g === 'B') return '#2357E8';
    if (g === 'C') return '#F59C00';
    return '#E63329';
  },

  async render() {
    document.getElementById('content').innerHTML = `
      <style>
        .ex-bar2{display:flex;align-items:center;gap:12px;margin-bottom:14px}
        .ex-bar2 h2{font-size:18px;font-weight:700;margin:0}
        .ex-sub{font-size:12px;color:var(--text-3)}
        .ex-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
        .ex-kpi{border:1px solid var(--border);border-radius:10px;padding:15px 16px;background:var(--surface);position:relative;cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .12s}
        .ex-kpi:hover{border-color:var(--oci-red);box-shadow:0 3px 12px rgba(0,0,0,.07);transform:translateY(-1px)}
        .ex-kpi::after{content:'근거 ›';position:absolute;top:14px;right:14px;font-size:10.5px;font-weight:700;color:var(--text-3);opacity:0;transition:opacity .12s}
        .ex-kpi:hover::after{opacity:.85}
        .ex-kpi .l{font-size:12.5px;color:var(--text-2);font-weight:600}
        .ex-kpi .v{font-size:28px;font-weight:700;margin-top:5px;color:var(--text-1);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
        .ex-kpi .s{font-size:11.5px;color:var(--text-3);margin-top:2px}
        /* KPI 근거 모달 */
        .ex-kpi-lead{font-size:24px;font-weight:700;color:var(--text-1);margin-bottom:6px;font-variant-numeric:tabular-nums}
        .ex-kpi-lead span{font-size:12px;font-weight:500;color:var(--text-3);margin-left:7px}
        .ex-kpi-formula{font-size:12px;line-height:1.55;color:var(--text-2);background:rgba(22,100,229,.05);border-radius:7px;padding:9px 12px;margin-bottom:14px}
        .ex-kpi-scroll{max-height:42vh;overflow:auto}
        .ex-kpi-note{font-size:11px;color:var(--text-3);margin-top:10px}
        .ex-kpi-grades{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
        .ex-kpi-grade{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2)}
        .ex-kpi-grade .gr{width:24px;height:24px;border-radius:6px;font-size:11px}
        /* Health 기준 패널 */
        .ex-hcfg{border:1px solid var(--border);border-radius:9px;padding:11px 13px;margin-bottom:14px;background:var(--surface-2,rgba(0,0,0,.015))}
        .ex-hcfg-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
        .ex-hcfg-h .ex-stage-th{margin:0}
        .ex-hcfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 14px;font-size:12px;color:var(--text-2)}
        .ex-hcfg-grid b{color:var(--text-1)}
        .ex-hcfg-th{font-size:11.5px;color:var(--text-3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
        .ex-hcfg-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px 14px;margin:4px 0 10px}
        .ex-hcfg-fld{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--text-2)}
        .ex-hcfg-fld input{width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .ex-hcfg-sec{font-size:11px;font-weight:700;color:var(--text-3);margin:6px 0 2px;grid-column:1/-1}
        .ex-hcfg-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
        .ex-hcfg-btn{font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text-1);cursor:pointer}
        .ex-hcfg-btn.primary{background:var(--oci-red);border-color:var(--oci-red);color:#fff}
        .ex-hcfg-btn.primary:hover{filter:brightness(1.05)}
        .ex-hcfg-btn:disabled{cursor:not-allowed}
        /* 4대 건강 축 카드 */
        .ex-hdims{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px;margin-bottom:10px}
        .ex-hdim{border:1px solid var(--border);border-radius:8px;padding:9px 11px;background:var(--surface)}
        .ex-hdim-top{display:flex;align-items:baseline;gap:7px;margin-bottom:3px}
        .ex-hdim-w{font-size:18px;font-weight:800;color:var(--oci-red);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
        .ex-hdim-l{font-size:12.5px;font-weight:700;color:var(--text-1)}
        .ex-hdim-d{font-size:11px;color:var(--text-3);line-height:1.4}
        .ex-hcfg-adv{margin:2px 0 10px}
        .ex-hcfg-adv summary{font-size:12px;font-weight:600;color:var(--text-2);cursor:pointer;padding:4px 0}
        .ex-hcfg-adv[open] summary{margin-bottom:4px}
        .ex-sec{font-size:14px;font-weight:700;color:var(--text-1);margin:22px 0 12px}
        /* 단계 분포 — 가로 흐름(발굴→납품) + 비중 + 병목(최다) 강조 */
        /* AI 임원 브리핑 */
        .ex-brief{border:1px solid var(--border);border-radius:12px;background:linear-gradient(135deg,rgba(124,77,255,.05),rgba(22,100,229,.04));padding:16px 18px;margin-bottom:18px}
        .ex-brief-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
        .ex-brief-t{font-size:13px;font-weight:700;color:var(--text-1)}
        .ex-brief-when{font-size:11px;color:var(--text-3)}
        .ex-brief-stale{font-size:10px;font-weight:700;color:#b45309;background:rgba(245,156,0,.14);border-radius:6px;padding:2px 7px}
        .ex-brief-hl{font-size:15px;font-weight:700;color:var(--text-1);line-height:1.5;margin-bottom:10px}
        .ex-brief-ul{margin:0 0 10px;padding-left:18px;line-height:1.7;font-size:13px;color:var(--text-2)}
        .ex-brief-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
        .ex-brief-box{border-radius:8px;padding:10px 12px}
        .ex-brief-box.act{background:rgba(23,168,90,.08);border-left:3px solid #17A85A}
        .ex-brief-box.risk{background:rgba(230,51,41,.07);border-left:3px solid var(--oci-red)}
        .ex-brief-box-h{font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:4px}
        .ex-brief-box .ex-brief-ul{margin:0;font-size:12.5px}
        .ex-brief-empty{font-size:12.5px;color:var(--text-3);padding:8px 0}
        /* 공정 라이프사이클 — 스트림(퍼널): SVG 영역 + HTML 오버레이 (해상도 독립) */
        .ex-fn-wrap{position:relative;height:150px;margin:42px 0 60px}
        .ex-fn-area{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
        .ex-fn-col{position:absolute;top:0;height:100%;width:96px;transform:translateX(-50%);cursor:pointer;overflow:visible}
        .ex-fn-node{position:absolute;left:0;right:0;transform:translateY(-100%);display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none}
        .ex-fn-count{font-size:20px;font-weight:700;color:var(--text-1);line-height:1;font-variant-numeric:tabular-nums}
        .ex-fn-max{font-size:10px;font-weight:700;color:var(--oci-red);background:var(--oci-red-light);border-radius:5px;padding:0 5px;line-height:1.5}
        .ex-fn-dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 3px var(--surface);transition:transform .12s}
        .ex-fn-lab{position:absolute;left:0;right:0;top:calc(100% + 8px);display:flex;flex-direction:column;align-items:center;gap:1px}
        .ex-fn-label{font-size:13px;font-weight:600;color:var(--text-1);white-space:nowrap}
        .ex-fn-label.ex-fn-zero{color:var(--text-3)}
        .ex-fn-pct{font-size:12px;font-weight:700;color:var(--text-3)}
        .ex-fn-col:hover .ex-fn-label{color:var(--oci-red)}
        .ex-fn-col:hover .ex-fn-dot{transform:scale(1.3)}
        /* 단계 AI 진단 모달 */
        .ex-stage-stats{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-2);padding:2px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px}
        .ex-stage-stats b{font-weight:700;color:var(--text-1)}
        .ex-stage-ai{background:linear-gradient(135deg,rgba(124,77,255,.06),rgba(22,100,229,.04));border-radius:8px;padding:12px 14px;margin-bottom:14px}
        .ex-stage-diag{font-size:13px;line-height:1.6;color:var(--text-1)}
        .ex-stage-acth{font-size:11px;font-weight:700;color:var(--text-3);margin-top:8px}
        .ex-stage-acts{margin:4px 0 0;padding-left:18px;line-height:1.7;font-size:12.5px;color:var(--text-2)}
        .ex-stage-th{font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:6px}
        .ex-risk{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
        .ex-rcard{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--surface)}
        .ex-rcard .h{font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600}
        .ex-rcard .it{font-size:12px;padding:3px 0;color:var(--text-1);border-top:1px solid var(--border)}
        .gr{display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff}
        .pill{font-size:11px;padding:2px 8px;border-radius:6px;margin-left:3px}
        .p-d{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .p-w{background:rgba(245,156,0,.14);color:#b45309}
      </style>
      <div class="ex-bar2"><h2>임원 360 요약</h2><span class="ex-sub" id="ex-sub">전사 집계</span></div>
      <div id="ex-body"><div style="padding:50px;text-align:center;color:var(--text-3)">불러오는 중…</div></div>
    `;
    try {
      const res = await API.get('/customer360/exec-summary');
      this._data = res.data;
      this._renderBody();
    } catch (_) {
      const b = document.getElementById('ex-body');
      if (b) b.innerHTML = '<div style="padding:50px;text-align:center;color:var(--text-3)">데이터를 불러오지 못했습니다.</div>';
    }
  },

  _svgIcon(p) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  },

  // 마감 승률 부가설명 — 마감 실주 0 / 데이터 부재 맥락을 명확히
  _winRateSub(k) {
    const won = k.won_deals;
    const lost = k.lost_deals;
    if (won === undefined || lost === undefined) return '수주/(수주+실주)';
    if (won + lost === 0) return '마감 딜 없음';
    if (lost === 0) return `마감 실주 0 · 수주 ${won}건`;
    return `수주 ${won} / 마감 ${won + lost}`;
  },

  _renderBody() {
    const d = this._data;
    const k = d.kpis;
    const sub = document.getElementById('ex-sub');
    if (sub) sub.textContent = `전사 · Top 계정 ${d.top_accounts.length} · 단계 소재 ${d.stage_distribution.reduce((a, s) => a + s.count, 0)}`;

    const kpis = `<div class="ex-kpis">
      <div class="ex-kpi" data-kpi="weighted"><div class="l">가중 예상매출</div><div class="v">${this._won(k.weighted_expected)}</div><div class="s">진행 딜 가중합</div></div>
      <div class="ex-kpi" data-kpi="deals"><div class="l">진행 딜</div><div class="v">${k.active_deals}건</div><div class="s">활성 파이프라인</div></div>
      <div class="ex-kpi" data-kpi="winrate"><div class="l">마감 승률</div><div class="v">${k.win_rate === null || k.win_rate === undefined ? '-' : k.win_rate + '%'}</div><div class="s">${this._winRateSub(k)}</div></div>
      <div class="ex-kpi" data-kpi="health"><div class="l">평균 Health</div><div class="v">${k.avg_health}</div><div class="s">Top 계정 기준</div></div>
      <div class="ex-kpi" data-kpi="quality"><div class="l">품질 오픈</div><div class="v" style="color:${k.open_quality ? 'var(--oci-red)' : ''}">${k.open_quality}건</div><div class="s">VOC/NCR 미해결</div></div>
      <div class="ex-kpi" data-kpi="capa"><div class="l">CAPA 부족 계정</div><div class="v" style="color:${k.capa_short_accounts ? 'var(--oci-red)' : ''}">${k.capa_short_accounts}곳</div><div class="s">생산 < 수요</div></div>
    </div>`;

    const stageTotal = d.stage_distribution.reduce((a, s) => a + s.count, 0) || 1;
    const stage = `<div class="ex-sec">공정 라이프사이클 단계 분포 <span style="font-size:11.5px;font-weight:400;color:var(--text-3)">발굴 → 납품 · 총 ${stageTotal}개 소재 · 단계 클릭 시 AI 진단</span></div>
      ${this._renderStageFunnel(d.stage_distribution, stageTotal)}`;

    const accounts = `<div class="ex-sec">Top 계정 (가중 예상매출)</div>
      <table class="data-table" style="font-size:13px">
        <thead><tr><th>고객사</th><th>Health</th><th class="text-right">가중매출</th><th class="text-right">진행딜</th><th class="text-right">수주</th><th>리스크</th></tr></thead>
        <tbody>
          ${d.top_accounts
            .map(a => `<tr class="clickable" data-acct="${a.id}">
              <td><strong>${esc(a.name)}</strong></td>
              <td><span class="gr" style="background:${this._gradeColor(a.health_grade)}">${a.health_grade}</span></td>
              <td class="text-right">${this._won(a.weighted)}</td>
              <td class="text-right">${a.active}</td>
              <td class="text-right">${a.won}</td>
              <td>${a.risks.length ? a.risks.map(r => `<span class="pill ${r.level === 'high' ? 'p-d' : 'p-w'}">${esc(r.label)}</span>`).join('') : '<span style="color:var(--text-3);font-size:12px">정상</span>'}</td>
            </tr>`)
            .join('')}
        </tbody>
      </table>`;

    const r = d.risks;
    const riskCard = (title, iconP, color, items, empty) => `<div class="ex-rcard">
        <div class="h" style="color:${color}">${this._svgIcon(iconP)} ${title}</div>
        ${items.length ? items.map(t => `<div class="it">${esc(t)}</div>`).join('') : `<div class="it" style="color:var(--text-3)">${empty}</div>`}
      </div>`;
    const risks = `<div class="ex-sec">리스크 요약</div>
      <div class="ex-risk">
        ${riskCard('CAPA 부족', '<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M9 9V5h6v4"/>', 'var(--oci-red)', r.capa_short.slice(0, 5).map(x => `${x.name} · 부족 ${Math.round(x.gap).toLocaleString('ko-KR')}`), 'CAPA 부족 없음')}
        ${riskCard('품질 오픈', '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>', '#b45309', r.quality.slice(0, 5).map(q => `${q.name} · ${q.title} (${q.severity})`), '품질 이슈 없음')}
        ${riskCard('평가 지연/진행', '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', 'var(--text-2)', r.eval_delay.slice(0, 5).map(e => `${e.name} · ${e.material.split(' · ')[0]}`), '평가 지연 없음')}
      </div>`;

    const body = document.getElementById('ex-body');
    body.innerHTML = `<div id="ex-brief"></div>` + kpis + stage + accounts + risks;
    body.querySelectorAll('tr[data-acct]').forEach(tr =>
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.acct);
        try {
          localStorage.setItem('c360_last', String(id));
        } catch (_) {
          /* noop */
        }
        location.hash = '#customer360';
      })
    );
    // 공정 단계 클릭 → AI 진단 모달
    body.querySelectorAll('.ex-fn-col[data-stage]').forEach(g =>
      g.addEventListener('click', () => this._openStageModal(g.dataset.stage, g.dataset.label))
    );
    // KPI 카드 클릭 → 근거 모달
    body.querySelectorAll('.ex-kpi[data-kpi]').forEach(c =>
      c.addEventListener('click', () => this._openKpiModal(c.dataset.kpi))
    );
    this._loadBrief();
  },

  // ── 공정 라이프사이클 — 스트림(퍼널) 그래픽 + 단계 클릭 ──────
  //   SVG 는 '영역(그라데이션)'만, 숫자·점·라벨은 HTML 오버레이 → 어떤 해상도에서도
  //   글자 크기/밸런스 일정 (SVG 폭 비례 확대 문제 제거)
  _renderStageFunnel(dist, total) {
    const N = dist.length;
    if (!N) return '';
    const max = Math.max(1, ...dist.map(s => s.count));
    // 좌표는 0~100 정규화 — viewBox(0 0 100 100, preserveAspectRatio none)로 가로 stretch
    const BASE = 88; // baseline y(%)
    const PEAK = 16; // 최댓값 top y(%)
    const xPct = i => ((i + 0.5) / N) * 100;
    const topPct = c => BASE - (c / max) * (BASE - PEAK);
    const pts = dist.map((s, i) => ({
      ...s,
      x: xPct(i),
      top: topPct(s.count),
      color: this._STAGE_COLOR[s.stage] || '#2357E8',
      pct: Math.round((s.count / total) * 100),
      isMax: max > 0 && s.count === max,
    }));
    // 유선형 곡선 (Catmull-Rom → cubic bezier) — 상단 곡선만
    const topCurve = (() => {
      let d = `M ${pts[0].x.toFixed(2)} ${pts[0].top.toFixed(2)}`;
      for (let i = 0; i < N - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || pts[i + 1];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.top + (p2.top - p0.top) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.top - (p3.top - p1.top) / 6;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.top.toFixed(2)}`;
      }
      return d;
    })();
    const fillPath = `${topCurve} L ${pts[N - 1].x.toFixed(2)} ${BASE} L ${pts[0].x.toFixed(2)} ${BASE} Z`;
    // 단계 색을 잇는 가로 다색 그라데이션 (보합 스펙트럼)
    const stops = pts
      .map(
        (p, i) =>
          `<stop offset="${N === 1 ? 0 : ((i / (N - 1)) * 100).toFixed(1)}%" stop-color="${p.color}"/>`
      )
      .join('');
    const svg = `<svg class="ex-fn-area" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="exFnFlow" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
          <linearGradient id="exFnFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.55"/>
          </linearGradient>
        </defs>
        <line x1="0" y1="${BASE}" x2="100" y2="${BASE}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>
        <path d="${fillPath}" fill="url(#exFnFlow)" fill-opacity="0.22"/>
        <path d="${fillPath}" fill="url(#exFnFade)"/>
        <path d="${topCurve}" fill="none" stroke="url(#exFnFlow)" stroke-width="2.5" stroke-opacity="0.95" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
    const cols = pts
      .map(
        p => `
      <div class="ex-fn-col" data-stage="${p.stage}" data-label="${esc(p.label)}" style="left:${p.x.toFixed(2)}%">
        <div class="ex-fn-node" style="top:${p.top.toFixed(2)}%">
          ${p.isMax ? '<span class="ex-fn-max">최다</span>' : ''}
          <span class="ex-fn-count">${p.count}</span>
          <span class="ex-fn-dot" style="background:${p.color}"></span>
        </div>
        <div class="ex-fn-lab">
          <span class="ex-fn-label${p.count === 0 ? ' ex-fn-zero' : ''}">${esc(p.label)}</span>
          <span class="ex-fn-pct">${p.pct}%</span>
        </div>
      </div>`
      )
      .join('');
    return `<div class="ex-fn-wrap" role="img" aria-label="공정 라이프사이클 단계 분포">${svg}${cols}</div>`;
  },

  async _openStageModal(stage, label) {
    if (typeof Modal === 'undefined') return;
    Modal.open({
      title: `${label || ''} 단계 — AI 진단`,
      width: 720,
      body: '<div class="loading" style="padding:40px;text-align:center;color:var(--text-3)">단계 데이터 분석 중…</div>',
    });
    try {
      const r = await API.post(`/customer360/exec-stage/${stage}`, {});
      const d = r.data || {};
      const st = d.stats || {};
      const won = v => '₩' + (Math.round(Number(v) || 0) / 1_0000_0000).toFixed(1) + '억';
      const rows = (d.materials || [])
        .slice(0, 30)
        .map(
          m => `<tr>
            <td><strong>${esc(m.customer_name)}</strong></td>
            <td>${esc((m.material_name || '').split(' · ')[0])}</td>
            <td>${esc(m.business_type || '-')}</td>
            <td class="text-right">${won(m.expected_order)}</td>
            <td>${m.capa_short ? '<span class="pill p-d">CAPA 부족</span>' : ''}${m.open_quality ? `<span class="pill p-w">품질 ${m.open_quality}</span>` : ''}</td>
          </tr>`
        )
        .join('');
      const ai = d.ai;
      const aiHtml = ai
        ? `<div class="ex-stage-ai">
            ${ai.diagnosis ? `<div class="ex-stage-diag">${esc(ai.diagnosis)}</div>` : ''}
            ${Array.isArray(ai.actions) && ai.actions.length ? `<div class="ex-stage-acth">권고 액션</div><ul class="ex-stage-acts">${ai.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          </div>`
        : '<div style="font-size:12px;color:var(--text-3);padding:8px 0">AI 진단을 생성하지 못했습니다 (데이터는 아래 참조).</div>';
      const html = `
        <div class="ex-stage-stats">
          <span>소재 <b>${st.count || 0}</b>개</span>
          <span>CAPA 부족 <b style="color:var(--oci-red)">${st.capa_short || 0}</b></span>
          <span>품질 오픈 <b style="color:#b45309">${st.open_quality || 0}</b></span>
          <span>분기 예상수주 <b>${won(st.expected_order)}</b></span>
        </div>
        ${aiHtml}
        <div class="ex-stage-th">소재 목록</div>
        <div style="max-height:38vh;overflow:auto">
          <table class="data-table" style="font-size:12.5px">
            <thead><tr><th>고객사</th><th>소재</th><th>사업유형</th><th class="text-right">예상수주</th><th>리스크</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:20px">해당 단계 소재 없음</td></tr>'}</tbody>
          </table>
        </div>`;
      const box = document.querySelector('#modal-overlay .modal-body');
      if (box) box.innerHTML = html;
    } catch (e) {
      const box = document.querySelector('#modal-overlay .modal-body');
      if (box)
        box.innerHTML = `<div style="padding:30px;text-align:center;color:var(--oci-red)">분석 실패: ${esc(e.message || e)}</div>`;
    }
  },

  // KPI 카드 클릭 → 근거 모달 (헤더는 즉시, 전체 목록은 API lazy-load)
  async _openKpiModal(kpi) {
    if (typeof Modal === 'undefined' || !this._data) return;
    const k = this._data.kpis;
    const won = v => this._won(v);
    const wv = k.win_rate === null || k.win_rate === undefined ? '-' : k.win_rate + '%';
    // 카드별 헤더(타이틀/대표값/계산식) — 카운트는 전사 집계라 즉시 표시
    const META = {
      weighted: {
        title: '가중 예상매출 — 근거',
        lead: `${won(k.weighted_expected)}<span>진행 딜 가중합</span>`,
        formula: '계산식: Σ (딜 예상금액 × 단계별 수주확률) — 수주/실주/중단 딜은 제외',
      },
      deals: {
        title: '진행 딜 — 근거',
        lead: `${k.active_deals}건<span>활성 파이프라인</span>`,
        formula: '기준: 영업 단계가 수주·실주·중단이 아닌 모든 딜',
      },
      winrate: {
        title: '마감 승률 — 근거',
        lead: `${wv}<span>마감(종결) 딜 기준</span>`,
        formula:
          '계산식: 수주 ÷ (수주 + 실주). 진행 중인 딜은 분모에서 제외하므로, 마감 실주가 0이면 100%로 표시됩니다.' +
          `<div class="ex-stage-stats" style="margin-top:8px;border:0;padding:0"><span>수주 <b style="color:#17A85A">${k.won_deals ?? '-'}</b></span><span>실주 <b style="color:var(--oci-red)">${k.lost_deals ?? '-'}</b></span><span>진행 <b>${k.active_deals}</b></span></div>`,
      },
      health: {
        title: '평균 Health — 근거',
        lead: `${k.avg_health}<span>계정 평균 등급</span>`,
        formula: '4대 건강 축(거래·회수·품질·공급)을 각 0~100점으로 환산해 아래 비중으로 가중평균한 종합 점수입니다. (상세뷰와 동일 산식)',
      },
      quality: {
        title: '품질 오픈 (VOC/NCR) — 근거',
        lead: `<span style="color:${k.open_quality ? 'var(--oci-red)' : ''}">${k.open_quality}건</span><span>미해결 VOC/NCR</span>`,
        formula: "기준: 상태가 '해결(resolved)'이 아닌 품질 케이스",
      },
      capa: {
        title: 'CAPA 부족 계정 — 근거',
        lead: `<span style="color:${k.capa_short_accounts ? 'var(--oci-red)' : ''}">${k.capa_short_accounts}곳</span><span>생산 < 수요</span>`,
        formula: '기준: 향후 분기 고객 수요 합계 > 생산 가능량 합계인 계정',
      },
    };
    const m = META[kpi];
    if (!m) return;

    Modal.open({
      title: m.title,
      width: 660,
      body:
        `<div class="ex-kpi-lead">${m.lead}</div>` +
        `<div class="ex-kpi-formula">${m.formula}</div>` +
        (kpi === 'health' ? '<div id="ex-health-cfg"></div>' : '') +
        `<div id="ex-kpi-list" style="padding:28px;text-align:center;color:var(--text-3)">전체 내역 불러오는 중…</div>`,
    });
    if (kpi === 'health') this._loadHealthCriteria();
    try {
      const r = await API.get(`/customer360/exec-kpi/${kpi}`);
      const items = (r.data && r.data.items) || [];
      const total = Number.isFinite(r.data && r.data.total) ? r.data.total : items.length;
      const box = document.querySelector('#ex-kpi-list');
      if (box) box.outerHTML = `<div id="ex-kpi-list">${this._kpiListHtml(kpi, items, total)}</div>`;
    } catch (e) {
      const box = document.querySelector('#ex-kpi-list');
      if (box) box.innerHTML = `<div style="padding:24px;text-align:center;color:var(--oci-red)">불러오기 실패: ${esc(e.message || e)}</div>`;
    }
  },

  // KPI 전체 목록 → 테이블 HTML (전체 건수 풋터 포함)
  _kpiListHtml(kpi, items, total) {
    const won = v => this._won(v);
    const scroll = (head, rows, empty, colspan) =>
      `<div class="ex-kpi-scroll"><table class="data-table" style="font-size:12.5px"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${colspan}" style="text-align:center;color:var(--text-3);padding:20px">${empty}</td></tr>`}</tbody></table></div>`;
    const foot = (label, n) => `<div class="ex-kpi-note">전체 ${n}${label}</div>`;

    if (kpi === 'weighted') {
      const rows = items
        .map(a => `<tr><td><strong>${esc(a.name)}</strong></td><td class="text-right">${won(a.weighted)}</td><td class="text-right">${a.active}</td></tr>`)
        .join('');
      return (
        `<div class="ex-stage-th">계정별 가중매출</div>` +
        scroll('<th>고객사</th><th class="text-right">가중매출</th><th class="text-right">진행딜</th>', rows, '진행 딜 없음', 3) +
        foot('개 계정', total)
      );
    }
    if (kpi === 'deals') {
      const rows = items
        .map(
          d =>
            `<tr><td><strong>${esc(d.project_name || '-')}</strong></td><td>${esc(d.customer_name)}</td><td>${esc(d.stage_label)}</td><td class="text-right">${won(d.expected_amount)}</td><td class="text-right">${won(d.weighted)}</td></tr>`
        )
        .join('');
      return (
        `<div class="ex-stage-th">진행 딜 명세</div>` +
        scroll(
          '<th>딜명</th><th>고객사</th><th>단계</th><th class="text-right">예상금액</th><th class="text-right">가중</th>',
          rows,
          '진행 딜 없음',
          5
        ) +
        foot('건', total)
      );
    }
    if (kpi === 'winrate') {
      const rows = items
        .map(
          d =>
            `<tr><td><strong>${esc(d.project_name || '-')}</strong></td><td>${esc(d.customer_name)}</td><td><span class="pill ${d.result === 'won' ? 'p-w' : 'p-d'}" style="${d.result === 'won' ? 'background:rgba(23,168,90,.12);color:#17A85A' : ''}">${d.result === 'won' ? '수주' : '실주'}</span></td><td class="text-right">${won(d.expected_amount)}</td></tr>`
        )
        .join('');
      return (
        `<div class="ex-stage-th">마감 딜 (수주·실주)</div>` +
        scroll('<th>딜명</th><th>고객사</th><th>결과</th><th class="text-right">예상금액</th>', rows, '마감된 딜 없음', 4) +
        foot('건 마감', total)
      );
    }
    if (kpi === 'health') {
      const order = ['A+', 'A', 'B+', 'B', 'C', 'D'];
      const cnt = {};
      items.forEach(a => {
        cnt[a.grade] = (cnt[a.grade] || 0) + 1;
      });
      const grades = order
        .filter(g => cnt[g])
        .map(g => `<span class="ex-kpi-grade"><span class="gr" style="background:${this._gradeColor(g)}">${g}</span> ${cnt[g]}곳</span>`)
        .join('');
      const sc = v => {
        const n = Number.isFinite(v) ? v : 0;
        const col = n >= 80 ? '#17A85A' : n >= 60 ? 'var(--text-1)' : n >= 40 ? '#b45309' : 'var(--oci-red)';
        return `<td class="text-right" style="color:${col}">${n}</td>`;
      };
      const rows = items
        .map(a => {
          const s = a.subs || {};
          return `<tr><td><strong>${esc(a.name)}</strong></td><td><span class="gr" style="background:${this._gradeColor(a.grade)};width:24px;height:24px;font-size:11px">${a.grade}</span></td><td class="text-right"><b>${a.score}</b></td>${sc(s.commercial)}${sc(s.collection)}${sc(s.quality)}${sc(s.supply)}</tr>`;
        })
        .join('');
      return (
        `<div class="ex-stage-th">등급 분포</div><div class="ex-kpi-grades">${grades || '<span style="color:var(--text-3);font-size:12px">데이터 없음</span>'}</div>` +
        `<div class="ex-stage-th">계정별 등급 — 축별 점수(0~100)로 "왜 이 등급"이 한눈에</div>` +
        scroll(
          '<th>고객사</th><th>Health</th><th class="text-right">종합</th><th class="text-right">거래</th><th class="text-right">회수</th><th class="text-right">품질</th><th class="text-right">공급</th>',
          rows,
          '계정 없음',
          7
        ) +
        foot('개 계정', total)
      );
    }
    if (kpi === 'quality') {
      const rows = items
        .map(
          q =>
            `<tr><td><strong>${esc(q.name)}</strong></td><td>${esc(q.title)}</td><td>${esc(q.type || '-')}</td><td><span class="pill ${q.severity === 'high' ? 'p-d' : 'p-w'}">${esc(q.severity)}</span></td></tr>`
        )
        .join('');
      return (
        `<div class="ex-stage-th">미해결 목록</div>` +
        scroll('<th>고객사</th><th>제목</th><th>유형</th><th>심각도</th>', rows, '미해결 품질 이슈 없음', 4) +
        foot('건', total)
      );
    }
    if (kpi === 'capa') {
      const rows = items
        .map(
          x =>
            `<tr><td><strong>${esc(x.name)}</strong></td><td class="text-right">${Number(x.demand).toLocaleString('ko-KR')}</td><td class="text-right">${Number(x.capacity).toLocaleString('ko-KR')}</td><td class="text-right" style="color:var(--oci-red);font-weight:700">${Number(x.gap).toLocaleString('ko-KR')}</td></tr>`
        )
        .join('');
      return (
        `<div class="ex-stage-th">계정별 수요·생산·부족량</div>` +
        scroll(
          '<th>고객사</th><th class="text-right">분기수요</th><th class="text-right">생산가능</th><th class="text-right">부족량</th>',
          rows,
          'CAPA 부족 계정 없음',
          4
        ) +
        foot('곳', total)
      );
    }
    return '';
  },

  // ── Health 기준 패널 (조회 + team_lead+ 편집) ───────────────
  _canEditHealth() {
    const role = (typeof App !== 'undefined' && App.currentUser && App.currentUser.role) || '';
    return ['team_lead', 'executive', 'admin', 'superadmin'].includes(role);
  },
  async _loadHealthCriteria() {
    const box = document.getElementById('ex-health-cfg');
    if (!box) return;
    box.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:4px 0">기준 불러오는 중…</div>';
    try {
      const r = await API.get('/customer360/health-config');
      this._healthCfg = r.data.config;
      this._healthDefaults = r.data.defaults;
      this._renderHealthCriteria();
    } catch (_) {
      box.innerHTML = '';
    }
  },
  _renderHealthCriteria() {
    const box = document.getElementById('ex-health-cfg');
    if (!box) return;
    const c = this._healthCfg;
    const D = c.dimensions;
    const t = c.thresholds;
    const card = k =>
      `<div class="ex-hdim"><div class="ex-hdim-top"><span class="ex-hdim-w">${D[k].weight}%</span><span class="ex-hdim-l">${esc(D[k].label)}</span></div><div class="ex-hdim-d">${esc(D[k].desc)}</div></div>`;
    box.innerHTML = `<div class="ex-hcfg">
      <div class="ex-hcfg-h"><span class="ex-stage-th">등급 산출 기준 — 4대 건강 축 가중평균</span>${this._canEditHealth() ? '<button class="ex-hcfg-btn" id="ex-hcfg-edit">기준 설정</button>' : ''}</div>
      <div class="ex-hdims">${['commercial', 'collection', 'quality', 'supply'].map(card).join('')}</div>
      <div class="ex-hcfg-th">각 축을 0~100점으로 환산 후 위 비중으로 가중평균 → 등급: A+ ≥${t['A+']} · A ≥${t.A} · B+ ≥${t['B+']} · B ≥${t.B} · C ≥${t.C} · D 그 미만</div>
    </div>`;
    const editBtn = document.getElementById('ex-hcfg-edit');
    if (editBtn) editBtn.addEventListener('click', () => this._renderHealthEdit());
  },
  _renderHealthEdit() {
    const box = document.getElementById('ex-health-cfg');
    if (!box) return;
    const c = this._healthCfg;
    const D = c.dimensions;
    const t = c.thresholds;
    const num = (id, label, val) =>
      `<label class="ex-hcfg-fld">${label}<input type="number" step="1" min="0" max="100" data-hf="${id}" value="${val}"></label>`;
    box.innerHTML = `<div class="ex-hcfg">
      <div class="ex-hcfg-h"><span class="ex-stage-th">등급 산출 기준 편집</span></div>
      <div class="ex-hcfg-sec">4대 축 비중 (합계 <b id="ex-hw-sum">100</b>%, 100이어야 저장 가능)</div>
      <div class="ex-hcfg-form">
        ${num('w_commercial', '거래 성장 비중(%)', D.commercial.weight)}
        ${num('w_collection', '대금 회수 비중(%)', D.collection.weight)}
        ${num('w_quality', '품질·서비스 비중(%)', D.quality.weight)}
        ${num('w_supply', '공급 역량 비중(%)', D.supply.weight)}
      </div>
      <details class="ex-hcfg-adv">
        <summary>세부 규칙 (축별 점수 산출 — 고급)</summary>
        <div class="ex-hcfg-form">
          <div class="ex-hcfg-sec">거래 성장 (0~100)</div>
          ${num('c_base', '기준점', D.commercial.base)}
          ${num('c_won', '수주 +/건', D.commercial.perWon)}
          ${num('c_active', '진행 +/건', D.commercial.perActive)}
          ${num('c_contract', '계약 보유 +', D.commercial.contractBonus)}
          <div class="ex-hcfg-sec">대금 회수 · 품질 · 공급 (100에서 차감)</div>
          ${num('col_overdue', '연체 −/건', D.collection.perOverdue)}
          ${num('q_quality', '미해결 품질 −/건', D.quality.perQuality)}
          ${num('q_support', '미해결 지원 −/건', D.quality.perSupport)}
          ${num('s_short', 'CAPA 부족 시 점수', D.supply.shortScore)}
        </div>
      </details>
      <div class="ex-hcfg-form">
        <div class="ex-hcfg-sec">등급 임계값 (A+ &gt; A &gt; B+ &gt; B &gt; C)</div>
        ${num('t_Ap', 'A+ 이상', t['A+'])}
        ${num('t_A', 'A 이상', t.A)}
        ${num('t_Bp', 'B+ 이상', t['B+'])}
        ${num('t_B', 'B 이상', t.B)}
        ${num('t_C', 'C 이상', t.C)}
      </div>
      <div class="ex-hcfg-actions">
        <button class="ex-hcfg-btn" id="ex-hcfg-reset">기본값 복원</button>
        <button class="ex-hcfg-btn" id="ex-hcfg-cancel">취소</button>
        <button class="ex-hcfg-btn primary" id="ex-hcfg-save">저장</button>
      </div>
    </div>`;
    const get = id => box.querySelector(`[data-hf="${id}"]`);
    const wKeys = ['w_commercial', 'w_collection', 'w_quality', 'w_supply'];
    const sumEl = box.querySelector('#ex-hw-sum');
    const saveBtn = box.querySelector('#ex-hcfg-save');
    const refreshSum = () => {
      const s = wKeys.reduce((a, id) => a + (Number(get(id).value) || 0), 0);
      sumEl.textContent = s;
      const bad = Math.round(s) !== 100;
      sumEl.style.color = bad ? 'var(--oci-red)' : '#17A85A';
      saveBtn.disabled = bad;
      saveBtn.style.opacity = bad ? '0.5' : '';
    };
    wKeys.forEach(id => get(id).addEventListener('input', refreshSum));
    const fill = cfg => {
      const d = cfg.dimensions;
      const map = {
        w_commercial: d.commercial.weight, w_collection: d.collection.weight, w_quality: d.quality.weight, w_supply: d.supply.weight,
        c_base: d.commercial.base, c_won: d.commercial.perWon, c_active: d.commercial.perActive, c_contract: d.commercial.contractBonus,
        col_overdue: d.collection.perOverdue, q_quality: d.quality.perQuality, q_support: d.quality.perSupport, s_short: d.supply.shortScore,
        t_Ap: cfg.thresholds['A+'], t_A: cfg.thresholds.A, t_Bp: cfg.thresholds['B+'], t_B: cfg.thresholds.B, t_C: cfg.thresholds.C,
      };
      Object.keys(map).forEach(id => { const el = get(id); if (el) el.value = map[id]; });
      refreshSum();
    };
    box.querySelector('#ex-hcfg-cancel').addEventListener('click', () => this._renderHealthCriteria());
    box.querySelector('#ex-hcfg-reset').addEventListener('click', () => fill(this._healthDefaults));
    saveBtn.addEventListener('click', () => this._saveHealthCfg(get));
    refreshSum();
  },
  async _saveHealthCfg(get) {
    const n = id => Number(get(id).value);
    const payload = {
      dimensions: {
        commercial: { weight: n('w_commercial'), base: n('c_base'), perWon: n('c_won'), perActive: n('c_active'), contractBonus: n('c_contract') },
        collection: { weight: n('w_collection'), perOverdue: n('col_overdue') },
        quality: { weight: n('w_quality'), perQuality: n('q_quality'), perSupport: n('q_support') },
        supply: { weight: n('w_supply'), shortScore: n('s_short') },
      },
      thresholds: { 'A+': n('t_Ap'), A: n('t_A'), 'B+': n('t_Bp'), B: n('t_B'), C: n('t_C') },
    };
    try {
      await API.put('/customer360/health-config', payload);
      if (typeof Toast !== 'undefined') Toast.success?.('Health 기준 저장 — 전체 등급에 반영됩니다');
      // 전사 데이터 + 모달 재계산 (등급 일괄 반영)
      Modal.close();
      try {
        const res = await API.get('/customer360/exec-summary');
        this._data = res.data;
        this._renderBody();
      } catch (_) {
        /* noop */
      }
      this._openKpiModal('health');
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('저장 실패: ' + (e.message || e));
    }
  },

  // ── 임원 AI 브리핑 (전사 요약) ──────────────────────────────
  _fmtWhen(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 16).replace('T', ' ');
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  _fmtAgo(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const diff = Date.now() - d.getTime();
    const day = Math.floor(diff / 86400000);
    if (day <= 0) {
      const hr = Math.floor(diff / 3600000);
      return hr <= 0 ? '방금' : `${hr}시간 전`;
    }
    return `${day}일 전`;
  },
  async _loadBrief() {
    try {
      const r = await API.get('/customer360/exec-brief');
      this._brief = r.data || null;
    } catch (_) {
      this._brief = null;
    }
    this._renderBrief();
  },
  _renderBrief() {
    const el = document.getElementById('ex-brief');
    if (!el) return;
    const b = this._brief;
    const when = b && b.generated_at ? this._fmtWhen(b.generated_at) : null;
    const ago = b && b.generated_at ? this._fmtAgo(b.generated_at) : null;
    const days =
      b && b.generated_at
        ? Math.floor((Date.now() - new Date(b.generated_at).getTime()) / 86400000)
        : null;
    const stale = days !== null && days >= 7; // 전사 브리핑은 1주 경과 시 갱신 권장
    const list = (arr, cls) =>
      Array.isArray(arr) && arr.length
        ? `<ul class="ex-brief-ul ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
        : '';
    const header = `<div class="ex-brief-head">
        <span class="ex-brief-t">AI 임원 브리핑</span>
        ${when ? `<span class="ex-brief-when">생성 시점 · ${esc(when)}${ago ? ` (${esc(ago)})` : ''}</span>` : '<span class="ex-brief-when">아직 생성 안 됨</span>'}
        ${stale ? '<span class="ex-brief-stale">갱신 권장</span>' : ''}
        <button class="btn btn-sm ${b ? 'btn-ghost' : 'btn-primary'}" id="ex-brief-gen" style="margin-left:auto">${b ? '다시 생성' : 'AI 임원 브리핑 생성'}</button>
      </div>`;
    el.innerHTML = `<div class="ex-brief">${header}${
      b
        ? `${b.headline ? `<div class="ex-brief-hl">${esc(b.headline)}</div>` : ''}
           ${list(b.key_points, 'kp')}
           <div class="ex-brief-cols">
             ${b.recommended_actions && b.recommended_actions.length ? `<div class="ex-brief-box act"><div class="ex-brief-box-h">권고 액션</div>${list(b.recommended_actions, '')}</div>` : ''}
             ${b.top_risks && b.top_risks.length ? `<div class="ex-brief-box risk"><div class="ex-brief-box-h">주요 리스크</div>${list(b.top_risks, '')}</div>` : ''}
           </div>`
        : '<div class="ex-brief-empty">전사 KPI·리스크를 바탕으로 임원용 요약을 생성합니다. 위 버튼을 누르세요.</div>'
    }</div>`;
    document.getElementById('ex-brief-gen')?.addEventListener('click', () => this._generateBrief());
  },
  async _generateBrief() {
    const el = document.getElementById('ex-brief');
    if (el)
      el.innerHTML = `<div class="ex-brief"><div class="ex-brief-empty">AI가 전사 데이터를 분석 중…</div></div>`;
    try {
      const r = await API.post('/customer360/exec-brief', {});
      this._brief = r.data;
      if (typeof Toast !== 'undefined') Toast.success?.('임원 브리핑 생성 완료');
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('생성 실패: ' + (e.message || e));
    }
    this._renderBrief();
  },
};
