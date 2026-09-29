"use client";

// 원문 뷰 "노트" 탭 — 이 권의 형광펜·메모를 본문 순서로 모은다 (API-HD-053).
// 색만으로 구분하지 않는다(DES-PWA-003 §3.3): 색 칩 옆에 색 이름과 단락 번호를 함께 적는다.
import type { HighlightItem } from "@truewords/api-client-ts/types";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { verseNumber, wordsHref } from "../api";
import { COLOR_NAME, inReadingOrder, toHighlightColor } from "../highlight-range";

export function HighlightNotes({
  volume,
  items,
  isLoggedIn,
  returnTo,
  onOpen,
}: {
  volume: string;
  items: HighlightItem[];
  isLoggedIn: boolean;
  returnTo: string;
  /** 항목을 누르면 본문 탭으로 돌아가 그 단락을 연다 */
  onOpen: () => void;
}) {
  const ordered = useMemo(() => inReadingOrder(items), [items]);
  if (!isLoggedIn) {
    return (
      <div className="empty">
        <span className="empty__ic">
          <NotebookPen size={26} aria-hidden="true" />
        </span>
        <p className="empty__title">로그인하면 기록이 남아요</p>
        <p className="empty__body">
          형광펜과 메모는 계정에 저장돼요. 로그인하면 이 권에 남긴 기록을 모아서 볼 수 있어요.
        </p>
        <Link className="btn btn-line btn--sm" href={onboardingHref(returnTo)}>
          로그인하기
        </Link>
      </div>
    );
  }
  if (ordered.length === 0) {
    return (
      <div className="empty">
        <span className="empty__ic">
          <NotebookPen size={26} aria-hidden="true" />
        </span>
        <p className="empty__title">이 권에 남긴 형광펜·메모가 아직 없어요</p>
        <p className="empty__body">
          본문 글자를 길게 누르면 원하는 구절에 형광펜과 메모를 남길 수 있어요. PC에서는 끌어서 고르면 돼요.
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="rd-notes-title">
      <h3 className="sect__title rd-notes__title" id="rd-notes-title">
        형광펜·메모 <span className="rd-notes__count">{ordered.length}개</span>
      </h3>
      <ul className="rd-notes">
        {ordered.map((item) => {
          const color = toHighlightColor(item.color);
          return (
            <li key={item.id}>
              <Link href={wordsHref(volume, item.chunk_id)} onClick={onOpen}>
                <span className="rd-notes__n">
                  <span className={`rd-notes__chip rd-notes__chip--${color}`} aria-hidden="true" />
                  {COLOR_NAME[color]} · 단락 {verseNumber(item.start_chunk_index)}
                </span>
                <span className="rd-notes__quote">{item.quote}</span>
                {item.note && <span className="rd-notes__memo">{item.note}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
