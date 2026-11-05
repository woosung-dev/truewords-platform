import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SummaryDetail } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { summariesAPI } from "./api";
import { AI_NOTICE, readingMinutes, SummaryDetailScreen, SummaryListScreen, SummaryMarks } from "./screens";

vi.mock("./api", () => ({ summariesAPI: { list: vi.fn(), detail: vi.fn() } }));

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

const detail: SummaryDetail = {
  id: "one",
  content_right_id: "book",
  work_title: "천성경",
  volume: "천성경.pdf",
  slug: "cheon-01-01-01",
  group_title: "제1편 하나님 · 제1장 하나님의 존재와 속성 · 1절 하나님의 실존",
  position: 1,
  title: "하나님의 실존",
  lead: "결과가 있으면 원인이 있듯 하나님은 계십니다.",
  key_points: ["요점 하나", "요점 둘", "요점 셋"],
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "차근히 읽는 해설 (말씀 5–7)" }] }] },
  body_version: 1,
  evidence: [{ claim: "하나님은 원인적 존재다", from: 5, to: 7 }],
  reflection_questions: ["오늘 무엇에서 원인을 느꼈나요?"],
  source: { edition: "천성경 증보판", locator: "제1편 1장 1절 말씀 1–43", text: "", paragraph_from: 1, paragraph_to: 43, chunk_ids: [] },
  section_position: 2,
  images: [
    { kind: "concept", asset_id: "a", alt: "원인과 결과를 잇는 도해", caption: "개념 캡션", url: "/c.webp" },
    { kind: "scene", asset_id: "b", alt: "창가에서 생각하는 사람", caption: "장면 캡션", url: "/s.webp" },
  ],
  assets: [],
  next_id: null,
};

it("공개 요약을 링크로 보여주고 AI 안내를 붙인다", async () => {
  vi.mocked(summariesAPI.list).mockResolvedValue([{ id: "one", content_right_id: "book", work_title: "천성경", slug: "cheon-01-01-01", group_title: "제1편 하나님", position: 1, title: "하나님의 실존", lead: "핵심", section_position: 2 }]);
  wrap(<SummaryListScreen />);
  expect(await screen.findByRole("link", { name: /하나님의 실존/ })).toHaveAttribute("href", "/summaries/one");
  expect(screen.getByText(AI_NOTICE)).toBeInTheDocument();
});

it("상세는 계약의 블록 순서대로 그리고 근거는 원문 뷰 장 위치로 연결한다", async () => {
  vi.mocked(summariesAPI.detail).mockResolvedValue(detail);
  wrap(<SummaryDetailScreen id="one" />);
  const title = await screen.findByRole("heading", { level: 2, name: "하나님의 실존" });
  expect(title).toBeInTheDocument();
  const crumb = screen.getByRole("navigation", { name: "위치" });
  expect(within(crumb).getByRole("link", { name: "천성경" })).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf");
  expect(crumb).toHaveTextContent("1절 하나님의 실존");
  expect(screen.getByText("AI 요약 · 약 1분")).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent(AI_NOTICE);
  const order = ["핵심 한 줄", "요점", "그림", "차근히 이해하기", "근거 확인하기", "되새길 물음", "원문과 함께 읽기"].map(
    (name) => screen.getByRole(name === "핵심 한 줄" || name === "그림" ? "region" : "heading", { name }),
  );
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  const evidence = screen.getByRole("link", { name: "말씀 5–7 원문에서 확인하기" });
  expect(evidence).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf?section=2");
  expect(screen.getByRole("link", { name: "원문 읽기" })).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf?section=2");
});

it("그림은 개념/장면 토글로 바꾸고 대체 텍스트를 지킨다", async () => {
  vi.mocked(summariesAPI.detail).mockResolvedValue(detail);
  wrap(<SummaryDetailScreen id="one" />);
  expect(await screen.findByRole("img", { name: "원인과 결과를 잇는 도해" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "개념 그림" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "장면 그림" }));
  expect(screen.getByRole("img", { name: "창가에서 생각하는 사람" })).toBeInTheDocument();
  expect(screen.getByText("장면 캡션")).toBeInTheDocument();
});

it("근거에 단락이 연결돼 있으면 그 단락으로, 없으면 장 첫머리로 간다", async () => {
  vi.mocked(summariesAPI.detail).mockResolvedValue({
    ...detail,
    evidence: [
      { claim: "단락 연결", from: 5, to: 7, chunk_index: 13, chunk_id: "c-13" },
      { claim: "단락 없음", from: 9, to: 9 },
    ],
  });
  wrap(<SummaryDetailScreen id="one" />);
  expect(await screen.findByRole("link", { name: "말씀 5–7 원문에서 확인하기" })).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf?chunk_id=c-13");
  expect(screen.getByRole("link", { name: "말씀 9 원문에서 확인하기" })).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf?section=2");
});

it("평화경은 위치를 편 › 연설문(날짜)로 보이고 근거를 문단 번호로 읽는다", async () => {
  vi.mocked(summariesAPI.detail).mockResolvedValue({
    ...detail,
    work_title: "평화경",
    volume: "평화경.txt",
    slug: "peace-01-01",
    group_title: "제1편 참평화의 근본원리 · 1. 하나님과 인간을 위한 이상세계 (1972.2.4)",
    title: "하나님과 인간을 위한 이상세계",
    paragraph_label: "문단",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "해설 (문단 5–7)" }] }] },
  });
  wrap(<SummaryDetailScreen id="one" />);
  const crumb = await screen.findByRole("navigation", { name: "위치" });
  expect(crumb).toHaveTextContent("평화경제1편 참평화의 근본원리1. 하나님과 인간을 위한 이상세계 (1972.2.4)");
  expect(screen.getByRole("link", { name: "문단 5–7 원문에서 확인하기" })).toBeInTheDocument();
  expect(screen.getByText("(문단 5–7)")).toHaveClass("sum-cite");
});

it("장 위치가 없으면 원문 첫 화면으로 폴백한다", async () => {
  vi.mocked(summariesAPI.detail).mockResolvedValue({ ...detail, section_position: null });
  wrap(<SummaryDetailScreen id="one" />);
  expect(await screen.findByRole("link", { name: "원문 읽기" })).toHaveAttribute("href", "/words/%EC%B2%9C%EC%84%B1%EA%B2%BD.pdf");
});

it("원문 뷰 표지는 요약이 있을 때만 링크로 보인다", () => {
  const { container } = render(<SummaryMarks items={[]} />);
  expect(container).toBeEmptyDOMElement();
  render(<SummaryMarks items={[{ id: "one", title: "하나님의 실존" }]} />);
  expect(screen.getByRole("link", { name: /AI 요약.*하나님의 실존/ })).toHaveAttribute("href", "/summaries/one");
});

it("읽기 시간은 최소 1분이다", () => {
  expect(readingMinutes({ lead: "", key_points: [], body: { type: "doc" }, evidence: [], reflection_questions: [] })).toBe(1);
  expect(readingMinutes({ lead: "가".repeat(1500), key_points: [], body: { type: "doc" }, evidence: [], reflection_questions: [] })).toBe(3);
});

afterEach(() => {
  vi.clearAllMocks();
});
