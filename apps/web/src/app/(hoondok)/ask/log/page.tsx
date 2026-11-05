// 예전 질문 기록 화면 — AI 질문 홈의 "내 질문" 탭으로 흡수했다. 옛 링크·설치 앱 바로가기를 위해 경로는 남긴다.
import { redirect } from "next/navigation";

export default function HoondokAskLogPage() {
  redirect("/ask?tab=mine");
}
