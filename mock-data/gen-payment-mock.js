/* 수금관리 샘플 데이터 생성기 — 수금 일정(payment_schedules) 테스트용 (34건)
 *
 * 다양한 시나리오 커버:
 *   · 상태 6종 전부: scheduled / invoiced / partial / collected / overdue / written_off
 *   · 연체(overdue) 6건  → 미수금 탭 + 연체 알림 스캔 테스트
 *   · 부분수금(partial) 2건 → 상태 자동 재계산 테스트
 *   · 대손(written_off) 1건
 *   · 직접 등록(계약 없음) 3건 → 계약/고객사 컬럼 분리 테스트
 *   · 외화(USD) 1계약 2건 → 통화 표기 테스트
 *   · 다단계 계약 + 단일 단계 혼합 → 계약별 그룹핑 테스트
 *
 * 컬럼은 payment_schedules 스키마 기준 (공급가액=VAT별도 입력 → 수금예정액=VAT포함 자동계산).
 * 기준일(today) = 2026-06-10. 연체 = due_date < 기준일 & 미수금.
 *
 * 실행(Excel 생성):  node mock-data/gen-payment-mock.js
 * 모듈 사용(seed):    const { ROWS } = require('./gen-payment-mock');
 */
'use strict';
const ExcelJS = require('exceljs');
const path = require('path');

