'use strict';
// =============================================================
// Customer360Page — 고객·제품 360뷰 (라이프사이클 개선판)
//
// 별도 메인메뉴. 고객사 선택 → 라이프사이클 조망 대시보드:
//   헤더(Health/가중매출/리스크) + "지금 이 계정은" 내러티브
//   [라이프사이클] 소재별 발굴→샘플→평가→Spec-in→양산→납품 보드
//                 + 수요→생산(CAPA)→수주 흐름 + 품질 + AI 추천 액션
//   [영업기회] [활동] [AI 브리핑]
// 편집: 소재 추가/수정, 월 Forecast 입력 (manager+)
// 데이터: /api/customer360/customers, /:id, POST/PUT materials, POST forecasts
// =============================================================
const Customer360Page = {
  _customers: [],
  _custId: null,
  _data: null,
  _tab: 'lifecycle',

  _STAGES: [
    ['discovery', '발굴'],
    ['sample', '샘플'],
    ['evaluation', '평가'],
    ['specin', 'Spec-in'],
    ['massprod', '양산'],
    ['delivery', '납품'],
  ],
  _FC_MONTHS: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
  _fcData: null,
  _cmpVer: null,

  _ic: {
    deal: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    proposal: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sample: '<path d="M9 3h6M10 3v6.5L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3"/>',
    quality: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  },
  _svg(name, size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${this._ic[name] || this._ic.activity}</svg>`;
  },
  _won(v) {
    return Fmt.amount(Number(v) || 0, 'KRW');
  },
  _qty(v, unit) {
    return (Math.round(Number(v) || 0)).toLocaleString('ko-KR') + (unit || '');
  },

  async render() {
    document.getElementById('content').innerHTML = `
      <style>
        .c360-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
        .c360-bar h2{font-size:18px;font-weight:700;margin:0}
        .c360-pick{margin-left:auto;display:flex;gap:8px;align-items:center}
        .c360-pick input{height:34px;width:280px;border:1px solid var(--border);border-radius:7px;padding:0 10px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .c360-cb-item{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
        .c360-cb-name{font-size:13px;font-weight:600;color:var(--text-1)}
        .c360-cb-meta{font-size:11px;color:var(--text-3);white-space:nowrap}
        /* 고급 필터 */
        .c360-fbtn{height:34px;padding:0 12px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text-2);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
        .c360-fbtn.on,.c360-fbtn:hover{border-color:var(--oci-red);color:var(--oci-red)}
        .c360-fbtn.primary{background:var(--oci-red);border-color:var(--oci-red);color:#fff}
        .c360-fbtn.primary:hover{filter:brightness(.95);color:#fff}
        /* 플로팅 드롭다운 — 대시보드를 밀지 않고 일시적으로 오버레이 */
        .c360-topwrap{position:relative;z-index:40}
        .c360-filter{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:50;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:12px 16px;box-shadow:0 10px 32px rgba(0,0,0,.16)}
        /* 고객지원 스타일 컨트롤 행 */
        .c360-fctrls{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
        .c360-fctrl{display:flex;flex-direction:column;gap:3px}
        .c360-fctrl>label{font-size:11px;color:var(--text-3)}
        .c360-fctrl select,.c360-fctrl input{height:32px;border:1px solid var(--border);border-radius:6px;padding:0 9px;font-size:13px;background:var(--surface);color:var(--text-1);min-width:130px}
        .c360-fctrl-actions{display:flex;gap:6px;align-items:flex-end;margin-left:auto}
        .c360-fctrl-actions .c360-fbtn{height:32px}
        .c360-frow{display:flex;align-items:center;gap:10px;margin-bottom:8px}
        .c360-flab{font-size:12px;font-weight:700;color:var(--text-2);width:62px;flex-shrink:0}
        .c360-frow select{height:30px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:13px;background:var(--surface);color:var(--text-1)}
        .c360-chips{display:flex;flex-wrap:wrap;gap:6px}
        .c360-chip{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;transition:all .12s}
        .c360-chip.on{background:var(--oci-red);border-color:var(--oci-red);color:#fff;font-weight:600}
        .c360-fresults{margin-top:10px;border-top:1px solid var(--border);padding-top:8px;max-height:340px;overflow:auto}
        .c360-fcount{font-size:11.5px;color:var(--text-3);margin-bottom:6px}
        .c360-fhint{font-size:12px;color:var(--text-3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
        .c360-fhint b{color:var(--oci-red);font-variant-numeric:tabular-nums}
        .c360-fitem{display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:7px;cursor:pointer}
        .c360-fitem:hover{background:var(--surface-2,rgba(0,0,0,.03))}
        .c360-fitem .gr{width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0}
        .c360-fi-name{font-size:13px;font-weight:600;color:var(--text-1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .c360-fi-meta{font-size:11.5px;color:var(--text-3);white-space:nowrap}
        .c360-fi-risk{display:flex;gap:4px;flex-shrink:0}
        .c360-empty{padding:60px 20px;text-align:center;color:var(--text-3)}
        /* 상단 한 행 — 헤더(이름·지표·리스크) + 헬스 점수 카드 나란히 */
        .c360-toprow{display:flex;gap:12px;align-items:stretch;flex-wrap:wrap;margin-bottom:12px}
        .c360-toprow .c360-head{flex:1 1 440px;margin-bottom:0}
        .c360-toprow .c360-health-bd2{flex:1 1 360px;margin-bottom:0;max-width:none}
        .c360-head{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:12px}
        .c360-grade{width:54px;height:54px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0}
        .c360-avatar{width:48px;height:48px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;letter-spacing:-.02em}
        .c360-head-main{flex:0 1 auto;min-width:140px}
        .c360-head-metrics{margin-left:auto}
        .c360-head-name{font-size:18px;font-weight:700}
        .c360-head-sub{font-size:12px;color:var(--text-3);margin-top:2px}
        .c360-head-metrics{display:flex;gap:22px;flex-wrap:wrap}
        .c360-metric .v{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
        .c360-metric .l{font-size:11px;color:var(--text-3)}
        .c360-risks{display:flex;gap:6px;flex-wrap:wrap}
        .c360-risk{font-size:11px;padding:3px 9px;border-radius:999px;font-weight:600}
        .c360-risk.high{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .c360-risk.medium{background:rgba(245,156,0,.12);color:#b45309}
        .c360-risk.low{background:var(--surface-2);color:var(--text-2)}
        .c360-risk-link{cursor:pointer;transition:filter .12s}
        .c360-risk-link:hover{filter:brightness(0.94);text-decoration:underline}
        /* Health "왜 이 등급?" 분해 */
        .c360-health-bd{border:1px solid var(--border);border-radius:10px;padding:12px 16px;background:var(--surface);margin-bottom:12px}
        .c360-hb-h{font-size:12.5px;font-weight:700;color:var(--text-1);margin-bottom:10px}
        .c360-hb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 18px}
        .c360-hb-item{min-width:0}
        .c360-hb-top{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;color:var(--text-2);margin-bottom:4px}
        .c360-hb-top b{font-size:14px;color:var(--text-1);font-variant-numeric:tabular-nums}
        .c360-hb-track{height:6px;border-radius:4px;background:var(--surface-2,rgba(0,0,0,.06));overflow:hidden}
        .c360-hb-track span{display:block;height:100%;border-radius:4px}
        .c360-hb-w{font-size:10.5px;color:var(--text-3);margin-top:3px}
        /* Health 카드 v2 — 종합 도넛 + 컴팩트 4축 (폭 제한·막대 강조) */
        .c360-health-bd2{display:flex;gap:24px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:16px 22px;margin-bottom:12px;background:var(--surface);max-width:900px}
        .c360-hb2-left{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0}
        .c360-donut{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center}
        .c360-donut-in{width:62px;height:62px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
        .c360-donut-g{font-size:24px;font-weight:800;line-height:1}
        .c360-donut-s{font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums}
        .c360-hb2-cap{font-size:11px;color:var(--text-3)}
        .c360-hb2-right{flex:1;min-width:0}
        .c360-hb2-h{font-size:13px;font-weight:700;color:var(--text-1);margin-bottom:10px}
        .c360-hb2-row{display:grid;grid-template-columns:118px minmax(120px,300px) 40px 44px;align-items:center;gap:12px;margin:7px 0}
        .c360-hb2-row.low .c360-hb2-lab{color:var(--oci-red);font-weight:700}
        .c360-hb2-lab{font-size:12.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .c360-hb2-min{font-size:9.5px;font-weight:700;color:#fff;background:var(--oci-red);border-radius:4px;padding:1px 4px;margin-left:3px}
        .c360-hb2-track{height:14px;border-radius:7px;background:var(--surface-2,rgba(0,0,0,.06));overflow:hidden}
        .c360-hb2-track span{display:block;height:100%;border-radius:7px;transition:width .3s}
        .c360-hb2-sc{font-size:15px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
        .c360-hb2-w{font-size:11px;color:var(--text-3);text-align:right}
        /* AI 추천 액션 카드 v2 */
        .c360-act2{display:flex;gap:12px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:11px 14px;margin-bottom:8px}
        .c360-act2-link{cursor:pointer;transition:border-color .12s,box-shadow .12s}
        .c360-act2-link:hover{border-color:var(--oci-red);box-shadow:0 2px 8px rgba(0,0,0,.05)}
        .c360-act2-pri{font-size:11px;font-weight:700;border-radius:6px;padding:3px 9px;flex-shrink:0}
        .c360-act2-body{flex:1;min-width:0}
        .c360-act2-title{font-size:13px;font-weight:600;color:var(--text-1)}
        .c360-act2-owner{font-size:11px;font-weight:600;color:var(--text-3);background:var(--surface-2,rgba(0,0,0,.05));border-radius:5px;padding:1px 6px;margin-left:4px}
        .c360-act2-detail{font-size:12px;color:var(--text-2);margin-top:3px;line-height:1.45}
        .c360-act2-go{font-size:12px;font-weight:600;color:var(--oci-red);white-space:nowrap;flex-shrink:0}
        /* 단계 정합성 인사이트 */
        .c360-align{border:1px solid var(--border);border-radius:10px;padding:11px 16px;margin-bottom:12px;background:var(--surface)}
        .c360-align-h{font-size:12.5px;font-weight:700;color:var(--text-1);display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
        .c360-align-map{font-size:12px;font-weight:500;color:var(--text-2)}
        .c360-align-map b{color:var(--text-1)}
        .c360-align-flags{display:flex;flex-direction:column;gap:5px}
        .c360-align-flag{font-size:12px;padding:5px 10px;border-radius:7px;line-height:1.4}
        .c360-align-flag.high{background:rgba(230,51,41,.08);color:var(--oci-red);border-left:3px solid var(--oci-red)}
        .c360-align-flag.medium{background:rgba(245,156,0,.1);color:#b45309;border-left:3px solid #F59C00}
        .c360-align-flag.info{background:var(--surface-2,rgba(0,0,0,.04));color:var(--text-2);border-left:3px solid var(--text-3)}
        .c360-align.ok .c360-align-h{margin-bottom:0}
        .c360-align-ok{font-size:12px;color:#17A85A;font-weight:600}
        .c360-narr{background:var(--oci-red-light,rgba(230,51,41,.06));border-radius:8px;padding:10px 14px;font-size:13px;color:var(--text-1);margin-bottom:16px;line-height:1.6;display:flex;gap:8px;align-items:flex-start}
        .c360-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
        .c360-tab{padding:9px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-3);border-bottom:2px solid transparent;margin-bottom:-1px}
        .c360-tab.active{color:var(--oci-red);border-bottom-color:var(--oci-red)}
        .c360-group{margin-bottom:28px}
        .c360-group:last-child{margin-bottom:0}
        .c360-group-h{font-size:13px;font-weight:700;color:var(--text-1);margin:0 0 12px;padding-bottom:7px;border-bottom:1px solid var(--border)}
        .c360-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:18px}
        .c360-kpi{border:1px solid var(--border);border-radius:9px;padding:10px 12px;background:var(--surface)}
        .c360-kpi .h{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2);margin-bottom:4px}
        .c360-kpi .v{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
        .c360-kpi .s{font-size:11px;color:var(--text-3);margin-top:1px}
        .c360-kpi-link{cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .12s}
        .c360-kpi-link:hover{border-color:var(--oci-red);box-shadow:0 2px 8px rgba(0,0,0,.06);transform:translateY(-1px)}
        .c360-qrow{cursor:pointer}
        .c360-qrow:hover td{background:var(--surface-2,rgba(0,0,0,.03))}
        .lc-card-link{cursor:pointer;transition:border-color .12s,box-shadow .12s}
        .lc-card-link:hover{border-color:var(--oci-red);box-shadow:0 2px 10px rgba(0,0,0,.06)}
        .c360-sec{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin:18px 0 10px}
        .c360-sec .btn-add{margin-left:auto;font-size:12px;font-weight:500}
        .lc-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin-bottom:11px}
        /* 공정 라이프사이클 스테퍼 시인성 강화 (.lc-card 범위만) */
        .lc-card .ss-dot{width:34px;height:34px;font-size:14px;border-width:2.5px;margin-bottom:9px}
        .lc-card .ss-step::before{top:17px;height:4px}
        .lc-card .ss-now .ss-dot{box-shadow:0 0 0 5px var(--oci-red-light)}
        .lc-card .ss-label{font-size:12.5px}
        .lc-card .ss-now-chip{font-size:10px}
        .lc-top{display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap}
        .lc-name{font-weight:700;font-size:14px}
        .pill{font-size:11px;padding:2px 8px;border-radius:6px}
        .pill-info{background:rgba(35,87,232,.1);color:#2357E8}
        .pill-mut{background:var(--surface-2);color:var(--text-2)}
        .pill-danger{background:rgba(230,51,41,.1);color:var(--oci-red)}
        .pill-warn{background:rgba(245,156,0,.14);color:#b45309}
        .lc-edit{margin-left:auto;display:flex;gap:6px}
        .lc-mini{border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px;padding:2px 6px;border-radius:6px}
        .lc-mini:hover{background:var(--surface-2);color:var(--text-1)}
        .lc-track{display:flex;align-items:flex-start;position:relative;margin:12px 0 12px}
        .lc-step{flex:1;text-align:center;font-size:11px;position:relative;color:var(--text-3)}
        .lc-dot{width:18px;height:18px;border-radius:50%;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;font-size:10px;border:1.5px solid var(--border);background:var(--surface);color:var(--text-3)}
        .lc-done .lc-dot{background:#17A85A;border-color:#17A85A;color:#fff}
        .lc-now .lc-dot{background:#2357E8;border-color:#2357E8;color:#fff}
        .lc-now{color:#2357E8;font-weight:700}
        .lc-line{position:absolute;top:9px;left:-50%;width:100%;height:1.5px;background:var(--border);z-index:0}
        .lc-step .lc-dot{position:relative;z-index:1}
        .lc-mrow{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-2)}
        .lc-mrow b{font-weight:700;color:var(--text-1)}
        .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
        .flow-box{flex:1;min-width:110px;border-radius:8px;padding:12px 14px;background:var(--surface-2)}
        .flow-box .l{font-size:11px;color:var(--text-2)}
        .flow-box .v{font-size:20px;font-weight:700}
        .c360-capa-link{cursor:pointer;transition:box-shadow .12s}
        .c360-capa-link:hover{box-shadow:0 2px 10px rgba(230,51,41,.15)}
        .c360-capa-ai{font-size:10px;font-weight:700;color:var(--oci-red)}
        /* CAPA 진단 모달 (좌측 정렬·경영진 스캔용) */
        #c360-capa-body{text-align:left}
        #c360-capa-body .data-table th.text-right{text-align:right}
        .c360-capa-sum{display:flex;gap:10px;margin-bottom:6px}
        .c360-capa-stat{flex:1;border:1px solid var(--border);border-radius:9px;padding:10px 14px;background:var(--surface)}
        .c360-capa-stat .l{display:block;font-size:11.5px;color:var(--text-3);margin-bottom:3px}
        .c360-capa-stat .v{font-size:21px;font-weight:800;color:var(--text-1);font-variant-numeric:tabular-nums}
        .c360-capa-stat .v.risk{color:var(--oci-red)}
        .c360-capa-cap{font-size:11px;color:var(--text-3);margin-bottom:14px}
        .c360-capa-ai-box{background:linear-gradient(135deg,rgba(230,51,41,.05),rgba(245,156,0,.04));border-radius:8px;padding:12px 14px;margin-bottom:14px}
        .c360-capa-diag{font-size:13px;line-height:1.6;color:var(--text-1)}
        .c360-capa-h{font-size:11px;font-weight:700;color:var(--text-3);margin-top:10px}
        .c360-capa-ul{margin:4px 0 0;padding-left:18px;line-height:1.7;font-size:12.5px;color:var(--text-2)}
        .c360-capa-ul.act li{color:var(--text-1)}
        .c360-capa-th{font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:6px}
        .c360-act{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:8px}
        .c360-act .ai{color:#2357E8;flex-shrink:0;margin-top:1px}
        .stage-pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--text-2);margin:1px 2px}
        .c360-tl{position:relative;border-left:2px solid var(--border);margin-left:8px;padding-left:18px}
        .c360-tl-item{position:relative;margin-bottom:16px}
        .c360-tl-dot{position:absolute;left:-27px;top:0;width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-2)}
        .c360-tl-title{font-size:13px;font-weight:600}
        .c360-tl-meta{font-size:11px;color:var(--text-3);margin-top:2px}
        .c360-brief{border:1px solid var(--border);border-radius:10px;padding:18px;background:var(--surface)}
        .c360-brief-head{font-size:15px;font-weight:700;line-height:1.5;background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.06));border-left:3px solid var(--oci-blue);padding:12px 14px;border-radius:8px;margin-bottom:14px}
      </style>
      <div class="c360-topwrap">
        <div class="c360-bar">
          <h2>고객·제품 360뷰</h2>
          <div class="c360-pick">
            <input id="c360-search" placeholder="고객사 검색…" autocomplete="off">
            <button id="c360-filter-btn" class="c360-fbtn" type="button">고급 필터</button>
          </div>
        </div>
        <div id="c360-filter" class="c360-filter" hidden></div>
      </div>
      <div id="c360-body">
        <div class="c360-empty">고객사를 선택하면 소재 라이프사이클 360뷰가 표시됩니다.</div>
      </div>
    `;

    await this._loadCustomers();
    this._attachPicker();
    // URL 라우트(#customer360/41)에 고객 id 있으면 우선, 없으면 마지막 본 고객 복원
    const route = typeof App !== 'undefined' && App._parseRoute ? App._parseRoute() : { page: '', params: [] };
    const routeId = route.page === 'customer360' && route.params[0] ? Number(route.params[0]) : 0;
    const last = routeId || Number(localStorage.getItem('c360_last') || 0);
    if (last && this._customers.some(c => c.id === last)) {
      const input = document.getElementById('c360-search');
      const c = this._customers.find(x => x.id === last);
      if (input && c) input.value = c.name;
      if (route.params[1]) this._tab = route.params[1]; // 딥링크 탭
      await this._select(last, { route: 'replace' });
    }
  },

  // 고객사 검색 콤보박스 — 입력 즉시 매칭 + 진행딜/파이프라인 배지
  _attachPicker() {
    const input = document.getElementById('c360-search');
    if (!input || typeof Combobox === 'undefined') return;
    if (this._cb) this._cb.destroy?.();
    this._cb = Combobox.attach({
      inputEl: input,
      minChars: 0,
      debounceMs: 120,
      allowCustom: false,
      fetchFn: q => {
        const s = (q || '').trim().toLowerCase();
        let list = this._filteredCustomers(); // 고급 필터(정렬·등급·리스크·사업유형) 반영
        if (s) list = list.filter(c => c.name.toLowerCase().includes(s) || (c.industry || '').toLowerCase().includes(s));
        return list.slice(0, 50);
      },
      renderItem: c =>
        `<div class="c360-cb-item"><span class="c360-cb-name">${esc(c.name)}</span><span class="c360-cb-meta">${c.open_deals ? '진행 ' + c.open_deals : ''}${c.pipeline_amount ? ' · ' + this._won(c.pipeline_amount) : ''}</span></div>`,
      onSelect: c => {
        input.value = c.name;
        this._select(c.id);
      },
    });
    const fbtn = document.getElementById('c360-filter-btn');
    fbtn?.addEventListener('click', e => {
      e.stopPropagation();
      const p = document.getElementById('c360-filter');
      if (!p) return;
      if (p.hasAttribute('hidden')) this._openFilter();
      else this._closeFilter();
    });
    // 바깥 클릭 시 드롭다운 닫기 (한 번만 바인딩)
    if (!this._filterOutsideBound) {
      this._filterOutsideBound = true;
      document.addEventListener('click', e => {
        const p = document.getElementById('c360-filter');
        if (!p || p.hasAttribute('hidden')) return;
        if (!e.target.closest('.c360-topwrap')) this._closeFilter();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') this._closeFilter();
      });
    }
  },
  _openFilter() {
    const p = document.getElementById('c360-filter');
    const fbtn = document.getElementById('c360-filter-btn');
    if (!p) return;
    p.removeAttribute('hidden');
    fbtn?.classList.add('on');
    this._renderFilterPanel();
    setTimeout(() => document.getElementById('cf-q')?.focus(), 0);
  },
  _closeFilter() {
    const p = document.getElementById('c360-filter');
    const fbtn = document.getElementById('c360-filter-btn');
    if (p) p.setAttribute('hidden', '');
    fbtn?.classList.remove('on');
  },

  _fstate: null,
  _fq: '',
  // 고급 필터 패널 — 고객지원(A/S) 스타일: 라벨드 컨트롤 + 초기화·적용 + 결과 목록
  _renderFilterPanel() {
    const panel = document.getElementById('c360-filter');
    if (!panel) return;
    if (!this._fstate) this._fstate = { sort: 'weighted', grade: '', risk: '', biz: '' };
    const f = this._fstate;
    const grades = ['A+', 'A', 'B+', 'B', 'C', 'D'];
    const bizAll = [...new Set(this._customers.flatMap(c => c.business_types || []))].sort();
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    panel.innerHTML = `
      <div class="c360-fctrls">
        <div class="c360-fctrl"><label>정렬</label><select id="cf-sort">
          ${opt('weighted', '가중매출 ↓', f.sort)}${opt('deals', '진행딜 ↓', f.sort)}${opt('name', '이름 ↑', f.sort)}
        </select></div>
        <div class="c360-fctrl"><label>Health 등급</label><select id="cf-grade">
          ${opt('', '전체', f.grade)}${grades.map(g => opt(g, g, f.grade)).join('')}
        </select></div>
        <div class="c360-fctrl"><label>리스크</label><select id="cf-risk">
          ${opt('', '전체', f.risk)}${opt('capa', 'CAPA 부족', f.risk)}${opt('quality', '품질 오픈', f.risk)}
        </select></div>
        <div class="c360-fctrl"><label>사업유형</label><select id="cf-biz">
          ${opt('', '전체', f.biz)}${bizAll.map(b => opt(b, b, f.biz)).join('')}
        </select></div>
        <div class="c360-fctrl"><label>고객사명</label><input id="cf-q" placeholder="고객사명" value="${esc(this._fq || '')}" autocomplete="off"></div>
        <div class="c360-fctrl-actions"><button class="c360-fbtn" id="cf-reset" type="button">초기화</button><button class="c360-fbtn primary" id="cf-apply" type="button">적용</button></div>
      </div>
      <div id="c360-fresults" class="c360-fresults"></div>`;
    panel.querySelector('#cf-apply').addEventListener('click', () => this._applyFilter());
    panel.querySelector('#cf-reset').addEventListener('click', () => this._resetFilter());
    panel.querySelector('#cf-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._applyFilter();
    });
    this._renderFilterResults(); // 패널 열 때 현재 조건으로 즉시 목록 표시
  },
  _applyFilter() {
    const g = id => document.getElementById(id);
    if (!g('cf-sort')) return;
    this._fstate = {
      sort: g('cf-sort').value,
      grade: g('cf-grade').value,
      risk: g('cf-risk').value,
      biz: g('cf-biz').value,
    };
    this._fq = (g('cf-q').value || '').trim();
    this._renderFilterResults();
  },
  _resetFilter() {
    this._fstate = { sort: 'weighted', grade: '', risk: '', biz: '' };
    this._fq = '';
    this._renderFilterPanel();
  },
  // 적용된 조건으로 거른 고객 목록 (고객지원 리스트 패턴) — 행 클릭 시 해당 360 열기
  _renderFilterResults() {
    const host = document.getElementById('c360-fresults');
    if (!host) return;
    const q = (this._fq || '').toLowerCase();
    let list = this._filteredCustomers();
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.industry || '').toLowerCase().includes(q));
    const rows = list
      .slice(0, 100)
      .map(c => {
        const gc = this._gradeColor(c.health_grade);
        const risks = [];
        if (c.has_capa_short) risks.push('<span class="pill pill-danger">CAPA</span>');
        if (c.open_quality > 0) risks.push(`<span class="pill pill-warn">품질 ${c.open_quality}</span>`);
        return `<div class="c360-fitem" data-cid="${c.id}">
          <span class="gr" style="background:${gc}">${esc(c.health_grade || '-')}</span>
          <span class="c360-fi-name">${esc(c.name)}</span>
          <span class="c360-fi-meta">${c.open_deals ? '진행 ' + c.open_deals + ' · ' : ''}${this._won(c.weighted)}</span>
          <span class="c360-fi-risk">${risks.join('')}</span>
        </div>`;
      })
      .join('');
    host.innerHTML = `<div class="c360-fcount">조건에 맞는 <b>${list.length}</b>곳${list.length > 100 ? ' (상위 100 표시)' : ''}</div>${
      list.length ? rows : '<div class="c360-empty" style="padding:24px">조건에 맞는 고객사가 없습니다.</div>'
    }`;
    host.querySelectorAll('.c360-fitem[data-cid]').forEach(el =>
      el.addEventListener('click', () => {
        const id = Number(el.dataset.cid);
        const c = this._customers.find(x => x.id === id);
        const input = document.getElementById('c360-search');
        if (input && c) input.value = c.name;
        // 패널 닫고 해당 고객 360 열기
        const p = document.getElementById('c360-filter');
        const fbtn = document.getElementById('c360-filter-btn');
        if (p) p.setAttribute('hidden', '');
        if (fbtn) fbtn.classList.remove('on');
        this._select(id);
      })
    );
  },

  // 현재 필터 상태로 거른+정렬한 고객 목록 (콤보박스·카운트 공용)
  _filteredCustomers() {
    const f = this._fstate || { sort: 'weighted', grade: '', risk: '', biz: '' };
    const list = this._customers.filter(c => {
      if (f.grade && c.health_grade !== f.grade) return false;
      if (f.risk === 'capa' && !c.has_capa_short) return false;
      if (f.risk === 'quality' && !(c.open_quality > 0)) return false;
      if (f.biz && !(c.business_types || []).includes(f.biz)) return false;
      return true;
    });
    return list.sort((a, b) =>
      f.sort === 'name' ? a.name.localeCompare(b.name) : f.sort === 'deals' ? b.open_deals - a.open_deals : b.weighted - a.weighted
    );
  },

  async _loadCustomers() {
    try {
      const res = await API.get('/customer360/customers');
      this._customers = res.data || [];
    } catch (_) {
      /* Toast 처리 */
    }
  },

  // 고객 선택 — opts.route: 'push'(기본) | 'replace' | 'none' (URL 반영 방식)
  async _select(id, opts = {}) {
    this._custId = id;
    this._fcData = null;
    this._cmpVer = null;
    this._samples = null;
    this._quality = null;
    this._qualityDocs = null;
    this._qualityRestricted = false;
    this._revenue = null;
    this._satisfaction = null;
    localStorage.setItem('c360_last', String(id));
    const body = document.getElementById('c360-body');
    if (body) body.innerHTML = `<div class="c360-empty">불러오는 중…</div>`;
    try {
      const res = await API.get('/customer360/' + id);
      this._data = res.data;
      this._renderDashboard();
      const mode = opts.route || 'push';
      if (mode !== 'none' && typeof App !== 'undefined') {
        const seg = this._tab && this._tab !== 'lifecycle' ? ['customer360', id, this._tab] : ['customer360', id];
        App._setRoute(seg, { replace: mode === 'replace' });
      }
    } catch (_) {
      if (body) body.innerHTML = `<div class="c360-empty">데이터를 불러오지 못했습니다.</div>`;
    }
  },

  // 탭 전환 단일 진입점 — active 토글 + 렌더 + URL 라우트 반영
  _setTab(tab, opts = {}) {
    if (!tab) return;
    this._tab = tab;
    document.querySelectorAll('.c360-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this._renderTab();
    const mode = opts.route || 'push';
    if (mode !== 'none' && this._custId && typeof App !== 'undefined') {
      const seg = tab === 'lifecycle' ? ['customer360', this._custId] : ['customer360', this._custId, tab];
      App._setRoute(seg, { replace: mode === 'replace' });
    }
  },

  // URL 라우트 복원 — 고객 선택 + 탭 (뒤로/앞으로·딥링크)
  async restore(id, tab) {
    if (!id) return;
    const targetTab = tab || 'lifecycle';
    if (this._custId !== id) {
      this._tab = targetTab;
      const input = document.getElementById('c360-search');
      const c = (this._customers || []).find(x => x.id === id);
      if (input && c) input.value = c.name;
      await this._select(id, { route: 'none' }); // URL 이미 정확 → 히스토리 손대지 않음
    } else if (this._tab !== targetTab) {
      this._setTab(targetTab, { route: 'none' });
    }
  },

  async _reload() {
    if (this._custId) await this._select(this._custId);
  },

  // 회사 모노그램 아바타 — 이름 첫 글자 + 회사별 고정 색상(로고 대용)
  _avatar(name) {
    const n = (name || '').trim();
    const initial = /^[A-Za-z]/.test(n) ? n.slice(0, 2).toUpperCase() : n.slice(0, 1) || '·';
    let hsum = 0;
    for (let i = 0; i < n.length; i++) hsum = (hsum * 31 + n.charCodeAt(i)) % 360;
    return `<div class="c360-avatar" style="background:hsl(${hsum} 52% 42%)">${esc(initial)}</div>`;
  },

  _gradeColor(g) {
    if (g === 'A+' || g === 'A') return '#0F7A3F';
    if (g === 'B+' || g === 'B') return '#2357E8';
    if (g === 'C') return '#F59C00';
    return '#E63329';
  },

  // "왜 이 등급?" — 4대 건강 축 점수 막대 (경영진 설명용)
  _healthBreakdownHtml(h) {
    const bd = h.health_breakdown;
    if (!bd || !Array.isArray(bd.dims) || !bd.dims.length) return '';
    const dims = bd.dims;
    const lowest = dims.reduce((a, b) => (b.score < a.score ? b : a), dims[0]);
    const sig = s => (s >= 80 ? '#17A85A' : s >= 60 ? '#2357E8' : s >= 40 ? '#F59C00' : '#E63329');
    const gc = this._gradeColor(h.health_grade);
    const score = h.health_score;
    const donut = `<div class="c360-donut" style="background:conic-gradient(${gc} ${score * 3.6}deg, var(--border) 0deg)">
        <div class="c360-donut-in"><span class="c360-donut-g" style="color:${gc}">${esc(h.health_grade)}</span><span class="c360-donut-s">${score}점</span></div>
      </div>`;
    const rows = dims
      .map(d => {
        const s = Number.isFinite(d.score) ? d.score : 0;
        const c = sig(s);
        const low = d === lowest && s < 80;
        return `<div class="c360-hb2-row${low ? ' low' : ''}">
          <span class="c360-hb2-lab">${esc(d.label)}${low ? ' <span class="c360-hb2-min">최저</span>' : ''}</span>
          <span class="c360-hb2-track"><span style="width:${s}%;background:${c}"></span></span>
          <span class="c360-hb2-sc" style="color:${c}">${s}</span>
          <span class="c360-hb2-w">${d.weight}%</span>
        </div>`;
      })
      .join('');
    return `<div class="c360-health-bd2">
      <div class="c360-hb2-left">${donut}<div class="c360-hb2-cap">종합 Health</div></div>
      <div class="c360-hb2-right">
        <div class="c360-hb2-h">왜 ${esc(h.health_grade)} 등급인가 — ${dims.length}대 축 점수(0~100)</div>
        ${rows}
      </div>
    </div>`;
  },

  // 영업딜 ↔ 공정 라이프사이클 단계 정합성
  _stageAlignHtml(h) {
    const a = h.stage_alignment;
    if (!a) return '';
    const sl = a.sales_label || '영업딜 없음';
    const ll = a.life_label || '소재 없음';
    const flags = a.flags || [];
    const map = `<span class="c360-align-map">영업딜 <b>${esc(sl)}</b> ↔ 공정 <b>${esc(ll)}</b></span>`;
    if (!flags.length) {
      return `<div class="c360-align ok"><div class="c360-align-h">단계 정합성 ${map}</div><span class="c360-align-ok">✓ 영업·공정 단계 정합 양호</span></div>`;
    }
    const chips = flags.map(f => `<span class="c360-align-flag ${f.level}">${esc(f.label)}</span>`).join('');
    return `<div class="c360-align"><div class="c360-align-h">단계 정합성 경보 ${map}</div><div class="c360-align-flags">${chips}</div></div>`;
  },

  _narrative() {
    const lc = this._data.lifecycle;
    const parts = [];
    const specin = lc.materials.find(m => m.lifecycle_stage === 'specin');
    if (specin) parts.push(`${esc(specin.material_name.split(' · ')[0])} <b>양산 승인 임박</b>`);
    const short = lc.materials.find(m => m.capa_short);
    if (short) parts.push(`${esc(short.material_name.split(' · ')[0])} <b>CAPA 부족 위험</b>`);
    const openQ = lc.quality.filter(q => q.status !== 'resolved').length;
    if (openQ) parts.push(`품질 이슈 <b>${openQ}건</b>`);
    if (!parts.length) parts.push('주요 리스크 없음 · 라이프사이클 정상 진행');
    return parts.join(' · ');
  },

  _renderDashboard() {
    const d = this._data;
    const h = d.header;
    const c = d.customer;
    const sub = [c.industry, c.region, c.country].filter(Boolean).join(' · ');
    const body = document.getElementById('c360-body');
    if (!body) return;
    body.innerHTML = `
      <div class="c360-toprow">
        <div class="c360-head">
          ${this._avatar(c.name)}
          <div class="c360-head-main">
            <div class="c360-head-name">${esc(c.name)}</div>
            <div class="c360-head-sub">${esc(sub || '-')}</div>
          </div>
          <div class="c360-head-metrics">
            <div class="c360-metric"><div class="v">${this._won(h.weighted_expected)}</div><div class="l">가중 예상매출</div></div>
            <div class="c360-metric"><div class="v">${h.active_count}건</div><div class="l">진행 딜</div></div>
            <div class="c360-metric"><div class="v">${h.won_count}건</div><div class="l">수주</div></div>
            <div class="c360-metric"><div class="v">${this._won(h.contract_amount)}</div><div class="l">계약액</div></div>
          </div>
          <div class="c360-risks">
            ${
              h.risks.length
                ? h.risks
                    .map(r => {
                      const tab = this._riskTab(r.label);
                      return `<span class="c360-risk ${r.level}${tab ? ' c360-risk-link' : ''}"${tab ? ` data-risktab="${tab}" title="클릭 시 해당 탭으로 이동"` : ''}>${esc(r.label)}</span>`;
                    })
                    .join('')
                : '<span class="c360-risk low">리스크 없음</span>'
            }
          </div>
        </div>
        ${this._healthBreakdownHtml(h)}
      </div>
      ${this._stageAlignHtml(h)}
      <div class="c360-narr">${this._svg('bulb', 16)}<span>${this._narrative()}</span></div>
      <div class="c360-tabs">
        ${[
          ['lifecycle', '현황'],
          ['qualification', '공급 자격'],
          ['commercial', '상거래'],
          ['relationship', '관계'],
          ['brief', 'AI 브리핑'],
        ]
          .map(([k, l]) => `<button class="c360-tab ${this._tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`)
          .join('')}
      </div>
      <div id="c360-tab-body"></div>
    `;
    body.querySelectorAll('.c360-tab').forEach(btn =>
      btn.addEventListener('click', () => this._setTab(btn.dataset.tab))
    );
    // 리스크 칩 클릭 → 관련 탭으로 이동 (실행형 경보)
    body.querySelectorAll('.c360-risk[data-risktab]').forEach(el =>
      el.addEventListener('click', () => this._setTab(el.dataset.risktab))
    );
    this._renderTab();
  },

  // 리스크 라벨 → 이동할 탭 매핑 (실행형 경보)
  _riskTab(label) {
    const s = String(label || '');
    if (/CAPA/i.test(s)) return 'lifecycle';
    if (/품질/.test(s)) return 'qualification';
    if (/수금|연체|매출|계약/.test(s)) return 'commercial';
    return null;
  },

  _renderTab() {
    const el = document.getElementById('c360-tab-body');
    if (!el) return;
    const sec = (title, html) =>
      `<section class="c360-group"><h3 class="c360-group-h">${esc(title)}</h3>${html}</section>`;
    const m = {
      // ① 현황 — 라이프사이클 + 수요·생산·수주 + 리스크 (한눈에)
      lifecycle: () => this._tabLifecycle(),
      // ② 공급 자격 — 샘플/평가 + 품질
      qualification: () => sec('샘플 / 평가', this._tabSamples()) + sec('품질', this._tabQuality()),
      // ③ 상거래 — 영업기회 + 포캐스트 + 계약/매출/수금
      commercial: () =>
        sec('영업기회', this._tabDeals()) +
        sec('포캐스트', this._tabForecast()) +
        sec('계약 / 매출 / 수금', this._tabRevenue()),
      // ④ 관계 — 만족도(NPS/CSAT) + 조직 + 활동
      relationship: () =>
        sec('고객 만족도 (NPS/CSAT)', this._tabSatisfaction()) +
        sec('조직', this._tabOrg()) +
        sec('활동', this._tabTimeline()),
      brief: () => this._tabBrief(),
    };
    el.innerHTML = (m[this._tab] || m.lifecycle)();
    this._bindTab(el);
  },

  _bindTab(el) {
    const t = this._tab;
    // ③ 상거래 = 영업기회 + 포캐스트 + 계약/매출/수금
    if (t === 'commercial') {
      el.querySelectorAll('tr[data-lead-id]').forEach(tr =>
        tr.addEventListener('click', () => {
          const id = Number(tr.dataset.leadId);
          if (typeof App !== 'undefined' && typeof App.openLeadDetail === 'function')
            App.openLeadDetail(id);
        })
      );
      if (!this._fcData) this._loadForecast();
      else this._bindForecast(el);
      if (!this._revenue) this._loadRevenue();
    }
    // ② 공급 자격 = 샘플/평가 + 품질
    if (t === 'qualification') {
      if (!this._samples) this._loadSamples();
      else this._bindSamples(el);
      if (!this._quality) this._loadQuality();
      else this._bindQuality(el);
    }
    // ④ 관계 = 만족도 + 조직 + 활동
    if (t === 'relationship') {
      if (!this._satisfaction) this._loadSatisfaction();
      else this._bindSatisfaction(el);
      this._bindOrg(el);
    }
    // ⑤ AI 브리핑 — 360 내 직접 생성/재생성
    if (t === 'brief') {
      el.querySelector('#c360-brief-gen')?.addEventListener('click', () => this._generateBrief());
      el.querySelector('#c360-brief-history')?.addEventListener('click', () => this._openBriefHistory());
    }
    if (t === 'lifecycle') {
      el.querySelector('#c360-add-mat')?.addEventListener('click', () => this._openMaterialModal(null));
      el.querySelector('#c360-gate-cfg')?.addEventListener('click', () => this._openGateConfig());
      el.querySelectorAll('[data-edit-mat]').forEach(b =>
        b.addEventListener('click', e => {
          e.stopPropagation();
          const mat = this._data.lifecycle.materials.find(m => m.id === Number(b.dataset.editMat));
          this._openMaterialModal(mat);
        })
      );
      el.querySelectorAll('[data-fc-mat]').forEach(b =>
        b.addEventListener('click', e => {
          e.stopPropagation();
          const mat = this._data.lifecycle.materials.find(m => m.id === Number(b.dataset.fcMat));
          this._openForecastModal(mat);
        })
      );
      // KPI 카드(진행딜/견적/제안/계약) → 상거래 탭 드릴다운
      el.querySelectorAll('.c360-kpi[data-ctab]').forEach(c =>
        c.addEventListener('click', () => this._gotoTab(c.dataset.ctab))
      );
      // 품질 이슈 행 → 품질관리(해당 고객 필터)
      el.querySelectorAll('.c360-qrow').forEach(tr =>
        tr.addEventListener('click', () => this._gotoQuality())
      );
      // 소재 카드 본문 → 연결 딜 1건이면 해당 딜 직행, 아니면 상거래(영업기회) 탭.
      // 편집은 '수정' 버튼으로.
      el.querySelectorAll('[data-mat-card]').forEach(card =>
        card.addEventListener('click', e => {
          if (e.target.closest('button')) return; // 수요입력/수정 버튼 제외
          const pid = card.dataset.primaryLead;
          if (pid && typeof App !== 'undefined' && typeof App.openLeadDetail === 'function') {
            App.openLeadDetail(Number(pid));
          } else {
            this._gotoTab('commercial');
          }
        })
      );
      // AI 추천 액션 카드 → 바로가기(상거래/공급자격 탭 또는 품질관리)
      el.querySelectorAll('.c360-act2[data-anav]').forEach(c =>
        c.addEventListener('click', () => {
          const t = c.dataset.anav;
          if (t === 'quality') this._gotoQuality();
          else this._gotoTab(t);
        })
      );
      // 부족 CAPA 박스 → AI 진단·대책 모달
      el.querySelector('#c360-capa-box')?.addEventListener('click', () => this._openCapaModal());
    }
  },

  // CAPA 부족 AI 진단·대책 모달
  async _openCapaModal() {
    if (typeof Modal === 'undefined' || !this._custId) return;
    Modal.open({
      title: 'CAPA 부족 — AI 진단·대책',
      width: 640,
      body: '<div id="c360-capa-body" style="padding:36px;text-align:center;color:var(--text-3)">생산능력 부족 분석 중…</div>',
    });
    try {
      const r = await API.post(`/customer360/${this._custId}/capa-diagnose`, {});
      const d = r.data || {};
      const f = d.flow || {};
      const qty = (n, u) => this._qty(Number(n) || 0, u || f.unit || '');
      const rows = (d.materials || [])
        .map(
          m =>
            `<tr><td><strong>${esc((m.material_name || '').split(' · ')[0])}</strong></td><td>${esc(m.business_type || '-')}</td><td class="text-right">${qty(m.demand, m.unit)}</td><td class="text-right">${qty(m.capacity, m.unit)}</td><td class="text-right" style="color:var(--oci-red);font-weight:700">${qty(m.gap, m.unit)}</td></tr>`
        )
        .join('');
      const ai = d.ai;
      const aiHtml = ai
        ? `<div class="c360-capa-ai-box">
            ${ai.diagnosis ? `<div class="c360-capa-diag">${esc(ai.diagnosis)}</div>` : ''}
            ${ai.causes && ai.causes.length ? `<div class="c360-capa-h">추정 원인</div><ul class="c360-capa-ul">${ai.causes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${ai.actions && ai.actions.length ? `<div class="c360-capa-h">권고 대책</div><ul class="c360-capa-ul act">${ai.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          </div>`
        : '<div style="font-size:12.5px;color:var(--text-3);padding:8px 0">AI 진단을 생성하지 못했습니다 (아래 수치 참조).</div>';
      const box = document.getElementById('c360-capa-body');
      if (box) {
        box.removeAttribute('style'); // 로딩 div 의 가운데정렬·패딩 제거 → 좌측 정렬 본문
        box.innerHTML = `
          <div class="c360-capa-sum">
            <div class="c360-capa-stat"><span class="l">CAPA 부족 소재</span><span class="v">${f.short_count ?? (d.materials || []).length}개</span></div>
            <div class="c360-capa-stat"><span class="l">부족 매출 리스크</span><span class="v risk">${this._won(f.risk_revenue || 0)}</span></div>
          </div>
          <div class="c360-capa-cap">소재별 단위가 달라 수량 합산 대신 건수·금액 기준으로 집계</div>
          ${aiHtml}
          <div class="c360-capa-th">소재별 부족</div>
          <div style="max-height:36vh;overflow:auto"><table class="data-table c360-capa-tbl" style="font-size:12.5px">
            <thead><tr><th>소재</th><th>사업유형</th><th class="text-right">수요</th><th class="text-right">생산</th><th class="text-right">부족</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:18px">부족 소재 없음</td></tr>'}</tbody>
          </table></div>`;
      }
    } catch (e) {
      const box = document.getElementById('c360-capa-body');
      if (box) box.innerHTML = `<div style="padding:24px;text-align:center;color:var(--oci-red)">분석 실패: ${esc(e.message || e)}</div>`;
    }
  },

  // 현황 탭 → 다른 탭으로 전환 (KPI 드릴다운)
  _gotoTab(tab) {
    if (!tab) return;
    this._setTab(tab);
    const body = document.getElementById('c360-tab-body');
    if (body) body.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },

  // 품질 이슈 → 전사 품질관리(해당 고객 필터)
  _gotoQuality() {
    if (typeof QualityPage !== 'undefined' && this._custId) {
      QualityPage._filter.customer_id = String(this._custId);
      QualityPage._filter.status = 'unresolved';
    }
    location.hash = '#quality';
  },

  _kpi(icon, label, value, sub, nav) {
    return `<div class="c360-kpi${nav ? ' c360-kpi-link' : ''}"${nav ? ` data-ctab="${nav}"` : ''}>
      <div class="h">${this._svg(icon, 13)} ${esc(label)}</div>
      <div class="v">${value}</div>
      ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
    </div>`;
  },

  _ribbon(stageIndex) {
    // 공통 라벨형 스테퍼 (시인성 강화 — 트랙 채움/현재 강조)
    const stages = this._STAGES.map(([key, label]) => ({ key, label }));
    const current = (this._STAGES[stageIndex] || this._STAGES[0])[0];
    return StageProgress.renderStepper({ stages, current });
  },

  _tabLifecycle() {
    const s = this._data.summary;
    const lc = this._data.lifecycle;
    const f = lc.demand_flow;
    const rb = this._data.header.revenue_breakdown || { month: 0, quarter: 0, annual: 0 };
    const kpis = `<div class="c360-kpis">
      ${this._kpi('deal', '진행 딜', `${s.deals.count}건`, this._won(s.deals.total_expected), 'commercial')}
      ${this._kpi('quote', '견적', `${s.quotes.count}건`, this._won(s.quotes.total_amount), 'commercial')}
      ${this._kpi('proposal', '제안', `${s.proposals.count}건`, this._won(s.proposals.total_expected), 'commercial')}
      ${this._kpi('contract', '계약', `${s.contracts.count}건`, this._won(s.contracts.total_amount), 'commercial')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px">
      <div class="flow-box"><div class="l">예상매출 · 월</div><div class="v">${this._won(rb.month)}</div></div>
      <div class="flow-box"><div class="l">분기</div><div class="v">${this._won(rb.quarter)}</div></div>
      <div class="flow-box"><div class="l">연간</div><div class="v">${this._won(rb.annual)}</div></div>
    </div>`;

    const board = lc.materials.length
      ? lc.materials.map(m => this._matCard(m)).join('')
      : '<div class="c360-empty">등록된 공급 품목이 없습니다. “공급 품목 등록”으로 시작하세요.</div>';

    const flow = `
      <div class="flow">
        <div class="flow-box" style="background:rgba(23,168,90,.08)"><div class="l" style="color:#17A85A">분기 예상 수주</div><div class="v" style="color:#17A85A">${this._won(f.expected_order)}</div></div>
        ${
          f.short_count > 0
            ? `<div class="flow-box c360-capa-link" id="c360-capa-box" title="AI 진단·대책 보기" style="background:rgba(230,51,41,.08)">
                 <div class="l" style="color:var(--oci-red)">CAPA 부족 소재 <span class="c360-capa-ai">AI 진단 ›</span></div>
                 <div class="v" style="color:var(--oci-red)">${f.short_count}개</div>
               </div>
               <div class="flow-box" style="background:rgba(230,51,41,.05)">
                 <div class="l" style="color:var(--oci-red)">부족 매출 리스크</div>
                 <div class="v" style="color:var(--oci-red)">${this._won(f.risk_revenue)}</div>
               </div>`
            : `<div class="flow-box" style="background:rgba(23,168,90,.06)"><div class="l" style="color:#17A85A">공급 충족</div><div class="v" style="color:#17A85A">정상</div></div>`
        }
      </div>`;

    const quality = lc.quality.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>케이스</th><th>소재</th><th>유형</th><th>심각도</th><th>상태</th><th>제목</th></tr></thead><tbody>
          ${lc.quality
            .map(q => {
              const mat = lc.materials.find(m => m.id === q.material_id);
              const sevCls = q.severity === 'high' ? 'pill-danger' : q.severity === 'medium' ? 'pill-warn' : 'pill-mut';
              return `<tr class="c360-qrow" title="품질관리에서 열기"><td class="mono">${esc(q.case_no)}</td><td>${esc(mat ? mat.material_name.split(' · ')[0] : '-')}</td>
                <td>${esc(q.type)}</td><td><span class="pill ${sevCls}">${esc(q.severity)}</span></td>
                <td>${esc(q.status)}</td><td>${esc(q.title)}</td></tr>`;
            })
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">품질 이슈 없음</div>';

    const PRIO = {
      high: { t: '긴급', c: 'var(--oci-red)', bg: 'rgba(230,51,41,.1)' },
      medium: { t: '중요', c: '#b45309', bg: 'rgba(245,156,0,.14)' },
      low: { t: '참고', c: 'var(--text-2)', bg: 'var(--surface-2,rgba(0,0,0,.05))' },
    };
    const actions = lc.actions.length
      ? lc.actions
          .map(a => {
            const p = PRIO[a.priority] || PRIO.medium;
            const title = a.title || a.text || '';
            return `<div class="c360-act2${a.nav ? ' c360-act2-link' : ''}"${a.nav ? ` data-anav="${a.nav}"` : ''}>
              <span class="c360-act2-pri" style="color:${p.c};background:${p.bg}">${p.t}</span>
              <div class="c360-act2-body">
                <div class="c360-act2-title">${esc(title)}${a.owner ? ` <span class="c360-act2-owner">${esc(a.owner)}</span>` : ''}</div>
                ${a.detail ? `<div class="c360-act2-detail">${esc(a.detail)}</div>` : ''}
              </div>
              ${a.nav ? '<span class="c360-act2-go">바로가기 ›</span>' : ''}
            </div>`;
          })
          .join('')
      : '<div class="c360-empty" style="padding:24px">추천 액션 없음</div>';

    // 랜딩 대시보드: KPI → 프로세스 흐름(수요·생산·수주) → 소재 라이프사이클 → 품질 → 액션
    return `
      ${kpis}
      <div class="c360-sec">분기 공급 리스크 (3개월)</div>
      ${flow}
      <div class="c360-sec">공정 라이프사이클 <span style="font-size:11.5px;font-weight:400;color:var(--text-3)">소재별 · 카드 클릭 시 영업기회</span>
        ${['team_lead', 'executive', 'admin', 'superadmin'].includes(App.currentUser?.role) ? '<button class="btn btn-sm" id="c360-gate-cfg" style="margin-right:6px" title="PLM 게이트 단계 설정">⚙ 게이트 설정</button>' : ''}
        <button class="btn btn-primary btn-sm btn-add" id="c360-add-mat">+ 공급 품목 등록</button>
      </div>
      ${board}
      <div class="c360-sec">품질 이슈</div>
      ${quality}
      <div class="c360-sec">AI 추천 다음 액션</div>
      ${actions}
    `;
  },

  // PLM 게이트 정의 관리 (설정형 — 단계 추가/수정/순서/매핑/활성) team_lead+
  async _openGateConfig() {
    let gates;
    try {
      gates = (await API.get('/customer360/gates?all=1')).data || [];
    } catch (e) {
      Toast.error('게이트 로드 실패: ' + (e.message || e));
      return;
    }
    this._gateOrigKeys = gates.map(g => g.gate_key);
    const stageOpts = cur =>
      `<option value="">(없음)</option>` +
      this._STAGES.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
    const row = g => `<tr data-grow>
        <td><input class="form-input gc-ord" type="number" style="width:54px" value="${g ? g.display_order : 99}"></td>
        <td><input class="form-input gc-key" style="width:84px" value="${g ? esc(g.gate_key) : ''}" ${g ? 'readonly' : ''} placeholder="KEY"></td>
        <td><input class="form-input gc-label" value="${g ? esc(g.gate_label) : ''}" placeholder="라벨"></td>
        <td><select class="form-input gc-stage" style="min-width:96px">${stageOpts(g ? g.lifecycle_stage : '')}</select></td>
        <td style="text-align:center"><input type="checkbox" class="gc-active" ${!g || g.is_active ? 'checked' : ''}></td>
        <td style="text-align:center"><button type="button" class="btn btn-sm gc-del" title="삭제">✕</button></td>
      </tr>`;
    Modal.open({
      title: 'PLM 게이트 설정',
      width: 660,
      body: `<div style="max-height:60vh;overflow:auto">
          <table class="data-table" style="font-size:12.5px;width:100%">
            <thead><tr><th style="width:54px">순서</th><th>키</th><th>라벨</th><th>매핑(6단계)</th><th>활성</th><th></th></tr></thead>
            <tbody id="gc-body">${gates.map(g => row(g)).join('')}</tbody>
          </table>
          <button type="button" class="btn btn-sm" id="gc-add" style="margin-top:8px">+ 게이트 추가</button>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">순서=표시순 · 키=고유 식별자(영문, 기존은 변경 불가) · 매핑=기존 6단계 연동 · 저장 시 일괄 적용</div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="gc-cancel">취소</button><button class="btn btn-primary" id="gc-save">저장</button>`,
      bind: {
        '#gc-cancel': () => Modal.close(),
        '#gc-save': () => this._saveGateConfig(),
        '#gc-add': () =>
          document.getElementById('gc-body').insertAdjacentHTML('beforeend', row(null)),
      },
      onOpen: () => {
        document.getElementById('gc-body')?.addEventListener('click', e => {
          const del = e.target.closest('.gc-del');
          if (del) del.closest('tr').remove();
        });
      },
    });
  },

  async _saveGateConfig() {
    const rows = [...document.querySelectorAll('#gc-body tr[data-grow]')];
    const items = [];
    for (const tr of rows) {
      const key = (tr.querySelector('.gc-key').value || '').trim();
      const label = (tr.querySelector('.gc-label').value || '').trim();
      if (!key || !label) {
        Toast.error('키·라벨은 필수입니다');
        return;
      }
      items.push({
        gate_key: key,
        gate_label: label,
        display_order: Number(tr.querySelector('.gc-ord').value) || 0,
        lifecycle_stage: tr.querySelector('.gc-stage').value || null,
        is_active: tr.querySelector('.gc-active').checked ? 1 : 0,
      });
    }
    const keys = items.map(i => i.gate_key);
    if (new Set(keys).size !== keys.length) {
      Toast.error('게이트 키가 중복되었습니다');
      return;
    }
    try {
      const remaining = new Set(keys);
      for (const k of this._gateOrigKeys || []) {
        if (!remaining.has(k)) await API.del('/customer360/gates/' + encodeURIComponent(k));
      }
      for (const it of items) await API.post('/customer360/gates', it);
      Toast.success('게이트 설정 저장됨');
      Modal.close();
      if (this._custId) await this._select(this._custId, { route: 'none' });
    } catch (e) {
      Toast.error('저장 실패: ' + (e.message || e));
    }
  },

  // PLM 게이트 라인업 — 기존 라이프사이클 스텝퍼(ss-stepper) 스타일 재사용
  //   완료=✓(초록) / 현재=번호+빨강 halo+"현재" 칩 / 예정=속빈 원 + 목표일·지연색
  _gateTimeline(m) {
    const gates = m.gates || [];
    if (!gates.length) return '';
    const ymd = d => (d ? String(d).slice(2, 7).replace('-', '/') : '');
    const curIdx = gates.findIndex(g => g.gate_key === m.current_gate);
    const safeIdx = curIdx < 0 ? 0 : curIdx;
    const steps = gates
      .map((g, i) => {
        const now = i === safeIdx;
        const done = !now && (g.status === 'done' || i < safeIdx);
        const cls = done ? 'ss-done' : now ? 'ss-now' : 'ss-future';
        const fill = i <= safeIdx ? ' ss-fill' : '';
        const sym = done ? '✓' : String(i + 1);
        const dt = ymd(g.target_date);
        const dateColor = g.late ? 'var(--oci-red)' : 'var(--text-3)';
        const tip = `${g.gate_label}${now ? ' (현재)' : ''}${g.late ? ' · 지연' : ''}` +
          (g.target_date ? ` · 목표 ${String(g.target_date).slice(0, 10)}` : '') +
          (g.actual_date ? ` · 완료 ${String(g.actual_date).slice(0, 10)}` : '');
        return `<div class="ss-step ${cls}${fill}" title="${esc(tip)}">
          <div class="ss-dot" aria-hidden="true">${sym}</div>
          <div class="ss-label">${esc(g.gate_key)}</div>
          ${dt ? `<div class="ss-gate-date" style="font-size:9.5px;color:${dateColor}">${dt}</div>` : ''}
          ${now ? '<div class="ss-now-chip">현재</div>' : ''}
        </div>`;
      })
      .join('');
    return `<div class="ss-stepper ss-gates" role="progressbar" aria-label="게이트 진행">${steps}</div>`;
  },

  _matCard(m) {
    const stagePill = m.lifecycle_stage === 'massprod' || m.lifecycle_stage === 'specin' ? 'pill-info' : 'pill-mut';
    const badges = [];
    if (m.capa_short) badges.push(`<span class="pill pill-danger">CAPA 부족</span>`);
    if (m.open_quality) badges.push(`<span class="pill pill-warn">품질 ${m.open_quality}건</span>`);
    // 소프트 링크 딜 배지: 1건 → 해당 딜 직행 / 여러건 → 영업기회 탭
    const dealCount = m.linked_deal_count || 0;
    const primary = m.primary_lead_id || '';
    if (dealCount === 1) badges.push(`<span class="pill pill-info" title="연결된 영업딜로 이동">딜 ▶</span>`);
    else if (dealCount > 1) badges.push(`<span class="pill pill-mut" title="${dealCount}개 영업딜 — 영업기회 탭">딜 ${dealCount}</span>`);
    const cardTitle = dealCount === 1 ? '연결된 영업딜 상세로 이동' : '영업기회(상거래)로 이동';
    return `<div class="lc-card lc-card-link" data-mat-card="${m.id}" data-primary-lead="${primary}" title="${cardTitle}">
      <div class="lc-top">
        <span class="lc-name">${esc(m.material_name)}</span>
        <span class="pill ${stagePill}" title="현재 게이트">${esc(m.current_gate_label || m.lifecycle_label)}</span>
        ${badges.join('')}
        <span class="lc-edit">
          <button class="lc-mini" data-fc-mat="${m.id}" title="월 수요 입력">수요 입력</button>
          <button class="lc-mini" data-edit-mat="${m.id}" title="공급 품목 수정">수정</button>
        </span>
      </div>
      ${this._gateTimeline(m)}
      <div class="lc-mrow">
        <span>월 수요 <b>${m.monthly_demand ? this._qty(m.monthly_demand, m.demand_unit) : '미정'}</b></span>
        <span>예상 양산 <b>${m.expected_mp_date ? String(m.expected_mp_date).slice(0, 7) : '미정'}</b></span>
        <span>분기 수주확률 <b>${m.win_probability !== null && m.win_probability !== undefined ? m.win_probability + '%' : '-'}</b></span>
        <span>분기 예상수주 <b>${this._won(m.quarter_expected_order)}</b></span>
        ${m.fab_line ? `<span>${esc(m.fab_line)}</span>` : ''}
      </div>
    </div>`;
  },

  _tabDeals() {
    const deals = this._data.deals;
    if (!deals.length) return '<div class="c360-empty">영업기회가 없습니다.</div>';
    return `<table class="data-table">
      <thead><tr><th>프로젝트</th><th>사업유형</th><th>단계</th><th class="text-right">예상매출</th><th class="text-right">확률</th><th class="text-right">가중</th><th>마감</th><th>담당</th></tr></thead>
      <tbody>
        ${deals
          .map(
            dl => `<tr class="clickable" data-lead-id="${dl.id}">
          <td><strong>${esc(dl.project_name || '-')}</strong></td>
          <td>${esc(dl.business_type || '-')}</td>
          <td><span class="stage-pill">${esc(dl.stage_label)}</span></td>
          <td class="text-right">${this._won(dl.expected_amount)}</td>
          <td class="text-right">${dl.probability}%</td>
          <td class="text-right">${this._won(dl.weighted)}</td>
          <td>${dl.expected_close_date ? String(dl.expected_close_date).slice(0, 10) : '-'}</td>
          <td>${esc(dl.owner_name || '-')}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  },

  _tabTimeline() {
    const tl = this._data.timeline;
    if (!tl.length) return '<div class="c360-empty">최근 활동 기록이 없습니다.</div>';
    const iconByType = { activity: 'activity', quote: 'quote', proposal: 'proposal', contract: 'contract', sample: 'sample', quality: 'quality' };
    return `<div class="c360-tl">
      ${tl
        .map(
          e => `<div class="c360-tl-item">
        <span class="c360-tl-dot">${this._svg(iconByType[e.type] || 'activity', 14)}</span>
        <div class="c360-tl-title">${esc(e.title || '-')}</div>
        <div class="c360-tl-meta">${e.date ? String(e.date).slice(0, 10) : ''}${e.amount ? ' · ' + this._won(e.amount) : ''}${e.status ? ' · ' + esc(e.status) : ''}</div>
      </div>`
        )
        .join('')}
    </div>`;
  },

  _tabBrief() {
    const b = this._data.brief;
    const when = b && b.generated_at ? this._fmtWhen(b.generated_at) : null;
    const ago = b && b.generated_at ? this._fmtAgo(b.generated_at) : null;
    const days =
      b && b.generated_at
        ? Math.floor((Date.now() - new Date(b.generated_at).getTime()) / 86400000)
        : null;
    const stale = days !== null && days >= 14; // 2주 경과 → 갱신 권장
    // 헤더: 생성 시점/신선도 + 이력 + 직접 생성/재생성 (360에서 바로 생성)
    const header = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:700">AI 브리핑</span>
        ${when ? `<span style="font-size:11px;color:var(--text-3)">생성 시점 · ${esc(when)}${ago ? ` (${esc(ago)})` : ''}</span>` : '<span style="font-size:11px;color:var(--text-3)">아직 생성 안 됨</span>'}
        ${stale ? '<span style="font-size:10px;font-weight:700;color:#b45309;background:rgba(245,156,0,.14);border-radius:6px;padding:2px 7px">갱신 권장</span>' : ''}
        <span style="margin-left:auto;display:inline-flex;gap:6px">
          ${b ? '<button class="btn btn-ghost btn-sm" id="c360-brief-history">이력</button>' : ''}
          <button class="btn btn-sm ${b ? 'btn-ghost' : 'btn-primary'}" id="c360-brief-gen">${b ? '다시 생성' : 'AI 브리핑 생성'}</button>
        </span>
      </div>`;
    if (!b) {
      return (
        header +
        `<div class="c360-empty">아직 생성된 AI 브리핑이 없습니다.<br>
        <span style="font-size:12px">위 “AI 브리핑 생성”을 누르면 현재 고객 데이터로 즉시 분석합니다.</span></div>`
      );
    }
    const kp = Array.isArray(b.key_points) ? b.key_points : [];
    return `${header}<div class="c360-brief">
      ${b.headline ? `<div class="c360-brief-head">${esc(b.headline)}</div>` : ''}
      ${
        kp.length
          ? `<div class="c360-sec" style="margin-top:0">핵심 포인트</div>
             <ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;font-size:13px">${kp.map(k => `<li>${esc(k)}</li>`).join('')}</ul>`
          : ''
      }
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${b.next_action ? `<div style="flex:1;min-width:200px;background:rgba(23,168,90,.08);border-left:3px solid #17A85A;padding:10px 12px;border-radius:6px"><div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번 주 즉시 실행</div><div style="font-size:13px;font-weight:600">${esc(b.next_action)}</div></div>` : ''}
        ${b.risk ? `<div style="flex:1;min-width:200px;background:rgba(230,51,41,.08);border-left:3px solid var(--oci-red);padding:10px 12px;border-radius:6px"><div style="font-size:11px;color:var(--text-3);margin-bottom:4px">리스크</div><div style="font-size:13px;font-weight:600">${esc(b.risk)}</div></div>` : ''}
      </div>
    </div>`;
  },

  // AI 브리핑 직접 생성 (360 내에서) — POST /customers/:id/brief
  async _generateBrief() {
    const host = document.getElementById('c360-tab-body');
    if (host)
      host.innerHTML = `<div class="loading" style="padding:40px;text-align:center;color:var(--text-3)">AI가 고객 데이터를 분석 중…</div>`;
    try {
      const r = await API.post(`/customers/${this._custId}/brief`, {});
      this._data.brief = r.data;
      if (typeof Toast !== 'undefined') Toast.success?.('AI 브리핑 생성 완료');
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('생성 실패: ' + (e.message || e));
    }
    this._renderTab();
  },

  // 생성 시점 포맷 (YYYY-MM-DD HH:mm)
  _fmtWhen(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 16).replace('T', ' ');
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // 상대 시점 (방금 / n시간 전 / n일 전)
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

  // AI 브리핑 생성 이력 (시점별) — GET /customers/:id/brief/history
  async _openBriefHistory() {
    try {
      const r = await API.get(`/customers/${this._custId}/brief/history`);
      const rows = r.data || [];
      const body = rows.length
        ? rows
            .map(
              h => `<div style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:700">${esc(this._fmtWhen(h.generated_at))}</span>
              <span style="font-size:11px;color:var(--text-3)">${esc(this._fmtAgo(h.generated_at))}${h.generated_by_name ? ' · ' + esc(h.generated_by_name) : ''}</span>
            </div>
            ${h.headline ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px">${esc(h.headline)}</div>` : ''}
            ${h.next_action ? `<div style="font-size:12px;color:var(--text-2)"><b style="font-weight:600">다음 액션</b> · ${esc(h.next_action)}</div>` : ''}
            ${h.risk ? `<div style="font-size:12px;color:var(--oci-red)"><b style="font-weight:600">리스크</b> · ${esc(h.risk)}</div>` : ''}
          </div>`
            )
            .join('')
        : '<div class="c360-empty" style="padding:24px">생성 이력이 없습니다.</div>';
      Modal.open({ title: 'AI 브리핑 생성 이력', width: 640, body });
    } catch (e) {
      if (typeof Toast !== 'undefined') Toast.error?.('이력 조회 실패: ' + (e.message || e));
    }
  },

  // ── 포캐스트 탭 (고객/내부 분리 + 버전관리) ──────────────────
  _tabForecast() {
    if (!this._fcData) return '<div id="c360-fc"><div class="c360-empty">포캐스트 불러오는 중…</div></div>';
    return `<div id="c360-fc">${this._renderForecast()}</div>`;
  },

  async _loadForecast() {
    try {
      const res = await API.get(`/customer360/${this._custId}/forecast`);
      this._fcData = res.data;
    } catch (_) {
      this._fcData = { months: this._FC_MONTHS, materials: [], totals: {}, versions: [] };
    }
    const host = document.getElementById('c360-fc');
    if (host) {
      host.innerHTML = this._renderForecast();
      this._bindForecast(host.parentElement || document);
    }
  },

  _renderForecast() {
    const f = this._fcData;
    const months = f.months;
    const verOpts = f.versions
      .map(v => `<option value="${v.id}" ${this._cmpVer && this._cmpVer.version.id === v.id ? 'selected' : ''}>${esc(v.label)} (${String(v.created_at).slice(0, 10)})</option>`)
      .join('');
    const cmp = this._cmpVer ? this._cmpVer.totals : null;

    const totalRows = months
      .map(mn => {
        const t = f.totals[mn] || { customer: 0, internal: 0, capacity: 0, expected: 0 };
        const delta = cmp ? Math.round((t.customer || 0) - (cmp[mn]?.customer || 0)) : null;
        const dtxt =
          delta === null
            ? ''
            : `<td class="text-right" style="color:${delta > 0 ? '#0F7A3F' : delta < 0 ? 'var(--oci-red)' : 'var(--text-3)'}">${delta > 0 ? '+' : ''}${this._qty(delta)}</td>`;
        return `<tr>
          <td>${mn}</td>
          <td class="text-right">${this._qty(t.customer)}</td>
          <td class="text-right">${this._qty(t.internal)}</td>
          <td class="text-right">${this._qty(t.capacity)}</td>
          <td class="text-right">${this._won(t.expected)}</td>
          ${dtxt}
        </tr>`;
      })
      .join('');

    const matBlocks = f.materials.length
      ? f.materials
          .map(m => {
            const rows = months
              .map(mn => {
                const r = m.rows[mn] || {};
                const gap = r.gap;
                return `<tr>
                <td>${mn}</td>
                <td class="text-right">${this._qty(r.customer_forecast)}</td>
                <td class="text-right">${this._qty(r.internal_forecast)}</td>
                <td class="text-right">${r.production_capacity === null ? '-' : this._qty(r.production_capacity)}</td>
                <td class="text-right" style="${gap !== null && gap < 0 ? 'color:var(--oci-red)' : ''}">${gap === null ? '-' : (gap > 0 ? '+' : '') + this._qty(gap)}</td>
                <td class="text-right">${this._won(r.expected_revenue)}</td>
              </tr>`;
              })
              .join('');
            return `<div class="lc-card">
              <div class="lc-top">
                <span class="lc-name">${esc(m.material_name)}</span>
                <span class="pill pill-mut">${esc(m.unit || '')}</span>
                <span class="lc-edit"><button class="lc-mini" data-fc-edit="${m.id}">수요 입력/수정</button></span>
              </div>
              <table class="data-table" style="font-size:12px;margin-top:6px">
                <thead><tr><th>월</th><th class="text-right">고객 Forecast</th><th class="text-right">내부 보정</th><th class="text-right">생산가능</th><th class="text-right">차이</th><th class="text-right">예상매출</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
          })
          .join('')
      : '<div class="c360-empty">등록된 공급 품목이 없습니다. 현황 탭에서 공급 품목을 등록하세요.</div>';

    return `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-size:12px;color:var(--text-2)">버전 비교</span>
        <select id="fc-ver" style="height:32px;border:1px solid var(--border);border-radius:7px;padding:0 8px;font-size:12px;background:var(--surface);color:var(--text-1)">
          <option value="">현재 (비교 안 함)</option>
          ${verOpts}
        </select>
        <button class="btn btn-ghost btn-sm" id="fc-sync-capa" style="margin-left:auto" title="생산예측 모듈의 수량을 생산가능(CAPA)으로 반영">생산예측 연동(CAPA)</button>
        <button class="btn btn-primary btn-sm" id="fc-snapshot">현재 스냅샷 저장</button>
      </div>
      <div class="c360-sec" style="margin-top:0">월별 합계 ${cmp ? `<span style="font-size:11px;color:var(--text-3);font-weight:500">· Δ고객 = 현재 − ${esc(this._cmpVer.version.label)}</span>` : ''}</div>
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>월</th><th class="text-right">고객 합계</th><th class="text-right">내부 보정</th><th class="text-right">생산가능</th><th class="text-right">예상매출</th>${cmp ? '<th class="text-right">Δ고객</th>' : ''}</tr></thead>
        <tbody>${totalRows}</tbody>
      </table>
      <div class="c360-sec">소재별 상세 (고객 Forecast vs 내부 보정)</div>
      ${matBlocks}
    `;
  },

  _bindForecast(scope) {
    const root = scope || document;
    root.querySelector('#fc-snapshot')?.addEventListener('click', () => this._saveSnapshot());
    root.querySelector('#fc-sync-capa')?.addEventListener('click', () => this._syncCapa());
    root.querySelector('#fc-ver')?.addEventListener('change', e => this._onVersionChange(e.target.value));
    root.querySelectorAll('[data-fc-edit]').forEach(b =>
      b.addEventListener('click', () => {
        const mat = this._fcData.materials.find(m => m.id === Number(b.dataset.fcEdit));
        // 라이프사이클 소재 구조와 호환되도록 unit 매핑
        this._openForecastModal({ id: mat.id, material_name: mat.material_name, demand_unit: mat.unit });
      })
    );
  },

  async _syncCapa() {
    try {
      const res = await API.post(`/customer360/${this._custId}/forecast/sync-capa`, {});
      Toast.success(`생산예측 연동 완료 — ${res.data.updated}건 CAPA 반영`);
      this._fcData = null;
      this._cmpVer = null;
      await this._loadForecast();
    } catch (_) {
      /* Toast */
    }
  },

  async _onVersionChange(vid) {
    if (!vid) {
      this._cmpVer = null;
    } else {
      try {
        const res = await API.get(`/customer360/forecast/versions/${vid}`);
        this._cmpVer = res.data;
      } catch (_) {
        this._cmpVer = null;
      }
    }
    const host = document.getElementById('c360-fc');
    if (host) {
      host.innerHTML = this._renderForecast();
      this._bindForecast(host.parentElement || document);
    }
  },

  _saveSnapshot() {
    Modal.open({
      title: '포캐스트 스냅샷 저장',
      width: 460,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">버전 라벨 *</label>
            <input class="form-input" id="snap-label" placeholder="예: 2026-07 영업 보정본"></div>
          <div class="form-row"><label class="form-label">유형</label>
            <select class="form-input" id="snap-type">
              <option value="baseline">기준(baseline)</option>
              <option value="customer">고객 제출</option>
              <option value="internal">내부 보정</option>
              <option value="production">생산 검토</option>
            </select></div>
          <div class="form-row"><label class="form-label">메모</label>
            <input class="form-input" id="snap-note" placeholder="선택"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="snap-cancel">취소</button><button class="btn btn-primary" id="snap-save">저장</button>`,
      bind: {
        '#snap-cancel': () => Modal.close(),
        '#snap-save': async () => {
          const label = (document.getElementById('snap-label')?.value || '').trim();
          if (!label) {
            Toast.error('버전 라벨을 입력하세요');
            return;
          }
          try {
            await API.post(`/customer360/${this._custId}/forecast/versions`, {
              label,
              version_type: document.getElementById('snap-type')?.value || 'baseline',
              note: document.getElementById('snap-note')?.value || null,
            });
            Toast.success('스냅샷 저장 완료');
            Modal.close();
            this._fcData = null;
            this._tab = 'forecast';
            await this._loadForecast();
            // 탭 본문 재렌더 보장
            this._renderTab();
          } catch (_) {
            /* Toast 처리 */
          }
        },
      },
    });
  },

  // ── 계약/매출/수금 탭 (Forecast → 수주 → 매출 → 수금 → Gap) ──
  _tabRevenue() {
    if (!this._revenue) return '<div id="c360-rev"><div class="c360-empty">불러오는 중…</div></div>';
    return `<div id="c360-rev">${this._renderRevenue()}</div>`;
  },
  async _loadRevenue() {
    try {
      const res = await API.get(`/customer360/${this._custId}/revenue`);
      this._revenue = res.data;
    } catch (_) {
      this._revenue = { funnel: [], ar: 0, overdue: { count: 0, amount: 0 }, gap: 0, conversion: null };
    }
    const host = document.getElementById('c360-rev');
    if (host) host.innerHTML = this._renderRevenue();
  },
  _renderRevenue() {
    const d = this._revenue;
    const f = d.funnel || [];
    const max = Math.max(1, ...f.map(x => x.amount));
    const colors = ['#2357E8', '#7c4dff', '#17A85A', '#0F7A3F'];
    const funnel = f.length
      ? f
          .map(
            (x, i) => `<div class="c360-pipe-row">
              <span class="nm" style="width:150px">${esc(x.label)}</span>
              <span class="c360-pipe-bar"><div style="width:${Math.round((x.amount / max) * 100)}%;background:${colors[i] || '#2357E8'}"></div></span>
              <span class="amt">${this._won(x.amount)}${x.count !== null && x.count !== undefined ? ` · ${x.count}건` : ''}</span>
            </div>`
          )
          .join('')
      : '<div class="c360-empty">데이터가 없습니다.</div>';
    return `
      <div class="c360-kpis">
        ${this._kpi('money', 'Forecast→수주 전환율', d.conversion === null ? '-' : d.conversion + '%', 'Gap ' + this._won(d.gap))}
        ${this._kpi('contract', '매출채권(미수)', this._won(d.ar), '인식−수금')}
        ${this._kpi('quality', '연체 수금', `${d.overdue.count}건`, this._won(d.overdue.amount))}
      </div>
      <div class="c360-sec" style="margin-top:0">Forecast → 수주 → 매출인식 → 수금</div>
      <div class="c360-pipe">${funnel}</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:10px">Forecast(가중 예상매출)가 실제 수주·매출·수금으로 얼마나 전환됐는지 추적합니다.</div>
    `;
  },

  // ── 샘플/평가 탭 ─────────────────────────────────────────
  _SMP_STATUS: {
    requested: '요청', sent: '발송', evaluating: '평가중', passed: '승인', conditional: '조건부', failed: '불합격',
  },
  _matOptions(selId) {
    const mats = (this._data && this._data.lifecycle && this._data.lifecycle.materials) || [];
    return (
      '<option value="">(소재 미지정)</option>' +
      mats
        .map(m => `<option value="${m.id}" ${selId === m.id ? 'selected' : ''}>${esc(m.material_name)}</option>`)
        .join('')
    );
  },
  _tabSamples() {
    if (!this._samples) return '<div id="c360-smp"><div class="c360-empty">불러오는 중…</div></div>';
    return `<div id="c360-smp">${this._renderSamples()}</div>`;
  },
  async _loadSamples() {
    try {
      const res = await API.get(`/customer360/${this._custId}/samples`);
      this._samples = res.data || [];
    } catch (_) {
      this._samples = [];
    }
    const host = document.getElementById('c360-smp');
    if (host) {
      host.innerHTML = this._renderSamples();
      this._bindSamples(host.parentElement || document);
    }
  },
  _renderSamples() {
    const list = this._samples;
    const table = list.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr>
          <th>샘플번호</th><th>소재</th><th>목적</th><th>Lot</th><th>발송일</th><th>상태</th><th>결과</th><th></th>
        </tr></thead><tbody>
        ${list
          .map(s => {
            const st = this._SMP_STATUS[s.status] || s.status;
            const cls = s.status === 'passed' ? 'pill-info' : s.status === 'failed' ? 'pill-danger' : s.status === 'conditional' ? 'pill-warn' : 'pill-mut';
            return `<tr>
            <td class="mono">${esc(s.sample_no)}</td>
            <td>${esc(s.material_name ? s.material_name.split(' · ')[0] : '-')}</td>
            <td>${esc(s.purpose || '-')}</td>
            <td class="mono">${esc(s.lot_no || '-')}</td>
            <td>${s.sent_at ? String(s.sent_at).slice(0, 10) : '-'}</td>
            <td><span class="pill ${cls}">${esc(st)}</span>${s.resample ? '<span class="pill pill-warn">재샘플</span>' : ''}</td>
            <td>${esc(s.fail_reason || s.result || '-')}</td>
            <td style="text-align:right"><button class="lc-mini" data-smp-edit="${s.id}">수정</button></td>
          </tr>`;
          })
          .join('')}
        </tbody></table>`
      : '<div class="c360-empty">등록된 샘플 요청이 없습니다.</div>';
    return `<div class="c360-sec" style="margin-top:0">샘플/평가 이력
        <button class="btn btn-primary btn-sm btn-add" id="smp-add">+ 샘플 등록</button>
      </div>${table}`;
  },
  _bindSamples(scope) {
    const root = scope || document;
    root.querySelector('#smp-add')?.addEventListener('click', () => this._openSampleModal(null));
    root.querySelectorAll('[data-smp-edit]').forEach(b =>
      b.addEventListener('click', () => this._openSampleModal(this._samples.find(s => s.id === Number(b.dataset.smpEdit))))
    );
  },
  _openSampleModal(s) {
    const stOpts = Object.entries(this._SMP_STATUS)
      .map(([k, l]) => `<option value="${k}" ${s && s.status === k ? 'selected' : ''}>${l}</option>`)
      .join('');
    Modal.open({
      title: s ? '샘플 수정' : '샘플 등록',
      width: 520,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">소재</label>
            <select class="form-input" id="s-mat">${this._matOptions(s ? s.customer_material_id : null)}</select></div>
          <div class="form-row"><label class="form-label">목적 *</label>
            <input class="form-input" id="s-purpose" value="${s ? esc(s.purpose || '') : ''}" placeholder="고객 평가용 초도 샘플"></div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">Lot No</label><input class="form-input" id="s-lot" value="${s ? esc(s.lot_no || '') : ''}"></div>
            <div class="form-row"><label class="form-label">발송일</label><input class="form-input" id="s-sent" type="date" value="${s && s.sent_at ? String(s.sent_at).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">상태</label><select class="form-input" id="s-status">${stOpts}</select></div>
          </div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">평가 기준</label><input class="form-input" id="s-criteria" value="${s ? esc(s.eval_criteria || '') : ''}" placeholder="순도 99.999% 이상"></div>
            <div class="form-row"><label class="form-label">평가 장비/공정</label><input class="form-input" id="s-equip" value="${s ? esc(s.eval_equipment || '') : ''}" placeholder="식각 설비 A"></div>
          </div>
          <div class="form-row"><label class="form-label">결과/비고</label><input class="form-input" id="s-result" value="${s ? esc(s.result || '') : ''}"></div>
          <div class="form-row"><label class="form-label">불합격 사유</label><input class="form-input" id="s-fail" value="${s ? esc(s.fail_reason || '') : ''}" placeholder="불합격 시 사유"></div>
          <label class="form-label" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="s-resample" ${s && s.resample ? 'checked' : ''}> 재샘플 필요</label>
        </div>`,
      footer: `<button class="btn btn-ghost" id="s-cancel">취소</button><button class="btn btn-primary" id="s-save">저장</button>`,
      bind: { '#s-cancel': () => Modal.close(), '#s-save': () => this._saveSample(s) },
    });
  },
  async _saveSample(s) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const payload = {
      customer_material_id: v('s-mat') || null,
      purpose: v('s-purpose'),
      lot_no: v('s-lot') || null,
      sent_at: v('s-sent') || null,
      status: v('s-status'),
      result: v('s-result') || null,
      eval_criteria: v('s-criteria') || null,
      eval_equipment: v('s-equip') || null,
      fail_reason: v('s-fail') || null,
      resample: document.getElementById('s-resample')?.checked ? 1 : 0,
    };
    if (!payload.purpose && !payload.customer_material_id) {
      Toast.error('목적 또는 소재를 입력하세요');
      return;
    }
    try {
      if (s) await API.put(`/customer360/samples/${s.id}`, payload);
      else await API.post(`/customer360/${this._custId}/samples`, payload);
      Toast.success(s ? '샘플 수정 완료' : '샘플 등록 완료');
      Modal.close();
      this._samples = null;
      await this._select(this._custId);
      this._tab = 'samples';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 품질 탭 ───────────────────────────────────────────────
  _Q_STATUS: { open: '미해결', in_progress: '처리중', resolved: '완료' },
  _tabQuality() {
    if (this._quality === null) return '<div id="c360-q"><div class="c360-empty">불러오는 중…</div></div>';
    return `<div id="c360-q">${this._renderQuality()}</div>`;
  },
  async _loadQuality() {
    try {
      const [qres, dres] = await Promise.all([
        API.get(`/customer360/${this._custId}/quality`),
        API.get(`/customer360/${this._custId}/documents`),
      ]);
      this._quality = qres.data || [];
      this._qualityRestricted = !!qres.detail_restricted;
      this._qualityDocs = dres.data || [];
    } catch (_) {
      this._quality = this._quality || [];
      this._qualityDocs = this._qualityDocs || [];
    }
    const host = document.getElementById('c360-q');
    if (host) {
      host.innerHTML = this._renderQuality();
      this._bindQuality(host.parentElement || document);
    }
  },
  _renderQuality() {
    const list = this._quality;
    const table = list.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr>
          <th>케이스</th><th>소재</th><th>유형</th><th>심각도</th><th>상태</th><th>제목</th><th>담당</th><th>발생일</th><th></th>
        </tr></thead><tbody>
        ${list
          .map(q => {
            const sevCls = q.severity === 'high' ? 'pill-danger' : q.severity === 'medium' ? 'pill-warn' : 'pill-mut';
            const stCls = q.status === 'resolved' ? 'pill-info' : q.status === 'in_progress' ? 'pill-warn' : 'pill-danger';
            return `<tr>
            <td class="mono">${esc(q.case_no)}</td>
            <td>${esc(q.material_name ? q.material_name.split(' · ')[0] : '-')}</td>
            <td>${esc(q.type)}</td>
            <td><span class="pill ${sevCls}">${esc(q.severity)}</span></td>
            <td><span class="pill ${stCls}">${esc(this._Q_STATUS[q.status] || q.status)}</span></td>
            <td>${esc(q.title)}</td>
            <td>${esc(q.owner_name || '-')}</td>
            <td>${q.opened_at ? String(q.opened_at).slice(0, 10) : '-'}</td>
            <td style="text-align:right"><button class="lc-mini" data-q-edit="${q.id}">수정</button></td>
          </tr>`;
          })
          .join('')}
        </tbody></table>`
      : '<div class="c360-empty">등록된 품질 케이스가 없습니다.</div>';
    const restrictNote = this._qualityRestricted
      ? '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">상세 원인·분석 자료(비고)는 팀장 이상 권한에서 열람됩니다.</div>'
      : '';
    // 문서이력 (CoA/MSDS/CoC)
    const docs = this._qualityDocs || [];
    const docTable = docs.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr>
          <th>유형</th><th>문서번호</th><th>소재</th><th>발행일</th><th>유효기한</th><th>첨부</th><th></th>
        </tr></thead><tbody>
        ${docs
          .map(d => {
            const expired = d.valid_until && String(d.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10);
            const fileCell = d.file_path
              ? `<a class="lc-mini" href="/api/customer360/documents/${d.id}/file" target="_blank" rel="noopener" title="${esc(d.file_name || '다운로드')}">📎 다운로드</a>`
              : d.file_url
                ? `<a class="lc-mini" href="${esc(d.file_url)}" target="_blank" rel="noopener" title="외부 링크">🔗 링크</a>`
                : '<span style="color:var(--text-3)">-</span>';
            return `<tr>
            <td><span class="pill pill-info">${esc(d.doc_type)}</span></td>
            <td class="mono">${esc(d.doc_no || '-')}</td>
            <td>${esc(d.material_name ? d.material_name.split(' · ')[0] : '-')}</td>
            <td>${d.issued_at ? String(d.issued_at).slice(0, 10) : '-'}</td>
            <td style="${expired ? 'color:var(--oci-red)' : ''}">${d.valid_until ? String(d.valid_until).slice(0, 10) : '-'}${expired ? ' (만료)' : ''}</td>
            <td>${fileCell}</td>
            <td style="text-align:right"><button class="lc-mini" data-doc-edit="${d.id}">수정</button><button class="lc-mini" data-doc-del="${d.id}" style="color:var(--oci-red)">삭제</button></td>
          </tr>`;
          })
          .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">등록된 문서가 없습니다.</div>';
    return `<div class="c360-sec" style="margin-top:0">품질 케이스 (VOC/NCR/Audit)
        <button class="btn btn-primary btn-sm btn-add" id="q-add">+ 케이스 등록</button>
      </div>${restrictNote}${table}
      <div class="c360-sec">품질 문서 (CoA/MSDS/CoC)
        <button class="btn btn-primary btn-sm btn-add" id="doc-add">+ 문서 등록</button>
      </div>${docTable}`;
  },
  _bindQuality(scope) {
    const root = scope || document;
    root.querySelector('#q-add')?.addEventListener('click', () => this._openQualityModal(null));
    root.querySelectorAll('[data-q-edit]').forEach(b =>
      b.addEventListener('click', () => this._openQualityModal(this._quality.find(q => q.id === Number(b.dataset.qEdit))))
    );
    root.querySelector('#doc-add')?.addEventListener('click', () => this._openDocModal(null));
    root.querySelectorAll('[data-doc-edit]').forEach(b =>
      b.addEventListener('click', () => this._openDocModal((this._qualityDocs || []).find(d => d.id === Number(b.dataset.docEdit))))
    );
    root.querySelectorAll('[data-doc-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteDoc(Number(b.dataset.docDel)))
    );
  },
  _openDocModal(d) {
    const types = ['CoA', 'MSDS', 'CoC', '기타'];
    const tOpts = types.map(t => `<option value="${t}" ${d && d.doc_type === t ? 'selected' : ''}>${t}</option>`).join('');
    Modal.open({
      title: d ? '품질 문서 수정' : '품질 문서 등록',
      width: 500,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">유형</label><select class="form-input" id="d-type">${tOpts}</select></div>
            <div class="form-row"><label class="form-label">문서번호</label><input class="form-input" id="d-no" value="${d ? esc(d.doc_no || '') : ''}" placeholder="CoA-2026-001"></div>
          </div>
          <div class="form-row"><label class="form-label">소재</label><select class="form-input" id="d-mat">${this._matOptions(d ? d.customer_material_id : null)}</select></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">발행/제공일</label><input class="form-input" id="d-issued" type="date" value="${d && d.issued_at ? String(d.issued_at).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">유효기한</label><input class="form-input" id="d-valid" type="date" value="${d && d.valid_until ? String(d.valid_until).slice(0, 10) : ''}"></div>
          </div>
          <div class="form-row"><label class="form-label">파일 첨부 (CoA/MSDS PDF 등)</label>
            ${d && d.file_name ? `<div style="font-size:12px;margin-bottom:5px">📎 <a href="/api/customer360/documents/${d.id}/file" target="_blank" rel="noopener">${esc(d.file_name)}</a> <span style="color:var(--text-3)">(새 파일 선택 시 교체)</span></div>` : ''}
            <input class="form-input" id="d-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx,.hwp">
          </div>
          <div class="form-row"><label class="form-label">외부 링크 (선택)</label><input class="form-input" id="d-url" value="${d ? esc(d.file_url || '') : ''}" placeholder="https://... (사내 파일 대신 외부 URL)"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="d-cancel">취소</button><button class="btn btn-primary" id="d-save">저장</button>`,
      bind: { '#d-cancel': () => Modal.close(), '#d-save': () => this._saveDoc(d) },
    });
  },
  async _saveDoc(d) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const payload = {
      doc_type: v('d-type'),
      doc_no: v('d-no') || null,
      customer_material_id: v('d-mat') || null,
      issued_at: v('d-issued') || null,
      valid_until: v('d-valid') || null,
      file_url: v('d-url') || null,
    };
    try {
      let docId = d ? d.id : null;
      if (d) await API.put(`/customer360/documents/${d.id}`, payload);
      else {
        const r = await API.post(`/customer360/${this._custId}/documents`, payload);
        docId = r && r.data ? r.data.id : null;
      }
      // 첨부 파일 업로드 (선택 시)
      const file = document.getElementById('d-file')?.files?.[0];
      if (file && docId) {
        const fd = new FormData();
        fd.append('file', file);
        await API._upload(`/customer360/documents/${docId}/file`, fd);
      }
      Toast.success('문서 저장 완료');
      Modal.close();
      this._qualityDocs = null;
      this._quality = null;
      this._tab = 'quality';
      await this._loadQuality();
    } catch (_) {
      /* Toast */
    }
  },
  async _deleteDoc(id) {
    if (!confirm('문서를 삭제하시겠습니까?')) return;
    try {
      await API.del(`/customer360/documents/${id}`);
      Toast.success('삭제 완료');
      this._qualityDocs = null;
      this._quality = null;
      await this._loadQuality();
    } catch (_) {
      /* Toast */
    }
  },
  _openQualityModal(q) {
    const sel = (cur, arr) => arr.map(o => `<option value="${o}" ${cur === o ? 'selected' : ''}>${o}</option>`).join('');
    const stOpts = Object.entries(this._Q_STATUS)
      .map(([k, l]) => `<option value="${k}" ${q && q.status === k ? 'selected' : ''}>${l}</option>`)
      .join('');
    Modal.open({
      title: q ? '품질 케이스 수정' : '품질 케이스 등록',
      width: 520,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">제목 *</label>
            <input class="form-input" id="q-title" value="${q ? esc(q.title) : ''}" placeholder="순도 편차 클레임"></div>
          <div class="form-row"><label class="form-label">소재</label>
            <select class="form-input" id="q-mat">${this._matOptions(q ? q.customer_material_id : null)}</select></div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">유형</label><select class="form-input" id="q-type">${sel(q ? q.type : 'VOC', ['VOC', 'NCR', 'Audit', 'PCN', 'CoA'])}</select></div>
            <div class="form-row"><label class="form-label">심각도</label><select class="form-input" id="q-sev">${sel(q ? q.severity : 'medium', ['high', 'medium', 'low'])}</select></div>
            <div class="form-row"><label class="form-label">상태</label><select class="form-input" id="q-status">${stOpts}</select></div>
          </div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">발생일</label><input class="form-input" id="q-opened" type="date" value="${q && q.opened_at ? String(q.opened_at).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">비고</label><input class="form-input" id="q-notes" value="${q ? esc(q.notes || '') : ''}"></div>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="q-cancel">취소</button><button class="btn btn-primary" id="q-save">저장</button>`,
      bind: { '#q-cancel': () => Modal.close(), '#q-save': () => this._saveQuality(q) },
    });
  },
  async _saveQuality(q) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const title = v('q-title');
    if (!title) {
      Toast.error('제목을 입력하세요');
      return;
    }
    const payload = {
      title,
      customer_material_id: v('q-mat') || null,
      type: v('q-type'),
      severity: v('q-sev'),
      status: v('q-status'),
      opened_at: v('q-opened') || null,
      notes: v('q-notes') || null,
    };
    try {
      if (q) await API.put(`/customer360/quality/${q.id}`, payload);
      else await API.post(`/customer360/${this._custId}/quality`, payload);
      Toast.success(q ? '케이스 수정 완료' : '케이스 등록 완료');
      Modal.close();
      this._quality = null;
      await this._select(this._custId);
      this._tab = 'quality';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 고객 만족도 (NPS/CSAT) — Health 관계·만족도 축 원천 ──────
  async _loadSatisfaction() {
    try {
      const r = await API.get('/customer360/' + this._custId + '/satisfaction');
      this._satisfaction = r.data || { rows: [], latest_nps: null, latest_csat: null, score: null };
    } catch (_) {
      this._satisfaction = { rows: [], latest_nps: null, latest_csat: null, score: null };
    }
    if (this._tab === 'relationship') this._renderTab();
  },
  _tabSatisfaction() {
    const sd = this._satisfaction;
    if (!sd) return '<div class="c360-empty" style="padding:20px">불러오는 중…</div>';
    const dash = v => (v === null || v === undefined ? '-' : v);
    const scoreTxt = sd.score === null || sd.score === undefined ? '미수집' : sd.score + '점';
    const sc =
      sd.score === null || sd.score === undefined
        ? 'var(--text-3)'
        : sd.score >= 80
          ? '#17A85A'
          : sd.score >= 60
            ? '#2357E8'
            : sd.score >= 40
              ? '#F59C00'
              : '#E63329';
    const summary = `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <div class="flow-box"><div class="l">최근 NPS (0~10)</div><div class="v">${dash(sd.latest_nps)}</div></div>
      <div class="flow-box"><div class="l">최근 CSAT (1~5)</div><div class="v">${dash(sd.latest_csat)}</div></div>
      <div class="flow-box" style="background:rgba(0,0,0,.02)"><div class="l">종합 만족도 · Health 반영</div><div class="v" style="color:${sc}">${scoreTxt}</div></div>
    </div>`;
    const rows =
      sd.rows && sd.rows.length
        ? `<table class="data-table" style="font-size:12px"><thead><tr><th>조사일</th><th>유형</th><th>점수</th><th>응답자</th><th>채널</th><th>비고</th><th></th></tr></thead><tbody>
            ${sd.rows
              .map(
                r => `<tr><td>${esc(r.surveyed_at || '-')}</td><td>${esc(r.survey_type)}</td><td><b>${r.score}</b></td><td>${esc(r.respondent || '-')}</td><td>${esc(r.channel || '-')}</td><td>${esc(r.note || '-')}</td>
                <td style="text-align:right"><button class="lc-mini" data-sat-del="${r.id}" style="color:var(--oci-red)">삭제</button></td></tr>`
              )
              .join('')}
          </tbody></table>`
        : '<div class="c360-empty" style="padding:20px">만족도 기록이 없습니다. NPS/CSAT를 입력하면 Account Health 관계·만족도 축에 반영됩니다.</div>';
    return `<div class="c360-sec" style="margin-top:0">만족도 이력
        <button class="btn btn-primary btn-sm btn-add" id="sat-add">+ 만족도 입력</button>
      </div>${summary}${rows}`;
  },
  _bindSatisfaction(scope) {
    const root = scope || document;
    root.querySelector('#sat-add')?.addEventListener('click', () => this._openSatisfactionModal());
    root.querySelectorAll('[data-sat-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteSatisfaction(Number(b.dataset.satDel)))
    );
  },
  _openSatisfactionModal() {
    const today = new Date().toISOString().slice(0, 10);
    Modal.open({
      title: '고객 만족도 입력',
      width: 480,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">유형</label><select class="form-input" id="sat-type"><option value="NPS">NPS (0~10)</option><option value="CSAT">CSAT (1~5)</option></select></div>
            <div class="form-row"><label class="form-label">점수 *</label><input class="form-input" id="sat-score" type="number" step="0.1" placeholder="예: 9"></div>
          </div>
          <div class="form-row"><label class="form-label">조사일</label><input class="form-input" id="sat-date" type="date" value="${today}"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">응답자/부서</label><input class="form-input" id="sat-resp" placeholder="구매팀 김부장"></div>
            <div class="form-row"><label class="form-label">채널</label><input class="form-input" id="sat-channel" placeholder="설문/QBR/인터뷰"></div>
          </div>
          <div class="form-row"><label class="form-label">비고</label><input class="form-input" id="sat-note"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="sat-cancel">취소</button><button class="btn btn-primary" id="sat-save">저장</button>`,
      bind: { '#sat-cancel': () => Modal.close(), '#sat-save': () => this._saveSatisfaction() },
    });
  },
  async _saveSatisfaction() {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const type = v('sat-type') || 'NPS';
    const score = Number(v('sat-score'));
    if (!Number.isFinite(score)) {
      Toast.error('점수를 입력하세요');
      return;
    }
    const max = type === 'NPS' ? 10 : 5;
    const min = type === 'NPS' ? 0 : 1;
    if (score < min || score > max) {
      Toast.error(`${type} 점수는 ${min}~${max} 범위여야 합니다`);
      return;
    }
    try {
      await API.post('/customer360/' + this._custId + '/satisfaction', {
        survey_type: type,
        score,
        surveyed_at: v('sat-date') || null,
        respondent: v('sat-resp') || null,
        channel: v('sat-channel') || null,
        note: v('sat-note') || null,
      });
      Toast.success('만족도 저장 완료');
      Modal.close();
      // 상세 새로고침 → Health(관계·만족도 축) 재계산 + 이력 갱신
      await this._select(this._custId, { route: 'none' });
    } catch (e) {
      Toast.error('저장 실패: ' + (e.message || e));
    }
  },
  async _deleteSatisfaction(id) {
    if (!confirm('이 만족도 기록을 삭제하시겠습니까?')) return;
    try {
      await API.del('/customer360/satisfaction/' + id);
      Toast.success('삭제 완료');
      await this._select(this._custId, { route: 'none' });
    } catch (_) {
      /* Toast */
    }
  },

  // ── 조직 탭 (사업장 / 담당자) ────────────────────────────
  _ROLES: ['구매', '기술', '품질', 'SCM', '기타'],
  _tabOrg() {
    const org = this._data.organization || { sites: [], contacts: [] };
    const sites = org.sites.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>사업장</th><th>라인</th><th>공정</th><th>지역</th><th></th></tr></thead><tbody>
          ${org.sites
            .map(s => `<tr><td><strong>${esc(s.site_name)}</strong></td><td>${esc(s.line || '-')}</td><td>${esc(s.process || '-')}</td><td>${esc(s.region || '-')}</td>
              <td style="text-align:right"><button class="lc-mini" data-site-edit="${s.id}">수정</button><button class="lc-mini" data-site-del="${s.id}" style="color:var(--oci-red)">삭제</button></td></tr>`)
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">등록된 사업장이 없습니다.</div>';
    const contacts = org.contacts.length
      ? `<table class="data-table" style="font-size:12px"><thead><tr><th>이름</th><th>역할</th><th>부서</th><th>이메일</th><th>연락처</th><th></th></tr></thead><tbody>
          ${org.contacts
            .map(c => `<tr><td><strong>${esc(c.name)}</strong>${c.is_primary ? ' <span class="pill pill-info">주</span>' : ''}</td><td>${esc(c.role || '-')}</td><td>${esc(c.dept || '-')}</td><td class="mono" style="font-size:11px">${esc(c.email || '-')}</td><td class="mono">${esc(c.phone || '-')}</td>
              <td style="text-align:right"><button class="lc-mini" data-ct-edit="${c.id}">수정</button><button class="lc-mini" data-ct-del="${c.id}" style="color:var(--oci-red)">삭제</button></td></tr>`)
            .join('')}
        </tbody></table>`
      : '<div class="c360-empty" style="padding:24px">등록된 담당자가 없습니다.</div>';
    return `
      <div class="c360-sec" style="margin-top:0">사업장 / Fab / 라인
        <button class="btn btn-primary btn-sm btn-add" id="site-add">+ 사업장</button>
      </div>${sites}
      <div class="c360-sec">담당자 (구매/기술/품질/SCM)
        <button class="btn btn-primary btn-sm btn-add" id="ct-add">+ 담당자</button>
      </div>${contacts}`;
  },
  _bindOrg(scope) {
    const root = scope || document;
    const org = this._data.organization || { sites: [], contacts: [] };
    root.querySelector('#site-add')?.addEventListener('click', () => this._openSiteModal(null));
    root.querySelector('#ct-add')?.addEventListener('click', () => this._openContactModal(null));
    root.querySelectorAll('[data-site-edit]').forEach(b =>
      b.addEventListener('click', () => this._openSiteModal(org.sites.find(s => s.id === Number(b.dataset.siteEdit))))
    );
    root.querySelectorAll('[data-site-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteOrg('sites', Number(b.dataset.siteDel)))
    );
    root.querySelectorAll('[data-ct-edit]').forEach(b =>
      b.addEventListener('click', () => this._openContactModal(org.contacts.find(c => c.id === Number(b.dataset.ctEdit))))
    );
    root.querySelectorAll('[data-ct-del]').forEach(b =>
      b.addEventListener('click', () => this._deleteOrg('contacts', Number(b.dataset.ctDel)))
    );
  },
  async _deleteOrg(kind, id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await API.del(`/customer360/${kind}/${id}`);
      Toast.success('삭제 완료');
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },
  _openSiteModal(s) {
    Modal.open({
      title: s ? '사업장 수정' : '사업장 추가',
      width: 480,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row"><label class="form-label">사업장명 *</label><input class="form-input" id="st-name" value="${s ? esc(s.site_name) : ''}" placeholder="평택"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">라인</label><input class="form-input" id="st-line" value="${s ? esc(s.line || '') : ''}" placeholder="P3"></div>
            <div class="form-row"><label class="form-label">공정</label><input class="form-input" id="st-proc" value="${s ? esc(s.process || '') : ''}" placeholder="식각/증착"></div>
          </div>
          <div class="form-row"><label class="form-label">지역</label><input class="form-input" id="st-region" value="${s ? esc(s.region || '') : ''}"></div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="st-cancel">취소</button><button class="btn btn-primary" id="st-save">저장</button>`,
      bind: { '#st-cancel': () => Modal.close(), '#st-save': () => this._saveSite(s) },
    });
  },
  async _saveSite(s) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('st-name');
    if (!name) {
      Toast.error('사업장명을 입력하세요');
      return;
    }
    const payload = { site_name: name, line: v('st-line') || null, process: v('st-proc') || null, region: v('st-region') || null };
    try {
      if (s) await API.put(`/customer360/sites/${s.id}`, payload);
      else await API.post(`/customer360/${this._custId}/sites`, payload);
      Toast.success('저장 완료');
      Modal.close();
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },
  _openContactModal(c) {
    const roleOpts = this._ROLES.map(r => `<option value="${r}" ${c && c.role === r ? 'selected' : ''}>${r}</option>`).join('');
    Modal.open({
      title: c ? '담당자 수정' : '담당자 추가',
      width: 480,
      compact: true,
      body: `<div class="form-grid">
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">이름 *</label><input class="form-input" id="ct-name" value="${c ? esc(c.name) : ''}"></div>
            <div class="form-row"><label class="form-label">역할</label><select class="form-input" id="ct-role">${roleOpts}</select></div>
          </div>
          <div class="form-row"><label class="form-label">부서</label><input class="form-input" id="ct-dept" value="${c ? esc(c.dept || '') : ''}"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">이메일</label><input class="form-input" id="ct-email" value="${c ? esc(c.email || '') : ''}"></div>
            <div class="form-row"><label class="form-label">연락처</label><input class="form-input" id="ct-phone" value="${c ? esc(c.phone || '') : ''}"></div>
          </div>
          <label class="form-label" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ct-primary" ${c && c.is_primary ? 'checked' : ''}> 대표 담당자</label>
        </div>`,
      footer: `<button class="btn btn-ghost" id="ct-cancel">취소</button><button class="btn btn-primary" id="ct-save">저장</button>`,
      bind: { '#ct-cancel': () => Modal.close(), '#ct-save': () => this._saveContact(c) },
    });
  },
  async _saveContact(c) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('ct-name');
    if (!name) {
      Toast.error('이름을 입력하세요');
      return;
    }
    const payload = {
      name,
      role: v('ct-role'),
      dept: v('ct-dept') || null,
      email: v('ct-email') || null,
      phone: v('ct-phone') || null,
      is_primary: document.getElementById('ct-primary')?.checked ? 1 : 0,
    };
    try {
      if (c) await API.put(`/customer360/contacts/${c.id}`, payload);
      else await API.post(`/customer360/${this._custId}/contacts`, payload);
      Toast.success('저장 완료');
      Modal.close();
      await this._select(this._custId);
      this._tab = 'org';
      this._renderTab();
    } catch (_) {
      /* Toast */
    }
  },

  // ── 편집 모달 ─────────────────────────────────────────────
  _openMaterialModal(mat) {
    const isEdit = !!mat;
    const stageOpts = this._STAGES.map(
      ([k, l]) => `<option value="${k}" ${mat && mat.lifecycle_stage === k ? 'selected' : ''}>${l}</option>`
    ).join('');
    Modal.open({
      title: isEdit ? '공급 품목 수정' : '공급 품목 등록',
      width: 520,
      compact: true,
      body: `
        <div class="form-grid">
          <div class="form-row"><label class="form-label">소재명 *</label>
            <input class="form-input" id="m-name" value="${mat ? esc(mat.material_name) : ''}" placeholder="예: 식각가스 C4F6"></div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">사업유형</label>
              <input class="form-input" id="m-biz" value="${mat ? esc(mat.business_type || '') : ''}" placeholder="식각가스/프리커서…"></div>
            <div class="form-row"><label class="form-label">Fab/라인/공정</label>
              <input class="form-input" id="m-fab" value="${mat ? esc(mat.fab_line || '') : ''}" placeholder="평택 P3 식각"></div>
          </div>
          <div class="form-row-3">
            <div class="form-row"><label class="form-label">라이프사이클 단계</label>
              <select class="form-input" id="m-stage">${stageOpts}</select></div>
            <div class="form-row"><label class="form-label">월 수요</label>
              <input class="form-input" id="m-demand" type="number" value="${mat && mat.monthly_demand ? mat.monthly_demand : ''}"></div>
            <div class="form-row"><label class="form-label">단위</label>
              <input class="form-input" id="m-unit" value="${mat ? esc(mat.demand_unit || 'kg') : 'kg'}"></div>
          </div>
          <div class="form-row-2">
            <div class="form-row"><label class="form-label">예상 양산일</label>
              <input class="form-input" id="m-mp" type="date" value="${mat && mat.expected_mp_date ? String(mat.expected_mp_date).slice(0, 10) : ''}"></div>
            <div class="form-row"><label class="form-label">수주확률(%)</label>
              <input class="form-input" id="m-prob" type="number" min="0" max="100" value="${mat && mat.win_probability !== null && mat.win_probability !== undefined ? mat.win_probability : ''}"></div>
          </div>
        </div>`,
      footer: `<button class="btn btn-ghost" id="m-cancel">취소</button><button class="btn btn-primary" id="m-save">저장</button>`,
      bind: {
        '#m-cancel': () => Modal.close(),
        '#m-save': () => this._saveMaterial(mat),
      },
    });
  },

  async _saveMaterial(mat) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const name = v('m-name');
    if (!name) {
      Toast.error('소재명을 입력하세요');
      return;
    }
    const payload = {
      material_name: name,
      business_type: v('m-biz') || null,
      fab_line: v('m-fab') || null,
      lifecycle_stage: v('m-stage'),
      monthly_demand: v('m-demand') || null,
      demand_unit: v('m-unit') || 'kg',
      expected_mp_date: v('m-mp') || null,
      win_probability: v('m-prob') || null,
    };
    try {
      if (mat) await API.put(`/customer360/materials/${mat.id}`, payload);
      else await API.post('/customer360/materials', { ...payload, customer_id: this._custId });
      Toast.success(mat ? '공급 품목 수정 완료' : '공급 품목 등록 완료');
      Modal.close();
      await this._reload();
    } catch (_) {
      /* Toast 처리 */
    }
  },

  _openForecastModal(mat) {
    const months = this._FC_MONTHS;
    const rows = months
      .map(
        mn => `<tr>
          <td style="padding:4px 6px;font-weight:600">${mn}</td>
          <td><input class="form-input" data-fc="cust" data-mn="${mn}" type="number" placeholder="고객 수요" style="height:32px"></td>
          <td><input class="form-input" data-fc="capa" data-mn="${mn}" type="number" placeholder="생산가능" style="height:32px"></td>
          <td><input class="form-input" data-fc="rev" data-mn="${mn}" type="number" placeholder="예상매출(원)" style="height:32px"></td>
        </tr>`
      )
      .join('');
    Modal.open({
      title: `월 수요/생산 입력 — ${mat.material_name.split(' · ')[0]}`,
      width: 560,
      compact: true,
      body: `<table style="width:100%;font-size:12px"><thead><tr>
          <th style="text-align:left;padding:4px 6px">월</th><th>고객 수요(${esc(mat.demand_unit || '')})</th><th>생산가능</th><th>예상매출(원)</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:11px;color:var(--text-3);margin-top:8px">입력한 월만 저장됩니다(빈 행은 건너뜀).</div>`,
      footer: `<button class="btn btn-ghost" id="fc-cancel">취소</button><button class="btn btn-primary" id="fc-save">저장</button>`,
      bind: {
        '#fc-cancel': () => Modal.close(),
        '#fc-save': () => this._saveForecast(mat),
      },
    });
  },

  async _saveForecast(mat) {
    const months = this._FC_MONTHS;
    const get = (type, mn) =>
      document.querySelector(`[data-fc="${type}"][data-mn="${mn}"]`)?.value || '';
    let saved = 0;
    try {
      for (const mn of months) {
        const cust = get('cust', mn);
        const capa = get('capa', mn);
        const rev = get('rev', mn);
        if (!cust && !capa && !rev) continue;
        await API.post('/customer360/forecasts', {
          customer_material_id: mat.id,
          customer_id: this._custId,
          month: mn,
          customer_forecast: cust || 0,
          internal_forecast: cust || 0,
          production_capacity: capa || null,
          win_probability: mat.win_probability ?? null,
          expected_revenue: rev || 0,
          unit: mat.demand_unit || 'kg',
        });
        saved += 1;
      }
      if (!saved) {
        Toast.warn('입력된 값이 없습니다');
        return;
      }
      Toast.success(`${saved}개월 수요 저장 완료`);
      Modal.close();
      this._fcData = null;
      await this._reload();
    } catch (_) {
      /* Toast 처리 */
    }
  },
};
