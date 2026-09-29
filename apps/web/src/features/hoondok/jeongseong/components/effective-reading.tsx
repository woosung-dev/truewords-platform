"use client";
import { MalssumCard } from "@/components/hoondok";
import { EmptyDayActions } from "../../components/empty-day";
import { ReadCompleteButton } from "../../components/read-complete-button";
import { TodayNote } from "../../note/components/today-note";
import type { TodayResponse } from "../../today";
import { useEffectiveToday } from "../use-effective-today";

export function EffectiveReading({ today }: { today: TodayResponse }) {
  const effective = useEffectiveToday(today);
  return (
    <>
      {effective.reason && (
        <p className="notice" role="status">
          {effective.reason}
        </p>
      )}
      {effective.isPersonalLoading ? (
        <div className="card" role="status" aria-busy="true">
          오늘 정성 말씀을 불러오고 있어요
        </div>
      ) : effective.reading ? (
        <>
          <MalssumCard status="available" reading={effective.reading} isFull />
          <TodayNote readingDate={effective.reading.reading_date} />
          <div className="sect">
            <ReadCompleteButton
              isDisabled={effective.isResolving}
              askHref={`/hoondok/ask?q=${encodeURIComponent(`${effective.reading.title} 말씀은 어떤 뜻인가요?`)}`}
            />
          </div>
        </>
      ) : effective.isResolving ? (
        <div className="card" role="status" aria-busy="true">
          오늘 말씀을 확인하고 있어요
        </div>
      ) : (
        // 편성 없는 날·철회는 상태 카드 + 다음 행동. 조회 실패면 위 안내만 두고 빈 날이라고 말하지 않는다(C3)
        <EmptyDayActions
          status={effective.isEmptyDay ? (effective.status === "withdrawn" ? "withdrawn" : "none") : undefined}
        />
      )}
    </>
  );
}
