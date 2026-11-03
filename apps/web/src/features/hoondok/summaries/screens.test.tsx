import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { summariesAPI } from "./api";
import { SummaryListScreen } from "./screens";

vi.mock("./api", () => ({ summariesAPI: { list: vi.fn(), detail: vi.fn() } }));
it("공개 요약만 링크로 보여주고 원문 다음 소제목은 공개 예정으로 표시한다", async () => {
  vi.mocked(summariesAPI.list).mockResolvedValue([{ id: "one", content_right_id: "book", work_title: "천성경", group_title: "제1편 하나님", position: 1, title: "하나님의 실존을 인식하는 출발점", lead: "삶으로 느끼는 신앙", published: true }, { id: "two", content_right_id: "book", work_title: "천성경", group_title: "제1편 하나님", position: 2, title: "결과적 존재에 대한 원인적 존재", lead: "", published: false }]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SummaryListScreen /></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: /하나님의 실존을 인식하는 출발점/ })).toHaveAttribute("href", "/hoondok/summaries/one");
  expect(screen.queryByRole("link", { name: /결과적 존재에 대한 원인적 존재/ })).toBeNull();
  expect(screen.getByText("본심작용으로 본 하나님의 실존")).toBeTruthy();
  expect(screen.getAllByText("추후 공개 예정")).toHaveLength(2);
});

afterEach(() => { vi.clearAllMocks(); });
