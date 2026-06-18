# 🛠 운영 매뉴얼 (Operation Manual)

> **버전**: v5.0 | **대상**: 시스템 운영 담당자

---

## 1. 일상 운영 작업

### 1.1 매일 (자동)
- ✅ access_logs 90일 초과 자동 삭제 (새벽 3시)
- ✅ FX 환율 자동 갱신
- ✅ Gmail 동기화 (5분 주기, gmail.sync 토글 ON 시)
- ✅ Service Worker 캐시 자동 갱신

### 1.2 매일 (수동 확인)
```bash
# 1) 헬스체크
curl -s https://crm.yourdomain.com/api/health

# 2) PM2 상태
pm2 list
pm2 logs oci-crm --lines 20 --err

# 3) 디스크 사용량
df -h
du -sh /opt/oci-ai/public/uploads /opt/oci-ai/logs

# 4) DB 상태
sudo mysql oci_crm -e "SELECT COUNT(*) FROM access_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY);"
```

### 1.3 매주
- 백업 파일 확인 (`/backup/`)
- AI 토큰 사용량 리뷰 (관리자 콘솔)
- 활성 사용자 수 확인

### 1.4 매월
- 보안 패치 (`sudo apt update && sudo apt upgrade`)
- npm 의존성 점검 (`npm audit`)
- SSL 인증서 갱신 확인 (자동 — certbot)

---

## 2. 사용자 관리

### 2.1 신규 사용자 생성
```sql
-- 방법 A: UI 회원가입 + 권한 변경
UPDATE users SET role='manager' WHERE id=<id>;

-- 방법 B: 직접 INSERT
INSERT INTO users (username, email, password_hash, role, full_name, is_active)
VALUES ('user1', 'user1@oci.com', '<bcrypt>', 'manager', '홍길동', 1);
```

### 2.2 비밀번호 리셋
```bash
# bcrypt 해시 생성
node -e "console.log(require('bcryptjs').hashSync('TempPassword123!', 10))"

# DB 업데이트
mysql -u oci_crm_user -p oci_crm -e "
UPDATE users SET password_hash='<hash>' WHERE username='user1';
"
```

### 2.3 사용자 비활성화
```sql
UPDATE users SET is_active=0 WHERE id=<id>;
```

### 2.4 강제 로그아웃 (모든 세션)
```sql
UPDATE refresh_tokens SET revoked=1, revoked_at=NOW() WHERE user_id=<id>;
```

---

## 3. 기능 토글 (Configuration Management)

### 3.1 고객사 패키지 적용
관리자 콘솔 > 개발자 옵션 > 📦 패키지 적용:
- **Minimal**: PoC, 소규모 (16개 활성)
- **Standard** (권장): 일반 영업조직 (24개 활성)
- **Premium**: 모든 기능 (33개 활성)

### 3.2 개별 토글 변경
- 위험도 high/critical → 확인 모달
- 의존성 위반 → 자동 차단 (force=1로 강제 가능)
- 모든 변경 audit log 자동 기록

### 3.3 매니페스트에 신규 기능 추가
1. `src/data/featureRegistry.js` 에 항목 추가
2. 코드에서 `data-feature` 또는 `requireFeature()` 사용
3. `pm2 restart oci-crm` → 자동 DB 동기화

### 3.4 Deprecated 기능 정리
매니페스트에서 제거 후:
- DB 자동으로 `is_deprecated=1` 표시
- UI > Deprecated 섹션 → 🗑 정리 버튼

---

## 4. 다국어 라벨 관리

관리자 콘솔 > 워드 사전:
- 4개 언어 동시 편집 (한/영/일/중)
- Scope 선택 (leads, customers 등)
- 변경 즉시 적용 (sessionStorage 10분 캐시)
- 변경 이력 audit (`admin_label_audit`)

---

## 5. AI 토큰 관리

### 5.1 사용량 모니터링
- 관리자 콘솔 > 토큰 모니터링
- 사용자별 / 일별 통계

### 5.2 한도 조정
```sql
-- 단일 사용자
UPDATE team_members SET monthly_token_limit=1000000 WHERE id=<id>;

-- 전체 기본값 (신규 사용자)
UPDATE system_settings SET setting_value='1000000' WHERE setting_key='default_monthly_token_limit';
```

### 5.3 자동충전 설정
- UI에서 사용자별 `auto_recharge_enabled`, `auto_recharge_threshold`, `auto_recharge_amount` 설정

---

## 6. 로고 관리

설정 > 🎨 로고 관리:
- PNG/JPG/SVG 업로드 (2MB 이하)
- Sharp + svgo 자동 최적화 (trim, sanitize)
- 권장: 가로 480px 이상, 여백 없이
- 기본 로고로 복원 버튼

---

## 7. 백업 / 복구

### 7.1 정기 백업 (crontab — 이미 설정됨)
```cron
0 2 * * * mysqldump -u oci_crm_user -p<password> oci_crm | gzip > /backup/oci_crm_$(date +\%Y\%m\%d).sql.gz
0 3 * * 0 tar czf /backup/uploads_$(date +\%Y\%m\%d).tar.gz /opt/oci-ai/public/uploads/
0 4 * * * find /backup -name "*.gz" -mtime +30 -delete
```

