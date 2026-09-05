import path from "node:path";
import type { NextConfig } from "next";

// rewrites/redirects는 빌드 시 고정된다. 운영 이미지는 각 origin을 build ARG로 받는다.
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  // E2E에서 웹/관리자 쿠키를 hostname으로 분리한다. 개발 리소스만 허용한다.
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@truewords/api-client-ts"],
  experimental: { proxyClientMaxBodySize: "200mb" },
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
