"use client";

// 읽기 기록(API-HD-025·026) React Query 어댑터. 기록은 로그인 전용이라 모든 훅이 `enabled` 로 게이트된다.
// 비로그인은 조회조차 보내지 않는다 — 401 을 오류로 쌓지 않기 위해서다.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarkInput, MarkItem } from "@truewords/api-client-ts/types";
import { useCallback, useEffect, useRef } from "react";
import { BOOKMARKS_KEY, MARKS_KEY, marksKey, READING_POSITIONS_KEY } from "../query-keys";
import { libraryAPI } from "./api";

export function useMarks(volume: string, isEnabled: boolean) {
  const query = useQuery({
    queryKey: marksKey(volume),
    queryFn: () => libraryAPI.marks({ volume }),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  return query.data?.items ?? [];
}

export function useBookmarks(isEnabled: boolean, limit: number) {
  const query = useQuery({
    queryKey: BOOKMARKS_KEY,
    queryFn: () => libraryAPI.marks({ kind: "bookmark" }),
    enabled: isEnabled,
    retry: false,
    staleTime: 0,
  });
  return (query.data?.items ?? []).slice(0, limit);
}

/** 표시 저장·삭제. 어느 쪽이 끝나든 MARKS_KEY 접두 전체를 무효화해 원문·서고가 같은 값을 본다. */
export function useMarkWriter() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: MARKS_KEY });
  const save = useMutation({
    mutationFn: ({ chunkId, input }: { chunkId: string; input: MarkInput }) => libraryAPI.saveMark(chunkId, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ chunkId, kind }: { chunkId: string; kind: MarkItem["kind"] }) =>
      libraryAPI.deleteMark(chunkId, kind),
    onSuccess: invalidate,
  });
  return { save, remove, isSaving: save.isPending || remove.isPending, hasFailed: save.isError || remove.isError };
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
