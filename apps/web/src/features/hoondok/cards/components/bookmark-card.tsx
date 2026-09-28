import type { Ref } from "react";
import type { CardPublic } from "../api";
import { HeartIcon } from "./book";

// 책갈피 카드 (시안 목업 A `.bm`): 따뜻한 종이, 왼쪽 위 잎 그림자, 오른쪽 위 감귤 리본(하트), 가운데 말씀, 아래 잔가지·컵.
// 읽기(023)·받은 사람(025) 이 같은 세로 카드를 쓴다. 공유용 1:1·9:16·2:1 은 이미지 라우트(og/card-image.tsx)가 그린다.
// 말씀은 원문 그대로 싣는다 — 줄임·편집 없음(결정 6). 글자 크기만 길이에 따라 네 단계로 줄인다.

const ASSET = "/hoondok/cards";

/** 본문 길이 → 글자 크기 단계. 시안은 22~24px 을 Pretext 로 맞췄다 — 여기서는 글자 수로 근사한다. */
export function quoteSize(text: string): "l" | "m" | "s" | "xs" {
  const length = Array.from(text).length;
  if (length <= 48) return "l";
  if (length <= 80) return "m";
  if (length <= 130) return "s";
  return "xs";
}

export type BookmarkCardRefs = {
  card?: Ref<HTMLElement>;
  inner?: Ref<HTMLDivElement>;
  veil?: Ref<HTMLSpanElement>;
};

export function BookmarkCard({
  card,
  eyebrow,
  refs,
  className,
}: {
  card: Pick<CardPublic, "text" | "source_label">;
  eyebrow: string;
  refs?: BookmarkCardRefs;
  className?: string;
}) {
  return (
    <article className={["bm", className].filter(Boolean).join(" ")} aria-label="오늘의 책갈피 카드" ref={refs?.card}>
      <img className="bm__leaves" src={`${ASSET}/leaves.webp`} alt="" />
      <span className="bm__rib" aria-hidden="true">
        <HeartIcon />
      </span>
      <div className="bm__in" ref={refs?.inner}>
        <p className="bm__eyebrow">{eyebrow}</p>
        <span className="bm__rule" aria-hidden="true" />
        <div className="bm__body">
          <span className="bm__mark" aria-hidden="true">
            “
          </span>
          <p className={`bm__q bm__q--${quoteSize(card.text)}`}>{card.text}</p>
          <p className="bm__src">{card.source_label}</p>
        </div>
        <div className="bm__scene" aria-hidden="true">
          <img className="bm__twig" src={`${ASSET}/twig.webp`} alt="" />
          <div className="bm__table" />
          <img className="bm__cup" src={`${ASSET}/cup.webp`} alt="" />
        </div>
      </div>
      <span className="bm__veil" aria-hidden="true" ref={refs?.veil} />
    </article>
  );
}
