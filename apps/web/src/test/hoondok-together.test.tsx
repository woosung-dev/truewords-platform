import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatKstDate } from "@/features/hoondok/today";
import { TogetherCard, TogetherDoneNotice } from "@/features/hoondok/together/components/together-card";

// 함께 읽는 사람들 1단계 (PLAN-HD-009, API-HD-029). fetch 만 바꿔 끼워 실제 API 경로로 검증한다.
const fetchMock = vi.fn<typeof fetch>();
const TODAY = formatKstDate().iso;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function respond(make: () => Response) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/hoondok/today/together")) return make();
    return json({ detail: "not found" }, 404);
  });
}
const shown = (count: number) => () => json({ date: TODAY, count, is_shown: true, threshold: 10 });
const hidden = () => json({ date: TODAY, count: null, is_shown: false, threshold: 10 });

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TogetherCard (홈)", () => {
  it("읽기 전 · 기준 이상: 숫자와 읽으러 가는 버튼", async () => {
    respond(shown(1284));
    render(wrap(<TogetherCard readState="todo" readHref="/read" />));
    expect(screen.getByRole("heading", { name: "함께 읽는 사람들" })).toBeInTheDocument();
    expect(screen.getByTestId("together-skeleton")).toBeInTheDocument();
    expect(await screen.findByText("오늘 1,284명이 훈독했어요")).toBeInTheDocument();
    expect(screen.getByText("누가 읽었는지는 보이지 않아요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 말씀 읽으러 가기" })).toHaveAttribute("href", "/read");
    expect(screen.queryByTestId("together-skeleton")).toBeNull();
    // 숫자는 읽은 말씀과 상관없이 오늘 훈독한 사람 수라 "같은 말씀" 이라고 쓰지 않는다
    expect(screen.queryByText(/같은 말씀/)).toBeNull();
    expect(screen.queryByText(/새벽/)).toBeNull();
  });

  it("읽기 전 · 기준 미만: 숫자 없이 현재형 문장과 버튼", async () => {
    respond(hidden);
    render(wrap(<TogetherCard readState="todo" readHref="/read" />));
    expect(await screen.findByText("오늘도 식구들이 훈독하고 있어요")).toBeInTheDocument();
    expect(screen.queryByText(/\d+명/)).toBeNull();
    expect(screen.getByRole("link", { name: "오늘 말씀 읽으러 가기" })).toBeInTheDocument();
  });

  it("읽기 전이라도 읽을 곳이 따로 있으면(정성 중) 버튼을 그리지 않는다", async () => {
    respond(shown(12));
    render(wrap(<TogetherCard readState="todo" readHref={null} />));
    await screen.findByText("오늘 12명이 훈독했어요");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("서버에 기록된 뒤: 완료 표시 · 버튼 없음", async () => {
    respond(shown(24));
    const { container } = render(wrap(<TogetherCard readState="done" readHref="/read" />));
    expect(await screen.findByText("오늘 24명이 함께 훈독했어요")).toBeInTheDocument();
    expect(container.querySelector(".together")).toHaveAttribute("data-done");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("이 기기에만 완료(집계 밖)면 숫자를 본인과 엮지 않는다", async () => {
    respond(shown(24));
    render(wrap(<TogetherCard readState="done-local" readHref="/read" />));
    expect(await screen.findByText("오늘 식구들과 함께 훈독했어요")).toBeInTheDocument();
    expect(screen.queryByText(/\d+명/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("내 훈독 여부를 확인하는 동안은 자리만 지킨다(버튼이 떴다 사라지지 않게)", async () => {
    respond(shown(24));
    render(wrap(<TogetherCard readState="unknown" readHref="/read" />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("together-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("오류면 카드를 그리지 않는다", async () => {
    respond(() => json({ detail: "boom" }, 500));
    const { container } = render(wrap(<TogetherCard readState="todo" readHref="/read" />));
    await waitFor(() => expect(container).toBeEmptyDOMElement(), { timeout: 4000 }); // 훅의 retry 1회(1초) 뒤
    expect(screen.queryByText("함께 읽는 사람들")).toBeNull();
  });

  it("미완료자·모임을 그리지 않는다", async () => {
    respond(shown(12));
    render(wrap(<TogetherCard readState="done" readHref={null} />));
    await screen.findByText("오늘 12명이 함께 훈독했어요");
    expect(screen.queryByText(/아직/)).toBeNull();
    expect(screen.queryByText(/모임/)).toBeNull();
  });
});

describe("TogetherDoneNotice (훈독하기 완료 뒤)", () => {
  it("기록된 완료 + 기준 이상이면 '당신까지 N명'", async () => {
    respond(shown(1285));
    render(wrap(<TogetherDoneNotice isCounted />));
    const line = await screen.findByText(/당신까지/);
    expect(line).toHaveTextContent("당신까지 1,285명이 함께 읽었어요");
  });

  it("기준 미만이면 대체 문구", async () => {
    respond(hidden);
    render(wrap(<TogetherDoneNotice isCounted />));
    expect(await screen.findByText("오늘도 식구들과 함께 읽었어요")).toBeInTheDocument();
    expect(screen.queryByText(/당신까지/)).toBeNull();
  });

  it("집계에 없는 완료(비로그인·저장 실패)는 숫자가 있어도 '당신까지' 를 쓰지 않는다", async () => {
    respond(shown(40));
    render(wrap(<TogetherDoneNotice isCounted={false} />));
    expect(await screen.findByText("오늘도 식구들과 함께 읽었어요")).toBeInTheDocument();
    expect(screen.queryByText(/당신까지/)).toBeNull();
  });

  it("오류면 한 줄을 그리지 않는다", async () => {
    respond(() => json({ detail: "boom" }, 503));
    const { container } = render(wrap(<TogetherDoneNotice isCounted />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement(), { timeout: 4000 }); // 훅의 retry 1회(1초) 뒤
  });
});
