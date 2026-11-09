"use client";

import { BookOpenTextIcon } from "@phosphor-icons/react/dist/ssr/BookOpenText";
import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { HandsPrayingIcon } from "@phosphor-icons/react/dist/ssr/HandsPraying";
import { MissionCard } from "@/components/hoondok";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { useResumeCard } from "@/features/hoondok/library/use-resume";
import { useNoticeSignal } from "@/features/hoondok/notice/notice-store";
import type { TodayResponse } from "@/features/hoondok/today";
import { TogetherCard } from "@/features/hoondok/together/components/together-card";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { EmptyDayLine } from "./empty-day";

/** 오늘 편성이 정해지기 전 미션 카드 자리. 어떤 카드가 몇 번째에 올지 말하지 않고 불러오는 중 카드 높이만 지킨다 */
function MissionSlot() {
  return (
    <div className="mission" data-pending="" aria-hidden="true">
      <span className="mission__ic" />
      <span className="mission__bd">
        <span className="mission__kind">
          <span className="mission__skel" />
        </span>
        <span className="mission__title">
          <span className="mission__skel" />
        </span>
        <span className="mission__meta">
          <span className="mission__skel" />
        </span>
      </span>
    </div>
  );
}

// 홈 "오늘의 실천" — summary(API-HD-004) 와 완료(API-HD-005)를 결합한다. 비로그인이면 표시만.
// "이번 주" 는 하늘 안 별자리(home-sky.tsx HomeWeek)가 같은 summary 로 그린다.
export function HomeMissions({ today }: { today: TodayResponse }) {
  const effective = useEffectiveToday(today);
  const reading = effective.isPersonalLoading ? null : effective.reading;
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  const study = useMissionCompletion("study", user, isLoading);
  // 마지막으로 읽던 원문 구간. 기록이 없거나 불러오지 못하면 지금까지와 같은 서고 안내 카드다
  const resume = useResumeCard();
  const isReadDone = completion.isDone || Boolean(summary?.today.read);
  // 홈에 있다는 신호 — 하단 안내 자리가 설치 안내 또는 알림 제안(첫 방문·오늘 마친 뒤)을 띄운다.
  useNoticeSignal({ placement: "home", isReadDone });
  // 오늘 편성이 있는지 아직 모른다 — 카드 순서가 빈 날/있는 날 중 어느 쪽인지 정해지지 않았으므로 자리만 잡는다.
  // 일반 편성이 이미 있으면 순서가 정해져 있어 기존대로 훈독하기 카드가 불러오는 중으로 그려진다
  const isUndecided = effective.status !== "available" && effective.isResolving;
  // 편성 없는 날(C3): 훈독하기 카드 대신 오늘 상태 한 줄, 첫 카드는 이어 읽기. 기록 유무가 정해진 뒤에만 말한다
  const emptyHint =
    resume.status === "ready"
      ? "읽던 말씀을 이어서 읽어 보세요."
      : resume.status === "none"
        ? "서고에서 한 권 골라 읽어 보세요."
        : null;

  const readCard = (
    <MissionCard
      kind={`훈독하기 · ${reading?.estimated_minutes ?? 3}분`}
      title={reading?.title ?? "오늘 말씀을 확인하지 못했어요"}
      meta={reading ? `${reading.work_title} · ${reading.speaker}` : "훈독하기에서 다시 불러와요"}
      icon={BookOpenTextIcon}
      href="/read"
      isPending={!reading && effective.isResolving}
      isDone={isReadDone}
      onToggle={reading && !effective.isResolving && !isReadDone ? completion.markDone : undefined}
    />
  );
  const prayCard = (
    <MissionCard
      kind="기도하기 · 1분"
      title="오늘의 기도 제목"
      meta="가족 기도 제목은 다음 단계에서"
      icon={HandsPrayingIcon}
      isDisabled
    />
  );
  const studyCard = (
    <MissionCard
      kind="말씀 읽기 · 이어 읽기"
      title={resume.status === "ready" ? resume.title : "말씀 서고"}
      meta={resume.status === "ready" ? resume.meta : "공개된 원문을 읽고 읽음으로 기록해요"}
      icon={BooksIcon}
      href={resume.status === "ready" ? resume.href : "/library"}
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
                ? resume.status === "ready"
                  ? "오늘은 이어 읽기"
                  : resume.status === "none"
                    ? "오늘은 서고에서"
                    : null
                : effective.isResolving
                  ? "오늘 말씀 확인 중"
                  : "1가지 · 말씀 읽기"}
          </span>
        </div>
        <div className="missions" aria-busy={isUndecided || undefined}>
          {isUndecided ? (
            <>
              <MissionSlot />
              <MissionSlot />
              <MissionSlot />
            </>
          ) : effective.isEmptyDay ? (
            <>
              <EmptyDayLine hint={emptyHint} />
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
