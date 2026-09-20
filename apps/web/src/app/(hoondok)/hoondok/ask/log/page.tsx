// SCR-PWA-005b 질문 기록 (PLAN-HD-002 W2). 목록의 원본이 이 기기의 localStorage 뿐이라 서버에서 읽을 것이 없다.
import { AskLog } from "@/features/hoondok/ask/components/ask-log";

export default function HoondokAskLogPage() {
  return <AskLog />;
}
