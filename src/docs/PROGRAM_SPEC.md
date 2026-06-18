# 📐 프로그램 명세서 (Program Specification)

> **버전**: v5.0 | **대상**: 개발자

---

## 1. 시스템 구성도

```
[Browser] ──HTTPS──▶ [Nginx] ──▶ [Node.js :3000] ──▶ [MariaDB :3306]
                                       │
                                       ├──▶ [Google APIs (OAuth/Calendar/Meet/Gmail)]
                                       ├──▶ [Gemini AI (Flash/Pro)]
                                       └──▶ [Kakao Map]
```

---

## 2. 모듈 구조

### 2.1 백엔드 (src/)

#### routes/ — REST API (27개)
| 파일 | Prefix | 권한 | 주요 기능 |
|------|--------|------|----------|
| `auth.js` | `/api/auth` | Public | login, refresh, logout, OTP, WebAuthn |
| `dashboard.js` | `/api/dashboard` | Auth | KPI, 펀넬, 월별 통계 |
| `leads.js` | `/api/leads` | Auth | 리드 CRUD + 대량 등록 + 내보내기 |
| `customers.js` | `/api/customers` | Auth | 고객사 CRUD + OCR + AI 인텔리전스 |
| `projects.js` | `/api/projects` | Auth | 프로젝트 CRUD |
| `activities.js` | `/api/activities` | Auth | 활동 이력 |
| `calendar.js` | `/api/calendar` | Auth | 일정 CRUD + Google 동기화 |
| `meetings.js` | `/api/meetings` | Auth | STT 동기/비동기 |
| `ai.js` | `/api/ai` | Auth | 챗봇 SSE, 브리핑, 요약 |
| `google.js` | `/api/google` | Auth | OAuth, Calendar, Meet |
| `gmail.js` | `/api/gmail` | Auth | 읽기/발송/동기화 |
| `notifications.js` | `/api/notifications` | Auth | 실시간 알림 |
| `search.js` | `/api/search` | Auth | 글로벌 검색 |
| `board.js` | `/api/board` | Auth | 공지/FAQ/댓글 |
| `admin.js` | `/api/admin` | Level 3+ | 사용자, 토큰, 통계, 기능플래그 |
| `admin-labels.js` | `/api/admin/labels` | Level 4+ | 다국어 라벨 |
| `logo.js` | `/api/system/logo`, `/admin/logo` | Public+L4 | 로고 관리 |
| `report-builder.js` | `/api/report-builder` | Level 2+ | 사용자 정의 리포트 |
| `email-templates.js` | `/api/email-templates` | Auth | 메일 템플릿 |
| `webhooks.js` | `/api/webhooks` | Auth | 외부 알림 |
| `team.js` | `/api/team` | Level 2+ | 팀 현황 |
| `products.js` | `/api/products` | Auth | 상품/원가 |
| `healthmap.js` | `/api/admin` | Level 4 | 시스템 상태 |
| `pipeline-stages.js` | `/api/pipeline/stages` | Auth | 단계 정의 |
| `menu.js`, `menu-config.js` | `/api/menu` | Auth/L4 | 메뉴 구조 |
| `schema-export.js` | `/api/admin/dev/schema` | L5 | DB 스키마 |
| `exchange.js` | `/api/exchange` | Auth | 환율 (FX) |

#### services/ — 비즈니스 로직
| 파일 | 역할 |
|------|------|
| `authService.js` | JWT, bcrypt, TOTP, WebAuthn, Token Blacklist |
| `gemini.js` | Gemini SDK 래퍼, SSE, 토큰 로깅 |
| `stt.js` | 음성→텍스트 (inline <10MB / Files API ≥10MB) |
| `sttJobs.js` | 비동기 STT 큐 (in-memory, 25분 watchdog) |
| `gmail.js` | Gmail API 래퍼 (G1+G2) |
| `gmailSync.js` | 5분 cron 동기화 (G3) |
| `webhookDispatcher.js` | 외부 webhook 발송 |

