import type { Metadata } from "next";
import HoondokPwaDemo from "./pwa-demo";

export const metadata: Metadata = {
  title: "훈독 — PWA 셸 데모 (독립 운영 베타)",
  description: "훈독 PWA 의 설치·서비스워커·알림 권한 흐름을 실기기에서 확인하는 데모 화면입니다.",
};

// 훈독 PWA 셸 데모 (PRD-HOONDOK-001 · SCR-PWA-008). 비인증 공개 화면.
// 실제 제품 화면은 S3 디자인 승인 뒤 (hoondok) 라우트 그룹에서 구현한다. 여기서는 기존 web 토큰만 쓴다.
export default function HoondokPage() {
  return <HoondokPwaDemo />;
}
