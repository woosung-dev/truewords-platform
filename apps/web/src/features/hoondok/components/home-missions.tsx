"use client";

import { BookOpenText, HandHeart, Library } from "lucide-react";
import Link from "next/link";
import { MissionCard, WeekStrip } from "@/components/hoondok";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

/**
 * 히어로 인사. 정본 프로토타입 today 의 `.shot__greet` 자리이며 이 화면에서 가장 큰 글자다.
 * 2026-09-22 `DES-PWA-003-Q2` 되돌림으로 사진 히어로를 복원했다 — 사진은 레포 정적 파일이고
 * 글자는 veil 위(하단 45%)에 놓인다 (DES-PWA-003 §3.2).
 * "이름은 가장 큰 글자 안에" 라는 위계는 그대로다. 이름을 "이번 주" 섹션 메타로 내리면
 * 인사가 비개인화되고 이름이 보조 정보가 된다. 로그인 전에는 같은 문장을 이름 없이 쓴다.
 */
export function HomeGreeting() {
  const { user } = useCurrentUser();
  const date = useKstDate();
  const { label: dateLabel } = formatKstDate(new Date(`${date}T12:00:00+09:00`));
  return (
    <div className="shot">
      {/* 사진은 화면 폭의 배경이라 Next/Image 대신 정적 <img> 를 쓴다 — 원본이 이미 2x 폭(1440)이고 변환도 없다 */}
      <img src="/hoondok/photos/home-morning-field.webp" alt="아침 햇살이 드는 들판" />
      <div className="shot__tx">
        <p className="shot__greet">
          밤이 깊을수록 새벽은 가까워요.
          <br />
          {user ? `${user.display_name}님, 오늘도 함께 읽어요.` : "오늘도 함께 읽어요."}
        </p>
        <p className="shot__sub">{dateLabel}</p>
      </div>
    </div>
  );
}

// 홈 "오늘의 실천" + "이번 주" — summary(API-HD-004) 와 완료(API-HD-005)를 결합한다. 비로그인이면 표시만.
export function HomeMissions({ today, todayWeekday }: { today: TodayResponse; todayWeekday: number }) {
  const effective = useEffectiveToday(today);
  const reading = effective.isPersonalLoading ? null : effective.reading;
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  const study = useMissionCompletion("study", user, isLoading);
  const isReadDone = completion.isDone || Boolean(summary?.today.read);

  return (
    <>
      {effective.reason && (
        <p className="notice" role="status">
          {effective.reason}
        </p>
      )}
      {!reading && !effective.isResolving && (
        <Link className="btn btn-line" href="/hoondok/library">
          오늘 말씀 대신 서고에서 읽기
        </Link>
      )}
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">오늘의 실천</h2>
          <span className="sect__meta">
            {reading ? "2가지 · 내 속도로" : effective.isResolving ? "오늘 말씀 확인 중" : "1가지 · 말씀 읽기"}
          </span>
        </div>
        <div className="missions">
          <MissionCard
            kind={`훈독하기 · ${reading?.estimated_minutes ?? 3}분`}
            title={
              effective.isPersonalLoading
                ? "오늘 정성 말씀을 불러오고 있어요"
                : (reading?.title ?? "오늘 말씀을 기다리고 있어요")
            }
            meta={reading ? `${reading.work_title} · ${reading.speaker}` : "편성되면 여기서 바로 읽어요"}
            icon={BookOpenText}
            href="/hoondok/read"
            isDone={isReadDone}
            onToggle={reading && !effective.isResolving && !isReadDone ? completion.markDone : undefined}
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
            meta="공개된 원문을 읽고 읽음으로 기록해요"
            icon={Library}
            href="/hoondok/library"
            isDone={study.isDone || Boolean(summary?.today.study)}
          />
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이번 주</h2>
          {user && summary?.streak_days !== undefined && (
            <span className="sect__meta">연속 {summary.streak_days}일</span>
          )}
          {!user && !isLoading && (
            <Link className="sect__meta" href={onboardingHref("/hoondok")}>
              로그인 후 기록돼요 →
            </Link>
          )}
        </div>
        <WeekStrip
          todayWeekday={
            effective.date === today.date ? todayWeekday : new Date(`${effective.date}T12:00:00+09:00`).getUTCDay()
          }
          doneByDay={summary?.week.map((day) => day.done) ?? []}
          streakDays={summary?.streak_days}
        />
      </div>
    </>
  );
}
