/* 고객지원(A/S) 샘플 데이터 DB 시드 — support_tickets (+ comments/history) 직접 주입
 *
 * 고객지원 모듈을 실제 화면(목록/칸반/상세/360°)에서 테스트하려고 32건을 개발 DB 에 주입한다.
 * 실제 customers(1~12) · 그 고객의 leads · team_members(CS) 에 연결되어
 * 고객사 모달 🎫 탭(LinkedSupport) 과 목록/칸반/상세가 모두 채워진다.
 *
 * ⚠️ 개발 DB 전용 — 운영 DB 에 실행 금지 (운영은 서버에서 별도 판단).
 * ⚠️ .env 의 DB 접속 정보를 사용 (src/db 경유).
 *
 * 실행(주입):  node mock-data/seed-support.js
 * 실행(정리):  node mock-data/seed-support.js --clean
 *
 * 식별: 모든 행 description 끝에 '[샘플데이터]' 태그 → --clean 으로 일괄 삭제.
 */
'use strict';
require('dotenv').config();
const pool = require('../src/db');

const TAG = '[샘플데이터]';

// ── 콘텐츠 템플릿 (유형별 — IT/CRM 사후지원 맥락) ──────────────
const TITLES = {
  issue: ['리포트 합계가 실제와 다르게 표시됩니다', '대시보드 위젯 일부가 보이지 않습니다', '엑셀 내보내기 시 일부 행이 누락됩니다', '검색 결과 정렬이 이상합니다', '알림이 중복으로 발송됩니다', '목록 필터가 초기화됩니다'],
  fault: ['로그인 후 화면이 멈춥니다(스피너 지속)', '특정 시간대 페이지 500 오류', 'PDF 출력 시 한글이 깨집니다', '파일 업로드가 타임아웃됩니다', '캘린더 동기화가 중단되었습니다', '모바일에서 앱이 강제 종료됩니다'],
  complaint: ['응답이 너무 느려 업무에 지장이 있습니다', '담당자 연락이 지연되어 불편합니다', '화면이 직관적이지 않습니다', '잦은 점검 공지로 사용이 어렵습니다'],
  inquiry: ['신규 사용자 계정 등록 방법 문의', '사용자 권한(역할) 변경 요청', '비밀번호 초기화 요청', '데이터 일괄 등록 양식 문의', '모바일 앱 설치 방법 문의', '메뉴 구성 변경 가능 여부'],
  tech: ['API 연동 토큰 발급 문의', '외부 시스템 SSO 연동 가능 여부', '데이터 마이그레이션 절차 문의', '백업/복구 정책 문의', '웹훅 수신 설정 방법', '온프레미스 설치 요구사항'],
};
const DESC = {
  issue: '특정 조건에서 데이터가 화면과 다르게 보입니다. 재현 화면을 첨부드립니다. 확인 부탁드립니다.',
  fault: '업무 중 갑자기 발생했습니다. 재시도해도 동일하며 다수 사용자가 동일 증상을 겪고 있습니다. 긴급 확인 요청드립니다.',
  complaint: '최근 들어 반복적으로 발생하여 현업 불만이 누적되고 있습니다. 개선 일정을 알려주세요.',
  inquiry: '운영 중 절차가 궁금하여 문의드립니다. 가이드 문서가 있으면 함께 전달 부탁드립니다.',
  tech: '연동/구성 관련 기술 검토가 필요합니다. 담당 엔지니어 회신 부탁드립니다.',
};
const RESOLUTION = {
  resolved: ['원인 확인 후 핫픽스 배포 완료. 재현되지 않음을 고객과 함께 확인했습니다.', '설정값 보정으로 정상화. 재발 방지 가이드 전달 완료.', '서버 캐시 초기화 후 정상 동작 확인. 모니터링 정상.', '권한/계정 처리 완료. 고객 확인 회신 받음.'],
  dropped: ['중복 접수 건으로 종료(원 건에서 처리).', '고객 요청으로 보류 후 진행 불필요 판단되어 드롭.'],
};
const REQ_NAMES = ['김민수', '이영희', '박철수', '정수진', '최동현', '한지민', '오세훈', '윤서연', '장태웅', '서지우', '문가영', '배준호'];

const TYPES = ['issue', 'fault', 'complaint', 'inquiry', 'tech'];
const CHANNELS = ['phone', 'email', 'visit', 'portal', 'etc'];

