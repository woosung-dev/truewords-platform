"use client";

import { BookOpenText, HandHeart, Library } from "lucide-react";
import Link from "next/link";
import { MissionCard, WeekStrip } from "@/components/hoondok";
import type { TodayReading } from "@/features/hoondok/today";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

// 홈 "오늘의 실천" + "이번 주" — summary(API-HD-004) 와 완료(API-HD-005)를 결합한다. 비로그인이면 표시만.
export function HomeMissions({ reading, todayWeekday }: { reading: TodayReading | null; todayWeekday: number }) {
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  const isReadDone = completion.isDone || Boolean(summary?.today.read);

  return (
    <>
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
            isDone={isReadDone}
            onToggle={reading && !isReadDone ? completion.markDone : undefined}
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
          {user ? (
            <span className="sect__meta">{user.display_name}님</span>
          ) : (
            <Link className="sect__meta" href={onboardingHref("/hoondok")}>
              로그인 후 기록돼요 →
            </Link>
          )}
        </div>
        <WeekStrip
          todayWeekday={todayWeekday}
          doneByDay={summary?.week.map((day) => day.done) ?? []}
          streakDays={summary?.streak_days ?? 0}
        />
      </div>
    </>
  );
}
