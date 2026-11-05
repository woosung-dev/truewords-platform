import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HoondokQuestionsPage from "@/app/(dashboard)/hoondok/questions/page";
import { type PublicQuestionAdminItem, questionsAPI } from "@/features/hoondok/questions-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/hoondok/questions-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/hoondok/questions-api")>();
  return { ...actual, questionsAPI: { list: vi.fn(), review: vi.fn() } };
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
  const tr = screen.getByText(text).closest("tr");
  if (!tr) throw new Error("row not found");
  return within(tr);
}

beforeEach(() => {
  vi.mocked(questionsAPI.list)
    .mockReset()
    .mockResolvedValue({ items: [question({})], total: 1, page: 1, page_size: 50 });
  vi.mocked(questionsAPI.review)
    .mockReset()
    .mockResolvedValue(question({ status: "published" }));
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("추천 질문 고르기", () => {
  it("후보 목록을 신청일(KST)·답변 모델·근거 수와 함께 보여 준다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(questionsAPI.list).toHaveBeenCalledWith("pending", 1);
    const r = row("가족과 자주 다투는데 말씀에서는?");
    expect(r.getByText("2026-11-03")).toBeInTheDocument();
    expect(r.getByText("말씀 길잡이")).toBeInTheDocument();
    expect(r.getByText("2")).toBeInTheDocument();
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
    await waitFor(() => expect(questionsAPI.list).toHaveBeenLastCalledWith("hidden", 1));
  });

  it("추천하기를 누르면 published 로 PATCH 후 목록을 다시 읽는다", async () => {
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(row("가족과 자주 다투는데 말씀에서는?").getByRole("button", { name: "추천하기" }));
    await waitFor(() => expect(questionsAPI.review).toHaveBeenCalledWith("q-pending", "published"));
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
    vi.mocked(questionsAPI.review).mockRejectedValue(new ApiError(404, { message: "Not Found" }));
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(row("가족과 자주 다투는데 말씀에서는?").getByRole("button", { name: "추천에서 빼기" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(questionsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("뒤쪽 쪽의 마지막 항목을 처리해 그 쪽이 비면 앞쪽으로 옮긴다", async () => {
    vi.mocked(questionsAPI.list).mockImplementation(async (_status, page) =>
      page === 2
        ? { items: [question({ id: "q-last", question: "마지막 질문" })], total: 51, page: 2, page_size: 50 }
        : { items: [question({})], total: 51, page: 1, page_size: 50 },
    );
    show();
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    fireEvent.click(screen.getByRole("button", { name: /다음/ }));
    await screen.findByText("마지막 질문");

    // 추천 뒤 다시 읽으면 2쪽이 비어 있다
    vi.mocked(questionsAPI.list).mockImplementation(async (_status, page) =>
      page === 2
        ? { items: [], total: 50, page: 2, page_size: 50 }
        : { items: [question({})], total: 50, page: 1, page_size: 50 },
    );
    fireEvent.click(row("마지막 질문").getByRole("button", { name: "추천하기" }));
    await screen.findByText("가족과 자주 다투는데 말씀에서는?");
    expect(questionsAPI.list).toHaveBeenLastCalledWith("pending", 1);
  });
});
