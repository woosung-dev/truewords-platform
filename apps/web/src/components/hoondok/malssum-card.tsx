import { BookOpenText, Calendar } from "lucide-react";

import type { TodayReading, TodayStatus } from "@/features/hoondok/today";
import { AuthorityBadge, ReviewBadge } from "./authority-badge";

// 말씀 카드 (DES-PWA-003 §2.2): 출처 줄(화자 · 저작물 · 판본 · 등급 배지) + 본문(4px 왼쪽 실선).
// AC-016-01 메타 6항목 중 화자·날짜·저작물·판본·공식성·검수를 출처 줄과 배지로 보인다.

export function SourceLine({ reading }: { reading: TodayReading }) {
  const parts = [
    reading.speaker || "화자 확인되지 않음",
    reading.spoken_on || "날짜 확인되지 않음",
    reading.work_title || "저작물 확인되지 않음",
    reading.edition || "판본 확인되지 않음",
  ];
  return (
    <div className="src-line">
      {/* 구분점은 모든 항목 앞에 붙이고 줄 머리의 점은 CSS(.src--clip)가 잘라 낸다 — 줄 끝·줄 머리에 "·" 만 남지 않는다 */}
      <div className="src src--clip">
        {parts.map((part, index) => (
          <span className="src__part" key={`${index}-${part}`}>
            <span className="src__dot" />
            {part}
          </span>
        ))}
      </div>
      <div className="src">
        <AuthorityBadge grade={reading.authority_grade} />
        <ReviewBadge status={reading.review_status} />
      </div>
    </div>
  );
}

type MalssumCardProps =
  | { status: "available"; reading: TodayReading; isFull?: boolean }
  | { status: Exclude<TodayStatus, "available">; reading?: null; isFull?: boolean };

export function MalssumCard(props: MalssumCardProps) {
  if (props.status !== "available") {
    // AC-016-04: 대체 콘텐츠를 만들지 않고 상태만 말한다. "곧 온다" 고 약속하지 않는다.
    // 다음 행동(이어 읽기 → 서고)은 부르는 화면이 카드 아래에 둔다(C3, EmptyDayActions).
    return (
      <div className="card empty" role="status">
        <span className="empty__ic">
          {props.status === "withdrawn" ? <BookOpenText size={26} /> : <Calendar size={26} />}
        </span>
        <p className="empty__title">
          {props.status === "withdrawn" ? "오늘 말씀이 철회됐어요" : "오늘은 정해진 말씀이 없어요"}
        </p>
        <p className="empty__body">읽던 말씀을 이어 읽거나 서고에서 골라 읽어요.</p>
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
