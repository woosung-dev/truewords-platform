// SCR-PWA-015 관리 (계정·알림·설치). 앱바 제목 "관리"·뒤로는 screens.ts 레지스트리가 준다.
// 요일은 서버에서 한 번만 계산해 내려보낸다 — 클라이언트가 다시 계산하면 자정 경계에서 hydration 이 어긋난다.
import { SettingsScreen } from "@/features/hoondok/settings/components/settings-screen";
import { formatKstDate } from "@/features/hoondok/today";

export default function HoondokSettingsPage() {
  return <SettingsScreen todayWeekday={formatKstDate(new Date()).weekday} />;
}
