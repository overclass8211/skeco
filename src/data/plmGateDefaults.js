'use strict';
// =============================================================
// PLM 스테이지-게이트 기본 정의 (시드값 — 사용자가 화면/ API 로 수정 가능)
//   initTables.js(시드) 에서 INSERT IGNORE 로 1회 주입.
//   gate_key/순서/라벨/매핑은 plm_gates 테이블에서 자유롭게 변경 가능(고정 아님).
//   lifecycle_stage: 기존 6단계(STAGE_ORDER) 매핑 — back-compat 용.
//
//   공정 프로세스(고객 확인): MRD → CRP → DOE → PROTO → SMALL → GALLON → MRP → MP
//     · MRD = 상위 PLM(과제관리)에서 정의되는 시장요구 — 라이프사이클 진입 기준점
//     · CRP~MP = 실행 게이트(스케일업 사다리: 시작품→소량→갤런→양산준비→양산)
//   라벨은 전부 영문 통일. 구 키(ES/CS/QUAL)→신 키(PROTO/SMALL/MRP) 는 GATE_KEY_MIGRATION 으로 무중단 이관.
// =============================================================
const DEFAULT_GATES = [
  {
    gate_key: 'MRD',
    gate_label: 'Market Requirement',
    display_order: 1,
    lifecycle_stage: 'discovery',
  },
  {
    gate_key: 'CRP',
    gate_label: 'Customer Requirement',
    display_order: 2,
    lifecycle_stage: 'discovery',
  },
  {
    gate_key: 'DOE',
    gate_label: 'Design of Experiments',
    display_order: 3,
    lifecycle_stage: 'evaluation',
  },
  { gate_key: 'PROTO', gate_label: 'Prototype', display_order: 4, lifecycle_stage: 'sample' },
  { gate_key: 'SMALL', gate_label: 'Small-lot', display_order: 5, lifecycle_stage: 'sample' },
  { gate_key: 'GALLON', gate_label: 'Gallon-scale', display_order: 6, lifecycle_stage: 'sample' },
  {
    gate_key: 'MRP',
    gate_label: 'Mass-prod Readiness',
    display_order: 7,
    lifecycle_stage: 'specin',
  },
  { gate_key: 'MP', gate_label: 'Mass Production', display_order: 8, lifecycle_stage: 'massprod' },
];

// 구 키 → 신 키 (무중단 이관: plm_gates 정의 + material_gates 진척 일괄)
const GATE_KEY_MIGRATION = { ES: 'PROTO', CS: 'SMALL', QUAL: 'MRP' };

module.exports = { DEFAULT_GATES, GATE_KEY_MIGRATION };
