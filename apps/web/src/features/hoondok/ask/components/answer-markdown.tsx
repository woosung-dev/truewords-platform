"use client";

// AI 답 본문 렌더러 — AI 질문 상세와 원문 뷰 "AI 설명" 탭이 함께 쓴다.
// 모델은 `### 소제목`·`**강조**`·`- 목록` 마크다운으로 답한다. 문자열 그대로 두면 기호가 화면에 노출된다.
// 원시 HTML 은 react-markdown 기본값대로 렌더하지 않고, 링크는 외부 이동을 막으려 글자로만 남긴다.
import ReactMarkdown, { type Components } from "react-markdown";

const COMPONENTS: Components = {
  h1: ({ children }) => <p className="ai-note__head">{children}</p>,
  h2: ({ children }) => <p className="ai-note__head">{children}</p>,
  h3: ({ children }) => <p className="ai-note__head">{children}</p>,
  h4: ({ children }) => <p className="ai-note__head">{children}</p>,
  p: ({ children }) => <p className="ai-note__body">{children}</p>,
  ul: ({ children }) => <ul className="ai-note__list">{children}</ul>,
  ol: ({ children }) => <ol className="ai-note__list">{children}</ol>,
  a: ({ children }) => <span>{children}</span>,
};

export function AnswerMarkdown({ answer }: { answer: string }) {
  return <ReactMarkdown components={COMPONENTS}>{answer}</ReactMarkdown>;
}
