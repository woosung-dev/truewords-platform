// 나의 기록 (C1). 형광펜·노트·북마크(API-HD-026)를 세고 거르고 묶는 순수 함수 — 화면과 테스트가 함께 쓴다.
// 노트는 형광펜의 `note` 라서(ENT-HD-012) 노트 수는 형광펜 수에 포함된다.
// 수는 내 기록이 몇 개인지만 말한다 — 남과 비교·평균·증감·목표는 두지 않는다 (DEC-PWA-019).
import type { MarkItem, SectionItem } from "@truewords/api-client-ts/types";
import { HIGHLIGHT_COLORS, type HighlightColor } from "../library/components/passage-sheet";

export const RECORDS_PATH = "/hoondok/records";
/** 이 기기에만 있는 기록(오늘의 한 줄·저장한 AI 답). 서버를 부르지 않는다. */
export const DEVICE_RECORDS_PATH = "/hoondok/records/device";

/** API-HD-026 한 요청의 상한(기본값). 이만큼 왔으면 더 있을 수 있어 수 뒤에 "+" 를 붙인다. */
export const MARKS_LIMIT = 200;

export type RecordTab = "highlight" | "note" | "bookmark";

export const RECORD_TABS: readonly { id: RecordTab; label: string }[] = [
  { id: "highlight", label: "형광펜" },
  { id: "note", label: "노트" },
  { id: "bookmark", label: "북마크" },
];

export type RecordsFilter = { tab: RecordTab; color: HighlightColor | null; volume: string | null };

type ParamReader = { get(name: string): string | null };

/** URL(`?tab=&color=&volume=`)이 화면 상태의 원본이다 — 뒤로 가기로 돌아와도 같은 칩이 골라져 있다. 모르는 값은 기본값. */
export function parseRecordsFilter(params: ParamReader): RecordsFilter {
  const tab = RECORD_TABS.find((item) => item.id === params.get("tab"))?.id ?? "highlight";
  const color = HIGHLIGHT_COLORS.find((item) => String(item) === params.get("color")) ?? null;
  const volume = params.get("volume") || null;
  return { tab, color, volume };
}

/** 기본값(형광펜·색 전체·권 전체)은 URL 에 쓰지 않는다. 북마크에는 색이 없어 색을 버린다. */
export function recordsHref(filter: Partial<RecordsFilter> = {}): string {
  const params = new URLSearchParams();
  const tab = filter.tab ?? "highlight";
  if (tab !== "highlight") params.set("tab", tab);
  if (filter.color && tab !== "bookmark") params.set("color", String(filter.color));
  if (filter.volume) params.set("volume", filter.volume);
  return params.size > 0 ? `${RECORDS_PATH}?${params}` : RECORDS_PATH;
}

export function hasNote(mark: MarkItem): boolean {
  return mark.kind === "highlight" && Boolean(mark.note?.trim());
}

export function marksOfTab(items: readonly MarkItem[], tab: RecordTab): MarkItem[] {
  if (tab === "note") return items.filter(hasNote);
  return items.filter((mark) => mark.kind === tab);
}

export function countRecords(items: readonly MarkItem[]): Record<RecordTab, number> {
  return {
    highlight: marksOfTab(items, "highlight").length,
    note: marksOfTab(items, "note").length,
    bookmark: marksOfTab(items, "bookmark").length,
  };
}

/** 상한까지 왔으면 "23+" — 적어도 그만큼 있다는 뜻만 전한다. 0 에는 붙이지 않는다. */
export function formatCount(count: number, isCapped: boolean): string {
  return isCapped && count > 0 ? `${count}+` : String(count);
}

export function isCapped(items: readonly MarkItem[]): boolean {
  return items.length >= MARKS_LIMIT;
}

export function colorCounts(items: readonly MarkItem[]): Record<HighlightColor, number> {
  const counts: Record<HighlightColor, number> = { 1: 0, 2: 0, 3: 0 };
  for (const mark of items) {
    const color = HIGHLIGHT_COLORS.find((item) => item === mark.color);
    if (color) counts[color] += 1;
  }
  return counts;
}

export function applyFilter(items: readonly MarkItem[], filter: RecordsFilter, skip?: "color" | "volume"): MarkItem[] {
  return marksOfTab(items, filter.tab).filter(
    (mark) =>
      (skip === "color" || filter.tab === "bookmark" || !filter.color || mark.color === filter.color) &&
      (skip === "volume" || !filter.volume || mark.volume === filter.volume),
  );
}

/** 권 표시명. 말씀선집은 `label` 이 "355권" 이라 제목에 붙이고, 제목에 이미 들어 있으면 그대로 둔다. */
export function volumeTitle(mark: Pick<MarkItem, "work_title" | "label">): string {
  return mark.work_title.includes(mark.label) ? mark.work_title : `${mark.work_title} ${mark.label}`;
}

export type VolumeGroup = { volume: string; title: string; count: number };

/** 권별 묶음. 목록이 최신순이라 처음 나온 순서 = 최근에 남긴 권부터다. */
export function volumeGroups(items: readonly MarkItem[]): VolumeGroup[] {
  const groups = new Map<string, VolumeGroup>();
  for (const mark of items) {
    const found = groups.get(mark.volume);
    if (found) found.count += 1;
    else groups.set(mark.volume, { volume: mark.volume, title: volumeTitle(mark), count: 1 });
  }
  return [...groups.values()];
}

/** 청크를 품는 장. 편(level 1)과 장(level 2)이 겹치면 더 좁은 장 — 원문 뷰의 현재 장(API-HD-016)과 같은 규칙이다. */
function sectionOf(sections: readonly SectionItem[], chunkIndex: number): SectionItem | null {
  let best: SectionItem | null = null;
  for (const section of sections) {
    if (section.start_chunk_index > chunkIndex || section.end_chunk_index < chunkIndex) continue;
    if (!best || section.level > best.level || (section.level === best.level && section.position > best.position))
      best = section;
  }
  return best;
}

export type SectionGroup = { section: SectionItem | null; items: MarkItem[] };

/** 한 권을 원문 순서로 놓고 장 머리 아래에 묶는다. 목차가 없거나 장 밖 단락은 머리 없는 묶음이다. */
export function sectionGroups(items: readonly MarkItem[], sections: readonly SectionItem[]): SectionGroup[] {
  const ordered = [...items].sort((a, b) => a.chunk_index - b.chunk_index || a.kind.localeCompare(b.kind));
  const groups: SectionGroup[] = [];
  for (const mark of ordered) {
    const section = sectionOf(sections, mark.chunk_index);
    const last = groups.at(-1);
    if (last && last.section?.position === section?.position) last.items.push(mark);
    else groups.push({ section, items: [mark] });
  }
  return groups;
}

/** "9월 28일" (KST). 표시가 남은 날짜만 적는다. */
export function recordDateLabel(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(date);
}
