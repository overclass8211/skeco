/**
 * 고객지원(A/S) 모듈 — P1-A: 자가 마이그레이션 + 설정형(support_settings) CRUD
 * (adminOnly 는 test 환경에서 우회 — rbac.js 와 동일. 운영은 admin/superadmin 강제)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const A = () => api();

describe('Support — 설정형 + 마이그레이션 (P1-A)', () => {
  const createdIds = [];
  afterAll(async () => {
    for (const id of createdIds) await pool.query('DELETE FROM support_settings WHERE id=?', [id]);
    await pool.query("DELETE FROM support_tickets WHERE title LIKE '__TEST__%'");
  });

  it('마이그레이션 — 4종 기본값 시드 (status7 / type5 / priority4 / channel5)', async () => {
    const res = await A().get('/api/support/settings');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.status.length).toBe(7);
    expect(d.type.length).toBe(5);
    expect(d.priority.length).toBe(4);
    expect(d.channel.length).toBe(5);
  });

  it('status — 접수(is_initial) · 조치완료/드롭(is_final) · 보류(pending) 속성', async () => {
    const rows = (await A().get('/api/support/settings/status')).body.data;
    expect(rows.find(r => r.item_key === 'received').is_initial).toBe(1);
    expect(rows.find(r => r.item_key === 'resolved').is_final).toBe(1);
    expect(rows.find(r => r.item_key === 'dropped').is_final).toBe(1);
    expect(rows.find(r => r.item_key === 'on_hold').category).toBe('pending');
  });

  it('POST 유형 추가 → 목록 반영', async () => {
    const res = await A()
      .post('/api/support/settings/type')
      .send({ label: '__테스트유형', color: 'blue', sort_order: 99, item_key: '__test_type' });
    expect(res.status).toBe(200);
    createdIds.push(res.body.id);
    const list = await A().get('/api/support/settings/type?include=all');
    expect(list.body.data.some(r => r.item_key === '__test_type')).toBe(true);
  });

  it('POST status — category/is_initial/is_final 반영', async () => {
    const res = await A()
      .post('/api/support/settings/status')
      .send({ label: '__검토대기', item_key: '__test_review', color: 'amber', category: 'pending' });
    expect(res.status).toBe(200);
    createdIds.push(res.body.id);
    const row = (await A().get('/api/support/settings/status?include=all')).body.data.find(
      r => r.item_key === '__test_review'
    );
    expect(row.category).toBe('pending');
    expect(row.color).toBe('amber');
  });

  it('PUT — 라벨 변경 + 비활성화', async () => {
    const id = createdIds[0];
    const put = await A()
      .put(`/api/support/settings/${id}`)
      .send({ label: '__유형수정', is_active: 0 });
    expect(put.status).toBe(200);
    const row = (await A().get('/api/support/settings/type?include=all')).body.data.find(
      r => r.id === id
    );
    expect(row.label).toBe('__유형수정');
    expect(row.is_active).toBe(0);
  });

  it('reorder — sort_order 일괄 변경', async () => {
    const types = (await A().get('/api/support/settings/type?include=all')).body.data;
    const order = types.map((t, i) => ({ id: t.id, sort_order: (i + 1) * 5 }));
    const res = await A().post('/api/support/settings/type/reorder').send({ order });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(order.length);
  });

  it('POST — 유효하지 않은 kind 는 400', async () => {
    const res = await A().post('/api/support/settings/bogus').send({ label: 'x' });
    expect(res.status).toBe(400);
  });

  it('DELETE — 사용 중(티켓이 참조)이면 409 + used_count', async () => {
    await pool.query("INSERT INTO support_tickets (title, status) VALUES ('__TEST__inuse','received')");
    const recv = (await A().get('/api/support/settings/status')).body.data.find(
      r => r.item_key === 'received'
    );
    const del = await A().delete(`/api/support/settings/${recv.id}`);
    expect(del.status).toBe(409);
    expect(del.body.used_count).toBeGreaterThan(0);
  });

  it('DELETE — 미사용 항목은 삭제 성공', async () => {
    const res = await A()
      .post('/api/support/settings/channel')
      .send({ label: '__임시채널', item_key: '__test_ch' });
    const del = await A().delete(`/api/support/settings/${res.body.id}`);
    expect(del.status).toBe(200);
  });
});

describe('Support — 티켓 CRUD + 상태전환 + 댓글/첨부/이력 (P1-B)', () => {
  let tid;
  let ticketNo;
  afterAll(async () => {
    if (tid) {
      const [files] = await pool.query('SELECT file_path FROM support_files WHERE ticket_id=?', [
        tid,
      ]);
      const fs = await import('node:fs');
      files.forEach(f => {
        try {
          fs.unlinkSync(f.file_path);
        } catch (_) {
          /* 무시 */
        }
      });
      await pool.query('DELETE FROM support_comments WHERE ticket_id=?', [tid]);
      await pool.query('DELETE FROM support_files WHERE ticket_id=?', [tid]);
      await pool.query('DELETE FROM support_history WHERE ticket_id=?', [tid]);
      await pool.query('DELETE FROM support_notifications WHERE ticket_id=?', [tid]);
      await pool.query('DELETE FROM support_tickets WHERE id=?', [tid]);
    }
  });

  it('POST — 접수: 자동채번 CS-YYYY-NNNN + 시작상태(received) + 라벨 조인', async () => {
    const res = await A().post('/api/support').send({
      title: '__TEST__ 로그인 안됨',
      type: 'issue',
      channel: 'phone',
      priority: 'high',
      customer_id: 1,
      requester_name: '홍길동',
      requester_phone: '010-0000-0000',
    });
    expect(res.status).toBe(200);
    tid = res.body.id;
    ticketNo = res.body.ticket_no;
    expect(ticketNo).toMatch(/^CS-\d{4}-\d{4}$/);
    const got = await A().get(`/api/support/${tid}`);
    expect(got.body.data.status).toBe('received');
    expect(got.body.data.status_label).toBe('접수');
    expect(got.body.data.type_label).toBe('이슈');
    expect(got.body.data.priority_label).toBe('높음');
  });

  it('GET 목록 — 생성 티켓 노출 + customer_id/검색 필터', async () => {
    const res = await A().get('/api/support?customer_id=1&q=__TEST__');
    expect(res.status).toBe(200);
    expect(res.body.data.some(t => t.id === tid)).toBe(true);
  });

  it('PUT — 상태전환(처리중) → 이력 기록', async () => {
    const put = await A().put(`/api/support/${tid}`).send({ status: 'in_progress' });
    expect(put.status).toBe(200);
    const got = await A().get(`/api/support/${tid}`);
    expect(got.body.data.status).toBe('in_progress');
    expect(got.body.data.status_label).toBe('처리중');
    const hist = await A().get(`/api/support/${tid}/history`);
    expect(hist.body.data.some(h => h.field === 'status' && h.to_value === 'in_progress')).toBe(
      true
    );
  });

  it('PUT — 종결(조치완료, is_final) → closed_at 자동 + category=closed', async () => {
    const put = await A()
      .put(`/api/support/${tid}`)
      .send({ status: 'resolved', resolution: '재설치로 해결' });
    expect(put.status).toBe(200);
    const got = await A().get(`/api/support/${tid}`);
    expect(got.body.data.status).toBe('resolved');
    expect(got.body.data.closed_at).toBeTruthy();
    expect(got.body.data.status_category).toBe('closed');
  });

  it('PATCH /assign — 담당자 할당 + 이력', async () => {
    const res = await A().patch(`/api/support/${tid}/assign`).send({ assigned_to: 1 });
    expect(res.status).toBe(200);
    const got = await A().get(`/api/support/${tid}`);
    expect(got.body.data.assigned_to).toBe(1);
    const hist = await A().get(`/api/support/${tid}/history`);
    expect(hist.body.data.some(h => h.field === 'assigned_to')).toBe(true);
  });

  it('PATCH /assign — 재할당 사유(note) 이력 기록 [W2]', async () => {
    const res = await A()
      .patch(`/api/support/${tid}/assign`)
      .send({ assigned_to: 2, note: '담당 영역 아님 — 재할당' });
    expect(res.status).toBe(200);
    const hist = await A().get(`/api/support/${tid}/history`);
    const last = hist.body.data.filter(h => h.field === 'assigned_to').pop();
    expect(last.note).toContain('재할당');
  });

  it('인앱 알림 — 재할당 시 새 담당자에게 알림 생성 [W2]', async () => {
    await A().patch(`/api/support/${tid}/assign`).send({ assigned_to: 3, note: '알림 테스트' });
    const [[n]] = await pool.query(
      'SELECT * FROM support_notifications WHERE ticket_id=? AND user_id=3 ORDER BY id DESC LIMIT 1',
      [tid]
    );
    expect(n).toBeTruthy();
    expect(n.message).toContain('할당');
  });

  it('인앱 알림 — 종결(is_final) 시 접수자에게 알림 [W2]', async () => {
    // 접수자=5 로 지정 + 비종결 상태로 되돌린 뒤 조치완료 전환
    await pool.query("UPDATE support_tickets SET created_by=5, status='in_progress' WHERE id=?", [
      tid,
    ]);
    const put = await A().put(`/api/support/${tid}`).send({ status: 'resolved' });
    expect(put.status).toBe(200);
    const [[n]] = await pool.query(
      "SELECT * FROM support_notifications WHERE ticket_id=? AND user_id=5 AND event_type='resolved' ORDER BY id DESC LIMIT 1",
      [tid]
    );
    expect(n).toBeTruthy();
  });

  it('[F3] 참조자(watchers) — 저장 + 신규 추가/종결 알림 fan-out', async () => {
    // 비종결로 되돌리고 참조자 비움
    await pool.query("UPDATE support_tickets SET status='in_progress', watchers=NULL WHERE id=?", [
      tid,
    ]);
    // 참조자 2명 지정 → 저장 + 신규 참조자 알림
    const put = await A()
      .put(`/api/support/${tid}`)
      .send({
        watchers: [
          { id: 2, name: '참조자A' },
          { id: 3, name: '참조자B' },
        ],
      });
    expect(put.status).toBe(200);
    const got = await A().get(`/api/support/${tid}`);
    const ws = JSON.parse(got.body.data.watchers || '[]');
    expect(ws.map(w => w.id).sort()).toEqual([2, 3]);
    const [[w2]] = await pool.query(
      "SELECT * FROM support_notifications WHERE ticket_id=? AND user_id=2 AND event_type='watcher' ORDER BY id DESC LIMIT 1",
      [tid]
    );
    expect(w2).toBeTruthy();
    expect(w2.message).toContain('참조자');
    // 종결 시 참조자에게도 resolved 알림
    await A().put(`/api/support/${tid}`).send({ status: 'resolved' });
    const [[r3]] = await pool.query(
      "SELECT * FROM support_notifications WHERE ticket_id=? AND user_id=3 AND event_type='resolved' ORDER BY id DESC LIMIT 1",
      [tid]
    );
    expect(r3).toBeTruthy();
  });

  it('[F4] 목록 필터 — 접수자(created_by) + 접수기간(from/to)', async () => {
    // tid 는 created_by=5 (앞 테스트에서 지정됨)
    const byCreator = await A().get('/api/support?created_by=5&q=__TEST__');
    expect(byCreator.body.data.some(t => t.id === tid)).toBe(true);
    // 미래 시작일 → 결과 제외
    const future = await A().get('/api/support?from=2099-01-01&q=__TEST__');
    expect(future.body.data.some(t => t.id === tid)).toBe(false);
    // 과거~오늘 범위 → 포함
    const today = new Date().toISOString().slice(0, 10);
    const range = await A().get(`/api/support?from=2020-01-01&to=${today}&q=__TEST__`);
    expect(range.body.data.some(t => t.id === tid)).toBe(true);
  });

  it('[SLA] 대시보드 KPI — 미해결/기한초과 집계 (처리예정일 기준)', async () => {
    // tid 를 미해결 + 처리예정일 어제로 설정 → 기한초과 1건 이상 보장
    await pool.query(
      "UPDATE support_tickets SET status='in_progress', due_at=DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id=?",
      [tid]
    );
    const res = await A().get('/api/support/dashboard');
    expect(res.status).toBe(200);
    const d = res.body.data;
    for (const key of ['total', 'open', 'due_today', 'overdue', 'mine_open', 'unassigned']) {
      expect(typeof d[key]).toBe('number');
      expect(d[key]).toBeGreaterThanOrEqual(0);
    }
    expect(d.open).toBeGreaterThanOrEqual(1);
    expect(d.overdue).toBeGreaterThanOrEqual(1);
    expect(d.open).toBeLessThanOrEqual(d.total);
  });

  it('[SLA-3] 진입 시 기한 알림 — 1회 생성 + 당일 중복 방지', async () => {
    // tid 를 담당자 5 + 미해결 + 처리예정일 어제로 → 기한초과 1건
    await pool.query(
      "UPDATE support_tickets SET assigned_to=5, status='in_progress', due_at=DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id=?",
      [tid]
    );
    await pool.query(
      "DELETE FROM support_notifications WHERE user_id=5 AND event_type='due_alert' AND DATE(created_at)=CURDATE()"
    );
    const r1 = await A().post('/api/support/check-due').set('X-User-Id', '5');
    expect(r1.status).toBe(200);
    expect(r1.body.created).toBe(true);
    expect(r1.body.count).toBeGreaterThanOrEqual(1);
    // 같은 날 재호출 → 중복 생성 안 함
    const r2 = await A().post('/api/support/check-due').set('X-User-Id', '5');
    expect(r2.body.created).toBe(false);
    const [[n]] = await pool.query(
      "SELECT COUNT(*) AS c FROM support_notifications WHERE user_id=5 AND event_type='due_alert' AND DATE(created_at)=CURDATE()"
    );
    expect(n.c).toBe(1);
  });

  it('[W3] 상태 전이 규칙 — 비허용 전이 400 + 허용 전이 200', async () => {
    const [[onhold]] = await pool.query(
      "SELECT id FROM support_settings WHERE kind='status' AND item_key='on_hold'"
    );
    try {
      // 보류 → 처리중 만 허용
      await A().put(`/api/support/settings/${onhold.id}`).send({ allowed_next: ['in_progress'] });
      await pool.query("UPDATE support_tickets SET status='on_hold' WHERE id=?", [tid]);
      // 보류 → 조치완료 (비허용) → 400
      const bad = await A().put(`/api/support/${tid}`).send({ status: 'resolved' });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('TRANSITION_NOT_ALLOWED');
      // 보류 → 처리중 (허용) → 200
      const ok = await A().put(`/api/support/${tid}`).send({ status: 'in_progress' });
      expect(ok.status).toBe(200);
    } finally {
      // 정리 — 규칙 해제 (실패·크래시 시에도 공유 시드 원복 보장)
      await A().put(`/api/support/settings/${onhold.id}`).send({ allowed_next: [] });
    }
  });

  it('[W3] 단계 기본 담당자 자동배정 — 미배정 티켓 상태진입 시 배정 + 이력', async () => {
    const [[assigned]] = await pool.query(
      "SELECT id FROM support_settings WHERE kind='status' AND item_key='assigned'"
    );
    try {
      await A().put(`/api/support/settings/${assigned.id}`).send({ default_assignee: 7 });
      await pool.query("UPDATE support_tickets SET assigned_to=NULL, status='received' WHERE id=?", [
        tid,
      ]);
      const r = await A().put(`/api/support/${tid}`).send({ status: 'assigned' });
      expect(r.status).toBe(200);
      const got = await A().get(`/api/support/${tid}`);
      expect(got.body.data.assigned_to).toBe(7);
      const hist = await A().get(`/api/support/${tid}/history`);
      expect(
        hist.body.data.some(h => h.field === 'assigned_to' && h.note === '단계 자동배정')
      ).toBe(true);
    } finally {
      // 정리 — 기본 담당자 해제 (실패·크래시 시에도 공유 시드 원복 보장)
      await A().put(`/api/support/settings/${assigned.id}`).send({ default_assignee: null });
    }
  });

  it('댓글 — 내부메모 + 고객공개 작성 → 목록 2건', async () => {
    await A().post(`/api/support/${tid}/comments`).send({ content: '내부 확인중', is_internal: 1 });
    await A()
      .post(`/api/support/${tid}/comments`)
      .send({ content: '고객님 확인 부탁드립니다', is_internal: 0 });
    const list = await A().get(`/api/support/${tid}/comments`);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data.find(c => c.is_internal === 1)).toBeTruthy();
  });

  it('첨부 — 업로드 + 목록(한글명) + 다운로드 + 삭제', async () => {
    const up = await A()
      .post(`/api/support/${tid}/files`)
      .attach('files', Buffer.from('log'), '에러로그.txt');
    expect(up.status).toBe(200);
    const list = await A().get(`/api/support/${tid}/files`);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].file_name).toBe('에러로그.txt');
    const dl = await A().get(`/api/support/${tid}/files/${list.body.data[0].id}`);
    expect(dl.status).toBe(200);
    const del = await A().delete(`/api/support/${tid}/files/${list.body.data[0].id}`);
    expect(del.status).toBe(200);
  });

  it('검증 — title 없으면 400 / 유효하지 않은 status 400', async () => {
    expect((await A().post('/api/support').send({})).status).toBe(400);
    expect((await A().post('/api/support').send({ title: 'x', status: '__nope' })).status).toBe(400);
  });
});

