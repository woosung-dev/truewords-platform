"use client";

import { Check, ChevronRight, Sprout } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import type { HoondokUser } from "@/features/identity/types";

// 관리 화면 맨 위 기록 카드. 밀리의 "정기구독 카드" 자리에 훈독 기록 요약(누적·현재 연속·최대 연속·이번 주)을 둔다.
// 숫자는 나의 정원과 같은 요약 API(useSummary)라 두 화면이 다른 값을 보일 수 없다 — 달력·정성·노트는 정원에만 있다.
// 연속일 옆에 부엉이·불꽃·축하 장식을 두지 않는다: 연속일 압박으로 읽힌다(정원 불꽃 규칙과 같은 이유).

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export function AccountHero({ user, todayWeekday }: { user: HoondokUser; todayWeekday: number }) {
  const summary = useSummary(true);
  const stats = summary.data;
  const initial = Array.from(user.display_name.trim())[0] ?? "";
  const todayIndex = (todayWeekday + 6) % 7; // 월=0
  const doneByDay = stats?.week.map((day) => day.done) ?? [];
  const doneCount = doneByDay.filter(Boolean).length;

  return (
    <div className="ac-shell ra-rec">
      <section className="ac-core" aria-labelledby="ra-rec-name">
        <div className="ra-id">
          <span className="ra-id__av" aria-hidden="true">
            {initial}
          </span>
          <span className="ra-id__who">
            <b className="ra-id__name" id="ra-rec-name">
              {user.display_name}
            </b>
            <span className="ra-id__sub">나만 보는 기록이에요</span>
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
          <>
            <dl className="ra-nums">
              <div className="ra-num">
                <dt>누적</dt>
                <dd>
                  <b>{stats.total_days}</b>일
                </dd>
              </div>
              <div className="ra-num ra-num--now">
                <dt>현재 연속</dt>
                <dd>
                  <b>{stats.streak_days}</b>일
                </dd>
              </div>
              <div className="ra-num">
                <dt>최대 연속</dt>
                <dd>
                  <b>{stats.best_streak_days}</b>일
                </dd>
              </div>
            </dl>
            <div className="ra-week">
              <p className="ra-week__head" style={{ margin: 0 }}>
                <b>이번 주</b>
                <span>7일 중 {doneCount}일 읽었어요</span>
              </p>
              <ol className="ra-days" aria-label="이번 주 훈독">
                {DAY_LABELS.map((day, index) => {
                  const isDone = Boolean(doneByDay[index]);
                  const isToday = index === todayIndex;
                  return (
                    <li
                      key={day}
                      className="ra-day"
                      aria-label={`${day}요일${isDone ? " · 훈독 완료" : ""}`}
                      data-done={isDone ? "" : undefined}
                      data-today={isToday ? "" : undefined}
                      aria-current={isToday ? "date" : undefined}
                    >
                      <span className="ra-day__o" aria-hidden="true">
                        {isDone && <Check size={16} strokeWidth={2.5} />}
                      </span>
                      <span aria-hidden="true">{isToday ? "오늘" : day}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </>
        )}

        <div className="ra-cta">
          <Link className="btn btn-primary ac-chunky" href="/">
            오늘 훈독하기
          </Link>
          <Link className="ra-link" href="/garden">
            나의 정원에서 기록 보기
            <ChevronRight size={18} aria-hidden="true" />
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
    <div className="ac-shell ra-rec">
      <section className="ac-core ra-guest">
        <HoondokMascot
          pose="welcome"
          size={88}
          fallback={
            <span className="ra-guest__ic" aria-hidden="true">
              <Sprout size={28} />
            </span>
          }
        />
        <h2 className="ra-guest__t" ref={titleRef} tabIndex={-1}>
          {hasLoggedOut ? "로그아웃했어요" : "로그인하면 훈독 기록이 이어져요"}
        </h2>
        <p className="ra-guest__b">
          {hasLoggedOut
            ? "다시 로그인하면 기록과 정성을 이어서 볼 수 있어요."
            : "어느 기기에서나 같은 기록을 볼 수 있어요."}
        </p>
        {!hasLoggedOut && (
          <ul className="ra-guest__keep">
            <li>누적일</li>
            <li>연속일</li>
            <li>훈독하기 알림</li>
          </ul>
        )}
        <Link className="btn btn-primary ac-chunky" href={onboardingHref("/settings")}>
          시작하기
        </Link>
      </section>
    </div>
  );
}
