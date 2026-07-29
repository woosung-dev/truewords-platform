import type { NextConfig } from "next";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Vercel 에 남겨둔 구 배포본이 리다이렉트할 신규 도메인.
const NEW_ORIGIN = "https://app.woosung.dev";
const LEGACY_HOST = "truewords-platform.vercel.app";

const nextConfig: NextConfig = {
  // Oracle VM 컨테이너 배포용. .next/standalone 에 server.js 와 필요한
  // node_modules 만 추린 산출물이 생겨 이미지에 pnpm install 이 필요 없다.
  output: "standalone",
  // 대용량 파일 업로드(데이터 소스 적재) 허용 — 기본 10MB → 200MB
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  async redirects() {
    return [
      // 레드팀·체험단 가이드에 vercel.app 주소가 안내 링크로 박혀 있다.
      // Vercel 프로젝트를 리다이렉트 전용으로 남겨 기존 링크를 살린다.
      //
      // host 조건이 반드시 필요하다. 조건 없이 걸면 Oracle 에서 서비스되는
      // 같은 빌드가 자기 자신을 무한 리다이렉트한다.
      //
      // permanent: false (307) — 308 은 브라우저가 강하게 캐시해서 되돌리기
      // 어렵다. Vercel 삭제를 확정하기 전까지는 되돌릴 수 있는 상태로 둔다.
      {
        source: "/:path*",
        has: [{ type: "host", value: LEGACY_HOST }],
        destination: `${NEW_ORIGIN}/:path*`,
        permanent: false,
      },
    ];
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
