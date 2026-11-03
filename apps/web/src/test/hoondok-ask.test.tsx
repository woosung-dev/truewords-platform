import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { MyAskDetail, MyAskSummary, MyAskTurn } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AI 질문 (DEC-PWA-025 2차). 로그인 필수·계정 보관·하루 횟수·SSE 어댑터·홈(탭 목록)·새 질문·상세(이어 묻기·공개)·공개 열람.
const mockPush = vi.fn();
const mockReplace = vi.fn();
let queryParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ask",
  useSearchParams: () => ({ get: (key: string) => queryParams[key] ?? null }),
}));

let currentUser: { id: string } | null = null;
vi.mock("@/features/identity/use-current-user", () => ({
  useCurrentUser: () => ({ user: currentUser, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/features/hoondok/ask/public-api", async (original) => ({
  ...(await original<object>()),
  publicQuestionsAPI: {
    list: vi.fn(),
    detail: vi.fn(),
    submit: vi.fn(),
    mine: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("@/features/hoondok/ask/asks-api", async (original) => ({
  ...(await original<object>()),
  asksAPI: { quota: vi.fn(), list: vi.fn(), detail: vi.fn(), setSaved: vi.fn() },
}));

vi.mock("@/features/hoondok/library/api", () => ({
  libraryAPI: { list: vi.fn(async () => ({ items: [] })) },
  wordsHref: (volume: string) => `/words/${encodeURIComponent(volume)}`,
}));

import { ASK_QUESTION_MAX, requestHoondokAsk } from "@/features/hoondok/ask/ask-stream";
import { asksAPI } from "@/features/hoondok/ask/asks-api";
import { AskDetail } from "@/features/hoondok/ask/components/ask-detail";
import { ASK_EXAMPLES, AskHome } from "@/features/hoondok/ask/components/ask-home";
import { AskNew } from "@/features/hoondok/ask/components/ask-new";
import { AskPublic } from "@/features/hoondok/ask/components/ask-public";
import { clearLiveAsks, readLiveAsks } from "@/features/hoondok/ask/live";
import { answeredByLabel } from "@/features/hoondok/ask/modes";
import { publicQuestionsAPI } from "@/features/hoondok/ask/public-api";
import { passageAskHref } from "@/features/hoondok/library/components/passage-sheet";

function render(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  const view = renderView(wrap(children));
  return { ...view, rerender: (node: ReactNode) => view.rerender(wrap(node)) };
}

const SID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "6f1c2f3e-0000-4000-8000-000000000001";
const SOURCE = { volume: "천성경 1편 3장", text: "참사랑은 직단거리를 갑니다.", score: 0.7, source: "A" };

/** SSE 본문을 2바이트씩 흘려보낸다 — 청크가 이벤트 경계에서 나뉘어도 파서가 버틴다. */
function sseResponse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function sseBody(
  sources: unknown[],
  extra: { answer_mode?: string; suggested_followups?: string[]; text?: string; message_id?: string } = {},
) {
  const { text = "정성은 기간을 정해 드리는 실천입니다.", ...meta } = extra;
  return [
    `event: chunk\ndata: ${JSON.stringify({ text })}\n\n`,
    `event: sources\ndata: ${JSON.stringify({ sources, session_id: SID, message_id: MESSAGE_ID, answer_mode: "standard", ...meta })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ disclaimer: "AI 설명은 참고용입니다" })}\n\n`,
  ].join("");
}

function jsonError(status: number, errorCode: string) {
  return new Response(JSON.stringify({ error_code: errorCode, message: "x", request_id: "r" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBodies() {
  return vi.mocked(globalThis.fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")));
}

function turn(patch: Partial<MyAskTurn> = {}): MyAskTurn {
  return {
    message_id: MESSAGE_ID,
    question: "정성을 드린다는 게 뭔가요?",
    answer_md: "정성은 기간을 정해 드리는 실천입니다.",
    answer_mode: "theological",
    sources: [SOURCE],
    suggested_followups: ["가족과 함께 하려면요?"],
    public_id: null,
    public_status: null,
    created_at: "2026-11-03T01:00:00Z",
    ...patch,
  };
}

function detail(turns: MyAskTurn[] = [turn()], patch: Partial<MyAskDetail> = {}): MyAskDetail {
  return { id: SID, saved: false, created_at: "2026-11-03T01:00:00Z", turns, ...patch };
}

function summary(id: string, patch: Partial<MyAskSummary> = {}): MyAskSummary {
  return {
    id,
    question: `질문 ${id}`,
    answer_mode: "standard",
    turn_count: 1,
    saved: false,
    public_id: null,
    public_status: null,
    created_at: "2026-11-03T01:00:00Z",
    last_at: "2026-11-03T01:00:00Z",
    ...patch,
  };
}

function quota(remaining: number) {
  vi.mocked(asksAPI.quota).mockResolvedValue({
    limit: 5,
    used: 5 - remaining,
    remaining,
    resets_at: "2026-11-05T00:00:00+09:00",
  });
}

beforeEach(() => {
  queryParams = {};
  currentUser = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  clearLiveAsks();
  quota(5);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI 질문 어댑터", () => {
  it("훈독 질문은 /hoondok/ask/stream 으로 봇 없이 보내고 세션·메시지·적용 모드·관련 질문을 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(sseBody([SOURCE], { answer_mode: "beginner", suggested_followups: ["더 알려 주세요", " "] })),
        ),
    );
    const result = await requestHoondokAsk("정성이 뭔가요?");

    expect(result).toMatchObject({
      answer: "정성은 기간을 정해 드리는 실천입니다.",
      sessionId: SID,
      messageId: MESSAGE_ID,
      resolvedMode: "beginner",
      followups: ["더 알려 주세요"],
    });
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/backend/hoondok/ask/stream");
    expect(init?.method).toBe("POST");
    expect(requestBodies()[0]).toEqual({ query: "정성이 뭔가요?" });
  });

  it("고른 모델·이어 묻기 세션은 요청에 싣는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    await requestHoondokAsk("이어서", { answerMode: "theological", sessionId: SID });
    expect(requestBodies()[0]).toEqual({ query: "이어서", answer_mode: "theological", session_id: SID });
  });

  it.each([
    [
      jsonError(429, "ASK_DAILY_LIMIT"),
      "오늘 물어볼 수 있는 횟수를 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)",
    ],
    [jsonError(429, "RATE_LIMIT_EXCEEDED"), "지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요"],
    [jsonError(400, "INPUT_BLOCKED"), "이 질문은 보낼 수 없어요. 다른 표현으로 고쳐서 물어봐 주세요"],
    [jsonError(403, "SESSION_FORBIDDEN"), "이 대화에는 이어 물을 수 없어요. 새 질문으로 물어봐 주세요"],
    [new Response("", { status: 401 }), "질문하려면 훈독 로그인이 필요해요"],
    [new Response("", { status: 500 }), "답을 받지 못했어요"],
  ])("오류 응답을 안내 문구로 바꾼다 (%#)", async (response, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(requestHoondokAsk("질문")).rejects.toThrow(message);
  });

  it.each([
    ["sources 없이 끊김", () => 'event: chunk\ndata: {"text":"일부"}\n\n'],
    ["sources 뒤 끊김", () => sseBody([SOURCE]).slice(0, sseBody([SOURCE]).indexOf("event: done"))],
  ])("%s은 완료로 처리하지 않는다", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(body())));
    await expect(requestHoondokAsk("질문")).rejects.toThrow("답을 받지 못했어요");
  });
});

describe("모델 이름", () => {
  it("받침에 맞춰 조사를 고른다", () => {
    expect(answeredByLabel("standard")).toBe("말씀 길잡이가 답했어요");
    expect(answeredByLabel("pastoral")).toBe("마음 돌봄이 답했어요");
    expect(answeredByLabel("theological", "이어서 답했어요")).toBe("깊은 해설이 이어서 답했어요");
  });
});

describe("AI 질문 홈", () => {
  it("예전 기기 기록(hoondok:ask:items)은 읽지 않고 지운다", async () => {
    window.localStorage.setItem("hoondok:ask:items", JSON.stringify([{ id: "x", question: "앞사람의 질문" }]));
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({ items: [], next_cursor: null });
    render(<AskHome />);
    await waitFor(() => expect(window.localStorage.getItem("hoondok:ask:items")).toBeNull());
    expect(screen.queryByText("앞사람의 질문")).toBeNull();
  });

  it("추천 탭이 기본이고, 공개 질문이 없으면 예시 질문이 새 질문 화면을 채워 연다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({ items: [], next_cursor: null });
    render(<AskHome />);

    expect(screen.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
    const example = await screen.findByRole("link", { name: ASK_EXAMPLES[1] });
    expect(example).toHaveAttribute("href", `/ask/new?q=${encodeURIComponent(ASK_EXAMPLES[1])}`);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "질문하기" })).toHaveAttribute("href", "/ask/new");
  });

  it("추천 질문은 비로그인도 보고, 답한 모델과 함께 공개 상세로 이어진다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({
      items: [
        {
          id: "pq1",
          question: "참사랑과 보통의 사랑은 무엇이 다른가요?",
          preview: "받기 전에 먼저 주는 사랑",
          answer_mode: "theological",
          published_at: "2026-10-28T00:00:00Z",
        },
      ],
      next_cursor: null,
    });
    render(<AskHome />);
    const link = await screen.findByRole("link", { name: /참사랑과 보통의 사랑/ });
    expect(link).toHaveAttribute("href", "/ask/p/pq1");
    expect(within(link).getByText("깊은 해설이 답했어요")).toBeInTheDocument();
  });

  it("추천 목록을 못 불러오면 다시 시도를 둔다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockRejectedValue(new Error("down"));
    render(<AskHome />);
    expect(await screen.findByText("추천 질문을 불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("비로그인이면 저장·내 질문 탭은 로그인 안내만 보이고 계정 목록을 묻지 않는다", () => {
    queryParams = { tab: "saved" };
    render(<AskHome />);
    expect(screen.getByText("로그인하면 저장한 답을 볼 수 있어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로그인하기" })).toHaveAttribute(
      "href",
      `/onboarding?returnTo=${encodeURIComponent("/ask?tab=saved")}`,
    );
    expect(asksAPI.list).not.toHaveBeenCalled();
  });

  it("로그인하면 계정 목록을 읽고, 다시 물은 질문은 답한 모델 이름으로 구분한다. 저장 탭은 저장한 것만", async () => {
    currentUser = { id: "u1" };
    queryParams = { tab: "mine" };
    vi.mocked(asksAPI.list).mockResolvedValue({
      items: [
        summary("a1", { question: "정성이란?", answer_mode: "beginner", turn_count: 3 }),
        summary("a2", { question: "정성이란?", answer_mode: "theological", saved: true, public_status: "pending" }),
      ],
    });
    render(<AskHome />);

    const links = await screen.findAllByRole("link", { name: /정성이란\?/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("처음 믿는 분");
    expect(links[0]).toHaveTextContent("이어서 2번");
    expect(links[1]).toHaveTextContent("깊은 해설");
    expect(links[1]).toHaveTextContent("공개 허용");
    expect(links[1]).toHaveAttribute("href", "/ask/a2");

    fireEvent.click(screen.getByRole("tab", { name: "저장" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("탭은 주소를 따라간다 — 홈에 있을 때 ?tab=mine 으로 와도 바뀌고, 고른 탭은 주소에 남는다", () => {
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({ items: [], next_cursor: null });
    const view = render(<AskHome />);
    expect(screen.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
    queryParams = { tab: "mine" };
    view.rerender(<AskHome />);
    expect(screen.getByRole("tab", { name: "내 질문" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "저장" }));
    expect(mockReplace).toHaveBeenCalledWith("/ask?tab=saved", { scroll: false });
  });

  it("돋보기 검색은 내 질문을 거르고, Esc 로 닫으면 돋보기로 포커스가 돌아온다", async () => {
    currentUser = { id: "u1" };
    queryParams = { tab: "mine" };
    vi.mocked(asksAPI.list).mockResolvedValue({
      items: [summary("q1", { question: "정성은 무엇인가요" }), summary("q2", { question: "축복 가정의 의미" })],
    });
    render(<AskHome />);
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("button", { name: "질문 검색" }));
    const input = screen.getByRole("searchbox", { name: "질문 검색어" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "축복" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "없는 말" } });
    expect(screen.getByRole("link", { name: /이 말로 새로 묻기/ })).toHaveAttribute(
      "href",
      `/ask/new?q=${encodeURIComponent("없는 말")}`,
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "질문 검색" })).toHaveFocus());
  });

  it("추천 탭 검색은 입력이 멈춘 뒤 서버에 q 로 묻는다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({ items: [], next_cursor: null });
    render(<AskHome />);
    fireEvent.click(screen.getByRole("button", { name: "질문 검색" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "질문 검색어" }), { target: { value: " 사랑 " } });
    await waitFor(() =>
      expect(publicQuestionsAPI.list).toHaveBeenCalledWith({ q: "사랑", cursor: null }, expect.anything()),
    );
    expect(await screen.findByText("'사랑' 검색 결과 0개")).toBeInTheDocument();
  });
});

