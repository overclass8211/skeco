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
        /* 공정 라이프사이클 — 스트림(퍼널) 그래픽 */
        .ex-fn-wrap{margin-bottom:8px}
        .ex-fn{display:block;width:100%;height:auto;overflow:visible}
        .ex-fn-col{cursor:pointer}
        .ex-fn-col:hover circle{r:8}
        .ex-fn-col:hover .ex-fn-label{fill:var(--oci-red)}
        .ex-fn-count{font-size:20px;font-weight:700;fill:var(--text-1)}
        .ex-fn-max{font-size:10px;font-weight:700;fill:var(--oci-red)}
        .ex-fn-label{font-size:13px;font-weight:600;fill:var(--text-1)}
        .ex-fn-label.ex-fn-zero{fill:var(--text-3)}
        .ex-fn-pct{font-size:12px;font-weight:700;fill:var(--text-3)}
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

  _renderBody() {
    const d = this._data;
    const k = d.kpis;
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
    this._loadBrief();
  },

  // ── 공정 라이프사이클 — 스트림(퍼널) 그래픽 + 단계 클릭 ──────
  _renderStageFunnel(dist, total) {
    const N = dist.length;
    if (!N) return '';
    const max = Math.max(1, ...dist.map(s => s.count));
    const W = 1080;
    const baseY = 120;
    const minH = 8;
    const maxH = 104;
    const colW = W / N;
    const cx = i => colW * i + colW / 2;
    const ty = c => baseY - (minH + (c / max) * (maxH - minH));
    const pts = dist.map((s, i) => ({
      ...s,
      x: cx(i),
      y: ty(s.count),
      color: this._STAGE_COLOR[s.stage] || '#2357E8',
      pct: Math.round((s.count / total) * 100),
    }));
    const maxIdx = pts.findIndex(p => p.count === max);
    // 채움 영역 (스트림) — 중심점 직선 연결, baseline 으로 닫음
    let area = `M ${pts[0].x.toFixed(1)} ${baseY}`;
    pts.forEach(p => (area += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`));
    area += ` L ${pts[N - 1].x.toFixed(1)} ${baseY} Z`;
    const cols = pts
      .map(
        (p, i) => `
      <g class="ex-fn-col" data-stage="${p.stage}" data-label="${esc(p.label)}">
        <rect x="${(colW * i).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${baseY + 44}" fill="transparent"/>
        <line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${baseY}" stroke="${p.color}" stroke-width="2.5" opacity="0.4"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === maxIdx ? 7 : 5}" fill="${p.color}"/>
        <text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" class="ex-fn-count">${p.count}</text>
        ${i === maxIdx ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 26).toFixed(1)}" text-anchor="middle" class="ex-fn-max">최다</text>` : ''}
        <text x="${p.x.toFixed(1)}" y="${baseY + 20}" text-anchor="middle" class="ex-fn-label${p.count === 0 ? ' ex-fn-zero' : ''}">${esc(p.label)}</text>
        <text x="${p.x.toFixed(1)}" y="${baseY + 36}" text-anchor="middle" class="ex-fn-pct">${p.pct}%</text>
      </g>`
      )
      .join('');
    return `<div class="ex-fn-wrap"><svg class="ex-fn" viewBox="0 0 ${W} ${baseY + 44}" width="100%" role="img" aria-label="공정 라이프사이클 단계 분포">
      <defs><linearGradient id="exFnGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(35,87,232,0.18)"/><stop offset="1" stop-color="rgba(35,87,232,0.02)"/>
      </linearGradient></defs>
      <line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>
      <path d="${area}" fill="url(#exFnGrad)" stroke="#2357E8" stroke-width="1.5" stroke-opacity="0.5"/>
      ${cols}
    </svg></div>`;
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
