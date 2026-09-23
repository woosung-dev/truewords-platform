"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { DoneBadge, HoondokButton } from "@/components/hoondok";
import { GroupShareEntry, TogetherDoneNotice } from "@/features/hoondok/together/components/together-card";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

/**
 * "훈독 완료" — 로그인 상태면 POST /hoondok/missions/read/complete, 아니면 로컬(KST 날짜 키)에 두고 로그인 후 소급한다.
 *
 * 버튼 아래 보조 줄(`.hint`)은 정본 프로토타입 read 하단과 같은 구조다: 좌 13px 안내 · 우 질문 링크.
 * 질문 링크를 전폭 `.btn` 으로 두면 주 CTA 와 크기가 같아져 화면의 시선 종착점이 둘로 갈린다(DES §3.1 · §5).
 * 링크는 줄 높이를 흔들지 않고 히트 영역만 44px 로 넓힌다(`.read-ask-link`).
 */
export function ReadCompleteButton({ askHref, isDisabled = false }: { askHref: string; isDisabled?: boolean }) {
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  // 서버가 오늘 완료를 확정한 사실과, 로컬(낙관적)까지 포함한 완료 표시를 나눠 둔다.
  const isServerDone = Boolean(summary?.today.read);
  const isDone = completion.isDone || isServerDone;
  const isCounted = Boolean(user) && !completion.isUnsynced && !completion.hasSaveFailed;

  // 연속일은 서버가 오늘 완료를 확정했을 때만 적는다. 요약이 오기 전의 0 도, 낙관적 완료 직후의
  // 옛 요약값도 거짓이다 — 저장에 실패한 채 "연속 N일째" 를 말하면 실패 안내와 서로 어긋난다.
  const streak = summary?.streak_days;
  let note: string;
  if (streak === undefined) note = !user && !isLoading ? "완료 기록은 로그인 후 남아요" : "";
  else if (isServerDone) note = `연속 ${streak}일째 이어가고 있어요`;
  // 로컬만 완료(서버 미확정·미동기·저장 실패) — 카드가 이미 사정을 말하고 있어 보조 줄은 비운다.
  else if (isDone) note = "";
  else note = `완료하면 연속 ${streak + 1}일이 돼요`;

  const footer = (
    <p className="hint">
      <span>{note}</span>
      <Link className="read-ask-link" href={askHref}>
        이 말씀에 질문하기
      </Link>
    </p>
  );

  if (isDone) {
    return (
      <>
        <div className="card read-done" role="status">
          <span className="read-done__hd">
            <DoneBadge />
            <span>오늘 훈독을 마쳤어요.</span>
          </span>
          {completion.isUnsynced && (
            <Link className="read-done__note" href={onboardingHref("/hoondok/read")}>
              로그인하면 오늘 기록이 남아요 →
            </Link>
          )}
          {completion.hasSaveFailed && (
            <span className="read-done__note">기록을 아직 저장하지 못했어요. 연결되면 다시 시도해요.</span>
          )}
        </div>
        {/* 함께 읽는 사람들 한 줄 (PLAN-HD-009). 서버에 기록된 완료만 집계되므로 로컬만 완료면 "당신까지" 를 쓰지 않는다.
            모임 한 줄 남기기(PLAN-HD-010)는 저장 응답까지 기다린다 — 서버 미확정이면 한 줄 저장이 READ_REQUIRED 로 막힌다. */}
        <TogetherDoneNotice isCounted={isCounted} />
        <GroupShareEntry isCounted={isCounted && !completion.isSaving} />
        {footer}
      </>
    );
  }
  return (
    <>
      {/* 저장 중에는 라벨을 그대로 두고 좌측 스피너로 진행을 알리며 중복 제출을 막는다 (DES §1.5 loading). */}
      <HoondokButton onClick={completion.markDone} isLoading={completion.isSaving} disabled={isDisabled || isLoading}>
        <Check size={20} />
        훈독 완료
      </HoondokButton>
      {footer}
    </>
  );
}
