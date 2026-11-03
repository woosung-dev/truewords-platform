import path from "node:path";
import type { NextConfig } from "next";

// rewrites/redirects는 빌드 시 고정된다. 운영 이미지는 각 origin을 build ARG로 받는다.
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@truewords/api-client-ts"],
  experimental: { proxyClientMaxBodySize: "200mb" },
  async headers() {
    // 다른 사이트가 로그인 상태(운영 쿠키 SameSite=None)로 관리자 화면을 틀에 넣어 클릭을 유도하지 못하게 한다(보안 점검).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      ...["history", "about"].map((route) => ({
        source: `/${route}/:path*`,
        destination: `${WEB_ORIGIN}/${route}/:path*`,
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
