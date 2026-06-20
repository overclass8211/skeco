'use strict';
// =============================================================
// dunningService — 연체 미수금 단계별 독촉(dunning) 관리 [P3]
//
// 설계 원칙(DB 안전): **스키마 변경 0건**.
//   · 기존 payment_notifications(kind/dedup_key 는 이미 VARCHAR) 재사용
//     → kind 에 'dunning_1st|2nd|3rd' 값을 추가로 기록(가산·앱레벨)
//   · 정책/템플릿은 system_settings(키-값 JSON)에 저장(신규 테이블 없음)
//
// 정책(기본): 연체 경과일 기준 3단계
//   1차 안내 D+7 / 2차 경고 D+14 / 3차 최종통보 D+30
//   → system_settings 'payment_dunning_policy' 로 조정 가능
//
// 발송 방식(사용자 확정): **내부 관리 중심**
//   · 인앱 알림은 스캔 시 단계별 1회 자동 생성(dedup: '<kind>:<scheduleId>')
//   · 고객 대상 메일은 담당자가 템플릿 검토 후 수동 발송(P3-C) — 자동 외부발송 안 함
//
// 발송/이력 감사: payment_notifications (kind LIKE 'dunning%')
// =============================================================

const pool = require('../db');

let gmailSvc = null;
try {
  gmailSvc = require('./gmail');
} catch (_) {
  /* gmail 서비스 없으면 수동 발송 비활성 — 미리보기/이력은 동작 */
}

const POLICY_KEY = 'payment_dunning_policy';
const TEMPLATES_KEY = 'payment_dunning_templates';

// 기본 단계 정책 (min_days 오름차순)
const DEFAULT_POLICY = [
  { kind: 'dunning_1st', label: '1차 안내', min_days: 7 },
  { kind: 'dunning_2nd', label: '2차 경고', min_days: 14 },
  { kind: 'dunning_3rd', label: '3차 최종통보', min_days: 30 },
];

// 기본 메시지 템플릿 (치환자: {customer_name}{contract_name}{stage}{amount}{currency}{due_date}{overdue_days}{company})
const DEFAULT_TEMPLATES = {
  dunning_1st: {
    subject: '[{company}] 수금 안내 — {contract_name} {stage}',
    body: `안녕하세요, {customer_name} 담당자님.

{contract_name} 건의 {stage} 대금 {amount} {currency} 의 결제 예정일({due_date})이 {overdue_days}일 경과하였습니다.
확인하시어 입금 부탁드립니다. 이미 처리하셨다면 본 안내는 무시하셔도 됩니다.

감사합니다.`,
  },
  dunning_2nd: {
    subject: '[{company}] 수금 경고(2차) — {contract_name} {stage}',
    body: `안녕하세요, {customer_name} 담당자님.

{contract_name} 건의 {stage} 대금 {amount} {currency} 가 결제 예정일({due_date}) 기준 {overdue_days}일 연체되었습니다.
빠른 시일 내 입금 처리를 요청드립니다. 문의사항은 담당자에게 연락 부탁드립니다.

감사합니다.`,
  },
  dunning_3rd: {
    subject: '[{company}] 수금 최종통보(3차) — {contract_name} {stage}',
    body: `안녕하세요, {customer_name} 담당자님.

{contract_name} 건의 {stage} 대금 {amount} {currency} 가 {overdue_days}일 장기 연체 상태입니다(예정일 {due_date}).
본 통보 후에도 미입금 시 후속 조치가 진행될 수 있습니다. 조속한 입금 처리를 강력히 요청드립니다.

감사합니다.`,
  },
};

const COMPANY_NAME_KEY = 'supplier_company_name'; // 있으면 사용, 없으면 폴백

function _fmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

