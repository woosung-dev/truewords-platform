import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SCR-PWA-005·005b·006 AI 질문 (PLAN-HD-002 W2). 기기 저장소·SSE 어댑터·3화면.
const mockPush = vi.fn();
let queryParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/hoondok/ask",
  useSearchParams: () => ({ get: (key: string) => (key === "q" ? queryParam : null) }),
}));

import { HOONDOK_ASK_CHATBOT_ID, requestAsk } from "@/features/hoondok/ask/ask-stream";
import { linkCitations } from "@/features/hoondok/ask/components/answer-markdown";
import { AskDetail } from "@/features/hoondok/ask/components/ask-detail";
import { AskHome, askLogLinkLabel } from "@/features/hoondok/ask/components/ask-home";
import { AskLog } from "@/features/hoondok/ask/components/ask-log";
import {
  ASK_MAX,
  type AskItem,
  appendAskItem,
  readAskItem,
  readAskItems,
  toggleAskSaved,
} from "@/features/hoondok/ask/storage";

vi.mock("@/features/hoondok/library/api", () => ({
  libraryAPI: { list: vi.fn(async () => ({ items: [] })) },
  wordsHref: (volume: string) => `/hoondok/words/${encodeURIComponent(volume)}`,
}));
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

function sseBody(sources: unknown[]) {
  return [
    `event: chunk\ndata: ${JSON.stringify({ text: "정성은 " })}\n\n`,
    `event: chunk\ndata: ${JSON.stringify({ text: "기간을 정해 드리는 실천입니다." })}\n\n`,
    `event: sources\ndata: ${JSON.stringify({ sources, session_id: "s1", message_id: "m1" })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ disclaimer: "AI 설명은 참고용입니다" })}\n\n`,
  ].join("");
}

function lastRequestBody() {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body ?? "{}"));
}

beforeEach(() => {
  queryParam = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("질문 기록 저장소 (기기 전용)", () => {
  it("최신 질문이 앞에 쌓이고 상한 50건을 넘으면 오래된 것부터 버린다", () => {
    for (let index = 0; index < ASK_MAX + 3; index += 1) appendAskItem(item(`q${index}`));
    const items = readAskItems();
    expect(items).toHaveLength(ASK_MAX);
    expect(items[0].id).toBe(`q${ASK_MAX + 2}`);
    // 가장 오래된 3건은 사라진다
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
});

describe("AI 질문 어댑터 (/chat/stream)", () => {
  it("chunk 2개 → sources → done 을 모아 돌려주고, 요청에 session_id 를 싣지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    const result = await requestAsk("정성이 뭔가요?");

    expect(result.answer).toBe("정성은 기간을 정해 드리는 실천입니다.");
    expect(result.sources).toHaveLength(1);
    expect(result.disclaimer).toBe("AI 설명은 참고용입니다");

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/backend/chat/stream");
    expect(init?.method).toBe("POST");
    const body = lastRequestBody();
    // 무기억 — 세션을 이어붙이지 않는다. answer_mode 도 보내지 않아 기본 모드로 돈다.
    expect(body).toEqual({ query: "정성이 뭔가요?", chatbot_id: HOONDOK_ASK_CHATBOT_ID });
    expect("session_id" in body).toBe(false);
  });

  it("429 는 대기 안내 문구로 바뀐다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    await expect(requestAsk("질문")).rejects.toThrow("지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요");
  });

  it("sources 이벤트 없이 끊긴 응답은 실패로 끝난다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse('event: chunk\ndata: {"text":"일부"}\n\n')));
    await expect(requestAsk("질문")).rejects.toThrow("답을 받지 못했어요");
  });
});

describe("묻기 홈 (SCR-PWA-005)", () => {
  it("시작 문장을 탭하면 입력만 채우고 보내지 않는다", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<AskHome today={null} />);
    const starter = "정성을 드린다는 게 정확히 뭘 하는 건가요?";

    fireEvent.click(screen.getByRole("button", { name: starter }));

    expect(screen.getByLabelText("무엇이 궁금하세요?")).toHaveValue(starter);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(readAskItems()).toEqual([]);
  });

  it("빈 입력이면 물어보기가 잠기고, 제출하면 질문 1건을 남기고 상세로 이동한다", () => {
    render(<AskHome today={{ title: "참사랑은 직단거리를 갑니다", source: "천성경" }} />);
    const submit = screen.getByRole("button", { name: "물어보기" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("무엇이 궁금하세요?"), { target: { value: "  정성이 뭔가요?  " } });
    fireEvent.click(submit);

    const items = readAskItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ question: "정성이 뭔가요?", status: "pending" });
    expect(mockPush).toHaveBeenCalledWith(`/hoondok/ask/${items[0].id}`);
  });

  it("?q= 는 입력을 미리 채운다", () => {
    queryParam = "이 말씀의 배경이 궁금해요";
    render(<AskHome today={null} />);
    expect(screen.getByLabelText("무엇이 궁금하세요?")).toHaveValue("이 말씀의 배경이 궁금해요");
  });

  it("질문 기록 링크는 0 을 세지 않는다", () => {
    expect(askLogLinkLabel(0, 0)).toBe("질문 기록 보기");
    expect(askLogLinkLabel(3, 0)).toBe("내 질문 3개 보기");
    expect(askLogLinkLabel(3, 1)).toBe("내 질문 3개와 저장한 답 1개 보기");
    render(<AskHome today={null} />);
    expect(screen.getByRole("link", { name: "질문 기록 보기" })).toHaveAttribute("href", "/hoondok/ask/log");
  });
});

