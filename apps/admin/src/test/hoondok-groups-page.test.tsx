import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HoondokGroupsPage from "@/app/(dashboard)/hoondok/groups/page";
import { groupsAPI } from "@/features/hoondok/groups-api";
import { ApiError } from "@/lib/api";

// API 만 mock 하고 문구·날짜 유틸은 실제 것을 쓴다.
vi.mock("@/features/hoondok/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/hoondok/groups-api")>()),
  groupsAPI: { list: vi.fn(), remove: vi.fn() },
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const groups = [
  { id: "g1", name: "새벽 모임", member_count: 7, created_at: "2026-09-22T15:30:00" },
  { id: "g2", name: "가족", member_count: 1, created_at: "2026-09-01T00:00:00" },
];

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <HoondokGroupsPage />
    </QueryClientProvider>,
  );
}

function row(name: string) {
  const tr = screen.getByText(name).closest("tr");
  if (!tr) throw new Error("row not found");
  return within(tr);
}

beforeEach(() => {
  vi.mocked(groupsAPI.list).mockReset().mockResolvedValue(groups);
  vi.mocked(groupsAPI.remove).mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("모임 목록", () => {
  it("이름·인원·생성일(KST)만 보인다", async () => {
    const { container } = show();
    await screen.findByText("새벽 모임");
    expect(row("새벽 모임").getByText("7명")).toBeInTheDocument();
    // 2026-09-22T15:30Z = KST 9/23
    expect(row("새벽 모임").getByText("2026-09-23")).toBeInTheDocument();
    expect(container.querySelectorAll("thead th")).toHaveLength(4);
    expect(screen.getByText("· 2개", { exact: false })).toBeInTheDocument();
  });

  it("403 은 권한 안내", async () => {
    vi.mocked(groupsAPI.list).mockRejectedValue(new ApiError(403, { message: "forbidden" }));
    show();
    expect(await screen.findByText("이 화면을 볼 권한이 없어요")).toBeInTheDocument();
  });

  it("빈 목록", async () => {
    vi.mocked(groupsAPI.list).mockResolvedValue([]);
    show();
    expect(await screen.findByText("만들어진 모임이 없습니다.")).toBeInTheDocument();
  });
});

describe("모임 삭제", () => {
  it("확인 다이얼로그가 되돌릴 수 없음을 알리고, 확인해야 DELETE 한다", async () => {
    vi.mocked(groupsAPI.remove).mockResolvedValue(undefined);
    show();
    await screen.findByText("새벽 모임");
    fireEvent.click(row("새벽 모임").getByRole("button", { name: "삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText('"새벽 모임" 모임 삭제')).toBeInTheDocument();
    expect(within(dialog).getByText(/모임원 7명.*되돌릴 수 없어요/)).toBeInTheDocument();
    expect(groupsAPI.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "모임 삭제" }));
    await waitFor(() => expect(groupsAPI.remove).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("모임이 삭제되었습니다"));
    await waitFor(() => expect(groupsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("취소하면 호출 없음", async () => {
    show();
    await screen.findByText("가족");
    fireEvent.click(row("가족").getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(groupsAPI.remove).not.toHaveBeenCalled();
  });

  it("이미 삭제된 모임(404) — 부드러운 문구 + 새로 고침", async () => {
    vi.mocked(groupsAPI.remove).mockRejectedValue(new ApiError(404, { message: "not found" }));
    show();
    await screen.findByText("가족");
    fireEvent.click(row("가족").getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "모임 삭제" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("이미 삭제된 항목이에요. 목록을 새로 고쳤어요"));
    await waitFor(() => expect(groupsAPI.list).toHaveBeenCalledTimes(2));
  });

  it("403 삭제 실패 — 권한 문구, 다이얼로그는 남는다", async () => {
    vi.mocked(groupsAPI.remove).mockRejectedValue(new ApiError(403, { message: "csrf" }));
    show();
    await screen.findByText("가족");
    fireEvent.click(row("가족").getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "모임 삭제" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("권한")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
