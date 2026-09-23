import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RightsPage from "@/app/(dashboard)/hoondok/rights/page";
import { rightsAPI } from "@/features/hoondok/rights-api";

vi.mock("@/features/hoondok/rights-api", () => ({
  rightsAPI: { list: vi.fn(), create: vi.fn(), update: vi.fn(), seriesSummary: vi.fn(), bulk: vi.fn() },
}));
const record = {
  id: "right-1",
  volume: "v",
  work_title: "권리 말씀",
  source_keys: ["O"],
  book_series: null,
  authority_grade: "R" as const,
  status: "allowed" as const,
  scope_search: true,
  scope_full_text: false,
  scope_jeongseong: false,
  note: "근거",
  created_at: "2026-09-21",
  updated_at: "2026-09-21",
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rightsAPI.list).mockResolvedValue([]);
  // 개별 폼 시나리오는 시리즈 요약을 비워 둔다 — 요약은 hoondok-rights-series.test.tsx 가 본다.
  vi.mocked(rightsAPI.seriesSummary).mockResolvedValue({ items: [] });
});
describe("권리 원장", () => {
  it("빈 원장에서도 pending과 세 범위 비허용으로 등록할 수 있다", async () => {
    vi.mocked(rightsAPI.create).mockResolvedValue(record);
    show();
    expect(await screen.findByText(/등록된 권리가 없습니다/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("코퍼스 저작물 ID (volume)"), { target: { value: "v" } });
    fireEvent.change(screen.getByLabelText("표시 제목"), { target: { value: "말씀" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(rightsAPI.create).toHaveBeenCalledWith(
        expect.objectContaining({
          volume: "v",
          status: "pending",
          scope_search: false,
          scope_full_text: false,
          scope_jeongseong: false,
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("저장했습니다");
  });
  it("저장 실패는 입력을 유지하고 원인 문구를 표시한다", async () => {
    vi.mocked(rightsAPI.create).mockRejectedValue(new Error("fail"));
    show();
    fireEvent.change(screen.getByLabelText("코퍼스 저작물 ID (volume)"), { target: { value: "v" } });
    fireEvent.change(screen.getByLabelText("표시 제목"), { target: { value: "말씀" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("입력 내용을 유지");
    expect(screen.getByLabelText("표시 제목")).toHaveValue("말씀");
  });
  it("등록한 저작물을 철회하며 독립 권리 범위를 보존한다", async () => {
    vi.mocked(rightsAPI.list).mockResolvedValue([record]);
    vi.mocked(rightsAPI.update).mockResolvedValue({ ...record, status: "withdrawn" });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "권리 말씀 수정" }));
    fireEvent.change(screen.getByLabelText("승인 상태"), { target: { value: "withdrawn" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(rightsAPI.update).toHaveBeenCalledWith(
        "right-1",
        expect.objectContaining({ status: "withdrawn", scope_search: true, scope_full_text: false }),
      ),
    );
  });
});
