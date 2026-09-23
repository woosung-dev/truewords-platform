// SCR-PWA-002 오늘 훈독 (홈). 비로그인 읽기 + 로그인 시 완료·연속일(Phase 2). 히어로는 텍스트 카드(결정 12).
// 설치 안내 카드(Phase 3 E)는 직접 완료가 처음 기록된 뒤에만 보이며 자기 조건을 스스로 판정한다.
// 말씀 본문은 홈에 싣지 않는다 — 정본 프로토타입이 today 에서 `.lede`·`.lede-src` 를 숨기고,
// PRD SCR-PWA-002 는 미션 3종만 열거하며, DES §2.2 말씀 카드는 SCR-PWA-003·006·008 컴포넌트다.
// 홈은 "오늘 무엇을 할지", 읽기는 `/hoondok/read` 로 분리해야 미션 카드 → 훈독 루프가 산다.
import { loadToday } from "@/features/hoondok/api";
import { HomeGreeting, HomeMissions } from "@/features/hoondok/components/home-missions";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { JeongseongCard } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import { JeongseongSheet } from "@/features/hoondok/jeongseong/components/jeongseong-sheet";
import { formatKstDate } from "@/features/hoondok/today";
import { TogetherCard } from "@/features/hoondok/together/components/together-card";

export default async function HoondokHomePage() {
  const today = await loadToday();
  const { weekday } = formatKstDate();

  return (
    <section className="col">
      <HomeGreeting />

      <HomeMissions today={today} todayWeekday={weekday} />

      <JeongseongCard />

      {/* 함께 읽는 사람들 1단계 — 익명 숫자 카드 1장 (PLAN-HD-009). 모임 카드는 2단계 */}
      <TogetherCard />

      <InstallCard />

      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
      <JeongseongSheet />
    </section>
  );
}
