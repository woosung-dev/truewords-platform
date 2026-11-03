import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AI 질문 (DEC-PWA-025 개편). 기기 저장소·SSE 어댑터·홈(탭 목록)·새 질문·상세(이어 묻기·공개 신청)·공개 열람.
const mockPush = vi.fn();
const mockReplace = vi.fn();
let queryParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok/ask",
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

vi.mock("@/features/hoondok/library/api", () => ({
  libraryAPI: { list: vi.fn(async () => ({ items: [] })) },
  wordsHref: (volume: string) => `/hoondok/words/${encodeURIComponent(volume)}`,
}));

import { HOONDOK_ASK_CHATBOT_ID, requestAsk } from "@/features/hoondok/ask/ask-stream";
import { AskDetail } from "@/features/hoondok/ask/components/ask-detail";
import { ASK_EXAMPLES, AskHome } from "@/features/hoondok/ask/components/ask-home";
import { AskNew } from "@/features/hoondok/ask/components/ask-new";
import { AskPublic } from "@/features/hoondok/ask/components/ask-public";
import { answeredByLabel } from "@/features/hoondok/ask/modes";
import { publicQuestionsAPI } from "@/features/hoondok/ask/public-api";
import {
  ASK_MAX,
  type AskItem,
  appendAskItem,
  readAskItem,
  readAskItems,
  toggleAskSaved,
} from "@/features/hoondok/ask/storage";
import { passageAskHref } from "@/features/hoondok/library/components/passage-sheet";

function render(children: ReactNode) {
  return renderView(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>,
  );
}

const KEY = "hoondok:ask:items";

function item(id: string, patch: Partial<AskItem> = {}): AskItem {
  return { id, question: `질문 ${id}`, status: "pending", createdAt: new Date().toISOString(), ...patch };
}

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

const SOURCE = { volume: "천성경 1편 3장", text: "참사랑은 직단거리를 갑니다.", score: 0.7, source: "A" };
const MESSAGE_ID = "6f1c2f3e-0000-4000-8000-000000000001";

function sseBody(
  sources: unknown[],
  extra: { answer_mode?: string; suggested_followups?: string[]; text?: string } = {},
) {
  const { text = "정성은 기간을 정해 드리는 실천입니다.", ...meta } = extra;
  return [
    `event: chunk\ndata: ${JSON.stringify({ text })}\n\n`,
    `event: sources\ndata: ${JSON.stringify({ sources, session_id: "s1", message_id: MESSAGE_ID, answer_mode: "standard", ...meta })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ disclaimer: "AI 설명은 참고용입니다" })}\n\n`,
  ].join("");
}

