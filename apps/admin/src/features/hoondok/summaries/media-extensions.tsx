"use client";

import Image from "next/image";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { PointerEvent } from "react";

type MediaOptions = { resolveAsset: (id: string) => string | undefined };
function ImageView({ node, extension, updateAttributes, selected }: NodeViewProps) {
  const a = node.attrs;
  const resolve = extension.options.resolveAsset as MediaOptions["resolveAsset"];
  function resize(event: PointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const figure = event.currentTarget.closest("figure");
    const parent = figure?.parentElement;
    if (!figure || !parent) return;
    const start = event.clientX,
      width = figure.getBoundingClientRect().width,
      available = parent.getBoundingClientRect().width;
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) =>
      updateAttributes({
        width_percent: Math.max(25, Math.min(100, Math.round(((width + e.clientX - start) / available) * 100))),
      });
    const end = () => {
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerup", end);
      button.removeEventListener("pointercancel", end);
    };
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerup", end);
    button.addEventListener("pointercancel", end);
  }
  return (
    <NodeViewWrapper
      as="figure"
      className={`summary-body-image tiptap-image${selected ? " is-selected" : ""}`}
      data-align={a.align}
      style={{ width: `${a.width_percent}%` }}
      contentEditable={false}
    >
      {resolve(a.asset_id) ? (
        <Image
          unoptimized
          width={1200}
          height={800}
          src={resolve(a.asset_id) ?? ""}
          alt={a.alt || ""}
          draggable={false}
        />
      ) : (
        <div className="summary-image-missing">이미지를 불러올 수 없습니다</div>
      )}
      {a.caption && <figcaption>{a.caption}</figcaption>}
      {selected && (
        <span className="tiptap-image-handle" role="presentation" contentEditable={false} onPointerDown={resize} />
      )}
    </NodeViewWrapper>
  );
}
export const ManagedImage = Node.create<MediaOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { resolveAsset: () => undefined };
  },
  addAttributes() {
    return {
      asset_id: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      width_percent: { default: 100 },
      align: { default: "center" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-summary-image]",
        getAttrs: (el) => ({
          asset_id: el.getAttribute("data-asset-id") ?? "",
          alt: el.querySelector("img")?.alt ?? "",
          caption: el.querySelector("figcaption")?.textContent ?? "",
          width_percent: Number(el.getAttribute("data-width") ?? 100),
          align: el.getAttribute("data-align") ?? "center",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes: a }) {
    return [
      "figure",
      {
        "data-summary-image": "",
        "data-asset-id": a.asset_id,
        "data-width": a.width_percent,
        "data-align": a.align,
        style: `width:${a.width_percent}%;${a.align === "center" ? "margin-inline:auto" : a.align === "right" ? "margin-left:auto" : ""}`,
      },
      ["img", { src: this.options.resolveAsset(a.asset_id) || "", alt: a.alt || "" }],
      ["figcaption", {}, a.caption || ""],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
export const ImageRow = Node.create({
  name: "imageRow",
  group: "block",
  content: "image image",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-image-row]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-image-row": "", class: "summary-image-row" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(function RowView() {
      return (
        <NodeViewWrapper className="summary-image-row">
          <NodeViewContent className="summary-image-row-content" />
        </NodeViewWrapper>
      );
    });
  },
});
export const ManagedYoutube = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { video_id: { default: "" }, start_seconds: { default: 0 } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-summary-youtube]",
        getAttrs: (el) => ({
          video_id: el.getAttribute("data-video-id"),
          start_seconds: Number(el.getAttribute("data-start") || 0),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes: a }) {
    if (!/^[\w-]{11}$/.test(a.video_id ?? "")) return ["p", {}, "영상 주소를 확인해 주세요."];
    return [
      "div",
      {
        "data-summary-youtube": "",
        "data-video-id": a.video_id,
        "data-start": a.start_seconds,
        class: "summary-video",
      },
      [
        "iframe",
        {
          src: `https://www.youtube-nocookie.com/embed/${a.video_id}?start=${Number(a.start_seconds) || 0}`,
          title: "본문 영상",
          loading: "lazy",
          allowFullScreen: true,
          referrerPolicy: "strict-origin-when-cross-origin",
          sandbox: "allow-scripts allow-same-origin allow-presentation",
          allow: "encrypted-media; picture-in-picture",
        },
      ],
    ];
  },
});
