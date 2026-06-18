# 📜 CHANGELOG

> commit 기반 변경 이력. 최신 commit이 위에 표시됩니다.
> 상세 마일스톤은 [RELEASE_NOTES.md](./RELEASE_NOTES.md) 참조.

---

## 2026-05-18

- `6ff508e` fix(logo): 표시 크기 확대 + 여백 자동 제거 + Server-Side Inject (Flash 제거)

## 2026-05-17

- `2ac5f3d` feat(logo): 로고 관리 기능 — 자동 최적화 (Sharp + svgo) + Magic Bytes 검증
- `4dff0d9` feat(feature-flags): Step 4/4 — Graceful Degradation (UI 안내)
- `a330183` feat(feature-flags): Step 3/4 — Cron + WebSocket 가드
- `925c427` feat(feature-flags): Step 2/4 — Circuit Breaker (클라이언트 API 가드)
- `0ffde45` feat(feature-flags): Configuration Preset 시스템 (Step 1/4)
- `d542573` fix(ui): 다크모드 흰색 배경 충돌 해소 — 회의록 페이지 등 전수 수정
- `221a73d` fix(feature-flags): 메뉴/UI 가시성 + 직접 접근 방어 — End-to-end 동작 완성
- `d134e08` feat(feature-flags): Step 3 — UI 개선 (검색/정렬/접기/이력 모달)
- `e67dbe9` feat(feature-flags): Step 2 — backend featureGuard 미들웨어 + 11개 라우트 적용
- `934b795` feat(feature-flags): Step 1 — 매니페스트 기반 자동 동기화 + 12개 누락 토글 추가
- `04f454f` docs(workflow): CLAUDE.md + DEV_WORKFLOW.md — 표준 개발 워크플로우 명문화
- `dc028d0` fix(settings): 이메일 템플릿 변수 구문을 시각적 칩으로 렌더링
- `abe7229` fix(report-builder): 컨테이너 ID 'app-content' → 'content' 수정
- `37e872f` feat(report-builder): Phase 1 MVP — drag&drop 사용자 정의 리포트 빌더
- `af0be8f` feat(pwa): Service Worker CACHE_VERSION 자동 갱신 (서버 부팅 시각 기반)

## 2026-05-17 이전

- `7053fd0` fix(gmail): customers.email 컬럼 사용 + 재연결 후 stale 에러 자동 클리어
- `c4e8978` fix(google): OAuth 콜백 팝업 자동 닫힘 + invalid_grant 친절 처리
- `216e925` feat(gmail): Phase G3 — 백그라운드 동기화 + activities 자동 기록
- `e02cd70` feat(gmail): Phase G2 — Gmail API 로 CRM 내부에서 직접 발송
- `9668e1d` feat(gmail): Phase G1 — Gmail 읽기 + 리드/고객 자동 매칭

## 2026-05 (PWA + STT)

- `dfe5c3d` feat(pwa): Phase 3 — 오프라인 회의록 녹음 (IndexedDB + 동기화 큐)
- `d1f85b4` fix(mobile): page-title 세로 깨짐 + 상단바 공간 압박 해소
- `f97de77` feat(pwa): Phase 2 — mobile viewport audit + iOS UX fixes
- `09cc198` feat(pwa): Phase 1 — PWA manifest + Service Worker + offline fallback
- `191dde7` feat(stt): async job pattern for long meeting transcription (up to 120min)
- `4b46689` fix(prepare): guard husky in production install

---

## 📌 작성 규칙

- Conventional Commits 형식: `<type>(<scope>): <subject>`
- type: feat, fix, docs, refactor, test, chore
- scope: 모듈명 (gmail, feature-flags, pwa, ...)
- 주요 변경은 별도 단락으로 상세 설명

전체 git log 확인:
```bash
git log --oneline --decorate
```
