import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SummaryForm } from "@/features/hoondok/summaries/workspace";
import { summariesAPI, type SummaryAdminResponse } from "@/features/hoondok/summaries/api";
import { rightsAPI } from "@/features/hoondok/rights-api";
import { ApiError } from "@/lib/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/features/hoondok/rights-api", () => ({
  rightsAPI: { list: vi.fn() },
}));
vi.mock("@/features/hoondok/summaries/api", () => ({
  summariesAPI: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    action: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock("@/features/hoondok/summaries/source-picker", () => ({
  SourcePicker: ({ onApply }: { onApply: (range: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onApply({
          id: "range-2",
          version: 2,
          content_right_id: "22222222-2222-4222-8222-222222222222",
          title: "새 원문 범위",
          group_title: "총서",
          source: {
            edition: "제공 판본",
            locator: "새 원문 범위",
            text: "다른 원문",
            sha256: "",
            chunk_ids: ["server-linked-source"],
            verified: true,
          },
        })
      }
    >
      말씀 선택·변경
    </button>
  ),
}));
vi.mock("@/features/hoondok/summaries/editor", () => ({
  summaryExtensions: () => [],
  SummaryEditor: ({
    onUpload,
    onChange,
  }: {
    onUpload?: (file: File) => Promise<{ id: string }>;
    onChange: (body: unknown) => void;
  }) => (
    <div aria-label="상세 해설">
      {onUpload && (
        <button
          type="button"
          onClick={async () => {
            const asset = await onUpload(new File(["image"], "첫 이미지.png", { type: "image/png" }));
            onChange({
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: { asset_id: asset.id, alt: "첫 이미지", caption: "", width_percent: 100, align: "center" },
                },
              ],
            });
          }}
        >
          본문 이미지 넣기
        </button>
      )}
    </div>
  ),
}));
const draft: SummaryAdminResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  content_right_id: "22222222-2222-4222-8222-222222222222",
  slug: "principle-intro-01",
  group_title: "총서",
  position: 1,
  title: "행복과 인간의 모순",
  lead: "원문을 함께 읽습니다.",
  key_points: ["행복", "본심", "모순"],
  body: { type: "doc", content: [{ type: "paragraph" }] },
  reflection: "나는 어떻게 살아갈까요?",
  source: {
    edition: "제공 판본",
    locator: "총서 앞부분",
    text: "원문",
    sha256: "",
    chunk_ids: ["source-1"],
    verified: true,
  },
  slides: [],
  assets: [],
  version: 3,
  review_status: "approved",
  published: true,
  updated_at: "2026-10-31T00:00:00Z",
};
function show(initial: SummaryAdminResponse = draft) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SummaryForm initial={initial} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(rightsAPI.list).mockResolvedValue([]);
});
describe("AI 요약 관리자 편집", () => {
  it("저장하지 않은 수정은 공개할 수 없고 저장 실패 시 한국어 입력을 유지한다", async () => {
    vi.mocked(summariesAPI.update).mockRejectedValue(new ApiError(409, "다른 관리자가 수정했습니다."));
    show();
    expect(screen.getByRole("button", { name: "공개하기" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "수정한 행복과 인간의 모순" },
    });
    expect(screen.getByRole("button", { name: "공개하기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다른 관리자가 수정했습니다");
    expect(screen.getByLabelText("제목")).toHaveValue("수정한 행복과 인간의 모순");
    expect(summariesAPI.update).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({
        version: 3,
        title: "수정한 행복과 인간의 모순",
      }),
    );
    expect(summariesAPI.action).not.toHaveBeenCalled();
  });
  it("공개는 현재 개정 번호를 보내고 응답 상태를 표시한다", async () => {
    vi.mocked(summariesAPI.action).mockResolvedValue({ ...draft, version: 4 });
    show();
    fireEvent.click(screen.getByRole("button", { name: "공개하기" }));
    await waitFor(() =>
      expect(summariesAPI.action).toHaveBeenCalledWith(draft.id, {
        action: "publish",
        version: 3,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("요약을 공개했습니다");
  });
  it("목차에서 선택한 원문 범위를 자동 연결하며 내부 식별자를 노출하지 않는다", async () => {
    vi.mocked(summariesAPI.update).mockResolvedValue({ ...draft, version: 4 });
    show();
    expect(screen.queryByLabelText("연결된 원문 청크 ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("콘텐츠 식별자")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "말씀 선택·변경" }));
    expect(screen.getByLabelText("연결된 말씀")).toHaveTextContent("다른 원문");
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() =>
      expect(summariesAPI.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({
          source_range_id: "range-2",
          source_range_version: 2,
          source: expect.objectContaining({ chunk_ids: ["server-linked-source"] }),
        }),
      ),
    );
  });
  it("다른 페이지로 이동했다 돌아오면 같은 서버 개정의 임시 내용을 복구한다", async () => {
    const first = show();
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "돌아와서 이어 쓸 제목" },
    });
    first.unmount();
    show();
    await waitFor(() => expect(screen.getByLabelText("제목")).toHaveValue("돌아와서 이어 쓸 제목"));
    expect(screen.getByRole("status")).toHaveTextContent("복구했습니다");
    expect(screen.getByRole("button", { name: "공개하기" })).toBeDisabled();
  });
  it("서버에 새 개정이 있으면 이전 개정의 임시 값으로 덮어쓰지 않는다", () => {
    const first = show();
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "옛 개정의 미저장 제목" },
    });
    first.unmount();
    show({ ...draft, version: 4, title: "서버에서 새로 수정한 제목" });
    expect(screen.getByLabelText("제목")).toHaveValue("서버에서 새로 수정한 제목");
    expect(screen.queryByText(/복구했습니다/)).not.toBeInTheDocument();
  });
  it("서버 저장 성공 후 이전 임시 내용을 제거한다", async () => {
    vi.mocked(summariesAPI.update).mockResolvedValue({
      ...draft,
      version: 4,
      title: "저장한 제목",
      review_status: "draft",
    });
    const first = show();
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "저장한 제목" },
    });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    expect(await screen.findByRole("status")).toHaveTextContent("초안을 저장했습니다");
    expect(window.sessionStorage.getItem(`truewords:summary-draft:${draft.id}:3`)).toBeNull();
    first.unmount();
    show();
    expect(screen.getByLabelText("제목")).toHaveValue(draft.title);
  });
  it("브라우저 임시 저장이 차단되어도 편집을 유지한다", () => {
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      show();
      fireEvent.change(screen.getByLabelText("제목"), {
        target: { value: "계속 편집하는 제목" },
      });
      expect(screen.getByLabelText("제목")).toHaveValue("계속 편집하는 제목");
      expect(screen.getByText(/임시 보관을 사용할 수 없습니다/)).toBeInTheDocument();
    } finally {
      blocked.mockRestore();
    }
  });
});

