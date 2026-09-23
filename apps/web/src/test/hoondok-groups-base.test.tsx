import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 함께 읽는 모임 W0 기반 (PLAN-HD-010 §9 Vitest W0): API 경로·메서드·CSRF, 오류 매핑, 초대 코드·링크·공유 폴백,
// 훈독 완료 → 모임 캐시 무효화, 가입 폼 초대 코드 미리 채움. 모임 API 는 fetch 만 바꿔 실제 경로로 검증한다.
let returnToParam: string | null = null;
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok/read",
  useSearchParams: () => ({ get: (key: string) => (key === "returnTo" ? returnToParam : null) }),
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/missions-api", () => ({
  missionsAPI: { complete: vi.fn(), summary: vi.fn() },
}));

import OnboardingPage from "@/app/(hoondok)/hoondok/onboarding/page";
import { missionsAPI } from "@/features/hoondok/missions-api";
import { safeHoondokPath } from "@/features/hoondok/observability/report";
import { GROUPS_KEY, groupKey, groupMembersKey, MY_GROUPS_KEY, PROGRESS_KEYS } from "@/features/hoondok/query-keys";
import { screenFor } from "@/features/hoondok/screens";
import { activeTabId } from "@/features/hoondok/tabs";
import { groupErrorOf, groupsAPI, isGroupError } from "@/features/hoondok/together/groups-api";
import { withObjectParticle } from "@/features/hoondok/together/josa";
import {
  extractInviteCode,
  formatInviteCode,
  inviteLink,
  isValidInviteCode,
  normalizeInviteCode,
  shareInvite,
} from "@/features/hoondok/together/invite-code";
import { useGroup, useInvitePreview, useToggleReaction } from "@/features/hoondok/together/use-groups";
import { useCompleteMission } from "@/features/hoondok/use-missions";
import { identityAPI } from "@/features/identity/api";
import { carryInviteCode, inviteCodeFromReturnTo } from "@/features/identity/gate";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = { url: string; method: string; csrf: string | null; body: unknown };
function lastCall(): Call {
  const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
  const headers = new Headers(init?.headers);
  return {
    url: String(input),
    method: (init?.method ?? "GET").toUpperCase(),
    csrf: headers.get("X-Requested-With"),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({}));
  vi.stubGlobal("fetch", fetchMock);
  returnToParam = null;
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("groupsAPI 경로·메서드·CSRF (API-HD-030~041)", () => {
  const G = "g-1";
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ["내 모임", () => groupsAPI.mine(), "GET", "/hoondok/me/groups", undefined],
    [
      "만들기",
      () => groupsAPI.create({ name: "새벽 소모임", display_name: "효진" }),
      "POST",
      "/hoondok/groups",
      { name: "새벽 소모임", display_name: "효진" },
    ],
    ["상세", () => groupsAPI.get(G), "GET", `/hoondok/groups/${G}`, undefined],
    ["이름 변경", () => groupsAPI.rename(G, { name: "새 이름" }), "PATCH", `/hoondok/groups/${G}`, { name: "새 이름" }],
    ["모임 삭제", () => groupsAPI.remove(G), "DELETE", `/hoondok/groups/${G}`, undefined],
    ["초대 재발급", () => groupsAPI.regenerateInvite(G), "POST", `/hoondok/groups/${G}/invite`, undefined],
    ["초대 미리보기", () => groupsAPI.previewInvite("ABCD-2345"), "GET", "/hoondok/invites/ABCD-2345", undefined],
    [
      "참여",
      () => groupsAPI.join("ABCD2345", { display_name: "민수" }),
      "POST",
      "/hoondok/invites/ABCD2345/join",
      { display_name: "민수" },
    ],
    [
      "내 이름",
      () => groupsAPI.updateMyName(G, { display_name: "민" }),
      "PATCH",
      `/hoondok/groups/${G}/me`,
      { display_name: "민" },
    ],
    ["나가기", () => groupsAPI.leave(G), "DELETE", `/hoondok/groups/${G}/me`, undefined],
    ["식구 목록", () => groupsAPI.members(G), "GET", `/hoondok/groups/${G}/members`, undefined],
    ["내보내기", () => groupsAPI.removeMember(G, "m-2"), "DELETE", `/hoondok/groups/${G}/members/m-2`, undefined],
    [
      "모임 정성",
      () => groupsAPI.addJeongseong(G, { title: "21일", duration_days: 21, started_on: "2026-09-23" }),
      "POST",
      `/hoondok/groups/${G}/jeongseongs`,
      { title: "21일", duration_days: 21, started_on: "2026-09-23" },
    ],
    [
      "정성 삭제",
      () => groupsAPI.deleteJeongseong(G, "j-1"),
      "DELETE",
      `/hoondok/groups/${G}/jeongseongs/j-1`,
      undefined,
    ],
    [
      "한 줄",
      () => groupsAPI.putTodayShare(G, { body: "감사" }),
      "PUT",
      `/hoondok/groups/${G}/shares/today`,
      { body: "감사" },
    ],
    ["한 줄 삭제", () => groupsAPI.deleteShare(G, "s-1"), "DELETE", `/hoondok/groups/${G}/shares/s-1`, undefined],
    [
      "반응 켜기",
      () => groupsAPI.setReaction(G, "s-1", true),
      "PUT",
      `/hoondok/groups/${G}/shares/s-1/reaction`,
      undefined,
    ],
    [
      "반응 끄기",
      () => groupsAPI.setReaction(G, "s-1", false),
      "DELETE",
      `/hoondok/groups/${G}/shares/s-1/reaction`,
      undefined,
    ],
  ];

  it.each(cases)("%s", async (_name, call, method, path, body) => {
    fetchMock.mockResolvedValueOnce(
      method === "DELETE" && !path.endsWith("/reaction") ? new Response(null, { status: 204 }) : json({}),
    );
    await call();
    const sent = lastCall();
    expect(sent.url).toBe(`/api/backend${path}`);
    expect(sent.method).toBe(method);
    // 변경 요청만 CSRF 헤더를 붙인다 (verify_csrf = X-Requested-With)
    expect(sent.csrf).toBe(method === "GET" ? null : "XMLHttpRequest");
    expect(sent.body).toEqual(body);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.credentials).toBe("include");
  });

  it("경로 세그먼트는 인코딩한다", async () => {
    await groupsAPI.get("a/b");
    expect(lastCall().url).toBe("/api/backend/hoondok/groups/a%2Fb");
  });
});

