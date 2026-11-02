"use client";

import { ChevronRight, Flame, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
// index.ts 의 export 정리는 W4 담당이라 경로를 직접 가리킨다 (PLAN-HD-002 §3.1).
import { HoondokButton, MonthCalendar } from "@/components/hoondok";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { JeongseongDayBadge, JeongseongProgress } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { PersonalGardenEntry } from "@/features/hoondok/personal/components/garden-entry";
import { DeviceRecordsEntry } from "@/features/hoondok/records/components/device-records";
import { RecordsGardenSection } from "@/features/hoondok/records/components/records-section";
import { useMonthHistory } from "@/features/hoondok/use-history";
import { useJeongseong } from "@/features/hoondok/use-jeongseong";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useLogout } from "@/features/identity/use-logout";
import { AccountSection } from "./account-section";

// SCR-PWA-014 나의 정원. 프로필 → 통계 3칸 → 월 달력 → 진행 중인 정성 (프로토타입 data-screen="garden" 순서).
// 읽기 화면이므로 비로그인을 자동으로 내쫓지 않고(gate.ts 원칙) 안내 카드만 보여준다.
// 정성 진행은 "N일차"로만 적고 빠진 날 수는 쓰지 않는다 (DEC-PWA-023).
// '나의 기록'(C1)은 자기 요청·오류를 따로 가진다 — 표시 목록이 실패해도 통계·달력은 그대로 보인다.
// 계정(이메일·로그아웃)은 매일 보는 기록과 떨어진 맨 아래에 둔다. 로그아웃하면 이 화면에 머물러 비로그인 카드가 곧 결과 안내가 된다.
const BETA_NOTICE = "독립 운영 베타";
const JEONGSEONG_HREF = "/hoondok?sheet=jeongseong";

export type GardenScreenProps = {
  /** 서버가 계산한 KST 월 `YYYY-MM`. 클라이언트가 다시 계산하면 자정 경계에서 hydration 이 어긋난다 */
  month: string;
  /** 서버가 계산한 KST 오늘 `YYYY-MM-DD` */
  today: string;
};

function GardenNotice() {
  return <p className="notice">{BETA_NOTICE}</p>;
}

/**
 * 불러오는 동안의 자리 지킴. 글자 한 줄이면 데이터가 올 때 통계·달력·정성이 한꺼번에 들어와 화면이 크게 튄다.
 * 높이는 실제 카드(통계 96 · 달력 300 · 정성 120)에 맞춰 잡는다 (DES §1.5 loading).
 */
function GardenSkeleton() {
  return (
    <div className="gd-loading" role="status" aria-busy="true" aria-label="기록을 불러오는 중">
      <span className="skeleton gd-skeleton--stats" />
      <span className="skeleton gd-skeleton--cal" />
      <span className="skeleton gd-skeleton--row" />
    </div>
  );
}

