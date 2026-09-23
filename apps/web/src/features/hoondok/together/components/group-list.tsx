"use client";

// 홈 "함께 읽는 사람들" 2단계 — 1단계 익명 카드(TogetherCard) 아래 모임 카드 최대 5장 또는 진입 카드 (PLAN-HD-010 §6 홈).
// 플래그 OFF 면 아무것도 그리지 않는다(D3). 불러오는 동안은 카드 높이만 지키고, 오류는 섹션째 숨긴다(홈을 깨지 않는다).
// /me/groups 401(세션 만료)은 비로그인과 같게 진입 카드로 보인다 — 오류 안내를 띄우지 않는다.
import type { ReactNode } from "react";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { isHoondokTogetherEnabled } from "../../flag";
import { groupErrorOf } from "../groups-api";
import { useMyGroups } from "../use-groups";
import { GroupCard } from "./group-card";
import { GroupEntryCard } from "./group-entry-card";

/** 홈에 싣는 모임 카드 상한. 더 있으면 앞의 5개만 보인다 [가정: "모두 보기" 링크 없음]. */
export const HOME_GROUP_LIMIT = 5;

export function GroupList() {
  if (!isHoondokTogetherEnabled()) return null;
  return <GroupListInner />;
}

function GroupListInner() {
  const { user, isLoading, isError: isUserError } = useCurrentUser();
  const groups = useMyGroups(Boolean(user));

  // 사용자 조회 자체가 실패(오프라인·5xx)하면 로그인 여부를 모른다 — 섹션을 숨긴다
  if (isUserError && !user) return null;

  let body: ReactNode;
  if (isLoading || (user && groups.isPending)) {
    body = <span className="skeleton tg-skeleton" aria-hidden="true" data-testid="groups-skeleton" />;
  } else if (!user) {
    body = <GroupEntryCard isLoggedIn={false} />;
  } else if (groups.isError) {
    if (groupErrorOf(groups.error).status !== 401) return null;
    body = <GroupEntryCard isLoggedIn={false} />;
  } else if (!groups.data?.length) {
    body = <GroupEntryCard isLoggedIn />;
  } else {
    body = groups.data.slice(0, HOME_GROUP_LIMIT).map((group) => <GroupCard key={group.id} group={group} />);
  }

  return (
    <div className="tg-stack tg-home" data-testid="group-list">
      {body}
    </div>
  );
}
