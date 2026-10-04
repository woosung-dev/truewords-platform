"use client";

import { ChevronRight, Flame, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
// index.ts 의 export 정리는 W4 담당이라 경로를 직접 가리킨다 (PLAN-HD-002 §3.1).
import { MonthCalendar } from "@/components/hoondok";
import { StatusBox } from "@/features/hoondok/components/status-box";
import { isHoondokCardsEnabled, isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { JeongseongDayBadge, JeongseongProgress } from "@/features/hoondok/jeongseong/components/jeongseong-card";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { DeviceRecordsEntry } from "@/features/hoondok/records/components/device-records";
import { RecordsGardenSection } from "@/features/hoondok/records/components/records-section";
import { useRecords } from "@/features/hoondok/records/use-records";
import { useMonthHistory } from "@/features/hoondok/use-history";
import { useJeongseong } from "@/features/hoondok/use-jeongseong";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useLogout } from "@/features/identity/use-logout";
import { AccountSection } from "./account-section";

// SCR-PWA-014 나의 정원. 프로필 → 통계 3칸 → 월 달력 → 진행 중인 정성 (프로토타입 data-screen="garden" 순서).
// 읽기 화면이므로 비로그인을 자동으로 내쫓지 않고(gate.ts 원칙) 안내 카드만 보여준다.
// "함께 읽는 사람들" 섹션은 프로토타입과 같은 자리(정성 다음)에 두되, 016 이 프리뷰 셸이라 진입 링크만이고 플래그가 꺼지면 그리지 않는다.
// 정성 진행은 "N일차"로만 적고 빠진 날 수는 쓰지 않는다 (DEC-PWA-023).
// '나의 기록'(C1)은 자기 요청·오류를 따로 가진다 — 표시 목록이 실패해도 통계·달력은 그대로 보인다.
// 계정(이메일·로그아웃)은 매일 보는 기록과 떨어진 맨 아래에 둔다. 로그아웃하면 이 화면에 머물러 비로그인 카드가 곧 결과 안내가 된다.
const BETA_NOTICE = "독립 운영 베타 · 가정연합 공식 앱이 아닙니다";
const JEONGSEONG_HREF = "/hoondok?sheet=jeongseong";
const FAMILY_HREF = "/hoondok/family";

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

/** 진행 중인 정성 카드. 막대·배지·문구는 홈 카드와 같은 조각이다 — 날짜 기준 일차만 적고 읽은 날 수·퍼센트는 쓰지 않는다.
 *  없으면 섹션 안 빈 상태 한 줄(문장 + 짝이 맞는 행동 하나)이다 — 정원 안에 큰 빈 상태 카드가 연달아 쌓이지 않게 한다. */
function JeongseongSection({ period }: { period: JeongseongPeriodResponse | null }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">진행 중인 정성</h2>
      </div>
      {period ? (
        <div className="card">
          <div className="gd-row">
            <b className="gd-row__t">
              {period.duration_days}일 정성 · {period.topic}
            </b>
            <JeongseongDayBadge period={period} />
          </div>
          <JeongseongProgress period={period} />
        </div>
      ) : (
        <div className="empty-line">
          <p className="empty-line__t">진행 중인 정성이 없어요</p>
          <Link className="btn btn-line btn--sm" href={JEONGSEONG_HREF}>
            정성 시작하기
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * 통계 3칸. 쌓인 것(누적일)을 먼저 두고 연속은 그다음이다. 불꽃·강조색은 연속이 1 이상일 때만 쓴다 —
 * 0 에 강조를 붙이면 실패처럼 읽힌다 (DEC-PWA-023). 세 값이 모두 0 이면 숫자 대신 한 줄로 말한다.
 */
function GardenStats({ total, streak, best }: { total: number; streak: number; best: number }) {
  if (total === 0 && streak === 0 && best === 0)
    return (
      <div className="empty-line">
        <p className="empty-line__t">첫 훈독을 마치면 여기에 날이 쌓여요.</p>
      </div>
    );
  return (
    <div className="card">
      <div className="stats">
        <div>
          <b className="stats__n">{total}</b>
          <span className="stats__lab">누적일</span>
        </div>
        <div>
          <b className={streak > 0 ? "stats__n stats__n--accent" : "stats__n"}>
            {streak > 0 && <Flame size={20} aria-hidden="true" />}
            {streak}
          </b>
          <span className="stats__lab">현재 연속일</span>
        </div>
        <div>
          <b className="stats__n">{best}</b>
          <span className="stats__lab">최대 연속일</span>
        </div>
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

/** 016 가족·친구 진입 (W3-F). 프리뷰 플래그가 꺼져 있으면 아무것도 그리지 않는다 — 운영에는 없는 화면이다.
 *  읽은 사람만 보인다는 약속을 제목 아래 글자로 밝힌다 (DEC-PWA-023: 안 읽은 사람의 이름·상태는 없다). */
function FamilyEntrySection() {
  if (!isHoondokPreviewEnabled()) return null;
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">함께 읽는 사람들</h2>
      </div>
      <Link className="card fm-entry" href={FAMILY_HREF}>
        <span className="fm-entry__bd">
          <b>가족·친구와 함께 읽어요</b>
          <span>읽은 사람만 보여요 · 연결과 공개 범위를 확인해요</span>
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
  // '나의 기록' 섹션과 같은 캐시다. 위에서 오류를 이미 알렸으면 섹션이 같은 오류를 한 번 더 쌓지 않고, 다시 불러오기가 함께 읽는다
  const records = useRecords(isLoggedIn);
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
      <section className="col">
        <GardenSkeleton />
        <GardenNotice />
      </section>
    );

  if (!user)
    return (
      <section className="col">
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
    if (records.isError) records.refetch();
  };

  return (
    <section className="col">
      <div className="gd-profile">
        <span className="gd-profile__av" aria-hidden="true">
          {Array.from(user.display_name.trim())[0] ?? ""}
        </span>
        <b className="gd-profile__name">{user.display_name}</b>
      </div>

      {hasFailed ? (
        <StatusBox onRetry={retry} isRetrying={summary.isFetching || history.isFetching || jeongseong.isFetching}>
          기록을 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.
        </StatusBox>
      ) : isLoadingData ? (
        <GardenSkeleton />
      ) : (
        <>
          <div className="sect">
            <div className="sect__head">
              <h2 className="sect__title">말씀과 함께한 시간</h2>
              <span className="sect__meta">나만 봄</span>
            </div>
            <GardenStats total={stats.total_days} streak={stats.streak_days} best={stats.best_streak_days} />
          </div>

          <MonthCalendar month={month} days={history.data?.days ?? []} today={today} />

          <JeongseongSection period={jeongseong.data ?? null} />
        </>
      )}

      <RecordsGardenSection isErrorShownAbove={hasFailed} />

      <DeviceRecordsEntry />

      <BookmarksEntrySection />

      <FamilyEntrySection />

      <AccountSection user={user} logout={logout} />

      <GardenNotice />
    </section>
  );
}
