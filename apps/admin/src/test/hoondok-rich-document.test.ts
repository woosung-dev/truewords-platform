import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { persistableDocument, summaryExtensions } from "@/features/hoondok/summaries/editor";
import { canonicalDocument, youtubeVideo } from "@/features/hoondok/summaries/rich-document";

describe("리치 본문의 저장·재편집", () => {
  it("이미지·영상·표·서식을 다시 열어도 보존하고 자산 URL을 저장하지 않는다", () => {
    const image = {
      type: "image",
      attrs: {
        asset_id: "11111111-1111-4111-8111-111111111111",
        alt: "새벽 정원",
        caption: "함께 살펴보기",
        width_percent: 75,
        align: "center",
      },
    };
    const editor = new Editor({
      extensions: summaryExtensions(() => "/api/backend/admin/hoondok/ai-summaries/unit/media/asset"),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [
              {
                type: "text",
                text: "말씀을 함께 읽습니다",
                marks: [
                  { type: "underline" },
                  { type: "highlight", attrs: { color: "#fff3a3" } },
                  { type: "textStyle", attrs: { color: "#224433", fontSize: "20px" } },
                ],
              },
            ],
          },
          image,
          { type: "imageRow", content: [image, image] },
          { type: "youtube", attrs: { video_id: "abcdefghijk", start_seconds: 14 } },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "핵심" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const saved = canonicalDocument(editor.getJSON());
    expect(JSON.stringify(saved)).not.toContain("/api/backend");
    expect(JSON.stringify(saved)).not.toContain('"src"');
    expect(saved.content?.find((node) => node.type === "youtube")?.attrs).toEqual({
      video_id: "abcdefghijk",
      start_seconds: 14,
    });
    const reopened = new Editor({
      extensions: summaryExtensions(() => "/api/backend/admin/hoondok/ai-summaries/unit/media/asset"),
      content: saved,
    });
    expect(canonicalDocument(reopened.getJSON())).toEqual(saved);
    expect(reopened.getHTML()).toContain("youtube-nocookie.com/embed/abcdefghijk?start=14");
    expect(reopened.getHTML()).toContain("함께 살펴보기");
    reopened.destroy();
    editor.destroy();
  });
  it("YouTube 주소만 받아 영상 번호와 시작 시각으로 변환한다", () => {
    expect(youtubeVideo("https://youtu.be/abcdefghijk?t=42")).toEqual({ video_id: "abcdefghijk", start_seconds: 42 });
    expect(youtubeVideo("https://www.youtube.com/watch?v=abcdefghijk")).toEqual({
      video_id: "abcdefghijk",
      start_seconds: 0,
    });
    expect(youtubeVideo("https://evil.example/watch?v=abcdefghijk")).toBeNull();
    expect(youtubeVideo("javascript:alert(1)")).toBeNull();
    expect(youtubeVideo("https://www.youtube.com/watch?v=bad")).toBeNull();
  });
});

it("Word 붙여넣기의 pt 크기와 rgb 색을 저장 가능한 값으로 정규화한다", () => {
  expect(
    canonicalDocument({
      type: "text",
      text: "붙여넣은 글",
      marks: [{ type: "textStyle", attrs: { fontSize: "15pt", color: "rgb(34, 68, 51)" } }],
    }).marks,
  ).toEqual([{ type: "textStyle", attrs: { fontSize: "20px", color: "#224433" } }]);
});


it("공식 이미지 업로드 폼은 임시 UI로만 유지하고 다른 본문은 저장한다", () => {
  expect(persistableDocument({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "작성 중인 본문" }] },
    { type: "imageUpload", attrs: { accept: "image/*", limit: 5 } },
    { type: "image", attrs: { asset_id: "11111111-1111-4111-8111-111111111111", alt: "이미지", caption: "", width_percent: 100, align: "center" } },
  ] }).content?.map((node) => node.type)).toEqual(["paragraph", "image"]);
});
