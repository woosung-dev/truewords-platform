"use client";

import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { GROUPS_KEY, groupKey, groupMembersKey, MY_GROUPS_KEY } from "../query-keys";
import { useKstDate } from "../use-kst-date";
import { type GroupCreate, type GroupDetail, type GroupJeongseongInput, groupErrorOf, groupsAPI } from "./groups-api";
import { isValidInviteCode, normalizeInviteCode } from "./invite-code";

// 함께 읽는 모임 React Query 훅 (PLAN-HD-010 §6). 화면(W1)·홈 카드(W2)는 여기서만 서버 상태를 읽는다.
// 무효화 원칙: 모임 하나를 바꾸면 그 상세 + 내 모임 목록(홈 카드), 식구가 바뀌면 식구 목록도.
// 훈독 완료는 PROGRESS_KEYS 의 GROUPS_KEY 접두가 한 번에 잡는다(use-missions.ts).

/** 404·403 은 다시 불러도 같다 — 재시도하지 않는다. 그 외(오프라인·5xx)는 한 번만. */
function retryOnce(failureCount: number, error: unknown): boolean {
  const { status } = groupErrorOf(error);
  if (status >= 400 && status < 500) return false;
  return failureCount < 1;
}

function invalidateGroup(queryClient: QueryClient, groupId: string) {
  void queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
  void queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY });
}

/**
 * 열어 둔 화면도 KST 자정을 넘기면 "오늘" 목록(읽은 식구·한 줄·N일차)을 다시 읽는다 (QA P2-6).
 * 자정 타이머·창 복귀 감지는 useKstDate 가 맡고(언마운트 때 정리), 날짜가 바뀐 순간에만 무효화한다.
 * 모임 캐시는 mutation 이 setQueryData 로 고치므로 날짜를 키에 넣지 않는다.
 */
function useInvalidateOnKstDateChange(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const date = useKstDate();
  const seenDate = useRef(date);
  // queryKey 는 렌더마다 새 배열이지만 날짜가 같으면 바로 돌아가므로 무효화는 날짜가 바뀐 한 번뿐이다
  useEffect(() => {
    if (seenDate.current === date) return;
    seenDate.current = date;
    void queryClient.invalidateQueries({ queryKey });
  }, [date, queryClient, queryKey]);
}

/** API-HD-030 내 모임. 비로그인이면 부르지 않도록 isEnabled 로 막는다(401 을 만들지 않는다). */
export function useMyGroups(isEnabled = true) {
  useInvalidateOnKstDateChange(MY_GROUPS_KEY);
  return useQuery({
    queryKey: MY_GROUPS_KEY,
    queryFn: groupsAPI.mine,
    enabled: isEnabled,
    retry: retryOnce,
    refetchOnWindowFocus: "always",
  });
}

/** API-HD-032 상세. 비모임원·없는 모임은 404 — 화면은 groupErrorOf(error).status 로 안내한다. */
export function useGroup(groupId: string | undefined) {
  useInvalidateOnKstDateChange(groupKey(groupId ?? ""));
  return useQuery({
    queryKey: groupKey(groupId ?? ""),
    queryFn: () => groupsAPI.get(groupId ?? ""),
    enabled: Boolean(groupId),
    retry: retryOnce,
    refetchOnWindowFocus: "always",
  });
}

/** API-HD-038 식구 목록 — 리더 화면에서만 isEnabled=true 로 부른다. */
export function useGroupMembers(groupId: string | undefined, isEnabled = true) {
  return useQuery({
    queryKey: groupMembersKey(groupId ?? ""),
    queryFn: () => groupsAPI.members(groupId ?? ""),
    enabled: Boolean(groupId) && isEnabled,
    retry: retryOnce,
  });
}

/** API-HD-035 초대 미리보기. 형식이 틀린 코드는 서버에 묻지 않는다(초대 limiter 소모 방지). */
export function useInvitePreview(code: string | null | undefined, isEnabled = true) {
  const normalized = normalizeInviteCode(code ?? "");
  return useQuery({
    queryKey: [...GROUPS_KEY, "invite", normalized] as const,
    queryFn: () => groupsAPI.previewInvite(normalized),
    enabled: isEnabled && isValidInviteCode(normalized),
    retry: retryOnce,
  });
}

