"use client";

// 읽기 기록(API-HD-025·053) React Query 어댑터. 기록은 로그인 전용이라 모든 훅이 `enabled` 로 게이트된다.
// 비로그인은 조회조차 보내지 않는다 — 401 을 오류로 쌓지 않기 위해서다.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HighlightInput, HighlightItem, HighlightPatch, HighlightsResponse } from "@truewords/api-client-ts/types";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { HIGHLIGHTS_KEY, highlightsKey, READING_POSITIONS_KEY } from "../query-keys";
import { libraryAPI } from "./api";
import { type LastReading, parseLastReading, readLastReadingRaw, subscribeLastReading } from "./last-reading";

const NO_HIGHLIGHTS: HighlightItem[] = [];

/** 이 권의 구절 형광펜 전부(서버 상한 500건). 본문 표시·노트 탭·단락 시트가 같은 목록을 본다. */
export function useHighlights(volume: string, isEnabled: boolean) {
  const query = useQuery({
    queryKey: highlightsKey(volume),
    queryFn: () => libraryAPI.highlights({ volume }),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  return { items: query.data?.items ?? NO_HIGHLIGHTS, isSuccess: query.isSuccess };
}

const HIGHLIGHT_WRITE_KEY = ["hoondok", "highlight-write"] as const;
const PENDING_PREFIX = "pending-";

/** 서버 응답 전 낙관 표시 중인 형광펜 — 아직 id 가 없어 고치거나 지울 수 없다. */
export function isPendingHighlight(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/**
 * 구절 형광펜 쓰기. 세 동작 모두 캐시를 먼저 고치고(낙관 표시) 실패하면 그 한 건만 되돌린 뒤 `onError` 를 부른다.
 * 다시 읽기는 마지막 쓰기가 끝날 때만 한다 — 먼저 끝난 요청의 재조회가 아직 진행 중인 요청의 낙관 표시를 지우지 않게.
 */
export function useHighlightWriter(volume: string, onError: (error: unknown) => void) {
  const client = useQueryClient();
  const key = highlightsKey(volume);
  const setItems = (update: (items: HighlightItem[]) => HighlightItem[]) =>
    client.setQueryData<HighlightsResponse>(key, (data) => ({ items: update(data?.items ?? []) }));
  const findItem = (id: string) => client.getQueryData<HighlightsResponse>(key)?.items.find((item) => item.id === id);
  const settle = () => {
    if (client.isMutating({ mutationKey: HIGHLIGHT_WRITE_KEY }) === 1)
      return client.invalidateQueries({ queryKey: HIGHLIGHTS_KEY });
  };

  const create = useMutation({
    mutationKey: HIGHLIGHT_WRITE_KEY,
    mutationFn: (input: HighlightInput) => libraryAPI.createHighlight(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const now = new Date().toISOString();
      const pendingId = `${PENDING_PREFIX}${now}-${Math.random().toString(36).slice(2)}`;
      const pending: HighlightItem = {
        ...input,
        id: pendingId,
        note: input.note ?? null,
        created_at: now,
        updated_at: now,
        work_title: "",
        label: "",
      };
      setItems((items) => [pending, ...items]);
      return { pendingId };
    },
    onSuccess: (item, _input, context) =>
      setItems((items) => items.map((current) => (current.id === context?.pendingId ? item : current))),
    onError: (error, _input, context) => {
      setItems((items) => items.filter((current) => current.id !== context?.pendingId));
      onError(error);
    },
    onSettled: settle,
  });

  const update = useMutation({
    mutationKey: HIGHLIGHT_WRITE_KEY,
    mutationFn: ({ id, patch }: { id: string; patch: HighlightPatch }) => libraryAPI.updateHighlight(id, patch),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = findItem(id);
      const now = new Date().toISOString();
      setItems((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                color: patch.color ?? item.color,
                note: patch.note === undefined ? item.note : patch.note || null,
                updated_at: now,
              }
            : item,
        ),
      );
      return { previous };
    },
    onSuccess: (item) => setItems((items) => items.map((current) => (current.id === item.id ? item : current))),
    onError: (error, _variables, context) => {
      const previous = context?.previous;
      if (previous) setItems((items) => items.map((current) => (current.id === previous.id ? previous : current)));
      onError(error);
    },
    onSettled: settle,
  });

  const remove = useMutation({
    mutationKey: HIGHLIGHT_WRITE_KEY,
    mutationFn: (id: string) => libraryAPI.deleteHighlight(id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      const previous = findItem(id);
      setItems((items) => items.filter((item) => item.id !== id));
      return { previous };
    },
    onError: (error, _id, context) => {
      const previous = context?.previous;
      if (previous) setItems((items) => (items.some((item) => item.id === previous.id) ? items : [previous, ...items]));
      onError(error);
    },
    onSettled: settle,
  });

  return { create, update, remove };
}

export function useReadingPositions(isEnabled: boolean) {
  const query = useQuery({
    queryKey: READING_POSITIONS_KEY,
    queryFn: () => libraryAPI.readingPositions(5),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  return { items: query.data?.items ?? [], isPending: isEnabled && query.isPending, isSuccess: query.isSuccess };
}

/** 이 기기의 마지막 원문 구간(`hoondok:read:last`). 서버 렌더와 하이드레이션 첫 그림은 null 이다. */
export function useLastReading(): LastReading | null {
  const raw = useSyncExternalStore(subscribeLastReading, readLastReadingRaw, () => null);
  return useMemo(() => parseLastReading(raw), [raw]);
}

/**
 * 이어 읽기 저장기. 같은 (volume, chunk_index) 를 두 번 보내지 않는다 — 리렌더·탭 전환이 PUT 을 반복하면
 * 서버 기록이 같은 값으로 계속 갱신되고 쓰기 예산만 쓴다.
 */
export function useReadingPositionWriter() {
  const client = useQueryClient();
  const sent = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: ({ target, index }: { target: string; index: number }) => libraryAPI.saveReadingPosition(target, index),
    onSuccess: () => client.invalidateQueries({ queryKey: READING_POSITIONS_KEY }),
  });
  const mutate = save.mutate;
  return useCallback(
    (target: string, index: number) => {
      const key = `${target}#${index}`;
      if (sent.current === key) return;
      sent.current = key;
      mutate({ target, index });
    },
    [mutate],
  );
}

/** 원문 한 페이지를 연 뒤 그 페이지의 첫 단락을 이어 읽기로 남긴다. 비로그인이면 아무것도 보내지 않는다. */
export function useSavedReadingPosition(isEnabled: boolean, volume: string, chunkIndex: number | null) {
  const remember = useReadingPositionWriter();
  useEffect(() => {
    if (!isEnabled || chunkIndex === null) return;
    remember(volume, chunkIndex);
  }, [isEnabled, volume, chunkIndex, remember]);
}
