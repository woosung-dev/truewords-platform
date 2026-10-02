"use client";

// 나의 정원 속 '나의 기록' (C1). 형광펜·노트 수는 그 탭으로 들어가는 입구다 — 이름을 먼저, 잉크색으로
// 같은 크기에 두고 강조색·증감·목표를 두지 않는다 (DEC-PWA-019). 아래에 가장 최근 형광펜 구절 하나를 보인다.
import { ChevronRight, Highlighter, NotebookPen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { verseNumber, wordsHref } from "../../library/api";
import { countRecords, formatCount, RECORDS_PATH, type RecordTab, recordsHref, volumeTitle } from "../records";
import { useRecords } from "../use-records";
import { RecordQuote } from "./record-item";
import { RecordsEmpty, RecordsError } from "./records-screen";

const TALLY: readonly { tab: RecordTab; label: string; Icon: typeof Highlighter }[] = [
  { tab: "highlight", label: "형광펜", Icon: Highlighter },
  { tab: "note", label: "노트", Icon: NotebookPen },
];

export function RecordsGardenSection() {
  const records = useRecords(true);
  const items = records.data?.items ?? [];
  const hasItems = items.length > 0;

  let body: ReactNode;
  if (records.isError) body = <RecordsError onRetry={records.refetch} isNested />;
  else if (!records.data)
    body = <span className="skeleton rc-skeleton" role="status" aria-busy="true" aria-label="기록을 불러오는 중" />;
  else if (!hasItems) body = <RecordsEmpty title="아직 남긴 기록이 없어요" isNested />;
  else {
    const counts = countRecords(items);
    const { capped } = records.data;
    // 형광펜 목록이 최신순이라 첫 항목이 가장 최근 것이다
    const latest = items[0];
    const where = latest ? `${volumeTitle(latest)} · 단락 ${verseNumber(latest.chunk_index)}` : "";
    const latestBody = latest && (
      <>
        <span className="rc-latest__k">
          <span>최근 형광펜</span>
          {latest.text != null && <ChevronRight size={16} aria-hidden="true" />}
        </span>
        <RecordQuote entry={latest} />
        <span className="rc-latest__m">{where}</span>
      </>
    );
    body = (
      <>
        <nav className="rc-tally" aria-label="나의 기록 종류">
          {TALLY.map(({ tab, label, Icon }) => (
            <Link key={tab} href={recordsHref({ tab })}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span> <b>{formatCount(counts[tab], capped[tab])}</b>
            </Link>
          ))}
        </nav>
        {latest &&
          (latest.text == null ? (
            <div className="rc-latest">{latestBody}</div>
          ) : (
            <Link className="rc-latest" href={wordsHref(latest.volume, latest.chunk_id)}>
              {latestBody}
            </Link>
          ))}
      </>
    );
  }

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">나의 기록</h2>
        {hasItems ? (
          <Link className="sect__meta" href={RECORDS_PATH}>
            모두 보기
          </Link>
        ) : (
          <span className="sect__meta">나만 봄</span>
        )}
      </div>
      <div className={hasItems ? "card rc-rec" : "card"}>{body}</div>
    </div>
  );
}
