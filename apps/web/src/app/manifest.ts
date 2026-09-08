import type { MetadataRoute } from "next";

// 훈독 PWA 셸 (PRD-HOONDOK-001 · REQ-PWA-009). 설치 이름·아이콘·시작 URL 만 정의한다.
// 서비스워커 등록은 NEXT_PUBLIC_PWA_ENABLED=1 일 때만 PwaRegister 가 수행한다.
export const HOONDOK_MANIFEST: MetadataRoute.Manifest = {
  name: "훈독 — 가정연합 말씀 (독립 운영 베타)",
  short_name: "훈독",
  description: "새벽 한 문단으로 여는 하루. 출처가 있는 말씀, 함께 하는 기도. 독립 운영 베타이며 FFWPU 공식 앱이 아닙니다.",
  id: "/hoondok",
  start_url: "/hoondok",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  lang: "ko",
  background_color: "#F6F1E8",
  theme_color: "#2E2A5A",
  icons: [
    { src: "/icons/hoondok-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/hoondok-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/hoondok-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/hoondok.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

export default function manifest(): MetadataRoute.Manifest {
  return HOONDOK_MANIFEST;
}
