// SCR-PWA-002 오늘 훈독 (홈) "오늘의 하늘". 비로그인 읽기 + 로그인 시 완료·연속일(Phase 2).
// 위는 KST 시간대 하늘(인사 · 이번 주 별자리), 지평선에 "오늘 읽을 말씀" 판, 아래 땅에 실천 · 책갈피 · 정성 · 함께 읽기.
// 설치 권유·알림 제안은 layout 의 하단 안내 자리가 그린다 — 홈은 HomeMissions 가 신호만 보낸다.
// 말씀 본문은 홈에 싣지 않는다 — 정본 프로토타입이 today 에서 `.lede`·`.lede-src` 를 숨기고,
// PRD SCR-PWA-002 는 미션 3종만 열거하며, DES §2.2 말씀 카드는 SCR-PWA-003·006·008 컴포넌트다.
// 말씀 판은 미션 카드가 이미 보이는 제목·저작물·화자·예상 분만 크게 보이고, 읽기는 `/read` 로 분리해 미션 카드 → 훈독 루프를 살린다.
import { loadToday } from "@/features/hoondok/api";
import { loadTodayCard } from "@/features/hoondok/cards/api";
import { cardDayLabel } from "@/features/hoondok/cards/format";
import { HomeMissions, HomeTogether } from "@/features/hoondok/components/home-missions";
import { HomeGreeting, HomeWeek, HomeWord } from "@/features/hoondok/components/home-sky";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { JeongseongCard } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import { JeongseongSheet } from "@/features/hoondok/jeongseong/components/jeongseong-sheet";
import { PathHomeSlot } from "@/features/hoondok/path/components/path-home-slot";
import { PersonalBookmarkHome } from "@/features/hoondok/personal/components/home-bookmark";
import { skySlotAt } from "@/features/hoondok/sky";
import { formatKstDate } from "@/features/hoondok/today";

export default async function HoondokHomePage() {
  // 오늘의 책갈피(PLAN-HD-012)는 플래그 ON 일 때만 부른다. 풀이 비었거나 못 읽으면 오늘 편성 카드는 없다.
  // 이 기기에 고른 답이 있으면 맞춘 카드로 바뀐다(PersonalBookmarkHome — 답은 기기에만 있어 클라이언트가 고른다).
  const isCardsEnabled = isHoondokCardsEnabled();
  const [today, card] = await Promise.all([loadToday(), isCardsEnabled ? loadTodayCard() : null]);
  const { weekday, iso } = formatKstDate();
  // 요청 시각(KST)의 하늘. 클라이언트는 hydration 뒤 기기 시각으로 다시 고른다(home-sky.tsx useSkySlot)
  const skySlot = skySlotAt();

  return (
    <section className="home">
      <HomeGreeting serverSlot={skySlot}>
        <HomeWeek today={today} todayWeekday={weekday} />
      </HomeGreeting>

      <div className="home__wrap home__ground">
        <div className="home__grid">
          <HomeWord today={today} serverSlot={skySlot} />
          {/* 7일 정성 — 플래그 OFF 면 children 그대로, 정성 중이면 정성 홈 아래에 오늘의 실천·책갈피를 접어 둔다.
              말씀 판은 지평선으로 끌어올려 앞 요소를 덮으므로 정성 자리는 판 뒤에 둔다(정성 중에는 판의 훈독하기만 숨김) */}
          <PathHomeSlot>
            <div className="home__practice">
              <HomeMissions today={today} />
            </div>
            {isCardsEnabled && (
              <div className="home__bookmark">
                <PersonalBookmarkHome todayCard={card} dateLabel={cardDayLabel(iso)} />
              </div>
            )}
          </PathHomeSlot>
        </div>

        <div className="home__slices">
          <JeongseongCard />
          {/* 함께 읽는 사람들 — 익명 숫자 카드 1장 (PLAN-HD-009) */}
          <HomeTogether today={today} />
        </div>

        <p className="notice">독립 운영 베타</p>
      </div>
      <JeongseongSheet />
    </section>
  );
}
