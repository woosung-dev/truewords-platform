"use client";

import { ArrowRight, Sprout } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { HoondokButton, HoondokMascot, WeekStrip } from "@/components/hoondok";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import type { HoondokUser } from "@/features/identity/types";

// 관리 화면 맨 위 주요 카드. 밀리의 "정기구독 카드" 자리에 훈독 기록 요약(누적·현재 연속·최대 연속·이번 주)을 둔다.
// 숫자는 나의 정원과 같은 요약 API(useSummary)라 두 화면이 다른 값을 보일 수 없다 — 달력·정성·노트는 정원에만 있다.
// 연속일 옆에 부엉이·불꽃·축하 장식을 두지 않는다: 연속일 압박으로 읽힌다(정원 불꽃 규칙과 같은 이유).

export function AccountHero({ user, todayWeekday }: { user: HoondokUser; todayWeekday: number }) {
  const summary = useSummary(true);
  const stats = summary.data;
  const initial = Array.from(user.display_name.trim())[0] ?? "";

  return (
    <div className="ac-shell">
      <section className="ac-core ac-hero" aria-labelledby="ac-hero-name">
        <div className="ac-hero__id">
          <span className="ac-hero__av" aria-hidden="true">
            {initial}
          </span>
          <span className="ac-hero__who">
            <b className="ac-hero__name" id="ac-hero-name">
              {user.display_name}
            </b>
            <span className="ac-hero__mail">나만 보는 기록이에요</span>
          </span>
        </div>

        {summary.isError ? (
          <p className="ac-hero__err" role="status">
            <span>기록을 불러오지 못했어요</span>
            <HoondokButton variant="line" isSmall onClick={() => void summary.refetch()}>
              다시 시도
            </HoondokButton>
          </p>
        ) : !stats ? (
          <div className="ac-hero__data" aria-busy="true" aria-label="기록을 불러오는 중">
            <span className="skeleton ac-skel--stats" />
            <span className="skeleton ac-skel--week" />
          </div>
        ) : (
          <div className="ac-hero__data">
            <dl className="ac-stats">
              <div className="ac-stat">
                <dt>누적</dt>
                <dd>
                  <b>{stats.total_days}</b>일
                </dd>
              </div>
              <div className="ac-stat ac-stat--hot">
                <dt>현재 연속</dt>
                <dd>
                  <b>{stats.streak_days}</b>일
                </dd>
              </div>
              <div className="ac-stat">
                <dt>최대 연속</dt>
                <dd>
                  <b>{stats.best_streak_days}</b>일
                </dd>
              </div>
            </dl>
            <div className="ac-week">
              <p className="ac-week__lab" aria-hidden="true">
                이번 주
              </p>
              <WeekStrip todayWeekday={todayWeekday} doneByDay={stats.week.map((day) => day.done)} />
            </div>
          </div>
        )}

        <div className="ac-hero__cta">
          <Link className="btn btn-primary ac-chunky" href="/">
            오늘 훈독하기
          </Link>
          <Link className="btn ac-chunky ac-chunky--ghost" href="/garden">
            나의 정원
            <span className="ac-chunky__ic" aria-hidden="true">
              <ArrowRight size={16} />
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}

// 로그인 전(또는 방금 로그아웃한) 관리 화면 맨 위 카드. 이 화면의 유일한 주 버튼이다.
export function GuestHero({
  hasLoggedOut,
  titleRef,
}: {
  hasLoggedOut: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="ac-shell">
      <section className="ac-core ac-guest">
        <HoondokMascot
          pose="welcome"
          size={96}
          fallback={
            <span className="empty__ic" aria-hidden="true">
              <Sprout size={28} />
            </span>
          }
        />
        <h2 className="ac-guest__title" ref={titleRef} tabIndex={-1}>
          {hasLoggedOut ? "로그아웃했어요" : "로그인하면 훈독 기록이 이어져요"}
        </h2>
        <p className="ac-guest__body">
          {hasLoggedOut
            ? "다시 로그인하면 기록과 정성을 이어서 볼 수 있어요."
            : "누적일 · 연속일 · 훈독하기 알림을 어느 기기에서나 이어서 볼 수 있어요."}
        </p>
        <Link className="btn btn-primary ac-chunky" href={onboardingHref("/settings")}>
          시작하기
        </Link>
      </section>
    </div>
  );
}
