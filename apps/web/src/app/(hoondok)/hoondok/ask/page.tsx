// SCR-PWA-005 AI 질문 묻기 홈 (PLAN-HD-002 W2). 앱바 제목 "AI 질문"·탭 귀속은 screens.ts 레지스트리가 준다.
// 오늘 말씀 한 줄만 서버에서 읽고(편성이 없으면 생략), 질문·답·근거는 전부 기기 저장소에 둔다.
import { loadToday } from "@/features/hoondok/api";
import { AskHome, type AskTodayLine } from "@/features/hoondok/ask/components/ask-home";

export default async function HoondokAskPage() {
  const today = await loadToday();
  const reading = today.status === "available" ? today.reading : null;
  const line: AskTodayLine | null = reading
    ? { title: reading.title, source: [reading.work_title, reading.edition].filter(Boolean).join(" · ") }
    : null;
  return <AskHome today={line} />;
}
