import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatbotForm } from "@/features/chatbot/components/chatbot-form";

// SearchTierEditor 가 의존하는 hook mock (기존 test 패턴)
vi.mock("@/features/data-source/hooks", () => ({
  useSearchableCategories: () => ({
    data: [
      { key: "A", name: "말씀선집", color: "indigo", is_searchable: true },
    ],
    isLoading: false,
  }),
}));

const baseProps = {
  onSubmit: vi.fn(),
  isSubmitting: false,
  submitLabel: "생성",
  submitPendingLabel: "생성 중...",
  cancelLabel: "취소",
  onCancel: vi.fn(),
};

describe("ChatbotForm", () => {
  it("create 모드에서 Chatbot ID 필드가 렌더된다", () => {
    render(<ChatbotForm mode="create" {...baseProps} />);
    expect(screen.getByLabelText(/Chatbot ID/)).toBeInTheDocument();
  });

  it("edit 모드에서 Chatbot ID 필드가 렌더되지 않는다", () => {
    render(<ChatbotForm mode="edit" {...baseProps} />);
    expect(screen.queryByLabelText(/Chatbot ID/)).not.toBeInTheDocument();
  });

  it("edit 모드에서 initialValues 의 display_name 이 반영된다", () => {
    render(
      <ChatbotForm
        mode="edit"
        initialValues={{ display_name: "기존챗봇" }}
        {...baseProps}
      />,
    );
    const input = screen.getByLabelText(/표시 이름/) as HTMLInputElement;
    expect(input.value).toBe("기존챗봇");
  });

  it("create 모드 submit 시 onSubmit 이 입력값과 함께 호출된다", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <ChatbotForm mode="create" {...baseProps} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/Chatbot ID/), {
      target: { value: "test_bot" },
    });
    fireEvent.change(screen.getByLabelText(/표시 이름/), {
      target: { value: "테스트 챗봇" },
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbot_id: "test_bot",
        display_name: "테스트 챗봇",
        is_active: true,
        search_tiers: expect.objectContaining({
          search_mode: "cascading",
          tiers: [],
          weighted_sources: [],
          dictionary_enabled: false,
          query_rewrite_enabled: false,
        }),
      }),
    );
  });

  it("isSubmitting=true 이면 submit 버튼이 비활성화되고 pending 라벨이 노출된다", () => {
    render(<ChatbotForm mode="create" {...baseProps} isSubmitting={true} />);
    const submitBtn = screen.getByRole("button", { name: "생성 중..." });
    expect(submitBtn).toBeDisabled();
  });

  it("취소 버튼 클릭 시 onCancel 이 호출된다", () => {
    const onCancel = vi.fn();
    render(<ChatbotForm mode="create" {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
