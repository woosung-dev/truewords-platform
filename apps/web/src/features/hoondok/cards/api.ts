import { ApiError, createApiClient } from "@truewords/api-client-ts";
import type {
  CardPublic,
  CardReceiptItem,
  CardShelf,
  MyCardsResponse,
  TodayCardResponse,
} from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

// 오늘의 책갈피 (PLAN-HD-012, API-HD-047~051). 화면 모델은 생성 SDK 타입 그대로다.
export type { CardPublic, CardReceiptItem, CardShelf, MyCardsResponse, TodayCardResponse };
export type MyCardsFilter = "received" | "shared";

// 브라우저: 같은 origin 프록시 + 쿠키 (receive·shared 는 CSRF 헤더를 SDK 가 붙인다)
const browser = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

export const cardsAPI = {
  today: () => browser.request<TodayCardResponse>("/hoondok/cards/today"),
  get: (id: string) => browser.request<CardPublic>(`/hoondok/cards/${encodeURIComponent(id)}`),
  mine: (filter: MyCardsFilter) =>
    browser.request<MyCardsResponse>(`/hoondok/me/cards${filter === "shared" ? "?filter=shared" : ""}`),
  receive: (id: string) =>
    browser.request<CardReceiptItem>(`/hoondok/me/cards/${encodeURIComponent(id)}/receive`, { method: "POST" }),
  shared: (id: string) =>
    browser.request<CardReceiptItem>(`/hoondok/me/cards/${encodeURIComponent(id)}/shared`, { method: "POST" }),
};

// 서버 컴포넌트·이미지 라우트: 공개 엔드포인트라 API origin 에 직접 간다(features/hoondok/api.ts 와 같은 방식).
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** 오늘 카드. 풀이 비었거나 API 를 못 읽으면 null — 홈은 카드를 숨기고 읽기 화면은 빈 상태를 보인다. */
export async function loadTodayCard(fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<CardPublic | null> {
  const { request } = createApiClient({ baseUrl: API_ORIGIN, fetch: fetchImpl });
  try {
    return (await request<TodayCardResponse>("/hoondok/cards/today", { cache: "no-store" })).card;
  } catch {
    return null;
  }
}

/** 카드 1장. 없음·비공개(404)·잘못된 id(422)는 null(→ notFound), 그 밖의 실패는 던진다(→ 오류 화면). */
export async function loadCard(id: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
  const { request } = createApiClient({ baseUrl: API_ORIGIN, fetch: fetchImpl });
  try {
    return await request<CardPublic>(`/hoondok/cards/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) return null;
    throw error;
  }
}
