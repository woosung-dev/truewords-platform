// SCR-PWA-002 오늘 훈독 (홈). Phase 1: 비로그인 읽기. 히어로는 텍스트 카드(결정 12).
import { BookOpenText, HandHeart, Library } from "lucide-react";
import { MalssumCard, MissionCard, WeekStrip } from "@/components/hoondok";
import { loadToday } from "@/features/hoondok/api";
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

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">오늘의 실천</h2>
          <span className="sect__meta">3가지 · 약 5분</span>
        </div>
        <div className="missions">
          <MissionCard
            kind={`훈독하기 · ${reading?.estimated_minutes ?? 3}분`}
            title={reading?.title ?? "오늘 말씀을 기다리고 있어요"}
            meta={reading ? `${reading.work_title} · ${reading.speaker}` : "편성되면 여기서 바로 읽어요"}
            icon={BookOpenText}
            href="/hoondok/read"
          />
          <MissionCard
            kind="기도하기 · 1분"
            title="오늘의 기도 제목"
            meta="가족·교회 기도 제목은 다음 단계에서"
            icon={HandHeart}
            isDisabled
          />
          <MissionCard
            kind="말씀 읽기 · 이어 읽기"
            title="말씀 서고"
            meta="서고·이어 읽기는 다음 단계에서"
            icon={Library}
            isDisabled
          />
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이번 주</h2>
          <span className="sect__meta">로그인 후 기록돼요</span>
        </div>
        <WeekStrip todayWeekday={weekday} />
      </div>

      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
