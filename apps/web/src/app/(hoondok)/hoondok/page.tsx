// SCR-PWA-002 오늘 훈독 (홈). 비로그인 읽기 + 로그인 시 완료·연속일(Phase 2). 히어로는 텍스트 카드(결정 12).
// 설치 안내 카드(Phase 3 E)는 직접 완료가 처음 기록된 뒤에만 보이며 자기 조건을 스스로 판정한다.
// 말씀 본문은 홈에 싣지 않는다 — 정본 프로토타입이 today 에서 `.lede`·`.lede-src` 를 숨기고,
// PRD SCR-PWA-002 는 미션 3종만 열거하며, DES §2.2 말씀 카드는 SCR-PWA-003·006·008 컴포넌트다.
// 홈은 "오늘 무엇을 할지", 읽기는 `/hoondok/read` 로 분리해야 미션 카드 → 훈독 루프가 산다.
import { loadToday } from "@/features/hoondok/api";
import { HomeMissions } from "@/features/hoondok/components/home-missions";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { JeongseongCard } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import { JeongseongSheet } from "@/features/hoondok/jeongseong/components/jeongseong-sheet";
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

      <HomeMissions reading={reading ?? null} todayWeekday={weekday} />

      <JeongseongCard />

      <InstallCard />

      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
      <JeongseongSheet />
    </section>
  );
}
