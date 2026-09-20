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
          {/* 하단은 주 CTA 한 개 + 그 아래 13px 보조 줄(좌 안내 · 우 질문 링크)이다 — 정본 프로토타입 read 그대로.
              읽은 말씀에서 바로 묻기(PLAN-HD-002 W2)는 문장을 채워만 두고 보내지는 않는다. */}
          <div className="sect">
            <ReadCompleteButton
              askHref={`/hoondok/ask?q=${encodeURIComponent(`${reading.title} 말씀은 어떤 뜻인가요?`)}`}
            />
          </div>
        </>
      ) : (
        <MalssumCard status={today.status === "withdrawn" ? "withdrawn" : "none"} />
      )}
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
