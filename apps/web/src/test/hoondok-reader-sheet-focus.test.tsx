import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        건네기
      </button>
      {open && (
        <ReaderSheet title="건네기" onClose={() => setOpen(false)}>
          카드
        </ReaderSheet>
      )}
    </>
  );
}

describe("공유 시트 포커스 복원", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });
  it("모달을 닫은 뒤 열었던 버튼에 포커스를 반환한다", async () => {
    const order: string[] = [];
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, writable: true, value() {} });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, writable: true, value() {} });
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
      order.push("close");
      this.removeAttribute("open");
    });
    render(
      <StrictMode>
        <Example />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "건네기" });
    opener.focus();
    fireEvent.click(opener);
    const focus = opener.focus.bind(opener);
    vi.spyOn(opener, "focus").mockImplementation(() => {
      order.push("focus");
      focus();
    });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(order).toEqual(["focus"]);
  });
});
