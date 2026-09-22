"use client";

// 목차 (SCR-PWA-009). ≥1224px 은 좌측 레일로 상시 노출되고 그 아래 폭은 리더 바 "목차" 가 여는 시트다
// (DES-PWA-003 §4.3). 장 데이터(API-HD-024)가 0건인 권은 지금까지와 같은 "원문 구간 N" 으로 폴백한다.
import type { SectionItem } from "@truewords/api-client-ts/types";
import Link from "next/link";
import { wordsPageHref, wordsSectionHref } from "../api";

export type WordsTocProps = {
  volume: string;
  workTitle: string;
  sections: readonly SectionItem[];
  /** 현재 페이지가 속한 장(`WordsResponse.section.position`). 없으면 강조하지 않는다 */
  currentPosition: number | null;
  page: number;
  totalPages: number;
  onNavigate?: () => void;
};

export function WordsToc({
  volume,
  workTitle,
  sections,
  currentPosition,
  page,
  totalPages,
  onNavigate,
}: WordsTocProps) {
  const hasSections = sections.length > 0;
  return (
    <>
      <p className="toc__title toc__work">{workTitle}</p>
      {hasSections
        ? sections.map((section) => (
            <Link
              key={section.position}
              // 편·부는 제목 줄이지만 눌러서 갈 수 있어야 한다 — 프로토타입의 .toc__title 모양에 링크만 더한다
              className={section.level === 1 ? "toc__title toc__title--link" : "toc__item"}
              href={wordsSectionHref(volume, section.position)}
              aria-current={section.position === currentPosition ? "page" : undefined}
              onClick={onNavigate}
            >
              {section.title}
            </Link>
          ))
        : Array.from({ length: totalPages }, (_, index) => index + 1).map((sectionPage) => (
            <Link
              key={sectionPage}
              className="toc__item"
              href={wordsPageHref(volume, sectionPage)}
              aria-current={sectionPage === page ? "page" : undefined}
              onClick={onNavigate}
            >
              원문 구간 {sectionPage}
            </Link>
          ))}
    </>
  );
}

/** 목차가 장을 갖고 있는지 — 레일 제목(aria-label)과 폴백 안내 문구가 같은 판단을 쓴다. */
export function tocLabel(sections: readonly SectionItem[]): string {
  return sections.length > 0 ? "목차" : "원문 구간";
}
