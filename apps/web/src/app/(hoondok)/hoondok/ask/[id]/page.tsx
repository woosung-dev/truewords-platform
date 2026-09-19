// SCR-PWA-006 질문·답변 상세 (PLAN-HD-002 W2). 본문 폭 640px(col--read)은 screens.ts 의 variant 가 정한다.
// 답은 마운트 뒤 클라이언트가 `/chat/stream` 에서 받아 기기 저장소에 넣는다 — 서버는 id 만 넘긴다.
import { AskDetail } from "@/features/hoondok/ask/components/ask-detail";

export default async function HoondokAskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AskDetail id={id} />;
}
