# 📚 OCI CRM AI — 개발 산출물 인덱스

> **버전**: v5.0 (2026.05)
> **위치**: `src/docs/` — 형상관리 대상 (git tracked)

---

## 📋 산출물 목록 (총 19종)

### 🎯 설계 문서 (5)

| 문서 | 대상 | 설명 |
|------|------|------|
| 📋 [SRS.md](./SRS.md) | 기획자, 아키텍트 | 소프트웨어 요구사항 명세서 (기능/비기능) |
| 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) | 아키텍트, 개발자 | 시스템 아키텍처, 모듈 설계, ADR |
| 🖼 [SCREEN_DESIGN.md](./SCREEN_DESIGN.md) | 디자이너, 개발자, QA | 화면설계서 (17개 페이지 wireframe) |
| 📐 [PROGRAM_SPEC.md](./PROGRAM_SPEC.md) | 개발자 | 프로그램 명세서 (모듈/함수/흐름) |
| 🗄 [DB_TABLE_SPEC.md](./DB_TABLE_SPEC.md) | 개발자, DBA | DB 테이블 명세서 (27개 테이블) |

### 📊 DB 문서 (3 — 기존)

| 문서 | 설명 |
|------|------|
| 🗄 [db-erd.md](./db-erd.md) | ER 다이어그램 |
| 🗄 [db-table-design.md](./db-table-design.md) | 테이블 상세 설계 |
| 🗄 [db-ddl.sql](./db-ddl.sql) | DDL 스크립트 |

### 🔌 API 문서 (1)

| 문서 | 설명 |
|------|------|
| 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) | REST API + WebSocket 명세 (100+ 엔드포인트) |

### 📘 사용자 / 운영 문서 (5)

| 문서 | 대상 | 설명 |
|------|------|------|
| 📘 [USER_MANUAL.md](./USER_MANUAL.md) | 모든 사용자 | 화면별 사용법, FAQ |
| 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) | 관리자, DevOps | 환경 설정, 셋업 |
| 🚀 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | DevOps | 배포 가이드 (PM2/Docker) |
| 🛠 [OPERATION_MANUAL.md](./OPERATION_MANUAL.md) | 운영팀 | 일상 운영 / 백업 / 비상 대응 |
| 🔧 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) | 운영팀, 지원 | 트러블슈팅 (증상별 진단) |

### 🔒 보안 / 테스트 (2)

| 문서 | 대상 | 설명 |
|------|------|------|
| 🔒 [SECURITY_GUIDE.md](./SECURITY_GUIDE.md) | 보안 담당, 개발자 | 보안 아키텍처 (인증/권한/암호화) |
| 🧪 [TEST_PLAN.md](./TEST_PLAN.md) | QA, 개발자 | 테스트 계획 + 시나리오 |

### 📦 이력 / 워크플로우 (3)

| 문서 | 설명 |
|------|------|
| 📦 [RELEASE_NOTES.md](./RELEASE_NOTES.md) | 릴리즈 노트 (마일스톤별) |
| 📜 [CHANGELOG.md](./CHANGELOG.md) | 변경 이력 (commit 기반) |
| 🔄 [DEV_WORKFLOW.md](./DEV_WORKFLOW.md) | 개발 워크플로우 (Lint+Test+승인+Commit) |

### 🎨 신규 기능 설계 (Phase 별)

| 문서 | 대상 | 설명 |
|------|------|------|
| 📐 [CALENDAR_AUTOCOMPLETE_DESIGN.md](./CALENDAR_AUTOCOMPLETE_DESIGN.md) | 디자이너, 기획, 개발자 | 영업캘린더 자동완성 + UX 개선 (Phase 1~5) |

---

## 🎯 역할별 추천 읽기 순서

### 신규 사용자
1. 📘 [USER_MANUAL.md](./USER_MANUAL.md)

### 신규 개발자 온보딩
1. 📘 [USER_MANUAL.md](./USER_MANUAL.md) — 제품 이해
2. 📋 [SRS.md](./SRS.md) — 요구사항 파악
3. 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) — 아키텍처
4. 📐 [PROGRAM_SPEC.md](./PROGRAM_SPEC.md) — 모듈 명세
5. 🗄 [DB_TABLE_SPEC.md](./DB_TABLE_SPEC.md) — 데이터 모델
6. 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — API
7. 🔄 [DEV_WORKFLOW.md](./DEV_WORKFLOW.md) — 개발 룰

