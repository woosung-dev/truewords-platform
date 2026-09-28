import type {
  CardAdminItem,
  CardAdminListResponse,
  CardAdminUpdate,
  TodayCardResponse,
} from "@truewords/api-client-ts/types";
import { ApiError, fetchAPI } from "@/lib/api";
import { WEB_ORIGIN } from "@/lib/origins";
import { mutationErrorMessage } from "./groups-api";

export type { CardAdminItem, CardAdminListResponse, TodayCardResponse };
export type CardStatus = CardAdminItem["status"];

export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  draft: "초안",
  active: "활성",
  retired: "중지",
};

export const CARD_PAGE_SIZE = 50;

const BASE = "/admin/hoondok/cards";

// 오늘의 책갈피 admin API (API-HD-052) + 공개 오늘 카드(API-HD-047). CSRF 헤더는 fetchAPI 가 붙인다.
export const cardsAPI = {
  /** status 가 없으면 전체. 최신 등록순으로 온다. */
  list: (status: CardStatus | null, page: number, pageSize = CARD_PAGE_SIZE) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (status) params.set("status", status);
    return fetchAPI<CardAdminListResponse>(`${BASE}?${params}`);
  },
  /** 본문은 불변 — status·pinned_on 만 보낸다. `pinned_on: null` 은 고정 해제. */
  update: (id: string, data: CardAdminUpdate) =>
    fetchAPI<CardAdminItem>(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  /** 서버 회전 규칙(고정 우선 → active 풀 회전)이 고른 오늘 카드. 풀이 비면 card=null. */
  today: () => fetchAPI<TodayCardResponse>("/hoondok/cards/today"),
};

export const PIN_CONFLICT_MESSAGE = "그 날짜에 이미 고정된 카드가 있어요";

/** 카드 변경 실패 문구. 409 는 날짜 고정 충돌뿐이다. */
export function cardMutationErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 409) return PIN_CONFLICT_MESSAGE;
  return mutationErrorMessage(err, fallback);
}

/** 사용자 웹 서고의 원문 단락 링크. web 의 `wordsHref` 와 같은 모양이다. */
export function cardSourceUrl(card: { volume: string; chunk_id: string }): string {
  return `${WEB_ORIGIN}/hoondok/words/${encodeURIComponent(card.volume)}?chunk_id=${encodeURIComponent(card.chunk_id)}`;
}
