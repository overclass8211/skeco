'use strict';
/**
 * Modusign Webhook 수신 라우터
 *
 * 마운트 위치: server.js 의 authenticate 미들웨어 *앞에* (인증 우회)
 * 보안: X-Modusign-Signature 헤더 HMAC-SHA256 검증
 *
 * 이벤트 처리:
 *   document.signed     — 1명 서명 (진행 중)
 *   document.completed  — 모두 서명 완료 → contracts.esign_status='signed'
 *   document.rejected   — 거부 → 'rejected'
 *   document.expired    — 만료 → 'expired'
 *   document.cancelled  — 취소 → 'cancelled'
 *
 * 모든 이벤트는 esign_events 테이블에 raw payload 저장
 */
const router = require('express').Router();
const express = require('express');
const pool = require('../db');
const modusign = require('../services/modusign');

// raw body 필요 (서명 검증용)
router.use(express.raw({ type: '*/*', limit: '5mb' }));

router.post('/modusign', async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
  const sigHeader = req.headers['x-modusign-signature'] || req.headers['X-Modusign-Signature'];

  // 1. 서명 검증
  if (!modusign.verifyWebhookSignature(sigHeader, rawBody)) {
    console.warn('[modusign:webhook] 서명 검증 실패');
    return res.status(401).json({ success: false, error: 'invalid signature' });
  }

  // 2. payload 파싱
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return res.status(400).json({ success: false, error: 'invalid json' });
  }

  // 3. 이벤트 타입/문서 ID 추출 (Modusign API spec 에 따라 조정)
  const eventType = payload.event || payload.eventType || payload.type || 'unknown';
  const documentId = payload.document_id || payload.documentId || payload.document?.id || null;
  const signerEmail =
    payload.signer_email || payload.signer?.email || payload.participant?.email || null;

  if (!documentId) {
    console.warn('[modusign:webhook] document_id 누락:', JSON.stringify(payload).slice(0, 200));
    return res.status(400).json({ success: false, error: 'document_id required' });
  }

  try {
    // 4. 해당 계약 조회
    const [[contract]] = await pool.query(
      `SELECT id, esign_status FROM contracts WHERE esign_request_id = ? LIMIT 1`,
      [documentId]
    );

    if (!contract) {
      // 무관한 webhook 또는 잘못된 document_id — 200 으로 응답 (재전송 방지)
      console.warn('[modusign:webhook] 매칭되는 계약 없음:', documentId);
      return res.json({ success: true, ignored: true });
    }

    // 5. 이벤트 로그
    await pool.query(
      `INSERT INTO esign_events (contract_id, provider, external_id, event_type, event_payload, signer_email)
       VALUES (?, 'modusign', ?, ?, ?, ?)`,
      [
        contract.id,
        documentId,
        String(eventType).slice(0, 50),
        rawBody.toString('utf8').slice(0, 65000),
        signerEmail ? String(signerEmail).slice(0, 200) : null,
      ]
    );

    // 6. 상태 갱신
    let newStatus = null;
    let extraUpdate = '';
    const extraParams = [];
    switch (eventType) {
      case 'document.signed':
        // 1명 서명 — 전체 완료가 아니면 in_progress
        newStatus = 'in_progress';
        break;
      case 'document.completed':
        newStatus = 'signed';
        extraUpdate = ', esign_signed_at = NOW()';
        break;
      case 'document.rejected':
        newStatus = 'rejected';
        break;
      case 'document.expired':
        newStatus = 'expired';
        break;
      case 'document.cancelled':
        newStatus = 'cancelled';
        break;
      default:
        // 알 수 없는 이벤트 — 로그만 남기고 상태 변경 없음
        break;
    }

    if (newStatus) {
      await pool.query(`UPDATE contracts SET esign_status = ?${extraUpdate} WHERE id = ?`, [
        newStatus,
        ...extraParams,
        contract.id,
      ]);
      // history 자동 기록 (esign_signed/esign_rejected 등)
      await pool.query(
        `INSERT INTO contract_history (contract_id, action_type, field_name, old_value, new_value, description)
         VALUES (?, ?, 'esign_status', ?, ?, ?)`,
        [
          contract.id,
          'esign_' + newStatus,
          contract.esign_status || null,
          newStatus,
          `모두싸인 webhook: ${eventType}${signerEmail ? ` (${signerEmail})` : ''}`,
        ]
      );
    }

    console.log(
      `[modusign:webhook] contract=${contract.id} doc=${documentId} event=${eventType} → status=${newStatus || 'unchanged'}`
    );

    res.json({ success: true, contract_id: contract.id, status: newStatus });
  } catch (err) {
    console.error('[modusign:webhook] 처리 실패:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
