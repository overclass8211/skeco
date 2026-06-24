# 📊 FCST(포캐스트) 재설계 설계서 — 반도체 수급 기반

> **출처 데이터**: `반도체 포캐스트 로데이터4.xlsx` (고객사 실사용 형식 목업)
> **모델**: MI 수요 → 생산 Capa → FCST 매출 (수요 × Capa 제약 × 판가)
> **확정 결정**: ① 기존 `production_forecasts` **재설계** ② 통화 **$/₩ 토글** ③ 대시보드 위젯 **표시/숨김 MVP**
> **상태**: 📋 사전 설계 — 구현(특히 스키마 변경)은 사용자 승인 후 진행

---

## 1. 비즈니스 모델 (엑셀에서 도출)

```
① MI 수요(일일)        ② 생산 Capa(월)            ③ FCST 매출(월/분기/연)
  수요량(L)              유효Capa = Nameplate×가동률   출하가능 = MIN(수요, 유효Capa)
  판가($/L)                                          기대매출 = 출하가능 × 판가
```

- **입력값(실무자 편집)**: 수요량, 가동률(Utilization), 판가
- **산출값(자동·읽기전용)**: 유효Capa, 공급량(출하가능), 기대매출, 수요충족률
- **단위**: 수량 = L / 매출 = $K / 판가 = $/L  (※ 화면에서 $↔₩ 토글)

> 핵심 불변식: `공급량 = MIN(수요량, 유효Capa)`, `기대매출 = 공급량 × 판가`
> → 공급량·매출은 **저장만 하지 않고 백엔드에서 산출** (일관성 보장).

---

## 2. 데이터 모델 — `production_forecasts` 재설계

### 2-1. 기존 컬럼 (유지)
`id, customer_id, customer_name, product_id, product_name, business_type, period(YYYY-MM), forecast_qty, unit, unit_price, expected_revenue, currency, status, converted_lead_id, assigned_to, note, created_at, updated_at`

### 2-2. 의미 재정의 + 추가 (※ 스키마 변경 — 승인 필요)

| 컬럼 | 변경 | 의미 |
|------|------|------|
| `forecast_qty` | **의미 재정의** | = **수요량(L)** (MI 또는 수기 입력) |
| `supply_qty` | **신규** DECIMAL(15,2) | = **공급량/출하가능 = MIN(수요, 유효Capa)** (산출 캐시) |
| `unit` | 기본값 변경 | `L` (반도체 도메인) — 기존 행은 보존 |
| `currency` | 활용 | `USD` 허용 (기존 KRW 보존) |
| `unit_price` | 유지 | 판가 (currency 기준, 예: $/L) |
| `expected_revenue` | **산식 변경** | = **공급량 × 판가** (기존: 수요×판가) |
| `demand_source` | **신규** VARCHAR(20) DEFAULT 'manual' | `manual` / `market_intel` |
| `region` | **신규(선택)** VARCHAR(40) | 한국/미국/대만 (MI 수요 출처) |

> 기존 더미 행과의 충돌은 §5(시드 정리)에서 처리. `unit`/`currency`는 행별 보존되므로 하위호환.

### 2-3. 신규 테이블 `production_capacity` (제품 × 월) — 승인 필요
```sql
CREATE TABLE IF NOT EXISTS production_capacity (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  product_id    INT NULL,
  product_name  VARCHAR(150) NOT NULL,      -- 조인 키 (제품 마스터 부재 → 명칭 기준)
  period        CHAR(7) NOT NULL,           -- YYYY-MM
  nameplate     DECIMAL(15,2) DEFAULT 0,    -- 설비 기준 능력(L/월)
  utilization   DECIMAL(5,4) DEFAULT 0,     -- 가동률 0~1 (입력값)
  unit          VARCHAR(20) DEFAULT 'L',
  note          TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cap (product_name, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- 유효Capa = nameplate × utilization (산출, 저장 안 함)
```

> 제품 마스터 테이블은 현재 없음(`production_forecasts.product_name` free-text). 본 단계는 **명칭 기준 조인**으로 최소 변경. 정식 `products` 마스터는 후속 검토.

---

## 3. 통화 $/₩ 토글 설계

- 저장: **원본 통화 그대로**(USD). `currency='USD'`, `unit_price`=$/L.
- 표시: 화면 상단 토글 `$ / ₩`. ₩ 선택 시 **환율 설정값**으로 변환.
- 환율: **시스템 설정값**(예: `settings.fx_usd_krw`) — 하드코딩·시크릿 아님(변동치). 미설정 시 $ 고정.
- 모든 표시 숫자는 반올림(`toLocaleString`) — 부동소수 잔재 방지.

---

## 4. 백엔드 설계

