# Next.js 16 Admin — Oracle Cloud ARM VM 배포용 이미지.
#
# NEXT_PUBLIC_API_URL 은 next.config.ts 의 rewrites() 에서만 쓰이고 src/ 어디에도
# 없다. rewrites 는 `next build` 시점에 routes-manifest.json 으로 구워지므로
# 런타임 env 로는 바뀌지 않는다. 그래서 런타임 ENV 가 아니라 build ARG 다.
#
# 기본값이 http://backend:8080 인 이유: admin 과 backend 가 같은 compose 네트워크
# (truewords_net) 에 있어 서비스 DNS 로 바로 닿는다. 공개 도메인을 거치면
# 브라우저 → Cloudflare → admin → Cloudflare → backend 로 왕복이 한 번 더 는다.

# === Stage 1: deps ===
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# === Stage 2: builder ===
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL=http://backend:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# === Stage 3: runner ===
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone 산출물은 public 과 .next/static 을 포함하지 않는다. CDN 을 쓰지
# 않으므로 server.js 가 직접 서빙하도록 두 디렉토리를 수동 복사한다.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
