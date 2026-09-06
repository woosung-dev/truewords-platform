# 저장소 루트에서 docker build -f apps/admin/Dockerfile . 로 실행한다.
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
# uv/Flutter 설치는 프론트엔드 이미지 빌드에 필요하지 않다.
RUN pnpm install --frozen-lockfile --filter @truewords/admin...
COPY apps/admin ./apps/admin

ARG NEXT_PUBLIC_API_URL=http://backend:8080
ARG NEXT_PUBLIC_WEB_URL=https://truewords.woosung.dev
ARG NEXT_PUBLIC_ADMIN_URL=https://truewords-admin.woosung.dev
# 시연 관리자 게이트 계정(클라이언트 라우팅 힌트). 기본값 없음 — make deploy-admin 이 DEMO_ADMIN_EMAIL 을 강제한다.
ARG NEXT_PUBLIC_DEMO_ADMIN_EMAIL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL \
    NEXT_PUBLIC_DEMO_ADMIN_EMAIL=$NEXT_PUBLIC_DEMO_ADMIN_EMAIL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @truewords/admin build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# 모노레포 standalone entrypoint는 apps/admin/server.js다.
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/public ./apps/admin/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