### 4-1. 라우트 (`src/routes/productionForecasts.js` 확장 + capa 추가)
| 기능 | 엔드포인트 | 메서드 | 권한 |
|------|-----------|:------:|------|
| 월별 스프레드 집계 (대시보드 메인) | `/api/forecast-sc/monthly` | GET | 로그인 |
| 수요 로데이터 CRUD | `/api/forecast-sc/demand` | GET/POST/PUT/DELETE | manager+ |
| 생산 Capa CRUD | `/api/forecast-sc/capacity` | GET/POST/PUT/DELETE | manager+ |
| 대시보드 KPI 요약 | `/api/forecast-sc/summary` | GET | 로그인 |

> 엔드포인트명은 잠정(`-sc`=supply chain). 기존 `/api/forecast`(파이프라인)·`/api/production-forecasts`는 **보존**.

### 4-2. 월별 집계 산출 (의사코드)
```
for (customer, product, month):
  demand = production_forecasts.forecast_qty
  capa   = production_capacity(product, month).nameplate × utilization
  supply = MIN(demand, capa)
  revenue= supply × unit_price
=> 월별 합계 { demand_L, supply_L, revenue_$K }, 충족률 = supply/demand
```

---

## 5. 시드 통합 / 충돌 처리 (요구사항 5·6)

| 충돌 | 처리 |
|------|------|
| 고객명 Samsung↔삼성전자 | **매핑표**: Samsung→삼성전자, SK hynix→SK하이닉스. 미존재(Micron/TSMC/Intel)는 신규 등록 |
| 제품 (포토레지스트 계열) | 엑셀 5개 제품을 `production_forecasts`/`production_capacity`에 명칭 기준 시드 |
| 단위 L / 통화 USD | 신규 시드 행은 `unit='L'`, `currency='USD'` |
| 기존 생산예측 더미 | **고아·불일치 더미 정리** — 삭제 전 "대상 건수/내용" 보고 후 진행 |

- 엑셀 시트 → 시드 스크립트(`scripts/seed-fcst-semicon.js`)로 일괄 적재 (수요·Capa).

---

## 6. 프론트 설계

### 6-1. FCST 대시보드 (영업사원 기본 화면)
- **메인 그래프(고정)**: 월별 **수요량·공급량(L, 막대) vs 기대매출($K, 라인)** — 이중축.
- **위젯(표시/숨김 MVP)**: 충족률, 분기 요약, 고객 Top, 제품 믹스 등 — 체크박스 on/off, 설정은 `localStorage`(스키마 0).
- **로데이터 접기**: 메인 그래프 아래 collapse 테이블 — [FCST 월별 스프레드] 구조. 지표 토글(수요/공급/매출) + 가로 스크롤.
- 상단: `$/₩` 통화 토글.

### 6-2. 생산 Capa 페이지 (실무자)
- 제품 × 월 그리드. **가동률·Nameplate 인라인 편집**. 유효Capa 자동 표시(읽기전용).

### 6-3. FCST 매출 페이지 (실무자)
- 고객 × 제품 × 월. **수요량·판가 인라인 편집**. 공급량·매출 자동 산출(읽기전용). 출처(MI/수기) 배지.

> 4번(군더더기 없이): 영업사원=대시보드만, 실무자=Capa/매출 편집. RBAC로 편집 권한 분리.

---

## 7. 단계적 진행안 (각 Phase 독립 커밋)

| Phase | 내용 | 스키마 | 위험 |
|-------|------|:-----:|:----:|
| **1** | 스키마 재설계(`production_forecasts` 컬럼 + `production_capacity`) + 백엔드 집계 | ✅ | 中 |
| **2** | 엑셀→시드 스크립트 + 기존 더미 정리(보고 후) | ❌ | 中 |
| **3** | FCST 대시보드(메인 그래프 + 위젯 토글 + 접기 + $/₩) | ❌ | 低 |
| **4** | 생산 Capa / FCST 매출 편집 페이지 | ❌ | 低 |

- **Phase 1·2** 가 DB·데이터를 건드림 → 착수 전 별도 승인. 정리 대상 더미는 사전 보고.

---

## 8. 테스트 계획 (CLAUDE.md 준수)
| 대상 | 종류 |
|------|------|
| MIN(수요,Capa)·매출 산식, $/₩ 환산 | Vitest + supertest |
| 시드 정합성(고객 매핑·중복 방지) | Vitest |
| 대시보드 그래프·접기·위젯 토글 | Playwright E2E |

---

## 9. 확인 필요
1. 환율(`fx_usd_krw`) 기준값 — 누가 어디서 관리할지(설정 화면 vs 고정).
2. 기존 `production_forecasts` 더미 정리 범위 — Phase 2 착수 시 실제 건수 보고 후 확정.
3. 정식 제품 마스터(`products`) 도입 시점 — 본 설계는 명칭 기준, 후속 검토.

> 본 문서는 사전 설계이며, 구현은 사용자 승인 후 진행한다. (특히 Phase 1 스키마)
