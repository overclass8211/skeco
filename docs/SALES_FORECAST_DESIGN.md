# 매출 포캐스트(FCST) 설계서 — 파이프라인 기반 가중 예측

> 첨부 UI 기획(파이프라인 기반 예상 매출 FCST)을 반영한 설계.
> **R1 핵심 요청**: 마케팅 생산예측 → 수주 → 매출 포캐스트 (예: 삼성전자 납품건).
> 본 설계는 ⚠️ **DB 스키마 변경(컬럼 추가)을 포함**하므로 구현 전 승인 필요.

---

## 1. 설계 원칙 — "최적의 방안" 요약

첨부 UI는 **파이프라인 가중 예측(Weighted Pipeline Forecast)** 의 정석 구조입니다.
SK 요청(생산예측→수주→매출)과 결합하기 위해 **2단계(Phase)** 로 설계합니다.

| Phase | 내용 | 데이터 소스 | 스키마 영향 |
|---|---|---|---|
| **A (이번 구현, 첨부 화면)** | 파이프라인 가중 예측 — 실시간 계산 | 기존 `leads` | 컬럼 2개 추가 (확률) |
| **B (확장)** | 마케팅 생산예측 입력 → 수주 전환 + 월별 스냅샷 | 신규 테이블 2개 | 추가 설계서 별도 |

> 핵심: **별도 forecast 집계 테이블 없이** 기존 파이프라인(`leads`)에서 실시간 계산.
> `leads.amount_krw`(원화 환산액)·`expected_close_date`(예상 완료월)·`stage`(확률)가 이미 존재 → 최소 변경으로 첨부 화면 구현 가능.

---

## 2. 핵심 데이터 모델 — 4개 계열

첨부 차트의 4개 시리즈를 다음과 같이 정의합니다 (월별 버킷 = `expected_close_date`의 월).

| 차트 시리즈 | 정의 | 산출 |
|---|---|---|
| 🟦 **예상 매출** (Best-case) | 진행 중 딜의 예상금액 **전액** | `SUM(amount_krw)` WHERE stage ∈ 진행단계, 예상완료월 = M |
| 🟩 **확정 매출** (Committed) | 수주/계약/매출인식 완료분 | 수주(`stage=won`) + `contracts` + `payment_schedules`(recognized) |
| 🟧 **Weighted FCST** | 예상금액 × **단계 확률** | `SUM(amount_krw × win_probability/100)` |
| ⬜ **전년 예상 매출** | 작년 동기 예측(YoY 비교) | Phase A: 작년 동월 실적/예상 / Phase B: 스냅샷 |

- **Weighted FCST** 가 가장 현실적인 예측치 → 영업 목표 대비 관리의 핵심 지표.
- 통화: `amount_krw`(원화 환산) 기준 합산. NULL이면 `expected_amount` + `fx_rate` fallback (구현 시 정규화).

---

## 3. 확률(Probability) 모델 ⚠️ 스키마 변경

단계별 기본 확률 + 딜별 override 2단계.

### 3-1. 신규 컬럼 (제안)
```sql
-- (1) 단계별 기본 수주확률
ALTER TABLE pipeline_stages
  ADD COLUMN win_probability TINYINT UNSIGNED NULL COMMENT '단계 기본 수주확률(%)' AFTER sort_order;

-- (2) 딜별 확률 override (NULL = 단계 기본값 사용)
ALTER TABLE leads
  ADD COLUMN win_probability TINYINT UNSIGNED NULL COMMENT '딜별 수주확률 override(%)' AFTER stage;
```
> 둘 다 **additive·non-breaking** (기존 동작 영향 없음). `migrations/` 증분 파일로 적용.

### 3-2. 단계별 기본 확률 시드 (편집 가능)
| stage | 라벨 | 기본 확률 |
|---|---|---|
| lead | 리드 발굴 | 10% |
| review | 검토/미팅 | 25% |
| proposal | 제안/견적 | 50% |
| bidding | 입찰 | 65% |
| negotiation | 협상/계약 | 80% |
| won | 수주 완료 | 100% |
| lost / dropped | 실주 / 드롭 | 0% |

