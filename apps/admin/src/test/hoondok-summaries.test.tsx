import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SummaryForm, SummaryList } from "@/features/hoondok/summaries/workspace";
import { summariesAPI, type SummaryAdminResponse } from "@/features/hoondok/summaries/api";
import { rightsAPI } from "@/features/hoondok/rights-api";
import { ApiError } from "@/lib/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/features/hoondok/rights-api", () => ({
  rightsAPI: { list: vi.fn() },
}));
vi.mock("@/features/hoondok/summaries/api", () => ({
  summariesAPI: {
    toc: vi.fn(),
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
  evidence: [{ claim: "근거 문장", from: 5, to: 7 }],
  reflection_questions: ["나는 어떻게 살아갈까요?"],
  uncertainty: ["관리자 확인 사항"],
  generation: { text_model: "test-model", text_score: 88 },
  source: {
    edition: "제공 판본",
    locator: "총서 앞부분",
    text: "원문",
    sha256: "",
    chunk_ids: ["source-1"],
    verified: true,
  },
  images: [],
  assets: [],
  version: 3,
  review_status: "review",
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

it("원문 사본 없이 가져온 요약은 원문 위치를 보이고, 시작 말씀을 고치면 단락 연결을 푼다", async () => {
  vi.mocked(summariesAPI.update).mockResolvedValue({ ...draft, version: 4 });
  show({
    ...draft,
    evidence: [{ claim: "근거 문장", from: 5, to: 7, chunk_index: 13, chunk_id: "c-13" }],
    source: {
      edition: "천성경 증보판 제공 DOCX",
      locator: "제1편 1장 1절 말씀 1–43",
      text: "",
      sha256: "",
      paragraph_from: 1,
      paragraph_to: 43,
      chunk_ids: [],
      verified: false,
    },
  });
  expect(screen.getByText("원문 위치가 기록되어 있습니다.")).toBeInTheDocument();
  expect(screen.getByText("천성경 증보판 제공 DOCX / 제1편 1장 1절 말씀 1–43 (말씀 1–43)")).toBeInTheDocument();
  expect(screen.queryByText("목차에서 사용할 말씀 범위를 선택해 주세요.")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("근거 1 시작 말씀 번호"), { target: { value: "6" } });
  fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
  await waitFor(() =>
    expect(summariesAPI.update).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({
        evidence: [{ claim: "근거 문장", from: 6, to: 7, chunk_index: null, chunk_id: null }],
      }),
    ),
  );
});

it("대문자 상태 값도 소문자로 정규화해 버튼 조건을 정한다", () => {
  show({ ...draft, review_status: "WITHDRAWN" as SummaryAdminResponse["review_status"], published: false });
  expect(screen.getByRole("button", { name: "다시 공개하기" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "내리기" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "검수 요청" })).toBeDisabled();
});

it("근거·물음·확인 필요와 개념 그림 교체를 저장 값에 담는다", async () => {
  vi.mocked(summariesAPI.update).mockResolvedValue({ ...draft, version: 4 });
  vi.mocked(summariesAPI.upload).mockResolvedValue({
    id: "44444444-4444-4444-8444-444444444444",
    url: "/api/backend/admin/hoondok/ai-summaries/unit/media/new",
    mime_type: "image/webp",
  });
  show({
    ...draft,
    images: [{ kind: "concept", asset_id: "55555555-5555-4555-8555-555555555555", alt: "옛 개념", caption: "" }],
  });
  expect(screen.getByText(/test-model/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("근거 1 끝 말씀 번호"), { target: { value: "9" } });
  fireEvent.change(screen.getByLabelText("되새길 물음 1"), { target: { value: "오늘 나는 무엇을 느꼈나요?" } });
  fireEvent.change(screen.getByLabelText("개념 그림 업로드"), {
    target: { files: [new File(["x"], "concept.webp", { type: "image/webp" })] },
  });
  await waitFor(() => expect(summariesAPI.upload).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("개념 그림"));
  fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
  await waitFor(() =>
    expect(summariesAPI.update).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({
        evidence: [{ claim: "근거 문장", from: 5, to: 9 }],
        reflection_questions: ["오늘 나는 무엇을 느꼈나요?"],
        uncertainty: ["관리자 확인 사항"],
        images: [
          {
            kind: "concept",
            asset_id: "44444444-4444-4444-8444-444444444444",
            alt: "옛 개념",
            caption: "",
          },
        ],
      }),
    ),
  );
});

it("발행 관리 목록은 편·장·절 트리와 상태 거르기, 콘텐츠 없음 안내를 보여준다", async () => {
  const row = {
    pyeon_no: 1,
    pyeon_title: "하나님",
    jang_no: 1,
    jang_title: "하나님의 존재와 속성",
    paragraph_count: 43,
    image_count: 0,
    published: false,
  };
  vi.mocked(summariesAPI.toc).mockResolvedValue([
    {
      ...row,
      slug: "cheon-01-01-01",
      jeol_no: 1,
      jeol_title: "하나님의 실존",
      unit_id: draft.id,
      status: "PUBLISHED" as "published",
      published: true,
      image_count: 2,
      text_score: 91,
      updated_at: "2026-11-01T00:00:00Z",
    },
    { ...row, slug: "cheon-01-01-02", jeol_no: 2, jeol_title: "근원이요 본체이신 하나님", status: "none" },
    {
      ...row,
      pyeon_no: 2,
      pyeon_title: "참부모",
      slug: "cheon-02-01-01",
      jeol_no: 1,
      jeol_title: "참부모의 의미",
      status: "none",
    },
  ]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SummaryList />
    </QueryClientProvider>,
  );
  const link = await screen.findByRole("link", { name: /1절 하나님의 실존/ });
  expect(link).toHaveAttribute("href", `/hoondok/summaries/${draft.id}/edit`);
  expect(link).toHaveTextContent("공개");
  expect(link).toHaveTextContent("그림 2장");
  expect(link).toHaveTextContent("점수 91");
  expect(screen.getByRole("heading", { name: "제2편 참부모" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /2절 근원이요 본체이신 하나님/ }));
  expect(screen.getByRole("status")).toHaveTextContent("콘텐츠 없음");
  fireEvent.change(screen.getByLabelText("상태"), { target: { value: "published" } });
  expect(screen.queryByText(/근원이요 본체이신 하나님/)).not.toBeInTheDocument();
  expect(screen.getByText("1절 표시")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("상태"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("편"), { target: { value: "2" } });
  expect(screen.queryByText(/하나님의 실존/)).not.toBeInTheDocument();
  expect(screen.getByText(/참부모의 의미/)).toBeInTheDocument();
  expect(summariesAPI.toc).toHaveBeenCalledWith("cheonseong");
});

it("평화경으로 바꾸면 편 › 연설문(날짜) 트리와 제4편 14 장, 문단 수를 보여준다", async () => {
  const speech = {
    pyeon_no: 1,
    pyeon_title: "참평화의 근본원리",
    item_no: 1,
    item_title: "하나님과 인간을 위한 이상세계",
    toc_date: "1972.2.4",
    paragraph_count: 51,
    image_count: 0,
    published: false,
    status: "none" as const,
  };
  vi.mocked(summariesAPI.toc).mockImplementation(async (work) =>
    work === "pyeonghwa"
      ? [
          { ...speech, slug: "peace-01-01" },
          {
            ...speech,
            slug: "peace-04-14-01",
            pyeon_no: 4,
            pyeon_title: "인류를 구할 참가정운동",
            item_no: 14,
            item_title: "천국을 여는 문 참가정",
            toc_date: null,
            chapter_no: 1,
            chapter_title: "가정은 천국의 중심 모형",
            paragraph_count: 49,
          },
        ]
      : [],
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SummaryList />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "평화경" }));
  expect(await screen.findByRole("heading", { name: "평화경 AI 요약 발행 관리" })).toBeInTheDocument();
  expect(summariesAPI.toc).toHaveBeenLastCalledWith("pyeonghwa");
  const speechRow = await screen.findByRole("button", { name: /1\. 하나님과 인간을 위한 이상세계/ });
  expect(speechRow).toHaveTextContent("(1972.2.4)");
  expect(speechRow).toHaveTextContent("문단 51개");
  expect(screen.getByRole("heading", { name: "14. 천국을 여는 문 참가정" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /1장 가정은 천국의 중심 모형/ }));
  expect(screen.getByRole("status")).toHaveTextContent("이 연설문의 AI 요약");
});
