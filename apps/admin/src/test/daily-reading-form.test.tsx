import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyReadingForm } from "@/features/hoondok/components/daily-reading-form";
import { emptyValues } from "@/features/hoondok/form";

const baseProps = {
  onSubmit: vi.fn(),
  isSubmitting: false,
  submitLabel: "등록",
  submitPendingLabel: "등록 중...",
  cancelLabel: "취소",
  onCancel: vi.fn(),
};

const LABELS = [
  /편성일/,
  /예상 읽기 시간/,
  /^제목/,
  /^본문/,
  /^화자/,
  /원문 날짜/,
  /^저작물/,
  /^판본/,
  /출처 메모/,
  /chunk id/,
  /공식성 등급/,
  /검수 상태/,
];

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: "테스트 제목" } });
  fireEvent.change(screen.getByLabelText(/^본문/), { target: { value: "본문입니다" } });
  fireEvent.change(screen.getByLabelText(/^화자/), { target: { value: "참어머님" } });
  fireEvent.change(screen.getByLabelText(/^저작물/), { target: { value: "말씀 모음" } });
}

describe("DailyReadingForm", () => {
  it("ENT-HD-002 필드 12개가 라벨과 함께 렌더된다", () => {
    render(<DailyReadingForm mode="create" {...baseProps} />);
    for (const label of LABELS) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText(/공식성 등급/).tagName).toBe("SELECT");
    expect(screen.getByLabelText(/^본문/).tagName).toBe("TEXTAREA");
  });

  it("initialValues 의 날짜가 프리필되고 기본값은 R·unverified·3분", () => {
    render(<DailyReadingForm mode="create" initialValues={emptyValues("2026-09-20")} {...baseProps} />);
    expect(screen.getByLabelText(/편성일/)).toHaveValue("2026-09-20");
    expect(screen.getByLabelText(/공식성 등급/)).toHaveValue("R");
    expect(screen.getByLabelText(/검수 상태/)).toHaveValue("unverified");
    expect(screen.getByLabelText(/예상 읽기 시간/)).toHaveValue(3);
  });

  it("필수 누락 시 onSubmit 을 부르지 않고 인라인 오류를 보인다", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <DailyReadingForm mode="create" initialValues={emptyValues("2026-09-20")} {...baseProps} onSubmit={onSubmit} />,
    );
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    expect(alerts[0]).toHaveTextContent("필수 항목이에요");
    expect(screen.getByLabelText(/^제목/)).toHaveAttribute("aria-invalid", "true");
  });

  it("오류 필드를 고치면 그 필드의 오류만 사라진다", () => {
    const { container } = render(
      <DailyReadingForm mode="create" initialValues={emptyValues("2026-09-20")} {...baseProps} />,
    );
    fireEvent.submit(container.querySelector("form")!);
    const before = screen.getAllByRole("alert").length;
    fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: "고침" } });
    expect(screen.getAllByRole("alert")).toHaveLength(before - 1);
    expect(screen.getByLabelText(/^제목/)).not.toHaveAttribute("aria-invalid");
  });

  it("정상 입력 submit 은 폼 값 그대로 onSubmit 에 넘긴다 (변환은 toPayload 몫)", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <DailyReadingForm mode="create" initialValues={emptyValues("2026-09-20")} {...baseProps} onSubmit={onSubmit} />,
    );
    fillRequired();
    fireEvent.change(screen.getByLabelText(/공식성 등급/), { target: { value: "O1" } });
    fireEvent.change(screen.getByLabelText(/검수 상태/), { target: { value: "reviewed" } });
    fireEvent.change(screen.getByLabelText(/예상 읽기 시간/), { target: { value: "5" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reading_date: "2026-09-20",
        title: "테스트 제목",
        authority_grade: "O1",
        review_status: "reviewed",
        estimated_minutes: "5",
        spoken_on: "",
      }),
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("serverErrors(409) 는 날짜 아래에 보인다", () => {
    render(
      <DailyReadingForm
        mode="create"
        initialValues={emptyValues("2026-09-20")}
        serverErrors={{ reading_date: "그 날짜에는 이미 편성이 있어요" }}
        {...baseProps}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("그 날짜에는 이미 편성이 있어요");
    expect(screen.getByLabelText(/편성일/)).toHaveAttribute("aria-invalid", "true");
  });

  it("isSubmitting 이면 제출 버튼이 비활성화되고 pending 라벨", () => {
    render(<DailyReadingForm mode="create" {...baseProps} isSubmitting />);
    expect(screen.getByRole("button", { name: "등록 중..." })).toBeDisabled();
  });

  it("취소 버튼은 onCancel", () => {
    const onCancel = vi.fn();
    render(
      <DailyReadingForm mode="edit" initialValues={emptyValues("2026-09-20")} {...baseProps} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