// system_settings 단건 조회 (없으면 null)
async function _getSetting(key) {
  try {
    const [[row]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = ?`,
      [key]
    );
    return row?.setting_value ?? null;
  } catch (_) {
    return null;
  }
}

async function _setSetting(key, value) {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

async function _getCompany() {
  const v = await _getSetting(COMPANY_NAME_KEY);
  return (v && String(v).trim()) || 'SK에코플랜트 머티리얼즈';
}

// ── 정책 ────────────────────────────────────────────────────
async function getPolicy() {
  const raw = await _getSetting(POLICY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const cleaned = _validatePolicy(parsed);
      if (cleaned.length) return cleaned;
    } catch (_) {
      /* 손상된 값 — 기본값 */
    }
  }
  return DEFAULT_POLICY.map(s => ({ ...s }));
}

function _validatePolicy(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const s of arr) {
    const kind = String(s?.kind || '').trim();
    const label = String(s?.label || '')
      .trim()
      .slice(0, 50);
    const minDays = Number(s?.min_days);
    if (!/^dunning_[a-z0-9]+$/i.test(kind)) continue;
    if (!Number.isFinite(minDays) || minDays < 0 || minDays > 3650) continue;
    out.push({ kind, label: label || kind, min_days: Math.round(minDays) });
  }
  // min_days 오름차순 + kind 중복 제거
  const seen = new Set();
  return out
    .filter(s => (seen.has(s.kind) ? false : seen.add(s.kind)))
    .sort((a, b) => a.min_days - b.min_days);
}

async function setPolicy(stages) {
  const cleaned = _validatePolicy(stages);
  if (!cleaned.length) throw new Error('유효한 독촉 단계가 없습니다 (kind/min_days 확인)');
  await _setSetting(POLICY_KEY, JSON.stringify(cleaned));
  return cleaned;
}

// ── 템플릿 ──────────────────────────────────────────────────
async function getTemplates() {
  const merged = {};
  for (const k of Object.keys(DEFAULT_TEMPLATES)) merged[k] = { ...DEFAULT_TEMPLATES[k] };
  const raw = await _getSetting(TEMPLATES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (!v || typeof v !== 'object') continue;
          merged[k] = {
            subject: String(v.subject || merged[k]?.subject || '').slice(0, 300),
            body: String(v.body || merged[k]?.body || '').slice(0, 5000),
          };
        }
      }
    } catch (_) {
      /* 손상된 값 — 기본값 */
    }
  }
  return merged;
}

async function setTemplates(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('templates 는 객체여야 합니다');
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!/^dunning_[a-z0-9]+$/i.test(k)) continue;
    if (!v || typeof v !== 'object') continue;
    out[k] = {
      subject: String(v.subject || '').slice(0, 300),
      body: String(v.body || '').slice(0, 5000),
    };
  }
  if (!Object.keys(out).length) throw new Error('유효한 템플릿이 없습니다');
  await _setSetting(TEMPLATES_KEY, JSON.stringify(out));
  return getTemplates();
}

// 치환자 렌더링 — 알 수 없는 {key} 는 그대로 둠
function renderTemplate(tpl, vars) {
  const map = vars || {};
  const sub = s =>
    String(s || '').replace(/\{(\w+)\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(map, key) ? String(map[key] ?? '') : m
    );
  return { subject: sub(tpl?.subject), body: sub(tpl?.body) };
}

// 연체 경과일 → 도래한 최고 단계 (없으면 null = 독촉 전)
function pickStage(overdueDays, policy) {
  const days = Number(overdueDays) || 0;
  let picked = null;
  for (const s of policy) {
    if (days >= s.min_days) picked = s;
  }
  return picked;
}

// 스케줄 1건의 치환 변수 구성
function _varsForSchedule(s, company) {
  const remaining = Number(s.scheduled_amount) - Number(s.paid_amount || 0);
  return {
    customer_name: s.customer_name || '',
    contract_name: s.contract_name || '',
    stage: s.stage_name || '',
    amount: _fmt(remaining > 0 ? remaining : 0),
    currency: s.currency || 'KRW',
    due_date: String(s.due_date || '').slice(0, 10),
    overdue_days: String(s.overdue_days ?? ''),
    company,
  };
}

// 현재 연체(잔여>0) 스케줄 + 경과일 + 잔액 조회
async function _loadOverdueSchedules() {
  // 연체 상태 동기화 (기존 동작과 동일 — 가산 마킹만)
  await pool.query(`
    UPDATE payment_schedules
       SET status = 'overdue'
     WHERE status IN ('scheduled','invoiced')
       AND due_date < CURDATE()
  `);
  const [rows] = await pool.query(`
    SELECT ps.id, ps.contract_id, ps.customer_id, ps.customer_name, ps.contract_name,
           ps.stage_name, ps.scheduled_amount, ps.currency, ps.due_date, ps.created_by,
           DATEDIFF(CURDATE(), ps.due_date)  AS overdue_days,
           COALESCE(SUM(pr.paid_amount), 0)  AS paid_amount
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
     WHERE ps.status = 'overdue'
     GROUP BY ps.id
     ORDER BY ps.due_date ASC
  `);
  return rows
    .map(s => ({ ...s, remaining: Number(s.scheduled_amount) - Number(s.paid_amount || 0) }))
    .filter(s => s.remaining > 0);
}

/**
 * 단계별 독촉 스캔 — 도래한 단계마다 인앱 알림 1회 생성(dedup).
 * @returns {{scanned:number, created:number, by_stage:Object}}
 */
async function scanDunning() {
  const policy = await getPolicy();
  const overdue = await _loadOverdueSchedules();
  const byStage = {};
  let created = 0;
  for (const s of overdue) {
    const stage = pickStage(s.overdue_days, policy);
    if (!stage) continue; // 연체이나 1차 미도래
    const dedupKey = `${stage.kind}:${s.id}`;
    try {
      const [r] = await pool.query(
        `INSERT IGNORE INTO payment_notifications
           (schedule_id, contract_id, customer_name, kind, overdue_days, amount,
            channel, status, dedup_key, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, 'inapp', 'unread', ?, ?)`,
        [
          s.id,
          s.contract_id || null,
          s.customer_name || null,
          stage.kind,
          s.overdue_days,
          s.remaining,
          dedupKey,
          JSON.stringify({
            stage: s.stage_name,
            stage_label: stage.label,
            contract_name: s.contract_name,
            due_date: String(s.due_date || '').slice(0, 10),
            currency: s.currency || 'KRW',
          }),
        ]
      );
      if (r.affectedRows > 0 && r.insertId) {
        created++;
        byStage[stage.kind] = (byStage[stage.kind] || 0) + 1;
      }
    } catch (e) {
      console.warn('[dunning] 알림 생성 실패:', e.message);
    }
  }
  return { scanned: overdue.length, created, by_stage: byStage };
}

// 현황 — 현재 연체 스케줄을 도래 단계와 함께 (독촉 전 포함)
async function listCurrent() {
  const policy = await getPolicy();
  const overdue = await _loadOverdueSchedules();
  return overdue.map(s => {
    const stage = pickStage(s.overdue_days, policy);
    return {
      schedule_id: s.id,
      contract_id: s.contract_id,
      customer_id: s.customer_id,
      customer_name: s.customer_name,
      contract_name: s.contract_name,
      stage_name: s.stage_name,
      due_date: String(s.due_date || '').slice(0, 10),
      overdue_days: Number(s.overdue_days) || 0,
      remaining: s.remaining,
      currency: s.currency || 'KRW',
      dunning_kind: stage?.kind || null,
      dunning_label: stage?.label || '독촉 전',
    };
  });
}

// 단계별 집계 (KPI)
async function summary() {
  const list = await listCurrent();
  const policy = await getPolicy();
  const stages = {};
  for (const st of policy)
    stages[st.kind] = { kind: st.kind, label: st.label, count: 0, amount: 0 };
  stages._pending = { kind: '_pending', label: '독촉 전', count: 0, amount: 0 };
  let totalCount = 0;
  let totalAmount = 0;
  for (const r of list) {
    const key = r.dunning_kind || '_pending';
    if (!stages[key]) stages[key] = { kind: key, label: r.dunning_label, count: 0, amount: 0 };
    stages[key].count++;
    stages[key].amount += Number(r.remaining) || 0;
    totalCount++;
    totalAmount += Number(r.remaining) || 0;
  }
  return { stages, total_count: totalCount, total_amount: totalAmount };
}

// 독촉 이력 (payment_notifications kind LIKE 'dunning%')
async function listHistory({ kind, channel, status, limit } = {}) {
  const where = [`kind LIKE 'dunning%'`];
  const params = [];
  if (kind) {
    where.push('kind = ?');
    params.push(String(kind));
  }
  if (channel) {
    where.push('channel = ?');
    params.push(String(channel));
  }
  if (status) {
    where.push('status = ?');
    params.push(String(status));
  }
  const lim = Math.min(parseInt(limit, 10) || 200, 1000);
  const [rows] = await pool.query(
    `SELECT * FROM payment_notifications
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?`,
    [...params, lim]
  );
  return rows;
}

// 메시지 미리보기 — schedule + kind → 렌더된 subject/body
async function previewMessage(scheduleId, kind) {
  const [[s]] = await pool.query(
    `SELECT ps.id, ps.customer_name, ps.contract_name, ps.stage_name,
            ps.scheduled_amount, ps.currency, ps.due_date,
            DATEDIFF(CURDATE(), ps.due_date) AS overdue_days,
            COALESCE((SELECT SUM(paid_amount) FROM payment_records WHERE schedule_id = ps.id), 0) AS paid_amount
       FROM payment_schedules ps WHERE ps.id = ?`,
    [parseInt(scheduleId, 10)]
  );
  if (!s) throw new Error('수금 스케줄을 찾을 수 없습니다');
  const templates = await getTemplates();
  const tpl = templates[kind] || DEFAULT_TEMPLATES.dunning_1st;
  const company = await _getCompany();
  const rendered = renderTemplate(tpl, _varsForSchedule(s, company));
  return { schedule_id: s.id, kind, ...rendered };
}

// 수동 메일 발송 [P3-C] — 담당자 검토 후 고객(수신자)에게 독촉 메일 발송.
//   · outward-facing: 라우트에서 사용자 트리거(확인)로만 호출
//   · Gmail 미연결/발송자 없음 → 발송하지 않고 명확한 에러(안전)
//   · 발송 성공 시에만 payment_notifications(channel='email') 이력 기록(dedup_key NULL = 수동 반복 허용)
async function sendDunning({ scheduleId, kind, to, senderUserId }) {
  const email = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('유효한 수신 이메일이 아닙니다');
  const stageKind = /^dunning_[a-z0-9]+$/i.test(String(kind || '')) ? kind : 'dunning_1st';

  const [[s]] = await pool.query(
    `SELECT ps.id, ps.contract_id, ps.customer_name, ps.scheduled_amount,
            COALESCE((SELECT SUM(paid_amount) FROM payment_records WHERE schedule_id = ps.id), 0) AS paid_amount
       FROM payment_schedules ps WHERE ps.id = ?`,
    [parseInt(scheduleId, 10)]
  );
  if (!s) throw new Error('수금 스케줄을 찾을 수 없습니다');

  // 발송 전 안전장치 — 미연결 시 발송/기록 없이 종료
  if (!gmailSvc?.sendMessageWithAttachments || !senderUserId) {
    throw new Error('메일 발송 불가 — Google(Gmail) 미연결. 설정에서 연동 후 다시 시도하세요.');
  }

  const rendered = await previewMessage(scheduleId, stageKind);
  await gmailSvc.sendMessageWithAttachments(senderUserId, {
    to: email,
    subject: rendered.subject,
    bodyText: rendered.body,
    attachments: [],
  });

  const remaining = Number(s.scheduled_amount) - Number(s.paid_amount || 0);
  const [r] = await pool.query(
    `INSERT INTO payment_notifications
       (schedule_id, contract_id, customer_name, kind, amount, channel, recipient, status, sent_at, payload_json, created_by)
     VALUES (?, ?, ?, ?, ?, 'email', ?, 'sent', NOW(), ?, ?)`,
    [
      s.id,
      s.contract_id || null,
      s.customer_name || null,
      stageKind,
      remaining > 0 ? remaining : 0,
      email,
      JSON.stringify({ subject: String(rendered.subject).slice(0, 200), manual: true }),
      senderUserId || null,
    ]
  );
  return { sent: true, to: email, subject: rendered.subject, notification_id: r.insertId };
}

module.exports = {
  POLICY_KEY,
  TEMPLATES_KEY,
  DEFAULT_POLICY,
  DEFAULT_TEMPLATES,
  getPolicy,
  setPolicy,
  getTemplates,
  setTemplates,
  renderTemplate,
  pickStage,
  scanDunning,
  listCurrent,
  summary,
  listHistory,
  previewMessage,
  sendDunning,
};
