import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromCandidate, toPayload, validate } from "@/features/hoondok/form";
import type { DailyReadingCandidate } from "@/features/hoondok/types";

// 편성 후보 찾기 (API-HD-012, PLAN-HD-003). 추출형 계약 — 본문이 원문 그대로 폼에 들어가는지가 핵심.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let hoondokAPI: typeof import("@/features/hoondok/api").hoondokAPI;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ hoondokAPI } = await import("@/features/hoondok/api"));
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

const CANDIDATE: DailyReadingCandidate = {
  chunk_id: "pt-42",
  text: "참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다.",
  char_count: 37,
  source: "B",
  source_label: "어머님 말씀",
  work_title: "천성경",
  suggested_title: "참사랑은 직단거리를 갑니다",
  suggested_speaker: "참어머님",
  score: 0.42,
};

describe("hoondokAPI.candidates", () => {
  it("q 만 있으면 그것만 쿼리로 보낸다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ query: "참사랑", candidates: [] }));
    await hoondokAPI.candidates({ q: "참사랑" });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/admin/hoondok/daily-readings/candidates?q=");
    expect(url).not.toContain("sources=");
    expect(url).not.toContain("limit=");
  });

  it("sources 는 같은 키를 반복해서 보낸다 (FastAPI list 쿼리)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ query: "가정", candidates: [] }));
    await hoondokAPI.candidates({ q: "가정", sources: ["B", "O"] });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("sources=B");
    expect(url).toContain("sources=O");
  });

  it("빈 sources 배열은 쿼리에 나타나지 않는다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ query: "효정", candidates: [] }));
    await hoondokAPI.candidates({ q: "효정", sources: [] });
    expect(mockFetch.mock.calls[0][0]).not.toContain("sources=");
  });

  it("조회이므로 CSRF 헤더 없이 GET 이다", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ query: "참사랑", candidates: [] }));
    await hoondokAPI.candidates({ q: "참사랑" });
    const [, options] = mockFetch.mock.calls[0];
    expect(options?.method ?? "GET").toBe("GET");
    expect(options.credentials).toBe("include");
  });
});

describe("fromCandidate", () => {
  it("본문을 원문 그대로 넣는다 (추출형 계약)", () => {
    expect(fromCandidate(CANDIDATE, "2026-09-21").body).toBe(CANDIDATE.text);
  });

  it("제목·화자·저작은 서버 제안값을 쓴다", () => {
    const v = fromCandidate(CANDIDATE, "2026-09-21");
    expect(v.title).toBe("참사랑은 직단거리를 갑니다");
    expect(v.speaker).toBe("참어머님");
    expect(v.work_title).toBe("천성경");
  });

  it("등급 R · 검수 unverified 로 보수적으로 들어간다", () => {
    const v = fromCandidate(CANDIDATE, "2026-09-21");
    expect(v.authority_grade).toBe("R");
    expect(v.review_status).toBe("unverified");
  });

  it("chunk_id 를 남겨 원문을 역추적할 수 있게 한다", () => {
    expect(fromCandidate(CANDIDATE, "2026-09-21").chunk_id).toBe("pt-42");
  });

  it("출처 메모에 어디서 왔는지 적는다", () => {
    expect(fromCandidate(CANDIDATE, "2026-09-21").source_note).toContain("어머님 말씀");
  });

  it("편성일은 넘겨받은 값을 유지한다", () => {
    expect(fromCandidate(CANDIDATE, "2026-09-21").reading_date).toBe("2026-09-21");
  });

  it("채운 값이 그대로 검증을 통과하고 페이로드가 된다", () => {
    const v = fromCandidate(CANDIDATE, "2026-09-21");
    expect(validate(v)).toEqual({});
    const payload = toPayload(v);
    expect(payload.body).toBe(CANDIDATE.text);
    expect(payload.chunk_id).toBe("pt-42");
  });

  it("편성일이 비어 있으면 검증에서 걸린다 (후보를 골라도 날짜는 필수)", () => {
    expect(validate(fromCandidate(CANDIDATE, "")).reading_date).toBeTruthy();
  });
});
