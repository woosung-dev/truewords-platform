import { BookOpenText, Calendar } from "lucide-react";
import type { ReactNode } from "react";

import type { TodayReading, TodayStatus } from "@/features/hoondok/today";
import { AuthorityBadge } from "./authority-badge";

// 말씀 카드 (DES-PWA-003 §2.2): 출처 줄(화자 · 저작물 · 판본 · 등급 배지) + 본문(4px 왼쪽 실선).
// AC-016-01 메타 6항목 중 화자·날짜·저작물·판본·공식성·검수를 출처 줄과 배지로 보인다.
// 검수 전은 출처 줄 끝 글자로 적는다 — 등급 배지 옆에 점선 배지가 하나 더 서면 제목 위에 경고 윤곽이 둘이 된다.

export function SourceLine({ reading }: { reading: TodayReading }) {
  const parts = [
    reading.speaker || "화자 확인되지 않음",
    reading.spoken_on || "날짜 확인되지 않음",
    reading.work_title || "저작물 확인되지 않음",
    reading.edition || "판본 확인되지 않음",
    ...(reading.review_status === "unverified" ? ["검수 전"] : []),
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
      </div>
    </div>
  );
}

type MalssumCardProps =
  | { status: "available"; reading: TodayReading; isFull?: boolean }
  | {
      status: Exclude<TodayStatus, "available">;
      reading?: null;
      isFull?: boolean;
      /** 상태 아래 한 줄. 다음 행동이 무엇인지(이어 읽기 기록 유무)는 부르는 화면이 안다 */
      hint?: ReactNode;
    };

/**
 * 편성 제목이 본문 첫 문장을 자른 것인지. 편성 제목의 기본값이 본문 첫 문장(60자, 말줄임)이라
 * 그대로 두면 큰 제목과 본문 첫 줄이 같은 문장을 되풀이한다.
 */
export function isTitleEcho(title: string, body: string): boolean {
  const head = title.replace(/(…|\.\.\.)$/, "").trim();
  return head.length > 0 && body.trimStart().startsWith(head);
}

export function MalssumCard(props: MalssumCardProps) {
  if (props.status !== "available") {
    // AC-016-04: 대체 콘텐츠를 만들지 않고 상태만 말한다. "곧 온다" 고 약속하지 않는다.
    // 다음 행동(이어 읽기 → 서고)과 그 안내 문구는 부르는 화면이 정한다(C3, EmptyDayActions).
    return (
      <div className="card empty" role="status">
        <span className="empty__ic">
          {props.status === "withdrawn" ? <BookOpenText size={26} /> : <Calendar size={26} />}
        </span>
        <p className="empty__title">
          {props.status === "withdrawn" ? "오늘 말씀이 철회됐어요" : "오늘은 정해진 말씀이 없어요"}
        </p>
        {props.hint && <p className="empty__body">{props.hint}</p>}
      </div>
    );
  }
  const { reading, isFull } = props;
  // 전문을 보일 때 제목이 본문 첫 문장과 같으면 제목은 보조기기에만 남긴다 (글 이름표 aria-labelledby 는 그대로)
  const isEcho = Boolean(isFull) && isTitleEcho(reading.title, reading.body);
  return (
    <article className="card malssum" aria-labelledby={`malssum-${reading.id}`}>
      <SourceLine reading={reading} />
      <h2 id={`malssum-${reading.id}`} className={isEcho ? "lede sr-only" : "lede"}>
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
