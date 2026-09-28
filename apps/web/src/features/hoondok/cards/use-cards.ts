"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useKstDate } from "../use-kst-date";
import { cardsAPI, type MyCardsFilter } from "./api";
import {
  clearLocalReceipt,
  isReceivedToday,
  type LocalReceipt,
  readLocalReceipt,
  subscribeLocalReceipt,
  writeLocalReceipt,
} from "./storage";

// 나의 책갈피(API-HD-051). 받기·건넴이 이 접두를 무효화한다.
export const MY_CARDS_KEY = ["hoondok", "cards", "mine"] as const;
export const myCardsKey = (userId: string | null, filter: MyCardsFilter) => [...MY_CARDS_KEY, userId, filter] as const;

export function useMyCards(filter: MyCardsFilter, userId: string | null) {
  return useQuery({
    queryKey: myCardsKey(userId, filter),
    queryFn: () => cardsAPI.mine(filter),
    enabled: Boolean(userId),
    retry: 1,
  });
}

/** localStorage 기록 구독. 스냅샷은 문자열로 받아(값 비교) 객체로 바꾼다. 서버 스냅샷은 "없음" 이라 SSR 과 첫 렌더가 같다. */
function useLocalReceipt(today: string, userId?: string): LocalReceipt | null {
  const read = useCallback(() => {
    const receipt = readLocalReceipt(today, userId);
    return receipt ? `${receipt.date}|${receipt.cardId}` : "";
  }, [today, userId]);
  const raw = useSyncExternalStore(subscribeLocalReceipt, read, () => "");
  return useMemo(() => {
    if (!raw) return null;
    const [date, cardId] = raw.split("|", 2);
    return { date, cardId };
  }, [raw]);
}

/**
 * 오늘 카드 받음 상태 + 받기.
 * - 판정: storage.isReceivedToday (로그인은 서버 receipt, 비로그인은 이 기기 기록)
 * - 받기: 비로그인은 기기 기록만, 로그인은 기록 + receive(049, 멱등). 실패해도 화면은 읽기로 넘어간다
 * - 소급: 비로그인으로 오늘 받은 뒤 로그인하면 그 카드를 한 번 receive 하고 기기 기록을 계정 키로 옮긴다
 */
export function useCardReceipt(cardId: string | null) {
  const today = useKstDate();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const userId = user?.id ?? null;
  const { anonReceipt, mutateReceive } = useSyncAnonReceipt();
  const userReceipt = useLocalReceipt(today, userId ?? undefined);
  const mine = useMyCards("received", userId);

  const localReceipt = userId ? (userReceipt ?? anonReceipt) : anonReceipt;
  const isReceived = cardId ? isReceivedToday({ today, cardId, localReceipt, serverItems: mine.data?.items }) : false;
  // 로그인 사용자는 서버 목록을 읽기 전까지 판정을 미룬다(모션을 잘못 다시 틀지 않게)
  const isResolved = !isUserLoading && (!userId || !mine.isPending || mine.isError);

  const markReceived = useCallback(
    (id: string) => {
      writeLocalReceipt({ date: today, cardId: id }, userId ?? undefined);
      if (userId) mutateReceive(id);
    },
    [today, userId, mutateReceive],
  );

  return { isReceived, isResolved, markReceived, userId };
}

/**
 * 로그인 뒤 소급: 비로그인으로 오늘 받은 기기 기록이 있으면 그 카드를 한 번 receive 하고 기록을 계정 키로 옮긴다.
 * 책갈피 화면(홈 카드·받기·나의 책갈피) 어디서 로그인 상태를 처음 보든 같은 규칙으로 돈다.
 */
export function useSyncAnonReceipt() {
  const today = useKstDate();
  const queryClient = useQueryClient();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const userId = user?.id ?? null;
  const anonReceipt = useLocalReceipt(today);
  const receive = useMutation({
    mutationKey: ["hoondok", "cards", "receive"],
    mutationFn: (id: string) => cardsAPI.receive(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MY_CARDS_KEY }),
  });

  const synced = useRef<string | null>(null);
  const mutateReceive = receive.mutate;
  useEffect(() => {
    if (isUserLoading || !userId || !anonReceipt) return;
    const scope = `${userId}:${anonReceipt.date}:${anonReceipt.cardId}`;
    if (synced.current === scope) return;
    synced.current = scope;
    // 익명 기록은 이 계정에 귀속한다. 실패해도 다른 계정에 넘기지 않도록 먼저 옮긴다.
    writeLocalReceipt(anonReceipt, userId);
    clearLocalReceipt();
    mutateReceive(anonReceipt.cardId);
  }, [isUserLoading, userId, anonReceipt, mutateReceive]);

  return { anonReceipt, mutateReceive };
}

/** 건넴 표시(050). 로그인 사용자만 부른다 — 비로그인 건네기는 기록 없이 된다. */
export function useMarkShared() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["hoondok", "cards", "shared"],
    mutationFn: (id: string) => cardsAPI.shared(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MY_CARDS_KEY }),
  });
}
