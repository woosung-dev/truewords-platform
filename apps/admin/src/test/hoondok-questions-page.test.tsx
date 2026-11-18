import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HoondokQuestionsPage from "@/app/(dashboard)/hoondok/questions/page";
import { type PublicQuestionAdminItem, questionsAPI } from "@/features/hoondok/questions-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/hoondok/questions-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/hoondok/questions-api")>();
  return { ...actual, questionsAPI: { list: vi.fn(), pins: vi.fn(), reorderPins: vi.fn(), update: vi.fn(), review: vi.fn() } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

function question(overrides: Partial<PublicQuestionAdminItem>): PublicQuestionAdminItem {
  return {
    id: "q-pending",
    question: "가족과 자주 다투는데 말씀에서는?",
    answer_md: "**참사랑**은 먼저 주는 사랑입니다.",
    sources: [
      { source: "B", volume: "천성경", text: "참사랑은 주고 잊어버리는 사랑" },
      { source: "B", volume: "평화경", text: "가정은 사랑의 학교" },
    ],
    answer_mode: "standard",
    status: "pending",
    // 2026-11-02T16:00Z = KST 11/03
    created_at: "2026-11-02T16:00:00Z",
    reviewed_at: null,
    view_count: 0,
    ask_count: 0,
    score: 0,
    pin_order: null,
    ...overrides,
  };
}

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <HoondokQuestionsPage />
    </QueryClientProvider>,
  );
}

function row(text: string) {
  const tr = within(screen.getByRole("table")).getByText(text).closest("tr");
  if (!tr) throw new Error("row not found");
  return within(tr);
}

