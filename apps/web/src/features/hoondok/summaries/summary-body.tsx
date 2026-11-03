import Image from "next/image";
import { renderJSONContentToReactElement } from "@tiptap/static-renderer/json/react";
import type { SummaryMediaResponse } from "@truewords/api-client-ts/types";
import type { CSSProperties } from "react";

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Mark[] };
const nodeTypes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "image",
  "imageRow",
  "youtube",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const markTypes = new Set(["bold", "italic", "underline", "link", "highlight", "textStyle"]);
const color = (value: unknown): value is string =>
  typeof value === "string" && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
const fontSize = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d+px$/.test(value) &&
  Number(value.slice(0, -2)) >= 12 &&
  Number(value.slice(0, -2)) <= 64;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function documentNode(value: unknown, depth = 0): value is Node {
  if (!record(value) || depth > 20 || typeof value.type !== "string" || !nodeTypes.has(value.type)) return false;
  if (value.text !== undefined && typeof value.text !== "string") return false;
  if (value.attrs !== undefined && !record(value.attrs)) return false;
  const a = record(value.attrs) ? value.attrs : {};
  if (value.type === "heading" && ![2, 3].includes(Number(a.level))) return false;
  if (a.textAlign !== undefined && ![null, "left", "center", "right", "justify"].includes(a.textAlign as string | null))
    return false;
  if (
    value.type === "image" &&
    (typeof a.asset_id !== "string" ||
      typeof a.alt !== "string" ||
      (a.width_percent !== undefined &&
        (!Number.isInteger(a.width_percent) || Number(a.width_percent) < 25 || Number(a.width_percent) > 100)) ||
      (a.align !== undefined && !["left", "center", "right"].includes(String(a.align))))
  )
    return false;
  if (
    value.type === "youtube" &&
    (typeof a.video_id !== "string" ||
      !/^[\w-]{11}$/.test(a.video_id) ||
      (a.start_seconds !== undefined &&
        (!Number.isInteger(a.start_seconds) || Number(a.start_seconds) < 0 || Number(a.start_seconds) > 86400)))
  )
    return false;
  if (
    value.content !== undefined &&
    (!Array.isArray(value.content) || !value.content.every((child) => documentNode(child, depth + 1)))
  )
    return false;
  if (
    value.type === "imageRow" &&
    (!Array.isArray(value.content) ||
      value.content.length !== 2 ||
      value.content.some((c: unknown) => !record(c) || c.type !== "image"))
  )
    return false;
  if (
    value.marks !== undefined &&
    (!Array.isArray(value.marks) ||
      !value.marks.every((mark: unknown) => {
        if (!record(mark) || typeof mark.type !== "string" || !markTypes.has(mark.type)) return false;
        if (mark.attrs !== undefined && !record(mark.attrs)) return false;
        const attrs = record(mark.attrs) ? mark.attrs : {};
        if (mark.type === "link") return typeof attrs.href === "string" && /^https?:\/\//i.test(attrs.href);
        if (mark.type === "highlight") return attrs.color === undefined || color(attrs.color);
        if (mark.type === "textStyle")
          return (
            (attrs.color === undefined || color(attrs.color)) &&
            (attrs.fontSize === undefined || fontSize(attrs.fontSize))
          );
        return true;
      }))
  )
    return false;
  return true;
}
function textAlign(node: Node): CSSProperties {
  return {
    textAlign: ["left", "center", "right", "justify"].includes(String(node.attrs?.textAlign))
      ? (node.attrs?.textAlign as CSSProperties["textAlign"])
      : undefined,
  };
}
export function SummaryBody({ body, assets = [] }: { body: unknown; assets?: SummaryMediaResponse[] }) {
  if (!documentNode(body) || body.type !== "doc")
    return <p role="alert">해설을 표시할 수 없어요. 원문을 확인해 주세요.</p>;
  const resolve = (id: unknown) =>
    assets.find((asset) => asset.id === id && asset.url.startsWith("/api/backend/hoondok/ai-summaries/"))?.url;
  const render = renderJSONContentToReactElement<Mark, Node>({
    nodeMapping: {
      doc: ({ children }) => <>{children}</>,
      paragraph: ({ node, children }) => <p style={textAlign(node)}>{children}</p>,
      text: ({ node }) => node.text ?? "",
      heading: ({ node, children }) =>
        node.attrs?.level === 3 ? (
          <h3 style={textAlign(node)}>{children}</h3>
        ) : (
          <h2 style={textAlign(node)}>{children}</h2>
        ),
      bulletList: ({ children }) => <ul>{children}</ul>,
      orderedList: ({ node, children }) => (
        <ol start={typeof node.attrs?.start === "number" ? node.attrs.start : undefined}>{children}</ol>
      ),
      listItem: ({ children }) => <li>{children}</li>,
      blockquote: ({ children }) => <blockquote>{children}</blockquote>,
      hardBreak: () => <br />,
      image: ({ node }) => {
        const a = node.attrs ?? {},
          src = resolve(a.asset_id);
        return (
          <figure
            className="sum-body-image"
            data-align={a.align ?? "center"}
            style={{ width: `${a.width_percent ?? 100}%` }}
          >
            {src ? (
              <Image unoptimized width={1200} height={800} src={src} alt={String(a.alt ?? "")} loading="lazy" />
            ) : (
              <p className="sum-notice">이미지를 불러올 수 없어요.</p>
            )}
            {a.caption ? <figcaption>{String(a.caption)}</figcaption> : null}
          </figure>
        );
      },
      imageRow: ({ children }) => <div className="sum-image-row">{children}</div>,
      youtube: ({ node }) => (
        <div className="sum-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${node.attrs?.video_id}?start=${Number(node.attrs?.start_seconds) || 0}`}
            title="본문 영상"
            loading="lazy"
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ),
      table: ({ children }) => (
        <div className="sum-table">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      ),
      tableRow: ({ children }) => <tr>{children}</tr>,
      tableCell: ({ node, children }) => (
        <td colSpan={Number(node.attrs?.colspan) || 1} rowSpan={Number(node.attrs?.rowspan) || 1}>
          {children}
        </td>
      ),
      tableHeader: ({ node, children }) => (
        <th colSpan={Number(node.attrs?.colspan) || 1} rowSpan={Number(node.attrs?.rowspan) || 1}>
          {children}
        </th>
      ),
    },
    markMapping: {
      bold: ({ children }) => <strong>{children}</strong>,
      italic: ({ children }) => <em>{children}</em>,
      underline: ({ children }) => <u>{children}</u>,
      link: ({ mark, children }) => (
        <a href={String(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
      highlight: ({ mark, children }) => (
        <mark style={color(mark.attrs?.color) ? { backgroundColor: mark.attrs.color } : undefined}>{children}</mark>
      ),
      textStyle: ({ mark, children }) => (
        <span
          style={{
            ...(color(mark.attrs?.color) ? { color: mark.attrs.color } : {}),
            ...(fontSize(mark.attrs?.fontSize) ? { fontSize: mark.attrs.fontSize } : {}),
          }}
        >
          {children}
        </span>
      ),
    },
  });
  return <div className="sum-body">{render({ content: body })}</div>;
}
