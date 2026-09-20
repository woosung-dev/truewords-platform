"use client";

import { ChevronRight, Flame, Sprout } from "lucide-react";
import Link from "next/link";
import { HoondokButton } from "@/components/hoondok";
// index.ts 의 export 정리는 W4 담당이라 경로를 직접 가리킨다 (PLAN-HD-002 §3.1).
import { MonthCalendar } from "@/components/hoondok/month-calendar";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { useMonthHistory } from "@/features/hoondok/use-history";
import { useJeongseong } from "@/features/hoondok/use-jeongseong";
import { useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

// SCR-PWA-014 나의 정원. 프로필 → 통계 3칸 → 월 달력 → 진행 중인 정성 (프로토타입 data-screen="garden" 순서).
// 읽기 화면이므로 비로그인을 자동으로 내쫓지 않고(gate.ts 원칙) 안내 카드만 보여준다.
// 가족·친구 섹션은 프로토타입과 같은 자리(정성 다음)에 두되, 016 이 프리뷰 셸이라 진입 링크만이고 플래그가 꺼지면 그리지 않는다.
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

/** 진행 중인 정성 카드. 퍼센트는 바 길이와 함께 숫자로도 적는다(DES §3.3). */
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
                {period.duration_days}일 새벽 정성 · {period.topic}
              </b>
              <span className="badge badge--accent">D-{period.progress.remaining_days}</span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="정성 진행률"
              aria-valuenow={period.progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i className="progress__fill" style={{ width: `${period.progress.percent}%` }} />
            </div>
            <div className="gd-row gd-row--meta">
              <span>
                {period.progress.done_days} / {period.duration_days}일 · {period.progress.percent}%
              </span>
              <span>밀린 날 {period.progress.missed_days}</span>
            </div>
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

/** 016 가족·친구 진입 (W3-F). 프리뷰 플래그가 꺼져 있으면 아무것도 그리지 않는다 — 운영에는 없는 화면이다. */
function FamilyEntrySection() {
  if (!isHoondokPreviewEnabled()) return null;
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">가족·친구</h2>
      </div>
      <Link className="card fm-entry" href={FAMILY_HREF}>
        <span className="fm-entry__bd">
          <b>가족·친구와 함께 읽어요</b>
          <span>연결과 공개 범위를 확인해요</span>
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

  if (isUserLoading)
    return (
      <section className="col">
        <p className="hint" role="status">
          불러오는 중…
        </p>
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
            <h2 className="empty__title">로그인하면 훈독 기록과 정성을 볼 수 있어요</h2>
            <p className="empty__body">연속일 · 월 달력 · 진행 중인 정성이 여기에 모여요.</p>
            <p className="gd-cta">
              <Link className="btn btn-line" href={onboardingHref("/hoondok/garden")}>
                시작하기
              </Link>
            </p>
          </div>
        </div>
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
    <section className="col">
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
        <p className="hint" role="status">
          불러오는 중…
        </p>
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

      <FamilyEntrySection />

      <GardenNotice />
    </section>
  );
}