describe('Support — W1 폼/연결 (영업딜 자동도출 + 접수자/요청일)', () => {
  let leadId;
  let custId;
  const tids = [];
  afterAll(async () => {
    for (const id of tids) {
      await pool.query('DELETE FROM support_history WHERE ticket_id=?', [id]);
      await pool.query('DELETE FROM support_tickets WHERE id=?', [id]);
    }
    if (leadId) await pool.query('DELETE FROM leads WHERE id=?', [leadId]);
  });

  it('lead_id 만 지정 → customer_id 자동 도출 + requested_at/assigned/created_by 저장', async () => {
    const [c] = await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1');
    custId = c[0].id;
    const [l] = await pool.query(
      "INSERT INTO leads (customer_id, customer_name, project_name, stage) VALUES (?, '__TESTCO', '__TEST리드', 'lead')",
      [custId]
    );
    leadId = l.insertId;

    const res = await A().post('/api/support').send({
      title: '__TEST__ W1 자동도출',
      lead_id: leadId,
      requested_at: '2026-06-20',
      assigned_to: 1,
      created_by: 1,
    });
    expect(res.status).toBe(200);
    tids.push(res.body.id);
    const got = (await A().get(`/api/support/${res.body.id}`)).body.data;
    expect(got.customer_id).toBe(custId); // lead → customer 자동 도출
    expect(got.lead_id).toBe(leadId);
    expect(got.assigned_to).toBe(1);
    expect(got.requested_at).toBeTruthy();
    expect(got.created_by_name).toBeTruthy(); // 접수자 이름 JOIN
  });

  it('PUT — 처리요청일/처리예정일(due_at) 수정 반영', async () => {
    const res = await A()
      .post('/api/support')
      .send({ title: '__TEST__ W1 수정', customer_id: custId });
    tids.push(res.body.id);
    const put = await A()
      .put(`/api/support/${res.body.id}`)
      .send({ requested_at: '2026-07-01', due_at: '2026-07-05' });
    expect(put.status).toBe(200);
    const got = (await A().get(`/api/support/${res.body.id}`)).body.data;
    expect(got.requested_at).toBeTruthy();
    expect(got.due_at).toBeTruthy();
  });
});
