// SCR-PWA-003 훈독하기. Phase 1: 오늘 말씀 전문 + 출처 줄 + 완료 버튼(로컬 상태만, 기록은 Phase 2).
import { MalssumCard } from "@/components/hoondok";
import { loadToday } from "@/features/hoondok/api";
import { ReadCompleteButton } from "@/features/hoondok/components/read-complete-button";

export default async function HoondokReadPage() {
  const today = await loadToday();
  const reading = today.status === "available" ? today.reading : null;

  return (
    <section className="col col--read">
      {reading ? (
        <>
          <MalssumCard status="available" reading={reading} isFull />
          <div className="sect">
            <ReadCompleteButton />
            <div className="hint">
              <span>완료 기록은 로그인 후 남아요</span>
            </div>
          </div>
        </>
      ) : (
        <MalssumCard status={today.status === "withdrawn" ? "withdrawn" : "none"} />
      )}
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
