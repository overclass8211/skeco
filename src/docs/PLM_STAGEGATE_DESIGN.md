# 🏁 PLM 스테이지-게이트(공정 라이프사이클) 도입 설계서

> **배경**: 타 프로토타입(FLAX) 대시보드의 공정 라이프사이클 — 프로젝트(소재 개발)별 **MRD → CRP → DOE → … → MP** 게이트를 **목표일 라벨 + 타임라인**으로 표시.
> **목표**: 우리 360뷰의 6단계 라이프사이클 위에 **게이트(날짜 보유) 레이어**를 얹어 동일한 스테이지-게이트 추적 제공.
> **상태**: 📋 사전 설계 — 구현(스키마)은 사용자 승인 후. 일부 게이트는 사진 우측 잘림으로 **추정(확인 필요)**.

---

## 1. 현재 vs FLAX 비교

| 구분 | 현재 우리 시스템 | FLAX(사진) |
|------|-----------------|------------|
| 단위 | `customer_materials.lifecycle_stage` (소재별 현재 단계) | 프로젝트(소재 개발)별 게이트 진행 |
| 단계 | 6개: 발굴·샘플·평가·Spec-in·양산·납품 (코드 `STAGE_ORDER`) | MRD·CRP·DOE·…·MP (게이트) |
| 날짜 | 없음(현재 단계 enum만) | **게이트별 목표일**(MRD 2025-11-10, CRP 2025-12-15 …) |
| 표현 | 보드/분포 | **타임라인 슬라이더 + 목표일 + 현재 게이트** |

→ 우리는 "현재 단계"만, FLAX는 "게이트별 날짜+진척". 이 **날짜·타임라인**이 핵심 보강 포인트.

## 2. 게이트 정의 (추정 — 설정형으로 관리)

| 순서 | gate_key | 라벨(추정) | 매핑(기존 lifecycle_stage) | 확신도 |
|:--:|------|------|------|:--:|
| 1 | `MRD` | 시장요구 정의 (Market Requirement) | discovery | ✅ 사진 |
| 2 | `CRP` | 컨셉검토/고객요구 (Concept/Customer Req. Plan) | discovery | ✅ 사진 |
| 3 | `DOE` | 실험계획 (Design of Experiments) | evaluation | ⚠️ "DO…" 잘림 — DOE 유력 |
| 4 | `ES` | 엔지니어링 샘플 | sample | ⚠️ 추정 |
| 5 | `CS` | 고객 샘플 제출 | sample | ⚠️ 추정 (사진 "샘플 2종 제출 완료") |
| 6 | `QUAL` | 승인/규격등록 (Spec-in/Qualification) | specin | ⚠️ 추정 |
| 7 | `MP` | 양산 (Mass Production) | massprod | ⚠️ 추정 |

> ⚠️ 3~7은 사진 우측 잘림으로 미확정 → **게이트 정의를 DB/설정으로 관리**하여 확정 시 코드 변경 없이 조정. 사진 우측 펼친 캡처 확보 시 라벨/순서 즉시 교정.

## 3. 데이터 모델 (※ 스키마 변경 — 승인 필요)

### 3-1. `plm_gates` (게이트 정의/설정 — 시드 + 관리자 조정)
```sql
CREATE TABLE IF NOT EXISTS plm_gates (
  gate_key        VARCHAR(20) PRIMARY KEY,
  gate_label      VARCHAR(60) NOT NULL,
  display_order   INT DEFAULT 0,
  lifecycle_stage VARCHAR(20) NULL,   -- 기존 6단계 매핑(back-compat)
  is_active       TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3-2. `material_gates` (소재별 게이트 진척 — 날짜 보유)
```sql
CREATE TABLE IF NOT EXISTS material_gates (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  customer_material_id INT NOT NULL,
  gate_key             VARCHAR(20) NOT NULL,
  target_date          DATE NULL,     -- 목표일 (FLAX의 MRD/CRP 날짜)
  actual_date          DATE NULL,     -- 실제 완료일
  status               VARCHAR(20) DEFAULT 'pending', -- pending|in_progress|done|skipped
  note                 TEXT,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mg (customer_material_id, gate_key),
  INDEX idx_mg_mat (customer_material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 기존 `customer_materials.lifecycle_stage`는 **유지**(6단계 보드·exec-summary 호환). 게이트는 그 하위 세분화 + 날짜. `current_gate`는 `material_gates` 중 `status='in_progress'`(없으면 마지막 done 다음)로 산출.

## 4. 백엔드 설계
| 기능 | 엔드포인트 | 비고 |
|------|-----------|------|
| 게이트 정의 조회 | `GET /api/customer360/gates` | plm_gates (active, order) |
| 소재 게이트 타임라인 | `GET /api/customer360/:id` 응답에 `materials[].gates[]` 포함 | target/actual/status + current_gate |
| 게이트 업서트 | `PUT /api/customer360/materials/:mid/gates/:gateKey` | target_date/actual_date/status 인라인 편집 |

- `lifecycle_stage` 자동 동기화(선택): 특정 게이트 `done` 시 매핑된 stage로 승급(예: CS done → sample, QUAL done → specin). 규칙은 plm_gates.lifecycle_stage 기반.

## 5. 프론트 설계 (360 소재 보드)
- 각 소재 카드에 **게이트 타임라인**: `MRD──CRP──DOE──ES──CS──QUAL──MP` (FLAX와 동일한 가로 슬라이더)
  - 각 게이트: 목표일 라벨 + 상태색(완료/진행/예정) + 현재 게이트 강조
  - 지연(목표일 경과 & 미완료) 게이트 빨강 경고
- 기존 6단계 보드는 보존(상위 요약), 게이트는 펼침/상세.

## 6. 단계적 진행안
| Phase | 내용 | 스키마 | 위험 |
|-------|------|:----:|:--:|
| **1** | plm_gates·material_gates 스키마 + 시드(7게이트) + 백엔드(조회/업서트) + 데모 게이트 날짜 | ✅ | 中 |
| **2** | 360 소재 보드 게이트 타임라인 UI(목표일·현재게이트·지연경고) | ❌ | 低 |
| **3** | 게이트 done → lifecycle_stage 자동 동기화 + 지연 게이트 대시보드 KPI | ❌ | 低 |

- **Phase 1** 만 스키마 변경 → 착수 전 승인. 게이트 라벨/순서는 사진 우측 확인 후 시드 조정.

## 7. 테스트 계획
| 대상 | 종류 |
|------|------|
| 게이트 업서트·current_gate 산출·stage 동기화 규칙 | Vitest + supertest |
| 360 응답 materials[].gates 구조 | Vitest |
| 게이트 타임라인 렌더·인라인 편집·지연경고 | Playwright E2E |

## 8. 확인 필요
1. **사진 우측 잘린 게이트**(DOE 이후 ~ MP) 정확한 라벨/개수 — 펼친 캡처 1장.
2. MRD/CRP가 "게이트 목표일"이 맞는지(사진상 날짜라벨 → 목표일로 가정).
3. 게이트↔기존 6단계 매핑 확정(§2 표) — 운영 정의와 대조.

> 본 문서는 사전 설계이며, 구현(특히 Phase 1 스키마)은 사용자 승인 후 진행한다.