function requestBodies() {
  return vi.mocked(globalThis.fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")));
}

beforeEach(() => {
  queryParams = {};
  currentUser = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("질문 기록 저장소 (기기 전용)", () => {
  it("최신 질문이 앞에 쌓이고 상한 50건을 넘으면 오래된 것부터 버린다", () => {
    for (let index = 0; index < ASK_MAX + 3; index += 1) appendAskItem(item(`q${index}`));
    const items = readAskItems();
    expect(items).toHaveLength(ASK_MAX);
    expect(items[0].id).toBe(`q${ASK_MAX + 2}`);
    expect(items.some((entry) => entry.id === "q0")).toBe(false);
  });

  it("저장 토글은 값을 뒤집어 저장소에 반영한다", () => {
    appendAskItem(item("q1"));
    expect(toggleAskSaved("q1")).toBe(true);
    expect(readAskItem("q1")?.isSaved).toBe(true);
    expect(toggleAskSaved("q1")).toBe(false);
    expect(readAskItem("q1")?.isSaved).toBe(false);
  });

  it("깨진 JSON·배열 아닌 값·모양이 다른 항목에도 예외를 던지지 않는다", () => {
    window.localStorage.setItem(KEY, "{이건 JSON 이 아니다");
    expect(readAskItems()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({ items: [] }));
    expect(readAskItems()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify([{ id: 1 }, item("q9")]));
    expect(readAskItems().map((entry) => entry.id)).toEqual(["q9"]);
  });

  it("개편 전 저장 항목은 그대로 읽고, 새 필드의 엉뚱한 값은 버린다", () => {
    const legacy = {
      id: "old",
      question: "예전 질문",
      status: "answered",
      createdAt: "2026-09-20T01:00:00.000Z",
      answer: "예전 답",
      sources: [SOURCE],
      disclaimer: "참고용",
      isSaved: true,
    };
    const broken = {
      ...item("new"),
      answerMode: "angry",
      resolvedMode: 3,
      visibility: "everyone",
      publicStatus: "approved",
      turns: [{ id: "t1", question: "이어서", status: "answered", createdAt: "2026-09-20T01:00:00.000Z" }, { id: 2 }],
    };
    window.localStorage.setItem(KEY, JSON.stringify([legacy, broken]));
    const [old, next] = readAskItems();
    expect(old).toEqual(legacy);
    expect(next.answerMode).toBeUndefined();
    expect(next.resolvedMode).toBeUndefined();
    expect(next.visibility).toBeUndefined();
    expect(next.publicStatus).toBeUndefined();
    expect(next.turns?.map((turn) => turn.id)).toEqual(["t1"]);
  });
});

describe("AI 질문 어댑터 (/chat/stream)", () => {
  it("새 질문은 session_id·answer_mode 없이 보내고 세션·메시지·적용 모드·관련 질문을 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(sseBody([SOURCE], { answer_mode: "beginner", suggested_followups: ["더 알려 주세요", " "] })),
        ),
    );
    const result = await requestAsk("정성이 뭔가요?");

    expect(result).toMatchObject({
      answer: "정성은 기간을 정해 드리는 실천입니다.",
      disclaimer: "AI 설명은 참고용입니다",
      sessionId: "s1",
      messageId: MESSAGE_ID,
      resolvedMode: "beginner",
      followups: ["더 알려 주세요"],
    });
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/backend/chat/stream");
    expect(init?.method).toBe("POST");
    expect(requestBodies()[0]).toEqual({ query: "정성이 뭔가요?", chatbot_id: HOONDOK_ASK_CHATBOT_ID });
  });

  it("고른 모델·이어 묻기 세션은 요청에 싣는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    await requestAsk("이어서", { answerMode: "theological", sessionId: "s1" });
    expect(requestBodies()[0]).toEqual({
      query: "이어서",
      chatbot_id: HOONDOK_ASK_CHATBOT_ID,
      answer_mode: "theological",
      session_id: "s1",
    });
  });

  it("answer_mode 가 없는 구 서버 응답은 말씀 길잡이로 본다", async () => {
    const body = sseBody([SOURCE]).replace(',"answer_mode":"standard"', "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(body)));
    expect((await requestAsk("질문")).resolvedMode).toBe("standard");
  });

  it("429 는 대기 안내 문구로 바뀐다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    await expect(requestAsk("질문")).rejects.toThrow("지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요");
  });

  it.each([
    ["sources 없이 끊김", () => 'event: chunk\ndata: {"text":"일부"}\n\n'],
    ["sources 뒤 끊김", () => sseBody([SOURCE]).slice(0, sseBody([SOURCE]).indexOf("event: done"))],
    ["배열 아닌 sources", () => sseBody([SOURCE]).replace(JSON.stringify([SOURCE]), '{"unexpected":true}')],
  ])("%s은 완료로 처리하지 않는다", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(body())));
    await expect(requestAsk("질문")).rejects.toThrow("답을 받지 못했어요");
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
  it("추천 탭이 기본이고, 공개 질문이 없으면 예시 질문이 새 질문 화면을 채워 연다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockResolvedValue({ items: [], next_cursor: null });
    render(<AskHome />);

    expect(screen.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
    const example = await screen.findByRole("link", { name: ASK_EXAMPLES[1] });
    expect(example).toHaveAttribute("href", `/hoondok/ask/new?q=${encodeURIComponent(ASK_EXAMPLES[1])}`);
    // 큰 입력창은 없다 — 질문은 "+ 질문하기" 로만 연다
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "질문하기" })).toHaveAttribute("href", "/hoondok/ask/new");
  });

  it("공개 질문은 답한 모델과 함께 공개 상세로 이어진다", async () => {
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
    expect(link).toHaveAttribute("href", "/hoondok/ask/p/pq1");
    expect(within(link).getByText("깊은 해설이 답했어요")).toBeInTheDocument();
  });

  it("추천 목록을 못 불러오면 다시 시도를 둔다", async () => {
    vi.mocked(publicQuestionsAPI.list).mockRejectedValue(new Error("down"));
    render(<AskHome />);
    expect(await screen.findByText("추천 질문을 불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("?tab=mine 은 내 질문 탭으로 열리고, 저장 탭은 저장한 것만 센다", () => {
    queryParams = { tab: "mine" };
    appendAskItem(item("q1", { status: "answered", sources: [SOURCE] }));
    appendAskItem(item("q2", { status: "answered", sources: [SOURCE], isSaved: true, publicStatus: "pending" }));
    render(<AskHome />);

    expect(screen.getByRole("tab", { name: "내 질문" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("공개 검토 중")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "저장" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /질문 q2/ })).toHaveAttribute("href", "/hoondok/ask/q2");
    expect(publicQuestionsAPI.list).not.toHaveBeenCalled();
  });

  it("탭은 주소를 따라간다 — 홈에 있을 때 ?tab=mine 으로 와도 바뀌고, 고른 탭은 주소에 남는다", () => {
    const view = render(<AskHome />);
    expect(screen.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
    queryParams = { tab: "mine" };
    view.rerender(<AskHome />);
    expect(screen.getByRole("tab", { name: "내 질문" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "저장" }));
    expect(mockReplace).toHaveBeenCalledWith("/hoondok/ask?tab=saved", { scroll: false });
  });

  it("돋보기를 누르면 그 자리에 검색창이 열리고 기기 탭은 질문 문장으로 거른다", () => {
    queryParams = { tab: "mine" };
    appendAskItem(item("q1", { question: "정성은 무엇인가요" }));
    appendAskItem(item("q2", { question: "축복 가정의 의미" }));
    render(<AskHome />);

    fireEvent.click(screen.getByRole("button", { name: "질문 검색" }));
    const input = screen.getByRole("searchbox", { name: "질문 검색어" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "축복" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "없는 말" } });
    expect(screen.getByRole("link", { name: /이 말로 새로 묻기/ })).toHaveAttribute(
      "href",
      `/hoondok/ask/new?q=${encodeURIComponent("없는 말")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
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
  it("?q= 로 채워 열고, 기본은 자동·비공개로 질문 1건을 남긴 뒤 상세로 바꿔 간다", () => {
    queryParams = { q: "이 말씀의 배경이 궁금해요" };
    render(<AskNew />);
    const input = screen.getByLabelText("무엇이 궁금하세요?");
    expect(input).toHaveValue("이 말씀의 배경이 궁금해요");
    expect(screen.getByRole("button", { name: /답변 모델: 자동 \(추천\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /공개 여부: 비공개로 보관하기/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    const [saved] = readAskItems();
    expect(saved).toMatchObject({ question: "이 말씀의 배경이 궁금해요", status: "pending", visibility: "private" });
    expect(saved.answerMode).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith(`/hoondok/ask/${saved.id}`);
  });

  it("빈 입력이면 보내기가 잠긴다", () => {
    render(<AskNew />);
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("답변 모델 시트에서 고른 모델을 질문에 남긴다", () => {
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /답변 모델/ }));
    const sheet = screen.getByRole("dialog", { name: "답변 모델" });
    expect(within(sheet).getAllByRole("radio")).toHaveLength(6);
    fireEvent.click(within(sheet).getByRole("radio", { name: /깊은 해설/ }));
    // 고르기만으로는 닫히지 않는다(방향키도 change 를 일으킨다) — 확정 버튼으로만 닫힌다
    expect(screen.getByRole("dialog", { name: "답변 모델" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "이 모델로 하기" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(screen.getByLabelText("무엇이 궁금하세요?"), { target: { value: "원리는?" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(readAskItems()[0].answerMode).toBe("theological");
  });

  it("비로그인이면 공개를 고를 수 없고 로그인 안내를 보인다", () => {
    queryParams = { q: "질문" };
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    const sheet = screen.getByRole("dialog", { name: "답변 공개 여부" });
    expect(within(sheet).getByRole("radio", { name: /공개하고 함께 나누기/ })).toBeDisabled();
    expect(within(sheet).getByRole("radio", { name: /비공개로 보관하기/ })).toBeChecked();
    expect(within(sheet).getByRole("link", { name: "로그인하고 공개하기" })).toHaveAttribute(
      "href",
      `/hoondok/onboarding?returnTo=${encodeURIComponent(`/hoondok/ask/new?q=${encodeURIComponent("질문")}&visibility=public`)}`,
    );
  });

  it("로그인하고 돌아오면 고른 모델·공개 선택이 이어진다", () => {
    currentUser = { id: "u1" };
    queryParams = { q: "질문", mode: "theological", visibility: "public" };
    render(<AskNew />);
    expect(screen.getByRole("button", { name: /답변 모델: 깊은 해설/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /공개 여부: 공개하고 함께 나누기/ })).toBeInTheDocument();
  });

  it("로그인하면 공개를 골라 질문에 남기고, 마음 돌봄을 고르면 비공개로 돌아간다", () => {
    currentUser = { id: "u1" };
    render(<AskNew />);
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    fireEvent.click(screen.getByRole("radio", { name: /공개하고 함께 나누기/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "답변 공개 여부" })).getByRole("button", { name: "닫기" }),
    );
    expect(screen.getByRole("button", { name: /공개 여부: 공개하고 함께 나누기/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /답변 모델/ }));
    fireEvent.click(screen.getByRole("radio", { name: /마음 돌봄/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 모델로 하기" }));
    expect(screen.getByRole("button", { name: /공개 여부: 비공개로 보관하기/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /공개 여부/ }));
    expect(screen.getByRole("radio", { name: /공개하고 함께 나누기/ })).toBeDisabled();
    expect(screen.getByText("마음 돌봄으로 답하는 질문은 공개하지 않아요.")).toBeInTheDocument();
  });
});

describe("질문·답변 상세", () => {
  it("근거가 1건 이상이면 답한 모델·핵심 근거·답·근거 카드를 함께 보인다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE], { answer_mode: "beginner" }))));
    appendAskItem(item("q1", { question: "정성이 뭔가요?" }));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("정성은 기간을 정해 드리는 실천입니다.")).toBeInTheDocument();
    expect(screen.getByText("자동으로 골랐어요")).toBeInTheDocument();
    expect(screen.getByText("처음 믿는 분")).toBeInTheDocument();
    expect(screen.getByText("근거 말씀 · 천성경 1편 3장")).toBeInTheDocument();
    expect(screen.getByText("AI 설명 · 공식 해설 아님")).toBeInTheDocument();
    expect(screen.getAllByText(SOURCE.text)).toHaveLength(2);
    expect(readAskItem("q1")).toMatchObject({
      status: "answered",
      sessionId: "s1",
      messageId: MESSAGE_ID,
      resolvedMode: "beginner",
    });
  });

  it("고른 모델로 묻고, 변경하면 같은 질문을 다른 모델로 새로 묻는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE], { answer_mode: "kids" }))));
    appendAskItem(item("q1", { answerMode: "kids" }));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("이 모델이 답변했어요")).toBeInTheDocument();
    expect(requestBodies()[0]).toMatchObject({ answer_mode: "kids" });

    fireEvent.click(screen.getByRole("button", { name: "답변 모델 변경" }));
    fireEvent.click(screen.getByRole("radio", { name: /말씀 길잡이/ }));
    // 고르기(방향키 포함)만으로는 새 질문을 보내지 않는다
    expect(readAskItems()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "이 모델로 다시 묻기" }));
    const [created] = readAskItems();
    expect(created).toMatchObject({ question: "질문 q1", status: "pending", answerMode: "standard" });
    expect(mockPush).toHaveBeenCalledWith(`/hoondok/ask/${created.id}`);
  });

  it("근거가 0건이면 답을 보이지 않고 확인할 수 없음으로 끝낸다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([]))));
    appendAskItem(item("q1"));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요")).toBeInTheDocument();
    expect(screen.queryByText("정성은 기간을 정해 드리는 실천입니다.")).toBeNull();
    expect(readAskItem("q1")).toMatchObject({ status: "no-sources", answer: "" });
  });

  it("답을 기다리는 동안 진행 표시와 그만두기를 함께 두고, 그만두면 다시 시도로 되돌린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    appendAskItem(item("q1"));
    const { container } = render(<AskDetail id="q1" />);

    const waiting = await screen.findByRole("status");
    expect(waiting).toHaveAttribute("aria-busy", "true");
    // 멈춤과 구별되려면 회전이 필요하다 — prefers-reduced-motion 에서도 유지한다 (DES §1.5)
    expect(container.querySelector(".ask-spinner")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "그만두기" }));

    expect(await screen.findByText("질문을 그만뒀어요. 다시 시도하면 처음부터 찾아요")).toBeInTheDocument();
    expect(readAskItem("q1")?.status).toBe("error");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("마스코트를 켜면 대기·근거 없음에 찾는 부엉이와 안내 한 줄이 붙고, 답이 나온 화면에는 부엉이가 없다", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_MASCOT", "1");
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    appendAskItem(item("q1"));
    const waiting = render(<AskDetail id="q1" />);
    expect(await screen.findByText("찾은 말씀 안에서만 설명해요.")).toBeInTheDocument();
    expect(waiting.container.querySelector('.ask-wait img.owl[data-pose="search"]')).not.toBeNull();
    waiting.unmount();

    appendAskItem(item("q2", { status: "no-sources" }));
    const none = render(<AskDetail id="q2" />);
    expect(await screen.findByText("책 이름이나 핵심 낱말을 넣으면 찾기 쉬워요.")).toBeInTheDocument();
    expect(none.container.querySelector(".ask-fail img.owl")).not.toBeNull();
    none.unmount();

    appendAskItem(item("q3", { status: "answered", answer: "답 본문", sources: [SOURCE] }));
    const answered = render(<AskDetail id="q3" />);
    expect(await screen.findByText(SOURCE.volume)).toBeInTheDocument();
    // 답 옆에 부엉이가 서면 부엉이가 답하는 존재로 읽힌다
    expect(answered.container.querySelector(".owl")).toBeNull();
  });

  it("근거 카드 출처 줄은 모르는 칸을 '확인되지 않음' 으로 적고 정본 등급 배지를 쓰지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "answered", answer: "답 본문", sources: [SOURCE] }));
    const { container } = render(<AskDetail id="q1" />);

    expect(await screen.findByText(SOURCE.volume)).toBeInTheDocument();
    expect(screen.getByText("판본 확인되지 않음")).toHaveClass("src__unknown");
    expect(screen.getByText("공식성 확인되지 않음")).toHaveClass("badge--dashed");
    expect(container.querySelector(".badge--rank")).toBeNull();
  });

  it("429 응답은 안내 문구와 다시 시도 버튼을 남긴다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    appendAskItem(item("q1"));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(readAskItem("q1")?.status).toBe("error");
  });

  it("저장 토글은 aria-pressed 를 뒤집고 저장소에 남긴다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "answered", answer: "답 본문", sources: [SOURCE], disclaimer: "참고용" }));
    render(<AskDetail id="q1" />);

    const toggle = screen.getByRole("button", { name: "이 질문 저장" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(readAskItem("q1")?.isSaved).toBe(true);
    // 답이 이미 있으므로 스트림을 다시 부르지 않는다
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("관련 질문은 서버 제안을 쓰고, 누르면 이어서 질문하기 칸을 채운다. 보내면 같은 세션으로 턴이 쌓인다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(sseResponse(sseBody([SOURCE], { answer_mode: "pastoral", text: "이어서 드린 답입니다." }))),
    );
    appendAskItem(
      item("q1", {
        status: "answered",
        answer: "첫 답",
        sources: [SOURCE],
        sessionId: "s1",
        messageId: MESSAGE_ID,
        resolvedMode: "standard",
        followups: ["가족을 위한 기도는 어떻게 하나요?"],
      }),
    );
    render(<AskDetail id="q1" />);

    // 서버 제안이 있으면 고정 문장은 쓰지 않는다
    expect(screen.queryByRole("button", { name: "이 말씀의 배경이 궁금해요" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "가족을 위한 기도는 어떻게 하나요?" }));
    const field = screen.getByRole("textbox", { name: "이어서 질문하기" });
    expect(field).toHaveValue("가족을 위한 기도는 어떻게 하나요?");
    expect(field).toHaveFocus();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "이어서 질문 보내기" }));
    expect(await screen.findByText("이어서 드린 답입니다.")).toBeInTheDocument();
    expect(screen.getByText("마음 돌봄이 이어서 답했어요")).toBeInTheDocument();
    expect(requestBodies()[0]).toMatchObject({
      query: "가족을 위한 기도는 어떻게 하나요?",
      session_id: "s1",
    });
    expect(readAskItem("q1")?.turns).toEqual([
      expect.objectContaining({ question: "가족을 위한 기도는 어떻게 하나요?", status: "answered" }),
    ]);
    expect(screen.getByRole("link", { name: "새 질문" })).toHaveAttribute("href", "/hoondok/ask/new");
  });

  it("서버 제안이 없으면 고정 관련 질문을 보인다", () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "answered", answer: "답", sources: [SOURCE], sessionId: "s1" }));
    render(<AskDetail id="q1" />);
    expect(screen.getByRole("button", { name: "이 말씀의 배경이 궁금해요" })).toBeInTheDocument();
  });

  it("공개를 골랐고 로그인했으면 답이 끝난 뒤 message_id 로 공개 신청하고 검토 중을 보인다", async () => {
    currentUser = { id: "u1" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    vi.mocked(publicQuestionsAPI.submit).mockResolvedValue({
      id: "pub123456789",
      message_id: MESSAGE_ID,
      question: "질문 q1",
      answer_mode: "standard",
      status: "pending",
      created_at: "2026-11-04T00:00:00Z",
      reviewed_at: null,
    });
    vi.mocked(publicQuestionsAPI.mine).mockResolvedValue({
      items: [
        {
          id: "pub123456789",
          message_id: MESSAGE_ID,
          question: "질문 q1",
          answer_mode: "standard",
          status: "pending",
          created_at: "2026-11-04T00:00:00Z",
          reviewed_at: null,
        },
      ],
    });
    appendAskItem(item("q1", { visibility: "public" }));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("공개 검토 중")).toBeInTheDocument();
    expect(publicQuestionsAPI.submit).toHaveBeenCalledTimes(1);
    expect(publicQuestionsAPI.submit).toHaveBeenCalledWith(MESSAGE_ID);
    expect(readAskItem("q1")).toMatchObject({ publicId: "pub123456789", publicStatus: "pending" });

    vi.mocked(publicQuestionsAPI.remove).mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "공개 신청 내리기" }));
    await waitFor(() => expect(readAskItem("q1")?.publicStatus).toBeUndefined());
    expect(publicQuestionsAPI.remove).toHaveBeenCalledWith("pub123456789");
    expect(readAskItem("q1")?.visibility).toBe("private");
  });

  it("마음 돌봄으로 답했으면 공개 신청하지 않고 이유를 알린다", async () => {
    currentUser = { id: "u1" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE], { answer_mode: "pastoral" }))));
    appendAskItem(item("q1", { visibility: "public" }));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText(/마음 돌봄이나 위기 안내로 답했거나/)).toBeInTheDocument();
    expect(publicQuestionsAPI.submit).not.toHaveBeenCalled();
    expect(readAskItem("q1")?.publicStatus).toBe("blocked");
  });

  it("서버가 409 로 거절하면 공개할 수 없는 답으로 남긴다", async () => {
    currentUser = { id: "u1" };
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(publicQuestionsAPI.submit).mockRejectedValue(new ApiError(409, "conflict"));
    appendAskItem(
      item("q1", { status: "answered", answer: "답", sources: [SOURCE], messageId: MESSAGE_ID, visibility: "public" }),
    );
    render(<AskDetail id="q1" />);
    await waitFor(() => expect(readAskItem("q1")?.publicStatus).toBe("blocked"));
  });

  it("공개됐던 질문이 나중에 숨겨지면 기기 표시도 따라간다", async () => {
    currentUser = { id: "u1" };
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(publicQuestionsAPI.mine).mockResolvedValue({
      items: [
        {
          id: "pub123456789",
          message_id: MESSAGE_ID,
          question: "질문 q1",
          answer_mode: "standard",
          status: "hidden",
          created_at: "2026-11-04T00:00:00Z",
          reviewed_at: "2026-11-04T01:00:00Z",
        },
      ],
    });
    appendAskItem(
      item("q1", {
        status: "answered",
        answer: "답",
        sources: [SOURCE],
        messageId: MESSAGE_ID,
        visibility: "public",
        publicId: "pub123456789",
        publicStatus: "published",
      }),
    );
    render(<AskDetail id="q1" />);
    await waitFor(() => expect(readAskItem("q1")?.publicStatus).toBe("hidden"));
  });

  it("다른 기기에서 내려 서버에 없으면 비공개로 정리하고 다시 신청하지 않는다", async () => {
    currentUser = { id: "u1" };
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(publicQuestionsAPI.mine).mockResolvedValue({ items: [] });
    appendAskItem(
      item("q1", {
        status: "answered",
        answer: "답",
        sources: [SOURCE],
        messageId: MESSAGE_ID,
        visibility: "public",
        publicId: "pub123456789",
        publicStatus: "pending",
      }),
    );
    render(<AskDetail id="q1" />);
    await waitFor(() => expect(readAskItem("q1")?.visibility).toBe("private"));
    expect(readAskItem("q1")?.publicId).toBeUndefined();
    expect(publicQuestionsAPI.submit).not.toHaveBeenCalled();
  });

  it("근거가 0건이면 모델 카드·저장·공유 없이 다시 묻기만 두고, 공개를 골랐으면 이유를 알린다", () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "no-sources", answer: "", resolvedMode: "standard", visibility: "public" }));
    render(<AskDetail id="q1" />);
    expect(screen.queryByText("자동으로 골랐어요")).toBeNull();
    expect(screen.queryByRole("button", { name: "이 질문 저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: /공유/ })).toBeNull();
    expect(screen.getByRole("button", { name: /다시 묻기/ })).toBeInTheDocument();
    expect(screen.getByText("근거를 찾지 못한 답은 공개하지 않아요.")).toBeInTheDocument();
  });

  it("공개를 골랐지만 로그인이 풀렸으면 신청하지 않고 로그인 안내를 둔다", () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(
      item("q1", { status: "answered", answer: "답", sources: [SOURCE], messageId: MESSAGE_ID, visibility: "public" }),
    );
    render(<AskDetail id="q1" />);
    expect(screen.getByRole("link", { name: "로그인하고 공개하기" })).toBeInTheDocument();
    expect(publicQuestionsAPI.submit).not.toHaveBeenCalled();
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
    expect(screen.getByRole("link", { name: "나도 물어보기" })).toHaveAttribute("href", "/hoondok/ask/new");
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
    expect(href.startsWith("/hoondok/ask/new?q=")).toBe(true);
    expect(decodeURIComponent(href.split("q=")[1])).toBe(
      '"가정은 사랑을 배우는 첫 학교입니다."\n\n이 단락은 어떤 뜻인가요?',
    );
    const long = decodeURIComponent(passageAskHref("가".repeat(500)).split("q=")[1]);
    expect(long).toContain("…");
    expect(long.length).toBeLessThan(260);
  });
});
