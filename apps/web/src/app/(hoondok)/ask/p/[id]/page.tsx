// 공개 질문 열람 — 협회가 공개한 Q&A 를 읽기만 한다. 데이터는 클라이언트가 `GET /hoondok/questions/{id}` 로 읽는다.
import { AskPublic } from "@/features/hoondok/ask/components/ask-public";

export default async function HoondokAskPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AskPublic id={id} />;
}
