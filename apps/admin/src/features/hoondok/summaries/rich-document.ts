import type { JSONContent } from "@tiptap/core";

const attrsFor: Record<string, readonly string[]> = {
  heading: ["level", "textAlign"],
  paragraph: ["textAlign"],
  orderedList: ["start", "type"],
  image: ["asset_id", "alt", "caption", "width_percent", "align"],
  youtube: ["video_id", "start_seconds"],
  tableCell: ["colspan", "rowspan", "colwidth"],
  tableHeader: ["colspan", "rowspan", "colwidth"],
  textStyle: ["color", "fontSize"],
  highlight: ["color"],
  link: ["href", "target", "rel", "class"],
};
function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value.toLowerCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!rgb) return undefined;
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return (
    "#" +
    rgb
      .slice(1, 4)
      .map((n) => hex(Number(n)))
      .join("") +
    (rgb[4] !== undefined ? hex(Math.round(Math.max(0, Math.min(1, Number(rgb[4]))) * 255)) : "")
  );
}
// 확장 기능의 임시 속성을 저장 계약에 섞지 않는다.
export function canonicalDocument(node: JSONContent): JSONContent {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([key, value]) => (attrsFor[node.type ?? ""] ?? []).includes(key) && value !== undefined && value !== null,
    ),
  );
  if (["textStyle", "highlight"].includes(node.type ?? "") && "color" in attrs) {
    const color = normalizeColor(attrs.color);
    if (color) attrs.color = color;
    else delete attrs.color;
  }
  if (node.type === "textStyle" && "fontSize" in attrs) {
    const size = String(attrs.fontSize).match(/^(\d+(?:\.\d+)?)(px|pt)$/);
    if (size)
      attrs.fontSize = `${Math.max(12, Math.min(64, Math.round(Number(size[1]) * (size[2] === "pt" ? 4 / 3 : 1))))}px`;
    else delete attrs.fontSize;
  }
  return {
    ...(node.type ? { type: node.type } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(canonicalDocument) } : {}),
    ...(node.marks ? { marks: node.marks.map((mark) => ({ ...canonicalDocument(mark), type: mark.type })) } : {}),
  };
}
export function youtubeVideo(input: string): { video_id: string; start_seconds: number } | null {
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(u.hostname))
      id = u.searchParams.get("v") || u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] || null;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "0";
    const seconds = /^\d+$/.test(t) ? Number(t) : 0;
    return { video_id: id, start_seconds: Math.min(86400, seconds) };
  } catch {
    return null;
  }
}
