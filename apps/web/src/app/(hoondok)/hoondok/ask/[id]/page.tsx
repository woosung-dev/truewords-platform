// SCR-PWA-006 질문·답변 상세 (PLAN-HD-002 W2). 본문 폭 640px(col--read)은 screens.ts 의 variant 가 정한다.
// id 는 계정 대화(session_id) 또는 답을 받는 중인 임시 id(`live-…`). 내용은 클라이언트가 `/hoondok/me/asks/{id}` 에서 읽는다.
import { AskDetail } from "@/features/hoondok/ask/components/ask-detail";

export default async function HoondokAskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AskDetail id={id} />;
}
