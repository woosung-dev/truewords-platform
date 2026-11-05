// AI 질문 홈 — 추천(공개 Q&A)·저장·내 질문 탭과 "+ 질문하기". 앱바 제목·탭 귀속은 screens.ts 레지스트리가 준다.
// 공개 목록은 클라이언트가 읽고(검색어로 다시 읽는다), 저장·내 질문은 로그인한 계정 목록(`/hoondok/me/asks`)이다.
import { AskHome } from "@/features/hoondok/ask/components/ask-home";

export default function HoondokAskPage() {
  return <AskHome />;
}
