"use client";

import { BookOpenText, HandHeart, Library } from "lucide-react";
import Link from "next/link";
import { MissionCard, WeekStrip } from "@/components/hoondok";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { useResumeCard } from "@/features/hoondok/library/use-resume";
import { PushPromptCard } from "@/features/hoondok/notifications/components/push-prompt-card";
import { formatKstDate, type TodayResponse } from "@/features/hoondok/today";
import { TogetherCard } from "@/features/hoondok/together/components/together-card";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { EmptyDayLine } from "./empty-day";

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
  // 마지막으로 읽던 원문 구간. 기록이 없거나 불러오지 못하면 지금까지와 같은 서고 안내 카드다
  const resume = useResumeCard();
  const isReadDone = completion.isDone || Boolean(summary?.today.read);
  // 편성 없는 날(C3): 훈독하기 카드 대신 오늘 상태 한 줄, 첫 카드는 이어 읽기. 기록이 없다고 확인되면 서고로 말한다
  const hasResume = resume.status !== "none";

  const readCard = (
    <MissionCard
      kind={`훈독하기 · ${reading?.estimated_minutes ?? 3}분`}
      title={reading?.title ?? "오늘 말씀을 확인하지 못했어요"}
      meta={reading ? `${reading.work_title} · ${reading.speaker}` : "훈독하기에서 다시 불러와요"}
      icon={BookOpenText}
      href="/hoondok/read"
      isPending={!reading && effective.isResolving}
      isDone={isReadDone}
      onToggle={reading && !effective.isResolving && !isReadDone ? completion.markDone : undefined}
    />
  );
  const prayCard = (
    <MissionCard
      kind="기도하기 · 1분"
      title="오늘의 기도 제목"
      meta="가족·모임 기도 제목은 다음 단계에서"
      icon={HandHeart}
      isDisabled
    />
  );
  const studyCard = (
    <MissionCard
      kind="말씀 읽기 · 이어 읽기"
      title={resume.status === "ready" ? resume.title : "말씀 서고"}
      meta={resume.status === "ready" ? resume.meta : "공개된 원문을 읽고 읽음으로 기록해요"}
      icon={Library}
      href={resume.status === "ready" ? resume.href : "/hoondok/library"}
      isPending={resume.status === "pending"}
      isDone={study.isDone || Boolean(summary?.today.study)}
    />
  );

  return (
    <>
      {effective.reason && (
        <p className="notice" role="status">
          {effective.reason}
        </p>
      )}
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">오늘의 실천</h2>
          <span className="sect__meta">
            {reading
              ? "2가지 · 내 속도로"
              : effective.isEmptyDay
                ? hasResume
                  ? "오늘은 이어 읽기"
                  : "오늘은 서고에서"
                : effective.isResolving
                  ? "오늘 말씀 확인 중"
                  : "1가지 · 말씀 읽기"}
          </span>
        </div>
        <div className="missions">
          {effective.isEmptyDay ? (
            <>
              <EmptyDayLine hint={hasResume ? "읽던 말씀을 이어서 읽어 보세요." : "서고에서 한 권 골라 읽어 보세요."} />
              {studyCard}
              {prayCard}
            </>
          ) : (
            <>
              {readCard}
              {prayCard}
              {studyCard}
            </>
          )}
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
        />
      </div>

      {/* 알림 받기 제안 (PLAN-HD-006). 계정·설정 조회 뒤 늦게 나타나므로 미션 목록 아래에 둔다 — 위에 두면 목록을 밀어
          체크를 누르려던 손가락이 "나중에" 를 누른다. 오늘 마쳤는지는 여기 isReadDone(미션 체크 즉시 완료 포함)이 알려 준다. */}
      <PushPromptCard placement="home" isReadDone={isReadDone} />
    </>
  );
}

/** 홈 "함께 읽는 사람들" 익명 카드. 편성 없는 날에는 "같은 말씀을 읽었어요" 가 사실이 아니라 그리지 않는다(C3). */
export function HomeTogether({ today }: { today: TodayResponse }) {
  const { reading, isResolving, isEmptyDay } = useEffectiveToday(today);
  // 확인 중인데 말씀이 아직 없으면 기다린다 — 빈 날에 카드가 떴다 사라지거나 숫자를 부르지 않게
  if (isEmptyDay || (!reading && isResolving)) return null;
  return <TogetherCard />;
}
