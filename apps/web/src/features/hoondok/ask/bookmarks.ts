"use client";

// 북마크 토글 — 추천 카드·북마크 탭·내 질문 상세·공개 상세가 함께 쓰는 훅 하나.
// 두 종류를 한 이름("북마크")으로 보인다: 내 질문은 계정 기록의 saved(PATCH /hoondok/me/asks/{id}),
// 추천 질문은 공개 질문 북마크(PUT·DELETE /hoondok/questions/{id}/bookmark).
//
// 낙관적으로 목록·상세 캐시를 함께 고치고, 실패하면 반대로 되돌린다. 성공 뒤에는 관련 키를 stale 로만 표시한다
// (refetchType "none") — 보고 있는 목록을 다시 받아 순서가 손가락 밑에서 바뀌지 않게, 다음에 열 때 서버 값으로 맞춘다.
import { type InfiniteData, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type {
  MyAskDetail,
  MyAskListResponse,
  PublicQuestionBookmarkListResponse,
  PublicQuestionDetail,
  PublicQuestionListResponse,
  PublicQuestionSummary,
} from "@truewords/api-client-ts/types";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { Toast } from "@/features/hoondok/library/components/reader-toast";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { PUBLIC_BOOKMARKS_KEY, PUBLIC_QUESTIONS_KEY, publicQuestionKey } from "../query-keys";
import { ASK_LIST_KEY, askDetailKey, asksAPI } from "./asks-api";
import { publicQuestionsAPI } from "./public-api";

export type BookmarkTarget =
  | { kind: "ask"; id: string }
  /** summary 가 있으면 북마크 목록 캐시에 바로 넣는다(index 자리, 없으면 맨 앞 = 서버의 최근 북마크 순). */
  | { kind: "pub"; id: string; summary?: PublicQuestionSummary; index?: number };

export type ShowToast = (message: string, action?: Toast["action"]) => void;

export const BOOKMARK_TOAST = {
  on: "북마크했어요",
  off: "북마크를 해제했어요",
  failed: "북마크하지 못했어요. 잠시 뒤 다시 해 주세요.",
  offFailed: "북마크를 해제하지 못했어요",
  login: "로그인하면 북마크할 수 있어요",
} as const;

type ToggleOptions = {
  /** 북마크 탭 — 해제하면 "되돌리기"를 5초 둔다. 되돌리면 onRestore 를 부른다(포커스를 돌려줄 자리). */
  undo?: { onRestore?: () => void };
  /** 되돌리기처럼 결과가 화면에 바로 보이는 경우 성공 알림을 띄우지 않는다. */
  isQuiet?: boolean;
};

function patchPub(client: QueryClient, target: Extract<BookmarkTarget, { kind: "pub" }>, bookmarked: boolean) {
  const { id } = target;
  client.setQueriesData<InfiniteData<PublicQuestionListResponse>>({ queryKey: PUBLIC_QUESTIONS_KEY }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === id ? { ...item, bookmarked } : item)),
          })),
        }
      : data,
  );
  client.setQueryData<PublicQuestionDetail>(publicQuestionKey(id), (data) => (data ? { ...data, bookmarked } : data));
  client.setQueryData<PublicQuestionBookmarkListResponse>(PUBLIC_BOOKMARKS_KEY, (data) => {
    if (!data) return data;
    const rest = data.items.filter((item) => item.id !== id);
    if (!bookmarked) return { ...data, items: rest };
    if (!target.summary) return data;
    const at = Math.min(Math.max(target.index ?? 0, 0), rest.length);
    return { ...data, items: [...rest.slice(0, at), { ...target.summary, bookmarked: true }, ...rest.slice(at)] };
  });
}

function patchAsk(client: QueryClient, id: string, saved: boolean) {
  client.setQueryData<MyAskListResponse>(ASK_LIST_KEY, (data) =>
    data ? { ...data, items: data.items.map((item) => (item.id === id ? { ...item, saved } : item)) } : data,
  );
  client.setQueryData<MyAskDetail>(askDetailKey(id), (data) => (data ? { ...data, saved } : data));
}

/** 북마크 목록 캐시에서 지우기 전 자리 — 실패·되돌리기 때 같은 자리에 돌려놓는다. */
function withPosition(client: QueryClient, target: BookmarkTarget): BookmarkTarget {
  if (target.kind !== "pub") return target;
  const items = client.getQueryData<PublicQuestionBookmarkListResponse>(PUBLIC_BOOKMARKS_KEY)?.items ?? [];
  const index = items.findIndex((item) => item.id === target.id);
  return index < 0 ? target : { ...target, summary: target.summary ?? items[index], index };
}

function markStale(client: QueryClient, target: BookmarkTarget) {
  const keys =
    target.kind === "pub"
      ? [PUBLIC_QUESTIONS_KEY, publicQuestionKey(target.id), PUBLIC_BOOKMARKS_KEY]
      : [ASK_LIST_KEY, askDetailKey(target.id)];
  for (const queryKey of keys) void client.invalidateQueries({ queryKey, refetchType: "none" });
}

/**
 * returnTo — 비로그인 탭에서 알림의 "로그인"이 돌아올 화면(같은 origin 경로).
 * 확인 중(isLoading)에는 누름을 무시하고, 요청이 끝나기 전 같은 대상의 누름도 무시한다(버튼을 흐리게 잠그지 않는다).
 */
export function useBookmarkToggle({ showToast, returnTo }: { showToast: ShowToast; returnTo: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const inflight = useRef(new Set<string>());

  function promptLogin() {
    showToast(BOOKMARK_TOAST.login, { label: "로그인", run: () => router.push(onboardingHref(returnTo)) });
  }

  function patch(target: BookmarkTarget, next: boolean) {
    if (target.kind === "pub") patchPub(client, target, next);
    else patchAsk(client, target.id, next);
  }

  /** 성공하면 true. 비로그인·확인 중·요청 중이면 아무것도 하지 않고 false. */
  async function toggle(rawTarget: BookmarkTarget, next: boolean, options: ToggleOptions = {}): Promise<boolean> {
    if (isLoading) return false;
    if (!user) {
      promptLogin();
      return false;
    }
    const flightKey = `${rawTarget.kind}:${rawTarget.id}`;
    if (inflight.current.has(flightKey)) return false;
    inflight.current.add(flightKey);
    const target = withPosition(client, rawTarget);
    patch(target, next);
    try {
      if (target.kind === "pub") {
        await (next ? publicQuestionsAPI.bookmark(target.id) : publicQuestionsAPI.unbookmark(target.id));
      } else {
        const detail = await asksAPI.setSaved(target.id, next);
        // 응답이 계정 기록 전체라 상세 캐시가 있으면 그 값으로 맞춘다
        client.setQueryData<MyAskDetail>(askDetailKey(target.id), (data) => (data ? detail : data));
      }
    } catch (error) {
      patch(target, !next);
      if (error instanceof ApiError && error.status === 401) promptLogin();
      else showToast(!next && options.undo ? BOOKMARK_TOAST.offFailed : BOOKMARK_TOAST.failed);
      return false;
    } finally {
      inflight.current.delete(flightKey);
    }
    markStale(client, target);
    if (options.isQuiet) return true;
    if (next) showToast(BOOKMARK_TOAST.on);
    else if (options.undo) {
      const { onRestore } = options.undo;
      showToast(BOOKMARK_TOAST.off, {
        label: "되돌리기",
        run: () => {
          onRestore?.();
          void toggle(target, true, { isQuiet: true });
        },
      });
    } else showToast(BOOKMARK_TOAST.off);
    return true;
  }

  return { toggle };
}
