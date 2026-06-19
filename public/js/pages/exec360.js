'use strict';
// =============================================================
// Exec360Page — 임원 360 요약 (전사 대시보드)
//
// 전사 KPI + 소재 라이프사이클 단계 분포 + Top 계정 + 리스크 요약.
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
        .ex-kpi{border:1px solid var(--border);border-radius:10px;padding:13px 15px;background:var(--surface)}
        .ex-kpi .l{font-size:12px;color:var(--text-2)}
        .ex-kpi .v{font-size:24px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
        .ex-kpi .s{font-size:11px;color:var(--text-3);margin-top:1px}
        .ex-sec{font-size:13px;font-weight:700;margin:18px 0 10px}
        .ex-stage{display:flex;align-items:flex-end;gap:10px;height:120px;border-bottom:1px solid var(--border);padding-bottom:2px}
        .ex-scol{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%}
        .ex-scol .bar{width:64%;border-radius:6px 6px 0 0;min-height:3px}
        .ex-scol .n{font-size:13px;font-weight:700}
        .ex-slab{display:flex;gap:10px;margin:6px 0 18px}
        .ex-slab span{flex:1;text-align:center;font-size:11px;color:var(--text-2)}
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

  _renderBody() {
    const d = this._data;
    const k = d.kpis;
    const maxStage = Math.max(1, ...d.stage_distribution.map(s => s.count));
    const sub = document.getElementById('ex-sub');
    if (sub) sub.textContent = `전사 · Top 계정 ${d.top_accounts.length} · 단계 소재 ${d.stage_distribution.reduce((a, s) => a + s.count, 0)}`;

    const kpis = `<div class="ex-kpis">
      <div class="ex-kpi"><div class="l">가중 예상매출</div><div class="v">${this._won(k.weighted_expected)}</div><div class="s">진행 딜 가중합</div></div>
      <div class="ex-kpi"><div class="l">진행 딜</div><div class="v">${k.active_deals}건</div><div class="s">활성 파이프라인</div></div>
      <div class="ex-kpi"><div class="l">수주율</div><div class="v">${k.win_rate === null || k.win_rate === undefined ? '-' : k.win_rate + '%'}</div><div class="s">수주/(수주+실주)</div></div>
      <div class="ex-kpi"><div class="l">평균 Health</div><div class="v">${k.avg_health}</div><div class="s">Top 계정 기준</div></div>
      <div class="ex-kpi"><div class="l">품질 오픈</div><div class="v" style="color:${k.open_quality ? 'var(--oci-red)' : ''}">${k.open_quality}건</div><div class="s">VOC/NCR 미해결</div></div>
      <div class="ex-kpi"><div class="l">CAPA 부족 계정</div><div class="v" style="color:${k.capa_short_accounts ? 'var(--oci-red)' : ''}">${k.capa_short_accounts}곳</div><div class="s">생산 < 수요</div></div>
    </div>`;

    const stage = `<div class="ex-sec">소재 라이프사이클 단계 분포</div>
      <div class="ex-stage">
        ${d.stage_distribution
          .map(s => `<div class="ex-scol"><span class="n">${s.count}</span><div class="bar" style="height:${Math.round((s.count / maxStage) * 100)}%;background:${this._STAGE_COLOR[s.stage] || '#2357E8'}"></div></div>`)
          .join('')}
      </div>
      <div class="ex-slab">${d.stage_distribution.map(s => `<span>${esc(s.label)}</span>`).join('')}</div>`;

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
    body.innerHTML = kpis + stage + accounts + risks;
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
  },
};
