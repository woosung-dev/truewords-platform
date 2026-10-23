"use client";

// 맞춤 첫 말씀 훅. 답·한 줄은 이 기기 저장소를 구독하고(storage.ts), 카드는 목록 전체(API-HD-054)를 받아 기기에서 고른다.
// 프리뷰 셸은 fixture 만 쓴다(네트워크 0).
import { useQuery } from "@tanstack/react-query";
import type { CardPublic, TodayCardResponse } from "@truewords/api-client-ts/types";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { cardsAPI } from "../cards/api";
import { isHoondokPreviewEnabled } from "../flag";
import { PREVIEW_CARDS, PREVIEW_TODAY_CARD } from "../preview/fixtures/cards";
import { CARDS_LIST_KEY, CARDS_TODAY_KEY } from "../query-keys";
import { useKstDate } from "../use-kst-date";
import { buildReason, FALLBACK_REASON, type PersonalPick, pickPersonalCard } from "./pick";
import {
  ANSWERS_KEY,
  clearAnswers,
  NOTE_KEY,
  type PersonalAnswers,
  type PersonalNote,
  parseAnswers,
  parseNote,
  readRaw,
  subscribePersonal,
  writeAnswers,
  writeNote,
} from "./storage";

function useStoredRaw(key: string): string {
  const read = useCallback(() => readRaw(key), [key]);
  // 서버 스냅샷은 "없음" — SSR 과 첫 렌더가 같다
  return useSyncExternalStore(subscribePersonal, read, () => "");
}

/** 이 기기에 저장된 답. 저장은 `save` 로만 하며 서버로 보내지 않는다. */
export function usePersonalAnswers() {
  const today = useKstDate();
  const raw = useStoredRaw(ANSWERS_KEY);
  const answers = useMemo(() => parseAnswers(raw, today), [raw, today]);
  const save = useCallback(
    (next: Partial<Omit<PersonalAnswers, "isCrisis">> & { isCrisis?: boolean }) => writeAnswers(next, today),
    [today],
  );
  return { answers, save, clear: clearAnswers };
}

/** 마음 한 장 한 줄(기기에만). */
export function usePersonalNote() {
  const raw = useStoredRaw(NOTE_KEY);
  const note = useMemo(() => parseNote(raw), [raw]);
  const save = useCallback((next: PersonalNote) => writeNote(next), []);
  return { note, save };
}

/** active 카드 전부. 사용자별 값이 아니라 오래 둔다. */
export function useCardList() {
  const isPreview = isHoondokPreviewEnabled();
  return useQuery({
    queryKey: CARDS_LIST_KEY,
    queryFn: async (): Promise<CardPublic[]> => (isPreview ? [...PREVIEW_CARDS] : (await cardsAPI.list()).items),
    retry: 1,
    staleTime: 10 * 60_000,
  });
}

/** 오늘 편성 카드(0점 폴백). words-card 와 같은 키라 캐시를 함께 쓴다. */
function useTodayCard(enabled: boolean) {
  const isPreview = isHoondokPreviewEnabled();
  const today = useKstDate();
  return useQuery({
    queryKey: CARDS_TODAY_KEY,
    queryFn: async (): Promise<TodayCardResponse> =>
      isPreview ? { date: today, card: PREVIEW_TODAY_CARD } : cardsAPI.today(),
    enabled,
    retry: false,
  });
}

export type PersonalCardState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      /** 풀이 비었고 오늘 카드도 없으면 null */
      card: CardPublic | null;
      reason: string;
      /** 겹치는 카드가 없어 오늘 편성 카드로 돌아갔는가 */
      isFallback: boolean;
      pick: PersonalPick | null;
    };

/**
 * 고른 답에 맞춘 카드 한 장. 겹치는 카드가 없으면 오늘 편성 카드 + FALLBACK_REASON.
 * 답(`input`)을 넘기면 저장값 대신 그 값으로 고른다(질문 흐름 안에서 아직 저장 전인 답).
 */
export function usePersonalCard(input?: Pick<PersonalAnswers, "interests" | "moods" | "isCrisis">): PersonalCardState {
  const today = useKstDate();
  const { answers } = usePersonalAnswers();
  const source = input ?? answers;
  const list = useCardList();
  const pick = useMemo(
    () => (list.data ? pickPersonalCard(list.data, source, today) : null),
    [list.data, source, today],
  );
  const needsFallback = list.isSuccess && pick === null;
  const todayCard = useTodayCard(needsFallback);

  if (list.isError) return { status: "error", retry: () => void list.refetch() };
  if (list.isPending) return { status: "loading" };
  if (pick) return { status: "ready", card: pick.card, reason: buildReason(pick), isFallback: false, pick };
  if (todayCard.isError) return { status: "error", retry: () => void todayCard.refetch() };
  if (todayCard.isPending) return { status: "loading" };
  return { status: "ready", card: todayCard.data.card, reason: FALLBACK_REASON, isFallback: true, pick: null };
}
