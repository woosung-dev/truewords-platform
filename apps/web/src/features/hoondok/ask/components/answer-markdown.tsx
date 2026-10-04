"use client";

// AI 답 본문 렌더러 — AI 질문 상세와 원문 뷰 "AI 설명" 탭이 함께 쓴다.
// 모델은 `### 소제목`·`**강조**`·`- 목록` 마크다운으로 답한다. 문자열 그대로 두면 기호가 화면에 노출된다.
// 원시 HTML 은 react-markdown 기본값대로 렌더하지 않고, 링크는 외부 이동을 막으려 글자로만 남긴다.
// 답 안의 근거 번호 `[N]` 은 같은 화면의 근거 카드로 가는 위첨자 링크가 된다. 카드가 없는 번호는 지운다.
import { Fragment, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

const CITE_PREFIX = "#ask-ev-";
// 연달아 붙은 번호 한 덩어리 — "[1]", "[1][2]", "[1, 2]", "실천입니다 [1]" 의 앞 공백까지.
// 두 자리까지만 번호로 본다("[2018]" 같은 연도는 그대로 둔다). 뒤에 "(" 가 오면 마크다운 링크라 건드리지 않는다.
const CITE_RUN = /(?:[ \t]*\[\d{1,2}(?:[ \t]*,[ \t]*\d{1,2})*\](?!\())+/g;

/** 근거 카드의 id. 답 본문의 번호 링크가 이 id 로 간다. */
export function evidenceId(order: number): string {
  return `ask-ev-${order}`;
}

/**
 * 답 본문의 근거 번호를 근거 카드 링크로 바꾼다. 1..citeCount 밖의 번호는 누를 곳이 없어 지운다.
 * 연달아 붙은 번호는 링크 하나(`[1,2](#ask-ev-1,2)`)로 묶어 위첨자 "1,2" 로 보인다 — 붙여 쓰면 "12" 로 읽힌다.
 */
export function linkCitations(answer: string, citeCount: number): string {
  return answer.replace(CITE_RUN, (run) => {
    const orders = [...new Set((run.match(/\d+/g) ?? []).map(Number))].filter(
      (order) => order >= 1 && order <= citeCount,
    );
    return orders.length > 0 ? `[${orders.join(",")}](${CITE_PREFIX}${orders.join(",")})` : "";
  });
}

function citedOrders(href: string | undefined): number[] | null {
  if (!href?.startsWith(CITE_PREFIX)) return null;
  const orders = href.slice(CITE_PREFIX.length).split(",").map(Number);
  return orders.every((order) => Number.isInteger(order) && order > 0) ? orders : null;
}

const BLOCKS: Components = {
  h1: ({ children }) => <p className="ai-note__head">{children}</p>,
  h2: ({ children }) => <p className="ai-note__head">{children}</p>,
  h3: ({ children }) => <p className="ai-note__head">{children}</p>,
  h4: ({ children }) => <p className="ai-note__head">{children}</p>,
  p: ({ children }) => <p className="ai-note__body">{children}</p>,
  ul: ({ children }) => <ul className="ai-note__list">{children}</ul>,
  ol: ({ children }) => <ol className="ai-note__list">{children}</ol>,
};

export function AnswerMarkdown({
  answer,
  citeCount = 0,
  onCite,
}: {
  answer: string;
  /** 화면에 보이는 근거 카드 수. 0 이면 번호를 모두 지운다(원문 뷰 AI 설명 탭은 근거 카드를 그리지 않는다) */
  citeCount?: number;
  /** 번호를 눌렀을 때 — 없으면 링크의 기본 동작(#ask-ev-N 이동)을 따른다 */
  onCite?: (order: number) => void;
}) {
  const components = useMemo<Components>(
    () => ({
      ...BLOCKS,
      a: ({ href, children }) => {
        const orders = citedOrders(href);
        if (!orders) return <span>{children}</span>;
        return (
          <sup className="ask-ref">
            {orders.map((order, index) => (
              <Fragment key={order}>
                {index > 0 && ","}
                <a
                  href={`#${evidenceId(order)}`}
                  aria-label={`근거 말씀 ${order}`}
                  onClick={(event) => {
                    if (!onCite) return;
                    event.preventDefault();
                    onCite(order);
                  }}
                >
                  {order}
                </a>
              </Fragment>
            ))}
          </sup>
        );
      },
    }),
    [onCite],
  );
  // 본문 감싸개 — 말씀 글자 크기 설정(--read-scale)을 AI 답 본문에만 건다(ask.css)
  return (
    <div className="ai-answer">
      <ReactMarkdown components={components}>{linkCitations(answer, citeCount)}</ReactMarkdown>
    </div>
  );
}