beforeEach(() => {
  vi.mocked(questionsAPI.list)
    .mockReset()
    .mockResolvedValue({ items: [question({})], total: 1, page: 1, page_size: 50 });
  vi.mocked(questionsAPI.pins).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(questionsAPI.reorderPins).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(questionsAPI.update)
    .mockReset()
    .mockResolvedValue(question({ status: "published" }));
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("추천 질문 고르기", () => {
  it("후보 목록을 신청일(KST)·답한 모델·조회·나도 물어보기·점수와 함께 보여 준다", async () => {
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [question({ view_count: 1200, ask_count: 4, score: 1212 })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(questionsAPI.list).toHaveBeenCalledWith({ status: "pending", sort: "oldest", q: "", page: 1 });
    const r = row("가족과 자주 다투는데 말씀에서는?");
    expect(r.getByText("2026-11-03")).toBeInTheDocument();
    expect(r.getByText("말씀 길잡이")).toBeInTheDocument();
    expect(r.getByText("1,200")).toHaveClass("tabular-nums", "text-right");
    expect(r.getByText("4")).toBeInTheDocument();
    expect(r.getByText("1,212")).toHaveClass("font-medium", "text-right");
    expect(r.getByText("후보")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "추천하기" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "추천에서 빼기" })).toBeInTheDocument();
  });

  it("화면 이름과 상태 필터를 추천 문구로 보여 준다", async () => {
    show();
    expect(screen.getByRole("heading", { name: "추천 질문 고르기" })).toBeInTheDocument();
    const filters = within(screen.getByRole("group", { name: "상태 필터" }));
    expect(filters.getByRole("button", { name: "후보", pressed: true })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "추천 중" })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "추천 안 함" })).toBeInTheDocument();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
  });

  it("질문을 누르면 답과 근거를 펼친다", async () => {
    show();
    const toggle = await screen.findByRole("button", { name: /가족과 자주 다투는데/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const preview = screen.getByRole("region", { name: "답 미리보기" });
    expect(within(preview).getByText("참사랑", { selector: "strong" })).toBeInTheDocument();
    expect(within(preview).queryByText(/\*\*/)).toBeNull();
    expect(within(preview).getByText("근거 2건")).toBeInTheDocument();
    expect(within(preview).getByText("평화경")).toBeInTheDocument();
  });

  it("상태 필터를 바꾸면 1쪽부터 그 상태로 다시 읽는다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(screen.getByRole("button", { name: "추천 안 함", pressed: false }));
    await waitFor(() => expect(questionsAPI.list).toHaveBeenLastCalledWith({ status: "hidden", sort: "oldest", q: "", page: 1 }));
  });

  it("추천하기를 누르면 published 로 PATCH 후 목록을 다시 읽는다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(row("가족과 자주 다투는데 말씀에서는?").getByRole("button", { name: "추천하기" }));
    await waitFor(() => expect(questionsAPI.update).toHaveBeenCalledWith("q-pending", { status: "published" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("추천했습니다"));
    await waitFor(() => expect(questionsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("추천 중인 질문에는 빼기만, 추천 안 함 질문에는 추천하기만 있다", async () => {
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [
        question({ id: "q-pub", question: "추천 중인 질문", status: "published" }),
        question({ id: "q-hid", question: "빼 둔 질문", status: "hidden" }),
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });
    show();
    await screen.findByText("추천 중인 질문");
    const pub = row("추천 중인 질문");
    expect(pub.getByText("추천 중")).toBeInTheDocument();
    expect(pub.queryByRole("button", { name: "추천하기" })).toBeNull();
    expect(pub.getByRole("button", { name: "추천에서 빼기" })).toBeInTheDocument();
    const hid = row("빼 둔 질문");
    expect(hid.getByText("추천 안 함")).toBeInTheDocument();
    expect(hid.getByRole("button", { name: "추천하기" })).toBeInTheDocument();
    expect(hid.queryByRole("button", { name: "추천에서 빼기" })).toBeNull();
  });

  it("답 미리보기는 제목 줄을 굵은 줄로, 나머지 기호는 원문대로 보여 준다", async () => {
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [question({ answer_md: "### 짧게 말하면\n먼저 **사랑**하세요.\n\n- 기도하기" })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /가족과 자주 다투는데/ }));
    const preview = within(screen.getByRole("region", { name: "답 미리보기" }));
    expect(preview.getByText("짧게 말하면")).toHaveClass("font-semibold");
    expect(preview.queryByText(/###/)).toBeNull();
    expect(preview.getByText("사랑", { selector: "strong" })).toBeInTheDocument();
    expect(preview.getByText("- 기도하기")).toBeInTheDocument();
  });

  it("이미 없어진 질문이면 안내하고 목록을 새로 고친다", async () => {
    vi.mocked(questionsAPI.update).mockRejectedValue(new ApiError(404, { message: "Not Found" }));
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(row("가족과 자주 다투는데 말씀에서는?").getByRole("button", { name: "추천에서 빼기" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(questionsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("뒤쪽 쪽의 마지막 항목을 처리해 그 쪽이 비면 앞쪽으로 옮긴다", async () => {
    vi.mocked(questionsAPI.list).mockImplementation(async ({ page }) =>
      page === 2
        ? { items: [question({ id: "q-last", question: "마지막 질문" })], total: 51, page: 2, page_size: 50 }
        : { items: [question({})], total: 51, page: 1, page_size: 50 },
    );
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(screen.getByRole("button", { name: /다음/ }));
    await screen.findByText("마지막 질문");

    // 추천 뒤 다시 읽으면 2쪽이 비어 있다
    vi.mocked(questionsAPI.list).mockImplementation(async ({ page }) =>
      page === 2
        ? { items: [], total: 50, page: 2, page_size: 50 }
        : { items: [question({})], total: 50, page: 1, page_size: 50 },
    );
    fireEvent.click(row("마지막 질문").getByRole("button", { name: "추천하기" }));
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(questionsAPI.list).toHaveBeenLastCalledWith({ status: "pending", sort: "oldest", q: "", page: 1 });
  });

  it("후보 행에는 고정 버튼이 없다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(within(screen.getByRole("table")).queryByRole("button", { name: /고정/ })).toBeNull();
  });
});

const pinned = (n: number, overrides: Partial<PublicQuestionAdminItem> = {}) =>
  question({ id: `p${n}`, question: `고정 질문 ${n}`, status: "published", pin_order: n, view_count: 10 * n, ask_count: n, ...overrides });

describe("상단 고정", () => {
  const three = () => [pinned(1), pinned(2), pinned(3)];

  it("고정 카드가 순서대로 n/10 과 함께 보이고 처음·끝 이동 버튼은 비활성이다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: three() });
    show();
    const card = within(await screen.findByRole("region", { name: /추천 상단 고정/ }));
    await card.findByText("고정 질문 1");
    expect(card.getByText("3/10")).toBeInTheDocument();
    const items = card.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("고정 질문 1"),
      expect.stringContaining("고정 질문 2"),
      expect.stringContaining("고정 질문 3"),
    ]);
    expect(card.getByRole("button", { name: "1번 '고정 질문 1' 위로 이동" })).toBeDisabled();
    expect(card.getByRole("button", { name: "3번 '고정 질문 3' 아래로 이동" })).toBeDisabled();
    expect(card.getByRole("button", { name: "2번 '고정 질문 2' 위로 이동" })).toBeEnabled();
  });

  it("고정이 없으면 다음 행동을 알려 주는 빈 상태를 보인다", async () => {
    show();
    expect(await screen.findByText(/고정한 질문이 없어요/)).toBeInTheDocument();
    expect(screen.getByText("0/10")).toBeInTheDocument();
  });

  it("아래로 이동하면 바뀐 id 순서로 저장하고 live 영역에 알린다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: three() });
    vi.mocked(questionsAPI.reorderPins).mockResolvedValue({ items: [pinned(2), pinned(1), pinned(3)] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "1번 '고정 질문 1' 아래로 이동" }));
    await waitFor(() => expect(questionsAPI.reorderPins).toHaveBeenCalledWith(["p2", "p1", "p3"]));
    await waitFor(() => expect(screen.getByText("'고정 질문 1'을 2번째로 옮겼습니다")).toBeInTheDocument());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("위로 이동은 앞 항목과 자리를 바꾼다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: three() });
    vi.mocked(questionsAPI.reorderPins).mockResolvedValue({ items: [pinned(1), pinned(3), pinned(2)] });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "3번 '고정 질문 3' 위로 이동" }));
    await waitFor(() => expect(questionsAPI.reorderPins).toHaveBeenCalledWith(["p1", "p3", "p2"]));
  });

  it("순서 저장이 실패하면 원래 순서로 되돌리고 알린다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: three() });
    vi.mocked(questionsAPI.reorderPins).mockRejectedValue(new ApiError(422, { message: "x" }));
    show();
    const card = within(await screen.findByRole("region", { name: /추천 상단 고정/ }));
    fireEvent.click(await card.findByRole("button", { name: "1번 '고정 질문 1' 아래로 이동" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("순서를 바꾸지 못했습니다. 원래 순서로 돌렸습니다"),
    );
    await waitFor(() =>
      expect(card.getAllByRole("listitem")[0].textContent).toContain("고정 질문 1"),
    );
  });

  it("해제하면 pinned=false 로 보내고 고정 목록과 표를 다시 읽는다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: three() });
    show();
    const card = within(await screen.findByRole("region", { name: /추천 상단 고정/ }));
    fireEvent.click(await card.findByRole("button", { name: "'고정 질문 2' 고정 해제" }));
    await waitFor(() => expect(questionsAPI.update).toHaveBeenCalledWith("p2", { pinned: false }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("고정을 풀었습니다"));
    await waitFor(() => expect(questionsAPI.pins).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(questionsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("추천 중인 미고정 행에만 고정 버튼이 있고 누르면 n/10 을 알린다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({ items: [pinned(1)] });
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [
        question({ id: "c", question: "후보 질문", status: "pending" }),
        question({ id: "u", question: "추천 중 미고정", status: "published" }),
        pinned(1),
      ],
      total: 3,
      page: 1,
      page_size: 50,
    });
    show();
    await screen.findByText("추천 중 미고정");
    expect(row("후보 질문").queryByRole("button", { name: /고정/ })).toBeNull();
    expect(row("고정 질문 1").getByText("고정 1번")).toBeInTheDocument();
    expect(row("고정 질문 1").getByRole("button", { name: "고정 해제" })).toBeInTheDocument();
    fireEvent.click(row("추천 중 미고정").getByRole("button", { name: /상단 고정/ }));
    await waitFor(() => expect(questionsAPI.update).toHaveBeenCalledWith("u", { pinned: true }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("상단에 고정했습니다 (2/10)"));
  });

  it("10개가 차면 고정 버튼이 비활성이고 이유가 연결된다", async () => {
    vi.mocked(questionsAPI.pins).mockResolvedValue({
      items: Array.from({ length: 10 }, (_, i) => pinned(i + 1)),
    });
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [question({ id: "u", question: "추천 중 미고정", status: "published" })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    show();
    const btn = await waitFor(() => {
      const b = row("추천 중 미고정").getByRole("button", { name: /상단 고정/ });
      expect(b).toBeDisabled();
      return b;
    });
    expect(screen.getByText("가득 참")).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-describedby", "pin-limit-note");
    expect(document.getElementById("pin-limit-note")).toHaveTextContent("상단 고정은 10개까지예요");
  });

  it("고정이 409(한도)로 거절되면 한도 안내 토스트를 띄운다", async () => {
    vi.mocked(questionsAPI.update).mockRejectedValue(new ApiError(409, { message: "limit" }));
    vi.mocked(questionsAPI.list).mockResolvedValue({
      items: [question({ id: "u", question: "추천 중 미고정", status: "published" })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    show();
    await screen.findByText("추천 중 미고정");
    fireEvent.click(row("추천 중 미고정").getByRole("button", { name: /상단 고정/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("상단 고정은 10개까지예요. 하나를 해제하고 다시 시도해 주세요."),
    );
  });

  it("고정된 질문을 추천에서 빼면 고정도 풀렸다고 알린다", async () => {
    vi.mocked(questionsAPI.list).mockResolvedValue({ items: [pinned(1)], total: 1, page: 1, page_size: 50 });
    show();
    await screen.findByText("고정 질문 1");
    fireEvent.click(row("고정 질문 1").getByRole("button", { name: "추천에서 빼기" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("추천에서 뺐습니다. 상단 고정도 풀렸습니다"));
  });
});

describe("정렬·검색", () => {
  it("정렬을 바꾸면 sort 와 1쪽으로 다시 읽고 aria-sort 가 따라간다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(screen.getByRole("columnheader", { name: "신청일" })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "popular" } });
    await waitFor(() =>
      expect(questionsAPI.list).toHaveBeenLastCalledWith({ status: "pending", sort: "popular", q: "", page: 1 }),
    );
    expect(screen.getByRole("columnheader", { name: "점수" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText("점수 = 조회 + 나도 물어보기 × 3")).toBeInTheDocument();
  });

  it("검색어는 디바운스 뒤 q 로 보내고, 결과가 없으면 검색 지우기를 보인다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    vi.mocked(questionsAPI.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 });
    fireEvent.change(screen.getByLabelText("질문 검색"), { target: { value: "사랑" } });
    // 디바운스 전에는 다시 읽지 않는다
    expect(questionsAPI.list).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(questionsAPI.list).toHaveBeenLastCalledWith({ status: "pending", sort: "oldest", q: "사랑", page: 1 }),
    );
    expect(await screen.findByText("'사랑'와 맞는 질문이 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "검색 지우기" }));
    await waitFor(() =>
      expect(questionsAPI.list).toHaveBeenLastCalledWith({ status: "pending", sort: "oldest", q: "", page: 1 }),
    );
    expect(screen.getByLabelText("질문 검색")).toHaveValue("");
  });
});
