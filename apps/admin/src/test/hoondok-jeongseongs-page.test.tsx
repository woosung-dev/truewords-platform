import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OfficialJeongseongsPage from "@/app/(dashboard)/hoondok/jeongseongs/page";
import { addDays, kstTodayIso } from "@/features/hoondok/dates";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/hoondok/jeongseong-api", () => ({
  jeongseongAPI: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const TODAY = kstTodayIso();

function item(overrides: Partial<{ id: string; title: string; started_on: string; duration_days: number }>) {
  return {
    id: "j-active",
    title: "진행 정성",
    started_on: addDays(TODAY, -9),
    duration_days: 10, // 마지막 날 = 오늘 → 진행 중
    source_note: "협회 공지",
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...overrides,
  };
}

const list = [
  item({ id: "j-upcoming", title: "예정 정성", started_on: addDays(TODAY, 3), duration_days: 21 }),
  item({}),
  item({ id: "j-ended", title: "끝난 정성", started_on: addDays(TODAY, -40), duration_days: 30 }),
];

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <OfficialJeongseongsPage />
    </QueryClientProvider>,
  );
}

function row(title: string) {
  const cell = screen.getByText(title);
  const tr = cell.closest("tr");
  if (!tr) throw new Error("row not found");
  return within(tr);
}

beforeEach(() => {
  vi.mocked(jeongseongAPI.list).mockReset().mockResolvedValue(list);
  vi.mocked(jeongseongAPI.create).mockReset();
  vi.mocked(jeongseongAPI.update).mockReset();
  vi.mocked(jeongseongAPI.remove).mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("공식 정성 목록", () => {
  it("상태 라벨 — 예정·진행 중(마지막 날 오늘 = 10일차)·끝남", async () => {
    show();
    await screen.findByText("진행 정성");
    expect(row("예정 정성").getByText("예정")).toBeInTheDocument();
    expect(row("진행 정성").getByText("진행 중")).toBeInTheDocument();
    expect(row("진행 정성").getByText("10일차")).toBeInTheDocument();
    expect(row("끝난 정성").getByText("끝남")).toBeInTheDocument();
    expect(row("진행 정성").getByText(`${addDays(TODAY, -9)} ~ ${TODAY} · 10일`, { exact: false })).toBeInTheDocument();
  });

  it("빈 목록 안내", async () => {
    vi.mocked(jeongseongAPI.list).mockResolvedValue([]);
    show();
    expect(await screen.findByText("등록된 공식 정성이 없습니다.")).toBeInTheDocument();
  });

  it("403 은 크래시 없이 권한 안내 + 다시 시도", async () => {
    vi.mocked(jeongseongAPI.list).mockRejectedValue(new ApiError(403, { message: "forbidden" }));
    show();
    expect(await screen.findByText("이 화면을 볼 권한이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

describe("등록·수정", () => {
  it("등록 — 기간 101 은 인라인 오류로 멈추고, 100 은 페이로드로 나간다", async () => {
    vi.mocked(jeongseongAPI.create).mockResolvedValue(item({ id: "j-new" }));
    show();
    await screen.findByText("진행 정성");
    fireEvent.click(screen.getByRole("button", { name: "새 공식 정성" }));

    expect(screen.getByLabelText(/시작일/)).toHaveValue(TODAY);
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "  추석 정성 " } });
    fireEvent.change(screen.getByLabelText(/기간/), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    expect(await screen.findByText("1~100 사이 정수여야 해요")).toBeInTheDocument();
    expect(jeongseongAPI.create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/기간/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() =>
      expect(jeongseongAPI.create).toHaveBeenCalledWith({
        title: "추석 정성",
        started_on: TODAY,
        duration_days: 100,
        source_note: null,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("공식 정성이 등록되었습니다"));
    expect(jeongseongAPI.list).toHaveBeenCalledTimes(2);
  });

  it("수정 — 기존 값이 채워지고 PUT 전체 교체", async () => {
    vi.mocked(jeongseongAPI.update).mockResolvedValue(item({}));
    show();
    await screen.findByText("진행 정성");
    fireEvent.click(row("진행 정성").getByRole("button", { name: "수정" }));
    expect(screen.getByLabelText(/제목/)).toHaveValue("진행 정성");
    expect(screen.getByLabelText(/기간/)).toHaveValue(10);
    fireEvent.change(screen.getByLabelText(/기간/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(jeongseongAPI.update).toHaveBeenCalledWith("j-active", {
        title: "진행 정성",
        started_on: addDays(TODAY, -9),
        duration_days: 1,
        source_note: "협회 공지",
      }),
    );
  });
});

describe("삭제", () => {
  it("확인 다이얼로그 — 취소하면 호출 없음, 확인하면 DELETE", async () => {
    vi.mocked(jeongseongAPI.remove).mockResolvedValue(undefined);
    show();
    await screen.findByText("진행 정성");
    fireEvent.click(row("진행 정성").getByRole("button", { name: "삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/되돌릴 수 없어요/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(jeongseongAPI.remove).not.toHaveBeenCalled();

    fireEvent.click(row("진행 정성").getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(jeongseongAPI.remove).toHaveBeenCalledWith("j-active"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("공식 정성이 삭제되었습니다"));
  });

  it("이미 삭제된 항목(404) — 부드러운 문구 + 목록 새로 고침 + 다이얼로그 닫힘", async () => {
    vi.mocked(jeongseongAPI.remove).mockRejectedValue(new ApiError(404, { message: "not found" }));
    show();
    await screen.findByText("진행 정성");
    fireEvent.click(row("진행 정성").getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("이미 삭제된 항목이에요. 목록을 새로 고쳤어요"));
    await waitFor(() => expect(jeongseongAPI.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