#### middleware/
| 파일 | 역할 |
|------|------|
| `auth.js` | `getUserId(req)` 헬퍼 |
| `rbac.js` | JWT 검증 + autoLevel 권한 체크 |
| `errorHandler.js` | 통합 에러 처리 + 접근 로그 |
| `featureGuard.js` | 토글 OFF 시 403 차단 + 5초 캐시 |
| `upload.js` | Multer (일반/메모리/오디오/로고) |
| `rateLimit.js` | DDoS 방어 |
| `validate.js` | ID/스키마 검증 |

#### data/ — 정적 설정
| 파일 | 역할 |
|------|------|
| `labelDefaults.js` | 4개국어 라벨 시드 |
| `featureRegistry.js` | 33개 기능 플래그 매니페스트 (SSOT) |
| `featurePresets.js` | Minimal/Standard/Premium 패키지 |
| `menuDefaults.js` | 사이드바 메뉴 시드 |
| `emailTemplateDefaults.js` | 이메일 템플릿 시드 (5개) |

#### utils/
| 파일 | 역할 |
|------|------|
| `routeHelper.js` | parsePage, pageResult, asyncRoute |
| `exportHelper.js` | xlsx/csv 변환 |
| `excelHelper.js` | xlsx 파서 |
| `logoCache.js` | 로고 URL 60초 캐시 |

### 2.2 프론트엔드 (public/)

#### js/pages/ — 17개 페이지 모듈
| 파일 | 페이지 ID | 기능 |
|------|----------|------|
| `dashboard.js` | `dashboard` | KPI + 차트 |
| `pipeline.js` | `pipeline` | 칸반 보드 |
| `leads.js` | `leads` | 리드 CRUD |
| `customers.js` | `customers` | 고객사 카드/목록 |
| `projects.js` | `projects` | 프로젝트 |
| `calendar.js` | `calendar` | FullCalendar |
| `meeting.js` | `meeting` | 녹음 + STT |
| `meeting-list.js` | `meeting-list` | 회의록 목록 |
| `team.js` | `team` | 팀 현황 |
| `reports.js` | `reports` | 4종 차트 |
| `report-builder.js` | `report-builder` | Drag&Drop |
| `board.js` | `board` | 공지/FAQ |
| `cost.js` | `cost` | 원가 관리 |
| `orders.js` | `orders` | 주문 (예약) |
| `settings.js` | `settings` | 사용자 설정 + 로고 |
| `admin.js` | `admin` | 관리자 콘솔 |
| `dev.js` | `dev` | 개발자 옵션 |

#### js/ — 공통 모듈
| 파일 | 역할 |
|------|------|
| `app.js` | SPA 라우터 + Features + 공통 모달 |
| `api.js` | API 클라이언트 + Circuit Breaker |
| `utils.js` | Fmt, Modal, Toast, Theme |
| `labels.js` | 다국어 모듈 (sessionStorage 캐시) |
| `offlineQueue.js` | IndexedDB 오프라인 큐 |
| `search.js` | Cmd+K 글로벌 검색 |
| `ai.js` | AI 어시스턴트 패널 + Notifications |
| `login.js` | 로그인 화면 |
| `email.js` | 이메일 발송 모달 |

---

## 3. 주요 처리 흐름

### 3.1 회의록 STT (비동기, 120분 대응)

```
[1] Browser MediaRecorder → WebM Blob
[2] POST /api/meetings/transcribe-async (multipart)
[3] Multer → public/uploads/{uuid}
[4] sttJobs.enqueue() → jobId 즉시 반환
[5] (async) sttService:
    파일 < 10MB → Gemini inline base64
    파일 ≥ 10MB → Gemini Files API 업로드
[6] Gemini.generateContent (화자분리 프롬프트)
[7] JSON 파싱 → sttJobs.complete(jobId, result)
[8] Browser 폴링: GET /api/meetings/transcribe-status/:jobId
[9] 완료 시 → POST /api/meetings (DB INSERT)
```

### 3.2 Gmail 자동 동기화 (G3)

```
[Cron 5min] → gmailSync.pollAll()
[Feature Gate] gmail.sync OFF면 skip
[Each user] gmail_sync_enabled=1 사용자별 pollOne()
  → gmail.users.messages.list(after:lastPolled)
  → 메시지 메타 fetch
  → customers.email 매칭
  → activities INSERT (gmail_message_id UNIQUE)
  → gmail_last_polled_at 갱신
```

