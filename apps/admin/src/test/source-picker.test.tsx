// 요약의 말씀 범위 선택: 책을 다시 불러오는 도중이나 불러오기에 실패한 뒤 이전 책의 구간·원문이 남지 않는지 확인한다.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAPI = vi.fn();
vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  fetchAPI: (...args: unknown[]) => fetchAPI(...args),
}));

import { SourcePicker } from "@/features/hoondok/summaries/source-picker";

const BOOKS = [
  { id: "book-a", title: "말씀 A" },
  { id: "book-b", title: "말씀 B" },
];
const RANGE_A = {
  id: "range-a",
  content_right_id: "book-a",
  snapshot_id: "snap-a",
  start_block_id: "a-1",
  end_block_id: "a-1",
  title: "A의 구간",
  version: 1,
};

function snapshot(id: string) {
  return { id: `snap-${id}`, content_right_id: `book-${id}`, edition: "판", sections: [] };
}
function passages(id: string) {
  return { blocks: [{ id: `${id}-1`, position: 1, label: "1", text: `${id} 원문` }], next_offset: null };
}

type Handler = (url: string) => unknown;
let handler: Handler;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  handler = defaultHandler;
  fetchAPI.mockReset();
  fetchAPI.mockImplementation(async (url: string) => handler(url));
});

const RANGE_B = { ...RANGE_A, id: "range-b", content_right_id: "book-b", snapshot_id: "snap-b", title: "B의 구간" };

// 책 B 를 정상으로 돌려주는 응답. 나머지는 기본 응답을 쓴다.
function withBookB(url: string): unknown {
  if (url.includes("/source-books/book-b/snapshots")) return snapshot("b");
  if (url.includes("/source-snapshots/snap-b/passages")) return passages("b");
  if (url.includes("source-ranges?content_right_id=book-b")) return [RANGE_B];
  return defaultHandler(url);
}

function defaultHandler(url: string): unknown {
  if (url === "/admin/hoondok/source-books") return BOOKS;
  if (url.includes("/source-books/book-a/snapshots")) return snapshot("a");
  if (url.includes("/source-snapshots/snap-a/passages")) return passages("a");
  if (url.includes("source-ranges?content_right_id=book-a")) return [RANGE_A];
  throw new Error(`unexpected ${url}`);
}

// 리렌더해도 같은 캐시를 쓰도록 클라이언트는 테스트마다 하나만 둔다.
let client: QueryClient;
function wrapPicker(ui: ReactNode) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// 눌린 작업의 늦은 응답·정리가 모두 끝날 때까지 기다린다.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openWithBookA(onApply = vi.fn()) {
  handler = defaultHandler;
  render(wrapPicker(<SourcePicker onApply={onApply} />));
  fireEvent.click(screen.getByText("말씀 선택·변경"));
  await screen.findByRole("option", { name: "말씀 B" });
  fireEvent.change(screen.getByLabelText("말씀 책"), { target: { value: "book-a" } });
  await screen.findByText("A의 구간");
  return onApply;
}

