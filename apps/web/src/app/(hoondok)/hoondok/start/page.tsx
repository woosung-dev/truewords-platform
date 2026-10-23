// /hoondok/start — 맞춤 첫 말씀 질문 흐름(환영 → 질문 1~3 → 첫 말씀). 회원가입 직후 기본 경로로 들어온다(personal/start.ts).
// 탭바·헤더 없는 온보딩 프레임이며 화면 레지스트리(screens.ts variant "onb")가 앱바를 보조기기용으로만 남긴다.
// 첫 말씀은 책갈피 카드에서 고르므로 책갈피 플래그가 꺼진 빌드에서는 404 다.
import { notFound } from "next/navigation";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { StartFlow } from "@/features/hoondok/personal/components/start-flow";

export default function HoondokStartPage() {
  if (!isHoondokCardsEnabled()) notFound();
  return <StartFlow />;
}
