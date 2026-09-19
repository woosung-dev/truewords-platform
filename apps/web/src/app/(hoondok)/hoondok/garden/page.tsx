// /hoondok/garden — SCR-PWA-014 나의 정원 (PLAN-HD-002 W1-G).
// 플래그 게이트는 layout, 앱바(제목 "나의 정원"·탭 garden)는 screens.ts 가 담당한다.
// KST 날짜는 서버에서 한 번만 계산해 내려보낸다 — 클라이언트가 다시 계산하면 자정 경계에서 hydration 이 어긋난다.
import { GardenScreen } from "@/features/hoondok/garden/components/garden-screen";
import { kstMonthKey } from "@/features/hoondok/kst";
import { formatKstDate } from "@/features/hoondok/today";

export default function HoondokGardenPage() {
  const now = new Date();
  return <GardenScreen month={kstMonthKey(now)} today={formatKstDate(now).iso} />;
}
