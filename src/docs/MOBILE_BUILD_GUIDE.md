# 📱 모바일 하이브리드 빌드 가이드 (Capacitor)

> OCI CRM AI v6.0.0 — Capacitor 기반 iOS/Android 네이티브 앱 빌드
> 작성일: 2026-05-26 (POC Phase 1)

---

## 🎯 아키텍처 한눈에

```
[ Vanilla JS SPA — public/ ]  →  [ Capacitor WebView (WKWebView/Android WebView) ]
                                                 ↓
                                  [ iOS App (.ipa) / Android App (.apk) ]
                                                 ↕
                                 HTTPS  →  Express 서버 (oci-crm.duckdns.org)
```

- **코드 재사용 95%** — 기존 `public/` 자산 그대로
- **백엔드 변경 0** — Express 서버는 PWA 와 동일하게 호출됨
- **하이브리드 모드** — `capacitor.config.json` 의 `server.url` 로 운영 서버 라이브 연결

---

## 📋 빌드 환경 요구사항

| 플랫폼 | 도구 | 비고 |
|---|---|---|
| 공통 | Node 20+, npm 10+ | `package.json` 동기 |
| Android (로컬) | Android Studio + JDK 21 | gradle 8 + |
| iOS (로컬) | macOS + Xcode 15+ + CocoaPods | Apple Silicon 권장 |
| CI 자동 빌드 | GitHub Actions | macos-14 runner (iOS) + ubuntu (Android) |

---

## 🚀 로컬 개발 워크플로우

### 1) 의존성 동기화 + 웹 자산 복사

```bash
npm install                  # Capacitor 의존성 포함
npm run cap:sync             # public/ → android/ios 양쪽 동기
```

### 2) Android 빌드 (로컬)

```bash
# Android Studio 로 열기
npm run cap:open:android

# 또는 CLI 만으로 디버그 APK 빌드
npm run cap:build:android
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### 3) iOS 빌드 (macOS 필수)

```bash
# Xcode 로 열기
npm run cap:open:ios

# CocoaPods 설치 (최초 1회)
cd ios/App && pod install
```

Xcode 안에서:
- Apple Developer 계정 연결 (Preferences > Accounts)
- Team 선택 (Targets > App > Signing & Capabilities)
- 시뮬레이터 / 실기기 선택 → ▶️ Run

### 4) 실기기 디버깅

- Android: USB 연결 + `npm run cap:run:android`
- iOS: USB 연결 + Xcode 에서 Run (개발자 모드 활성화 필요)

---

## ☁️ GitHub Actions 자동 빌드

### Trigger
- `capacitor.config.json` / `android/` / `ios/` / `public/` 변경 시 자동 실행
- 수동 실행: GitHub UI > Actions > "Capacitor Mobile Build" > Run

### 산출물
- **Android**: `oci-crm-ai-debug-{sha}.apk` (artifact, 14일 보존)
- **iOS**: 빌드 검증만 (서명/배포는 secrets 추가 후 별도 workflow)

### iOS 서명 빌드를 위한 secrets (향후 Phase)

```
IOS_DIST_CERT_P12_BASE64       # Apple 배포 인증서
IOS_DIST_CERT_PASSWORD         # 인증서 비밀번호
IOS_PROVISIONING_PROFILE       # 프로비저닝 프로파일
APPLE_TEAM_ID                  # Apple 팀 ID
APP_STORE_CONNECT_API_KEY      # App Store Connect API
```

### Android 서명 빌드 (향후 Phase)

```
ANDROID_KEYSTORE_BASE64        # 키스토어 (base64)
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

---

## 🔐 보안 정책

### 통신
- `cleartext: false` — HTTP 차단, HTTPS 만 허용
- `allowNavigation` 화이트리스트 — 외부 도메인 명시
  - `oci-crm.duckdns.org` (백엔드)
  - `*.googleapis.com`, `*.gstatic.com` (지도, 폰트)
  - `cdn.jsdelivr.net` (CDN)
  - `*.kakao.com` (Kakao Map)

### 인증 (향후 Phase)
- JWT 토큰을 **iOS Keychain / Android Keystore** 에 저장 → `@capacitor/preferences`
- 생체 인증 (Face ID / Touch ID) → `@capacitor-community/biometric-auth`

### 코드 보호
- WebView 콘솔 디버깅: Android `webContentsDebuggingEnabled` (release 시 false)
- iOS: `limitsNavigationsToAppBoundDomains` 활성화 검토

---

## 🎯 POC Phase 1 범위 (이번 commit)

| 항목 | 상태 |
|---|---|
| Capacitor 8.x 설치 | ✅ |
| `capacitor.config.json` (server.url 모드) | ✅ |
| Android 플랫폼 추가 (`android/`) | ✅ |
| iOS 플랫폼 추가 (`ios/`) | ✅ |
| `cap sync` 동작 검증 | ✅ |
| `.gitignore` 빌드 산출물 제외 | ✅ |
| npm scripts (`cap:sync`, `cap:build:android` 등) | ✅ |
| GitHub Actions workflow | ✅ |
| 로컬 빌드 가이드 | ✅ |

## 📅 향후 Phase (POC 이후)

### Phase 2 — 네이티브 기능 통합
- `@capacitor-community/app-shortcuts` — iOS Quick Actions + Android Shortcuts
  - 회의록 AI / 명함 촬영 동적 등록
- `@capacitor/camera` — 명함 OCR 네이티브 권한
- `@capacitor/voice-recorder` — 회의록 백그라운드 녹음
- Deep Link (`oci-crm://`) 라우팅

### Phase 3 — 보안 강화
- `@capacitor/preferences` — JWT Keychain/Keystore 이관
- `@capacitor-community/biometric-auth` — Face ID/Touch ID
- SSL Pinning

### Phase 4 — 푸시 알림
- Firebase Cloud Messaging (FCM) + APNs
- `@capacitor/push-notifications`

### Phase 5 — 스토어 배포
- TestFlight (iOS) + Internal Testing (Android)
- Fastlane 자동 배포
- 첫 심사: iOS 평균 7일, Android 1-2일

---

## 🐛 트러블슈팅

### Q. `cap sync` 가 manifest.json 충돌?
A. PWA `manifest.json` 과 Capacitor 는 공존 가능. iOS WebView 는 PWA manifest 일부 무시함.

### Q. iOS Service Worker 동작 여부?
A. WKWebView 는 iOS 14+ 부터 Service Worker 지원. 단 백그라운드 동작은 제한적.

### Q. Android 빌드 실패 "JAVA_HOME not set"
A. JDK 21 설치 + `JAVA_HOME` 환경변수 설정. Capacitor 8 은 JDK 21 권장.

### Q. iOS pod install 실패
A. `gem install cocoapods` 최신 버전 + Apple Silicon Mac 은 `arch -x86_64 pod install` 필요할 수 있음.

### Q. localStorage 데이터가 앱 재시작 시 사라짐?
A. WKWebView 기본 동작은 유지됨. 추후 `@capacitor/preferences` 이관 권장.

---

## 📚 참고

- Capacitor 공식 문서: https://capacitorjs.com/docs
- iOS Quick Actions: https://developer.apple.com/documentation/uikit/menus_and_shortcuts
- Android Shortcuts: https://developer.android.com/develop/ui/views/launch/shortcuts
- App Store 심사 가이드: https://developer.apple.com/app-store/review/guidelines/
- Google Play 정책: https://play.google.com/console/about/guides/releasewithconfidence/
