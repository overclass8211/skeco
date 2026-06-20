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
        .ex-kpi{border:1px solid var(--border);border-radius:10px;padding:15px 16px;background:var(--surface)}
        .ex-kpi .l{font-size:12.5px;color:var(--text-2);font-weight:600}
        .ex-kpi .v{font-size:28px;font-weight:700;margin-top:5px;color:var(--text-1);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
        .ex-kpi .s{font-size:11.5px;color:var(--text-3);margin-top:2px}
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
        .ex-flow{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:2px 0 6px;margin-bottom:6px}
        .ex-fstep{flex:1;min-width:92px;border:1px solid var(--border);border-radius:10px;padding:12px 10px 11px;text-align:center;position:relative;background:var(--surface)}
        .ex-ftop{height:4px;border-radius:3px;background:var(--c,#2357E8);margin-bottom:9px}
        .ex-fcount{font-size:24px;font-weight:700;color:var(--text-1);line-height:1.1;font-variant-numeric:tabular-nums}
        .ex-flabel{font-size:12.5px;color:var(--text-1);margin-top:6px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ex-fpct{font-size:13px;color:var(--text-1);font-weight:700;margin-top:5px;font-variant-numeric:tabular-nums}
        .ex-fpct .u{font-size:11px;font-weight:600;color:var(--text-3)}
        .ex-fbar{height:5px;border-radius:3px;background:var(--surface-2);margin-top:7px;overflow:hidden}
        .ex-fbar > i{display:block;height:100%;border-radius:3px;background:var(--c,#2357E8)}
        .ex-fstep.ex-fzero{opacity:.5}
        .ex-farrow{display:flex;align-items:center;color:var(--text-3);padding:0 5px;flex-shrink:0}
        .ex-fmax-chip{position:absolute;top:6px;right:6px;font-size:9px;font-weight:700;color:#fff;background:var(--c,#2357E8);border-radius:5px;padding:1px 5px}
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

    const stageTotal = d.stage_distribution.reduce((a, s) => a + s.count, 0) || 1;
    const stageSteps = d.stage_distribution
      .map((s, i) => {
        const color = this._STAGE_COLOR[s.stage] || '#2357E8';
        const isMax = maxStage > 0 && s.count === maxStage;
        const pct = Math.round((s.count / stageTotal) * 100);
        const zero = s.count === 0 ? ' ex-fzero' : '';
        const st = isMax ? `--c:${color};border-color:${color};background:${color}0d` : `--c:${color}`;
        const step = `<div class="ex-fstep${isMax ? ' ex-fmax' : ''}${zero}" style="${st}">
          ${isMax ? '<span class="ex-fmax-chip">최다</span>' : ''}
          <div class="ex-ftop"></div>
          <div class="ex-fcount">${s.count}</div>
          <div class="ex-flabel" title="${esc(s.label)}">${esc(s.label)}</div>
          <div class="ex-fpct">${pct}<span class="u">%</span></div>
          <div class="ex-fbar" title="비중 ${pct}%"><i style="width:${pct}%"></i></div>
        </div>`;
        const arrow = i < d.stage_distribution.length - 1 ? '<span class="ex-farrow">→</span>' : '';
        return step + arrow;
      })
      .join('');
    const stage = `<div class="ex-sec">공정 라이프사이클 단계 분포 <span style="font-size:11.5px;font-weight:400;color:var(--text-3)">발굴 → 납품 · 총 ${stageTotal}개 소재</span></div>
      <div class="ex-flow">${stageSteps}</div>`;

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
    this._loadBrief();
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
