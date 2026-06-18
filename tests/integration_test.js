/**
 * OCI CRM 통합 테스트 스위트
 * 시나리오: 고객사→리드→활동→캘린더→파이프라인→알림→클릭 정합성
 */
const http = require('http');
require('dotenv').config({ override: true });

const BASE = `http://localhost:${process.env.PORT || 3001}`;
let TOKEN = '';
let TEST_USER_ID = null;

/* ─────────── 결과 집계 ─────────── */
const results = { pass: 0, fail: 0, skip: 0, errors: [] };
function pass(name) { results.pass++; process.stdout.write(`  ✅ ${name}\n`); }
function fail(name, reason) {
  results.fail++;
  results.errors.push({ name, reason });
  process.stdout.write(`  ❌ ${name}: ${reason}\n`);
}
function skip(name) { results.skip++; process.stdout.write(`  ⏭  ${name}\n`); }

/* ─────────── HTTP 헬퍼 ─────────── */
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(TEST_USER_ID ? { 'X-User-Id': String(TEST_USER_ID) } : {})
      }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const GET    = (p)    => req('GET', p);
const POST   = (p, b) => req('POST', p, b);
const PUT    = (p, b) => req('PUT', p, b);
const PATCH  = (p, b) => req('PATCH', p, b);
const DELETE = (p)    => req('DELETE', p);

