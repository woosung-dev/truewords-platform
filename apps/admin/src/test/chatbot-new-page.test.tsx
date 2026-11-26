// 새 챗봇 만들기: 409는 중복 안내로 보이고, 생성 뒤에는 목록 캐시를 무효화하는지 확인한다.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (msg: string) => toastError(msg) } }));

const mockCreate = vi.fn();
vi.mock("@/features/chatbot/api", () => ({
  chatbotAPI: { create: (...args: unknown[]) => mockCreate(...args) },
}));

// 폼 입력 검증은 chatbot-form 테스트가 맡는다. 여기서는 제출 이후 처리만 본다.
vi.mock("@/features/chatbot/components/chatbot-form", () => ({
  ChatbotForm: ({ onSubmit }: { onSubmit: (values: unknown) => Promise<unknown> }) => (
    <button type="button" onClick={() => onSubmit({ chatbot_id: "dup" }).catch(() => {})}>
      생성
    </button>
  ),
}));

import NewChatbotPage from "@/app/(dashboard)/chatbots/new/page";
import { ApiError } from "@/lib/api";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <NewChatbotPage />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => vi.clearAllMocks());

describe("새 챗봇 만들기", () => {
  it("409 응답이면 중복 chatbot_id 안내를 보인다", async () => {
    // 서버 409 응답의 detail 이 메시지가 된다. 메시지에는 상태 숫자가 들어 있지 않다.
    mockCreate.mockRejectedValue(new ApiError(409, { message: "chatbot_id 'dup' 이미 존재합니다" }));
    renderPage();

    fireEvent.click(screen.getByText("생성"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("이미 존재하는 chatbot_id입니다"));
  });

  it("네트워크 실패면 연결 안내를 보인다", async () => {
    mockCreate.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();

    fireEvent.click(screen.getByText("생성"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("서버에 연결할 수 없습니다"));
  });

  it("생성에 성공하면 챗봇 목록 캐시를 무효화하고 편집 화면으로 이동한다", async () => {
    mockCreate.mockResolvedValue({ id: "cfg-9" });
    const { invalidate } = renderPage();

    fireEvent.click(screen.getByText("생성"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/chatbots/cfg-9/edit"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chatbots"] });
  });
});