- 실효 확률 = `COALESCE(leads.win_probability, pipeline_stages.win_probability, 0)`
- ⚙️ 설정 모달에서 단계별 확률 편집 → 즉시 재계산.

---

## 4. API 설계 (Phase A)

### 4-1. 조회 — `GET /api/forecast`
첨부 화면의 필터를 그대로 매핑.

| 쿼리 파라미터 | 매핑 | 비고 |
|---|---|---|
| `base_month` | 기준 월 (YYYY-MM) | 차트 강조/상세 기준 |
| `compare` | 비교 기준 | `yoy`(전년 동월) / `none` |
| `assignee` | 담당자 | `leads.assigned_to` |
| `business_type` | 사업 구분 | SK 6개 사업영역 |
| `dept` | 부서 구분 | `team_members.team` |
| `region` | 지역 | 국내/해외 |
| `q` | 검색 | 프로젝트명/고객사 |
| `year` | 차트 연도 | 월별 추이 12개월 |

**응답** (`{success, data}` 표준):
```jsonc
{
  "success": true,
  "data": {
    "monthly": [
      { "month": "2026-01", "expected": 5100, "committed": 3300,
        "weighted": 4200, "prev_expected": 5800 }
      // ... 12개월 (단위: 백만원)
    ],
    "summary": {
      "base_month": "2026-06",
      "expected_total": 6600, "committed_total": 3650,
      "weighted_total": 4050, "yoy_pct": 12.3
    },
    "details": [
      { "lead_id": 1, "project_name": "평택 P4 식각가스 C4F6 연간공급",
        "customer": "삼성전자", "business_type": "식각가스", "region": "국내",
        "assignee": "이식각", "expected_amount": 12000, "probability": 65,
        "weighted": 7800, "expected_close_month": "2026-07",
        "last_activity_at": "2026-06-12", "status": "bidding" }
    ]
  }
}
```

### 4-2. 단계 확률 설정 — `GET/PUT /api/forecast/probabilities`
- `GET`: 단계별 현재 확률
- `PUT`: 단계 확률 일괄 저장 (team_lead+ 권한)

### 4-3. (선택) 자동 계산 실행 — `POST /api/forecast/recompute`
- Phase A는 실시간 계산이라 불필요(즉시 반영). Phase B 스냅샷 도입 시 사용.
- PoC에서는 [자동 계산 실행] 버튼 = 데이터 새로고침으로 동작.

---

## 5. UI 설계 (첨부 기획 반영)

### 5-1. 메뉴 배치 ✅ 확정
- **신규 페이지 `forecast`** — **`메인(main)` 섹션 단독 페이지** (대시보드·파이프라인과 동급, display_order 3).
- 라벨: **"매출 포캐스트"** · 권한: team_lead+ (영업 분석)
- `menuDefaults.js`: `{ menu_key:'forecast', section_key:'main', display_order:3 }` (이하 항목 +1)

### 5-2. 화면 레이아웃 (3단)
```
┌─ 헤더: 파이프라인 기반 예상 매출 FCST  [자동계산][내보내기][⚙️설정] ─┐
├─ 필터바: 기준월 | 비교기준 | 담당자 | 사업구분 | 부서구분 | 검색 [초기화][조회] ─┤
├─ 월별 FCST 추이 (Chart.js mixed, 단위 백만원)                       │
│    🟦예상매출(bar) 🟩확정매출(bar) 🟧Weighted FCST(line) ⬜전년(line) │
│    x축 12개월 · 기준월 하이라이트                                    │
├─ 파이프라인 예상 매출 상세 [요약 보기 | 상세 보기]                   │
│    프로젝트명·고객사·사업구분·지역·담당자·예상매출(₩)·확률(%)         │
│    ·Weighted FCST(₩)·예상완료월·최근활동일·상태                     │
└──────────────────────────────────────────────────────────────────┘
```