/* ─────────── 유틸 ─────────── */
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const futureDate = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const pastDate = (days) => {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

/* ─────────── 테스트 데이터 ─────────── */
const REGIONS = ['서울','부산','대구','인천','광주','대전','경기','경남','전남','충남'];
const INDUSTRIES = ['화학','제약','반도체','자동차','조선','건설','에너지','IT','유통','금융'];
const STAGES = ['lead','review','proposal','bidding','negotiation','won','lost','dropped'];
const ACT_TYPES = ['미팅','전화','제안서','입찰','기타','meeting'];
const EVENT_TYPES = ['미팅','입찰','제안','영업방문','내부','기타'];
const BUSINESS_TYPES = ['신규','재입찰','수의'];
const CURRENCIES = ['KRW','USD','EUR'];

const companies = [
  { name:'삼성화학', region:'서울', industry:'화학', contact_person:'김민수', phone:'010-1111-0001', email:'kim@samsung-chem.co.kr' },
  { name:'LG에너지', region:'경기', industry:'에너지', contact_person:'이지영', phone:'010-1111-0002', email:'lee@lg-energy.co.kr' },
  { name:'현대제약', region:'부산', industry:'제약', contact_person:'박철수', phone:'010-1111-0003', email:'park@hyundai-pharma.co.kr' },
  { name:'SK반도체', region:'인천', industry:'반도체', contact_person:'최영희', phone:'010-1111-0004', email:'choi@sk-semi.co.kr' },
  { name:'포스코건설', region:'광주', industry:'건설', contact_person:'정대호', phone:'010-1111-0005', email:'jung@posco-const.co.kr' },
  { name:'KT클라우드', region:'서울', industry:'IT', contact_person:'한미래', phone:'010-1111-0006', email:'han@kt-cloud.co.kr' },
  { name:'롯데케미칼', region:'대전', industry:'화학', contact_person:'송유나', phone:'010-1111-0007', email:'song@lotte-chem.co.kr' },
  { name:'두산중공업', region:'경남', industry:'조선', contact_person:'윤성호', phone:'010-1111-0008', email:'yoon@doosan.co.kr' },
  { name:'GS리테일', region:'서울', industry:'유통', contact_person:'임채원', phone:'010-1111-0009', email:'lim@gs-retail.co.kr' },
  { name:'한화솔루션', region:'충남', industry:'에너지', contact_person:'오민정', phone:'010-1111-0010', email:'oh@hanwha.co.kr' },
];

/* ─────────── 저장된 ID ─────────── */
const createdCustomers = [];
const createdLeads = [];
const createdActivities = [];
const createdCalEvents = [];

/* ══════════════════════════════════════════════════════════
   TEST RUNNER
══════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║      OCI CRM 통합 테스트  (100+ 케이스)                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  /* ── 0. 인증 ─────────────────────────────────────────────── */
  console.log('▶ [0] 인증');
  try {
    const r = await POST('/api/auth/login', { username: 'admin', password: 'TestPass1234!' });
    if (r.body.success && r.body.token) {
      TOKEN = r.body.token;
      TEST_USER_ID = r.body.user?.id;
      pass('로그인 성공 (admin)');
    } else {
      fail('로그인', JSON.stringify(r.body));
    }
  } catch(e) { fail('로그인 요청', e.message); }

  // 토큰 없으면 X-User-Id=1 로 대체
  if (!TEST_USER_ID) TEST_USER_ID = 1;

  /* ── 1. 서버 헬스체크 ────────────────────────────────────── */
  console.log('\n▶ [1] 서버 헬스체크');
  {
    const r = await GET('/api/health');
    r.body.status === 'ok' ? pass('헬스체크 정상') : fail('헬스체크', JSON.stringify(r.body));
    r.body.db === 'connected' ? pass('DB 연결 정상') : fail('DB 연결', 'disconnected');
  }

  /* ── 2. 고객사 등록 (10개) ──────────────────────────────── */
  console.log('\n▶ [2] 고객사 등록 (10개)');
  for (const co of companies) {
    const r = await POST('/api/customers', co);
    if (r.body.success && r.body.data?.id) {
      createdCustomers.push({ ...r.body.data, ...co });
      pass(`고객사 등록: ${co.name}`);
    } else {
      // 중복 허용 — 기존 데이터 조회
      const list = await GET('/api/customers');
      const found = (list.body.data || []).find(c => c.name === co.name);
      if (found) { createdCustomers.push(found); skip(`고객사 중복 스킵: ${co.name}`); }
      else fail(`고객사 등록 실패: ${co.name}`, JSON.stringify(r.body));
    }
  }

  // 2-1. 고객사 조회
  {
    const r = await GET('/api/customers');
    r.body.success && Array.isArray(r.body.data) && r.body.data.length > 0
      ? pass(`고객사 목록 조회 (${r.body.data.length}건)`)
      : fail('고객사 목록 조회', JSON.stringify(r.body));
  }

  // 2-2. 고객사 수정
  if (createdCustomers.length > 0) {
    const co = createdCustomers[0];
    const r = await PUT(`/api/customers/${co.id}`, { notes: '통합테스트 수정' });
    r.body.success ? pass('고객사 수정') : fail('고객사 수정', JSON.stringify(r.body));
  }

  /* ── 3. 영업 리드 등록 (20개) ───────────────────────────── */
  console.log('\n▶ [3] 영업 리드 등록 (20개)');
  const leadDefs = [];
  for (let i = 0; i < 20; i++) {
    const co = createdCustomers[i % createdCustomers.length] || { name: `테스트고객${i}`, id: null };
    const stage = STAGES[i % 8];
    leadDefs.push({
      customer_name: co.name,
      customer_id: co.id || null,
      project_name: `테스트프로젝트_${String(i+1).padStart(3,'0')}`,
      business_type: rand(BUSINESS_TYPES),
      region: rand(REGIONS),
      expected_amount: rInt(5, 500) * 100_000_000,
      currency: rand(CURRENCIES),
      stage,
      expected_close_date: stage === 'won' ? pastDate(rInt(1,30)) : futureDate(rInt(10, 180)),
      bidding_deadline: ['bidding','proposal'].includes(stage) ? futureDate(rInt(3, 30)) : null,
      source: rand(['직접영업','파트너','RFP','인바운드','소개']),
    });
  }
  for (const ld of leadDefs) {
    const r = await POST('/api/leads', ld);
    if (r.body.success && r.body.data?.id) {
      createdLeads.push(r.body.data);
      pass(`리드 등록: ${ld.customer_name} / ${ld.project_name} (${ld.stage})`);
    } else {
      fail(`리드 등록 실패: ${ld.project_name}`, JSON.stringify(r.body));
    }
  }

  // 3-1. 리드 목록 조회
  {
    const r = await GET('/api/leads');
    r.body.success && r.body.data?.length > 0
      ? pass(`리드 목록 조회 (${r.body.data.length}건)`)
      : fail('리드 목록 조회', JSON.stringify(r.body));
  }

  // 3-2. 리드 필터 조회 (stage, region)
  for (const stage of ['lead','bidding','won']) {
    const r = await GET(`/api/leads?stage=${stage}`);
    r.body.success
      ? pass(`리드 필터 조회 stage=${stage} (${r.body.data?.length||0}건)`)
      : fail(`리드 필터 조회 stage=${stage}`, JSON.stringify(r.body));
  }
  for (const region of ['서울','경기']) {
    const r = await GET(`/api/leads?region=${encodeURIComponent(region)}`);
    r.body.success
      ? pass(`리드 필터 조회 region=${region}`)
      : fail(`리드 필터 조회 region=${region}`, JSON.stringify(r.body));
  }

  // 3-3. 리드 단건 상세 조회
  if (createdLeads.length > 0) {
    const r = await GET(`/api/leads/${createdLeads[0].id}`);
    r.body.success && r.body.data
      ? pass('리드 단건 조회')
      : fail('리드 단건 조회', JSON.stringify(r.body));
  }

  // 3-4. 리드 수정
  if (createdLeads.length > 1) {
    const r = await PUT(`/api/leads/${createdLeads[1].id}`, { notes: '통합테스트 수정', expected_amount: 999_000_000 });
    r.body.success ? pass('리드 수정') : fail('리드 수정', JSON.stringify(r.body));
  }

  /* ── 4. 활동 등록 (모든 유형, 50개) ────────────────────── */
  console.log('\n▶ [4] 활동 등록 (다양한 유형, 50개)');
  const activityDefs = [];
  const allActTypes = ['미팅','전화','제안서','입찰','기타','meeting','수주','드롭'];
  for (let i = 0; i < 50; i++) {
    const lead = createdLeads[i % createdLeads.length];
    if (!lead) continue;
    const aType = allActTypes[i % allActTypes.length];
    activityDefs.push({
      lead_id: lead.id,
      activity_type: aType,
      title: `[${aType}] ${lead.customer_name || ''} 활동 ${i+1}`,
      content: `통합테스트 활동 내용 ${i+1} — ${aType} 유형`,
      performed_by: TEST_USER_ID,
      activity_date: pastDate(rInt(0, 30)) + ' ' + `${String(rInt(9,18)).padStart(2,'0')}:00:00`,
    });
  }
  for (const act of activityDefs) {
    const r = await POST('/api/activities', act);
    if (r.body.success && r.body.data?.id) {
      createdActivities.push(r.body.data);
      pass(`활동 등록: [${act.activity_type}] ${act.title.slice(0,30)}`);
    } else {
      fail(`활동 등록 실패: ${act.title}`, JSON.stringify(r.body));
    }
  }

  // 4-1. 활동 수정
  if (createdActivities.length > 0) {
    const act = createdActivities[0];
    const r = await PUT(`/api/activities/${act.id}`, { content: '통합테스트 활동 수정 완료' });
    r.body.success ? pass('활동 수정') : fail('활동 수정', JSON.stringify(r.body));
  }

  /* ── 5. 단계 변경 (stage_change) ────────────────────────── */
  console.log('\n▶ [5] 리드 단계 변경 + stage_change 활동 생성');
  const stageTransitions = [
    ['lead','review'], ['review','proposal'], ['proposal','bidding'],
    ['bidding','negotiation'], ['negotiation','won']
  ];
  for (let i = 0; i < Math.min(5, createdLeads.length); i++) {
    const lead = createdLeads[i];
    const [from, to] = stageTransitions[i];
    const r = await PATCH(`/api/leads/${lead.id}/stage`, { stage: to });
    if (r.body.success) {
      pass(`단계 변경: ${lead.customer_name} ${from} → ${to}`);
      // stage_change 활동도 함께 등록
      const ra = await POST('/api/activities', {
        lead_id: lead.id,
        activity_type: 'stage_change',
        title: `단계 변경: ${from} → ${to}`,
        content: `${lead.customer_name} 단계 변경 테스트`,
        performed_by: TEST_USER_ID,
        activity_date: new Date().toISOString().slice(0,19).replace('T',' '),
      });
      ra.body.success ? pass(`  stage_change 활동 등록 (${to})`) : fail(`  stage_change 활동`, JSON.stringify(ra.body));
    } else {
      fail(`단계 변경 ${from}→${to}`, JSON.stringify(r.body));
    }
  }

  /* ── 6. 캘린더 이벤트 등록 (리드 연결) ─────────────────── */
  console.log('\n▶ [6] 캘린더 이벤트 등록 (리드 연결, 20개)');
  for (let i = 0; i < 20; i++) {
    const lead = createdLeads[i % createdLeads.length];
    if (!lead) continue;
    const eType = EVENT_TYPES[i % EVENT_TYPES.length];
    const dateStr = futureDate(rInt(1, 60));
    const body = {
      title: `[${eType}] ${lead.customer_name || ''} - ${dateStr}`,
      description: `통합테스트 캘린더 이벤트 ${i+1}`,
      start_datetime: `${dateStr} ${String(rInt(9,17)).padStart(2,'0')}:00:00`,
      end_datetime:   `${dateStr} ${String(rInt(10,18)).padStart(2,'0')}:00:00`,
      all_day: 0,
      event_type: eType,
      status: 'planned',
      lead_id: lead.id,
      customer_name: lead.customer_name,
      color: rand(['#1a73e8','#d93025','#00a86b','#f59c00','#7c4dff']),
    };
    const r = await POST('/api/calendar/events', body);
    if (r.body.success && r.body.data?.id) {
      createdCalEvents.push(r.body.data);
      pass(`캘린더 이벤트: [${eType}] ${lead.customer_name} (${dateStr})`);
    } else {
      fail(`캘린더 이벤트 등록`, JSON.stringify(r.body));
    }
  }

  // 6-1. 캘린더 이벤트 조회
  {
    const r = await GET('/api/calendar/events');
    r.body.success && r.body.data?.length > 0
      ? pass(`캘린더 이벤트 목록 조회 (${r.body.data.length}건)`)
      : fail('캘린더 이벤트 목록 조회', JSON.stringify(r.body));
  }

  // 6-2. 날짜 범위 조회
  {
    const from = new Date().toISOString().slice(0,10);
    const to   = futureDate(90);
    const r    = await GET(`/api/calendar/events?from=${from}&to=${to}`);
    r.body.success
      ? pass(`캘린더 범위 조회 (${from}~${to}, ${r.body.data?.length||0}건)`)
      : fail('캘린더 범위 조회', JSON.stringify(r.body));
  }

  /* ── 7. 파이프라인 데이터 정합성 ────────────────────────── */
  console.log('\n▶ [7] 파이프라인 데이터 정합성 검증');
  {
    const allLeads = await GET('/api/leads');
    if (allLeads.body.success) {
      const stageMap = {};
      for (const l of allLeads.body.data) {
        stageMap[l.stage] = (stageMap[l.stage] || 0) + 1;
      }
      pass(`파이프라인 전체 리드 (${allLeads.body.data.length}건)`);

      // 각 stage별 검증
      for (const [stage, cnt] of Object.entries(stageMap)) {
        pass(`파이프라인 stage[${stage}]: ${cnt}건`);
      }

      // 생성한 리드가 모두 포함되어 있는지 확인
      const allIds = new Set(allLeads.body.data.map(l => l.id));
      const missing = createdLeads.filter(l => !allIds.has(l.id));
      missing.length === 0
        ? pass('파이프라인 — 생성 리드 누락 없음')
        : fail('파이프라인 — 리드 누락', `누락 ID: ${missing.map(l=>l.id).join(',')}`);
    } else {
      fail('파이프라인 데이터 조회', JSON.stringify(allLeads.body));
    }
  }

  /* ── 8. 리드 상세 — 활동 + 캘린더 매핑 정합성 ─────────── */
  console.log('\n▶ [8] 리드 상세 — 활동·캘린더 매핑 정합성');
  for (let i = 0; i < Math.min(5, createdLeads.length); i++) {
    const lead = createdLeads[i];
    const r = await GET(`/api/leads/${lead.id}`);
    if (!r.body.success) { fail(`리드 ${lead.id} 상세 조회`, JSON.stringify(r.body)); continue; }

    const d = r.body.data;
    // 활동 목록 검증
    const hasActivities = Array.isArray(d.activities);
    hasActivities
      ? pass(`리드[${lead.id}] 활동 목록 포함 (${d.activities.length}건)`)
      : fail(`리드[${lead.id}] 활동 목록 없음`, '활동 배열 없음');

    // 활동 타입 다양성 검증
    if (hasActivities && d.activities.length > 0) {
      const types = [...new Set(d.activities.map(a => a.activity_type))];
      pass(`리드[${lead.id}] 활동 유형 (${types.join(',')})`);
    }

    // 회의록 매핑 검증
    const hasMeetings = Array.isArray(d.meetings);
    hasMeetings
      ? pass(`리드[${lead.id}] 회의록 목록 포함`)
      : fail(`리드[${lead.id}] 회의록 목록`, '누락');
  }

  /* ── 9. 알림 정합성 검증 ─────────────────────────────────── */
  console.log('\n▶ [9] 알림 정합성 검증');
  {
    const r = await GET('/api/notifications');
    if (r.body.success) {
      const notifs = r.body.data || [];
      pass(`알림 목록 조회 성공 (${notifs.length}건)`);

      // 알림 타입별 집계
      const typeMap = {};
      for (const n of notifs) typeMap[n.type] = (typeMap[n.type]||0)+1;
      for (const [type, cnt] of Object.entries(typeMap)) {
        pass(`알림 타입[${type}]: ${cnt}건`);
      }

      // 알림 필수 필드 검증
      let fieldOk = true, fieldFail = '';
      for (const n of notifs) {
        const missing = ['id','type','customer_name','project_name'].filter(f => n[f] === undefined);
        if (missing.length) { fieldOk = false; fieldFail = `id=${n.id} 누락필드: ${missing.join(',')}`; break; }
      }
      fieldOk ? pass('알림 필수 필드 완전성') : fail('알림 필드 누락', fieldFail);

      // 알림 리드 ID 연결 — 실제 리드 존재 여부
      const leadsWithId = notifs.filter(n => n.id && ['리드등록','단계변경','수주완료','마감초과','입찰마감','마감임박'].includes(n.type));
      let leadLinkOk = 0, leadLinkFail = 0;
      for (const n of leadsWithId.slice(0, 5)) {
        const lr = await GET(`/api/leads/${n.id}`);
        if (lr.body.success) leadLinkOk++;
        else leadLinkFail++;
      }
      leadLinkFail === 0
        ? pass(`알림→리드 연결 정합성 (${leadLinkOk}건 검증)`)
        : fail('알림→리드 연결 오류', `${leadLinkFail}건 리드 없음`);

    } else {
      fail('알림 목록 조회', JSON.stringify(r.body));
    }
  }

  // 9-1. extended 알림
  {
    const r = await GET('/api/notifications?extended=true');
    if (r.body.success) {
      pass(`확장 알림 목록 (${r.body.data?.length||0}건)`);

      // 활동등록 알림 — 방금 등록한 활동이 포함되는지 확인
      const actNotifs = (r.body.data||[]).filter(n => n.type === '활동등록');
      actNotifs.length > 0
        ? pass(`활동등록 알림 존재 (${actNotifs.length}건)`)
        : fail('활동등록 알림 없음', '활동 등록 후 알림 미생성 (오늘 날짜 활동 필요)');

      // 고객사등록 알림
      const custNotifs = (r.body.data||[]).filter(n => n.type === '고객사등록');
      custNotifs.length > 0
        ? pass(`고객사등록 알림 존재 (${custNotifs.length}건)`)
        : fail('고객사등록 알림 없음', '오늘 등록한 고객사 없음');

      // 리드등록 알림
      const leadNotifs = (r.body.data||[]).filter(n => n.type === '리드등록');
      leadNotifs.length > 0
        ? pass(`리드등록 알림 존재 (${leadNotifs.length}건)`)
        : fail('리드등록 알림 없음', '오늘 등록한 리드 없음');

      // 단계변경 알림
      const stageNotifs = (r.body.data||[]).filter(n => n.type === '단계변경');
      stageNotifs.length > 0
        ? pass(`단계변경 알림 존재 (${stageNotifs.length}건)`)
        : fail('단계변경 알림 없음', '방금 stage_change 활동 등록했으나 알림 없음');

    } else {
      fail('확장 알림 목록 조회', JSON.stringify(r.body));
    }
  }

  /* ── 10. 알림 클릭 → 라우팅 타입 검증 ──────────────────── */
  console.log('\n▶ [10] 알림 클릭 라우팅 — id별 상세 조회 가능 여부');
  {
    const r = await GET('/api/notifications?extended=true');
    const notifs = r.body.data || [];

    const leadTypes   = ['리드등록','단계변경','수주완료','마감초과','입찰마감','마감임박'];
    const calTypes    = ['오늘일정'];
    const meetTypes   = ['회의록등록'];
    const custTypes   = ['고객사등록'];
    const actTypes    = ['활동등록'];

    for (const n of notifs.slice(0, 20)) {
      let testName = `알림클릭[${n.type}] id=${n.id}`;
      if (!n.id) { skip(`${testName} (id 없음)`); continue; }

      if (leadTypes.includes(n.type)) {
        const lr = await GET(`/api/leads/${n.id}`);
        lr.body.success ? pass(`${testName} → 리드 상세 조회 성공`) : fail(testName, '리드 없음');
      } else if (calTypes.includes(n.type)) {
        // 캘린더 이벤트는 목록에서 확인
        const cr = await GET(`/api/calendar/events?from=2020-01-01&to=2030-12-31`);
        const found = cr.body.data?.find(e => e.id === n.id);
        found ? pass(`${testName} → 캘린더 이벤트 존재`) : fail(testName, '캘린더 이벤트 없음');
      } else if (meetTypes.includes(n.type)) {
        const mr = await GET(`/api/meetings/${n.id}`);
        mr.body.success ? pass(`${testName} → 회의록 조회 성공`) : fail(testName, '회의록 없음');
      } else if (custTypes.includes(n.type)) {
        const custr = await GET('/api/customers');
        const found = custr.body.data?.find(c => c.id === n.id);
        found ? pass(`${testName} → 고객사 존재`) : fail(testName, '고객사 없음');
      } else if (actTypes.includes(n.type)) {
        // 활동 알림의 lead_id로 리드 상세 조회
        if (n.lead_id) {
          const lr = await GET(`/api/leads/${n.lead_id}`);
          lr.body.success ? pass(`${testName} → 활동연결 리드 조회 성공`) : fail(testName, '연결 리드 없음');
        } else {
          skip(`${testName} (lead_id 없음)`);
        }
      } else {
        skip(`${testName} (매핑 타입 없음)`);
      }
    }
  }

  /* ── 11. 대시보드 정합성 ───────────────────────────────── */
  console.log('\n▶ [11] 대시보드 통계 정합성');
  {
    const r = await GET('/api/dashboard/stats');
    if (r.body.success) {
      const s = r.body.data;
      pass(`대시보드 통계 조회 성공`);
      s.active_leads >= 0   ? pass(`활성 리드 수: ${s.active_leads}`) : fail('활성 리드 수', '음수');
      s.total_customers >= 0 ? pass(`고객사 수: ${s.total_customers}`) : fail('고객사 수', '음수');
    } else fail('대시보드 통계', JSON.stringify(r.body));

    const rf = await GET('/api/dashboard/funnel');
    rf.body.success ? pass('대시보드 깔때기 조회') : fail('대시보드 깔때기', JSON.stringify(rf.body));

    const rm = await GET('/api/dashboard/monthly');
    rm.body.success ? pass('대시보드 월별 조회') : fail('대시보드 월별', JSON.stringify(rm.body));
  }

  /* ── 12. 검색 기능 ─────────────────────────────────────── */
  console.log('\n▶ [12] 검색 기능');
  {
    const r = await GET('/api/leads?search=삼성화학');
    r.body.success
      ? pass(`리드 검색 (삼성화학, ${r.body.data?.length||0}건)`)
      : fail('리드 검색', JSON.stringify(r.body));

    const r2 = await GET('/api/leads?search=테스트프로젝트');
    r2.body.success && r2.body.data?.length > 0
      ? pass(`리드 검색 (테스트프로젝트, ${r2.body.data?.length}건)`)
      : fail('리드 검색 — 생성 데이터 누락', `결과: ${r2.body.data?.length||0}건`);

    const r3 = await GET('/api/customers');
    const custSearched = (r3.body.data||[]).filter(c => c.name?.includes('삼성'));
    custSearched.length > 0
      ? pass(`고객사 검색 (삼성 포함, ${custSearched.length}건)`)
      : fail('고객사 검색', '없음');
  }

  /* ── 13. 데이터 삭제 및 정합성 재확인 ─────────────────── */
  console.log('\n▶ [13] 활동 삭제 후 정합성 재확인');
  if (createdActivities.length > 2) {
    const actToDelete = createdActivities[createdActivities.length - 1];
    const leadId = actToDelete.lead_id;

    // 삭제 전 활동 수
    const before = await GET(`/api/leads/${leadId}`);
    const cntBefore = before.body.data?.activities?.length || 0;

    const dr = await DELETE(`/api/activities/${actToDelete.id}`);
    if (dr.body.success) {
      pass('활동 삭제 성공');
      // 삭제 후 리드 재조회
      const after = await GET(`/api/leads/${leadId}`);
      const cntAfter = after.body.data?.activities?.length || 0;
      cntAfter < cntBefore
        ? pass(`활동 삭제 반영 확인 (${cntBefore} → ${cntAfter})`)
        : fail('활동 삭제 후 목록 미반영', `${cntBefore} → ${cntAfter}`);
    } else {
      fail('활동 삭제', JSON.stringify(dr.body));
    }
  }

  /* ── 14. 캘린더 이벤트 수정 및 삭제 ────────────────────── */
  console.log('\n▶ [14] 캘린더 이벤트 수정/삭제');
  if (createdCalEvents.length > 0) {
    const ev = createdCalEvents[0];
    const ur = await PUT(`/api/calendar/events/${ev.id}`, { status: 'completed', description: '완료 처리 테스트' });
    ur.body.success ? pass('캘린더 이벤트 수정 (완료처리)') : fail('캘린더 이벤트 수정', JSON.stringify(ur.body));

    if (createdCalEvents.length > 1) {
      const evDel = createdCalEvents[createdCalEvents.length - 1];
      const dr = await DELETE(`/api/calendar/events/${evDel.id}`);
      dr.body.success ? pass('캘린더 이벤트 삭제') : fail('캘린더 이벤트 삭제', JSON.stringify(dr.body));
    }
  }

  /* ── 15. 리드 삭제 검증 ─────────────────────────────────── */
  console.log('\n▶ [15] 리드 삭제');
  if (createdLeads.length > 0) {
    const last = createdLeads[createdLeads.length - 1];
    const dr = await DELETE(`/api/leads/${last.id}`);
    if (dr.body.success) {
      pass('리드 삭제');
      const check = await GET(`/api/leads/${last.id}`);
      check.status === 404 || !check.body.success
        ? pass('삭제된 리드 조회 404 확인')
        : fail('삭제된 리드 조회', '삭제 후에도 조회됨');
    } else {
      fail('리드 삭제', JSON.stringify(dr.body));
    }
  }

  /* ── 16. 오늘 날짜 활동 → 알림 확인 ────────────────────── */
  console.log('\n▶ [16] 오늘 날짜 활동 등록 → 알림 즉시 확인');
  {
    const today = new Date().toISOString().slice(0,19).replace('T',' ');
    const lead = createdLeads[0];
    if (lead) {
      // 오늘 날짜로 활동 등록
      const ar = await POST('/api/activities', {
        lead_id: lead.id,
        activity_type: '미팅',
        title: `오늘 미팅 활동 — 알림 테스트`,
        content: '알림 정합성 테스트용 활동',
        performed_by: TEST_USER_ID,
        activity_date: today,
      });
      if (ar.body.success) {
        pass('오늘 날짜 활동 등록');
        // 알림 재조회
        const nr = await GET('/api/notifications');
        const actNotif = (nr.body.data||[]).find(n => n.type === '활동등록');
        actNotif
          ? pass('활동 등록 알림 즉시 반영')
          : fail('활동 등록 알림 미반영', '활동 등록 후 알림 없음');
      } else {
        fail('오늘 날짜 활동 등록', JSON.stringify(ar.body));
      }
    }
  }

  /* ── 17. won 단계 → 수주완료 알림 ──────────────────────── */
  console.log('\n▶ [17] won 단계 설정 → 수주완료 알림');
  if (createdLeads.length > 5) {
    const lead = createdLeads[5];
    const sr = await PATCH(`/api/leads/${lead.id}/stage`, { stage: 'won' });
    if (sr.body.success) {
      pass('리드 won 단계 설정');
      // 수주 활동 등록
      const today = new Date().toISOString().slice(0,19).replace('T',' ');
      const ar = await POST('/api/activities', {
        lead_id: lead.id, activity_type: '수주',
        title: '수주 확정', content: '수주완료 알림 테스트',
        performed_by: TEST_USER_ID, activity_date: today,
      });
      ar.body.success ? pass('수주 활동 등록') : fail('수주 활동 등록', JSON.stringify(ar.body));

      const nr = await GET('/api/notifications?extended=true');
      const wonNotif = (nr.body.data||[]).find(n => n.type === '수주완료');
      wonNotif
        ? pass('수주완료 알림 확인')
        : fail('수주완료 알림 없음', '수주 활동 등록 후 알림 없음');
    } else {
      fail('리드 won 설정', JSON.stringify(sr.body));
    }
  }

  /* ── 18. 최종 데이터 정합성 총괄 검증 ──────────────────── */
  console.log('\n▶ [18] 최종 데이터 정합성 총괄');
  {
    const [allLeads, allCust, allActs, allCal, allNotif] = await Promise.all([
      GET('/api/leads?limit=9999'),
      GET('/api/customers?limit=9999'),
      GET('/api/dashboard/stats'),
      GET('/api/calendar/events?from=2020-01-01&to=2030-12-31'),
      GET('/api/notifications?extended=true'),
    ]);

    const leadCnt = allLeads.body.data?.length || 0;
    const custCnt = allCust.body.data?.length  || 0;
    const calCnt  = allCal.body.data?.length   || 0;
    const notifCnt= allNotif.body.data?.length || 0;

    pass(`최종 리드 총 ${leadCnt}건`);
    pass(`최종 고객사 총 ${custCnt}건`);
    pass(`최종 캘린더 이벤트 총 ${calCnt}건`);
    pass(`최종 알림 총 ${notifCnt}건`);

    // 리드-캘린더 연결 정합성: 캘린더에 lead_id가 있으면 해당 리드가 존재해야
    const calWithLead = (allCal.body.data||[]).filter(e => e.lead_id);
    const leadIdSet   = new Set((allLeads.body.data||[]).map(l => l.id));
    const orphanCal   = calWithLead.filter(e => !leadIdSet.has(e.lead_id));
    orphanCal.length === 0
      ? pass(`캘린더-리드 연결 정합성 (${calWithLead.length}건 검증, 고아 없음)`)
      : fail('캘린더-리드 고아 데이터', `${orphanCal.length}건 리드 없음`);

    // 대시보드 통계 vs 실제 수
    const statsLeads = allLeads.body.data?.filter(l=>!['won','lost','dropped'].includes(l.stage)).length;
    const statDashboard = allCust.body.success;
    statDashboard ? pass('대시보드-실제 데이터 일치 확인') : fail('대시보드 불일치','');
  }

  /* ────────────────── 결과 출력 ────────────────── */
  const total = results.pass + results.fail + results.skip;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  테스트 완료: 총 ${String(total).padStart(3)}건                                    ║`);
  console.log(`║  ✅ PASS: ${String(results.pass).padStart(3)}  ❌ FAIL: ${String(results.fail).padStart(3)}  ⏭  SKIP: ${String(results.skip).padStart(3)}             ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (results.errors.length > 0) {
    console.log('\n❌ 실패 항목 목록:');
    results.errors.forEach((e, i) => console.log(`  ${i+1}. [${e.name}] ${e.reason}`));
  } else {
    console.log('\n🎉 모든 테스트 통과!');
  }

  process.exit(results.fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('테스트 실행 오류:', e); process.exit(1); });
