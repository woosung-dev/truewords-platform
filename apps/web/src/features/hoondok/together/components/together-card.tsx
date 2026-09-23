"use client";

// 함께 읽는 사람들 1단계 — 익명 카드 1장 (PLAN-HD-009, 프로토타입 today 첫 `.card.together`).
// 오늘 훈독하기를 마친 서로 다른 사용자 수만 보인다. 누가 읽었는지·안 읽은 사람·순위는 그리지 않는다.
// 서버가 기준 미만이면 count 를 주지 않으므로(is_shown=false) 숫자 대신 대체 문구를 쓴다.
// 모임 카드·"내 모임" 링크·모임 만들기 진입은 2단계(group-list.tsx)가 따로 그린다. 여기의 2단계는 완료 뒤 한 줄 진입뿐이다.
import { ChevronRight, MessageCircle, Sunrise } from "lucide-react";
import Link from "next/link";
import { isHoondokTogetherEnabled } from "../../flag";
import { useMyGroups } from "../use-groups";
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

/**
 * 훈독하기 완료 뒤 "{첫 모임}에 한 줄 남기기" (PLAN-HD-010 §6, 프로토타입 read `?done=1` 의 `.tg-after a.card.together`).
 * 서버가 완료를 기록했을 때(`isCounted`, TogetherDoneNotice 와 같은 조건)만 보인다 — 한 줄은 오늘 완료자만 쓸 수 있다(READ_REQUIRED).
 * 플래그 OFF·모임 없음·불러오는 중·오류면 아무것도 그리지 않는다.
 */
export function GroupShareEntry({ isCounted }: { isCounted: boolean }) {
  const isEnabled = isHoondokTogetherEnabled() && isCounted;
  const { data } = useMyGroups(isEnabled);
  const first = isEnabled ? data?.[0] : undefined;
  if (!first) return null;

  return (
    <Link className="card together tg-gc tg-share-go" href={`/hoondok/groups/${encodeURIComponent(first.id)}/share`}>
      <span className="tg-ic" aria-hidden="true">
        <MessageCircle size={20} />
      </span>
      <span className="together__bd">
        <b className="tg-gc__title">
          <span className="tg-gc__nm">{first.name}</span>
          <span className="tg-gc__cnt">에 한 줄 남기기</span>
        </b>
        <span>훈독회의 대화처럼, 머문 마음을 한 줄로 나눠요</span>
      </span>
      <ChevronRight className="tg-gc__go" size={20} aria-hidden="true" />
    </Link>
  );
}