// 상태 분포(32건) — 신규일수록 미처리, 오래될수록 종결 (현실적)
const STATUS_PLAN = [
  ...Array(5).fill('received'),
  ...Array(3).fill('registered'),
  ...Array(4).fill('assigned'),
  ...Array(7).fill('in_progress'),
  ...Array(3).fill('on_hold'),
  ...Array(8).fill('resolved'),
  ...Array(2).fill('dropped'),
];

const BASE = new Date('2026-06-15T10:00:00');
function fmt(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
function dt(daysAgo, hour = 10, min = 0) {
  const d = new Date(BASE);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return fmt(d);
}
function priorityFor(i, type) {
  if (type === 'fault' && i % 2 === 0) return 'urgent';
  if (i % 13 === 0) return 'urgent';
  if (i % 4 === 1) return 'high';
  if (i % 9 === 4) return 'low';
  return 'normal';
}

async function clean() {
  const [tk] = await pool.query('SELECT id FROM support_tickets WHERE description LIKE ?', [`%${TAG}%`]);
  const ids = tk.map(r => r.id);
  if (!ids.length) {
    console.log('🧹 정리할 샘플 티켓이 없습니다.');
    return;
  }
  await pool.query('DELETE FROM support_comments WHERE ticket_id IN (?)', [ids]);
  await pool.query('DELETE FROM support_history WHERE ticket_id IN (?)', [ids]);
  await pool.query('DELETE FROM support_files WHERE ticket_id IN (?)', [ids]);
  const [del] = await pool.query('DELETE FROM support_tickets WHERE id IN (?)', [ids]);
  console.log(`🧹 정리 완료 — 샘플 티켓 ${del.affectedRows}건 (+연결 댓글/이력/첨부) 삭제`);
}

async function seed() {
  // 실제 FK 데이터 조회 — id 범위에 의존하지 않게 앞쪽 12개 고객사 선택 (운영 DB 호환)
  const [custRows] = await pool.query('SELECT id FROM customers ORDER BY id LIMIT 12');
  const custIds = custRows.map(r => r.id);
  if (!custIds.length) throw new Error('customers 가 없습니다 — 고객사 데이터 먼저 필요');

  const [leadRows] = await pool.query('SELECT id, customer_id FROM leads WHERE customer_id IN (?)', [custIds]);
  const leadsByCust = {};
  leadRows.forEach(l => {
    (leadsByCust[l.customer_id] = leadsByCust[l.customer_id] || []).push(l.id);
  });

  const AGENTS = [4, 8, 29, 30]; // 김CS, 서CS, 강민준, 오지현 (없으면 NULL 로 떨어져도 무방)
  const [tmRows] = await pool.query('SELECT id FROM team_members WHERE id IN (?)', [AGENTS]);
  const agents = tmRows.map(r => r.id);
  const agent = i => (agents.length ? agents[i % agents.length] : null);

  // ticket_no 시퀀스 (기존 MAX 다음부터)
  const [[mx]] = await pool.query(
    "SELECT ticket_no FROM support_tickets WHERE ticket_no LIKE 'CS-2026-%' ORDER BY ticket_no DESC LIMIT 1"
  );
  let seq = mx ? parseInt(String(mx.ticket_no).split('-')[2], 10) : 0;

  let nT = 0;
  let nC = 0;
  let nH = 0;
  for (let i = 0; i < STATUS_PLAN.length; i++) {
    const status = STATUS_PLAN[i];
    const type = TYPES[i % TYPES.length];
    const titleArr = TITLES[type];
    const title = titleArr[Math.floor(i / TYPES.length) % titleArr.length];
    const priority = priorityFor(i, type);
    const channel = CHANNELS[i % CHANNELS.length];
    const customerId = custIds[i % custIds.length];
    // 40% 는 해당 고객의 리드에도 연결
    const custLeads = leadsByCust[customerId] || [];
    const leadId = i % 5 < 2 && custLeads.length ? custLeads[i % custLeads.length] : null;
    const reqName = REQ_NAMES[i % REQ_NAMES.length];
    const reqPhone = `010-${String(1000 + ((i * 37) % 9000))}-${String(1000 + ((i * 53) % 9000))}`;
    const reqEmail = `user${i + 1}@example.com`;

    const open = !['resolved', 'dropped'].includes(status);
    const newish = ['received', 'registered'].includes(status);
    const assignedTo = newish ? null : agent(i);
    const createdBy = agent(i + 1);

    const daysAgo = Math.floor(i * 1.7) + (i % 3);
    const createdAt = dt(daysAgo, 9 + (i % 8), (i * 7) % 60);
    const firstResp = newish ? null : dt(Math.max(daysAgo - 1, 0), 11 + (i % 6), 15);
    const resolvedAt = status === 'resolved' ? dt(Math.max(daysAgo - 3, 0), 16, 30) : null;
    const closedAt =
      status === 'resolved' ? dt(Math.max(daysAgo - 3, 0), 16, 35) : status === 'dropped' ? dt(Math.max(daysAgo - 2, 0), 15, 0) : null;
    const dueAt = open && (priority === 'urgent' || priority === 'high') ? dt(Math.max(daysAgo - 3, 0), 18, 0) : null;
    const resolution =
      status === 'resolved'
        ? RESOLUTION.resolved[i % RESOLUTION.resolved.length]
        : status === 'dropped'
          ? RESOLUTION.dropped[i % RESOLUTION.dropped.length]
          : null;

    seq += 1;
    const ticketNo = `CS-2026-${String(seq).padStart(4, '0')}`;
    const description = `${DESC[type]} ${TAG}`;

    const [ins] = await pool.query(
      `INSERT INTO support_tickets
         (ticket_no, title, description, type, channel, priority, status,
          customer_id, lead_id, requester_name, requester_phone, requester_email,
          assigned_to, resolution, first_response_at, resolved_at, closed_at, due_at, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ticketNo, title, description, type, channel, priority, status,
        customerId, leadId, reqName, reqPhone, reqEmail,
        assignedTo, resolution, firstResp, resolvedAt, closedAt, dueAt, createdBy, createdAt,
      ]
    );
    const tid = ins.insertId;
    nT++;

    // ── 이력 (감사 타임라인) ──
    const hist = [['created', null, ticketNo, '접수', createdBy, createdAt]];
    if (assignedTo) hist.push(['assigned_to', null, String(assignedTo), null, assignedTo, firstResp]);
    if (status === 'registered') hist.push(['status', 'received', 'registered', null, createdBy, firstResp]);
    if (status === 'assigned') hist.push(['status', 'received', 'assigned', null, assignedTo, firstResp]);
    if (['in_progress', 'on_hold', 'resolved', 'dropped'].includes(status))
      hist.push(['status', 'received', 'in_progress', null, assignedTo, firstResp]);
    if (status === 'on_hold') hist.push(['status', 'in_progress', 'on_hold', '고객 회신 대기', assignedTo, dt(Math.max(daysAgo - 2, 0), 14, 0)]);
    if (status === 'resolved') hist.push(['status', 'in_progress', 'resolved', null, assignedTo, resolvedAt]);
    if (status === 'dropped') hist.push(['status', 'in_progress', 'dropped', '중복/취소', assignedTo, closedAt]);
    for (const [field, fv, tv, note, by, at] of hist) {
      await pool.query(
        `INSERT INTO support_history (ticket_id, field, from_value, to_value, note, changed_by, changed_at)
         VALUES (?,?,?,?,?,?,?)`,
        [tid, field, fv, tv, note, by, at]
      );
      nH++;
    }

    // ── 댓글 (처리/내부 메모) — 진행 이상 단계에 1~2건 ──
    if (!newish) {
      await pool.query(
        `INSERT INTO support_comments (ticket_id, author_id, content, is_internal, created_at) VALUES (?,?,?,?,?)`,
        [tid, assignedTo, '접수 확인했습니다. 재현 로그 확인 후 회신드리겠습니다.', 1, firstResp]
      );
      nC++;
      if (['resolved', 'dropped', 'on_hold'].includes(status)) {
        const msg =
          status === 'on_hold'
            ? '고객측 추가 정보 회신 대기 중입니다. (보류)'
            : status === 'dropped'
              ? '중복/취소 건으로 종료 처리했습니다.'
              : '처리 완료하여 고객께 안내드렸습니다. 추가 문의 없으면 종결합니다.';
        await pool.query(
          `INSERT INTO support_comments (ticket_id, author_id, content, is_internal, created_at) VALUES (?,?,?,?,?)`,
          [tid, assignedTo, msg, 0, closedAt || resolvedAt || firstResp]
        );
        nC++;
      }
    }
  }
  console.log(`✅ 시드 완료 — 티켓 ${nT}건 (${`CS-2026-${String(seq - nT + 1).padStart(4, '0')}`} ~ CS-2026-${String(seq).padStart(4, '0')}), 댓글 ${nC}건, 이력 ${nH}건`);
}

(async () => {
  try {
    if (process.argv.includes('--clean')) await clean();
    else await seed();
  } catch (e) {
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
