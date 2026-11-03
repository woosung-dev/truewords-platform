// 새 질문하기 (전체 화면). 질문은 기기 저장소에 남기고 상세 화면이 `/chat/stream` 에서 답을 받는다.
import { AskNew } from "@/features/hoondok/ask/components/ask-new";

export default function HoondokAskNewPage() {
  return <AskNew />;
}
