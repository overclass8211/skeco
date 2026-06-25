'use strict';
// =============================================================
// PLM 스테이지-게이트 기본 정의 (시드값 — 사용자가 화면/ API 로 수정 가능)
//   initTables.js(시드) 에서 INSERT IGNORE 로 1회 주입.
//   gate_key/순서/라벨/매핑은 plm_gates 테이블에서 자유롭게 변경 가능(고정 아님).
//   lifecycle_stage: 기존 6단계(STAGE_ORDER) 매핑 — back-compat 용.
//   ⚠️ DOE~MP 는 FLAX 사진 우측 잘림으로 추정 → 확정 시 무중단 교정.
// =============================================================
const DEFAULT_GATES = [
  { gate_key: 'MRD', gate_label: '시장요구 정의', display_order: 1, lifecycle_stage: 'discovery' },
  { gate_key: 'CRP', gate_label: '컨셉·고객요구', display_order: 2, lifecycle_stage: 'discovery' },
  { gate_key: 'DOE', gate_label: '실험계획(DOE)', display_order: 3, lifecycle_stage: 'evaluation' },
  { gate_key: 'ES', gate_label: '엔지니어링 샘플', display_order: 4, lifecycle_stage: 'sample' },
  { gate_key: 'CS', gate_label: '고객 샘플', display_order: 5, lifecycle_stage: 'sample' },
  { gate_key: 'QUAL', gate_label: '승인·Spec-in', display_order: 6, lifecycle_stage: 'specin' },
  { gate_key: 'MP', gate_label: '양산', display_order: 7, lifecycle_stage: 'massprod' },
];

module.exports = { DEFAULT_GATES };