describe("모임 오류 매핑", () => {
  it("{detail: 코드} 를 상태 + 코드로 푼다", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "GROUP_NOT_FOUND" }, 404));
    const error = await groupsAPI.get("x").catch((e: unknown) => e);
    expect(groupErrorOf(error)).toEqual({ status: 404, code: "GROUP_NOT_FOUND" });

    fetchMock.mockResolvedValueOnce(json({ detail: "DISPLAY_NAME_TAKEN" }, 409));
    const conflict = await groupsAPI.join("ABCD2345", { display_name: "민수" }).catch((e: unknown) => e);
    expect(isGroupError(conflict, "DISPLAY_NAME_TAKEN")).toBe(true);
    expect(isGroupError(conflict, "GROUP_FULL")).toBe(false);
  });

  it("ErrorResponse 의 error_code · Pydantic 422 · 네트워크 실패", async () => {
    fetchMock.mockResolvedValueOnce(json({ error_code: "RATE_LIMIT_EXCEEDED", message: "too many" }, 429));
    expect(groupErrorOf(await groupsAPI.previewInvite("ABCD2345").catch((e: unknown) => e))).toEqual({
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
    });
    fetchMock.mockResolvedValueOnce(json({ detail: [{ loc: ["body", "name"], msg: "too long" }] }, 422));
    expect(groupErrorOf(await groupsAPI.create({ name: "x", display_name: "y" }).catch((e: unknown) => e))).toEqual({
      status: 422,
      code: null,
    });
    expect(groupErrorOf(new TypeError("fetch failed"))).toEqual({ status: 0, code: null });
  });
});

describe("초대 코드 (Crockford base32 8자)", () => {
  it("대소문자·공백·하이픈을 무시하고 I·L→1, O→0 으로 정규화한다", () => {
    expect(normalizeInviteCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeInviteCode("oil0 lIoO")).toBe("01101100");
    expect(formatInviteCode("abcd2345")).toBe("ABCD-2345");
    expect(formatInviteCode("abc")).toBe("ABC"); // 입력 중에는 그대로
  });

  it("형식 검증 — 8자·허용 문자만", () => {
    expect(isValidInviteCode("ABCD-2345")).toBe(true);
    expect(isValidInviteCode("abcd 2345")).toBe(true);
    expect(isValidInviteCode("ABCD-234")).toBe(false);
    expect(isValidInviteCode("ABCU-2345")).toBe(false); // U 는 Crockford 에 없다
    expect(isValidInviteCode("ABCD-2345-6")).toBe(false);
  });

  it("참여 링크는 현재 origin 의 /hoondok/groups/join?code=XXXX-XXXX", () => {
    expect(inviteLink("abcd2345")).toBe(`${window.location.origin}/hoondok/groups/join?code=ABCD-2345`);
  });
});

