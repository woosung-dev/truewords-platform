"use client";

// 함께 읽는 사람들 1단계 — 익명 카드 1장 (PLAN-HD-009, 프로토타입 today 첫 `.card.together`).
// 오늘 훈독하기를 마친 서로 다른 사용자 수만 보인다. 누가 읽었는지·안 읽은 사람·순위는 그리지 않는다.
// 서버가 기준 미만이면 count 를 주지 않으므로(is_shown=false) 숫자 대신 대체 문구를 쓴다.
// 모임 카드·"내 모임" 링크·모임 만들기 진입은 2단계라 없다.
import { Sunrise } from "lucide-react";
import { formatCount, useTogether } from "../use-together";

const FALLBACK = "오늘도 식구들과 함께 읽었어요";

export function TogetherCard() {
  const { data, isPending, isError } = useTogether();

  // 오류면 섹션째 숨긴다 — 홈의 다른 카드는 그대로 둔다.
  if (isError) return null;

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">함께 읽는 사람들</h2>
      </div>
      {isPending ? (
        <span className="skeleton tg-skeleton" aria-hidden="true" data-testid="together-skeleton" />
      ) : (
        <div className="card together">
          <span className="tg-ic" aria-hidden="true">
            <Sunrise size={20} />
          </span>
          <span className="together__bd">
            <b>
              {data.is_shown && data.count !== null ? `오늘 함께 읽은 식구 ${formatCount(data.count)}명` : FALLBACK}
            </b>
            <span>같은 말씀을 읽었어요 · 누가 읽었는지는 보이지 않아요</span>
          </span>
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
      <Sunrise size={20} aria-hidden="true" />
      {isCounted && count !== null ? (
        <span>
          당신까지 <b>{formatCount(count)}명</b>이 함께 읽었어요
        </span>
      ) : (
        <span>{FALLBACK}</span>
      )}
    </p>
  );
}
