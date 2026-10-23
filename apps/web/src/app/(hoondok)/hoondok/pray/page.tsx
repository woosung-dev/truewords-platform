// /hoondok/pray — 마음 한 장(마음 고르기 → 맞춘 말씀 → 한 줄 → 건네기). 나의 정원에서 들어온다.
// 맞춘 말씀은 책갈피 카드에서 고르므로 책갈피 플래그가 꺼진 빌드에서는 404 다.
import { notFound } from "next/navigation";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { PrayScreen } from "@/features/hoondok/personal/components/pray-screen";

export default function HoondokPrayPage() {
  if (!isHoondokCardsEnabled()) notFound();
  return <PrayScreen />;
}
