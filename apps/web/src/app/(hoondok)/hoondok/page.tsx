// SCR-PWA-002 오늘 훈독 (홈). 비로그인 읽기 + 로그인 시 완료·연속일(Phase 2). 히어로는 텍스트 카드(결정 12).
import { MalssumCard } from "@/components/hoondok";
import { loadToday } from "@/features/hoondok/api";
import { HomeMissions } from "@/features/hoondok/components/home-missions";
import { formatKstDate } from "@/features/hoondok/today";

export default async function HoondokHomePage() {
  const today = await loadToday();
  const { label, weekday } = formatKstDate();
  const reading = today.status === "available" ? today.reading : null;

  return (
    <section className="col">
      <div className="masthead">
        <span className="masthead__nm">훈독</span>
        <span className="masthead__dt">{label}</span>
      </div>

      <div className="card">
        <p className="greet">
          밤이 깊을수록 새벽은 가까워요.
          <br />
          오늘도 함께 읽어요.
        </p>
        <p className="greet__sub">{label}</p>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">오늘 말씀</h2>
          <span className="sect__meta">{reading ? `약 ${reading.estimated_minutes}분` : today.date}</span>
        </div>
        {reading ? (
          <MalssumCard status="available" reading={reading} />
        ) : (
          <MalssumCard status={today.status === "withdrawn" ? "withdrawn" : "none"} />
        )}
      </div>

      <HomeMissions reading={reading ?? null} todayWeekday={weekday} />

      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
