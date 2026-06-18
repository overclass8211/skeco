# 🔒 보안 가이드 (Security Guide)

> **버전**: v5.0 | **대상**: 보안 담당, 운영자, 개발자

---

## 1. 보안 아키텍처 (다층 방어)

```
[Network] HTTPS + HSTS
   ↓
[Application] Helmet (CSP, XFO, ...) + CORS + Rate Limit
   ↓
[Authentication] JWT + Refresh Rotation + 2FA + WebAuthn
   ↓
[Authorization] RBAC 5단계 + Feature Guard + API Level Map
   ↓
[Data] AES-256-GCM 암호화 + SQL Injection 방어 + XSS escape
   ↓
[Audit] access_logs + dev_features_audit + admin_label_audit
```

---

## 2. 인증 (Authentication)

### 2.1 비밀번호
- **bcrypt** cost=10
- 저장 시 항상 해싱 (원문 X)
- 최소 8자 (정책 변경 가능)

### 2.2 JWT Access Token
- **만료**: 15분 (짧게 — 탈취 위험 최소화)
- **서명**: HS256 (`JWT_SECRET`)
- **Payload**: `{ id, username, role, jti }` (민감 정보 X)
- **저장**: 클라이언트 sessionStorage / localStorage

### 2.3 Refresh Token
- **만료**: 7일
- **저장**: HttpOnly 쿠키 (SameSite=Lax) + DB (bcrypt 해시)
- **회전 (Rotation)**: 사용 시마다 새 토큰 발급, 기존 revoke
- **탈취 감지**: 이미 revoked된 토큰으로 갱신 시도 → 모든 세션 무효화

### 2.4 2FA (TOTP)
- **알고리즘**: TOTP (RFC 6238)
- **Secret**: AES-256-GCM 암호화 저장
- **호환**: Google Authenticator, Authy 등
- **백업 코드**: 사용자가 별도 보관 (향후 기능)

### 2.5 WebAuthn (생체인증)
- **표준**: WebAuthn Level 2
- **사용처**: Fingerprint, FaceID, 보안 키
- **저장**: 공개키만 (자격증명 ID)

### 2.6 Token Blacklist
- **목적**: 로그아웃 시 즉시 무효화
- **저장**: `token_blacklist` 테이블 (JTI 키)
- **TTL**: 토큰 만료 시까지 (자동 정리)

---

## 3. 권한 (Authorization)

### 3.1 RBAC 5단계
| Level | Role | 권한 |
|-------|------|------|
| 1 | manager | 본인 담당 리드 CRUD |
| 2 | team_lead | + 팀 분석, 리포트 |
| 3 | executive | + 관리자 콘솔 (조회) |
| 4 | admin | + 사용자/라벨/토큰/로고 관리 |
| 5 | superadmin | + 개발자 옵션, 기능 플래그 |

### 3.2 API Level Map (`src/services/authService.js`)
```javascript
const API_LEVEL_MAP = {
  '/admin/team-members': 4,
  '/admin/menu-config':  4,
  '/admin/labels':       4,
  '/admin/logo':         4,
  '/admin':              3,
  '/team':               2,
  '/reports':            2,
  '/report-builder':     2,
};
```

미들웨어 `autoLevel`이 자동 검증.

### 3.3 Data Scope
- **Manager**: 본인 담당 데이터만 (`WHERE assigned_to = current_user`)
- **Team Lead+**: 전체 데이터
- 리포트 빌더 백엔드에서 자동 스코프 필터링

### 3.4 Feature Guard
- **목적**: 토글 OFF 기능 백엔드 차단 (UI 우회 방지)
- **위치**: `src/middleware/featureGuard.js`
- **방식**: `requireFeature('feature_key')` 미들웨어
- 적용 안 함 (자기 발 묶기 위험): `/api/auth`, `/api/admin`, 핵심 CRUD

---

## 4. 데이터 보호

### 4.1 AES-256-GCM 암호화
- **키**: `ENCRYPTION_KEY` (32바이트, openssl rand -hex 32)
- **IV**: 매번 랜덤 (12바이트)
- **인증 태그**: 16바이트 (변조 감지)
- **저장 형식**: base64 (`IV + Tag + Encrypted`)

**암호화 대상**:
- `google_oauth_tokens.access_token`, `refresh_token`
- `users.otp_secret`
- (향후) PII 추가 가능

### 4.2 SQL Injection 방어
- **모든 쿼리**: Parameterized (`?` placeholder)
- **mysql2 prepared statement** 사용
- 동적 컬럼명: whitelist 기반 (예: 리포트 빌더 FIELDS)

```javascript
// ✅ 안전
pool.query('SELECT * FROM leads WHERE id = ?', [id]);

// ❌ 금지
pool.query(`SELECT * FROM leads WHERE id = ${id}`);
```

### 4.3 XSS 방어
- **백엔드**: Helmet CSP (script-src 'self' + 외부 CDN 화이트리스트)
- **프론트**: `esc()` 헬퍼 — innerHTML 사용 전 모두 escape
- **사용자 입력 표시**: textContent 우선, innerHTML 시 esc()

```javascript
// ✅ 안전
element.textContent = userInput;
element.innerHTML = `<div>${esc(userInput)}</div>`;

// ❌ 금지
element.innerHTML = `<div>${userInput}</div>`;
```