// 한 행 = 수금 일정 1건.
//   c=고객사, k=계약명('' → 직접등록), s=단계, o=순서, r=비율%, supply=공급가액(VAT별도)
//   cur=통화(생략 시 KRW), due=수금예정일, inv=계산서발행(예정)일, st=상태
//   paidInc=기납입액(VAT포함, partial 전용 — collected 는 자동 전액)
const RAW = [
  // 1) ㈜하나로통신 — 통합관제 시스템 구축 (공급 1,000만 → 계약 1,100만) 30/40/30, 중도금 연체
  { c: '㈜하나로통신', k: '통합관제 시스템 구축', s: '착수금', o: 1, r: 30, supply: 3000000, due: '2026-03-15', inv: '2026-03-12', st: 'collected', note: '착수금 수금완료' },
  { c: '㈜하나로통신', k: '통합관제 시스템 구축', s: '중도금', o: 2, r: 40, supply: 4000000, due: '2026-05-20', inv: '2026-05-18', st: 'overdue', note: '계산서 발행 후 미입금(연체)' },
  { c: '㈜하나로통신', k: '통합관제 시스템 구축', s: '잔금', o: 3, r: 30, supply: 3000000, due: '2026-07-30', st: 'scheduled', note: '잔금 예정' },

  // 2) 다음데이터㈜ — 빅데이터 플랫폼 SI (공급 5억 → 계약 5.5억) 10/30/30/30, 1차중도 연체
  { c: '다음데이터㈜', k: '빅데이터 플랫폼 SI', s: '착수금', o: 1, r: 10, supply: 50000000, due: '2026-04-10', inv: '2026-04-08', st: 'collected', note: '착수금 완료' },
  { c: '다음데이터㈜', k: '빅데이터 플랫폼 SI', s: '1차 중도금', o: 2, r: 30, supply: 150000000, due: '2026-06-05', inv: '2026-06-03', st: 'overdue', note: '1차 중도금 연체' },
  { c: '다음데이터㈜', k: '빅데이터 플랫폼 SI', s: '2차 중도금', o: 3, r: 30, supply: 150000000, due: '2026-07-15', inv: '2026-07-13', st: 'invoiced', note: '계산서 발행, 입금대기' },
  { c: '다음데이터㈜', k: '빅데이터 플랫폼 SI', s: '잔금', o: 4, r: 30, supply: 150000000, due: '2026-08-30', st: 'scheduled', note: '잔금 예정' },

  // 3) 삼성증권㈜ — 차세대 트레이딩 시스템 (공급 6억 → 계약 6.6억) 30/40/30, 착수금 부분수금
  { c: '삼성증권㈜', k: '차세대 트레이딩 시스템', s: '착수금', o: 1, r: 30, supply: 180000000, due: '2026-05-02', inv: '2026-04-30', st: 'partial', paidInc: 100000000, note: '부분수금(1억 / 1.98억)' },
  { c: '삼성증권㈜', k: '차세대 트레이딩 시스템', s: '중도금', o: 2, r: 40, supply: 240000000, due: '2026-07-20', st: 'scheduled', note: '중도금 예정' },
  { c: '삼성증권㈜', k: '차세대 트레이딩 시스템', s: '잔금', o: 3, r: 30, supply: 180000000, due: '2026-09-15', st: 'scheduled', note: '잔금 예정' },

  // 4) 카카오엔터프라이즈 — 사내 협업툴 도입 (공급 8천만 → 계약 8.8천만) 50/50, 잔금 연체
  { c: '카카오엔터프라이즈', k: '사내 협업툴 도입', s: '착수금', o: 1, r: 50, supply: 40000000, due: '2026-04-25', inv: '2026-04-23', st: 'collected', note: '착수금 완료' },
  { c: '카카오엔터프라이즈', k: '사내 협업툴 도입', s: '잔금', o: 2, r: 50, supply: 40000000, due: '2026-06-08', inv: '2026-06-05', st: 'overdue', note: '잔금 연체' },

  // 5) 네이버클라우드 — AI 챗봇 구축 (공급 1.2억 → 계약 1.32억) — 착수금만 편성(미편성 케이스)
  { c: '네이버클라우드', k: 'AI 챗봇 구축', s: '착수금', o: 1, r: 40, supply: 48000000, due: '2026-05-15', inv: '2026-05-13', st: 'collected', note: '이후 단계 미편성(계약 대비 미편성 존재)' },

  // 6) LG유플러스 — 네트워크 모니터링 (공급 4,500만 → 계약 4,950만) 단일 일시불
  { c: 'LG유플러스', k: '네트워크 모니터링 구축', s: '일시불', o: 1, r: 100, supply: 45000000, due: '2026-06-30', inv: '2026-06-25', st: 'invoiced', note: '단일 단계, 발행 후 입금대기' },

  // 7) 우아한형제들 — 배달 데이터 분석 (공급 2억 → 계약 2.2억) 30/40/30, 잔금 장기 연체
  { c: '우아한형제들', k: '배달 데이터 분석 플랫폼', s: '착수금', o: 1, r: 30, supply: 60000000, due: '2026-02-10', inv: '2026-02-08', st: 'collected', note: '착수금 완료' },
  { c: '우아한형제들', k: '배달 데이터 분석 플랫폼', s: '중도금', o: 2, r: 40, supply: 80000000, due: '2026-04-15', inv: '2026-04-13', st: 'collected', note: '중도금 완료' },
  { c: '우아한형제들', k: '배달 데이터 분석 플랫폼', s: '잔금', o: 3, r: 30, supply: 60000000, due: '2026-05-30', inv: '2026-05-28', st: 'overdue', note: '잔금 장기 연체' },

  // 8) 토스페이먼츠 — 결제 게이트웨이 고도화 (공급 1.6억 → 계약 1.76억) 25/25/25/25
  { c: '토스페이먼츠', k: '결제 게이트웨이 고도화', s: '1차', o: 1, r: 25, supply: 40000000, due: '2026-03-20', inv: '2026-03-18', st: 'collected', note: '1차 완료' },
  { c: '토스페이먼츠', k: '결제 게이트웨이 고도화', s: '2차', o: 2, r: 25, supply: 40000000, due: '2026-05-10', inv: '2026-05-08', st: 'collected', note: '2차 완료' },
  { c: '토스페이먼츠', k: '결제 게이트웨이 고도화', s: '3차', o: 3, r: 25, supply: 40000000, due: '2026-07-05', st: 'scheduled', note: '3차 예정' },
  { c: '토스페이먼츠', k: '결제 게이트웨이 고도화', s: '4차', o: 4, r: 25, supply: 40000000, due: '2026-09-01', st: 'scheduled', note: '4차 예정' },

  // 9) 무신사 — 커머스 추천엔진 (공급 9천만 → 계약 9.9천만) 50/50, 착수금 부분수금
  { c: '무신사', k: '커머스 추천엔진 개발', s: '착수금', o: 1, r: 50, supply: 45000000, due: '2026-05-25', inv: '2026-05-23', st: 'partial', paidInc: 30000000, note: '부분수금(3천만 / 4,950만)' },
  { c: '무신사', k: '커머스 추천엔진 개발', s: '잔금', o: 2, r: 50, supply: 45000000, due: '2026-08-10', st: 'scheduled', note: '잔금 예정' },

  // 10) 두나무 — 보안 시스템 점검 (공급 3천만 → 계약 3.3천만) 단일, 대손처리
  { c: '두나무', k: '보안 시스템 정기점검', s: '일시불', o: 1, r: 100, supply: 30000000, due: '2026-04-30', inv: '2026-04-28', st: 'written_off', note: '회수 불가 — 대손처리' },

  // 11) 오늘의집 — 풀필먼트 시스템 (공급 1.3억 → 계약 1.43억) 30/40/30, 전부 예정(신규)
  { c: '오늘의집', k: '풀필먼트 시스템 구축', s: '착수금', o: 1, r: 30, supply: 39000000, due: '2026-06-15', st: 'scheduled', note: '신규 계약 — 착수 예정' },
  { c: '오늘의집', k: '풀필먼트 시스템 구축', s: '중도금', o: 2, r: 40, supply: 52000000, due: '2026-08-05', st: 'scheduled', note: '중도금 예정' },
  { c: '오늘의집', k: '풀필먼트 시스템 구축', s: '잔금', o: 3, r: 30, supply: 39000000, due: '2026-10-01', st: 'scheduled', note: '잔금 예정' },

  // 12) AWS Korea — 글로벌 인프라 컨설팅 (USD, 공급 120,000) 50/50, 외화 영세율(부가세 0)
  { c: 'AWS Korea', k: '글로벌 인프라 컨설팅', s: '착수금', o: 1, r: 50, supply: 60000, cur: 'USD', due: '2026-06-01', inv: '2026-05-30', st: 'collected', note: 'USD 영세율 — 착수금 완료' },
  { c: 'AWS Korea', k: '글로벌 인프라 컨설팅', s: '잔금', o: 2, r: 50, supply: 60000, cur: 'USD', due: '2026-09-30', st: 'scheduled', note: 'USD 잔금 예정' },

  // 13) 야놀자 — 호텔 PMS 연동 (공급 4천만 → 계약 4.4천만) 50/50, 착수금 연체
  { c: '야놀자', k: '호텔 PMS 연동 개발', s: '착수금', o: 1, r: 50, supply: 20000000, due: '2026-05-28', inv: '2026-05-26', st: 'overdue', note: '착수금 연체' },
  { c: '야놀자', k: '호텔 PMS 연동 개발', s: '잔금', o: 2, r: 50, supply: 20000000, due: '2026-08-20', st: 'scheduled', note: '잔금 예정' },

  // 14~16) 직접 등록 (계약 없음) — 계약명 비움
  { c: '클래스101', k: '', s: '기타', o: 1, supply: 5000000, due: '2026-06-20', st: 'scheduled', note: '직접 등록(계약 없음)' },
  { c: '당근마켓', k: '', s: '기타', o: 1, supply: 8000000, due: '2026-05-18', inv: '2026-05-16', st: 'overdue', note: '직접 등록 — 연체' },
  { c: '리디', k: '', s: '기타', o: 1, supply: 2000000, due: '2026-07-10', st: 'scheduled', note: '직접 등록(계약 없음)' },
];

