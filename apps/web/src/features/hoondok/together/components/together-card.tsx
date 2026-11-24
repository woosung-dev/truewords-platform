"use client";

// 함께 읽는 사람들 — 익명 카드 1장 (PLAN-HD-009). 숫자는 오늘(KST) 훈독 기록을 남긴 서로 다른 사용자 수다.
// 어떤 말씀을 읽었는지는 세지 않으므로(정성 장 완료도 포함) "같은 말씀" 이라고 쓰지 않는다.
// 내 오늘 훈독 여부에 따라 카드가 바뀐다: 읽기 전이면 읽으러 가는 버튼, 읽은 뒤면 함께했다는 확인.
// 누가 읽었는지·안 읽은 사람·순위는 그리지 않는다. 서버가 기준 미만이면 count 를 주지 않으므로(is_shown=false) 숫자 대신 문장을 쓴다.
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import Link from "next/link";
import { formatCount, useTogether } from "../use-together";

const PRIVACY = "누가 읽었는지는 보이지 않아요";
// 완료 직후 안내는 본인이 읽었으므로 과거형을 유지한다.
const DONE_FALLBACK = "오늘도 식구들과 함께 읽었어요";

export type TogetherReadState =
  /** 로그인·요약 확인 중 — 버튼이 떴다 사라지지 않게 자리만 지킨다 */
  | "unknown"
  /** 오늘 아직 훈독하지 않음(비로그인 포함) */
  | "todo"
  /** 서버에 오늘 훈독이 기록됨 — 숫자에 본인이 들어 있다(서버 캐시 60초 안이면 아직 빠져 있을 수 있다) */
  | "done"
  /** 이 기기에만 완료(비로그인·저장 전) — 집계에 없으므로 숫자를 본인과 엮지 않는다 */
  | "done-local";

export function TogetherCard({ readState, readHref }: { readState: TogetherReadState; readHref: string | null }) {
  const { data, isPending, isError } = useTogether();

  // 오류면 섹션째 숨긴다 — 홈의 다른 카드는 그대로 둔다.
  if (isError) return null;

  const isLoading = isPending || readState === "unknown";
  const count = !isLoading && data.is_shown ? data.count : null;
  const isDone = readState === "done" || readState === "done-local";

  let title: string;
  if (isDone) title = readState === "done" && count !== null ? `오늘 ${formatCount(count)}명이 함께 훈독했어요` : "오늘 식구들과 함께 훈독했어요";
  else title = count !== null ? `오늘 ${formatCount(count)}명이 훈독했어요` : "오늘도 식구들이 훈독하고 있어요";

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">함께 읽는 사람들</h2>
      </div>
      {isLoading ? (
        <span className="skeleton tg-skeleton" aria-hidden="true" data-testid="together-skeleton" />
      ) : (
        <div className="card together" data-done={isDone || undefined}>
          <span className="tg-ic" aria-hidden="true">
            {isDone ? <CheckIcon size={20} weight="bold" /> : <UsersThreeIcon size={20} />}
          </span>
          <span className="together__bd">
            <b>{title}</b>
            <span>{PRIVACY}</span>
          </span>
          {!isDone && readHref && (
            <Link className="btn btn-line together__go" href={readHref}>
              오늘 말씀 읽으러 가기
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 훈독하기 완료 뒤 한 줄 (프로토타입 read `.tg-after__n`). 숫자는 서버 값 그대로다 — 서버 캐시(60초) 때문에
 * 방금 완료한 본인이 아직 빠져 있을 수 있지만 +1 로 보정하지 않는다(PLAN-HD-009 [가정]).
 * `isCounted` 가 false(비로그인·저장 실패)면 본인이 집계에 없으므로 "당신까지" 를 쓰지 않는다.
 */
export function TogetherDoneNotice({ isCounted }: { isCounted: boolean }) {
  const { data, isPending, isError } = useTogether();
  if (isPending || isError) return null;

  const count = data.is_shown ? data.count : null;
  return (
    <p className="tg-after__n">
      <UsersThreeIcon size={20} aria-hidden="true" />
      {isCounted && count !== null ? (
        <span>
          당신까지 <b>{formatCount(count)}명</b>이 함께 읽었어요
        </span>
      ) : (
        <span>{DONE_FALLBACK}</span>
      )}
    </p>
  );
}
