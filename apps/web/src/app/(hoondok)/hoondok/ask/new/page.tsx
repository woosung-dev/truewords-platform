// 새 질문하기 (전체 화면). 훈독 로그인 필요 — 보내면 `/hoondok/ask/stream` 으로 묻고 답은 계정에 보관된다.
import { AskNew } from "@/features/hoondok/ask/components/ask-new";

export default function HoondokAskNewPage() {
  return <AskNew />;
}