### 3.3 기능 토글 (Configuration Preset)

```
[Manager] 개발자옵션 > 📦 패키지 적용 > "Standard"
[POST /api/admin/dev/presets/standard/apply]
  → buildTargetState() — 33개 토글 목표 상태 계산
  → 잠금 기능 (security.*) 강제 ON
  → DB 일괄 UPDATE
  → audit log 일괄 INSERT
  → featureGuard.invalidate()
[Frontend]
  → Features.load() 재호출 + apply()
  → 모든 사용자에게 즉시 반영
```

### 3.4 로고 업로드 (자동 최적화)

```
[POST /api/admin/logo/upload] (multipart)
  ↓
[Magic Bytes 검증] PNG/JPEG/SVG 헤더 확인 → 불일치 시 거부
  ↓
[Sharp 최적화 — PNG/JPG]
  - limitInputPixels: 25M (Image Bomb 방어)
  - trim({threshold:10}) — 여백 자동 제거
  - resize(600, 200, fit:inside, withoutEnlargement)
  - png(quality:90, compression:9)
  ↓
[SVG sanitize — svgo]
  - removeScriptElement
  - removeAttrs (on.*)
  - multipass 압축
  ↓
[이전 로고 파일 삭제]
[system_settings UPSERT (logo_path)]
[logoCache.invalidate()]
[응답: original/optimized/savings/dimensions]
```

---

## 4. 데이터 흐름 (DFD)

### 4.1 컨텍스트 다이어그램

```
[User] ─────➤ [CRM Web] ◀──── [Admin]
                  │
                  ▼
            [MariaDB DB]
                  │
                  ├─➤ [Google APIs]
                  ├─➤ [Gemini AI]
                  └─➤ [Kakao Map]
```

### 4.2 주요 데이터 흐름 (1-level)

```
User → 1.0 Auth → JWT
User → 2.0 Leads CRUD ⇄ DB
User → 3.0 STT Upload → 3.1 Gemini → Transcript
       3.2 AI Summary → DB
User → 4.0 Gmail Match → DB.activities
Admin → 5.0 Feature Toggle → DB.dev_features
```

---

## 5. 함수/메서드 명세 (대표)

### 5.1 authService.js#login(username, password)
```typescript
async function login(username: string, password: string):
  Promise<{
    token: string,        // JWT (15분)
    refreshToken: string, // opaque, DB 저장
    user: { id, role, pages },
    requireOtp?: boolean,
  }>
```

### 5.2 sttService.js#transcribeAudio(filePath, mimeType, size)
```typescript
async function transcribeAudio(
  filePath: string,
  mimeType: string,
  size: number
): Promise<{
  transcript: string,
  speakers: Array<{ speaker: string, text: string }>,
  duration_sec: number,
}>
```

### 5.3 featureGuard.js#requireFeature(featureKey, options)
```typescript
function requireFeature(
  featureKey: string,
  options?: { warnOnly?: boolean }
): RequestHandler
// → 토글 OFF 시 403 + FEATURE_DISABLED
// → warnOnly: 로그만 (점진 도입용)
```

### 5.4 reportBuilder._renderFeatureBody()
필터/정렬 적용 후 본문 재렌더링. 카테고리별 그룹 또는 평면.

---

## 6. 에러 처리

### 6.1 표준 에러 응답
```json
{
  "success": false,
  "error": "메시지",
  "code": "ERROR_CODE",
  "field": "필드명 (선택)"
}
```

### 6.2 에러 코드
- `VALIDATION_ERROR` — 입력 검증 실패
- `AUTH_FAILED` — 로그인 실패
- `TOKEN_EXPIRED` / `TOKEN_INVALID`
- `PERMISSION_DENIED` — RBAC
- `FEATURE_DISABLED` — featureGuard
- `API_KEY_INVALID` — Gemini
- `OAUTH_INVALID_GRANT` — Google
- `RATE_LIMIT` — 429
- `DB_DISCONNECTED` — 503

---

> 본 명세서는 모듈 변경 시 함께 갱신됩니다.
