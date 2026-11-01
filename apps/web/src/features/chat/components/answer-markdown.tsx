"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Source } from "./assistant-message";

// 답변 마크다운 렌더러. react-markdown·remark-gfm 이 커서 assistant-message 가 지연 로드한다.
export default function AnswerMarkdown({
  content,
  sourceMap,
  onSourceClick,
}: {
  content: string;
  sourceMap: Map<string, Source>;
  onSourceClick?: (source: Source) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // [N](cite:N) 마크다운 링크를 클릭 가능한 위첨자로 변환.
        // sourceMap miss 시에는 disabled button 으로 렌더 → 외부 네비게이션 차단.
        a: ({ href, children, ...rest }) => {
          if (href?.startsWith("cite:")) {
            const num = href.slice("cite:".length);
            const src = sourceMap.get(num);
            const disabled = !src;
            return (
              <button
                type="button"
                disabled={disabled}
                aria-label={`출처 ${num}${src ? `: ${src.volume}` : " (연결 없음)"}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (src) onSourceClick?.(src);
                }}
                className={cn(
                  "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-accent/10 px-1.5 align-[2px] text-2xs font-bold leading-none text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  disabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {num}
              </button>
            );
          }
          return (
            <a href={href} {...rest}>
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
