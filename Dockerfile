# ── 빌드 스테이지 ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── 런타임 스테이지 ───────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# 보안: non-root 사용자
RUN addgroup -S ocicrm && adduser -S ocicrm -G ocicrm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 업로드 디렉터리 생성 및 권한 설정
RUN mkdir -p public/uploads && chown -R ocicrm:ocicrm /app

USER ocicrm

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
