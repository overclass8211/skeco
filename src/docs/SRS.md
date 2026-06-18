# 📋 SRS — 소프트웨어 요구사항 명세서

> **프로젝트**: OCI CRM AI
> **버전**: v5.0 (2026.05)
> **문서 종류**: Software Requirements Specification

---

## 1. 개요

### 1.1 목적
OCI(태양광·EPC) 영업 조직의 영업 활동 전반을 디지털화하고, AI 기반 자동화로 영업 생산성을 극대화하는 통합 CRM 시스템.

### 1.2 범위
- 영업 리드 → 견적 → 수주 → 프로젝트 전과정 관리
- AI 어시스턴트 + 회의록 자동화 (STT)
- Google 워크스페이스 통합 (Calendar / Meet / Gmail)
- 모바일 PWA + 오프라인 지원
- 다국어 (한/영/일/중) + 다크모드
- 5단계 RBAC 권한 관리

### 1.3 대상 사용자
| 역할 | 인원 | 주요 활동 |
|------|------|----------|
| **매니저** (영업담당) | 50명+ | 리드 등록/관리, 활동 기록, 회의록 |
| **팀장** (Team Lead) | 5~10명 | 팀 분석, 리포트 |
| **경영진** | 3~5명 | 대시보드, 종합 리포트 |
| **IT운영자** | 1~2명 | 시스템 설정, 사용자 관리 |
| **Superadmin** | 1명 | 기능 플래그, 개발자 옵션 |

---

## 2. 기능 요구사항

### 2.1 영업 관리 (F-CRM)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-CRM-001 | 영업 리드 CRUD + 8단계 파이프라인 (lead→won) | 필수 |
| F-CRM-002 | 드래그&드롭 칸반 보드 | 필수 |
| F-CRM-003 | 고객사 관리 (담당자, 연락처, 지역, 산업군) | 필수 |
| F-CRM-004 | 프로젝트 관리 (수주 후, 계약/원가/마진/납기) | 필수 |
| F-CRM-005 | 활동 이력 (미팅/전화/이메일 자동 기록) | 필수 |
| F-CRM-006 | 캘린더 (FullCalendar, Google Calendar 동기화) | 필수 |
| F-CRM-007 | 대시보드 (5대 KPI, 펀넬, 월별 추이) | 필수 |
| F-CRM-008 | 리포트 (매출/원가/리드/팀 4종 차트) | 필수 |
| F-CRM-009 | 리포트 빌더 (Drag&Drop) | 권장 |
| F-CRM-010 | 글로벌 검색 (Cmd+K, 5개 카테고리) | 필수 |
| F-CRM-011 | 알림 시스템 (마감/입찰/일정 자동) | 필수 |

### 2.2 AI 기능 (F-AI)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-AI-001 | AI 어시스턴트 챗봇 (Gemini 스트리밍) | 필수 |
| F-AI-002 | 고객사 AI 브리핑 (자동 영업 인사이트) | 필수 |
| F-AI-003 | 회의록 STT (최대 120분, 화자분리) | 필수 |
| F-AI-004 | AI 회의록 요약 + 액션 아이템 추출 | 필수 |
| F-AI-005 | 명함 OCR (Google Vision) | 권장 |
| F-AI-006 | 리드 활동 이력 AI 자동 요약 | 권장 |
| F-AI-007 | AI 토큰 한도 + 자동충전 | 필수 |

### 2.3 외부 통합 (F-INT)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-INT-001 | Google OAuth 2.0 로그인 + Calendar/Meet/Gmail scope | 필수 |
| F-INT-002 | Google Meet 미팅 링크 생성 | 필수 |
| F-INT-003 | Gmail 메일 자동 매칭 (G1) | 필수 |
| F-INT-004 | Gmail 직접 발송 (G2) | 필수 |
| F-INT-005 | Gmail 백그라운드 동기화 (G3, 5분 주기) | 필수 |
| F-INT-006 | Kakao Map 주소 검색 | 권장 |
| F-INT-007 | Webhook 시스템 (외부 알림 발송) | 권장 |
| F-INT-008 | ERP 연동 (OnERP/가온아이) | 선택 (실험) |

### 2.4 시스템 관리 (F-ADM)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-ADM-001 | 사용자 관리 (5단계 RBAC) | 필수 |
| F-ADM-002 | 기능 토글 (33개, 매니페스트 자동 동기화) | 필수 |
| F-ADM-003 | 토글 의존성 검증 + Audit Log | 필수 |
| F-ADM-004 | Configuration Preset (3개 패키지) | 필수 |
| F-ADM-005 | 워드 사전 (다국어 라벨 커스터마이즈) | 필수 |
| F-ADM-006 | 로고 관리 (Sharp + svgo 자동 최적화) | 필수 |
| F-ADM-007 | 메뉴 구조 커스터마이즈 | 권장 |
| F-ADM-008 | AI 토큰 모니터링 | 필수 |
| F-ADM-009 | 시스템 설정 (idle timeout, 기본 토큰 한도) | 필수 |
| F-ADM-010 | 접근 로그 + 자동 정리 (90일) | 필수 |

### 2.5 인증/보안 (F-SEC)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-SEC-001 | JWT Access Token (15분 만료) | 필수 |
| F-SEC-002 | Refresh Token (7일, DB 저장, rotation) | 필수 |
| F-SEC-003 | bcrypt 비밀번호 해싱 | 필수 |
| F-SEC-004 | TOTP 2FA (Google Authenticator) | 필수 |
| F-SEC-005 | WebAuthn (생체인증) | 권장 |
| F-SEC-006 | AES-256-GCM 암호화 (OAuth 토큰, OTP secret) | 필수 |
| F-SEC-007 | Helmet CSP + Rate Limit | 필수 |
| F-SEC-008 | RBAC API Level Map | 필수 |
| F-SEC-009 | Token Blacklist (즉시 무효화) | 필수 |

