# 🔧 OCI CRM AI — 트러블슈팅 가이드

> **대상**: 시스템 관리자, 운영 담당, 사용자 지원
> **버전**: 2026.05
> **사용법**: 증상으로 검색 (`Ctrl+F`) → 진단 → 해결

---

## 📑 목차

1. [빠른 진단 체크리스트](#1-빠른-진단-체크리스트)
2. [로그인 / 인증 문제](#2-로그인--인증-문제)
3. [Google 연동 문제](#3-google-연동-문제)
4. [Gmail 통합 문제](#4-gmail-통합-문제)
5. [회의록 STT 문제](#5-회의록-stt-문제)
6. [AI 챗봇 / 토큰 문제](#6-ai-챗봇--토큰-문제)
7. [데이터베이스 문제](#7-데이터베이스-문제)
8. [PWA / 모바일 문제](#8-pwa--모바일-문제)
9. [성능 / 응답 속도](#9-성능--응답-속도)
10. [배포 / Docker 문제](#10-배포--docker-문제)
11. [에러 코드 참조](#11-에러-코드-참조)
12. [지원 요청 시 첨부 자료](#12-지원-요청-시-첨부-자료)

---

## 1. 빠른 진단 체크리스트

문제 발생 시 가장 먼저 확인:

```bash
# 1. 서버 헬스체크
curl http://localhost:3001/api/health

# 2. 프로세스 상태
pm2 list                                # 또는: docker-compose ps

# 3. 로그 확인
pm2 logs oci-crm-ai --lines 100         # 또는: docker-compose logs --tail=100 app

# 4. DB 연결
mysql -u oci_crm_user -p oci_crm -e "SELECT 1"

# 5. 디스크 / 메모리
df -h
free -h
```

---

## 2. 로그인 / 인증 문제

### 2.1 "아이디 또는 비밀번호가 올바르지 않습니다"

**원인 후보:**
- 비밀번호 오타
- 계정 비활성화 (`is_active=0`)
- DB의 `password_hash`가 손상됨

**진단:**
```sql
SELECT id, username, is_active, otp_enabled FROM users WHERE username='user@example.com';
```

**해결:**
```sql
-- 비활성화 해제
UPDATE users SET is_active=1 WHERE id=<id>;

-- 비밀번호 리셋 (관리자만)
-- 1) bcrypt 해시 생성:
--    node -e "console.log(require('bcryptjs').hashSync('NewPassword123!', 10))"
UPDATE users SET password_hash='<bcrypt_hash>' WHERE id=<id>;
```

---

### 2.2 "OTP 코드가 올바르지 않습니다"

**원인:**
- OTP 앱(Google Authenticator)과 서버 시각 불일치
- 6자리 코드를 잘못 입력
- OTP 시크릿이 손상됨

**진단:**
```bash
# 서버 시각 동기화 확인
timedatectl status
sudo systemctl status systemd-timesyncd
```

**해결:**
```bash
# 서버 시각 강제 동기화
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
```

**OTP 비활성화 (관리자만 — 사용자 재설정용):**
```sql
UPDATE users SET otp_enabled=0, otp_secret=NULL WHERE id=<id>;
```

---

### 2.3 "토큰이 만료되었습니다" (401 반복)

**원인:**
- Access Token 만료 (15분) — 정상 동작 (Refresh Token으로 자동 갱신)
- HttpOnly 쿠키 차단 (브라우저 보안 설정)
- `JWT_SECRET` 변경 → 기존 토큰 모두 무효

**진단:**
```javascript
// 브라우저 DevTools 콘솔에서
document.cookie  // 'oci_refresh=...' 가 보여야 함
```

**해결:**
- 사용자가 한 번 로그아웃 → 재로그인
- 브라우저 쿠키 차단 해제 (Same-Site=Lax 설정 확인)
- `JWT_SECRET`을 변경했다면 모든 사용자 강제 재로그인 필요

---

### 2.4 "비활성화된 계정입니다"

```sql
UPDATE users SET is_active=1 WHERE id=<id>;
```

---

### 2.5 로그인은 되는데 화면이 비어 있음

**원인:**
- 역할(role)에 따라 페이지 접근 권한 없음
- Service Worker 캐시 문제

**진단:**
```sql
SELECT id, username, role FROM users WHERE id=<id>;
```

**해결:**
```sql
-- 역할 변경
UPDATE users SET role='admin' WHERE id=<id>;
```

브라우저:
- DevTools > Application > Service Workers > **Unregister**
- 강제 새로고침: `Ctrl+Shift+R`

---

## 3. Google 연동 문제

### 3.1 OAuth 팝업이 닫히지 않음

**원인:**
- CSP가 inline script를 차단 (이전 버전)
- 외부 JS 파일 (`/js/google-oauth-callback.js`) 미존재 또는 404

**확인:**
```bash
ls public/js/google-oauth-callback.js
curl http://localhost:3001/js/google-oauth-callback.js
```

**해결:**
- 2026.05 버전 이상으로 업데이트
- 또는 파일 복원 (git에서 `public/js/google-oauth-callback.js`)

---

### 3.2 "invalid_grant" 에러

**원인:**
- Refresh Token 회수됨 (사용자가 Google 계정에서 권한 해제)
- 토큰 만료 (6개월 사용 안 함)
- `GOOGLE_CLIENT_ID`/`SECRET` 변경됨

**증상 (화면):**
- 회의록 페이지 하단: "⚠️ 재연결 필요"
- "지금 동기화" 클릭 시: `Toast.error('⚠️ Google 재연결 필요')`

**해결 (사용자):**
1. 설정 페이지 > **"Google 연결 해제"**
2. 다시 **"Google 연결"** 클릭 → 권한 재허용
3. 회의록 페이지 새로고침 (F5) — 자동으로 stale 에러 정리됨

**해결 (관리자 — DB 직접):**
```sql
DELETE FROM google_oauth_tokens WHERE user_id=<id>;
```

---

### 3.3 OAuth 콜백 후 "redirect_uri_mismatch" 에러

**원인:**
- Google Cloud Console에 등록된 Redirect URI ≠ `.env`의 `GOOGLE_REDIRECT_URI`

**확인:**
1. [Cloud Console > API > Credentials](https://console.cloud.google.com/apis/credentials)
2. 해당 OAuth 클라이언트 ID 클릭
3. **승인된 리디렉션 URI** 확인

**해결:**
- 정확히 일치해야 함 (프로토콜, 포트, 경로 포함)
- 예: `http://localhost:3001/api/google/callback`
- 운영: `https://crm.yourdomain.com/api/google/callback`

---

### 3.4 Scope picker에 Gmail / Calendar 안 보임

**원인:**
- Cloud Console에서 해당 API가 활성화되지 않음

**해결:**
```
https://console.cloud.google.com/apis/library/gmail.googleapis.com
https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
```

→ **사용 설정** 클릭 → 잠시 후 OAuth 동의 화면의 scope picker에서 확인 가능

---

### 3.5 "앱이 확인되지 않음" 경고 화면

**원인:**
- Google OAuth 앱 검증 미완료 (External 사용자 유형)

**해결 (개발/테스트):**
- OAuth 동의 화면 > **테스트 사용자** 추가
- 또는 "고급 > 안전하지 않은 페이지로 이동" (개발용)

**해결 (운영):**
- Sensitive Scope (gmail.readonly) 사용 시 Google 검증 신청 필요
- 또는 **Google Workspace Internal** 로 전환 (검증 면제)

---

## 4. Gmail 통합 문제

### 4.1 고객사 모달 "최근 Gmail 대화"에 "Unknown column 'contact_email'" 에러

**원인 (해결됨 — 2026.05):**
- 이전 버전: `customers.contact_email` 컬럼명 잘못 가정
- 실제 컬럼: `customers.email`

**확인:**
```sql
DESCRIBE customers;   -- email 컬럼 있어야 함
```

**해결:**
- 2026.05 이후 버전 코드 배포 (`git pull` + 재시작)
- 운영: `pm2 restart oci-crm-ai`

---

### 4.2 Gmail 자동 동기화가 매번 "0건 매칭"

**원인:**
- 고객사 `customers.email` 필드가 비어있음
- 고객 이메일 주소와 실제 송수신 메일의 주소가 다름

**진단:**
```sql
SELECT id, name, email FROM customers WHERE email IS NULL OR email='';
```

**해결:**
- 고객사 모달에서 정확한 담당자 이메일 입력
- "지금 동기화" 클릭하여 즉시 확인

---

### 4.3 Gmail 동기화가 자동 비활성화됨

**원인:**
- `invalid_grant` 발생 시 자동으로 `gmail_sync_enabled=0` 처리됨

**확인:**
```sql
SELECT user_id, gmail_sync_enabled, gmail_sync_error
FROM google_oauth_tokens WHERE user_id=<id>;
```

**해결:**
1. Google 재연결 (위 3.2 참조)
2. 회의록 페이지 > "📧 Gmail 자동 동기화" 토글 **ON**

---

### 4.4 Gmail 발송 실패 (G2)

**원인 후보:**
- `gmail.send` scope 미보유 (구버전 토큰)
- 수신자 이메일 형식 오류

**확인 (브라우저 DevTools):**
```http
POST /api/gmail/send
→ 401 → scope 부족
→ 400 → 이메일 형식 오류
```

**해결:**
- Google 재연결 (scope 갱신)
- 수신자 이메일 형식 확인 (정규식: `^[\w.-]+@[\w.-]+\.\w+$`)

---

## 5. 회의록 STT 문제

### 5.1 "504 Gateway Timeout" — 긴 녹음

**원인:**
- 동기 STT (`/transcribe`)는 20분 이하만 권장
- Nginx/Cloudflare 등 reverse proxy의 timeout

**해결 (자동):**
- 20분 이상은 자동으로 비동기 처리 (`/transcribe-async`)
- 폴링 방식 (`/transcribe-status/:jobId`)으로 안전

**해결 (수동 - reverse proxy 설정):**
```nginx
# Nginx
proxy_read_timeout 1000s;
proxy_connect_timeout 60s;
```

**개발자 옵션 — 동기 STT 강제 사용 시:**
- `server.js`의 `httpServer.requestTimeout = 16 * 60 * 1000` 확인

---

### 5.2 "413 Payload Too Large"

**원인:**
- 파일 크기 25MB 초과
- Nginx `client_max_body_size` 부족

**해결 (Nginx):**
```nginx
client_max_body_size 30M;
```

**해결 (코드):**
- `src/middleware/upload.js`의 `limits.fileSize` 조정 후 재시작

---

### 5.3 STT 결과가 부정확

**원인:**
- 오디오 품질 낮음 (배경 소음, 마이크 거리)
- 비표준 형식 (압축 손실)

**권장:**
- WAV/MP3 16kHz, 단일 채널
- 화자 간 2~3m 거리 (마이크)
- 음악/배경음 최소화

---

### 5.4 비동기 STT 작업이 "processing"에서 멈춤

**원인:**
- Job 워치독 25분 초과 (자동 fail)
- Gemini Files API 업로드 실패

**진단 (로그):**
```bash
pm2 logs oci-crm-ai | grep "sttJobs"
```

**해결:**
- 사용자에게 재녹음 / 재업로드 안내
- Gemini API 키 유효성 확인

---

### 5.5 오프라인 녹음이 동기화되지 않음

**원인:**
- IndexedDB 큐가 가득 참
- Service Worker 미등록

**진단 (브라우저 DevTools):**
- **Application > Service Workers** — Active 상태인가?
- **Application > IndexedDB > `oci_meeting_offline`** — 데이터 있는가?

**해결:**
- 인터넷 연결 확인
- 회의록 페이지 진입 → 자동 동기화 트리거
- IndexedDB 용량 정리 (브라우저: 사이트 데이터 삭제)

---

## 6. AI 챗봇 / 토큰 문제

### 6.1 "Gemini API 키가 유효하지 않습니다"

**원인:**
- `.env`의 `GEMINI_API_KEY` 오타 또는 누락
- 키가 만료/삭제됨

**진단:**
```bash
echo $GEMINI_API_KEY      # PM2 환경에서 확인
docker-compose exec app printenv | grep GEMINI    # Docker
```

**해결:**
1. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 새 키 발급
2. `.env` 업데이트
3. 서버 재시작: `pm2 restart oci-crm-ai` 또는 `docker-compose restart app`

---

### 6.2 "요청 한도 초과" / 429

**원인:**
- Gemini API의 분당 할당량 초과 (60 RPM)
- 사용자 월간 토큰 한도 초과

**해결 (Gemini Rate Limit):**
- 잠시 대기 (1분)
- GCP 프로젝트에서 할당량 증액 신청

**해결 (사용자 토큰 한도):**
```sql
-- 한도 확인
SELECT name, monthly_token_limit FROM team_members WHERE id=<id>;

-- 한도 증액
UPDATE team_members SET monthly_token_limit=1000000 WHERE id=<id>;
```

또는 관리자 콘솔 > **토큰 모니터링 > 수동 충전**

---

### 6.3 AI 챗봇 응답이 끊김

**원인:**
- SSE 연결 끊김 (네트워크 불안정)
- Nginx buffering이 SSE 차단

**해결 (Nginx):**
```nginx
location /api/ai/chat {
    proxy_pass http://localhost:3001;
    proxy_buffering off;              # SSE 필수
    proxy_cache off;
    proxy_read_timeout 1000s;
    proxy_set_header X-Accel-Buffering no;
}
```

---

### 6.4 AI 브리핑이 비어있음

**원인:**
- 해당 고객사에 연결된 리드/활동이 없음
- Gemini Pro API quota 초과

**진단:**
```sql
SELECT COUNT(*) FROM leads WHERE customer_id=<id>;
SELECT COUNT(*) FROM activities a JOIN leads l ON l.id=a.lead_id WHERE l.customer_id=<id>;
```

**해결:**
- 리드/활동 입력 후 재시도
- Gemini Pro quota는 GCP Console에서 확인

---

## 7. 데이터베이스 문제

### 7.1 "MariaDB 연결 실패" / ECONNREFUSED

**진단:**
```bash
sudo systemctl status mariadb
sudo netstat -tlnp | grep 3306
mysql -u oci_crm_user -p oci_crm -e "SELECT 1"
```

**해결:**
```bash
sudo systemctl start mariadb
sudo systemctl enable mariadb
```

방화벽 확인:
```bash
sudo ufw status
sudo ufw allow from 127.0.0.1 to any port 3306    # localhost만 허용
```

---

### 7.2 "ER_DUP_ENTRY: Duplicate entry"

**원인:**
- UNIQUE 제약 조건 위반 (username, email, gmail_message_id 등)

**진단 (예: username 중복):**
```sql
SELECT id, username FROM users WHERE username='user@example.com';
```

**해결:**
- 중복 레코드 제거 또는 새 값 사용

---

### 7.3 "ER_NO_REFERENCED_ROW" / Foreign Key 오류

**원인:**
- 참조 테이블의 ID가 존재하지 않음
- 예: `leads.customer_id` → 존재하지 않는 `customers.id`

**진단:**
```sql
SELECT l.id, l.customer_id FROM leads l
LEFT JOIN customers c ON c.id=l.customer_id
WHERE c.id IS NULL;
```

**해결:**
```sql
-- 고아 레코드의 customer_id를 NULL로
UPDATE leads SET customer_id=NULL WHERE customer_id NOT IN (SELECT id FROM customers);
```

---

### 7.4 "Incorrect datetime value: '0000-00-00'"

**원인:**
- MariaDB sql_mode가 zero-date를 허용하지 않음

**해결 (Docker Compose):**
```yaml
db:
  environment:
    MARIADB_INIT_COMMAND: "SET GLOBAL sql_mode='ALLOW_INVALID_DATES,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'"
```

**해결 (직접 설치):**
```sql
SET GLOBAL sql_mode='ALLOW_INVALID_DATES,...';
-- 영구 적용: /etc/mysql/mariadb.conf.d/50-server.cnf 의 [mysqld]에 sql_mode 추가
```

---

### 7.5 DB 디스크 사용량 증가

**원인:**
- `access_logs` 테이블 (자동 정리: 90일 이상 삭제)
- `ai_usage` 테이블
- 오디오 업로드 (`public/uploads`)

**진단:**
```sql
SELECT table_name, ROUND(data_length/1024/1024, 2) as size_mb
FROM information_schema.tables
WHERE table_schema='oci_crm'
ORDER BY data_length DESC;
```

**해결:**
```sql
-- access_logs 강제 정리
DELETE FROM access_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- ai_usage 30일 이상 정리 (선택)
DELETE FROM ai_usage WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 디스크 정리 (innodb tablespace)
OPTIMIZE TABLE access_logs;
```

업로드 파일:
```bash
# 90일 이상 오디오 파일 정리 (확인 후 실행)
find public/uploads -name "*.mp3" -mtime +90 -ls
```

---

## 8. PWA / 모바일 문제

### 8.1 PWA 설치 옵션이 안 보임

**원인:**
- HTTPS가 아님 (PWA는 HTTPS 필수)
- `manifest.json` 또는 Service Worker 미등록

**진단:**
- DevTools > **Application > Manifest** — 파싱 오류 없는가?
- **Application > Service Workers** — Active 상태인가?

**해결:**
- HTTPS 적용 (Let's Encrypt)
- `localhost`는 예외적으로 HTTPS 없이도 동작

---

### 8.2 업데이트가 반영되지 않음

**원인:**
- Service Worker가 옛 버전 캐시 유지

**해결 (사용자):**
- 강제 새로고침: `Ctrl+Shift+R` (Win) / `Cmd+Shift+R` (Mac)
- 또는: DevTools > **Application > Service Workers > Unregister** → 새로고침

**해결 (개발자):**
```javascript
// public/sw.js
const CACHE_VERSION = 'v2';   // 버전 올리면 모든 캐시 자동 무효화
```

---

### 8.3 iOS Safari에서 입력시 화면이 zoom됨

**원인:**
- input 요소의 `font-size`가 16px 미만

**확인:**
- CSS에서 모든 `input`, `textarea`, `select`의 `font-size: 16px;` 확인

이미 적용됨 (`public/css/styles.css`).

---

### 8.4 모바일에서 카드 드래그가 안 됨

**원인:**
- 터치 이벤트 핸들러 미동작

**해결:**
- **길게 누른 후** 드래그 (롱 프레스)
- 권한 확인 (담당 리드만 변경 가능)

---

### 8.5 페이지 타이틀이 세로로 깨짐 (모바일)

**증상 (해결됨 — 2026.05):**
- 상단바의 페이지 제목이 세로로 표시됨

**해결:**
- `public/css/styles.css`의 `.page-title { white-space: nowrap; ... }` 적용 확인
- 2026.05 이후 버전 사용

---

## 9. 성능 / 응답 속도

### 9.1 페이지 로딩이 느림

**진단:**
```bash
curl -w "@-" -o /dev/null -s http://localhost:3001/api/dashboard <<'EOF'
time_namelookup:  %{time_namelookup}s
time_connect:     %{time_connect}s
time_starttransfer: %{time_starttransfer}s
time_total:       %{time_total}s
EOF
```

**원인 후보:**
- DB 쿼리 느림 → 인덱스 누락
- N+1 쿼리 패턴
- 외부 API 대기 (Gemini, Google)

**해결:**
- `EXPLAIN` 으로 쿼리 분석
- `src/middleware/errorHandler.js`의 `logAccess()` → `access_logs.duration_ms` 활용

```sql
SELECT path, AVG(duration_ms) avg_ms, MAX(duration_ms) max_ms, COUNT(*) cnt
FROM access_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY path
ORDER BY avg_ms DESC
LIMIT 20;
```

---

### 9.2 메모리 누수

**증상:**
- PM2 메모리가 계속 증가
- 1GB 도달 시 자동 재시작 (`max_memory_restart: '1G'`)

**진단:**
```bash
pm2 monit
ps aux | grep node
```

**해결:**
- 임시: PM2 재시작
- 영구: `node --inspect` + Chrome DevTools 힙 스냅샷 분석

---

### 9.3 WebSocket 연결 누락

**증상:**
- 실시간 알림 안 옴
- 헬스맵 데이터 안 옴

**진단 (브라우저 DevTools > Network > WS):**
- 연결 상태 확인
- 닫힘 코드: `4001` = 미인증

**해결:**
- 로그아웃 후 재로그인 (토큰 갱신)
- WebSocket 라우터 `src/ws.js` 확인

---

## 10. 배포 / Docker 문제

### 10.1 Docker 컨테이너가 즉시 종료됨

**진단:**
```bash
docker-compose logs app
docker-compose ps -a
```

**원인 후보:**
- `.env` 누락 → 환경변수 부재
- DB 연결 실패 (depends_on 조건)
- 포트 충돌

**해결:**
```bash
# 환경변수 확인
docker-compose config

# DB 헬스체크
docker-compose ps db
docker-compose logs db
```

---

### 10.2 "Cannot find module 'eslint'" (운영)

**원인 (해결됨):**
- 이전: ESLint가 devDependencies → `npm ci --omit=dev`에서 제외됨

**해결:**
- 2026.05 버전: `package.json`에서 eslint, @eslint/js, globals가 dependencies로 이동
- 운영: `npm install --production` 다시 실행

---

### 10.3 "husky not found" 운영 install 실패

**원인 (해결됨):**
- `npm install`이 prepare script 실행 시 husky 누락

**해결:**
- 2026.05 버전: `"prepare": "husky || echo 'husky skipped...'"`
- 운영: `npm install --production`

---

### 10.4 PM2 cluster 모드에서 WebSocket 동작 안 함

**원인:**
- 여러 인스턴스 간 WebSocket 메시지 미전파

**해결 (단순):**
- `exec_mode: 'fork'` + `instances: 1`로 변경

**해결 (확장):**
- Redis pub/sub 도입 (별도 개발 필요)
- Sticky session (Nginx `ip_hash`)

---

### 10.5 디스크 가득 참

**진단:**
```bash
df -h
du -sh /var/lib/mysql
du -sh public/uploads
du -sh logs/
```

**해결:**
```bash
# Docker
docker system prune -a --volumes      # ⚠️ 미사용 볼륨 삭제

# PM2 로그 정리
pm2 flush                              # 모든 로그 비우기

# access_logs 정리 (위 7.5 참조)

# 업로드 파일 정리 (90일 이상)
find public/uploads -name "*.mp3" -mtime +90 -delete
```

---

## 11. 에러 코드 참조

### 11.1 HTTP 상태별 의미

| Code | 의미 | 대응 |
|------|------|------|
| `400` | 요청 형식 오류 | 클라이언트 페이로드 확인 |
| `401` | 미인증 | 로그인 / 토큰 갱신 |
| `403` | 권한 부족 | 사용자 역할 확인 |
| `404` | 리소스 없음 | URL / ID 확인 |
| `413` | 파일 크기 초과 | 25MB 이하로 분할 |
| `429` | Rate Limit | 잠시 대기 |
| `500` | 서버 오류 | 서버 로그 확인 |
| `503` | DB 미연결 | MariaDB 상태 확인 |

### 11.2 애플리케이션 에러 코드

| Code | 의미 |
|------|------|
| `VALIDATION_ERROR` | 필수 필드 누락 |
| `AUTH_FAILED` | 로그인 실패 |
| `TOKEN_EXPIRED` | Access Token 만료 |
| `TOKEN_INVALID` | Token 서명 불일치 |
| `PERMISSION_DENIED` | RBAC 권한 부족 |
| `NOT_FOUND` | 리소스 없음 |
| `DUPLICATE_KEY` | 중복 제약 위반 |
| `RATE_LIMIT` | 요청 횟수 초과 |
| `API_KEY_INVALID` | Gemini API 키 무효 |
| `OAUTH_INVALID_GRANT` | Google 토큰 무효 |
| `DB_DISCONNECTED` | DB 연결 끊김 |

### 11.3 MariaDB 에러 코드

| Code | 의미 |
|------|------|
| `ER_DUP_ENTRY` (1062) | UNIQUE 제약 위반 |
| `ER_NO_REFERENCED_ROW` (1452) | Foreign Key 위반 |
| `ER_DATA_TOO_LONG` (1406) | 컬럼 길이 초과 |
| `ER_BAD_FIELD_ERROR` (1054) | Unknown column |
| `ECONNREFUSED` | DB 서버 미응답 |
| `ETIMEDOUT` | DB 연결 타임아웃 |

### 11.4 Google API 에러

| Error | 의미 |
|-------|------|
| `invalid_grant` | Refresh Token 만료/회수 |
| `redirect_uri_mismatch` | Redirect URI 불일치 |
| `access_denied` | 사용자가 권한 거부 |
| `insufficient_scope` | Scope 부족 |
| `quotaExceeded` | API 할당량 초과 |

### 11.5 Gemini API 에러

| Error | 의미 |
|-------|------|
| `API_KEY_INVALID` | API 키 무효 |
| `RESOURCE_EXHAUSTED` | 분당 한도 초과 |
| `INVALID_ARGUMENT` | 요청 형식 오류 |
| `SAFETY` | 응답이 safety policy로 차단됨 |
| `RECITATION` | 응답이 저작권 우려로 차단됨 |

---

## 12. 지원 요청 시 첨부 자료

문제 해결이 안 될 때, 다음 자료를 IT 운영팀에 전달:

### 12.1 필수 정보

```bash
# 1) 서버 헬스
curl -i http://localhost:3001/api/health

# 2) 최근 로그 100줄
pm2 logs oci-crm-ai --lines 100 --nostream > pm2-logs.txt

# 3) 에러 로그
grep -i "error\|exception" pm2-logs.txt | tail -50 > errors.txt

# 4) 시스템 자원
free -h > sysinfo.txt
df -h >> sysinfo.txt
uptime >> sysinfo.txt

# 5) Node / DB 버전
node -v > versions.txt
npm -v >> versions.txt
mysql --version >> versions.txt

# 6) PM2 상태
pm2 list > pm2-status.txt
```

### 12.2 추가 (재현 가능 시)

- **재현 단계** (구체적)
- **예상 동작** vs **실제 동작**
- **브라우저 + 버전** (예: Chrome 120 / Safari iOS 17)
- **스크린샷** (DevTools Console + Network 탭 포함)
- **사용자 ID** (영향받는 사용자의 `users.id`)
- **발생 시각** (정확한 timestamp)

### 12.3 DB 진단 (관리자 권한)

```sql
-- 최근 에러 발생 사용자
SELECT u.username, a.path, a.status_code, a.created_at
FROM access_logs a
JOIN users u ON u.id=a.user_id
WHERE a.status_code >= 500
ORDER BY a.created_at DESC
LIMIT 20;

-- DB 통계
SELECT table_name, table_rows, ROUND(data_length/1024/1024,2) as size_mb
FROM information_schema.tables
WHERE table_schema='oci_crm';
```

---

## 📎 부록: 자주 묻는 질문 (Admin FAQ)

### Q1. 사용자가 비밀번호를 잊었을 때?

```sql
-- 1) bcrypt 해시 생성
-- node -e "console.log(require('bcryptjs').hashSync('TempPassword123!', 10))"

-- 2) DB 업데이트
UPDATE users SET password_hash='$2a$10$...' WHERE username='user@example.com';

-- 3) 사용자에게 임시 비밀번호 전달 + 로그인 후 변경 안내
```

### Q2. 특정 사용자의 모든 활동 이력 조회?

```sql
SELECT a.activity_type, a.title, l.customer_name, a.performed_at
FROM activities a
LEFT JOIN leads l ON l.id=a.lead_id
WHERE a.performed_by=<user_id>
ORDER BY a.performed_at DESC
LIMIT 50;
```

### Q3. 시스템 점검 모드 진입?

현재 점검 모드 토글이 없으나, Nginx 레벨에서 가능:
```nginx
location / {
    return 503 '시스템 점검 중입니다. 30분 후 다시 시도해주세요.';
    add_header Content-Type text/plain;
}
```

### Q4. 모든 활성 세션 강제 종료?

```sql
-- 모든 Refresh Token 무효화
UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE revoked=0;

-- 또는 특정 사용자만
UPDATE refresh_tokens SET revoked=1 WHERE user_id=<id> AND revoked=0;
```

`JWT_SECRET` 변경 시 → 모든 Access Token도 무효화됨.

### Q5. 신규 기능 점진적 활성화?

```sql
-- 기능 플래그 (superadmin만 변경 가능)
SELECT feature_key, is_enabled FROM dev_features;
UPDATE dev_features SET is_enabled=1 WHERE feature_key='<key>';
```

---

## 📮 에스컬레이션 경로

1. **사용자** → 사내 IT 운영팀
2. **IT 운영팀** → DevOps / 시스템 담당자 (Superadmin)
3. **DevOps** → 개발팀 (코드 버그 의심 시)
4. **개발팀** → 외부 (Google Cloud Support, Gemini API)

---

> 본 가이드는 실제 코드와 배포 환경에 따라 일부 명령이 다를 수 있습니다.
> 최신 정보는 `git log`로 변경 이력 확인 후 적용하세요.
