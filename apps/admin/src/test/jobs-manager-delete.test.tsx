// 임베딩 항목 탭에서 미분류·실패 항목도 파일명 확인 후 영구 삭제할 수 있는지 확인한다.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/data-source/api", () => ({
  dataAPI: {
    getJobs: vi.fn(),
    deleteVolume: vi.fn(),
  },
  dataSourceCategoryAPI: { list: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { dataAPI } from "@/features/data-source/api";
import { JobsManager } from "@/features/data-source/components/jobs-manager";

const FAILED_JOB = {
  volume_key: "20241208 참어머님 말씀.pdf",
  filename: "20241208 참어머님 말씀.pdf",
  display_name: null,
  total_chunks: 0,
  status: "failed",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dataAPI.getJobs).mockResolvedValue([FAILED_JOB] as never);
  vi.mocked(dataAPI.deleteVolume).mockResolvedValue({
    deleted_volumes: [FAILED_JOB.volume_key],
    total_chunks_deleted: 0,
    skipped: [],
  } as never);
});

describe("JobsManager 삭제", () => {
  it("실패 항목을 파일명 확인 후 삭제하고 목록을 다시 불러온다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <JobsManager />
      </QueryClientProvider>,
    );

    const [deleteButton] = await screen.findAllByRole("button", { name: `${FAILED_JOB.filename} 영구 삭제` });
    fireEvent.click(deleteButton);

    const confirm = await screen.findByRole("button", { name: /^영구 삭제/ });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: /확인/ }), { target: { value: FAILED_JOB.volume_key } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(dataAPI.deleteVolume).toHaveBeenCalledWith(FAILED_JOB.volume_key));
    await waitFor(() => expect(dataAPI.getJobs).toHaveBeenCalledTimes(2));
  });
});
