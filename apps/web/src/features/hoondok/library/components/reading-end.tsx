"use client";

// 원문 구간 끝. 주 동선은 "다음 구간" 한 장이고, 오늘 말씀 읽기 완료는 그 아래 체크 줄이다.
// 모양이 같은 버튼을 여러 개 쌓지 않는다 — 다음 구간(채움) > 읽음(체크 줄) > 이전 구간·질문(글자 링크).
// 오늘 훈독으로 가는 링크는 읽음을 남긴 뒤에만 보인다(그 전에는 하단 탭이 같은 곳으로 간다).
import { ArrowRight, Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { wordsPageHref } from "../api";

function StudyCheck() {
  const helpId = useId();
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("study", user, isLoading);
  const isDone = completion.isDone || Boolean(summary?.today.study);
  return (
    <>
      <div className="wd-done" data-done={isDone || undefined}>
        {isDone ? (
          <>
            <p className="wd-done__main" role="status">
              <span className="wd-ring" aria-hidden="true">
                <Check size={16} strokeWidth={2.6} />
              </span>
              오늘 말씀 읽기를 마쳤어요
            </p>
            <Link className="wd-done__home" href="/hoondok">
              오늘 훈독
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="wd-done__main"
            aria-label="오늘 말씀 읽음으로 기록"
            aria-describedby={helpId}
            aria-busy={completion.isSaving || undefined}
            disabled={isLoading || completion.isSaving}
            onClick={completion.markDone}
          >
            <span className="wd-ring" aria-hidden="true">
              {completion.isSaving && <span className="btn__spinner" />}
            </span>
            <span className="wd-done__tx">
              오늘 말씀 읽음으로 기록
              <small id={helpId}>연속 훈독일은 ‘훈독하기’ 완료를 기준으로 세요</small>
            </span>
          </button>
        )}
      </div>
      {completion.isUnsynced && (
        <Link className="wd-end__note" href={onboardingHref("/hoondok/library")}>
          로그인하면 오늘 기록이 남아요 →
        </Link>
      )}
      {completion.hasSaveFailed && (
        <p className="wd-end__note">기록을 아직 저장하지 못했어요. 연결되면 다시 시도해요.</p>
      )}
    </>
  );
}

export function ReadingEnd({
  volume,
  workTitle,
  page,
  totalPages,
}: {
  volume: string;
  workTitle: string;
  page: number;
  totalPages: number;
}) {
  return (
    <section className="wd-end" aria-labelledby="wd-end-title">
      <h2 className="wd-end__t" id="wd-end-title">
        {page}구간을 끝까지 읽었어요
      </h2>
      <p className="wd-end__s">
        {workTitle} {totalPages}구간 중 {page}구간
      </p>
      {page < totalPages && (
        <Link className="wd-next" href={wordsPageHref(volume, page + 1)}>
          <span>
            <small>다음 구간</small>
            <b>{page + 1}구간 읽기</b>
          </span>
          <span className="wd-next__go" aria-hidden="true">
            <ArrowRight size={20} />
          </span>
        </Link>
      )}
      <StudyCheck />
      <div className="wd-end__links">
        {page > 1 ? (
          <Link href={wordsPageHref(volume, page - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
            이전 구간
          </Link>
        ) : (
          <span />
        )}
        <Link href="/hoondok/ask">
          이 말씀에 질문하기
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
