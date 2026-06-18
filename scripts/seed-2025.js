'use strict';
/**
 * 2025년 가상 영업활동 데이터 시드 스크립트
 * node scripts/seed-2025.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'oci_crm',
  multipleStatements: true,
  charset: 'utf8mb4',
});

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log('🌱 2025년 시드 데이터 삽입 시작...\n');

    // ──────────────────────────────────────────
    // 0. 기존 2025 시드 데이터 중복 방지 (고객사 추가만)
    // ──────────────────────────────────────────

    // ──────────────────────────────────────────
    // 1. 팀원 추가 (기존 8명 + 13명 추가 = 21명)
    // ──────────────────────────────────────────
    const [existingTeam] = await conn.query('SELECT COUNT(*) AS cnt FROM team_members');
    if (existingTeam[0].cnt < 15) {
      await conn.query(`
        INSERT INTO team_members (name, role, team, email, avatar_color) VALUES
        ('강민준', 'Sales', '태양광',   'kang.mj@oci.co.kr',   '#e91e63'),
        ('오지현', 'Field', '태양광',   'oh.jh@oci.co.kr',     '#9c27b0'),
        ('임태양', 'Sales', '태양광',   'lim.ty@oci.co.kr',    '#3f51b5'),
        ('배수지', 'Field', '전기/ESS', 'bae.sj@oci.co.kr',    '#009688'),
        ('홍길동', 'Sales', '전기/ESS', 'hong.gd@oci.co.kr',   '#ff5722'),
        ('신현우', 'Field', '해외',     'shin.hw@oci.co.kr',   '#795548'),
        ('안소연', 'Sales', '해외',     'ahn.sy@oci.co.kr',    '#607d8b'),
        ('장도현', 'Field', '태양광',   'jang.dh@oci.co.kr',   '#f44336'),
        ('권나라', 'Sales', '태양광',   'kwon.nr@oci.co.kr',   '#e91e63'),
        ('문지수', 'Field', '전기/ESS', 'moon.js@oci.co.kr',   '#2196f3'),
        ('노준혁', 'Sales', '해외',     'noh.jh@oci.co.kr',    '#4caf50'),
        ('유재석', 'Field', '태양광',   'yoo.js@oci.co.kr',    '#ff9800'),
        ('정소희', 'Sales', '전기/ESS', 'jung.sh@oci.co.kr',   '#00bcd4')
      `);
      console.log('✅ 팀원 13명 추가');
    } else {
      console.log('ℹ️  팀원 이미 충분, 스킵');
    }

    // ──────────────────────────────────────────
    // 2. 고객사 추가
    // ──────────────────────────────────────────
    await conn.query(`
      INSERT IGNORE INTO customers (name, region, country, industry, contact_person, phone, email) VALUES
      ('한국중부발전',       '국내', '대한민국', '발전',     '조부장', '042-712-1234', 'jo@komipo.co.kr'),
      ('한국서부발전',       '국내', '대한민국', '발전',     '신팀장', '041-400-1234', 'shin@kowepo.co.kr'),
      ('LS Electric',        '국내', '대한민국', '전기',     '전상무', '043-871-1234', 'jeon@lselectric.co.kr'),
      ('효성중공업',         '국내', '대한민국', '중공업',   '황부장', '02-707-7000',  'hwang@hyosung.com'),
      ('현대에너지솔루션',   '국내', '대한민국', '에너지',   '윤과장', '02-3464-3000', 'yoon@hes.co.kr'),
      ('삼성물산 리조트부문','국내', '대한민국', '건설',     '이차장', '02-2145-5000', 'lee@samsungct.com'),
      ('포스코에너지',       '국내', '대한민국', '에너지',   '박상무', '054-220-5000', 'park@poscoenergy.com'),
      ('태광산업',           '국내', '대한민국', '산업',     '최부장', '02-3403-1234', 'choi@taekwang.co.kr'),
      ('Sembcorp Industries','해외', '싱가포르', '에너지',   'James Tan',   '+65-6723-1234',  'james@sembcorp.com'),
      ('NTPC Limited',       '해외', '인도',     '발전',     'Anil Sharma', '+91-11-2436-0100','anil@ntpc.co.in'),
      ('Jera Co.',           '해외', '일본',     '에너지',   'Yamamoto Ken','+81-3-6741-7400', 'yamamoto@jera.co.jp'),
      ('Orsted Asia Pacific','해외', '덴마크',   '에너지',   'Lars Nielsen','+45-9955-1234',   'lars@orsted.com'),
      ('First Solar APAC',   '해외', '미국',     '태양광',   'Michael Chen','+1-602-414-9300',  'mchen@firstsolar.com')
    `);
    console.log('✅ 고객사 추가');

    // ──────────────────────────────────────────
    // 3. 2025년 영업 리드 (총 48건: 월별 분산)
    //    won(15건) / lost(6건) / dropped(4건) / active(23건)
    // ──────────────────────────────────────────
    // 팀원 ID 매핑 (재조회)
    const [members] = await conn.query('SELECT id FROM team_members ORDER BY id');
    const ids = members.map(m => m.id);
    // 최소 8명 기준으로 매핑
    const [m1,m2,m3,m4,m5,m6,m7,m8] = ids;
    const m9  = ids[8]  || m1;
    const m10 = ids[9]  || m2;
    const m11 = ids[10] || m3;
    const m12 = ids[11] || m1;
    const m13 = ids[12] || m2;
    const m14 = ids[13] || m3;
    const m15 = ids[14] || m1;
    const m16 = ids[15] || m2;
    const m17 = ids[16] || m3;
    const m18 = ids[17] || m1;
    const m19 = ids[18] || m2;
    const m20 = ids[19] || m3;
    const m21 = ids[20] || m1;

    await conn.query(`
      INSERT INTO leads
        (customer_name, project_name, business_type, region, capacity_mw, expected_amount, currency,
         stage, assigned_to, expected_close_date, bidding_deadline, source, notes, created_at, updated_at)
      VALUES
      -- ─────────── 1월 ───────────
      ('한국중부발전',     '군산 30MW 태양광 EPC',          'EPC',    '국내', 30.00,  82.00, 'KRW', 'won',         ${m2}, '2025-03-20', NULL,         '전시회',  '1분기 수주 완료', '2025-01-08', '2025-03-20'),
      ('현대에너지솔루션', '서울 상암 지붕형 3MW 설치',     '설치',   '국내',  3.00,   9.50, 'KRW', 'won',         ${m5}, '2025-02-28', NULL,         '소개',    '지붕형 소규모 수주', '2025-01-12', '2025-02-28'),
      ('Sembcorp Industries','싱가포르 50MW 모듈 공급',     '모듈',   '해외', 50.00,3850.00, 'USD', 'lost',        ${m7}, '2025-04-30', NULL,         '해외전시','현지업체에 패배', '2025-01-15', '2025-04-10'),
      ('포스코에너지',     '광양 공장 5MW 지붕형 ESS 연계', 'ESS',    '국내',  5.00,  16.00, 'KRW', 'review',      ${m5}, '2025-07-30', NULL,         '웹사이트','기술 검토 진행중', '2025-01-20', '2025-04-01'),

      -- ─────────── 2월 ───────────
      ('한국서부발전',     '서인천 20MW 태양광',             '태양광', '국내', 20.00,  51.00, 'KRW', 'won',         ${m1}, '2025-05-01', NULL,         '입찰',    '2분기 수주', '2025-02-03', '2025-05-01'),
      ('LS Electric',      '경기 평택 ESS 20MWh',           'ESS',    '국내',  0.00,  36.00, 'KRW', 'won',         ${m5}, '2025-04-15', NULL,         '소개',    '배터리 시스템 수주', '2025-02-10', '2025-04-15'),
      ('NTPC Limited',     '인도 라자스탄 100MW 모듈',      '모듈',   '해외',100.00,3640.00, 'USD', 'proposal',    ${m3}, '2025-08-30', '2025-07-15', '해외전시','$52M 견적 진행중', '2025-02-14', '2025-05-20'),
      ('삼성물산 리조트부문','제주 골프장 2MW 설치',         '설치',   '국내',  2.00,   7.20, 'KRW', 'dropped',     ${m9}, '2025-04-30', NULL,         '소개',    '예산 동결로 무기한 연기', '2025-02-18', '2025-04-20'),

      -- ─────────── 3월 ───────────
      ('효성중공업',       '창원 본사 옥상 1.5MW',          '설치',   '국내',  1.50,   5.80, 'KRW', 'won',         ${m9}, '2025-05-31', NULL,         '직접영업','소규모 수주', '2025-03-05', '2025-05-31'),
      ('AGL Energy',       '퀸즐랜드 120MW EPC',             'EPC',    '해외',120.00,9120.00, 'AUD', 'won',         ${m3}, '2025-06-30', '2025-05-20', '해외전시','A$66M 수주 확정', '2025-03-10', '2025-06-30'),
      ('태광산업',         '울산 공장 4MW 지붕형',           '설치',   '국내',  4.00,  13.00, 'KRW', 'review',      ${m6}, '2025-09-30', NULL,         '소개',    '현장 실사 완료', '2025-03-17', '2025-05-15'),
      ('Jera Co.',         '도쿄 인근 80MW 모듈 공급',       '모듈',   '해외', 80.00,9200.00, 'JPY', 'bidding',     ${m7}, '2025-07-31', '2025-06-30', '해외전시','¥92억 입찰 진행중', '2025-03-22', '2025-05-25'),

      -- ─────────── 4월 ───────────
      ('한국남부발전',     '부산 신항 ESS 30MWh',           'ESS',    '국내',  0.00,  54.00, 'KRW', 'won',         ${m5}, '2025-07-15', NULL,         '입찰',    '항만 ESS 수주', '2025-04-02', '2025-07-15'),
      ('한화에너지',       '충북 50MW 태양광 EPC',           'EPC',    '국내', 50.00, 138.00, 'KRW', 'negotiation', ${m2}, '2025-06-30', '2025-06-01', '소개',    '계약 최종 협의중', '2025-04-08', '2025-05-25'),
      ('ReNew Power',      '구자라트 150MW EPC',             'EPC',    '해외',150.00,8250.00, 'USD', 'proposal',    ${m3}, '2025-09-30', '2025-08-20', '해외전시','$55M 기술 제안중', '2025-04-15', '2025-05-30'),
      ('First Solar APAC', '호주 NSW 200MW 모듈 협력',       '모듈',   '해외',200.00,12600.00,'USD', 'review',      ${m7}, '2025-11-30', NULL,         '해외전시','전략적 파트너십 검토', '2025-04-20', '2025-05-10'),

      -- ─────────── 5월 ───────────
      ('한국동서발전',     '당진 60MW 태양광 EPC',           'EPC',    '국내', 60.00, 162.00, 'KRW', 'won',         ${m1}, '2025-08-31', '2025-07-10', '입찰',    '공개입찰 수주', '2025-05-06', '2025-08-31'),
      ('SK에코플랜트',     '경기 이천 물류센터 지붕형 8MW',  '설치',   '국내',  8.00,  28.00, 'KRW', 'won',         ${m9}, '2025-08-15', NULL,         '소개',    '물류창고 지붕형 수주', '2025-05-12', '2025-08-15'),
      ('Orsted Asia Pacific','한국 해상풍력 연계 ESS 50MWh', 'ESS',    '해외',  0.00,28000.00, 'USD', 'proposal',   ${m3}, '2025-12-31', NULL,         '해외전시','$200M 규모 대형 검토', '2025-05-19', '2025-05-19'),
      ('GS E&R',           '전남 나주 30MW 태양광',          '태양광', '국내', 30.00,  78.00, 'KRW', 'negotiation', ${m2}, '2025-07-31', '2025-06-20', '소개',    '가격 협의 막바지', '2025-05-26', '2025-05-26'),

      -- ─────────── 6월 ───────────
      ('두산에너빌리티',   '창원 ESS 15MWh 시범사업',       'ESS',    '국내',  0.00,  27.00, 'KRW', 'won',         ${m5}, '2025-09-30', NULL,         '정부과제','시범사업 수주', '2025-06-03', '2025-09-30'),
      ('VPL Corp',         '하노이 30MW 모듈 공급',          '모듈',   '해외', 30.00,2310.00, 'USD', 'proposal',    ${m3}, '2025-10-31', NULL,         '해외영업','$16.5M 견적 제출', '2025-06-10', '2025-06-10'),
      ('한국중부발전',     '보령 70MW EPC',                  'EPC',    '국내', 70.00, 189.00, 'KRW', 'bidding',     ${m1}, '2025-09-15', '2025-08-01', '입찰',    '2차 입찰 진행중', '2025-06-17', '2025-06-17'),
      ('SoftBank Energy',  '오사카 태양광 모듈 공급',         '모듈',   '해외', 40.00,4800.00, 'JPY', 'lost',        ${m7}, '2025-09-30', '2025-08-15', '소개',    '자국업체 선정', '2025-06-24', '2025-09-20'),

      -- ─────────── 7월 ───────────
      ('SK이노베이션',     '울산 배터리공장 ESS 20MWh',      'ESS',    '국내',  0.00,  37.00, 'KRW', 'won',         ${m5}, '2025-10-31', NULL,         '소개',    '배터리공장 내부 수주', '2025-07-01', '2025-10-31'),
      ('현대에너지솔루션', '경기 화성 50MW 태양광 EPC',      'EPC',    '국내', 50.00, 132.00, 'KRW', 'won',         ${m2}, '2025-11-30', '2025-10-01', '입찰',    '공개입찰 최저가 수주', '2025-07-08', '2025-11-30'),
      ('NTPC Limited',     '안드라 50MW 모듈',               '모듈',   '해외', 50.00,1820.00, 'USD', 'negotiation', ${m3}, '2025-11-30', NULL,         '해외전시','$13M 협상중', '2025-07-15', '2025-07-15'),
      ('효성중공업',       '울산 정유공장 10MW 지붕형',      '설치',   '국내', 10.00,  32.00, 'KRW', 'proposal',    ${m6}, '2025-11-15', NULL,         '직접영업','대형 지붕형 제안 준비', '2025-07-22', '2025-07-22'),

      -- ─────────── 8월 ───────────
      ('한국서부발전',     '태안 100MW 태양광',               '태양광', '국내',100.00, 268.00, 'KRW', 'won',         ${m1}, '2025-12-31', '2025-11-01', '입찰',    '연말 대형 수주', '2025-08-05', '2025-12-31'),
      ('포스코에너지',     '포항 ESS 50MWh 대형사업',        'ESS',    '국내',  0.00,  90.00, 'KRW', 'review',      ${m5}, '2026-02-28', NULL,         '직접영업','대형 ESS 검토 착수', '2025-08-12', '2025-08-12'),
      ('Sembcorp Industries','싱가포르 ESS 30MWh',           'ESS',    '해외',  0.00,7200.00, 'USD', 'proposal',    ${m7}, '2026-01-31', NULL,         '해외전시','$52M ESS 제안서 제출', '2025-08-19', '2025-08-19'),
      ('LS Electric',      '평택 ESS 추가 10MWh',            'ESS',    '국내',  0.00,  19.00, 'KRW', 'dropped',     ${m5}, '2025-10-31', NULL,         '소개',    '사업 우선순위 변경으로 보류', '2025-08-26', '2025-10-15'),

      -- ─────────── 9월 ───────────
      ('한화에너지',       '전북 익산 40MW EPC',              'EPC',    '국내', 40.00, 109.00, 'KRW', 'won',         ${m2}, '2026-03-31', '2025-12-01', '입찰',    '연도 이월 수주 확정', '2025-09-02', '2025-12-20'),
      ('ReNew Power',      '텔랑가나 80MW 태양광 모듈',       '모듈',   '해외', 80.00,2912.00, 'USD', 'proposal',    ${m3}, '2026-02-28', NULL,         '해외전시','$20M 견적 제출 완료', '2025-09-09', '2025-09-09'),
      ('태광산업',         '대전 공장 ESS 5MWh',             'ESS',    '국내',  0.00,   9.50, 'KRW', 'lost',        ${m6}, '2025-11-30', NULL,         '소개',    '경쟁사 대비 가격 열세', '2025-09-16', '2025-11-10'),
      ('GS E&R',           '강원 평창 30MW 풍력 연계 ESS',   'ESS',    '국내',  0.00,  58.00, 'KRW', 'negotiation', ${m5}, '2026-01-31', NULL,         '소개',    '풍력+ESS 패키지 협의중', '2025-09-23', '2025-09-23'),

      -- ─────────── 10월 ───────────
      ('두산에너빌리티',   '경남 거제 20MW EPC',              'EPC',    '국내', 20.00,  55.00, 'KRW', 'won',         ${m1}, '2026-04-30', '2025-12-15', '입찰',    '내년 착공 수주', '2025-10-07', '2025-12-30'),
      ('First Solar APAC', '베트남 200MW 모듈 공급',          '모듈',   '해외',200.00,7000.00, 'USD', 'review',      ${m7}, '2026-06-30', NULL,         '해외전시','전략 파트너십 확장', '2025-10-14', '2025-10-14'),
      ('삼성물산 리조트부문','리조트 단지 10MW 태양광',        '태양광', '국내', 10.00,  29.00, 'KRW', 'proposal',    ${m9}, '2026-03-31', NULL,         '소개',    '리조트 그린에너지 전환', '2025-10-21', '2025-10-21'),
      ('Orsted Asia Pacific','서해 해상풍력 연계 ESS 100MWh','ESS',    '해외',  0.00,56000.00, 'USD', 'review',      ${m3}, '2026-12-31', NULL,         '해외전시','$400M 초대형 해상 프로젝트', '2025-10-28', '2025-10-28'),

      -- ─────────── 11월 ───────────
      ('한국동서발전',     '여수 80MW 태양광 입찰',           '태양광', '국내', 80.00, 213.00, 'KRW', 'bidding',     ${m2}, '2026-03-31', '2026-01-15', '입찰',    '상반기 착공 목표 입찰', '2025-11-04', '2025-11-04'),
      ('SK에코플랜트',     '인천 수도권 ESS 40MWh',          'ESS',    '국내',  0.00,  74.00, 'KRW', 'proposal',    ${m5}, '2026-04-30', NULL,         '소개',    '수도권 대형 ESS 제안', '2025-11-11', '2025-11-11'),
      ('Jera Co.',         '나고야 60MW EPC 협력',            'EPC',    '해외', 60.00,7200.00, 'JPY', 'negotiation', ${m7}, '2026-05-31', NULL,         '소개',    '일본 진출 교두보 협상', '2025-11-18', '2025-11-18'),
      ('VPL Corp',         '호치민 2차 50MW 모듈',            '모듈',   '해외', 50.00,3850.00, 'USD', 'proposal',    ${m3}, '2026-04-30', NULL,         '해외영업','1차 계약 후속 물량', '2025-11-25', '2025-11-25'),

      -- ─────────── 12월 ───────────
      ('NTPC Limited',     '라자스탄 300MW 모듈 대형 공급',   '모듈',   '해외',300.00,10920.00,'USD', 'review',      ${m3}, '2026-09-30', NULL,         '해외전시','$78M 초대형 수주 검토', '2025-12-02', '2025-12-02'),
      ('한국남부발전',     '제주 제2 태양광 50MW EPC',        'EPC',    '국내', 50.00, 138.00, 'KRW', 'lead',        ${m1}, '2026-06-30', NULL,         '소개',    '제주 에너지전환 사업 초기 접촉', '2025-12-09', '2025-12-09'),
      ('포스코에너지',     '광양제철소 30MW 지붕형 EPC',      'EPC',    '국내', 30.00,  85.00, 'KRW', 'lead',        ${m2}, '2026-05-31', NULL,         '직접영업','철강 공장 옥상 대형 프로젝트', '2025-12-16', '2025-12-16'),
      ('한화에너지',       '세종 스마트시티 ESS 20MWh',       'ESS',    '국내',  0.00,  38.00, 'KRW', 'proposal',    ${m5}, '2026-06-30', NULL,         '소개',    '스마트시티 에너지 저장 제안', '2025-12-23', '2025-12-23')
    `);
    console.log('✅ 2025년 리드 48건 삽입');

    // 방금 삽입된 리드 ID 조회 (2025년 데이터)
    const [newLeads] = await conn.query(`
      SELECT id, customer_name, project_name, stage, assigned_to, created_at
      FROM leads
      WHERE YEAR(created_at) = 2025
      ORDER BY created_at
    `);
    console.log(`  → 조회된 2025 리드: ${newLeads.length}건`);

    // ──────────────────────────────────────────
    // 4. 2025년 활동 이력 (리드별 2~4건)
    // ──────────────────────────────────────────
    const activityRows = [];
    for (const lead of newLeads) {
      const assignee = lead.assigned_to || m1;
      const created  = new Date(lead.created_at);

      // 공통 활동: 최초 전화/이메일
      const t1 = new Date(created); t1.setDate(t1.getDate() + 3);
      activityRows.push([lead.id, '전화', `${lead.customer_name} 초기 컨택`, `${lead.project_name} 사업 가능성 논의 및 담당자 확인`, assignee, fmtTs(t1)]);

      // 미팅 활동
      const t2 = new Date(created); t2.setDate(t2.getDate() + 14);
      activityRows.push([lead.id, '미팅', `${lead.customer_name} 기술 미팅`, `${lead.project_name} 기술 사양 및 일정 협의`, assignee, fmtTs(t2)]);

      // 단계별 추가 활동
      if (['proposal','bidding','negotiation','won','lost','dropped'].includes(lead.stage)) {
        const t3 = new Date(created); t3.setDate(t3.getDate() + 28);
        activityRows.push([lead.id, '제안서', `${lead.customer_name} 제안서 제출`, `${lead.project_name} 기술/가격 제안서 공식 제출`, assignee, fmtTs(t3)]);
      }
      if (['bidding','negotiation','won'].includes(lead.stage)) {
        const t4 = new Date(created); t4.setDate(t4.getDate() + 45);
        activityRows.push([lead.id, '입찰', `${lead.customer_name} 입찰 참여`, `${lead.project_name} 입찰서 제출 완료, 결과 대기중`, assignee, fmtTs(t4)]);
      }
      if (lead.stage === 'won') {
        const wonDate = new Date(lead.updated_at || created); wonDate.setDate(wonDate.getDate() - 1);
        activityRows.push([lead.id, '수주', `${lead.customer_name} 수주 완료`, `${lead.project_name} 계약 체결 완료`, assignee, fmtTs(wonDate)]);
      }
      if (lead.stage === 'lost') {
        const t5 = new Date(lead.updated_at || created);
        activityRows.push([lead.id, '기타', `${lead.customer_name} 실주 처리`, `${lead.project_name} 경쟁사 선정으로 실주 처리`, assignee, fmtTs(t5)]);
      }
      if (lead.stage === 'dropped') {
        const t5 = new Date(lead.updated_at || created);
        activityRows.push([lead.id, '드롭', `${lead.customer_name} 드롭 처리`, `${lead.project_name} 사업 보류/취소로 드롭`, assignee, fmtTs(t5)]);
      }
    }

    if (activityRows.length > 0) {
      const placeholders = activityRows.map(() => '(?,?,?,?,?,?)').join(',');
      const values = activityRows.flat();
      await conn.query(
        `INSERT INTO activities (lead_id, activity_type, title, content, performed_by, performed_at) VALUES ${placeholders}`,
        values
      );
      console.log(`✅ 활동 이력 ${activityRows.length}건 삽입`);
    }

    // ──────────────────────────────────────────
    // 5. 수주 리드 → 프로젝트 생성
    // ──────────────────────────────────────────
    const wonLeads = newLeads.filter(l => l.stage === 'won');
    const [existingProjects] = await conn.query('SELECT lead_id FROM projects WHERE lead_id IS NOT NULL');
    const existingLeadIds = new Set(existingProjects.map(p => p.lead_id));

    const [allLeads] = await conn.query(`
      SELECT id, customer_name, project_name, business_type, expected_amount, currency,
             assigned_to, expected_close_date, updated_at
      FROM leads WHERE stage = 'won' AND YEAR(created_at) = 2025
    `);

    const projectRows = [];
    const statusOptions = ['진행중','제조중','제조중','납기지연','완료','완료','완료'];
    let pi = 0;
    for (const lead of allLeads) {
      if (existingLeadIds.has(lead.id)) continue;
      const amt    = parseFloat(lead.expected_amount) || 50;
      const cost   = (amt * (0.72 + Math.random() * 0.08)).toFixed(2);
      const margin = (((amt - parseFloat(cost)) / amt) * 100).toFixed(2);
      const status = statusOptions[pi % statusOptions.length]; pi++;
      const dueDate = lead.expected_close_date || '2025-12-31';
      projectRows.push([
        lead.project_name,
        lead.customer_name,
        lead.business_type,
        amt,
        cost,
        margin,
        status,
        dueDate,
        lead.assigned_to || m1,
        lead.id
      ]);
    }

    if (projectRows.length > 0) {
      const ph = projectRows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
      await conn.query(
        `INSERT INTO projects (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct, status, due_date, assigned_to, lead_id) VALUES ${ph}`,
        projectRows.flat()
      );
      console.log(`✅ 프로젝트 ${projectRows.length}건 생성`);
    }

    // ──────────────────────────────────────────
    // 6. 캘린더 이벤트 (월 3~5건, 연간 약 50건)
    // ──────────────────────────────────────────
    await conn.query(`
      INSERT INTO calendar_events (title, description, start_datetime, end_datetime, all_day, event_type, status, customer_name, assigned_to, color)
      VALUES
      -- 1월
      ('한국중부발전 사업설명회',          '군산 EPC 프로젝트 킥오프',   '2025-01-09 10:00:00','2025-01-09 12:00:00',0,'미팅',    'completed','한국중부발전',  ${m2},'#1a73e8'),
      ('현대에너지솔루션 현장 실사',        '상암 지붕형 3MW 부지 확인', '2025-01-13 14:00:00','2025-01-13 17:00:00',0,'영업방문','completed','현대에너지솔루션',${m5},'#0f9d58'),
      ('Sembcorp 온라인 미팅',             '싱가포르 50MW 초기 협의',   '2025-01-16 15:00:00','2025-01-16 16:30:00',0,'미팅',    'completed','Sembcorp Industries',${m7},'#1a73e8'),
      -- 2월
      ('서인천 태양광 입찰 D-Day',         '서인천 20MW 입찰서 제출',   '2025-02-05 09:00:00','2025-02-05 18:00:00',1,'입찰',    'completed','한국서부발전',  ${m1},'#e53935'),
      ('LS Electric ESS 기술 미팅',        '평택 ESS 기술 협의',        '2025-02-12 10:00:00','2025-02-12 12:00:00',0,'미팅',    'completed','LS Electric',   ${m5},'#1a73e8'),
      ('NTPC 온라인 기술 발표',            '라자스탄 100MW 제안 발표',  '2025-02-17 14:00:00','2025-02-17 16:00:00',0,'제안',    'completed','NTPC Limited',  ${m3},'#fb8c00'),
      -- 3월
      ('AGL Energy 현장 방문',             '퀸즐랜드 사이트 실사',      '2025-03-11 09:00:00','2025-03-12 18:00:00',0,'영업방문','completed','AGL Energy',    ${m3},'#0f9d58'),
      ('효성중공업 계약 협의',             '창원 옥상 1.5MW 최종 협상', '2025-03-18 14:00:00','2025-03-18 17:00:00',0,'미팅',    'completed','효성중공업',    ${m9},'#1a73e8'),
      ('Jera 입찰서 접수 마감',            '도쿄 80MW 모듈 입찰 마감',  '2025-03-25 18:00:00', NULL,                 1,'입찰',    'completed','Jera Co.',      ${m7},'#e53935'),
      -- 4월
      ('한국남부발전 부산항 ESS 착수회의', '30MWh 프로젝트 킥오프',     '2025-04-04 10:00:00','2025-04-04 12:00:00',0,'내부',    'completed','한국남부발전',  ${m5},'#8e24aa'),
      ('한화에너지 50MW EPC 제안 발표',    '충북 제안서 발표 미팅',     '2025-04-10 14:00:00','2025-04-10 16:00:00',0,'제안',    'completed','한화에너지',    ${m2},'#fb8c00'),
      ('ReNew Power 인도 출장',            '구자라트 사이트 방문',      '2025-04-16 09:00:00','2025-04-18 18:00:00',0,'영업방문','completed','ReNew Power',   ${m3},'#0f9d58'),
      -- 5월
      ('당진 60MW 입찰 D-Day',             '한국동서발전 공개입찰',     '2025-05-08 09:00:00','2025-05-08 18:00:00',1,'입찰',    'completed','한국동서발전',  ${m1},'#e53935'),
      ('SK에코플랜트 이천 현장 실사',      '물류센터 지붕형 8MW',       '2025-05-14 13:00:00','2025-05-14 17:00:00',0,'영업방문','completed','SK에코플랜트',  ${m9},'#0f9d58'),
      ('Orsted 화상 미팅',                  '해상풍력 ESS 연계 논의',    '2025-05-20 15:00:00','2025-05-20 17:00:00',0,'미팅',    'completed','Orsted Asia Pacific',${m3},'#1a73e8'),
      -- 6월
      ('두산에너빌리티 창원 ESS 착수',     '시범사업 착수회의',         '2025-06-05 10:00:00','2025-06-05 12:00:00',0,'내부',    'completed','두산에너빌리티',${m5},'#8e24aa'),
      ('보령 70MW 입찰 제출',              '한국중부발전 2차 입찰',     '2025-06-19 09:00:00','2025-06-19 18:00:00',1,'입찰',    'completed','한국중부발전',  ${m1},'#e53935'),
      ('VPL Corp 하노이 출장',             '하노이 30MW 모듈 협의',     '2025-06-25 09:00:00','2025-06-27 18:00:00',0,'영업방문','completed','VPL Corp',      ${m3},'#0f9d58'),
      -- 7월
      ('SK이노베이션 울산 계약 체결',      '배터리공장 ESS 계약 서명',  '2025-07-02 14:00:00','2025-07-02 16:00:00',0,'미팅',    'completed','SK이노베이션',  ${m5},'#1a73e8'),
      ('화성 50MW EPC 입찰 마감',          '현대에너지솔루션 공개입찰', '2025-07-10 09:00:00','2025-07-10 18:00:00',1,'입찰',    'completed','현대에너지솔루션',${m2},'#e53935'),
      ('NTPC 안드라 프라데시 출장',        '50MW 협상 미팅',            '2025-07-17 09:00:00','2025-07-19 18:00:00',0,'영업방문','completed','NTPC Limited',  ${m3},'#0f9d58'),
      -- 8월
      ('태안 100MW 입찰 D-Day',            '한국서부발전 대형 입찰',    '2025-08-07 09:00:00','2025-08-07 18:00:00',1,'입찰',    'completed','한국서부발전',  ${m1},'#e53935'),
      ('Sembcorp ESS 기술 제안',           '싱가포르 30MWh 제안 발표',  '2025-08-21 15:00:00','2025-08-21 17:00:00',0,'제안',    'completed','Sembcorp Industries',${m7},'#fb8c00'),
      ('포스코에너지 광양 현장 실사',      '포항 ESS 50MWh 부지 확인',  '2025-08-28 10:00:00','2025-08-28 17:00:00',0,'영업방문','completed','포스코에너지',  ${m5},'#0f9d58'),
      -- 9월
      ('한화에너지 익산 EPC 입찰',         '전북 40MW 공개입찰',        '2025-09-04 09:00:00','2025-09-04 18:00:00',1,'입찰',    'completed','한화에너지',    ${m2},'#e53935'),
      ('GS E&R 강원 ESS 협의',            '평창 ESS 30MWh 기술 협의',  '2025-09-25 14:00:00','2025-09-25 16:00:00',0,'미팅',    'completed','GS E&R',        ${m5},'#1a73e8'),
      ('ReNew Power 텔랑가나 사이트 방문', '80MW 부지 확인 출장',       '2025-09-18 09:00:00','2025-09-20 18:00:00',0,'영업방문','completed','ReNew Power',   ${m3},'#0f9d58'),
      -- 10월
      ('거제 20MW EPC 입찰 마감',          '두산에너빌리티 공개입찰',   '2025-10-09 09:00:00','2025-10-09 18:00:00',1,'입찰',    'completed','두산에너빌리티',${m1},'#e53935'),
      ('First Solar 베트남 출장',          '200MW 모듈 파트너십 논의',  '2025-10-16 09:00:00','2025-10-18 18:00:00',0,'영업방문','completed','First Solar APAC',${m7},'#0f9d58'),
      ('삼성물산 리조트 제안 발표',        '리조트 10MW 태양광 제안',   '2025-10-23 14:00:00','2025-10-23 16:00:00',0,'제안',    'completed','삼성물산 리조트부문',${m9},'#fb8c00'),
      -- 11월
      ('여수 80MW 입찰 준비 내부 회의',    '한국동서발전 입찰 전략 수립','2025-11-06 10:00:00','2025-11-06 12:00:00',0,'내부',    'completed','한국동서발전',  ${m2},'#8e24aa'),
      ('SK에코플랜트 인천 ESS 제안',       '40MWh 제안서 발표 미팅',    '2025-11-13 14:00:00','2025-11-13 16:00:00',0,'제안',    'completed','SK에코플랜트',  ${m5},'#fb8c00'),
      ('Jera 나고야 출장',                 '일본 60MW EPC 협력 협상',   '2025-11-20 09:00:00','2025-11-22 18:00:00',0,'영업방문','completed','Jera Co.',      ${m7},'#0f9d58'),
      -- 12월
      ('NTPC 라자스탄 300MW 수주 심의',    '초대형 모듈 공급 전략 회의','2025-12-04 10:00:00','2025-12-04 12:00:00',0,'내부',    'completed','NTPC Limited',  ${m3},'#8e24aa'),
      ('한화에너지 익산 EPC 수주 확정',    '계약서 서명 완료',          '2025-12-20 14:00:00','2025-12-20 16:00:00',0,'미팅',    'completed','한화에너지',    ${m2},'#1a73e8'),
      ('2025년 연간 영업 결산 회의',       '전체 팀 실적 검토 및 2026년 목표 설정','2025-12-26 10:00:00','2025-12-26 17:00:00',0,'내부','completed',NULL,${m1},'#8e24aa')
    `);
    console.log('✅ 캘린더 이벤트 삽입');

    // ──────────────────────────────────────────
    // 7. 회의록 (주요 미팅 10건)
    // ──────────────────────────────────────────
    await conn.query(`
      INSERT INTO meeting_minutes (title, meeting_date, summary_md, customer_name, created_by, created_at)
      VALUES
      ('한국중부발전 군산 EPC 킥오프 미팅',     '2025-01-09',
       '## 회의 요약\n- 군산 30MW EPC 프로젝트 사업 구조 확정\n- 기술 사양 협의 및 일정 수립\n\n## 주요 내용\n- **계약금액**: ₩82억\n- **착공 예정**: 2025년 3월\n- **완공 목표**: 2025년 9월\n\n## 액션 아이템\n- [ ] 구조물 기초 설계 착수 (박세일즈, 1/20)\n- [ ] 모듈 조달 계획 수립 (이필드, 1/25)',
       '한국중부발전', ${m2}, '2025-01-09'),

      ('AGL Energy 퀸즐랜드 사이트 실사',       '2025-03-11',
       '## 회의 요약\n- 퀸즐랜드 120MW 사이트 실사 완료\n- 현지 토지 조건 및 계통 연계 검토\n\n## 주요 내용\n- **사이트 면적**: 약 180ha 확보 가능\n- **계통 연계**: 11km 송전선 신설 필요\n- **허가 예상 기간**: 4~6개월\n\n## 액션 아이템\n- [ ] 허가 컨설팅 업체 선정 (정필드, 3/20)\n- [ ] 현지 EPC 파트너 협의 (정필드, 3/25)',
       'AGL Energy', ${m3}, '2025-03-12'),

      ('ReNew Power 인도 구자라트 출장 보고',   '2025-04-17',
       '## 회의 요약\n- 구자라트 150MW EPC 사업 현지 실사\n- 인도 정부 허가 프로세스 검토\n\n## 주요 내용\n- **현지 파트너**: L&T Solar 협력 논의중\n- **모듈 사양**: TOPCon 585W 적용 예정\n- **예상 IRR**: 12.3%\n\n## 액션 아이템\n- [ ] 현지 파트너 계약서 초안 작성 (정필드, 4/25)\n- [ ] 가격 경쟁력 분석 보고서 제출 (윤세일즈, 4/30)',
       'ReNew Power', ${m3}, '2025-04-17'),

      ('한화에너지 충북 50MW EPC 제안 발표',    '2025-04-10',
       '## 회의 요약\n- 충북 50MW EPC 기술/가격 제안서 발표\n- 경쟁사 대비 OCI 강점 설명\n\n## 주요 내용\n- **제안가**: ₩138억 (VAT 별도)\n- **공기**: 12개월\n- **모듈 보증**: 30년\n\n## 액션 아이템\n- [ ] 최종 가격 조정 협의 (박세일즈, 4/18)\n- [ ] 계약 조건 검토 (법무팀, 4/20)',
       '한화에너지', ${m2}, '2025-04-10'),

      ('한국동서발전 당진 60MW 입찰 결과',      '2025-05-09',
       '## 회의 요약\n- 당진 60MW 태양광 공개입찰 결과 발표\n- OCI 최저가 선정\n\n## 주요 내용\n- **낙찰가**: ₩162억\n- **경쟁사**: A사(₩171억), B사(₩168억)\n- **착공일**: 2025년 7월 1일\n\n## 액션 아이템\n- [ ] 계약서 작성 착수 (법무팀, 5/15)\n- [ ] 착공 전 준비사항 점검 (이필드, 5/20)',
       '한국동서발전', ${m1}, '2025-05-09'),

      ('두산에너빌리티 창원 ESS 착수 회의',     '2025-06-05',
       '## 회의 요약\n- 창원 ESS 15MWh 시범사업 프로젝트 착수\n- 정부 과제 요구사항 및 일정 확정\n\n## 주요 내용\n- **시스템 구성**: LFP 배터리 + PCS 1MW×15\n- **준공 목표**: 2025년 9월 30일\n- **성능보증**: 80% @ 10년\n\n## 액션 아이템\n- [ ] BMS 설정 완료 (최세일즈, 6/20)\n- [ ] 계통 연계 신청 (배수지, 6/15)',
       '두산에너빌리티', ${m5}, '2025-06-05'),

      ('SK이노베이션 울산 ESS 계약 체결',       '2025-07-02',
       '## 회의 요약\n- 울산 배터리공장 ESS 20MWh 계약 서명\n- 설치 일정 및 운영 조건 확정\n\n## 주요 내용\n- **계약금액**: ₩37억\n- **납기**: 2025년 10월 31일\n- **운영 기간**: 10년 O&M 포함\n\n## 액션 아이템\n- [ ] 기기 발주 (최세일즈, 7/10)\n- [ ] 현장 시공 일정 수립 (한필드, 7/15)',
       'SK이노베이션', ${m5}, '2025-07-02'),

      ('한국서부발전 태안 100MW 수주 보고',     '2025-12-02',
       '## 회의 요약\n- 태안 100MW 태양광 입찰 최종 낙찰\n- 연간 최대 규모 수주 확정\n\n## 주요 내용\n- **계약금액**: ₩268억\n- **준공 목표**: 2026년 6월\n- **발전량**: 연간 약 130GWh\n\n## 액션 아이템\n- [ ] PMC 계약 체결 (이필드, 12/10)\n- [ ] 설계 착수 (오지현, 12/15)',
       '한국서부발전', ${m1}, '2025-12-02'),

      ('2025년 4분기 영업 파이프라인 검토',     '2025-10-02',
       '## 회의 요약\n- Q4 파이프라인 현황 점검\n- 연말 수주 목표 달성 전략 수립\n\n## 파이프라인 현황 (2025-10-02 기준)\n| 단계 | 건수 | 예상금액 |\n|------|------|----------|\n| 협상/계약 | 3건 | ₩2,520억 |\n| 입찰 | 4건 | ₩1,880억 |\n| 제안/검토 | 8건 | ₩4,200억 |\n\n## 연간 수주 현황\n- **누적 수주**: ₩1,124억 (국내) + $243M (해외)\n- **목표 달성률**: 국내 87% / 해외 112%',
       NULL, ${m1}, '2025-10-02'),

      ('한화에너지 익산 EPC 계약 체결',         '2025-12-20',
       '## 회의 요약\n- 전북 익산 40MW EPC 계약 최종 서명\n- 2025년 마지막 대형 수주 확정\n\n## 주요 내용\n- **계약금액**: ₩109억\n- **착공일**: 2026년 2월\n- **준공일**: 2026년 8월\n\n## 액션 아이템\n- [ ] 2026년 1분기 착공 준비 착수 (이필드, 1/5)\n- [ ] 자재 선발주 계획 수립 (강민준, 12/27)',
       '한화에너지', ${m2}, '2025-12-20')
    `);
    console.log('✅ 회의록 10건 삽입');

    // ──────────────────────────────────────────
    // 8. 원가 이력 확장 (2025년 전체)
    // ──────────────────────────────────────────
    await conn.query(`
      INSERT INTO cost_history (product_id, price, recorded_at) VALUES
      -- 폴리실리콘 (2025년 월별)
      (1, 8.12, '2025-01-01'), (1, 8.05, '2025-02-01'), (1, 7.98, '2025-03-01'),
      (1, 7.88, '2025-04-01'), (1, 7.75, '2025-05-01'), (1, 7.62, '2025-06-01'),
      (1, 7.55, '2025-07-01'), (1, 7.48, '2025-08-01'), (1, 7.52, '2025-09-01'),
      (1, 7.65, '2025-10-01'), (1, 7.74, '2025-11-01'), (1, 7.82, '2025-12-01'),
      -- 모듈 (2025년 월별)
      (4, 96.50, '2025-01-01'), (4, 95.80, '2025-02-01'), (4, 95.10, '2025-03-01'),
      (4, 94.30, '2025-04-01'), (4, 93.80, '2025-05-01'), (4, 93.20, '2025-06-01'),
      (4, 92.80, '2025-07-01'), (4, 92.50, '2025-08-01'), (4, 92.90, '2025-09-01'),
      (4, 93.40, '2025-10-01'), (4, 94.00, '2025-11-01'), (4, 94.50, '2025-12-01'),
      -- 리튬 배터리 셀 (2025년 월별)
      (6, 75.20, '2025-01-01'), (6, 74.50, '2025-02-01'), (6, 73.80, '2025-03-01'),
      (6, 72.90, '2025-04-01'), (6, 71.50, '2025-05-01'), (6, 70.20, '2025-06-01'),
      (6, 69.40, '2025-07-01'), (6, 68.80, '2025-08-01'), (6, 68.50, '2025-09-01'),
      (6, 68.40, '2025-10-01'), (6, 68.20, '2025-11-01'), (6, 68.00, '2025-12-01')
    `);
    console.log('✅ 원가 이력 확장');

    // ──────────────────────────────────────────
    // 9. 최종 통계 출력
    // ──────────────────────────────────────────
    const [[stats]] = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM team_members) AS team,
        (SELECT COUNT(*) FROM customers)    AS customers,
        (SELECT COUNT(*) FROM leads)        AS total_leads,
        (SELECT COUNT(*) FROM leads WHERE YEAR(created_at)=2025) AS leads_2025,
        (SELECT COUNT(*) FROM leads WHERE stage='won') AS won_leads,
        (SELECT ROUND(COALESCE(SUM(expected_amount),0)) FROM leads WHERE stage='won' AND region='국내' AND currency='KRW') AS won_krw,
        (SELECT COUNT(*) FROM activities)   AS activities,
        (SELECT COUNT(*) FROM projects)     AS projects,
        (SELECT COUNT(*) FROM calendar_events) AS cal_events,
        (SELECT COUNT(*) FROM meeting_minutes) AS meetings,
        (SELECT COUNT(*) FROM cost_history) AS cost_history
    `);

    console.log('\n📊 최종 DB 현황:');
    console.log(`  팀원:         ${stats.team}명`);
    console.log(`  고객사:       ${stats.customers}개사`);
    console.log(`  전체 리드:    ${stats.total_leads}건`);
    console.log(`  2025 리드:    ${stats.leads_2025}건`);
    console.log(`  수주 리드:    ${stats.won_leads}건`);
    console.log(`  수주 금액(KRW):${stats.won_krw}억원`);
    console.log(`  활동 이력:    ${stats.activities}건`);
    console.log(`  프로젝트:     ${stats.projects}건`);
    console.log(`  캘린더:       ${stats.cal_events}건`);
    console.log(`  회의록:       ${stats.meetings}건`);
    console.log(`  원가 이력:    ${stats.cost_history}건`);
    console.log('\n✅ 2025년 시드 데이터 삽입 완료!');

  } catch (err) {
    console.error('❌ 에러:', err.message);
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

function fmtTs(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const hh   = String(d.getHours()).padStart(2, '0');
  const mi   = String(d.getMinutes()).padStart(2, '0');
  const ss   = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

run().catch(err => { console.error(err); process.exit(1); });
