import { Bookmark, Quote } from "lucide-react";
import type { Ref } from "react";
import type { CardPublic } from "../api";
import { bookColorIndex, type CardBackground, type PhotoFormat, photoSrc, type SourceMode, sourceText } from "../look";
import { quoteSize } from "./bookmark-card";

// 사진 카드 (시안 p4 `.card`): 풍경 사진(또는 책 색) 위 큰 글씨 + 출처 + 훈독 표시.
// 받기 화면·나의 책갈피 부채꼴·내 카드 갤러리 썸네일이 같은 마크업을 크기만 바꿔 쓴다(cqw 단위).
// 보내는 이미지는 서버(og/card-image.tsx)가 같은 모양으로 그린다. 말씀은 원문 그대로 — 글자 크기만 길이에 따라 줄인다.

export type PhotoCardRefs = {
  card?: Ref<HTMLElement>;
  inner?: Ref<HTMLDivElement>;
  veil?: Ref<HTMLSpanElement>;
};

/** 훈독 표시 (금색 책갈피 + 훈독). 출처와 함께 늘 보인다 */
export function HoondokMark({ className }: { className?: string }) {
  return (
    <span className={["pc__mark", className].filter(Boolean).join(" ")}>
      <Bookmark aria-hidden="true" fill="currentColor" strokeWidth={0} />
      훈독
    </span>
  );
}

export function PhotoCard({
  card,
  bg,
  format = "feed",
  src = "full",
  label,
  isDecorative = false,
  refs,
  className,
}: {
  card: Pick<CardPublic, "text" | "source_label" | "work_title" | "volume">;
  bg: CardBackground;
  format?: PhotoFormat;
  src?: SourceMode;
  /** 읽는 이름. 없으면 "말씀 카드" */
  label?: string;
  /** 썸네일처럼 바깥 버튼이 이름을 가지면 읽지 않는다 */
  isDecorative?: boolean;
  refs?: PhotoCardRefs;
  className?: string;
}) {
  const isSolid = bg === "book";
  const classes = [
    "pc",
    `pc--${format}`,
    isSolid && "pc--solid",
    `pc--book-${bookColorIndex(card.work_title)}`,
    `pc--q-${quoteSize(card.text)}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const source = sourceText(card, src);
  const a11y = isDecorative ? { "aria-hidden": true } : { "aria-label": label ?? "말씀 카드" };
  return (
    <article className={classes} ref={refs?.card} {...a11y}>
      {isSolid ? (
        <span className="pc__solid" aria-hidden="true" />
      ) : (
        <img className="pc__img" src={photoSrc(bg)} alt="" />
      )}
      <span className="pc__shade" aria-hidden="true" />
      {format === "feed" ? (
        <>
          <Quote className="pc__quote" aria-hidden="true" fill="currentColor" strokeWidth={0} />
          <div className="pc__body" ref={refs?.inner}>
            <p className="pc__text">{card.text}</p>
            <div className="pc__foot">
              <span className="pc__src">{source}</span>
              <HoondokMark />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="pc__panel" ref={refs?.inner}>
            <Quote className="pc__quote" aria-hidden="true" fill="currentColor" strokeWidth={0} />
            <p className="pc__text">{card.text}</p>
            <span className="pc__src">{source}</span>
          </div>
          <HoondokMark className="pc__mark--story" />
        </>
      )}
      <span className="pc__veil" aria-hidden="true" ref={refs?.veil} />
    </article>
  );
}