/** 진행 중인 정성 카드. 막대·배지·문구는 홈 카드와 같은 조각이다 — 날짜 기준 일차만 적고 읽은 날 수·퍼센트는 쓰지 않는다. */
function JeongseongSection({ period }: { period: JeongseongPeriodResponse | null }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">진행 중인 정성</h2>
      </div>
      <div className="card">
        {period ? (
          <>
            <div className="gd-row">
              <b className="gd-row__t">
                {period.duration_days}일 정성 · {period.topic}
              </b>
              <JeongseongDayBadge period={period} />
            </div>
            <JeongseongProgress period={period} />
          </>
        ) : (
          <div className="empty gd-empty">
            <span className="empty__ic" aria-hidden="true">
              <Sprout size={28} />
            </span>
            <h3 className="empty__title">진행 중인 정성이 없어요</h3>
            <p className="empty__body">기간을 정해 두면 여기에서 진행을 볼 수 있어요.</p>
            <p className="gd-cta">
              <Link className="btn btn-line btn--sm" href={JEONGSEONG_HREF}>
                새로 시작
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** 나의 책갈피 진입 (PLAN-HD-012 SCR-PWA-026). 플래그가 꺼져 있으면 그리지 않는다. */
function BookmarksEntrySection() {
  if (!isHoondokCardsEnabled()) return null;
  return (
    <div className="sect">
      <Link className="card fm-entry" href="/hoondok/bookmarks">
        <span className="fm-entry__bd">
          <b>나의 책갈피</b>
          <span>받은 책갈피가 책별로 꽂혀 있어요 · 건넨 책갈피도 여기에</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function GardenScreen({ month, today }: GardenScreenProps) {
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const isLoggedIn = Boolean(user);
  const summary = useSummary(isLoggedIn);
  const history = useMonthHistory(month, isLoggedIn);
  const jeongseong = useJeongseong(isLoggedIn);
  // 로그아웃하면 계정 묶음이 사라지므로 상태는 화면이 든다 — 성공이면 비로그인 카드 제목이 "로그아웃했어요" 가 된다
  const logout = useLogout();
  const loggedOutTitleRef = useRef<HTMLHeadingElement>(null);
  const hasLoggedOut = logout.isSuccess && !user;

  // 누른 버튼이 사라져 초점이 body 로 떨어진다 — 결과를 알리는 제목으로 옮긴다
  useEffect(() => {
    if (hasLoggedOut) loggedOutTitleRef.current?.focus();
  }, [hasLoggedOut]);

  if (isUserLoading)
    return (
      <section className="col gd-screen">
        <GardenSkeleton />
        <GardenNotice />
      </section>
    );

  if (!user)
    return (
      <section className="col gd-screen">
        <div className="card">
          <div className="empty">
            <span className="empty__ic" aria-hidden="true">
              <Sprout size={28} />
            </span>
            <h2 className="empty__title" ref={loggedOutTitleRef} tabIndex={-1}>
              {hasLoggedOut ? "로그아웃했어요" : "로그인하면 훈독 기록과 정성을 볼 수 있어요"}
            </h2>
            <p className="empty__body">
              {hasLoggedOut
                ? "다시 로그인하면 기록과 정성을 이어서 볼 수 있어요."
                : "연속일 · 월 달력 · 진행 중인 정성 · 형광펜과 노트가 여기에 모여요."}
            </p>
            {/* 이 화면의 유일한 행동이라 주 버튼이다 (DES §4 한 화면에 primary 하나) */}
            <p className="gd-cta">
              <Link className="btn btn-primary" href={onboardingHref("/hoondok/garden")}>
                시작하기
              </Link>
            </p>
          </div>
        </div>
        <PersonalGardenEntry />
        <DeviceRecordsEntry isGuest />
        <GardenNotice />
      </section>
    );

  const stats = summary.data;
  const hasFailed = summary.isError || history.isError || jeongseong.isError;
  const isLoadingData = summary.isPending || history.isPending || jeongseong.isPending || !stats;
  const retry = () => {
    void summary.refetch();
    void history.refetch();
    void jeongseong.refetch();
  };

  return (
    <section className="col gd-screen">
      <div className="gd-profile">
        <span className="gd-profile__av" aria-hidden="true">
          {Array.from(user.display_name.trim())[0] ?? ""}
        </span>
        <b className="gd-profile__name">{user.display_name}</b>
      </div>

      {hasFailed ? (
        <div className="card">
          <div className="empty gd-empty" role="status">
            <h2 className="empty__title">기록을 불러오지 못했어요</h2>
            <p className="empty__body">잠시 뒤 다시 시도해 주세요.</p>
            <p className="gd-cta">
              <HoondokButton variant="line" isSmall onClick={retry}>
                다시 시도
              </HoondokButton>
            </p>
          </div>
        </div>
      ) : isLoadingData ? (
        <GardenSkeleton />
      ) : (
        <>
          <div className="sect">
            <div className="sect__head">
              <h2 className="sect__title">말씀과 함께한 시간</h2>
              <span className="sect__meta">나만 봄</span>
            </div>
            <div className="card">
              <div className="stats">
                <div>
                  <b className="stats__n stats__n--accent">
                    <Flame size={20} aria-hidden="true" />
                    {stats.streak_days}
                  </b>
                  <span className="stats__lab">현재 연속일</span>
                </div>
                <div>
                  <b className="stats__n">{stats.best_streak_days}</b>
                  <span className="stats__lab">최대 연속일</span>
                </div>
                <div>
                  <b className="stats__n">{stats.total_days}</b>
                  <span className="stats__lab">누적일</span>
                </div>
              </div>
            </div>
          </div>

          <MonthCalendar month={month} days={history.data?.days ?? []} today={today} />

          <JeongseongSection period={jeongseong.data ?? null} />
        </>
      )}

      <PersonalGardenEntry />

      <RecordsGardenSection />

      <DeviceRecordsEntry />

      <BookmarksEntrySection />

      <AccountSection user={user} logout={logout} />

      <GardenNotice />
    </section>
  );
}
