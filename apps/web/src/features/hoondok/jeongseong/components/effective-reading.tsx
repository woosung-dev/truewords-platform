"use client";
import { MalssumCard } from "@/components/hoondok";
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
      ) : (
        <MalssumCard status={effective.status === "withdrawn" ? "withdrawn" : "none"} />
      )}
    </>
  );
}
