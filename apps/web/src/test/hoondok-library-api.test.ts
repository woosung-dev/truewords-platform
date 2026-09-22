// 서고 API 어댑터의 경로·본문만 본다. volume 은 공백·점이 섞인 Qdrant 원문 키라(`"말씀선집   001권.pdf"`)
// 경로에 그대로 넣으면 URL 이 깨진다 — 모든 경로에서 한 번 인코딩하는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryAPI, pageOfChunkIndex, seriesHref, wordsSectionHref } from "@/features/hoondok/library/api";

const VOLUME = "말씀선집   001권.pdf";
const ENCODED = encodeURIComponent(VOLUME);
const fetchMock = vi.fn();

function jsonResponse(body: unknown = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(jsonResponse()));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastCall(): [string, RequestInit] {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return [String(url), init];
}

describe("서고 API 경로", () => {
  it("원문·목차·이어 읽기·표시 경로에서 volume 을 한 번만 인코딩한다", async () => {
    await libraryAPI.words(VOLUME, 2, { section: 3 });
    expect(lastCall()[0]).toBe(`/api/backend/hoondok/words/${ENCODED}?page=2&section=3`);
    await libraryAPI.sections(VOLUME);
    expect(lastCall()[0]).toBe(`/api/backend/hoondok/sections/${ENCODED}`);
    await libraryAPI.saveReadingPosition(VOLUME, 20);
    const [positionUrl, positionInit] = lastCall();
    expect(positionUrl).toBe(`/api/backend/hoondok/me/reading-position/${ENCODED}`);
    expect(positionInit.method).toBe("PUT");
    expect(positionInit.body).toBe(JSON.stringify({ chunk_index: 20 }));
    await libraryAPI.marks({ volume: VOLUME, kind: "bookmark" });
    // 쿼리 문자열은 URLSearchParams 규칙(공백 = `+`)이다 — 경로 인코딩과 달라 별도로 짚어 둔다
    expect(lastCall()[0]).toBe(
      `/api/backend/hoondok/me/marks?${new URLSearchParams({ volume: VOLUME, kind: "bookmark" })}`,
    );
  });
  it("표시 저장·삭제는 chunk_id 를 경로에, volume 을 본문에 둔다", async () => {
    await libraryAPI.saveMark("c 1", { volume: VOLUME, chunk_index: 0, kind: "highlight", color: 1, note: null });
    const [saveUrl, saveInit] = lastCall();
    expect(saveUrl).toBe("/api/backend/hoondok/me/marks/c%201");
    expect(JSON.parse(String(saveInit.body)).volume).toBe(VOLUME);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await libraryAPI.deleteMark("c 1", "bookmark");
    const [deleteUrl, deleteInit] = lastCall();
    expect(deleteUrl).toBe("/api/backend/hoondok/me/marks/c%201?kind=bookmark");
    expect(deleteInit.method).toBe("DELETE");
  });
  it("쓰기 요청에는 CSRF 헤더가 붙는다", async () => {
    await libraryAPI.saveReadingPosition(VOLUME, 0);
    expect(new Headers(lastCall()[1].headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });
  it("저작물 링크·장 링크·청크 → 페이지 환산", () => {
    expect(seriesHref("father_anthology")).toBe("/hoondok/library/father_anthology");
    expect(wordsSectionHref(VOLUME, 3)).toBe(`/hoondok/words/${ENCODED}?section=3`);
    expect([0, 19, 20, 41].map(pageOfChunkIndex)).toEqual([1, 1, 2, 3]);
  });
});
