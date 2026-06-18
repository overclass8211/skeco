# 🛠 OCI CRM AI — 관리자 셋업 가이드

> **대상**: 시스템 관리자, DevOps 엔지니어
> **사전 지식**: Node.js, MariaDB, Linux 기본
> **소요 시간**: 약 1~2시간 (외부 API 키 발급 포함)

---

## 📑 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [환경변수 설정](#2-환경변수-설정-env)
3. [데이터베이스 초기화](#3-데이터베이스-초기화)
4. [첫 Admin 계정 생성](#4-첫-admin-계정-생성)
5. [Google OAuth 설정](#5-google-oauth-설정-cloud-console)
6. [Gemini API 키 발급](#6-gemini-api-키-발급)
7. [개발 환경 실행](#7-개발-환경-실행)
8. [Docker Compose 배포](#8-docker-compose-배포)
9. [PM2 배포 (GCP/VM)](#9-pm2-배포-gcpvm)
10. [HTTPS / SSL 설정](#10-https--ssl-설정)
11. [백업 / 복구](#11-백업--복구)
12. [모니터링 / 로그](#12-모니터링--로그)
13. [업그레이드 절차](#13-업그레이드-절차)

---

## 1. 시스템 요구사항

### 1.1 최소 사양

| 항목 | 최소 | 권장 |
|------|------|------|
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 2GB | 4GB |
| **디스크** | 20GB | 50GB SSD |
| **Node.js** | 18.x | 20.x LTS |
| **MariaDB** | 10.6 | 11.x |
| **OS** | Ubuntu 22.04 / Debian 11 | Ubuntu 24.04 LTS |

### 1.2 필수 외부 서비스

- ✅ **Google Cloud Console** 프로젝트 (OAuth 2.0 + Calendar/Gmail API)
- ✅ **Gemini API 키** (Google AI Studio)
- ✅ **Kakao Developers** (지도 기능 사용 시 — 선택)
- ✅ **SMTP** (선택 — 이메일 발송이 Gmail OAuth로 대체됨)

---

## 2. 환경변수 설정 (`.env`)

### 2.1 `.env` 파일 생성

프로젝트 루트에 `.env` 파일 생성:

```bash
cp .env.example .env
nano .env
```

### 2.2 전체 환경변수

```env
# ─────────────────────────────────────────────
# 서버 설정
# ─────────────────────────────────────────────
NODE_ENV=production                    # development | test | production
PORT=3001
HTTPS_PORT=3443                        # 선택

# CORS — 운영 환경에서 반드시 설정
ALLOWED_ORIGINS=https://crm.yourdomain.com,https://app.yourdomain.com

# ─────────────────────────────────────────────
# 데이터베이스 (MariaDB)
# ─────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=3306
DB_USER=oci_crm_user
DB_PASSWORD=<강력한_비밀번호>
DB_NAME=oci_crm

# ─────────────────────────────────────────────
# 인증 (JWT + Refresh Token)
# ─────────────────────────────────────────────
JWT_SECRET=<openssl_rand_hex_64로_생성>
REFRESH_TOKEN_SECRET=<openssl_rand_hex_64로_생성>
ACCESS_TOKEN_EXPIRES=15m
REFRESH_TOKEN_EXPIRES=7d

# AES-256-GCM 암호화 키 (OTP secret, Google OAuth 토큰)
ENCRYPTION_KEY=<openssl_rand_hex_32로_생성>

# ─────────────────────────────────────────────
# AI (Gemini)
# ─────────────────────────────────────────────
GEMINI_API_KEY=<Google_AI_Studio_API_Key>

# ─────────────────────────────────────────────
# Google OAuth 2.0
# ─────────────────────────────────────────────
GOOGLE_CLIENT_ID=<XXX-XXX.apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<GOCSPX-XXX>
GOOGLE_REDIRECT_URI=https://crm.yourdomain.com/api/google/callback
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send

# ─────────────────────────────────────────────
# 외부 API (선택)
# ─────────────────────────────────────────────
KAKAO_MAP_KEY=<JavaScript_KEY>         # 지도 기능
EXIM_API_KEY=<수출입은행_환율_API_키>    # 환율 조회

# ─────────────────────────────────────────────
# SSL/HTTPS (선택 — 자체 HTTPS 구동 시)
# ─────────────────────────────────────────────
SSL_KEY_PATH=/etc/ssl/private/oci.key
SSL_CERT_PATH=/etc/ssl/certs/oci.crt
```

### 2.3 시크릿 키 생성 명령

```bash
# JWT_SECRET, REFRESH_TOKEN_SECRET (64자 hex)
openssl rand -hex 64

# ENCRYPTION_KEY (32자 hex — AES-256 요구사항)
openssl rand -hex 32
```

> ⚠️ **중요**: 운영 환경에서 시크릿 키는 절대 git에 커밋하지 말 것. `.env`는 `.gitignore`에 포함됨.

---

## 3. 데이터베이스 초기화

### 3.1 MariaDB 설치 (Ubuntu)

```bash
sudo apt update
sudo apt install -y mariadb-server
sudo systemctl enable mariadb
sudo systemctl start mariadb
sudo mysql_secure_installation
```

### 3.2 데이터베이스 + 사용자 생성

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE oci_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'oci_crm_user'@'localhost' IDENTIFIED BY '<강력한_비밀번호>';
GRANT ALL PRIVILEGES ON oci_crm.* TO 'oci_crm_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3.3 스키마 적용

```bash
mysql -u oci_crm_user -p oci_crm < schema.sql
```

**검증**:
```bash
mysql -u oci_crm_user -p oci_crm -e "SHOW TABLES;"
```

→ `users`, `customers`, `leads`, `projects`, ... 등 24개 테이블 확인

### 3.4 추가 테이블 자동 생성

서버 부팅 시 `src/initTables.js`가 자동 실행되어 다음 테이블을 보강:
- `calendar_events`, `announcements`, `comments`, `faq`
- `access_logs`, `meeting_minutes`, `ai_usage`
- `google_oauth_tokens`, `refresh_tokens`, `token_blacklist`, `admin_labels`, ...

별도 마이그레이션 도구 불필요.

### 3.5 (선택) 샘플 데이터 시드

```bash
node scripts/seed-2025.js
```

→ 2025년 가상 영업활동 데이터 추가 (테스트용)

---

## 4. 첫 Admin 계정 생성

### 4.1 방법 A: 회원가입 후 권한 변경 (권장)

1. 서버 실행 (`npm run dev`)
2. 브라우저에서 `http://localhost:3001` 접속
3. 회원가입 후 로그인
4. DB에서 역할 변경:

```bash
mysql -u oci_crm_user -p oci_crm
```

```sql
-- 등급 확인
SELECT id, username, role FROM users;

-- admin 부여 (1=manager, 2=team_lead, 3=executive, 4=admin, 5=superadmin)
UPDATE users SET role='superadmin' WHERE id=1;
```

### 4.2 방법 B: DB 직접 삽입

bcrypt 해시 생성 (Node REPL):
```bash
node -e "console.log(require('bcryptjs').hashSync('YourPassword123!', 10))"
```

```sql
INSERT INTO users (username, email, password_hash, full_name, role, is_active, otp_enabled)
VALUES (
  'admin',
  'admin@yourcompany.com',
  '$2a$10$<생성된_해시>',
  '시스템관리자',
  'superadmin',
  1,
  0
);
```

### 4.3 2FA 설정 (강력 권장)

로그인 후 **설정 > 2FA 활성화** → Google Authenticator 등록.

---

## 5. Google OAuth 설정 (Cloud Console)

### 5.1 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. **새 프로젝트** 생성 (예: `oci-crm-prod`)
3. 프로젝트 선택

### 5.2 API 활성화

다음 4개 API 활성화:
- **Google Calendar API**: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- **Gmail API**: https://console.cloud.google.com/apis/library/gmail.googleapis.com
- **Google People API** (선택): 프로필 정보용
- **Google+ API** 또는 OAuth2 (기본 자동 활성)

### 5.3 OAuth 동의 화면 설정

1. **API 및 서비스 > OAuth 동의 화면**
2. 사용자 유형: **External** (Google Workspace는 Internal)
3. 앱 정보 입력 (앱 이름, 지원 이메일, 로고)
4. **범위 추가** → 다음 scope 추가:
   ```
   .../auth/calendar
   .../auth/calendar.events
   .../auth/gmail.readonly
   .../auth/gmail.send
   ```
5. **테스트 사용자** 추가 (검증 전까지 필수)

### 5.4 OAuth 클라이언트 ID 생성

1. **API 및 서비스 > 사용자 인증 정보**
2. **사용자 인증 정보 만들기 > OAuth 클라이언트 ID**
3. 애플리케이션 유형: **웹 애플리케이션**
4. 승인된 리디렉션 URI:
   - 개발: `http://localhost:3001/api/google/callback`
   - 운영: `https://crm.yourdomain.com/api/google/callback`
5. **만들기** → `Client ID` + `Client Secret` 발급

### 5.5 `.env`에 반영

```env
GOOGLE_CLIENT_ID=XXX-XXX.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-XXX
GOOGLE_REDIRECT_URI=https://crm.yourdomain.com/api/google/callback
```

### 5.6 검증 (Production 배포 전)

테스트 사용자 모드에서는 `unverified app` 경고 표시됨. 운영 배포 전:
- 앱 검증 신청 (Sensitive Scopes 포함 시 보안 평가 필요)
- 또는 **Google Workspace Internal** 으로 운영 (검증 면제)

---

## 6. Gemini API 키 발급

1. [Google AI Studio](https://aistudio.google.com/app/apikey) 접속
2. **API 키 만들기** → 기존 GCP 프로젝트 선택
3. 생성된 키 복사 → `.env`의 `GEMINI_API_KEY`에 입력

### 6.1 사용 모델

- `gemini-2.5-flash`: 대화용 (저비용, 빠름)
- `gemini-2.5-pro`: 분석용 (정확도 우선)

### 6.2 토큰 한도 정책

- 사용자별 월간 한도: 기본 500,000 토큰
- 임계값 도달 시 자동 충전 가능 (`team_members.auto_recharge_*` 컬럼)
- 관리자가 사용자별 한도 조정 가능

---

## 7. 개발 환경 실행

### 7.1 의존성 설치

```bash
cd /path/to/oci-crm-ai
npm install
```

### 7.2 개발 모드

```bash
npm run dev
```

→ `nodemon`이 파일 변경 감지하여 자동 재시작.

### 7.3 테스트 실행

```bash
npm test              # 단일 실행
npm run test:watch    # 감시 모드
npm run test:coverage # 커버리지
```

### 7.4 린트 / 포맷

```bash
npm run lint        # 검사
npm run lint:fix    # 자동 수정
npm run format      # Prettier 포맷
```

### 7.5 모든 scripts

| Script | 설명 |
|--------|------|
| `npm start` | 프로덕션 실행 |
| `npm run dev` | 개발 모드 (nodemon) |
| `npm test` | 테스트 단일 실행 |
| `npm run test:watch` | 테스트 감시 모드 |
| `npm run test:coverage` | 커버리지 분석 |
| `npm run lint` | ESLint 검사 |
| `npm run lint:fix` | ESLint 자동 수정 |
| `npm run format` | Prettier 포맷팅 |
| `npm run prepare` | Husky 설정 (자동) |

---

## 8. Docker Compose 배포

### 8.1 사전 준비

```bash
sudo apt install -y docker.io docker-compose
sudo systemctl enable docker
sudo usermod -aG docker $USER
# 재로그인 필요
```

### 8.2 `.env` 설정

```env
# Docker용 추가 환경변수
DB_HOST=db                      # docker-compose 서비스명
DB_ROOT_PASSWORD=<root_password>
```

### 8.3 실행

```bash
docker-compose up -d
docker-compose ps           # 상태 확인
docker-compose logs -f app  # 로그 확인
```

### 8.4 Dockerfile 구조

- **다단계 빌드** (deps + runtime)
- **non-root 사용자** (`ocicrm`)
- **헬스체크**: `GET /api/health` (30초 간격)
- **포트**: 3000 (Container) → 호스트 매핑

### 8.5 볼륨

- `db-data`: MariaDB 데이터 영구 저장
- `uploads`: 회의록 오디오 파일 저장 (`/app/public/uploads`)

### 8.6 docker-compose 명령

```bash
docker-compose up -d              # 백그라운드 실행
docker-compose down               # 중지 + 컨테이너 제거 (볼륨 유지)
docker-compose down -v            # 볼륨까지 제거 (⚠️ 데이터 삭제)
docker-compose restart app        # 앱만 재시작
docker-compose exec app sh        # 컨테이너 접속
docker-compose logs -f --tail=100 # 실시간 로그
```

---

## 9. PM2 배포 (GCP/VM)

### 9.1 PM2 설치

```bash
sudo npm install -g pm2
```

### 9.2 `ecosystem.config.js` 생성

프로젝트 루트에 다음 파일 생성:

```javascript
module.exports = {
  apps: [
    {
      name: 'oci-crm-ai',
      script: './server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      instances: 'max',          // CPU 코어 수만큼
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

### 9.3 실행

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save                     # 부팅 시 자동 복구 등록
pm2 startup                  # systemd 등록 (출력된 명령 실행)
```

### 9.4 PM2 관리 명령

```bash
pm2 list                    # 프로세스 목록
pm2 logs oci-crm-ai         # 실시간 로그
pm2 restart oci-crm-ai      # 재시작
pm2 stop oci-crm-ai         # 중지
pm2 delete oci-crm-ai       # 제거
pm2 monit                   # 실시간 모니터링
pm2 reload oci-crm-ai       # zero-downtime 재시작
```

### 9.5 코드 업데이트 후 재배포

```bash
cd /path/to/oci-crm-ai
git pull
npm install --production
pm2 reload oci-crm-ai       # 무중단 재시작
```

---

## 10. HTTPS / SSL 설정

### 10.1 옵션 A: Nginx Reverse Proxy (권장)

```nginx
# /etc/nginx/sites-available/oci-crm
server {
    listen 443 ssl http2;
    server_name crm.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/crm.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.yourdomain.com/privkey.pem;

    # WebSocket 지원
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 1000s;        # SSE 스트리밍 + 긴 STT 작업
    }

    # 업로드 크기 (회의록 25MB)
    client_max_body_size 30M;
}

server {
    listen 80;
    server_name crm.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### 10.2 Let's Encrypt 인증서 발급

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.yourdomain.com
sudo certbot renew --dry-run    # 자동 갱신 테스트
```

### 10.3 옵션 B: 자체 HTTPS (Nginx 없이)

`.env`에서:
```env
SSL_KEY_PATH=/etc/ssl/private/oci.key
SSL_CERT_PATH=/etc/ssl/certs/oci.crt
HTTPS_PORT=3443
```

서버가 자동으로 HTTPS도 함께 띄움.

---

## 11. 백업 / 복구

### 11.1 DB 백업 (수동)

```bash
mysqldump -u oci_crm_user -p oci_crm > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 11.2 DB 백업 (자동 — crontab)

```bash
crontab -e
```

```cron
# 매일 새벽 2시 백업, 30일 이상된 파일 삭제
0 2 * * * mysqldump -u oci_crm_user -p<password> oci_crm | gzip > /backup/oci_crm_$(date +\%Y\%m\%d).sql.gz
0 3 * * * find /backup -name "oci_crm_*.sql.gz" -mtime +30 -delete
```

### 11.3 업로드 파일 백업

```bash
# 회의록 오디오 + 첨부파일
tar czf uploads_$(date +%Y%m%d).tar.gz public/uploads/
```

### 11.4 복구

```bash
# DB 복구
gunzip < backup_20260517.sql.gz | mysql -u oci_crm_user -p oci_crm

# 업로드 복구
tar xzf uploads_20260517.tar.gz -C /path/to/oci-crm-ai/
```

### 11.5 Docker Compose 환경 백업

```bash
# DB 백업
docker-compose exec db mysqldump -u root -p<root_password> oci_crm > backup.sql

# 볼륨 백업
docker run --rm -v ocicrm_db-data:/data -v $(pwd):/backup alpine tar czf /backup/db-volume.tar.gz /data
```

---

## 12. 모니터링 / 로그

### 12.1 헬스체크 엔드포인트

```bash
curl http://localhost:3001/api/health
```

**정상 응답:**
```json
{
  "status": "ok",
  "db": "connected",
  "uptime": 3600.5,
  "env": "production"
}
```

**DB 미연결 (503):**
```json
{
  "status": "error",
  "db": "disconnected"
}
```

### 12.2 로그 위치

- **PM2**: `./logs/error.log`, `./logs/out.log`
- **Docker**: `docker-compose logs -f app`
- **DB 로그**: `/var/log/mysql/error.log`

### 12.3 시스템 통계 (관리자 API)

```http
GET /api/admin/stats
GET /api/admin/access-logs
GET /api/admin/top-paths
GET /api/admin/daily-logs
GET /api/admin/token-monitor
```

### 12.4 자동 정리 작업

- **access_logs**: 매일 새벽 3시, 90일 초과 레코드 삭제 (자동)
- **token_blacklist**: 만료된 JTI 자동 정리
- **refresh_tokens**: revoked 레코드 자동 정리

### 12.5 외부 모니터링 추천

- **Uptime Robot** / **UptimeKuma**: `GET /api/health` 5분 간격 체크
- **Sentry**: 에러 추적 (별도 통합 필요)
- **Prometheus + Grafana**: 시스템 메트릭

---

## 13. 업그레이드 절차

### 13.1 사전 체크리스트

- [ ] DB 백업 완료
- [ ] 업로드 파일 백업 완료
- [ ] `.env` 백업
- [ ] 변경 사항 review (CHANGELOG / git log)
- [ ] 점검 공지 발행 (게시판)

### 13.2 업그레이드 절차 (무중단 — PM2)

```bash
cd /path/to/oci-crm-ai
git fetch origin
git log HEAD..origin/master --oneline   # 변경 사항 확인
git pull
npm install --production
pm2 reload oci-crm-ai                    # zero-downtime 재시작
```

### 13.3 업그레이드 절차 (Docker)

```bash
git pull
docker-compose build --no-cache
docker-compose up -d
```

### 13.4 롤백

```bash
# 코드 롤백
git reset --hard <previous-commit-hash>
pm2 reload oci-crm-ai

# DB 롤백 (백업에서 복구)
mysql -u oci_crm_user -p oci_crm < backup_previous.sql
```

### 13.5 DB 스키마 변경 시

대부분의 스키마 변경은 `src/initTables.js`의 `ALTER TABLE IF NOT EXISTS` 패턴으로 자동 처리됨. 대규모 변경이 있을 시:

1. 백업 먼저
2. 변경 SQL을 별도 마이그레이션 파일로 작성
3. 단계적 롤아웃

---

## 📎 부록 A: 보안 체크리스트

### 운영 환경 필수 점검

- [ ] 모든 시크릿이 강력하게 생성됨 (`openssl rand -hex 64`)
- [ ] `.env` 파일 권한이 `600`으로 설정됨 (`chmod 600 .env`)
- [ ] DB 사용자가 최소 권한만 가짐 (root 사용 금지)
- [ ] `ALLOWED_ORIGINS`가 운영 도메인만 포함
- [ ] HTTPS만 허용 (HTTP → HTTPS 리다이렉트)
- [ ] Helmet CSP 헤더 활성화 (`server.js` 확인)
- [ ] Rate Limit 활성화
- [ ] 모든 admin 계정 2FA 활성화
- [ ] Google OAuth Redirect URI가 운영 도메인으로 등록
- [ ] 정기 백업 cron 등록
- [ ] 방화벽: 3306 (DB)는 외부 접근 차단

---

## 📎 부록 B: 트러블슈팅 빠른 참조

| 문제 | 해결 명령 |
|------|----------|
| DB 연결 실패 | `sudo systemctl status mariadb` |
| 포트 3001 점유 | `sudo lsof -i :3001` → `kill -9 <pid>` |
| PM2 죽음 | `pm2 logs --err` |
| 디스크 가득 | `du -sh public/uploads logs` |
| 메모리 누수 | `pm2 monit` → 1G 도달 시 자동 재시작 |
| OAuth 콜백 실패 | Cloud Console의 Redirect URI 확인 |

> 상세 트러블슈팅은 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) 참조

---

## 📎 부록 C: 권한 (RBAC) 매트릭스

| 역할 | role 값 | 레벨 | 주요 권한 |
|------|---------|------|----------|
| 매니저 | `manager` | 1 | 본인 리드/고객 CRUD |
| 팀장 | `team_lead` | 2 | 팀 분석, 리포트 |
| 경영진 | `executive` | 3 | 관리자 콘솔 조회 |
| IT운영관리자 | `admin` | 4 | 사용자/라벨/토큰 관리 |
| 시스템담당자 | `superadmin` | 5 | 개발자 옵션, 기능 플래그 |

권한 변경:
```sql
UPDATE users SET role='admin' WHERE id=<user_id>;
```

---

## 📎 부록 D: 자주 사용하는 SQL

### D.1 사용자 비활성화

```sql
UPDATE users SET is_active=0 WHERE id=<user_id>;
```

### D.2 토큰 한도 증액

```sql
UPDATE team_members SET monthly_token_limit=1000000 WHERE id=<member_id>;
```

### D.3 모든 사용자 OTP 강제 활성화

```sql
UPDATE users SET otp_enabled=1 WHERE role IN ('admin','superadmin');
```

### D.4 통계 — 일일 신규 리드

```sql
SELECT DATE(created_at) as date, COUNT(*) as count
FROM leads
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at);
```

### D.5 통계 — 사용자별 AI 토큰 사용량 (이번 달)

```sql
SELECT u.username, SUM(a.total_tokens) as tokens_used
FROM ai_usage a
JOIN users u ON u.id = a.user_id
WHERE a.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
GROUP BY u.id
ORDER BY tokens_used DESC;
```

---

## 📮 문의

- **시스템 문제**: DevOps 팀
- **신규 기능 제안**: 개발팀
- **API 키 발급**: IT 운영관리자
