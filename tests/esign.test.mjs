/**
 * 전자서명 (Modusign) 통합 테스트 — Mock 모드
 *
 * NODE_ENV='test' 일 때 modusign.isMockMode() === true 가 되어
 * 실제 외부 호출 없이 시뮬레이션됨.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { api, pool } from './helpers.mjs';

const require_ = createRequire(import.meta.url);
const featureGuard = require_('../src/middleware/featureGuard');

const TEST_USER_ID = 1;
const createdIds = [];
const TEST_FILE = path.join(process.cwd(), 'tests', '__esign_dummy.pdf');

beforeAll(async () => {
  if (!fs.existsSync(TEST_FILE)) {
    const PDF_MIN = Buffer.from(
      '%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1>>\nstartxref\n50\n%%EOF',
      'utf8'
    );
    fs.writeFileSync(TEST_FILE, PDF_MIN);
  }
  // crm.contracts.esign 은 default_enabled=false (experimental) — 테스트에서는 강제 활성화
  await pool.query(
    `INSERT INTO dev_features (feature_key, feature_name, is_enabled)
     VALUES ('crm.contracts.esign', '계약 전자서명 (모두싸인)', 1)
     ON DUPLICATE KEY UPDATE is_enabled = 1`
  );
  // featureGuard 캐시 강제 무효화 (5초 TTL 우회 — 즉시 반영)
  featureGuard.invalidate();
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM contracts WHERE id IN (?)', [createdIds]);
  }
  await pool.query(`DELETE FROM esign_oauth_tokens WHERE user_id = ?`, [TEST_USER_ID]);
  if (fs.existsSync(TEST_FILE)) {
    try {
      fs.unlinkSync(TEST_FILE);
    } catch (_) {
      /* 무시 */
    }
  }
});

async function _createApprovedContract(label = '__TEST__esign') {
  const cr = await api()
    .post('/api/contracts')
    .set('X-User-Id', String(TEST_USER_ID))
    .send({
      title: label,
      customer_name: '__TEST__esign_co',
      contract_type: 'NDA',
    });
  expect(cr.status).toBe(200);
  const id = cr.body.id;
  createdIds.push(id);
  // draft → review → approved
  await api()
    .patch(`/api/contracts/${id}/status`)
    .set('X-User-Id', String(TEST_USER_ID))
    .send({ status: 'review' });
  await api()
    .patch(`/api/contracts/${id}/status`)
    .set('X-User-Id', String(TEST_USER_ID))
    .send({ status: 'approved' });
  // 파일 1건 업로드
  await api()
    .post(`/api/contracts/${id}/files`)
    .set('X-User-Id', String(TEST_USER_ID))
    .field('file_type', 'contract')
    .attach('files', TEST_FILE);
  return id;
}

