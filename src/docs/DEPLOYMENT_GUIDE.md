# 🚀 배포 가이드 (Deployment Guide)

> **버전**: v5.0 | **대상**: DevOps, 시스템 관리자

---

## 1. 배포 옵션

| 방식 | 환경 | 권장 |
|------|------|------|
| **PM2 + Nginx** | GCP / AWS VM | ⭐ 운영 (현재) |
| **Docker Compose** | 단일 호스트 | ⭐ 개발 / 스테이징 |
| **Kubernetes** | 클러스터 | 향후 (Multi-tenant 후) |

---

## 2. 사전 준비

### 2.1 시스템 요구사항
- **CPU**: 4 vCPU 이상
- **RAM**: 4GB 이상
- **디스크**: 50GB SSD
- **OS**: Ubuntu 22.04 / Debian 11+
- **포트**: 80, 443 (HTTPS), 3306 (DB 내부)

### 2.2 외부 의존성
- ✅ MariaDB 11 설치
- ✅ Node.js 20 LTS
- ✅ PM2 (`npm install -g pm2`)
- ✅ Nginx (Reverse Proxy + SSL)
- ✅ Certbot (Let's Encrypt)
- ✅ Google Cloud Console (OAuth)
- ✅ Gemini API Key

---

## 3. 신규 설치 (Production)

### 3.1 시스템 패키지
```bash
sudo apt update
sudo apt install -y mariadb-server nginx certbot python3-certbot-nginx git
sudo systemctl enable mariadb nginx
```

### 3.2 Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
```

### 3.3 PM2
```bash
sudo npm install -g pm2
pm2 --version
```

### 3.4 MariaDB 초기 설정
```bash
sudo mysql_secure_installation

# DB + 사용자 생성
sudo mysql -u root <<EOF
CREATE DATABASE oci_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'oci_crm_user'@'localhost' IDENTIFIED BY '<강력한_비밀번호>';
GRANT ALL PRIVILEGES ON oci_crm.* TO 'oci_crm_user'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 3.5 코드 배포
```bash
cd /opt
sudo git clone https://github.com/overclass8211/oci-ai.git
sudo chown -R $USER:$USER oci-ai
cd oci-ai

# 의존성 설치 (sharp native module 포함 ~30MB)
npm install --production

# 스키마 적용
mysql -u oci_crm_user -p oci_crm < schema.sql

# 환경변수 설정
cp .env.example .env
nano .env
```

### 3.6 환경변수 (.env)
```env
# 서버
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://crm.yourdomain.com

# DB
DB_HOST=localhost
DB_PORT=3306
DB_USER=oci_crm_user
DB_PASSWORD=<강력한_비밀번호>
DB_NAME=oci_crm

# JWT — openssl rand -hex 64 로 생성
JWT_SECRET=<64자 hex>
REFRESH_TOKEN_SECRET=<64자 hex>
ACCESS_TOKEN_EXPIRES=15m
REFRESH_TOKEN_EXPIRES=7d

# AES-256 — openssl rand -hex 32
ENCRYPTION_KEY=<32자 hex>

# Gemini AI
GEMINI_API_KEY=<Google AI Studio>

# Google OAuth
GOOGLE_CLIENT_ID=<XXX.apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<GOCSPX-XXX>
GOOGLE_REDIRECT_URI=https://crm.yourdomain.com/api/google/callback

# 선택
KAKAO_MAP_KEY=<JavaScript_KEY>
```

### 3.7 PM2 실행
```bash
# ecosystem.config.js 생성
cat > ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: 'oci-crm',
    script: './server.js',
    env: { NODE_ENV: 'production', PORT: 3000 },
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1G',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
EOF

mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # systemd 등록 안내 명령 실행
```

### 3.8 Nginx 설정
```nginx
# /etc/nginx/sites-available/oci-crm
server {
    listen 443 ssl http2;
    server_name crm.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/crm.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.yourdomain.com/privkey.pem;

    client_max_body_size 30M;  # 회의록 25MB + 여유

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 1000s;  # SSE + 긴 STT
    }

    # AI SSE 스트리밍
    location /api/ai/chat {
        proxy_pass http://localhost:3000;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 1000s;
    }
}

server {
    listen 80;
    server_name crm.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/oci-crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3.9 SSL 인증서 (Let's Encrypt)
```bash
sudo certbot --nginx -d crm.yourdomain.com
sudo certbot renew --dry-run    # 자동 갱신 검증
```

### 3.10 Google Cloud Console
1. https://console.cloud.google.com/ → 새 프로젝트
2. APIs 활성화: Google Calendar API, Gmail API
3. OAuth 동의 화면 설정 + 테스트 사용자 추가
4. 사용자 인증 정보 > OAuth 클라이언트 ID 생성
   - 승인된 리디렉션 URI: `https://crm.yourdomain.com/api/google/callback`
5. CLIENT_ID, CLIENT_SECRET을 `.env`에 설정

### 3.11 첫 admin 계정
```bash
# 회원가입 후 DB에서 role 변경
mysql -u oci_crm_user -p oci_crm -e "
UPDATE users SET role='superadmin' WHERE id=1;
"
```

---

## 4. Docker Compose 배포 (대안)

```yaml
# docker-compose.yml (제공됨)
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - uploads:/app/public/uploads

  db:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MARIADB_DATABASE: ${DB_NAME}
      MARIADB_USER: ${DB_USER}
      MARIADB_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db-data:/var/lib/mysql
      - ./schema.sql:/docker-entrypoint-initdb.d/01_schema.sql:ro
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      retries: 5

volumes:
  db-data:
  uploads:
```

실행:
```bash
docker-compose up -d
docker-compose logs -f app
```

---

## 5. 정기 배포 (업데이트)

### 5.1 표준 배포 (~1분)
```bash
cd /opt/oci-ai
git pull origin master
npm install --production    # 새 의존성 있을 때만
pm2 restart oci-ai --update-env
pm2 logs oci-ai --lines 20  # 부팅 확인
```

### 5.2 무중단 배포 (PM2 cluster 모드 시)
```bash
git pull origin master
npm install --production
pm2 reload oci-ai           # zero-downtime
```

### 5.3 헬스체크 (배포 후 필수)
```bash
curl -s http://localhost:3000/api/health
# → { "status": "ok", "db": "connected" }
```

---

## 6. 롤백

### 6.1 코드 롤백
```bash
cd /opt/oci-ai
git log --oneline -10
git reset --hard <previous-commit>
pm2 reload oci-ai
```

### 6.2 DB 롤백 (백업에서)
```bash
mysql -u oci_crm_user -p oci_crm < /backup/backup_YYYYMMDD.sql
```

---

## 7. 백업 정책

### 7.1 자동 백업 (crontab)
```cron
# 매일 새벽 2시 DB 백업
0 2 * * * mysqldump -u oci_crm_user -p<password> oci_crm | gzip > /backup/oci_crm_$(date +\%Y\%m\%d).sql.gz

# 매주 일요일 업로드 백업
0 3 * * 0 tar czf /backup/uploads_$(date +\%Y\%m\%d).tar.gz /opt/oci-ai/public/uploads/

# 30일 이상된 백업 삭제
0 4 * * * find /backup -name "*.gz" -mtime +30 -delete
```

---

## 8. 모니터링

### 8.1 헬스체크 (외부)
- Uptime Robot / UptimeKuma → `GET /api/health` 5분 주기
- 응답 시간 + status 모니터링

### 8.2 PM2 모니터링
```bash
pm2 monit              # 실시간
pm2 list               # 상태
pm2 logs --err         # 에러만
```

### 8.3 DB 모니터링
```bash
# 접속 수
mysql -u root -p -e "SHOW PROCESSLIST;"

# 슬로우 쿼리
sudo tail -f /var/log/mysql/slow.log
```

---

## 9. 트러블슈팅 빠른 참조

| 증상 | 명령 |
|------|------|
| 포트 점유 | `sudo lsof -i :3000` |
| PM2 죽음 | `pm2 logs --err` |
| 디스크 가득 | `du -sh /opt/oci-ai/public/uploads /opt/oci-ai/logs` |
| DB 연결 실패 | `sudo systemctl status mariadb` |
| Nginx 오류 | `sudo nginx -t && sudo tail -f /var/log/nginx/error.log` |
| sharp 누락 | `npm rebuild sharp` |

상세 → [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md)

---

## 10. 보안 체크리스트 (배포 직후)

- [ ] HTTPS 강제 (HTTP → 301 리다이렉트)
- [ ] `.env` 파일 권한 `chmod 600`
- [ ] DB 사용자 최소 권한 (root 미사용)
- [ ] `ALLOWED_ORIGINS` 운영 도메인만
- [ ] Helmet CSP 적용 확인
- [ ] Rate Limit 활성화
- [ ] 모든 admin 계정 2FA
- [ ] Google OAuth Redirect URI 운영 도메인
- [ ] 정기 백업 cron 등록
- [ ] 방화벽 (3306 외부 차단)
- [ ] SSL 자동 갱신 (certbot)
