import path from "node:path";
import type { NextConfig } from "next";

// rewrites/redirects는 빌드 시 고정된다. 운영 이미지는 각 origin을 build ARG로 받는다.
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  // E2E에서 웹/관리자 쿠키를 hostname으로 분리한다. 개발 리소스만 허용한다.
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  // 개발 서버도 검색어가 포함된 URL을 터미널에 남기지 않는다. 다른 경로의 로그는 유지한다.
  logging: {
    incomingRequests: { ignore: [/^\/api\/backend\/hoondok\/search(?:[/?]|$)/, /^\/hoondok\/search(?:[/?]|$)/] },
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@truewords/api-client-ts"],
  experimental: { proxyClientMaxBodySize: "200mb" },
  async headers() {
    return [
      // 훈독 베타는 권리 미확정 정본을 싣는다. layout metadata.robots 와 함께 색인을 막는다.
      { source: "/hoondok/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/hoondok", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // 훈독 self-host 폰트는 파일명에 버전을 고정해 1년 immutable 로 둔다 (PLAN-HD-001 Phase 3 C). public 기본은 max-age=0 이다.
      {
        source: "/hoondok/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // 히어로·썸네일 사진도 같은 정적 자산이다 — 내용이 바뀌면 파일명을 바꾼다 (2026-09-22 DES-PWA-003-Q2 되돌림).
      {
        source: "/hoondok/photos/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // 낭독 목소리 견본(PLAN-HD-011)도 정적 자산이다 — 소리를 바꾸면 파일명을 바꾼다.
      {
        source: "/hoondok/voices/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // 서비스워커·manifest 는 매 방문 재검증한다 (Phase 3 D). Cloudflare 엣지는 origin no-cache 를 따른다.
      // Service-Worker-Allowed: 스크립트가 /hoondok/ 아래 있어도 슬래시 없는 /hoondok scope 로 등록되게 한다 (C-3).
      {
        source: "/hoondok/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/hoondok" },
        ],
      },
      {
        source: "/hoondok/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
  async redirects() {
    return [
      // 기존 사용자 origin에 남은 관리 URL을 독립 관리자 앱으로 연결한다.
      ...["dashboard", "chatbots", "data-sources", "analytics", "feedback", "audit-logs", "settings"].map((route) => ({
        source: `/${route}/:path*`,
        destination: `${ADMIN_ORIGIN}/${route}/:path*`,
        permanent: false,
      })),
    ];
  },
  async rewrites() {
    return [
      { source: "/api/backend/:path*", destination: `${BACKEND_URL}/:path*` },
      // 구 클라이언트·열린 탭과 기존 URL 호환. 더 구체적인 reactions 경로가 먼저다.
      { source: "/admin/:path*", destination: `${BACKEND_URL}/admin/:path*` },
      { source: "/api/chat/messages/:path*", destination: `${BACKEND_URL}/api/chat/messages/:path*` },
      { source: "/api/chat", destination: `${BACKEND_URL}/chat` },
      { source: "/api/chat/:path*", destination: `${BACKEND_URL}/chat/:path*` },
      { source: "/api/chatbots", destination: `${BACKEND_URL}/chatbots` },
      { source: "/api/sources/:path*", destination: `${BACKEND_URL}/api/sources/:path*` },
    ];
  },
};

export default nextConfig;
