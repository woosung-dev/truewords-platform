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
      // P1-A 답변 반응 (👍/👎/💾) — backend reactions_router 가 /api/chat/messages prefix.
      // 더 구체적 매칭이 일반 /api/chat/* 보다 먼저 평가되도록 위에 둔다.
      {
        source: "/api/chat/messages/:path*",
        destination: `${BACKEND_URL}/api/chat/messages/:path*`,
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
      // P0-B 인용 카드 원문보기 모달 — backend chunks_router 가 /api/sources/chunks prefix.
      {
        source: "/api/sources/:path*",
        destination: `${BACKEND_URL}/api/sources/:path*`,
      },
    ];
  },
};

export default nextConfig;
