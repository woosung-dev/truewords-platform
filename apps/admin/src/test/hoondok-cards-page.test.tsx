import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HoondokCardsPage from "@/app/(dashboard)/hoondok/cards/page";
import { type CardAdminItem, cardsAPI } from "@/features/hoondok/cards-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/hoondok/cards-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/hoondok/cards-api")>();
  return { ...actual, cardsAPI: { list: vi.fn(), update: vi.fn(), today: vi.fn() } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

function card(overrides: Partial<CardAdminItem>): CardAdminItem {
  return {
    id: "c-draft",
    text: "초안 카드 본문",
    volume: "천성경.pdf",
    chunk_id: "chunk-1",
    chunk_index: 3,
    work_title: "천성경",
    source_label: "천성경 제1편 p.42",
    topic: null,
    status: "draft",
    pinned_on: null,
    created_at: "2026-09-28T00:00:00",
    ...overrides,
  };
}

const items = [card({}), card({ id: "c-active", text: "활성 카드 본문", status: "active", pinned_on: "2026-10-01" })];

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <HoondokCardsPage />
    </QueryClientProvider>,
  );
}

function row(text: string) {
  const tr = screen
    .getAllByText(text)
    .find((el) => el.closest("tr"))
    ?.closest("tr");
  if (!tr) throw new Error("row not found");
  return within(tr);
}

beforeEach(() => {
  vi.mocked(cardsAPI.list).mockReset().mockResolvedValue({ items, total: 120, page: 1, page_size: 50 });
  vi.mocked(cardsAPI.today).mockReset().mockResolvedValue({ date: "2026-09-28", card: items[1] });
  vi.mocked(cardsAPI.update).mockReset().mockResolvedValue(items[0]);
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("오늘의 책갈피 카드 풀", () => {
  it("목록·오늘 카드·원문 링크·페이지 수", async () => {
    show();
    await screen.findByText("초안 카드 본문");
    expect(row("초안 카드 본문").getByText("초안")).toBeInTheDocument();
    expect(row("활성 카드 본문").getByText("2026-10-01")).toBeInTheDocument();
    const link = row("초안 카드 본문").getByRole("link", { name: /천성경 제1편 p\.42/ });
    expect(link.getAttribute("href")).toMatch(/\/hoondok\/words\/.+\?chunk_id=chunk-1$/);
    const today = screen.getByRole("region", { name: "오늘 나가는 카드" });
    expect(await within(today).findByText("활성 카드 본문")).toBeInTheDocument();
    expect(screen.getByText("총 120장 · 1 / 3쪽")).toBeInTheDocument();
  });

  it("상태 필터를 바꾸면 1쪽부터 그 상태로 다시 읽는다", async () => {
    show();
    await screen.findByText("초안 카드 본문");
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(cardsAPI.list).toHaveBeenLastCalledWith(null, 2));
    const filters = within(screen.getByRole("group", { name: "상태 필터" }));
    fireEvent.click(filters.getByRole("button", { name: "중지" }));
    await waitFor(() => expect(cardsAPI.list).toHaveBeenLastCalledWith("retired", 1));
  });

  it("활성화·중지는 status 만 PATCH 한다", async () => {
    show();
    await screen.findByText("초안 카드 본문");
    fireEvent.click(row("초안 카드 본문").getByRole("button", { name: "활성화" }));
    await waitFor(() => expect(cardsAPI.update).toHaveBeenCalledWith("c-draft", { status: "active" }));
    fireEvent.click(row("활성 카드 본문").getByRole("button", { name: "중지" }));
    await waitFor(() => expect(cardsAPI.update).toHaveBeenCalledWith("c-active", { status: "retired" }));
  });

  it("날짜 고정 409 는 충돌 문구, 해제는 pinned_on:null", async () => {
    vi.mocked(cardsAPI.update).mockRejectedValueOnce(new ApiError(409, { message: "서버 문구" }));
    show();
    await screen.findByText("초안 카드 본문");
    fireEvent.click(row("초안 카드 본문").getByRole("button", { name: "고정" }));
    fireEvent.change(row("초안 카드 본문").getByLabelText("고정할 날짜"), { target: { value: "2026-10-01" } });
    fireEvent.click(row("초안 카드 본문").getByRole("button", { name: "저장" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("그 날짜에 이미 고정된 카드가 있어요"));
    expect(cardsAPI.update).toHaveBeenCalledWith("c-draft", { pinned_on: "2026-10-01" });

    fireEvent.click(row("활성 카드 본문").getByRole("button", { name: "해제" }));
    await waitFor(() => expect(cardsAPI.update).toHaveBeenCalledWith("c-active", { pinned_on: null }));
  });

  it("선택한 카드를 한 번에 활성화한다 — 활성 카드는 고를 수 없다", async () => {
    show();
    await screen.findByText("초안 카드 본문");
    expect(row("활성 카드 본문").getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row("초안 카드 본문").getByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: "선택한 1장 활성화" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1장을 활성화했습니다"));
    expect(cardsAPI.update).toHaveBeenCalledWith("c-draft", { status: "active" });
  });

  it("오늘 카드가 없으면 안내", async () => {
    vi.mocked(cardsAPI.today).mockResolvedValue({ date: "2026-09-28", card: null });
    show();
    expect(await screen.findByText("활성 카드가 없어 오늘은 나갈 카드가 없어요.")).toBeInTheDocument();
  });
});