describe("질문 기록 (SCR-PWA-005b)", () => {
  it("세그먼트는 내 질문·저장한 답 수를 세고 식구들 질문은 준비 중이다", () => {
    appendAskItem(item("q1", { status: "answered", sources: [SOURCE] }));
    appendAskItem(item("q2", { status: "answered", sources: [SOURCE], isSaved: true }));
    render(<AskLog />);

    expect(screen.getByRole("tab", { name: /내 질문 2/ })).toHaveAttribute("aria-selected", "true");
    const saved = screen.getByRole("tab", { name: /저장한 답 1/ });
    expect(screen.getByRole("tab", { name: /식구들 질문/ })).toBeDisabled();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    fireEvent.click(saved);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("질문 q2")).toBeInTheDocument();
  });

  it("질문이 없으면 빈 상태와 묻기 홈 링크를 보인다", () => {
    render(<AskLog />);
    expect(screen.getByText("아직 질문이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "질문하러 가기" })).toHaveAttribute("href", "/hoondok/ask");
  });
});

describe("질문·답변 상세 (SCR-PWA-006)", () => {
  it("근거가 1건 이상이면 답과 근거 카드를 함께 보인다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sseBody([SOURCE]))));
    appendAskItem(item("q1", { question: "정성이 뭔가요?" }));
    render(<AskDetail id="q1" />);

    expect(await screen.findByText("정성은 기간을 정해 드리는 실천입니다.")).toBeInTheDocument();
    expect(screen.getByText("AI 설명 · 공식 해설 아님")).toBeInTheDocument();
    expect(screen.getByText(SOURCE.text)).toBeInTheDocument();
    expect(readAskItem("q1")?.status).toBe("answered");
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
    // 끝나지 않는 응답 — pending 을 붙잡아 둔다
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

  it("근거 카드 출처 줄은 모르는 칸을 '확인되지 않음' 으로 적고 정본 등급 배지를 쓰지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "answered", answer: "답 본문", sources: [SOURCE] }));
    const { container } = render(<AskDetail id="q1" />);

    expect(await screen.findByText(SOURCE.volume)).toBeInTheDocument();
    // 화자·판본·공식성은 /chat/stream 이 주지 않는다 — 생략이 아니라 결측으로 적는다 (REQ-PWA-012)
    expect(screen.getByText("판본 확인되지 않음")).toHaveClass("src__unknown");
    expect(screen.getByText("공식성 확인되지 않음")).toHaveClass("badge--dashed");
    // 초록 `badge--rank` 는 O1·O2 정본 전용이다
    expect(container.querySelector(".badge--rank")).toBeNull();
  });

  it("답 안의 근거 번호 [N] 은 근거 카드로 가는 위첨자 링크가 되고, 카드가 없는 번호는 지운다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const second = { ...SOURCE, volume: "천성경 2편", text: "정성은 하늘을 감동시킵니다." };
    appendAskItem(
      item("q1", {
        status: "answered",
        answer: "정성은 실천입니다 [1]. 함께 드립니다[2][7].",
        sources: [SOURCE, second],
      }),
    );
    const { container } = render(<AskDetail id="q1" />);

    const first = await screen.findByRole("link", { name: "근거 말씀 1" });
    expect(first).toHaveAttribute("href", "#ask-ev-1");
    expect(first.closest("sup")).toHaveClass("ask-ref");
    expect(screen.getByRole("link", { name: "근거 말씀 2" })).toHaveAttribute("href", "#ask-ev-2");
    // 근거 카드가 2장뿐이라 [7] 은 누를 곳이 없다 — 지운다. 대괄호 원문도 남지 않는다
    expect(screen.queryByRole("link", { name: "근거 말씀 7" })).toBeNull();
    expect(container.querySelector(".ai-note")?.textContent).not.toMatch(/\[\d\]/);
    // 답 끝에 번호만 늘어놓던 묶음은 없다
    expect(container.querySelectorAll(".ask-ref")).toHaveLength(2);

    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fireEvent.click(first);
    const card = container.querySelector("#ask-ev-1");
    expect(scrollIntoView.mock.contexts[0]).toBe(card);
    expect(card).toHaveFocus();
    expect(card).toHaveAttribute("data-flash");
  });

  it("근거 번호 바꾸기: 연달아 붙은 번호는 한 링크로 묶고 연도 같은 큰 숫자는 그대로 둔다", () => {
    expect(linkCitations("실천입니다 [1][2].", 3)).toBe("실천입니다[1,2](#ask-ev-1,2).");
    expect(linkCitations("실천입니다 [1, 3].", 3)).toBe("실천입니다[1,3](#ask-ev-1,3).");
    expect(linkCitations("없는 번호 [4].", 3)).toBe("없는 번호.");
    expect(linkCitations("1956년 [2018] 자료", 3)).toBe("1956년 [2018] 자료");
    // 마크다운 링크의 대괄호는 건드리지 않는다
    expect(linkCitations("[1](https://example.com)", 3)).toBe("[1](https://example.com)");
    // 근거 카드가 없는 화면(원문 뷰 AI 설명 탭)은 번호를 모두 지운다
    expect(linkCitations("실천입니다 [1].", 0)).toBe("실천입니다.");
  });

  it("답 상자 안에 서버 고지가 있으면 페이지 끝에 같은 고지를 반복하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    appendAskItem(item("q1", { status: "answered", answer: "답 본문", sources: [SOURCE], disclaimer: "참고용 고지" }));
    render(<AskDetail id="q1" />);
    expect(await screen.findByText("참고용 고지")).toBeInTheDocument();
    expect(screen.queryByText("AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다")).toBeNull();
    // 상자 라벨이 이 묶음의 제목이다 — 같은 말을 섹션 머리로 되풀이하지 않는다
    expect(screen.getByRole("heading", { name: "AI 설명 · 공식 해설 아님" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 설명" })).toBeNull();
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
});