describe("새 질문하기", () => {
  it("비로그인이면 입력 대신 로그인 안내를 보이고, 문장은 주소가 아닌 이 탭에 맡기고 모델만 주소에 싣는다", () => {
    queryParams = { q: "단락 질문", mode: "beginner" };
    vi.stubGlobal("fetch", vi.fn());
    render(<AskNew />);

    expect(screen.getByText("질문하려면 로그인이 필요해요")).toBeInTheDocument();
    expect(screen.getByText("단락 질문")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "로그인하기" })).toHaveAttribute(
      "href",
      `/onboarding?returnTo=${encodeURIComponent("/ask/new?resume=1&mode=beginner")}`,
    );
    expect(window.sessionStorage.getItem("hoondok:ask-draft")).toBe("단락 질문");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("로그인에서 돌아오면(resume) 맡겨 둔 문장을 되찾고 지운다", async () => {
    currentUser = { id: "u1" };
    window.sessionStorage.setItem("hoondok:ask-draft", "맡겨 둔 질문");
    queryParams = { resume: "1" };
    render(<AskNew />);
    expect(await screen.findByDisplayValue("맡겨 둔 질문")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("hoondok:ask-draft")).toBeNull();
  });

  it("로그인에서 돌아오면 문장·모델이 그대로고 남은 질문 수를 보인다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "단락 질문", mode: "beginner" };
    quota(3);
    render(<AskNew />);
    expect(screen.getByLabelText("무엇이 궁금하세요?")).toHaveValue("단락 질문");
    expect(screen.getByRole("button", { name: "답변 모델: 처음 믿는 분" })).toBeInTheDocument();
    expect(await screen.findByText("오늘 남은 질문 3회")).toBeInTheDocument();
  });

  it("보내기 한 번에 요청 한 번 — /hoondok/ask/stream 으로 보내고 임시 주소로 바꿔 간다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "정성이 뭔가요?" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    render(<AskNew />);

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/ask\/live-/));
    await waitFor(() => expect(readLiveAsks()[0]?.status).toBe("answered"));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe("/api/backend/hoondok/ask/stream");
    expect(requestBodies()[0]).toEqual({ query: "정성이 뭔가요?" });
    expect(publicQuestionsAPI.submit).not.toHaveBeenCalled();
  });

  it("오늘 질문을 다 썼으면 보내기를 잠그고 자정 초기화를 알린다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "질문" };
    quota(0);
    render(<AskNew />);
    expect(
      await screen.findByText("오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("1000자를 넘으면 글자 수를 알리고 보내기를 잠근다(이모지는 1자)", () => {
    currentUser = { id: "u1" };
    render(<AskNew />);
    const input = screen.getByLabelText("무엇이 궁금하세요?");
    fireEvent.change(input, { target: { value: "😀".repeat(ASK_QUESTION_MAX) } });
    expect(screen.getByText(`${ASK_QUESTION_MAX}/${ASK_QUESTION_MAX}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "가".repeat(ASK_QUESTION_MAX + 1) } });
    expect(screen.getByText(`1000자까지 보낼 수 있어요 (1001/1000)`)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("공개 여부: 비공개는 내 계정에서만, 공개는 관리자가 골라 추천 질문으로 올릴 수 있다고 알린다", () => {
    currentUser = { id: "u1" };
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    expect(screen.getByText("내 계정에서만 볼 수 있어요")).toBeInTheDocument();
    expect(screen.getByText(/관리자가 골라 추천 질문으로 올릴 수 있어요/)).toBeInTheDocument();
  });

  it("공개를 골라 보내면 답이 끝난 뒤 message_id 로 공개 신청한다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "감사의 의미" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    vi.mocked(publicQuestionsAPI.submit).mockResolvedValue({
      id: "pq1",
      question: "감사의 의미",
      status: "pending",
      created_at: "2026-11-03T00:00:00Z",
    } as never);
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    fireEvent.click(screen.getByRole("radio", { name: /공개하고 함께 나누기/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(publicQuestionsAPI.submit).toHaveBeenCalledWith(MESSAGE_ID));
  });
});

describe("질문·답변 상세", () => {
  it("비로그인이면 로그인 안내만 보이고 기록을 묻지 않는다", () => {
    render(<AskDetail id={SID} />);
    expect(screen.getByText("로그인하면 볼 수 있어요")).toBeInTheDocument();
    expect(asksAPI.detail).not.toHaveBeenCalled();
  });

  it("남의 것·지운 질문(404)은 찾을 수 없다고 말한다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockRejectedValue(new ApiError(404, "not found"));
    render(<AskDetail id={SID} />);
    expect(await screen.findByText("질문을 찾을 수 없어요")).toBeInTheDocument();
  });

  it("계정 기록을 그려 답한 모델·핵심 근거·답·근거 카드를 보인다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    render(<AskDetail id={SID} />);
    expect(await screen.findByText("정성은 기간을 정해 드리는 실천입니다.")).toBeInTheDocument();
    expect(screen.getByText("이 모델이 답변했어요")).toBeInTheDocument();
    expect(screen.getByText("깊은 해설")).toBeInTheDocument();
    expect(screen.getByText("근거 말씀 · 천성경 1편 3장")).toBeInTheDocument();
    expect(screen.getByText("내 계정에만 보관돼요")).toBeInTheDocument();
    expect(screen.getByText("비공개 · 내 계정에서만 볼 수 있어요.")).toBeInTheDocument();
  });

  it("근거가 0건인 기록은 답을 보이지 않고 다시 묻기만 둔다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail([turn({ sources: [], answer_md: "근거 없는 답" })]));
    render(<AskDetail id={SID} />);
    expect(await screen.findByText("근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요")).toBeInTheDocument();
    expect(screen.queryByText("근거 없는 답")).toBeNull();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  });

  it("모델 변경 시트는 카드의 모델을 미리 고르고, 그대로 확정하면 닫기만 한다. 다른 모델이면 새로 묻는다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    render(<AskDetail id={SID} />);

    fireEvent.click(await screen.findByRole("button", { name: "답변 모델 변경" }));
    expect(screen.getByRole("radio", { name: /깊은 해설/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "이 모델로 다시 묻기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "답변 모델 변경" }));
    fireEvent.click(screen.getByRole("radio", { name: /처음 믿는 분/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 모델로 다시 묻기" }));
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/ask\/live-/));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(requestBodies()[0]).toEqual({ query: "정성을 드린다는 게 뭔가요?", answer_mode: "beginner" });
  });

  it("저장은 계정에 남긴다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    vi.mocked(asksAPI.setSaved).mockResolvedValue(detail(undefined, { saved: true }));
    render(<AskDetail id={SID} />);
    const toggle = await screen.findByRole("button", { name: "저장" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    vi.mocked(asksAPI.detail).mockResolvedValue(detail(undefined, { saved: true }));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(asksAPI.setSaved).toHaveBeenCalledWith(SID, true);
  });

  it("이어 묻기는 같은 대화로 보내고 받는 동안 턴이 쌓인다. 남은 횟수를 막대에 보인다", async () => {
    currentUser = { id: "u1" };
    quota(2);
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(
          sseBody([SOURCE], {
            text: "작은 약속부터 지켜 보세요.",
            message_id: "6f1c2f3e-0000-4000-8000-000000000002",
          }),
        ),
      ),
    );
    render(<AskDetail id={SID} />);

    fireEvent.click(await screen.findByRole("button", { name: "가족과 함께 하려면요?" }));
    const field = screen.getByRole("textbox", { name: "이어서 질문하기" });
    expect(field).toHaveValue("가족과 함께 하려면요?");
    expect(await screen.findByText("오늘 남은 질문 2회")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이어서 질문 보내기" }));

    expect(await screen.findByText("작은 약속부터 지켜 보세요.")).toBeInTheDocument();
    expect(requestBodies()[0]).toEqual({ query: "가족과 함께 하려면요?", session_id: SID });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("오늘 질문을 다 썼으면 이어 묻기·다시 묻기를 잠그고 안내한다", async () => {
    currentUser = { id: "u1" };
    quota(0);
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    render(<AskDetail id={SID} />);
    const reasons = await screen.findAllByText("오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)");
    expect(reasons.length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "이어서 질문하기" })).toBeDisabled();
    // 막힌 버튼은 이유 안내를 가리킨다
    expect(screen.getByRole("button", { name: /다시 묻기/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /다시 묻기/ })).toHaveAccessibleDescription(
      "오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)",
    );
    expect(screen.getByRole("button", { name: "답변 모델 변경" })).toHaveAccessibleDescription(
      "오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)",
    );
  });

  it("이어 묻기가 1000자를 넘으면 자르지 않고 알리며 보내기를 잠근다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    render(<AskDetail id={SID} />);
    const field = await screen.findByRole("textbox", { name: "이어서 질문하기" });
    fireEvent.change(field, { target: { value: "가".repeat(ASK_QUESTION_MAX + 1) } });
    expect(field).toHaveValue("가".repeat(ASK_QUESTION_MAX + 1));
    expect(screen.getByText(`${ASK_QUESTION_MAX}자까지 보낼 수 있어요 (1001/${ASK_QUESTION_MAX})`)).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "이어서 질문 보내기" })).toBeDisabled();
  });

  it("다른 계정으로 바뀌면 앞 계정이 받던 질문을 그리지 않는다(임시 주소·대화 주소 모두)", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "A 의 비공개 질문" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE], { text: "A 의 답" }))));
    const form = render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    const key = String(mockReplace.mock.calls[0][0]).split("/").at(-1) as string;
    await waitFor(() => expect(readLiveAsks()[0]?.status).toBe("answered"));
    form.unmount();

    currentUser = { id: "u2" };
    vi.mocked(asksAPI.detail).mockRejectedValue(new ApiError(404, "없음"));
    const live = render(<AskDetail id={key} />);
    expect(screen.getAllByText("질문을 찾을 수 없어요").length).toBeGreaterThan(0);
    expect(screen.queryByText("A 의 비공개 질문")).toBeNull();
    live.unmount();

    render(<AskDetail id={SID} />);
    expect(await screen.findByText("질문을 찾을 수 없어요")).toBeInTheDocument();
    expect(screen.queryByText("A 의 비공개 질문")).toBeNull();
    expect(screen.queryByText("A 의 답")).toBeNull();
  });

  it("보낼 수 없는 질문(400)은 다시 시도 대신 새 질문 화면에서 고칠 수 있게 한다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "차단될 질문" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(400, "INPUT_BLOCKED")));
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    const key = String(mockReplace.mock.calls[0][0]).split("/").at(-1) as string;
    render(<AskDetail id={key} />);
    const fix = await screen.findByRole("link", { name: "고쳐서 다시 묻기" });
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    expect(fix).toHaveAttribute("href", "/ask/new?resume=1");
    fireEvent.click(fix);
    expect(window.sessionStorage.getItem("hoondok:ask-draft")).toBe("차단될 질문");
  });

  it("임시 주소에서 답을 기다리고, 하루 횟수 초과(429)면 다시 시도 없이 안내한다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "질문" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(429, "ASK_DAILY_LIMIT")));
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    const key = String(mockReplace.mock.calls[0][0]).split("/").at(-1) as string;
    render(<AskDetail id={key} />);
    expect(
      await screen.findByText("오늘 물어볼 수 있는 횟수를 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("임시 주소의 답이 끝나면 대화 주소로 바꿔 낀다. 그만두기는 다시 시도로 되돌린다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "질문" };
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => (finish = resolve))));
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    const key = String(mockReplace.mock.calls[0][0]).split("/").at(-1) as string;
    mockReplace.mockClear();
    render(<AskDetail id={key} />);
    expect(screen.getByText("근거 말씀을 찾고 있어요. 잠시만 기다려 주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "그만두기" }));
    expect(await screen.findByText("질문을 그만뒀어요. 다시 시도하면 처음부터 찾아요")).toBeInTheDocument();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(sseResponse(sseBody([SOURCE])));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/ask/${SID}`));
    await act(async () => finish(sseResponse(sseBody([SOURCE]))));
  });

  it("공개 내리기는 확인을 받고, 내린 뒤 알리고 다시 허용할 수 있다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail([turn({ public_id: "pq1", public_status: "published" })]));
    vi.mocked(publicQuestionsAPI.remove).mockResolvedValue({});
    render(<AskDetail id={SID} />);

    fireEvent.click(await screen.findByRole("button", { name: "추천에서 내리기" }));
    expect(publicQuestionsAPI.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "추천에서 내릴까요?" });
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    fireEvent.click(within(dialog).getByRole("button", { name: "내리기" }));

    expect(await screen.findByText("공개를 내렸어요. 추천 목록에서 빠졌어요.")).toBeInTheDocument();
    expect(publicQuestionsAPI.remove).toHaveBeenCalledWith("pq1");
    expect(await screen.findByRole("button", { name: "다시 공개 허용하기" })).toBeInTheDocument();
  });

  it("추천 전(후보)이면 취소 문구로 확인받고 추천 목록 이야기를 하지 않는다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail([turn({ public_id: "pq1", public_status: "pending" })]));
    vi.mocked(publicQuestionsAPI.remove).mockResolvedValue({});
    render(<AskDetail id={SID} />);

    fireEvent.click(await screen.findByRole("button", { name: "공개 허용 취소" }));
    const dialog = screen.getByRole("dialog", { name: "공개 허용을 취소할까요?" });
    expect(within(dialog).queryByText(/추천 목록과 공개 링크/)).toBeNull();
    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    fireEvent.click(within(dialog).getByRole("button", { name: "취소하기" }));
    expect(await screen.findByText("공개 허용을 취소했어요. 내 계정에서만 볼 수 있어요.")).toBeInTheDocument();
  });

  it("자동 공개 신청이 끝났는데 대화 기록에 아직 공개 id 가 없으면 보내는 중으로 보인다", async () => {
    currentUser = { id: "u1" };
    queryParams = { q: "공개할 질문" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    vi.mocked(publicQuestionsAPI.submit).mockResolvedValue({} as never);
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    fireEvent.click(screen.getByRole("radio", { name: /공개하고 함께 나누기/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(readLiveAsks()[0]?.publicOutcome).toBe("done"));

    vi.mocked(asksAPI.detail).mockResolvedValue(detail());
    render(<AskDetail id={SID} />);
    expect(await screen.findByText("공개 신청을 보내고 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "공개 허용하기" })).toBeNull();
  });

  it("마음 돌봄으로 답했으면 공개 허용 버튼 대신 이유를 알린다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail([turn({ answer_mode: "pastoral" })]));
    render(<AskDetail id={SID} />);
    expect(await screen.findByText("마음 돌봄으로 답한 질문은 공개하지 않아요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /공개 허용하기/ })).toBeNull();
  });

  it("긴 질문 제목은 3줄로 접고 펼칠 수 있다", async () => {
    currentUser = { id: "u1" };
    vi.mocked(asksAPI.detail).mockResolvedValue(detail([turn({ question: "가".repeat(200) })]));
    render(<AskDetail id={SID} />);
    const heading = await screen.findByRole("heading", { name: "가".repeat(200) });
    expect(heading).toHaveClass("ask-q--clamp");
    fireEvent.click(screen.getByRole("button", { name: "질문 전체 보기" }));
    expect(heading).not.toHaveClass("ask-q--clamp");
  });
});

describe("공개 질문 열람", () => {
  it("질문·답한 모델·답·근거를 읽기만 하고 나도 물어보기로 이어진다", async () => {
    vi.mocked(publicQuestionsAPI.detail).mockResolvedValue({
      id: "pq1",
      question: "참사랑과 보통의 사랑은 무엇이 다른가요?",
      answer_md: "참사랑은 받기 전에 먼저 주는 사랑입니다.",
      sources: [{ source: "A", volume: "천성경 4편", text: "가정은 사랑을 배우는 첫 학교입니다." }],
      answer_mode: "theological",
      published_at: "2026-10-28T00:00:00Z",
    });
    render(<AskPublic id="pq1" />);
    expect(await screen.findByText("참사랑은 받기 전에 먼저 주는 사랑입니다.")).toBeInTheDocument();
    expect(screen.getByText("깊은 해설")).toBeInTheDocument();
    expect(screen.getByText("가정은 사랑을 배우는 첫 학교입니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "나도 물어보기" })).toHaveAttribute("href", "/ask/new");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("공개가 끝난 질문(404)은 찾을 수 없다고 말한다", async () => {
    vi.mocked(publicQuestionsAPI.detail).mockRejectedValue(new ApiError(404, "not found"));
    render(<AskPublic id="gone" />);
    expect(await screen.findByText("공개된 질문을 찾을 수 없어요")).toBeInTheDocument();
  });
});

describe("말씀 단락에서 질문하기", () => {
  it("단락 인용을 채운 새 질문 화면 주소를 만들고, 긴 단락은 앞부분만 담는다", () => {
    const href = passageAskHref("가정은 사랑을 배우는 첫 학교입니다.");
    expect(href.startsWith("/ask/new?q=")).toBe(true);
    expect(decodeURIComponent(href.split("q=")[1])).toBe(
      '"가정은 사랑을 배우는 첫 학교입니다."\n\n이 단락은 어떤 뜻인가요?',
    );
    const long = decodeURIComponent(passageAskHref("가".repeat(500)).split("q=")[1]);
    expect(long).toContain("…");
    expect(long.length).toBeLessThan(260);
  });
});
