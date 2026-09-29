"use client";

// 편성 없는 날(C3 안 A). 대체 말씀을 만들지 않고(service.py "대체 콘텐츠를 만들지 않는다") 오늘 상태만 말한 뒤
// 내가 읽던 자리(A1 이어 읽기) → 서고 순으로 안내한다. "곧 온다" 는 약속은 하지 않는다.
import { Calendar } from "lucide-react";
import Link from "next/link";
import { MalssumCard } from "@/components/hoondok";
import { useResumeCard } from "../library/use-resume";

/** 홈 "오늘의 실천" 첫 줄. 누를 곳이 아니라 카드가 아닌 바탕 줄이다. hint 가 null 이면 이어 읽을 기록을 확인하는 중이다. */
export function EmptyDayLine({ hint }: { hint: string | null }) {
  return (
    <div className="day-quiet" role="status">
      <span className="day-quiet__ic" aria-hidden="true">
        <Calendar size={22} />
      </span>
      <span className="day-quiet__bd">
        <b>오늘은 정해진 말씀이 없어요</b>
        <span>{hint ?? <span className="mission__skel" aria-hidden="true" />}</span>
      </span>
    </div>
  );
}

/**
 * 훈독하기(/read) 빈 날: 상태 카드 + 다음 행동. 이어 읽을 기록이 있으면 그 자리가 먼저, 없으면 서고가 주 버튼이다.
 * status 가 없으면(편성 조회 실패) 빈 날이라고 말하지 않고 다음 행동만 둔다.
 */
export function EmptyDayActions({ status }: { status?: "none" | "withdrawn" }) {
  const resume = useResumeCard();
  // 상태 카드 문구도 기록 유무를 따른다 — 기록이 없는데 "읽던 말씀" 을 말하지 않는다
  const card = status && (
    <MalssumCard
      status={status}
      hint={
        resume.status === "ready" ? (
          "읽던 말씀을 이어 읽거나 서고에서 골라 읽어요."
        ) : resume.status === "none" ? (
          "서고에서 한 권 골라 읽어요."
        ) : (
          <span className="mission__skel" aria-hidden="true" />
        )
      }
    />
  );
  if (resume.status === "none") {
    return (
      <>
        {card}
        <div className="sect">
          <Link className="btn btn-primary" href="/hoondok/library">
            말씀 서고에서 고르기
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      {card}
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이어 읽기</h2>
        </div>
        <div className="day-go">
          {resume.status === "ready" ? (
            <Link className="card resume" href={resume.href}>
              <span className="resume__bd">
                <b>{resume.title}</b>
                <span className="resume__meta">{resume.meta}</span>
              </span>
            </Link>
          ) : (
            // 불러오는 동안 카드 높이만 지킨다 — 홈 미션 카드와 같은 막대
            <div className="card resume" aria-busy="true">
              <span className="resume__bd">
                <b>
                  <span className="mission__skel" aria-hidden="true" />
                </b>
                <span className="resume__meta">
                  <span className="mission__skel" aria-hidden="true" />
                </span>
              </span>
            </div>
          )}
          <Link className="btn btn-line" href="/hoondok/library">
            말씀 서고로 가기
          </Link>
        </div>
      </div>
    </>
  );
}