describe("shareInvite 폴백", () => {
  const link = "https://example.test/hoondok/groups/join?code=ABCD-2345";

  it("navigator.share 가 있으면 모임 이름·링크만 공유한다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("share");
    expect(share).toHaveBeenCalledWith({ title: "새벽 소모임", text: "새벽 소모임", url: link });
  });

  it("공유 시트를 닫으면 cancelled — 클립보드로 넘어가지 않는다", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")),
      clipboard: { writeText },
    });
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share 미지원·실패면 클립보드, 둘 다 안 되면 none", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith(`새벽 소모임\n${link}`);

    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      clipboard: { writeText },
    });
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("clipboard");

    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("none");
    vi.stubGlobal("navigator", {});
    expect(await shareInvite({ groupName: "새벽 소모임", link })).toBe("none");
  });
});

describe("쿼리 키 · 무효화", () => {
  it("모임 키는 모두 ['hoondok','groups'] 접두이고 PROGRESS_KEYS 에 들어 있다", () => {
    expect(GROUPS_KEY).toEqual(["hoondok", "groups"]);
    for (const key of [MY_GROUPS_KEY, groupKey("g"), groupMembersKey("g")]) expect(key.slice(0, 2)).toEqual(GROUPS_KEY);
    expect(PROGRESS_KEYS).toContainEqual(GROUPS_KEY);
  });

  it("훈독 완료(recorded) 가 내 모임·상세·식구 캐시를 무효화한다", async () => {
    vi.mocked(missionsAPI.complete).mockResolvedValueOnce(undefined as never);
    const client = makeClient();
    client.setQueryData(MY_GROUPS_KEY, []);
    client.setQueryData(groupKey("g"), { id: "g" });
    client.setQueryData(groupMembersKey("g"), { member_count: 1, items: [] });
    const { result } = renderHook(() => useCompleteMission("read"), { wrapper: wrapWith(client) });
    act(() => result.current.mutate("user"));
    await waitFor(() => expect(result.current.data).toBe("recorded"));
    for (const key of [MY_GROUPS_KEY, groupKey("g"), groupMembersKey("g")])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("반응 토글은 서버 has_reacted 만 상세 캐시에 반영한다", async () => {
    fetchMock.mockResolvedValueOnce(json({ has_reacted: true }));
    const client = makeClient();
    const share = { id: "s-1", has_my_reaction: false, reaction_count: null };
    client.setQueryData(groupKey("g"), { id: "g", shares: [share, { ...share, id: "s-2" }] });
    const { result } = renderHook(() => useToggleReaction("g"), { wrapper: wrapWith(client) });
    act(() => result.current.mutate({ shareId: "s-1", isOn: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const detail = client.getQueryData<{ shares: (typeof share)[] }>(groupKey("g"));
    expect(detail?.shares.map((s) => s.has_my_reaction)).toEqual([true, false]);
    expect(detail?.shares[0].reaction_count).toBeNull();
  });

  it("형식이 틀린 초대 코드는 미리보기를 부르지 않는다(초대 limiter 보호)", async () => {
    const client = makeClient();
    renderHook(() => useInvitePreview("ABC"), { wrapper: wrapWith(client) });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      json({ name: "모임", kind: "small_group", leader_display_name: "효진", jeongseongs: [], is_member: false }),
    );
    const { result } = renderHook(() => useInvitePreview("abcd-2345"), { wrapper: wrapWith(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall().url).toBe("/api/backend/hoondok/invites/ABCD2345");
  });
});

describe("화면 레지스트리 · 오류 경로", () => {
  it("모임 5화면은 '오늘 훈독' 탭이고 하위 화면의 뒤로는 그 모임 상세다", () => {
    expect(screenFor("/hoondok/groups/new").title).toBe("모임 만들기");
    expect(screenFor("/hoondok/groups/join").title).toBe("모임 참여");
    expect(screenFor("/hoondok/groups/abc").title).toBe("훈독 모임");
    expect(screenFor("/hoondok/groups/abc/share")).toMatchObject({
      title: "한 줄 나눔",
      backHref: "/hoondok/groups/abc",
    });
    expect(screenFor("/hoondok/groups/abc/settings")).toMatchObject({
      title: "모임 설정",
      backHref: "/hoondok/groups/abc",
    });
    for (const path of [
      "/hoondok/groups/new",
      "/hoondok/groups/join",
      "/hoondok/groups/abc",
      "/hoondok/groups/abc/share",
    ])
      expect(activeTabId(path)).toBe("today");
  });

  it("모임 id 는 :id 로 가리고 new·join 은 그대로 보낸다", () => {
    const id = "3f2b6c1e-8d4a-4b2e-9c1f-0a1b2c3d4e5f";
    expect(safeHoondokPath(`/hoondok/groups/${id}`)).toBe("/hoondok/groups/:id");
    expect(safeHoondokPath(`/hoondok/groups/${id}/share`)).toBe("/hoondok/groups/:id/share");
    expect(safeHoondokPath(`/hoondok/groups/${id}/settings?x=1`)).toBe("/hoondok/groups/:id/settings");
    expect(safeHoondokPath("/hoondok/groups/new")).toBe("/hoondok/groups/new");
    expect(safeHoondokPath("/hoondok/groups/join?code=ABCD-2345")).toBe("/hoondok/groups/join");
    expect(safeHoondokPath(`/hoondok/groups/${id}/other`)).toBe("/hoondok");
  });
});

describe("가입 폼 초대 코드 미리 채움 (D4)", () => {
  it("returnTo 가 참여 링크일 때만 코드를 꺼낸다", () => {
    expect(inviteCodeFromReturnTo("/hoondok/groups/join?code=abcd2345")).toBe("ABCD-2345");
    expect(inviteCodeFromReturnTo("/hoondok/groups/join?code=ABCD-2345&x=1")).toBe("ABCD-2345");
    expect(inviteCodeFromReturnTo("/hoondok/groups/join")).toBe("");
    expect(inviteCodeFromReturnTo("/hoondok/read?code=ABCD2345")).toBe("");
  });

  it("참여 링크에서 온 온보딩은 초대 코드 칸이 채워져 있고 그대로 가입에 보낸다", async () => {
    returnToParam = "/hoondok/groups/join?code=abcd-2345";
    vi.mocked(identityAPI.signup).mockResolvedValueOnce({ user: { id: "u1", email: "a@b.c", display_name: "효진" } });
    render(<QueryClientProvider client={makeClient()}>{<OnboardingPage />}</QueryClientProvider>);
    await screen.findByRole("form", { name: "가입" });
    expect(screen.getByLabelText(/초대 코드/)).toHaveValue("ABCD-2345");
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "효진" } });
    fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "password1" } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() =>
      expect(identityAPI.signup).toHaveBeenCalledWith(expect.objectContaining({ invite_code: "ABCD-2345" })),
    );
  });

  it("다른 returnTo 면 비어 있다", async () => {
    returnToParam = "/hoondok/read";
    render(<QueryClientProvider client={makeClient()}>{<OnboardingPage />}</QueryClientProvider>);
    await screen.findByRole("form", { name: "가입" });
    expect(screen.getByLabelText(/초대 코드/)).toHaveValue("");
  });
});

describe("붙여 넣은 글에서 초대 코드 찾기 (QA P2-10)", () => {
  it.each([
    ["WMDM-5QH5", "WMDM-5QH5"],
    [" wmdm 5qh5 ", "WMDM-5QH5"],
    ["초대 코드: WMDM-5QH5", "WMDM-5QH5"],
    ["[목요 말씀 모임] 초대 코드: wmdm–5qh5 (7일 동안 쓸 수 있어요)", "WMDM-5QH5"], // en-dash
    ["코드 WMDM—5QH5", "WMDM-5QH5"], // em-dash
    ["목요 말씀 모임\nhttp://127.0.0.1:3160/hoondok/groups/join?code=WMDM-5QH5", "WMDM-5QH5"],
    ["https://truewords.woosung.dev/hoondok/groups/join?code=wmdm-5qh5&x=1", "WMDM-5QH5"],
    ["https://truewords.woosung.dev/hoondok/groups/join?code=WMDM%2D5QH5", "WMDM-5QH5"],
  ])("%j → %s", (text, code) => {
    expect(extractInviteCode(text)).toBe(code);
  });

  it.each(["QA-BETA-2026", "새벽-2026", "abcd", "WMDM-5QH5X", "", "초대합니다"])("%j 는 코드가 아니다", (text) => {
    expect(extractInviteCode(text)).toBeNull();
  });

  it("en-dash 도 정규화에서 지운다", () => {
    expect(normalizeInviteCode("WMDM–5QH5")).toBe("WMDM5QH5");
  });
});

describe("목적격 조사 을/를 (QA P2-5)", () => {
  it.each([
    ["목요 말씀 모임", "목요 말씀 모임을"],
    ["새벽 소모임", "새벽 소모임을"],
    ["청년회", "청년회를"],
    ["Morning", "Morning을(를)"],
    ["모임 3", "모임 3을(를)"],
  ])("%s → %s", (name, expected) => {
    expect(withObjectParticle(name)).toBe(expected);
  });
});

describe("가입 칸 초대 코드 (QA P2-1 · P2-10 · P2-11)", () => {
  async function fillSignup() {
    await screen.findByRole("form", { name: "가입" });
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "효진" } });
    fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "password1" } });
  }

  it("carryInviteCode — 코드 없는 참여 화면으로 돌아갈 때만 모임 코드를 붙인다", () => {
    expect(carryInviteCode("/hoondok/groups/join", "wmdm 5qh5")).toBe("/hoondok/groups/join?code=WMDM-5QH5");
    expect(carryInviteCode("/hoondok/groups/join?code=ABCD-2345", "WMDM-5QH5")).toBe(
      "/hoondok/groups/join?code=ABCD-2345",
    );
    expect(carryInviteCode("/hoondok/groups/join", "QA-BETA-2026")).toBe("/hoondok/groups/join");
    expect(carryInviteCode("/hoondok", "WMDM-5QH5")).toBe("/hoondok");
    expect(carryInviteCode("/hoondok/read", "")).toBe("/hoondok/read");
  });

  it("홈 '초대 코드로 참여' 에서 온 가입은 넣은 모임 코드를 참여 화면으로 넘긴다", async () => {
    returnToParam = "/hoondok/groups/join";
    vi.mocked(identityAPI.signup).mockResolvedValueOnce({ user: { id: "u1", email: "a@b.c", display_name: "효진" } });
    render(<QueryClientProvider client={makeClient()}>{<OnboardingPage />}</QueryClientProvider>);
    await fillSignup();
    fireEvent.change(screen.getByLabelText(/초대 코드/), { target: { value: "xtfw yht0" } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/hoondok/groups/join?code=XTFW-YHT0"));
  });

  it("카톡 메시지·링크를 붙여 넣으면 코드만 남고, 코드가 안 보이는 글(베타 코드)은 그대로 붙는다", async () => {
    render(<QueryClientProvider client={makeClient()}>{<OnboardingPage />}</QueryClientProvider>);
    await screen.findByRole("form", { name: "가입" });
    const input = screen.getByLabelText(/초대 코드/);
    fireEvent.paste(input, { clipboardData: { getData: () => "초대 코드: WMDM-5QH5" } });
    expect(input).toHaveValue("WMDM-5QH5");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.paste(input, {
      clipboardData: { getData: () => "https://truewords.woosung.dev/hoondok/groups/join?code=wmdm-5qh5" },
    });
    expect(input).toHaveValue("WMDM-5QH5");
    fireEvent.change(input, { target: { value: "" } });
    // 코드가 없으면 기본 붙여넣기에 맡긴다(preventDefault 하지 않음)
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => "QA-BETA-2026" } });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("코드를 넣었는데 거절되면 '맞지 않거나 만료됐어요', 비어 있으면 '필요해요'", async () => {
    vi.mocked(identityAPI.signup).mockRejectedValue(new ApiError(403, { error_code: "INVITE_REQUIRED", message: "x" }));
    render(<QueryClientProvider client={makeClient()}>{<OnboardingPage />}</QueryClientProvider>);
    await fillSignup();
    fireEvent.change(screen.getByLabelText(/초대 코드/), { target: { value: "ZZZZ-ZZZZ" } });
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "초대 코드가 맞지 않거나 만료됐어요. 다시 확인해 주세요",
    );
    fireEvent.change(screen.getByLabelText(/초대 코드/), { target: { value: "  " } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("초대 코드가 필요해요. 초대받은 코드를 확인해 주세요"),
    );
  });
});

describe("열어 둔 모임 화면의 KST 자정 갱신 (QA P2-6)", () => {
  it("자정이 지나면 상세를 다시 읽고, 언마운트 뒤에는 타이머가 남지 않는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T14:59:59.000Z")); // KST 23:59:59
    fetchMock.mockImplementation(async () => json({ id: "g", shares: [] }));
    const client = makeClient();
    const { unmount } = renderHook(() => useGroup("g"), { wrapper: wrapWith(client) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // KST 00:00 을 넘긴다
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastCall().url).toBe("/api/backend/hoondok/groups/g");
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86_400_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