### 2.6 PWA / 모바일 (F-PWA)

| ID | 기능 | 우선순위 |
|----|------|----------|
| F-PWA-001 | PWA Manifest + Service Worker | 필수 |
| F-PWA-002 | 오프라인 폴백 페이지 | 필수 |
| F-PWA-003 | 오프라인 회의록 녹음 (IndexedDB 큐) | 필수 |
| F-PWA-004 | 온라인 복귀 시 자동 동기화 | 필수 |
| F-PWA-005 | 모바일 햄버거 메뉴 + 16px input 폰트 | 필수 |
| F-PWA-006 | Service Worker 캐시 자동 갱신 | 필수 |

---

## 3. 비기능 요구사항

### 3.1 성능
- API 응답 시간 95th percentile < 500ms
- 페이지 초기 로딩 < 2초
- 동시 사용자 100명 (피크) 지원
- AI 응답 (스트리밍): 첫 토큰 < 2초

### 3.2 가용성
- 시스템 가용성 99.5% (월 다운타임 < 3.6시간)
- 무중단 배포 (PM2 cluster reload)
- 자동 헬스체크 (GET /api/health)

### 3.3 보안
- HTTPS 강제 (HSTS)
- 모든 입력 SQL Injection 방어 (parameterized)
- XSS 방어 (Helmet CSP + escape)
- CSRF 방어 (HttpOnly + SameSite=Lax)
- 민감정보 AES-256 암호화

### 3.4 확장성
- 수평 확장: Redis 도입 시 가능 (현재 인메모리)
- DB 읽기 분산: Read Replica 지원 가능 구조
- CDN: 정적 자원 외부화 가능

### 3.5 호환성
- **브라우저**: Chrome 100+, Safari 16+, Edge 100+, Firefox 100+
- **모바일**: iOS Safari 16+ / Android Chrome 100+
- **OS**: Ubuntu 22.04+ / Debian 11+ (서버)

### 3.6 국제화
- 4개 언어 (한/영/일/중)
- 워드 사전으로 사용자 정의 라벨 가능
- UTF-8 (MariaDB utf8mb4)

### 3.7 접근성
- WCAG 2.1 AA 부분 준수
- 다크모드 (시스템 자동 + 수동 토글)
- 키보드 단축키 (Cmd+K)

---

## 4. 제약사항

### 4.1 기술 제약
- **백엔드 언어**: Node.js 20 LTS
- **DB**: MariaDB 11 (MySQL 8 호환)
- **프론트엔드**: Vanilla JS (프레임워크 미사용 — 의존성 최소화 정책)
- **AI**: Google Gemini 2.5 (Flash/Pro)

### 4.2 외부 의존성
- Google Cloud Console (OAuth 2.0 클라이언트)
- Google AI Studio (Gemini API Key)
- Kakao Developers (지도 — 선택)

### 4.3 라이선스
- 내부 사용 (OCI 영업조직 전용)
- 향후 다중 고객사 납품 가능 (Configuration Preset 지원)

---

## 5. 가정 및 의존성

### 5.1 가정
- 사용자는 사내 네트워크 또는 VPN 환경에서 접속
- 관리자가 Google OAuth 설정 완료 후 사용
- 영업조직이 Gmail/Calendar 를 일상적으로 사용

### 5.2 외부 의존성
- Google API 가용성 (99.95% SLA)
- Gemini API quota (분당 60 RPM, 일일 1500 토큰)
- 내부 SMTP (선택 — Gmail OAuth로 대체)

---

## 6. 인터페이스 요구사항

### 6.1 사용자 인터페이스
- 사이드바(220px) + 메인 영역 레이아웃
- OCI Red (#E63329) 메인 컬러
- Noto Sans KR + IBM Plex Mono
- 반응형 (1100px 이하 자동 축소)

### 6.2 외부 시스템 인터페이스
| 시스템 | 프로토콜 | 용도 |
|--------|---------|------|
| Google Calendar | OAuth 2.0 + REST | 일정 동기화 |
| Google Meet | OAuth 2.0 + REST | 미팅 링크 생성 |
| Gmail | OAuth 2.0 + REST | 메일 읽기/발송 |
| Gemini AI | API Key + REST/SSE | AI 추론 |
| Kakao Map | JavaScript SDK | 주소 검색 |

---

## 7. 향후 확장 영역

| 구분 | 기능 |
|------|------|
| **Phase 5** (단기) | G4 Outlook 통합, Web Push 알림 |
| **Phase 6** (중기) | Redis 분산 큐, Native 모바일 앱 |
| **Phase 7** (장기) | Multi-tenancy, BI 도구 연동 |

---

## 📎 부록: 산출물 추적성

| 요구사항 ID | 코드 구현 위치 | 테스트 |
|-----------|--------------|--------|
| F-CRM-001 | `src/routes/leads.js` | `tests/leads.test.mjs` |
| F-AI-001 | `src/routes/ai.js#chat` | `tests/ai.test.mjs` |
| F-AI-003 | `src/services/stt.js`, `sttJobs.js` | `tests/meetings.test.mjs` |
| F-INT-003~005 | `src/routes/gmail.js`, `services/gmailSync.js` | `tests/gmail.test.mjs` |
| F-ADM-002~004 | `src/data/featureRegistry.js`, `featurePresets.js` | E2E |
| F-SEC-001~009 | `src/services/authService.js`, `middleware/rbac.js` | `tests/auth.test.mjs` |

---

> 본 SRS는 시스템 변경 시 함께 갱신됩니다.
