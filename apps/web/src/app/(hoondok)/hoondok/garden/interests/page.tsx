// /hoondok/garden/interests — 관심사와 마음 바꾸기. 답은 이 기기에만 있어 화면 전체가 클라이언트다.
// 맞춘 카드는 책갈피 카드에서 고르므로 책갈피 플래그가 꺼진 빌드에서는 404 다.
import { notFound } from "next/navigation";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { InterestsScreen } from "@/features/hoondok/personal/components/interests-screen";

export default function HoondokInterestsPage() {
  if (!isHoondokCardsEnabled()) notFound();
  return <InterestsScreen />;
}
