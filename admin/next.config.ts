import type { NextConfig } from "next";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // 대용량 파일 업로드(데이터 소스 적재) 허용 — 기본 10MB → 200MB
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  async rewrites() {
    return [
      {
        source: "/admin/:path*",
        destination: `${BACKEND_URL}/admin/:path*`,
      },
      {
        source: "/api/chat",
        destination: `${BACKEND_URL}/chat`,
      },
      {
        source: "/api/chat/:path*",
        destination: `${BACKEND_URL}/chat/:path*`,
      },
      {
        source: "/api/chatbots",
        destination: `${BACKEND_URL}/chatbots`,
      },
    ];
  },
};

export default nextConfig;
