import type { Ref } from "react";
import type { CardPublic } from "../api";

// 책 한 권 (시안 `.bk`). 홈 카드(sm)·받는 순간(lg) 이 같은 마크업을 크기만 바꿔 쓴다(em 단위).
// 닫힘 = 책갈피가 책 속에 들어가 술·끝만 보인다. 열림 = 모션 시작 상태(리본 제자리). 움직임은 motion.ts 가 준다.

// volume 은 서고 원문 링크 키라 서버가 Qdrant 원본(파일명)을 그대로 준다 — "천성경.pdf" · "말씀선집 355권.pdf".
// 표시할 때만 끝의 문서 확장자를 뗀다(서버 candidates.clean_volume 과 같은 목록). 떼지 않으면 뒤 부분이 ".pdf" 가 된다.
const VOLUME_EXT = /\.(txt|pdf|hwpx?|docx?|pptx?)$/i;

/** 책 이름. volume 이 저작물 이름으로 시작하면 뒤 부분(편·권)을 붙인다 — "천성경 제1편" · "말씀선집 355권". */
export function bookParts(card: Pick<CardPublic, "work_title" | "volume">): { title: string; sub: string } {
  const title = card.work_title.trim();
  const volume = card.volume.trim().replace(VOLUME_EXT, "").trim();
  const sub = volume.startsWith(title) ? volume.slice(title.length).trim() : "";
  return { title, sub };
}

export function bookName(card: Pick<CardPublic, "work_title" | "volume">): string {
  const { title, sub } = bookParts(card);
  return sub ? `${title} ${sub}` : title;
}

export type BookRefs = {
  cover?: Ref<HTMLDivElement>;
  glow?: Ref<HTMLDivElement>;
  rib?: Ref<HTMLDivElement>;
  ribBody?: Ref<HTMLSpanElement>;
  tassel?: Ref<HTMLSpanElement>;
};

export function Book({
  card,
  size,
  isOpen = false,
  isWaiting = false,
  refs,
}: {
  card: Pick<CardPublic, "work_title" | "volume">;
  size: "sm" | "lg";
  isOpen?: boolean;
  /** 홈 대기 모션: 800ms 뒤 3초 주기로 2회 책갈피 끝이 오르내린다 (동작 줄이기면 없음) */
  isWaiting?: boolean;
  refs?: BookRefs;
}) {
  const { title, sub } = bookParts(card);
  const className = ["bk", `bk--${size}`, isOpen ? "is-open" : "is-closed", isWaiting && "is-waiting"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} aria-hidden="true">
      <div className="bk__pages" />
      <div className="bk__glow" ref={refs?.glow} />
      <div className="bk__rib" ref={refs?.rib}>
        <span className="bk__tas" ref={refs?.tassel} />
        <span className="bk__rib-body" ref={refs?.ribBody} />
        <HeartIcon className="bk__rib-heart" />
      </div>
      <div className="bk__cover" ref={refs?.cover}>
        <div className="bk__plate">
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/** 리본 위 하트 (시안의 lucide heart 채움). 장식이라 읽지 않는다. */
export function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
    </svg>
  );
}