describe('Modusign 전자서명 — Mock 모드', () => {
  // ── OAuth 흐름 ──────────────────────────────────────────
  it('GET /esign/oauth/connect — mock 환경에서 auth_url + mock=true 응답', async () => {
    const res = await api()
      .get('/api/contracts/esign/oauth/connect')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mock).toBe(true);
    expect(typeof res.body.data.auth_url).toBe('string');
    expect(res.body.data.auth_url).toContain('oauth/authorize');
  });

  it('GET /esign/oauth/callback — mock code 교환 + 토큰 DB 저장', async () => {
    // state 인코딩 (실제 connect 흐름 모방)
    const state = Buffer.from(
      JSON.stringify({ uid: TEST_USER_ID, ts: Date.now() })
    ).toString('base64url');
    const res = await api()
      .get(
        `/api/contracts/esign/oauth/callback?code=__MOCK_CODE__&state=${encodeURIComponent(state)}`
      )
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.mock).toBe(true);
    expect(res.body.data.modusign_email).toBeDefined();

    // DB 에 토큰 저장 확인
    const [[row]] = await pool.query(
      `SELECT * FROM esign_oauth_tokens WHERE user_id = ? AND provider = 'modusign'`,
      [TEST_USER_ID]
    );
    expect(row).toBeDefined();
    expect(row.modusign_user_id).toBeDefined();
  });

  it('GET /esign/status — 연결 후 connected=true', async () => {
    const res = await api()
      .get('/api/contracts/esign/status')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.mock).toBe(true);
  });

  // ── 서명 요청 ────────────────────────────────────────────
  it('POST /:id/esign/request — 정상 요청 (mock document_id 발급)', async () => {
    const id = await _createApprovedContract('__TEST__esign_normal');
    const res = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        signers: [
          { name: '김갑동', email: 'kim@test.com' },
          { name: '이을순', email: 'lee@test.com', phone: '010-0000-0000' },
        ],
        message: '__TEST__ 서명 요청',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.document_id).toContain('__MOCK_DOC_');
    expect(res.body.data.status).toBe('requested');

    // contracts 갱신 확인
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.esign_provider).toBe('modusign');
    expect(detail.body.data.esign_request_id).toBeDefined();
    expect(detail.body.data.esign_status).toBe('requested');
    expect(detail.body.data.esign_requested_at).toBeDefined();
    // history 에 esign_request 액션 기록
    expect(detail.body.data.history.some(h => h.action_type === 'esign_request')).toBe(true);
  });

  it('POST /:id/esign/request — status != approved → 400', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__esign_not_approved',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);
    const res = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        signers: [{ name: '김', email: 'k@test.com' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('승인');
  });

  it('POST /:id/esign/request — 서명자 누락 → 400', async () => {
    const id = await _createApprovedContract('__TEST__esign_no_signer');
    const res = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [] });
    expect(res.status).toBe(400);
  });

  it('POST /:id/esign/request — 중복 요청 → 400', async () => {
    const id = await _createApprovedContract('__TEST__esign_dup');
    await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });
    const second = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '이', email: 'l@test.com' }] });
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('이미');
  });

  // ── 상태 조회 ────────────────────────────────────────────
  it('GET /:id/esign/status — local + remote (mock) 반환', async () => {
    const id = await _createApprovedContract('__TEST__esign_status');
    await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });

    const res = await api()
      .get(`/api/contracts/${id}/esign/status`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.local).toBeDefined();
    expect(res.body.data.local.esign_request_id).toBeDefined();
    expect(res.body.data.local.esign_signers).toBeDefined();
    expect(res.body.data.remote).toBeDefined();
    expect(res.body.data.remote.signers).toBeDefined();
  });

  // ── 취소 ─────────────────────────────────────────────────
  it('POST /:id/esign/cancel — 요청 취소 → status=cancelled', async () => {
    const id = await _createApprovedContract('__TEST__esign_cancel');
    await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });

    const res = await api()
      .post(`/api/contracts/${id}/esign/cancel`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    expect(res.status).toBe(200);

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.esign_status).toBe('cancelled');
    expect(detail.body.data.history.some(h => h.action_type === 'esign_cancel')).toBe(true);
  });

  // ── Webhook (인증 우회) ──────────────────────────────────
  it('POST /api/webhooks/modusign — document.completed → esign_status=signed', async () => {
    const id = await _createApprovedContract('__TEST__esign_webhook');
    const req = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });
    const documentId = req.body.data.document_id;

    // Webhook 페이로드
    const payload = JSON.stringify({
      event: 'document.completed',
      document_id: documentId,
      signer_email: 'k@test.com',
    });

    // mock 모드에서는 서명 검증 skip 됨
    const wh = await api()
      .post('/api/webhooks/modusign')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(wh.status).toBe(200);
    expect(wh.body.success).toBe(true);
    expect(wh.body.contract_id).toBe(id);
    expect(wh.body.status).toBe('signed');

    // contracts 갱신 확인
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.esign_status).toBe('signed');
    expect(detail.body.data.esign_signed_at).toBeDefined();
    expect(detail.body.data.history.some(h => h.action_type === 'esign_signed')).toBe(true);

    // esign_events 에 raw payload 저장
    const [evs] = await pool.query(
      `SELECT * FROM esign_events WHERE contract_id = ? ORDER BY received_at DESC LIMIT 1`,
      [id]
    );
    expect(evs.length).toBe(1);
    expect(evs[0].event_type).toBe('document.completed');
    expect(evs[0].external_id).toBe(documentId);
  });

  it('POST /api/webhooks/modusign — document.rejected → esign_status=rejected', async () => {
    const id = await _createApprovedContract('__TEST__esign_reject');
    const req = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });
    const documentId = req.body.data.document_id;

    const payload = JSON.stringify({ event: 'document.rejected', document_id: documentId });
    const wh = await api()
      .post('/api/webhooks/modusign')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(wh.status).toBe(200);
    expect(wh.body.status).toBe('rejected');

    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.esign_status).toBe('rejected');
  });

  it('POST /api/webhooks/modusign — 매칭되는 계약 없음 → ignored', async () => {
    const payload = JSON.stringify({
      event: 'document.completed',
      document_id: '__NOT_EXIST_DOC_XYZ__',
    });
    const wh = await api()
      .post('/api/webhooks/modusign')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(wh.status).toBe(200);
    expect(wh.body.ignored).toBe(true);
  });

  // ── 서명본 다운로드 ──────────────────────────────────────
  it('GET /:id/esign/signed-pdf — mock PDF 다운로드 (mock 모드는 status 무관)', async () => {
    const id = await _createApprovedContract('__TEST__esign_download');
    const req = await api()
      .post(`/api/contracts/${id}/esign/request`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ signers: [{ name: '김', email: 'k@test.com' }] });
    const documentId = req.body.data.document_id;

    // signed 상태 전환 (webhook 시뮬레이션)
    await api()
      .post('/api/webhooks/modusign')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({ event: 'document.completed', document_id: documentId })
      );

    const dl = await api()
      .get(`/api/contracts/${id}/esign/signed-pdf`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
  });

  // ── 연결 해제 ────────────────────────────────────────────
  it('DELETE /esign/disconnect — 토큰 삭제 + 재조회 시 connected=false', async () => {
    // 먼저 연결되어 있는지 확인 (callback 테스트에서 저장됨)
    const before = await api()
      .get('/api/contracts/esign/status')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(before.body.data.connected).toBe(true);

    const res = await api()
      .delete('/api/contracts/esign/disconnect')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    const after = await api()
      .get('/api/contracts/esign/status')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(after.body.data.connected).toBe(false);
  });
});

describe('Modusign service — verifyWebhookSignature (mock vs real)', () => {
  it('mock 모드에서는 항상 true 반환 (시그니처 검증 skip)', async () => {
    // dynamic import
    const modusignMod = await import('../src/services/modusign.js').then(m => m.default || m);
    const ok = modusignMod.verifyWebhookSignature('any_signature', 'any_body');
    expect(ok).toBe(true);
    // crypto 검증 — HMAC 가 일관되는지 확인 (직접 검증 시)
    const secret = 'test-secret';
    const body = 'hello world';
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(expected.length).toBe(64);
  });
});
