import { BookOpenText } from "lucide-react";
import { Fragment } from "react";
import type { TodayReading, TodayStatus } from "@/features/hoondok/today";
import { AuthorityBadge, ReviewBadge } from "./authority-badge";

// 말씀 카드 (DES-PWA-003 §2.2): 출처 줄(화자 · 저작물 · 판본 · 등급 배지) + 본문(4px 왼쪽 실선).
// AC-016-01 메타 6항목 중 화자·날짜·저작물·판본·공식성·검수를 출처 줄과 배지로 보인다.

export function SourceLine({ reading }: { reading: TodayReading }) {
  const parts = [reading.speaker, reading.spoken_on, reading.work_title, reading.edition].filter((p): p is string =>
    Boolean(p),
  );
  return (
    <div className="src">
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 && <span className="src__dot" />}
          <span>{part}</span>
        </Fragment>
      ))}
      <AuthorityBadge grade={reading.authority_grade} />
      <ReviewBadge status={reading.review_status} />
    </div>
  );
}

type MalssumCardProps =
  | { status: "available"; reading: TodayReading; isFull?: boolean }
  | { status: Exclude<TodayStatus, "available">; reading?: null; isFull?: boolean };

export function MalssumCard(props: MalssumCardProps) {
  if (props.status !== "available") {
    // AC-016-04: 대체 콘텐츠를 만들지 않고 상태와 다음 행동만 보인다.
    return (
      <div className="card empty" role="status">
        <span className="empty__ic">
          <BookOpenText size={26} />
        </span>
        <p className="empty__title">
          {props.status === "withdrawn" ? "오늘 말씀이 철회됐어요" : "오늘 말씀이 아직 없어요"}
        </p>
        <p className="empty__body">서고·검색은 준비 중이에요. 내일 아침에 다시 열어 주세요.</p>
      </div>
    );
  }
  const { reading, isFull } = props;
  return (
    <article className="card malssum" aria-labelledby={`malssum-${reading.id}`}>
      <SourceLine reading={reading} />
      <h2 id={`malssum-${reading.id}`} className="lede">
        {reading.title}
      </h2>
      {isFull ? (
        <p className="scripture">{reading.body}</p>
      ) : (
        <p className="scripture">{reading.body.length > 120 ? `${reading.body.slice(0, 120)}…` : reading.body}</p>
      )}
    </article>
  );
}