### 5-3. 컴포넌트 / 재사용
- 차트: **Chart.js**(이미 사용 중) mixed type — `bar` 2 + `line` 2.
- 필터바: 기존 `combobox.js` / `filter-select` 패턴.
- 상세 테이블: 기존 `data-table` 스타일 + 행 클릭 → 리드 상세(파이프라인) 드릴다운.
- 요약/상세 토글: `viewToggle.js` 패턴.
- 내보내기: 기존 `exportHelper`(Excel/CSV).
- 색상: 🟦 `#1664E5` · 🟩 `#16a34a` · 🟧 SK 오렌지 `#F58220` · ⬜ `#B0B6BF`.

### 5-4. 상태 배지(상태 컬럼)
- 진행중(파이프라인 단계 color) / 수주(녹색) / 실주·드롭(회색).

---

## 6. Phase B — 마케팅 생산예측 연계 (R1 본형)

> 삼성전자 납품건처럼 **마케팅이 생산예측(수량)을 먼저 입력 → 수주 전환 → 매출**.
> Phase A 가중예측 위에 "예측 소스"를 추가하는 확장. (별도 설계·승인)

### 6-1. 신규 테이블 (제안 — Phase B에서 승인)
```sql
-- 마케팅 생산예측 (고객 × 품목 × 월)
CREATE TABLE production_forecasts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT, customer_name VARCHAR(200),
  product_id INT,  product_name VARCHAR(150),
  period CHAR(7) COMMENT 'YYYY-MM',
  forecast_qty DECIMAL(15,2), unit VARCHAR(20),
  unit_price DECIMAL(15,2), currency VARCHAR(10) DEFAULT 'KRW',
  expected_revenue DECIMAL(15,2) COMMENT '수량×단가',
  status ENUM('예측','수주전환','취소') DEFAULT '예측',
  converted_lead_id INT NULL COMMENT '수주 전환된 lead',
  ...
);

-- 월별 포캐스트 스냅샷 (전년 비교·추세 정확도)
CREATE TABLE forecast_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_month CHAR(7), target_month CHAR(7),
  expected_krw DECIMAL(18,2), weighted_krw DECIMAL(18,2),
  committed_krw DECIMAL(18,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
- **수주 전환**: 생산예측 행 → 파이프라인 `leads` 생성(자동 연결) → Phase A 가중예측에 자동 편입.
- **전년 예상 매출(⬜)**: Phase A는 작년 실적 근사 → Phase B는 `forecast_snapshots`로 정확한 "그때 예측했던 값" 비교.

---

## 7. 구현 순서 (Phase A)

1. **스키마 마이그레이션** — `migrations/00X_forecast_probability.sql` (컬럼 2개 + 단계확률 시드) ⚠️승인 후
2. **백엔드** — `src/routes/forecast.js` (`GET /api/forecast`, 확률 설정) + `server.js` 라우트 등록
3. **API 헬퍼** — `public/js/api.js` `API.forecast.*`
4. **프론트 페이지** — `public/js/pages/forecast.js` + 메뉴 등록(`menuDefaults.js`)
5. **시드 보강** — 리드 `expected_close_date`를 12개월에 분산(차트가 풍성하게)
6. **검증** — Lint + E2E(`e2e/forecast.spec.js`: 필터·차트·테이블·확률반영)

---

## 8. 결정 사항

1. ✅ **스키마 변경 승인됨**: `pipeline_stages.win_probability`, `leads.win_probability` 2개 컬럼 추가
2. ✅ **메뉴 배치 확정**: 메인(main) 섹션 단독 페이지 "매출 포캐스트"
3. ⏳ **검토 대기 항목** (구현 착수 전 확인):
   - 단계 확률 기본값(§3-2 표) 그대로 적용 여부
   - 단위 정규화: 표시=백만원, 저장=`amount_krw`(원). 기존 시드 `expected_amount`(억)와의 정규화 방식
   - 전년 예상(⬜) 산출: Phase A는 작년 실적 근사 (정밀 비교는 Phase B 스냅샷)
4. **Phase B(마케팅 생산예측 입력 → 수주 전환)**: Phase A 완료 후 별도 설계서로

> 현재 상태: **설계서 검토 단계**. 구현은 사용자 검토 완료 후 착수.
