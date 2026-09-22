import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RightsPage from "@/app/(dashboard)/hoondok/rights/page";
import { rightsAPI } from "@/features/hoondok/rights-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/hoondok/rights-api", () => ({
  rightsAPI: { list: vi.fn(), create: vi.fn(), update: vi.fn(), seriesSummary: vi.fn(), bulk: vi.fn() },
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args) } }));

const summaryItem = {
  series: "father_anthology",
  title: "문선명선생 말씀선집",
  registered: 615,
  allowed: 0,
  pending: 615,
  withdrawn: 0,
  chunk_count: 417_579,
};
const right = {
  id: "right-1",
  volume: "말씀선집 355권",
  work_title: "말씀선집 355권",
  source_keys: ["O"],
  book_series: "father_anthology",
  authority_grade: "R" as const,
  status: "pending" as const,
  scope_search: true,
  scope_full_text: false,
  scope_jeongseong: false,
  note: "",
  chunk_count: 1234,
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
};
const otherRight = {
  ...right,
  id: "right-2",
  work_title: "천성경",
  book_series: "cheonseong_gyeong",
  chunk_count: null,
};

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <RightsPage />
    </QueryClientProvider>,
  );
}
async function openBulkDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "문선명선생 말씀선집 일괄 변경" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rightsAPI.list).mockResolvedValue([]);
  vi.mocked(rightsAPI.seriesSummary).mockResolvedValue({ items: [summaryItem] });
});

describe("시리즈 요약", () => {
  it("저작물별 등록·공개·대기·철회·청크 수를 보여준다", async () => {
    show();
    const row = (await screen.findByText("문선명선생 말씀선집")).closest("tr");
    expect(row).not.toBeNull();
    for (const value of ["615", "0", "615", "0", "417579"]) {
      expect(row?.textContent).toContain(value);
    }
  });

  it("원장이 비면 시드 스크립트 안내를 보여준다", async () => {
    vi.mocked(rightsAPI.seriesSummary).mockResolvedValue({ items: [] });
    show();
    expect(await screen.findByText(/권리 원장이 비어 있어요/)).toBeInTheDocument();
    expect(screen.getByText("seed_content_rights_from_qdrant.py")).toBeInTheDocument();
  });
});

describe("일괄 변경 다이얼로그", () => {
  it("기본값은 허용 · 검색 스니펫 · 원문 전재 · 등급 변경하지 않음이다", async () => {
    show();
    const dialog = within(await openBulkDialog());
    expect(dialog.getByLabelText("승인 상태")).toHaveValue("allowed");
    expect(dialog.getByLabelText("검색 스니펫")).toBeChecked();
    expect(dialog.getByLabelText("원문 전재")).toBeChecked();
    expect(dialog.getByLabelText("정성 말씀")).not.toBeChecked();
    expect(dialog.getByLabelText("공식성 등급")).toHaveValue("keep");
    expect(dialog.getByText("이 시리즈의 615권이 전부 바뀝니다.")).toBeInTheDocument();
  });

  it("등급을 고르지 않으면 authority_grade 없이 보내고 성공 토스트를 띄운다", async () => {
    vi.mocked(rightsAPI.bulk).mockResolvedValue({ book_series: "father_anthology", updated: 615 });
    show();
    await openBulkDialog();
    fireEvent.click(screen.getByRole("button", { name: "일괄 변경" }));
    await waitFor(() =>
      expect(rightsAPI.bulk).toHaveBeenCalledWith({
        book_series: "father_anthology",
        status: "allowed",
        scope_search: true,
        scope_full_text: true,
        scope_jeongseong: false,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("615권 갱신"));
    // 성공하면 요약·목록을 다시 읽는다.
    await waitFor(() => expect(rightsAPI.seriesSummary).toHaveBeenCalledTimes(2));
    expect(rightsAPI.list).toHaveBeenCalledTimes(2);
  });

  it("등급을 고르면 authority_grade 를 함께 보낸다", async () => {
    vi.mocked(rightsAPI.bulk).mockResolvedValue({ book_series: "father_anthology", updated: 3 });
    show();
    const dialog = within(await openBulkDialog());
    fireEvent.change(dialog.getByLabelText("공식성 등급"), { target: { value: "O1" } });
    fireEvent.click(dialog.getByRole("button", { name: "일괄 변경" }));
    await waitFor(() =>
      expect(rightsAPI.bulk).toHaveBeenCalledWith(expect.objectContaining({ authority_grade: "O1" })),
    );
  });

  it("404 는 다이얼로그 안에서 원인을 알린다", async () => {
    vi.mocked(rightsAPI.bulk).mockRejectedValue(new ApiError(404, "not found"));
    show();
    await openBulkDialog();
    fireEvent.click(screen.getByRole("button", { name: "일괄 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("권리 기록이 없습니다");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("네트워크 실패도 다이얼로그 안에서 알린다", async () => {
    vi.mocked(rightsAPI.bulk).mockRejectedValue(new Error("network"));
    show();
    await openBulkDialog();
    fireEvent.click(screen.getByRole("button", { name: "일괄 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다시 시도해 주세요");
  });
});

describe("총서 필터", () => {
  it("선택한 총서의 행만 남기고 청크 수를 보여준다", async () => {
    vi.mocked(rightsAPI.list).mockResolvedValue([right, otherRight]);
    show();
    expect(await screen.findByText("말씀선집 355권")).toBeInTheDocument();
    expect(screen.getByText(/1234청크/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("총서 필터"), { target: { value: "cheonseong_gyeong" } });
    const list = within(screen.getByRole("list"));
    await waitFor(() => expect(list.queryByText("말씀선집 355권")).not.toBeInTheDocument());
    expect(list.getByText("천성경")).toBeInTheDocument();
  });
});
