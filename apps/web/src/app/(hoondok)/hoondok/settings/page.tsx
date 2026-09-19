// SCR-PWA-015 알림·설치 설정 (PLAN-HD-002 W1-S). 앱바 제목 "알림·설치"·뒤로 /hoondok/garden 은 screens.ts 레지스트리가 준다.
// 이 화면은 서버에서 읽을 것이 없다 — 설치 판정은 localStorage·navigator, 계정은 쿠키 기반 /hoondok/auth/me 라 전부 클라이언트다.
import { SettingsScreen } from "@/features/hoondok/settings/components/settings-screen";

export default function HoondokSettingsPage() {
  return <SettingsScreen />;
}
