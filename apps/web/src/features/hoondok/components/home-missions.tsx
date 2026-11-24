"use client";

import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { HandsPrayingIcon } from "@phosphor-icons/react/dist/ssr/HandsPraying";
import { useSyncExternalStore } from "react";
import { MissionCard } from "@/components/hoondok";
import { useEffectiveToday } from "@/features/hoondok/jeongseong/use-effective-today";
import { useResumeCard } from "@/features/hoondok/library/use-resume";
import { useHeroReadButton } from "@/features/hoondok/path/components/path-home-slot";
import { readPending, subscribePending } from "@/features/hoondok/pending";
import { useNoticeSignal } from "@/features/hoondok/notice/notice-store";
import type { TodayResponse } from "@/features/hoondok/today";
import { TogetherCard, type TogetherReadState } from "@/features/hoondok/together/components/together-card";
import { useKstDate } from "@/features/hoondok/use-kst-date";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { useCurrentUser } from "@/features/identity/use-current-user";

/** 오늘 편성이 정해지기 전 실천 카드 자리. 불러오는 중 카드 높이만 지킨다 */
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

// 홈 "오늘의 실천" — 이어 읽기 · 기도하기(준비 중). 오늘 읽을 말씀(훈독하기)과 빈 날 안내는 위 주인공 판(home-sky.tsx HomeWord)이
// 말하므로 여기서 되풀이하지 않는다. summary(API-HD-004)·완료(API-HD-005)는 완료 표시와 하단 안내 신호에만 쓴다.
// "이번 주" 는 하늘 안 별자리(home-sky.tsx HomeWeek)가 같은 summary 로 그린다.
export function HomeMissions({ today }: { today: TodayResponse }) {
  const effective = useEffectiveToday(today);
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  const study = useMissionCompletion("study", user, isLoading);
  // 마지막으로 읽던 원문 구간. 기록이 없거나 불러오지 못하면 지금까지와 같은 서고 안내 카드다
  const resume = useResumeCard();
  const isReadDone = completion.isDone || Boolean(summary?.today.read);
  // 홈에 있다는 신호 — 하단 안내 자리가 설치 안내 또는 알림 제안(첫 방문·오늘 마친 뒤)을 띄운다.
  useNoticeSignal({ placement: "home", isReadDone });
  // 오늘 편성이 아직 정해지지 않았다 — 위에 정성·빈 날 안내가 붙기 전이라 카드 자리만 잡는다
  const isUndecided = effective.status !== "available" && effective.isResolving;

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
          {!isUndecided && <span className="sect__meta">내 속도로</span>}
        </div>
        <div className="missions" aria-busy={isUndecided || undefined}>
          {isUndecided ? (
            <>
              <MissionSlot />
              <MissionSlot />
            </>
          ) : (
            <>
              {studyCard}
              {prayCard}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * 홈 "함께 읽는 사람들" 익명 카드. 편성 없는 날에는 오늘 읽을 말씀이 없어 그리지 않는다(C3).
 * 내 오늘 훈독 여부는 말씀 판(home-sky.tsx HomeWord)과 같은 판정(요약 today.read + 이 기기 완료 키)이다.
 * 완료 훅(useMissionCompletion)을 또 부르면 로그인 소급 POST 가 하나 더 생기므로 여기서는 읽기만 한다.
 * 7일 정성 중이면 오늘 읽을 것은 정성 장이라 판처럼 버튼을 그리지 않는다.
 */
export function HomeTogether({ today }: { today: TodayResponse }) {
  const { reading, isResolving, isEmptyDay } = useEffectiveToday(today);
  const { user, isLoading } = useCurrentUser();
  const summary = useSummary(Boolean(user));
  const date = useKstDate();
  const isLocalDone = useSyncExternalStore(
    subscribePending,
    () => readPending("read", date, user?.id) || (Boolean(user) && readPending("read", date)),
    () => false,
  );
  const heroButton = useHeroReadButton();
  // 확인 중인데 말씀이 아직 없으면 기다린다 — 빈 날에 카드가 떴다 사라지거나 숫자를 부르지 않게
  if (isEmptyDay || (!reading && isResolving)) return null;

  const isServerDone = Boolean(user) && Boolean(summary.data?.today.read);
  const isDoneKnown = !isLoading && (!user || summary.data !== undefined || summary.isError || isLocalDone);
  const readState: TogetherReadState = !isDoneKnown
    ? "unknown"
    : isServerDone
      ? "done"
      : isLocalDone
        ? "done-local"
        : "todo";
  return <TogetherCard readState={readState} readHref={heroButton === "show" ? "/read" : null} />;
}