### 4.4 CSRF 방어
- **Refresh Token**: HttpOnly + SameSite=Lax 쿠키
- **CORS**: ALLOWED_ORIGINS 화이트리스트
- **State 검증**: OAuth state 파라미터

### 4.5 SVG XSS 방어
- **svgo**: script 태그 + on* 이벤트 핸들러 자동 제거
- **저장 전 sanitize** (`removeScriptElement`, `removeAttrs on.*`)

### 4.6 Image Bomb 방어
- **sharp limitInputPixels**: 25M (5000×5000)
- **dimension 검증**: metadata 별도 체크
- **파일 크기**: multer 2MB 제한 (로고)

### 4.7 Polyglot 파일 방어
- **Magic Bytes 검증**: 파일 헤더 시그니처 확인
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - JPEG: `FF D8 FF`
  - SVG: `<?xml` 또는 `<svg`
- **불일치 시**: 즉시 거부 + 파일 삭제

---

## 5. 네트워크 보안

### 5.1 HTTPS / HSTS
- **강제**: HTTP → 301 HTTPS 리다이렉트
- **HSTS**: `max-age=31536000; includeSubDomains`
- **TLS**: 1.2+ (Nginx 설정)

### 5.2 CORS
- **화이트리스트**: `ALLOWED_ORIGINS` 환경변수
- **Credentials**: `include` (HttpOnly 쿠키 필요)

### 5.3 Rate Limit
| 환경 | 일반 API | AI API |
|------|---------|--------|
| Production | 300/15min | 20/min |
| Development | 3000/15min | 100/min |
| Test | skip | skip |

### 5.4 Helmet CSP
```javascript
{
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", ...],
  styleSrc: ["'self'", "'unsafe-inline'", ...],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'", "wss:", "https://*.daum.net", ...],
  frameAncestors: ["'none'"],
}
```

---

## 6. 감사 (Audit)

### 6.1 access_logs
- **기록**: 모든 API 호출 (user_id, method, path, status, duration_ms, ip)
- **보존**: 90일 (자동 정리)
- **분석**: `/api/admin/access-logs`, `/admin/top-paths`, `/admin/daily-logs`

### 6.2 admin_label_audit
- **기록**: 다국어 라벨 변경 (old/new, changed_by, timestamp)
- **보존**: 영구

### 6.3 dev_features_audit
- **기록**: 기능 토글 변경 (old_enabled, new_enabled, reason)
- **보존**: 영구 (Deprecated 토글 삭제 시 함께 삭제)
- **UI 조회**: 개발자 옵션 > 🕒 변경 이력

### 6.4 token_recharge_log
- **기록**: AI 토큰 충전 (auto/admin/manual)

---

## 7. 비밀 관리 (Secrets)

### 7.1 환경변수 (.env)
- **파일 권한**: `chmod 600`
- **git 제외**: `.gitignore` 등록
- **공유 금지**: Slack/Email 평문 전송 금지

### 7.2 시크릿 생성
```bash
# JWT_SECRET, REFRESH_TOKEN_SECRET (64자)
openssl rand -hex 64

# ENCRYPTION_KEY (32자, AES-256 정확히 필요)
openssl rand -hex 32
```

### 7.3 문서/주석
- 실제 키 값 절대 포함 금지
- 모든 예시는 placeholder (`<your-key>`)

---

## 8. 운영 보안 체크리스트

### 8.1 배포 전
- [ ] 모든 시크릿 강력 생성 (openssl)
- [ ] `.env` 권한 600
- [ ] DB 사용자 최소 권한 (root X)
- [ ] CORS 화이트리스트
- [ ] HTTPS 강제
- [ ] Helmet CSP 활성
- [ ] Rate Limit 활성

### 8.2 운영 중
- [ ] admin 계정 2FA 활성 (강제)
- [ ] OAuth Redirect URI 운영 도메인
- [ ] 정기 백업 cron
- [ ] 방화벽: 3306 외부 차단
- [ ] SSL 자동 갱신 (certbot)
- [ ] 정기 보안 패치 (`apt update`)

### 8.3 사고 대응
- [ ] 패스워드 유출 의심 → 사용자에게 강제 패스워드 변경
- [ ] 토큰 유출 의심 → `UPDATE refresh_tokens SET revoked=1` + JWT_SECRET 변경
- [ ] DB 침해 의심 → 즉시 격리 + 백업 복원 + 조사

---

## 9. 알려진 위험 및 완화

| 위험 | 완화 방안 |
|------|----------|
| Refresh Token 재사용 공격 | DB 저장 + rotation + revoked 감지 시 전체 무효화 |
| JWT 탈취 | 짧은 만료 (15분) + 블랙리스트 |
| OTP 우회 | TOTP 시간 동기화 + RFC 6238 표준 |
| AI 토큰 남용 | 사용자별 월 한도 + 자동충전 한도 |
| 외부 API 키 노출 | 환경변수만, 코드 X |
| SVG XSS | svgo sanitize |
| Image Bomb | sharp limitInputPixels |
| sharp native 취약점 | 정기 업데이트 (`npm audit fix`) |

---

## 10. 보안 책임자 연락처

- **시스템 보안**: IT 운영팀
- **데이터 보안**: 정보보호 담당
- **사고 대응**: DevOps + 보안팀 합동

---

## 📎 참고 표준

- OWASP Top 10
- WCAG 2.1 (접근성)
- ISO 27001 (정보보안)
- RFC 6238 (TOTP)
- RFC 7519 (JWT)
- WebAuthn Level 2 (W3C)