// ---------- 모임 단위 변경 ----------

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupCreate) => groupsAPI.create(body),
    onSuccess: (detail: GroupDetail) => {
      queryClient.setQueryData(groupKey(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY });
    },
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ code, displayName }: { code: string; displayName: string }) =>
      groupsAPI.join(normalizeInviteCode(code), { display_name: displayName }),
    onSuccess: ({ group_id }) => {
      // 미리보기의 is_member 도 바뀐다 — 모임 키 전체를 다시 읽는다
      void queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
      void queryClient.invalidateQueries({ queryKey: groupKey(group_id) });
    },
  });
}

export function useRenameGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => groupsAPI.rename(groupId, { name }),
    onSuccess: (detail) => {
      queryClient.setQueryData(groupKey(groupId), detail);
      void queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY });
    },
  });
}

/** 모임 삭제·나가기 공통 — 상세·식구 캐시를 지우고 목록을 다시 읽는다(지운 상세를 다시 불러 404 를 만들지 않는다). */
function forgetGroup(queryClient: QueryClient, groupId: string) {
  queryClient.removeQueries({ queryKey: groupKey(groupId) });
  queryClient.removeQueries({ queryKey: groupMembersKey(groupId) });
  void queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY });
}

export function useDeleteGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => groupsAPI.remove(groupId),
    onSuccess: () => forgetGroup(queryClient, groupId),
  });
}

export function useLeaveGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => groupsAPI.leave(groupId),
    onSuccess: () => forgetGroup(queryClient, groupId),
  });
}

export function useRegenerateInvite(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => groupsAPI.regenerateInvite(groupId),
    onSuccess: (invite) => {
      queryClient.setQueryData<GroupDetail>(groupKey(groupId), (detail) =>
        detail ? { ...detail, ...invite } : detail,
      );
    },
  });
}

export function useUpdateMyName(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => groupsAPI.updateMyName(groupId, { display_name: displayName }),
    onSuccess: () => {
      invalidateGroup(queryClient, groupId);
      void queryClient.invalidateQueries({ queryKey: groupMembersKey(groupId) });
    },
  });
}

export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => groupsAPI.removeMember(groupId, memberId),
    onSuccess: () => {
      invalidateGroup(queryClient, groupId);
      void queryClient.invalidateQueries({ queryKey: groupMembersKey(groupId) });
    },
  });
}

// ---------- 모임 정성 ----------

export function useAddGroupJeongseong(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupJeongseongInput) => groupsAPI.addJeongseong(groupId, body),
    onSuccess: () => invalidateGroup(queryClient, groupId),
  });
}

export function useDeleteGroupJeongseong(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jeongseongId: string) => groupsAPI.deleteJeongseong(groupId, jeongseongId),
    onSuccess: () => invalidateGroup(queryClient, groupId),
  });
}

// ---------- 한 줄 · 반응 ----------

export function usePutTodayShare(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => groupsAPI.putTodayShare(groupId, { body }),
    onSuccess: () => invalidateGroup(queryClient, groupId),
  });
}

export function useDeleteShare(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => groupsAPI.deleteShare(groupId, shareId),
    onSuccess: () => invalidateGroup(queryClient, groupId),
  });
}

/** "함께 머물렀어요" 토글. 서버 값(has_reacted)만 상세 캐시에 반영한다 — 남의 한 줄 반응 수는 서버도 주지 않는다. */
export function useToggleReaction(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, isOn }: { shareId: string; isOn: boolean }) =>
      groupsAPI.setReaction(groupId, shareId, isOn),
    onSuccess: ({ has_reacted }, { shareId }) => {
      queryClient.setQueryData<GroupDetail>(groupKey(groupId), (detail) =>
        detail
          ? {
              ...detail,
              shares: detail.shares.map((share) =>
                share.id === shareId ? { ...share, has_my_reaction: has_reacted } : share,
              ),
            }
          : detail,
      );
    },
  });
}
