// 원문 뷰 읽기 도구 세 가지. 폰·태블릿은 하단 독(ReaderDock), ≥1024px 은 본문 위 가로 툴바(ReaderBar)가 같은 목록을 쓴다.
import { Highlighter, List, NotebookPen } from "lucide-react";

export type ReaderAction = "highlight" | "note" | "toc";

export const READER_TOOLS = [
  { action: "highlight" as const, label: "형광펜", Icon: Highlighter },
  { action: "note" as const, label: "노트", Icon: NotebookPen },
  { action: "toc" as const, label: "목차", Icon: List },
] as const;
