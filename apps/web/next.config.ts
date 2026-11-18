import path from "node:path";
import type { NextConfig } from "next";

// rewrites/redirects는 빌드 시 고정된다. 운영 이미지는 각 origin을 build ARG로 받는다.
// 웹 루트가 훈독이다(DEC-PWA-026). 정적 자산은 경로를 그대로 public/hoondok/ 아래에 둔다 — 설치된 앱·보낸 알림·카드 이미지가
// 그 URL 을 들고 있다. 그래서 예전 화면 주소(/hoondok/*)의 308 은 아래 자산 접두를 건너뛴다.
const LEGACY_HOONDOK_PAGE =
  "/hoondok/:path((?!fonts/|icons/|photos/|cards/|mascot/|voices/|manifest\\.webmanifest$|sw\\.js$).*)";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  // E2E에서 웹/관리자 쿠키를 hostname으로 분리한다. 개발 리소스만 허용한다.
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  // 개발 서버도 검색어가 포함된 URL을 터미널에 남기지 않는다. 다른 경로의 로그는 유지한다.
  logging: {
    // 예전 주소(/hoondok/search)도 308 전에 한 번 들어오므로 함께 거른다.
    incomingRequests: {
      // OAuth 콜백 쿼리(code·state)도 남기지 않는다.
      ignore: [
        /^\/api\/backend\/hoondok\/auth\/oauth\//,
        /^\/api\/backend\/hoondok\/search(?:[/?]|$)/, /^\/search(?:[/?]|$)/, /^\/hoondok\/search(?:[/?]|$)/],
    },
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@truewords/api-client-ts"],
  experimental: { proxyClientMaxBodySize: "200mb" },
  async headers() {
    return [
      // 훈독 베타는 권리 미확정 정본을 싣는다. 웹 전체가 훈독이므로 모든 경로에 붙인다(layout metadata.robots 와 짝).
      // 다른 사이트가 로그인 상태(운영 쿠키 SameSite=None)로 화면을 틀에 넣어 클릭을 유도하지 못하게 한다(보안 점검).
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
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
      // 루트 SW(/sw.js)는 기본 최대 scope 가 `/` 라 Service-Worker-Allowed 가 필요 없다.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }] },
      // 은퇴 스크립트. 예전 등록(scope /hoondok, 슬래시 없음 — C-3)이 업데이트 검사로 이것을 받아 스스로 해제하려면
      // 같은 scope 를 허용하는 Service-Worker-Allowed 가 계속 있어야 한다.
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
      // 예전 훈독 주소(설치된 앱의 start_url·보낸 알림·카톡으로 퍼진 /hoondok/c/{id})를 같은 경로의 루트로 보낸다.
      // 308 은 영구이고 메서드를 유지한다. 쿼리는 Next 가 그대로 붙인다. 자산 경로는 LEGACY_HOONDOK_PAGE 가 건너뛴다.
      { source: "/hoondok", destination: "/", permanent: true },
      { source: LEGACY_HOONDOK_PAGE, destination: "/:path", permanent: true },
      // 삭제한 시연 챗 화면 주소(북마크·공유 링크·홈 화면 바로가기)를 가까운 훈독 화면으로 보낸다. 시연 데이터와 이어지지 않으므로 임시(307)다.
      { source: "/login", destination: "/onboarding", permanent: false },
      { source: "/history", destination: "/ask", permanent: false },
      { source: "/about", destination: "/", permanent: false },
      // 삭제한 훈독 모임 화면(DEC-PWA-027). 카톡으로 퍼진 참여 링크(/groups/join?code=…)·예전 /hoondok/groups/* 308 뒤 주소를 홈으로 보낸다.
      { source: "/groups/:path*", destination: "/", permanent: false },
      // 기존 사용자 origin에 남은 관리 URL을 독립 관리자 앱으로 연결한다. `settings` 는 훈독 알림·설치 화면(/settings)이라 뺐다.
      ...["dashboard", "chatbots", "data-sources", "analytics", "feedback", "audit-logs"].map((route) => ({
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