### 7.2 수동 백업
```bash
# DB
mysqldump -u oci_crm_user -p oci_crm > /backup/manual_$(date +%Y%m%d).sql

# 업로드 (오디오 + 로고)
tar czf /backup/uploads_$(date +%Y%m%d).tar.gz /opt/oci-ai/public/uploads/
```

### 7.3 복구
```bash
# DB 복구
gunzip < /backup/oci_crm_20260518.sql.gz | mysql -u oci_crm_user -p oci_crm

# 업로드 복구
tar xzf /backup/uploads_20260518.tar.gz -C /
```

---

## 8. 배포 / 업데이트

### 8.1 표준 배포
```bash
cd /opt/oci-ai
git pull origin master
npm install --production
pm2 restart oci-crm --update-env
pm2 logs oci-crm --lines 20
```

### 8.2 헬스체크
```bash
curl -s http://localhost:3000/api/health
# → { "status": "ok", "db": "connected" }
```

### 8.3 롤백
```bash
git reset --hard <previous-commit>
pm2 reload oci-crm
```

---

## 9. 모니터링 / 알람

### 9.1 외부 모니터링
- Uptime Robot / UptimeKuma → `GET /api/health` 5분 주기
- Slack 알림 연동 권장

### 9.2 PM2 모니터링
```bash
pm2 monit              # 실시간 CPU/Memory
pm2 list               # 상태
pm2 logs --err         # 에러만
pm2 show oci-crm       # 상세
```

### 9.3 시스템 모니터링
```bash
# CPU/메모리
top
htop

# 디스크
df -h
du -sh /var/lib/mysql

# 네트워크
ss -tlnp | grep node

# 메모리 누수 확인
ps aux | grep node
```

### 9.4 DB 모니터링
```sql
-- 접속 수
SHOW STATUS LIKE 'Threads_connected';

-- 슬로우 쿼리
SHOW VARIABLES LIKE 'slow_query_log';

-- DB 크기
SELECT table_name, ROUND(data_length/1024/1024,2) AS size_mb
FROM information_schema.tables
WHERE table_schema='oci_crm'
ORDER BY data_length DESC LIMIT 10;
```

---

## 10. 자주 사용하는 SQL

### 10.1 통계
```sql
-- 일일 신규 리드
SELECT DATE(created_at) AS d, COUNT(*) AS cnt
FROM leads
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at);

-- 사용자별 AI 토큰 (이번 달)
SELECT u.username, SUM(a.total_tokens) AS tokens
FROM ai_usage a
JOIN users u ON u.id=a.user_id
WHERE a.created_at >= DATE_FORMAT(NOW(),'%Y-%m-01')
GROUP BY u.id
ORDER BY tokens DESC;

-- 활성 사용자 (최근 7일)
SELECT COUNT(DISTINCT user_id) FROM access_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY);
```

### 10.2 데이터 정리
```sql
-- access_logs 강제 정리
DELETE FROM access_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- ai_usage 90일 이상
DELETE FROM ai_usage WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- OPTIMIZE (디스크 정리)
OPTIMIZE TABLE access_logs;
```

---

## 11. 비상 대응

### 11.1 서비스 다운
```bash
# 1) 상태 확인
pm2 list
curl http://localhost:3000/api/health

# 2) 재시작 시도
pm2 restart oci-crm

# 3) 로그 확인
pm2 logs --err --lines 100

# 4) DB 확인
sudo systemctl status mariadb

# 5) Nginx 확인
sudo systemctl status nginx
sudo nginx -t
```

### 11.2 DB 침해 의심
1. **즉시 격리**: Nginx maintenance 모드
2. **세션 무효화**: `UPDATE refresh_tokens SET revoked=1;`
3. **JWT_SECRET 재발급**: openssl + `.env` 업데이트 + 재시작
4. **백업에서 복원**: 침해 이전 백업
5. **조사**: access_logs, audit log 분석

### 11.3 토큰 폭주
```sql
-- 의심 사용자 확인
SELECT user_id, COUNT(*), SUM(total_tokens)
FROM ai_usage
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
GROUP BY user_id
ORDER BY SUM(total_tokens) DESC;

-- 즉시 차단
UPDATE team_members SET monthly_token_limit=0 WHERE id=<id>;
```

---

## 12. 점검 체크리스트

### 12.1 일일
- [ ] PM2 status: online
- [ ] DB 접속 가능
- [ ] 디스크 < 80%
- [ ] 메모리 < 80%
- [ ] 에러 로그 없음 (`pm2 logs --err`)

### 12.2 주간
- [ ] 백업 파일 정상 생성
- [ ] AI 토큰 사용량 정상
- [ ] 활성 사용자 수 정상
- [ ] SSL 인증서 만료일 (30일+ 남음)

### 12.3 월간
- [ ] 보안 패치 적용
- [ ] `npm audit` 검사
- [ ] DB 백업 복원 테스트 (사본)
- [ ] 로그 분석 (access_logs)

---

## 📎 문의 및 에스컬레이션

| 단계 | 담당 |
|------|------|
| 1차 | 사용자 → 사내 IT 운영팀 |
| 2차 | IT 운영팀 → DevOps / 시스템 담당자 (Superadmin) |
| 3차 | DevOps → 개발팀 (코드 버그) |
| 4차 | 개발팀 → 외부 (Google Cloud Support, Gemini API) |
