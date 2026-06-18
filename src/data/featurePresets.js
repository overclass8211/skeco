'use strict';
// =============================================================
// Feature Presets — 고객사 납품용 검증된 패키지 정의
//
// 🎯 목적:
//   - 33개 토글의 80억 조합 → 3개 검증된 패키지로 단순화
//   - 영업/운영자가 안전하게 고객사별 구성 가능
//   - 무작위 조합으로 인한 사이드이펙 방지
//
// 📦 3가지 패키지:
//   - minimal:  CRM 기본만 (가장 안정)
//   - standard: 일반 영업조직 권장 (대부분 고객사)
//   - premium:  모든 기능 활성 (대규모 고객사)
//
// 🔒 잠금 정책 (locked):
//   특정 기능은 변경 불가 — 보안 정책 등 핵심 인프라
//   예: security.csp, security.rate_limit 은 OFF 금지
//
// 사용:
//   POST /api/admin/dev/presets/apply/:preset_key
//   → 해당 프리셋의 모든 토글이 일괄 적용됨 (audit log 자동 기록)
// =============================================================

const FEATURE_PRESETS = {
  // ─── 🌱 Minimal — 가장 안정적인 최소 패키지 ────────────────
  minimal: {
    label: '🌱 Minimal',
    description: 'CRM 기본 기능만 — PoC, 소규모 영업조직, 검증 환경',
    target_audience: '소규모 (1~5명) / PoC / 보수적 도입',
    enabled_features: [
      // CRM 핵심
      'crm.dashboard',
      'crm.pipeline',
      'crm.calendar',
      'crm.board',
      'crm.search',
      'crm.notifications',
      // 데이터
      'data.excel_exp',
      'data.excel_imp',
      'data.bulk_paste',
      // 인증/보안 (필수)
      'auth.otp',
      'security.rate_limit',
      'security.csp',
      'security.encrypt',
      // 다국어
      'i18n.labels',
      // 실시간
      'realtime.ws',
      // 개발자 옵션 (관리자만)
      'dev.options',
    ],
    disabled_features: [
      // AI 기능 (외부 비용 발생 + 학습 곡선)
      'ai.assistant',
      'ai.ocr',
      'ai.intelligence',
      'ai.lead_summary',
      'ai.meeting',
      'ai.token_recharge',
      // Google 통합 (인증 복잡 + 외부 의존성)
      'auth.google',
      'auth.biometric',
      'gmail.read',
      'gmail.send',
      'gmail.sync',
      'crm.meeting_rec',
      // 분석 도구 (학습 필요)
      'crm.reports',
      'crm.report_builder',
      // 이메일 / Webhook
      'email.templates',
      'webhook.system',
      // ERP / PWA
      'erp.integration',
      'pwa.offline',
    ],
  },

  // ─── ⭐ Standard — 일반 영업조직 권장 ───────────────────────
  standard: {
    label: '⭐ Standard (권장)',
    description: 'AI + 검색 + 알림 + 리포트 — 대부분 영업조직에 적합',
    target_audience: '중규모 (5~50명) / 일반 B2B 영업',
    enabled_features: [
      // CRM 전체
      'crm.dashboard',
      'crm.pipeline',
      'crm.calendar',
      'crm.board',
      'crm.search',
      'crm.notifications',
      'crm.reports',
      'crm.report_builder',
      // 데이터
      'data.excel_exp',
      'data.excel_imp',
      'data.bulk_paste',
      // AI 기능
      'ai.assistant',
      'ai.intelligence',
      'ai.lead_summary',
      'ai.meeting',
      'ai.token_recharge',
      // 인증/보안
      'auth.otp',
      'security.rate_limit',
      'security.csp',
      'security.encrypt',
      // 다국어
      'i18n.labels',
      // 실시간
      'realtime.ws',
      // 이메일 템플릿
      'email.templates',
      // 개발자 옵션
      'dev.options',
    ],
    disabled_features: [
      // 외부 OAuth 필요 — 별도 셋업 필요한 기능들
      'auth.google',
      'auth.biometric',
      'gmail.read',
      'gmail.send',
      'gmail.sync',
      'crm.meeting_rec',
      // 명함 OCR (Vision API 별도 키 필요)
      'ai.ocr',
      // 통합 도구
      'webhook.system',
      'erp.integration',
      // PWA
      'pwa.offline',
    ],
  },

  // ─── 💎 Premium — 모든 기능 활성 ──────────────────────────
  premium: {
    label: '💎 Premium',
    description: '모든 기능 활성 + Google 통합 + Webhook + ERP — 대규모 영업조직',
    target_audience: '대규모 (50명+) / 외부 시스템 통합 필요',
    enabled_features: '*', // 모든 기능 ON (매니페스트의 default_enabled 기준)
    disabled_features: [],
  },
};

// ─── 잠금 정책 ────────────────────────────────────────────
// 다음 기능들은 어떤 프리셋에서도 OFF 할 수 없음 (운영 안정성)
const LOCKED_FEATURES = [
  'security.rate_limit', // DDoS 방어
  'security.csp', // XSS 방어
  'security.encrypt', // 민감정보 암호화
  'dev.options', // 관리자가 자기 발 묶기 방지
];

/**
 * 프리셋 적용 시 각 토글의 목표 상태 계산
 * @param {string} presetKey
 * @returns {Map<string, boolean>}  featureKey → enabled 매핑
 */
function buildTargetState(presetKey, allFeatures) {
  const preset = FEATURE_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown preset: ${presetKey}`);

  const target = new Map();
  const allKeys = allFeatures.map(f => f.feature_key);

  if (preset.enabled_features === '*') {
    // Premium — 매니페스트의 default_enabled 기준
    allFeatures.forEach(f => {
      target.set(f.feature_key, true);
    });
  } else {
    // 명시된 ON 목록
    allKeys.forEach(k => target.set(k, false)); // 기본 OFF
    preset.enabled_features.forEach(k => {
      if (allKeys.includes(k)) target.set(k, true);
    });
  }

  // 잠금 기능은 무조건 ON 강제 (운영 안정성)
  LOCKED_FEATURES.forEach(k => {
    if (allKeys.includes(k)) target.set(k, true);
  });

  return target;
}

module.exports = {
  FEATURE_PRESETS,
  LOCKED_FEATURES,
  buildTargetState,
};
