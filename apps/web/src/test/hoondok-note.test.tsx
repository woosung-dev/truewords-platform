// SCR-PWA-003 "오늘의 한 줄" (PLAN-HD-002 W1-N) — 기기 전용 메모.
// 저장소 모킹은 hoondok-install.test.tsx 의 Storage.prototype spy 방식을 따른다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayNote } from "@/features/hoondok/note/components/today-note";
import { NOTE_MAX, readNote, subscribeNote, writeNote } from "@/features/hoondok/note/storage";

const DATE = "2026-09-20";
const KEY = `hoondok:note:${DATE}`;
const SAVE_DEBOUNCE_MS = 300;
const SAVED_VISIBLE_MS = 1500;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("note/storage (기기 전용 localStorage)", () => {
  it("KST 날짜 키에 저장하고 200자에서 자르며 빈 값은 키를 지운다", () => {
    writeNote(DATE, "오늘은 감사로 시작하기");
    expect(localStorage.getItem(KEY)).toBe("오늘은 감사로 시작하기");
    expect(readNote(DATE)).toBe("오늘은 감사로 시작하기");
    // 날짜가 바뀌면 다른 키라 빈 칸이다 (자정 전환)
    expect(readNote("2026-09-21")).toBe("");

    writeNote(DATE, "가".repeat(NOTE_MAX + 10));
    expect(localStorage.getItem(KEY)).toHaveLength(NOTE_MAX);

    // 밖에서 길이가 깨진 값이 들어와도 읽을 때 잘라 준다
    localStorage.setItem(KEY, "나".repeat(NOTE_MAX + 10));
    expect(readNote(DATE)).toHaveLength(NOTE_MAX);

    writeNote(DATE, "");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("같은 탭의 저장도 구독자에게 알리고, 해제하면 더 부르지 않는다", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeNote(onChange);
    writeNote(DATE, "한 줄");
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
    writeNote(DATE, "두 줄");
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe("TodayNote", () => {
  it("입력 후 300ms 가 지나야 저장되고, 저장됨 안내는 1.5초 뒤 사라진다", () => {
    vi.useFakeTimers();
    render(<TodayNote readingDate={DATE} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "오늘은 감사" } });
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByTestId("note-saved").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(readNote(DATE)).toBe("오늘은 감사");
    expect(screen.getByTestId("note-saved").textContent).toBe("저장됨");

    act(() => {
      vi.advanceTimersByTime(SAVED_VISIBLE_MS);
    });
    expect(screen.getByTestId("note-saved").textContent).toBe("");
  });

  it("언마운트 뒤 다시 마운트하면 저장된 값과 카운터가 복원된다", () => {
    vi.useFakeTimers();
    const { unmount } = render(<TodayNote readingDate={DATE} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "한 줄" } });
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    unmount();

    render(<TodayNote readingDate={DATE} />);
    expect(screen.getByRole("textbox")).toHaveValue("한 줄");
    expect(screen.getByText(`3 / ${NOTE_MAX}`)).toBeInTheDocument();
    // 서버로 보내는 값이 아니므로 입력 길이 상한은 브라우저가 막는다
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", String(NOTE_MAX));
  });

  it("저장소가 던져도 렌더와 입력에 예외가 없다 (사생활 모드·차단)", () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => render(<TodayNote readingDate={DATE} />)).not.toThrow();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "차단된 기기" } });
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
      }),
    ).not.toThrow();
    // 저장은 실패해도 화면의 입력값과 카운터는 그대로다
    expect(screen.getByRole("textbox")).toHaveValue("차단된 기기");
    expect(screen.getByText(`6 / ${NOTE_MAX}`)).toBeInTheDocument();
  });
});

describe("/hoondok/read 조건부 렌더", () => {
  it("편성이 없으면 한 줄 입력을 그리지 않는다", async () => {
    vi.resetModules();
    vi.doMock("@/features/hoondok/api", () => ({
      loadToday: vi.fn(async () => ({ date: DATE, status: "none", reading: null })),
    }));
    const { default: HoondokReadPage } = await import("../app/(hoondok)/hoondok/read/page");

    render(await HoondokReadPage());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("오늘의 한 줄")).toBeNull();
  });
});