describe("SourcePicker", () => {
  it("다른 책을 불러오지 못하면 이전 책의 구간을 사용할 수 없다", async () => {
    const onApply = await openWithBookA();
    handler = (url) => {
      if (url.includes("/source-books/book-b/snapshots")) throw new Error("원문을 불러올 수 없어요.");
      return defaultHandler(url);
    };

    fireEvent.change(screen.getByLabelText("말씀 책"), { target: { value: "book-b" } });

    await screen.findByRole("alert");
    expect(screen.queryByText("A의 구간")).toBeNull();
    expect(screen.queryByRole("button", { name: "사용" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("대화상자를 닫고 다른 책으로 다시 열면, 이전 책의 늦은 응답이 구간 목록을 채우지 않는다", async () => {
    // 새 요약: 작업 화면에서 책을 바꾸면 contentRightId 가 바뀐다. 이전 책 원문 조회는 늦게 끝난다.
    let releaseA: (value: unknown) => void = () => {};
    handler = (url) => {
      if (url.includes("/source-snapshots/snap-a/passages")) return new Promise((resolve) => (releaseA = resolve));
      if (url.includes("/source-books/book-b/snapshots")) throw new Error("원문을 불러올 수 없어요.");
      return defaultHandler(url);
    };
    const onApply = vi.fn();
    const { rerender } = render(wrapPicker(<SourcePicker contentRightId="book-a" onApply={onApply} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await waitFor(() => expect(fetchAPI).toHaveBeenCalledWith(expect.stringContaining("snap-a/passages")));

    fireEvent.click(screen.getByText("닫기"));
    rerender(wrapPicker(<SourcePicker contentRightId="book-b" onApply={onApply} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await screen.findByRole("alert");

    releaseA(passages("a"));
    await flush();

    expect(screen.queryByText("a 원문")).toBeNull();
    expect(screen.queryByText("A의 구간")).toBeNull();
    expect(screen.queryByRole("button", { name: "사용" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("버려진 이전 작업이 먼저 끝나도 새로 불러오는 중인 잠금은 풀리지 않는다", async () => {
    // 불러오는 중에 닫았다 다시 열면 같은 책을 한 번 더 불러온다 — 두 작업이 겹친다.
    const releases: Array<(value: unknown) => void> = [];
    handler = (url) => {
      if (url.includes("/source-books/book-a/snapshots")) return new Promise((resolve) => releases.push(resolve));
      return defaultHandler(url);
    };
    render(wrapPicker(<SourcePicker contentRightId="book-a" onApply={vi.fn()} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await waitFor(() => expect(releases).toHaveLength(1));
    fireEvent.click(screen.getByText("닫기"));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await waitFor(() => expect(releases).toHaveLength(2));

    releases[0](snapshot("a"));
    await flush();
    expect(screen.getByLabelText("말씀 책")).toBeDisabled();

    releases[1](snapshot("a"));
    await waitFor(() => expect(screen.getByLabelText("말씀 책")).not.toBeDisabled());
    expect(await screen.findByText("a 원문")).toBeInTheDocument();
    expect(screen.getByText("A의 구간")).toBeInTheDocument();
  });

  it("구간을 저장하는 동안에는 저장한 구간 제목도 누를 수 없다", async () => {
    await openWithBookA();
    let releaseSave: (value: unknown) => void = () => {};
    handler = (url) => {
      if (url === "/admin/hoondok/source-ranges") return new Promise((resolve) => (releaseSave = resolve));
      return defaultHandler(url);
    };
    fireEvent.click(await screen.findByText("a 원문"));
    fireEvent.change(screen.getByLabelText("구간 이름"), { target: { value: "새 구간" } });
    fireEvent.click(screen.getByText("구간 저장"));

    await waitFor(() => expect(screen.getByText("A의 구간").closest("button")).toBeDisabled());
    releaseSave({ ...RANGE_A, id: "range-new", title: "새 구간" });
    await waitFor(() => expect(screen.getByText("A의 구간").closest("button")).not.toBeDisabled());
  });

  it("버려진 이전 책 요청이 끝나지 않아도, 새 책을 다 불러오면 잠금이 풀린다", async () => {
    handler = (url) => {
      if (url.includes("/source-books/book-a/snapshots")) return new Promise(() => {});
      return withBookB(url);
    };
    const { rerender } = render(wrapPicker(<SourcePicker contentRightId="book-a" onApply={vi.fn()} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await waitFor(() => expect(screen.getByLabelText("말씀 책")).toBeDisabled());
    fireEvent.click(screen.getByText("닫기"));
    rerender(wrapPicker(<SourcePicker contentRightId="book-b" onApply={vi.fn()} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));

    expect(await screen.findByText("B의 구간")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("말씀 책")).not.toBeDisabled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("버려진 이전 책 요청이 실패해도 그 오류를 새 책 화면에 띄우지 않는다", async () => {
    let failA: (reason: unknown) => void = () => {};
    handler = (url) => {
      if (url.includes("/source-books/book-a/snapshots")) return new Promise((_, reject) => (failA = reject));
      return withBookB(url);
    };
    const { rerender } = render(wrapPicker(<SourcePicker contentRightId="book-a" onApply={vi.fn()} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    await waitFor(() => expect(screen.getByLabelText("말씀 책")).toBeDisabled());
    fireEvent.click(screen.getByText("닫기"));
    rerender(wrapPicker(<SourcePicker contentRightId="book-b" onApply={vi.fn()} />));
    fireEvent.click(screen.getByText("말씀 선택·변경"));
    expect(await screen.findByText("B의 구간")).toBeInTheDocument();

    failA(new Error("A 원문을 불러올 수 없어요."));
    await flush();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("B의 구간")).toBeInTheDocument();
  });
});
