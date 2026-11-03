import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryBody } from "./summary-body";

describe("원문 요약 본문", () => {
  it("본문 구조와 서식을 읽기 전용으로 보여준다", () => {
    render(
      <SummaryBody
        body={{
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "두 가지 길" }] },
            { type: "paragraph", content: [{ type: "text", text: "종교와 과학", marks: [{ type: "bold" }] }] },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "두 가지 길" })).toBeTruthy();
    expect(screen.getByText("종교와 과학").tagName).toBe("STRONG");
    expect(document.querySelector("[contenteditable]")).toBeNull();
  });
  it("지원하지 않는 노드와 실행 가능한 링크를 표시하지 않는다", () => {
    const { rerender } = render(
      <SummaryBody body={{ type: "doc", content: [{ type: "iframe", attrs: { src: "https://example.com" } }] }} />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(
      <SummaryBody
        body={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

it("본문 이미지와 영상·표를 공개 자산만으로 표시한다", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const { container } = render(
    <SummaryBody
      assets={[{ id, url: "/api/backend/hoondok/ai-summaries/unit/media/asset", mime_type: "image/webp" }]}
      body={{
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              asset_id: id,
              alt: "아침 정원",
              caption: "행복을 묻는 출발점",
              width_percent: 75,
              align: "center",
            },
          },
          { type: "youtube", attrs: { video_id: "abcdefghijk", start_seconds: 12 } },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "핵심 의미" }] }],
                  },
                ],
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getByAltText("아침 정원")).toHaveAttribute(
    "src",
    expect.stringContaining("/api/backend/hoondok/ai-summaries/"),
  );
  expect(screen.getByText("행복을 묻는 출발점")).toBeVisible();
  expect(container.querySelector("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/abcdefghijk?start=12",
  );
  expect(screen.getByRole("cell", { name: "핵심 의미" })).toBeVisible();
});