// 공급가액 → 부가세/수금예정액 자동 계산 + 정규화
function enrich(raw) {
  return raw.map(x => {
    const currency = x.cur || 'KRW';
    const supply = x.supply;
    const tax = currency === 'KRW' ? Math.round(supply * 0.1) : 0; // 외화는 영세율
    const scheduled = supply + tax;
    let paid = 0;
    if (x.paidInc !== undefined) paid = x.paidInc; // 부분수금 명시값
    else if (x.st === 'collected') paid = scheduled; // 완료 = 전액
    return {
      customer_name: x.c,
      contract_name: x.k || '',
      stage_name: x.s,
      stage_order: x.o,
      ratio: x.r ?? null,
      supply_amount: supply,
      tax_amount: tax,
      scheduled_amount: scheduled,
      currency,
      due_date: x.due,
      invoice_date: x.inv || '',
      status: x.st,
      paid_amount: paid,
      note: x.note || '',
    };
  });
}

const ROWS = enrich(RAW);

// 상태 한글 라벨 (범례용)
const STATUS_LABEL = {
  scheduled: '예정',
  invoiced: '청구(계산서 발행)',
  partial: '부분수금',
  collected: '수금완료',
  overdue: '연체',
  written_off: '대손',
};

async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OCI CRM — 수금관리 테스트';

  // ── 시트 1: 수금 일정 데이터 ──
  const ws = wb.addWorksheet('수금일정');
  ws.columns = [
    { header: '고객사', key: 'customer_name', width: 20 },
    { header: '계약명', key: 'contract_name', width: 26 },
    { header: '단계', key: 'stage_name', width: 12 },
    { header: '순서', key: 'stage_order', width: 6 },
    { header: '비율(%)', key: 'ratio', width: 8 },
    { header: '공급가액', key: 'supply_amount', width: 16 },
    { header: '부가세', key: 'tax_amount', width: 14 },
    { header: '수금예정액(VAT포함)', key: 'scheduled_amount', width: 20 },
    { header: '통화', key: 'currency', width: 7 },
    { header: '수금예정일', key: 'due_date', width: 13 },
    { header: '계산서발행(예정)일', key: 'invoice_date', width: 17 },
    { header: '상태', key: 'status', width: 13 },
    { header: '기납입액(실수금)', key: 'paid_amount', width: 16 },
    { header: '비고', key: 'note', width: 30 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { horizontal: 'center', vertical: 'middle' };
  head.height = 22;
  head.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE63329' } }; // OCI Red
  });

  const numCols = ['supply_amount', 'tax_amount', 'scheduled_amount', 'paid_amount'];
  ROWS.forEach(r => {
    const row = ws.addRow(r);
    numCols.forEach(k => {
      row.getCell(k).numFmt = '#,##0';
      row.getCell(k).alignment = { horizontal: 'right' };
    });
    row.getCell('stage_order').alignment = { horizontal: 'center' };
    row.getCell('ratio').alignment = { horizontal: 'center' };
    row.getCell('currency').alignment = { horizontal: 'center' };
    row.getCell('status').alignment = { horizontal: 'center' };
    // 연체/대손 행 강조
    if (r.status === 'overdue') row.getCell('status').font = { color: { argb: 'FFC2410C' }, bold: true };
    if (r.status === 'written_off') row.getCell('status').font = { color: { argb: 'FF9CA3AF' } };
    if (r.status === 'collected') row.getCell('status').font = { color: { argb: 'FF15803D' } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }]; // 헤더 고정
  ws.autoFilter = { from: 'A1', to: 'N1' };

  // ── 시트 2: 범례 ──
  const lg = wb.addWorksheet('범례');
  lg.columns = [
    { header: '구분', key: 'a', width: 20 },
    { header: '값', key: 'b', width: 22 },
    { header: '설명', key: 'c', width: 50 },
  ];
  lg.getRow(1).font = { bold: true };
  const legend = [
    ['상태(status)', 'scheduled', '예정 — 아직 청구 전'],
    ['', 'invoiced', '청구 — 세금계산서 발행 완료, 입금 대기'],
    ['', 'partial', '부분수금 — 일부만 입금됨'],
    ['', 'collected', '수금완료 — 전액 입금'],
    ['', 'overdue', '연체 — 수금예정일 경과 & 미수금 (미수금 탭 + 알림 대상)'],
    ['', 'written_off', '대손 — 회수 불가 처리'],
    ['단계(stage_name)', '착수금/중도금/잔금/기타/일시불', '계약 단계명 (자유 입력 가능)'],
    ['금액 규칙', '수금예정액 = 공급가액 + 부가세', 'VAT포함 기준. 국내=부가세 10%, 외화(USD)=영세율(0)'],
    ['통화(currency)', 'KRW / USD ...', '기본 KRW. 외화는 환율 무관, 표기 단위만'],
    ['계약 연결', '계약명 있음 → 그룹핑', '같은 (고객사+계약명)끼리 계약별로 묶임'],
    ['직접 등록', '계약명 비움', '계약 없이 단건 등록 (클래스101/당근마켓/리디)'],
    ['기준일', '2026-06-10', '연체 판정 기준 (due_date < 기준일 & 미수금)'],
  ];
  legend.forEach(r => lg.addRow({ a: r[0], b: r[1], c: r[2] }));

  // 통계 주석
  const counts = ROWS.reduce((m, r) => {
    m[r.status] = (m[r.status] || 0) + 1;
    return m;
  }, {});
  lg.addRow({});
  lg.addRow({ a: '── 데이터 요약 ──' }).font = { bold: true };
  lg.addRow({ a: '총 건수', b: String(ROWS.length) });
  Object.entries(counts).forEach(([k, v]) =>
    lg.addRow({ a: STATUS_LABEL[k] || k, b: String(v) })
  );

  const out = path.join(__dirname, '수금관리_샘플_34건.xlsx');
  await wb.xlsx.writeFile(out);
  return { out, count: ROWS.length, counts };
}

module.exports = { ROWS, RAW, STATUS_LABEL, generate };

// 직접 실행 시 Excel 생성
if (require.main === module) {
  generate()
    .then(({ out, count, counts }) => {
      console.log('생성 완료:', out);
      console.log('행수:', count, '| 상태분포:', JSON.stringify(counts));
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
