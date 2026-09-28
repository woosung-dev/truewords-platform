import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchAPI 는 fetch 를 감싸므로 fetch 를 mock 해 URL·메서드·CSRF 헤더를 본다 (hoondok-groups-api.test.ts 와 같은 방식)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let cards: typeof import("@/features/hoondok/cards-api");
let ApiError: typeof import("@/lib/api").ApiError;

beforeEach(async () => {
  vi.clearAllMocks();
  cards = await import("@/features/hoondok/cards-api");
  ({ ApiError } = await import("@/lib/api"));
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe("cardsAPI (API-HD-052·047)", () => {
  it("list 는 GET + page·page_size, status 는 있을 때만", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }));
    await cards.cardsAPI.list(null, 1);
    const all = new URL(mockFetch.mock.calls[0][0], "http://x");
    expect(all.pathname).toMatch(/\/admin\/hoondok\/cards$/);
    expect(all.searchParams.get("page")).toBe("1");
    expect(all.searchParams.get("page_size")).toBe("50");
    expect(all.searchParams.has("status")).toBe(false);
    expect(new Headers(mockFetch.mock.calls[0][1].headers).get("X-Requested-With")).toBeNull();

    await cards.cardsAPI.list("draft", 3);
    const drafts = new URL(mockFetch.mock.calls[1][0], "http://x");
    expect(drafts.searchParams.get("status")).toBe("draft");
    expect(drafts.searchParams.get("page")).toBe("3");
  });

  it("update 는 PATCH /{id} + CSRF, 고정 해제는 pinned_on:null 을 그대로 보낸다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "c1" }));
    await cards.cardsAPI.update("c1", { pinned_on: null });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/admin\/hoondok\/cards\/c1$/);
    expect(options.method).toBe("PATCH");
    expect(new Headers(options.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(JSON.parse(options.body)).toEqual({ pinned_on: null });
  });

  it("today 는 공개 오늘 카드 엔드포인트", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ date: "2026-09-28", card: null }));
    await expect(cards.cardsAPI.today()).resolves.toEqual({ date: "2026-09-28", card: null });
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/hoondok\/cards\/today$/);
  });
});

describe("cardMutationErrorMessage", () => {
  it("409 는 날짜 고정 충돌 문구, 나머지는 공통 문구", () => {
    const { cardMutationErrorMessage } = cards;
    expect(cardMutationErrorMessage(new ApiError(409, { message: "서버 문구" }), "f")).toBe(
      "그 날짜에 이미 고정된 카드가 있어요",
    );
    expect(cardMutationErrorMessage(new ApiError(404, { message: "x" }), "f")).toContain("이미 삭제된");
    expect(cardMutationErrorMessage(new ApiError(422, { message: "x" }), "f")).toBe("입력값을 확인해 주세요");
    expect(cardMutationErrorMessage(new Error("boom"), "f")).toBe("f");
  });
});

describe("cardSourceUrl", () => {
  it("web 서고 원문 단락 링크 — volume·chunk_id 를 인코딩한다", () => {
    expect(cards.cardSourceUrl({ volume: "천성경 1.pdf", chunk_id: "a/b" })).toMatch(
      /\/hoondok\/words\/%EC%B2%9C%EC%84%B1%EA%B2%BD%201\.pdf\?chunk_id=a%2Fb$/,
    );
  });
});