### 디자이너 / UX
1. 🖼 [SCREEN_DESIGN.md](./SCREEN_DESIGN.md)
2. 📘 [USER_MANUAL.md](./USER_MANUAL.md)

### QA 담당
1. 🧪 [TEST_PLAN.md](./TEST_PLAN.md)
2. 📋 [SRS.md](./SRS.md)
3. 🖼 [SCREEN_DESIGN.md](./SCREEN_DESIGN.md)

### 배포 / 운영
1. 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) — 신규 설치
2. 🚀 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) — 정기 배포
3. 🛠 [OPERATION_MANUAL.md](./OPERATION_MANUAL.md) — 일상 운영
4. 🔧 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) — 장애 대응

### 보안 담당
1. 🔒 [SECURITY_GUIDE.md](./SECURITY_GUIDE.md)
2. 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) (§12 보안 설계)

---

## 📊 SI 프로젝트 표준 산출물 매핑

| 표준 산출물 | 우리 문서 |
|------------|----------|
| 소프트웨어 요구사항 명세서 (SRS) | SRS.md |
| 시스템 설계서 | PROGRAM_DESIGN.md |
| 화면설계서 | SCREEN_DESIGN.md |
| 프로그램 명세서 | PROGRAM_SPEC.md |
| DB 테이블 명세서 | DB_TABLE_SPEC.md |
| ERD | db-erd.md |
| 인터페이스 명세서 | API_DOCUMENTATION.md |
| 사용자 매뉴얼 | USER_MANUAL.md |
| 설치 매뉴얼 | ADMIN_SETUP_GUIDE.md |
| 배포 매뉴얼 | DEPLOYMENT_GUIDE.md |
| 운영 매뉴얼 | OPERATION_MANUAL.md |
| 트러블슈팅 가이드 | TROUBLESHOOTING_GUIDE.md |
| 보안 정책서 | SECURITY_GUIDE.md |
| 테스트 계획서 | TEST_PLAN.md |
| 릴리즈 노트 | RELEASE_NOTES.md |
| 변경 이력 | CHANGELOG.md |

---

## 📝 문서 관리 원칙

### 작성 원칙
- ✅ **사실 기반**: 실제 코드와 일치
- ✅ **버전 명시**: 각 문서 상단
- ✅ **마크다운**: 모든 문서 `.md` (GitHub / Notion 호환)
- ✅ **한국어 우선**: 사용자 대상은 한국어
- ❌ **시크릿 금지**: 실제 API 키, 패스워드 등 절대 금지

### 변경 시 절차
1. 코드 변경 시 → 관련 문서 동시 갱신 ([DEV_WORKFLOW.md](./DEV_WORKFLOW.md) 참조)
2. 큰 변경 → [CHANGELOG.md](./CHANGELOG.md) + [RELEASE_NOTES.md](./RELEASE_NOTES.md) 갱신
3. PR 리뷰 시 → 문서 갱신 여부 확인

### 신규 문서 추가
1. `src/docs/` 폴더에 `.md` 파일 생성
2. 본 `README.md` (인덱스)에 추가
3. 적절한 카테고리에 배치

---

## 🔗 외부 참조

### 저장소
- **GitHub**: https://github.com/overclass8211/oci-ai
- **메인 브랜치**: `master`
- **기능 브랜치**: `feature/pipeline-ai-coaching`

### 외부 API
- [Google Gemini API](https://ai.google.dev/docs)
- [Google Calendar API](https://developers.google.com/calendar/api/v3/reference)
- [Gmail API](https://developers.google.com/gmail/api/reference/rest)
- [Kakao Map JavaScript API](https://apis.map.kakao.com/web/)

### 기술 스택
- [Node.js](https://nodejs.org/docs)
- [Express](https://expressjs.com/)
- [MariaDB](https://mariadb.com/kb/en/documentation/)
- [Chart.js](https://www.chartjs.org/docs/)
- [FullCalendar](https://fullcalendar.io/docs)
- [Sharp](https://sharp.pixelplumbing.com/)
- [SVGO](https://github.com/svg/svgo)

---

## 📮 문의

- **문서 개선 제안**: GitHub Issue 또는 PR
- **기술 문의**: 개발팀
- **운영 문의**: IT 운영팀

---

> 📌 본 문서 인덱스는 신규 문서 추가 시 함께 갱신됩니다.
