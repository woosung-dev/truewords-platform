"use client";

import { BookOpenText, HandHeart, Library } from "lucide-react";
import Link from "next/link";
import { MissionCard, WeekStrip } from "@/components/hoondok";
import type { TodayReading } from "@/features/hoondok/today";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

/**
 * 히어로 인사. 정본 프로토타입 today 의 `.shot__greet` 자리이며 이 화면에서 가장 큰 글자다.
 * 사진이 텍스트 카드로 바뀐 뒤(DES-PWA-003-Q2)에도 "이름은 가장 큰 글자 안에" 라는 위계는 유지한다 —
 * 이름을 "이번 주" 섹션 메타로 내리면 인사가 비개인화되고 이름이 보조 정보가 된다.
 * 로그인 전에는 같은 문장을 이름 없이 쓴다(없는 값을 지어내지 않는다).
 */
export function HomeGreeting({ dateLabel }: { dateLabel: string }) {
  const { user } = useCurrentUser();
  return (
    <div className="card">
      <p className="greet">
        밤이 깊을수록 새벽은 가까워요.
        <br />
        {user ? `${user.display_name}님, 오늘도 함께 읽어요.` : "오늘도 함께 읽어요."}
      </p>
      <p className="greet__sub">{dateLabel}</p>
    </div>
  );
}

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
          {/* 로그인 상태에서는 메타를 비운다 — 연속일은 바로 아래 `.week__streak` 가 이미 말하고,
              계정 조회 중에 로그인 링크를 먼저 보였다가 지우면 깜빡인다. */}
          {!user && !isLoading && (
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
