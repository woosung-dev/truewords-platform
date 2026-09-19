// SCR-PWA-003 훈독하기. 오늘 말씀 전문 + 출처 줄 + 완료 버튼(로그인 시 기록, 아니면 로컬 → 로그인 후 소급).
import { MalssumCard } from "@/components/hoondok";
import { loadToday } from "@/features/hoondok/api";
import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";
import { TodayNote } from "@/features/hoondok/note/components/today-note";

export default async function HoondokReadPage() {
  const today = await loadToday();
  const reading = today.status === "available" ? today.reading : null;

  return (
    <section className="col col--read">
      {reading ? (
        <>
          <MalssumCard status="available" reading={reading} isFull />
          <TodayNote readingDate={reading.reading_date} />
          <div className="sect">
            <ReadCompleteButton />
          </div>
        </>
      ) : (
        <MalssumCard status={today.status === "withdrawn" ? "withdrawn" : "none"} />
      )}
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
