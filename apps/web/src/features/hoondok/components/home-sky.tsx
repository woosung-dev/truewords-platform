"use client";

// 홈 "오늘의 하늘" (SCR-PWA-002). 위쪽이 KST 시간대(새벽·낮·저녁·밤)에 따라 바뀌는 하늘이고, 그 안에 인사와 이번 주 별자리가 있다.
// 지평선에 걸친 "오늘의 책갈피" 판은 cards/components/home-board.tsx 가 그린다(부엉이·시간대는 여기 SKY_OWL·useSkySlot).
// 그림은 사진 대신 그라데이션 네 장(opacity 전환)과 잔별·해달(transform)이다.
// 시간대: 서버가 요청 시각(KST)으로 고른 값을 serverSlot 으로 받아 hydration 은 그 값으로 하고, 직후 이 기기 시각으로 다시 본다
// (useSyncExternalStore 의 서버 스냅숏). 경계 시각에 서버·기기가 달라도 불일치 경고 없이 하늘만 한 번 바뀐다.
import Link from "next/link";
import { type ReactNode, useSyncExternalStore } from "react";
import { type MascotPose, WeekConstellation } from "@/components/hoondok";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { FIELD_STARS, msUntilNextSlot, type SkySlot, skySlotAt } from "@/features/hoondok/sky";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

/** 시간대별 부엉이. 낮의 cheer 도 시각으로만 고른다 — 완료·연속일에 따라 바꾸지 않는다(보상 연출 금지 DEC-PWA-019) */
export const SKY_OWL: Record<SkySlot, MascotPose> = { dawn: "welcome", day: "cheer", dusk: "rest", night: "reading" };

function subscribeSlot(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, msUntilNextSlot() + 1_000);
  };
  const refresh = () => {
    onChange();
    schedule();
  };
  schedule();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/** 지금 KST 시간대. hydration 동안은 서버가 고른 값이고, 열어 둔 화면은 경계 시각·복귀 때 다시 고른다 */
export function useSkySlot(serverSlot: SkySlot): SkySlot {
  return useSyncExternalStore(
    subscribeSlot,
    () => skySlotAt(),
    () => serverSlot,
  );
}

/**
 * 히어로 하늘 + 인사. 이 화면에서 가장 큰 글자다. "이름은 가장 큰 글자 바로 아래 인사 안에" 라는 위계를 지킨다 —
 * 로그인 전에는 같은 문장을 이름 없이 쓴다. children 은 하늘 안에 들어갈 이번 주 별자리(HomeWeek)다.
 */
export function HomeGreeting({ serverSlot, children }: { serverSlot: SkySlot; children?: ReactNode }) {
  const slot = useSkySlot(serverSlot);
  const { user } = useCurrentUser();
  const date = useKstDate();
  const { label: dateLabel } = formatKstDate(new Date(`${date}T12:00:00+09:00`));
  return (
    <div className="sky" data-sky={slot}>
      <div className="sky__bg" aria-hidden="true">
        <span className="sky__layer sky__layer--night" />
        <span className="sky__layer sky__layer--dawn" />
        <span className="sky__layer sky__layer--day" />
        <span className="sky__layer sky__layer--dusk" />
        <span className="sky__band">
          <span className="sky__band-half" />
          <span className="sky__band-half" />
        </span>
        <span className="sky__stars">
          {FIELD_STARS.map((star) => (
            <i
              key={`${star.left}-${star.top}`}
              className={star.isTwinkle ? "is-twinkle" : undefined}
              style={{ left: star.left, top: star.top, width: star.size, height: star.size, opacity: star.alpha }}
            />
          ))}
        </span>
        <span className="sky__orb-pos">
          <span className="sky__orb" />
        </span>
        <svg className="sky__horizon" viewBox="0 0 1280 132" preserveAspectRatio="none">
          <path className="sky__far" d="M0 64 C 180 26 400 30 620 60 S 1040 92 1280 46 L 1280 132 L 0 132 Z" />
          <path className="sky__near" d="M0 104 C 260 80 520 84 760 104 S 1120 122 1280 98 L 1280 132 L 0 132 Z" />
        </svg>
      </div>
      <div className="home__wrap sky__in">
        <div className="sky__tx">
          <p className="sky__date">{dateLabel}</p>
          <p className="sky__greet">
            <span>밤이 깊을수록</span> <span>새벽은 가까워요.</span>
          </p>
          <p className="sky__hello">{user ? `${user.display_name}님, 오늘도 함께 읽어요.` : "오늘도 함께 읽어요."}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 하늘 안 "이번 주" 별자리 — summary(API-HD-004)의 week·streak_days 그대로. 연속일은 요약이 도착한 뒤에만 말한다 */
export function HomeWeek({ today, todayWeekday }: { today: TodayResponse; todayWeekday: number }) {
  const effective = useEffectiveToday(today);
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  return (
    <div className="sect sky-week">
      <div className="sect__head">
        <h2 className="sect__title">이번 주</h2>
        {user && summary?.streak_days !== undefined && <span className="sect__meta">연속 {summary.streak_days}일</span>}
        {!user && !isLoading && (
          <Link className="sect__meta" href={onboardingHref("/")}>
            로그인 후 기록돼요 →
          </Link>
        )}
      </div>
      <p className="sky-week__help">훈독한 날은 금색 별이 돼요</p>
      <WeekConstellation
        todayWeekday={
          effective.date === today.date ? todayWeekday : new Date(`${effective.date}T12:00:00+09:00`).getUTCDay()
        }
        doneByDay={summary?.week.map((day) => day.done) ?? []}
      />
    </div>
  );
}