it("새 글은 첫 이미지 업로드 전에 초안을 자동 생성하고 미저장 본문을 복구한다", async () => {
  vi.mocked(summariesAPI.create).mockResolvedValue({
    ...draft,
    slug: "auto-created",
    position: 4,
    title: "새 원문 범위",
    review_status: "draft",
    published: false,
    version: 1,
  });
  vi.mocked(summariesAPI.upload).mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    url: "/api/backend/admin/hoondok/ai-summaries/unit/media/asset",
    mime_type: "image/png",
  });
  const fresh = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SummaryForm />
      </QueryClientProvider>,
    );
  const first = fresh();
  fireEvent.click(screen.getByRole("button", { name: "말씀 선택·변경" }));
  fireEvent.click(screen.getByRole("button", { name: "본문 이미지 넣기" }));
  await waitFor(() => expect(summariesAPI.upload).toHaveBeenCalledWith(draft.id, expect.any(File)));
  await waitFor(() =>
    expect(window.sessionStorage.getItem("truewords:summary-draft:new:0")).toContain(
      "33333333-3333-4333-8333-333333333333",
    ),
  );
  first.unmount();
  fresh();
  await waitFor(() => expect(screen.getByLabelText("제목")).toHaveValue("새 원문 범위"));
  expect(screen.getByRole("status")).toHaveTextContent("복구했습니다");
  expect(summariesAPI.create).toHaveBeenCalledTimes(1);
});

it("원문을 고르지 않은 새 글은 숨겨진 필드에 막히지 않고 선택 방법을 안내한다", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SummaryForm />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "긴 제목을 작성하기 전에 원문 선택하기" } });
  fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("원문 범위를 먼저 선택");
  expect(summariesAPI.create).not.toHaveBeenCalled();
  expect(screen.getByLabelText("제목").tagName).toBe("TEXTAREA");
});
