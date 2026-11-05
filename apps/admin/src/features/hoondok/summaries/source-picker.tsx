"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchAPI } from "@/lib/api";
import type {
  SourceBook,
  SourceSnapshotInfo,
  SourceBlock,
  SourcePassages,
  SourceRangeResult,
} from "@truewords/api-client-ts/types";

export function SourcePicker({
  contentRightId,
  onApply,
  lockBook = false,
}: {
  lockBook?: boolean;
  contentRightId?: string;
  onApply: (range: SourceRangeResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState(contentRightId ?? "");
  const [snapshot, setSnapshot] = useState<SourceSnapshotInfo | null>(null);
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [start, setStart] = useState<SourceBlock | null>(null);
  const [end, setEnd] = useState<SourceBlock | null>(null);
  const [startOffset, setStartOffset] = useState(0);
  const [endOffset, setEndOffset] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [ranges, setRanges] = useState<SourceRangeResult[]>([]);
  const [active, setActive] = useState<SourceRangeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const books = useQuery({
    queryKey: ["summary-source-books"],
    queryFn: () => fetchAPI<SourceBook[]>("/admin/hoondok/source-books"),
    enabled: open,
  });
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "원문을 불러올 수 없어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function passages(info: SourceSnapshotInfo, offset = 0, blockId?: string) {
    const query = new URLSearchParams({ offset: String(offset), limit: "40" });
    if (blockId) query.set("start_block_id", blockId);
    const data = await fetchAPI<SourcePassages>(`/admin/hoondok/source-snapshots/${info.id}/passages?${query}`);
    setBlocks((old) => (offset && !blockId ? [...old, ...data.blocks] : data.blocks));
    setNext(data.next_offset ?? null);
  }
  async function loadBook(id: string) {
    setBook(id);
    setStart(null);
    setEnd(null);
    setActive(null);
    setSnapshot(null);
    setBlocks([]);
    const info = await fetchAPI<SourceSnapshotInfo>(`/admin/hoondok/source-books/${id}/snapshots`, { method: "POST" });
    setSnapshot(info);
    await passages(info);
    setRanges(await fetchAPI<SourceRangeResult[]>(`/admin/hoondok/source-ranges?content_right_id=${id}`));
  }
  function select(block: SourceBlock) {
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode?.parentElement?.closest("[data-source-text]") &&
      selection.focusNode?.parentElement?.closest("[data-source-text]")
    )
      return;
    setStartOffset(0);
    setEndOffset(null);
    if (!start || end) {
      setStart(block);
      setEnd(null);
    } else {
      setStart(start.position <= block.position ? start : block);
      setEnd(start.position <= block.position ? block : start);
    }
  }
  const last = end ?? start;
  async function saveRange() {
    if (!snapshot || !start || !last || !title.trim()) throw new Error("원문 범위와 구간 이름을 정해 주세요.");
    if (
      active &&
      active.snapshot_id === snapshot.id &&
      active.start_block_id === start.id &&
      active.end_block_id === last.id &&
      (active.start_offset ?? 0) === startOffset &&
      (active.end_offset ?? null) === endOffset &&
      active.title === title &&
      (active.group_title ?? "") === group
    )
      return active;
    const result = await fetchAPI<SourceRangeResult>(`/admin/hoondok/source-ranges${active ? `/${active.id}` : ""}`, {
      method: active ? "PUT" : "POST",
      body: JSON.stringify({
        snapshot_id: snapshot.id,
        start_block_id: start.id,
        end_block_id: last.id,
        start_offset: startOffset,
        end_offset: endOffset,
        title,
        group_title: group,
        ...(active ? { version: active.version } : {}),
      }),
    });
    setActive(result);
    setRanges(await fetchAPI<SourceRangeResult[]>(`/admin/hoondok/source-ranges?content_right_id=${book}`));
    return result;
  }
  async function restoreRange(range: SourceRangeResult) {
    if (!snapshot || snapshot.id !== range.snapshot_id)
      throw new Error("원문이 갱신됐어요. 범위를 다시 선택해 주세요.");
    const first = await fetchAPI<SourcePassages>(
      `/admin/hoondok/source-snapshots/${snapshot.id}/passages?start_block_id=${range.start_block_id}&limit=1`,
    );
    const last = await fetchAPI<SourcePassages>(
      `/admin/hoondok/source-snapshots/${snapshot.id}/passages?start_block_id=${range.end_block_id}&limit=1`,
    );
    setStart(first.blocks[0]);
    setEnd(last.blocks[0]);
    setStartOffset(range.start_offset ?? 0);
    setEndOffset(range.end_offset ?? null);
    setActive(range);
    setTitle(range.title);
    setGroup(range.group_title ?? "");
  }
  function apply(range: SourceRangeResult) {
    onApply(range);
    setOpen(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
          if (contentRightId && (!snapshot || snapshot.content_right_id !== contentRightId))
            void task(() => loadBook(contentRightId));
        }}
      >
        말씀 선택·변경
      </Button>
      <DialogContent className="h-[min(90dvh,900px)] max-w-6xl overflow-hidden p-0">
        <header className="flex items-start justify-between border-b p-5">
          <div>
            <Dialog.Title className="text-xl font-semibold">말씀에서 범위 선택</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              첫·끝 문단을 누르거나, 구절을 드래그하면 원문 위치가 자동으로 연결됩니다.
            </Dialog.Description>
          </div>
          <Dialog.Close render={<Button type="button" variant="ghost" />}>닫기</Dialog.Close>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <label className="text-sm">
            말씀 책{" "}
            <select
              disabled={lockBook || busy}
              aria-label="말씀 책"
              className="ml-2 max-w-[60vw] rounded border bg-background p-2"
              value={book}
              onChange={(e) => {
                const id = e.target.value;
                if (id) void task(() => loadBook(id));
              }}
            >
              <option value="">책을 선택하세요</option>
              {books.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!book || busy}
            onClick={() => void task(() => loadBook(book))}
          >
            원문 다시 불러오기
          </Button>
          {busy && (
            <span role="status" className="text-sm">
              원문을 연결하고 있어요.
            </span>
          )}
          {books.isError && (
            <Button type="button" onClick={() => void books.refetch()}>
              책 목록 재시도
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="px-5 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[190px_minmax(0,1fr)_270px] md:overflow-hidden">
          <nav
            aria-label="말씀 목차"
            className="max-h-44 overflow-auto border-b p-4 md:max-h-none md:border-r md:pb-10"
          >
            <h3 className="mb-3 font-semibold">목차</h3>
            {snapshot?.sections.map((s) => (
              <button
                type="button"
                className="mb-1 block w-full rounded p-2 text-left text-sm hover:bg-muted"
                key={s.id}
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    await passages(snapshot, 0, s.start_block_id);
                    setGroup(s.title);
                  })
                }
              >
                {s.title}
              </button>
            ))}
          </nav>
          <section aria-label="원문 문단" className="min-w-0 p-4 md:overflow-auto">
            <p className="mb-3 text-xs text-muted-foreground">
              {snapshot?.edition} · 화면의 문단 번호는 선택을 돕는 표시입니다.
            </p>
            {blocks.map((b) => (
              <button
                type="button"
                key={b.id}
                aria-pressed={
                  !!start && b.position >= start.position && b.position <= (last?.position ?? start.position)
                }
                className="mb-2 block w-full rounded-lg border p-4 text-left text-sm leading-8 hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/5"
                onClick={() => select(b)}
                onMouseUp={() => {
                  const selection = window.getSelection();
                  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
                  const range = selection.getRangeAt(0);
                  const firstSpan = range.startContainer.parentElement?.closest("[data-source-text]");
                  const lastSpan = range.endContainer.parentElement?.closest("[data-source-text]");
                  const firstBlock = blocks.find((row) => row.id === firstSpan?.getAttribute("data-block-id"));
                  const lastBlock = blocks.find((row) => row.id === lastSpan?.getAttribute("data-block-id"));
                  if (!firstSpan || !lastSpan || !firstBlock || !lastBlock) return;
                  const prefix = document.createRange();
                  prefix.selectNodeContents(firstSpan);
                  prefix.setEnd(range.startContainer, range.startOffset);
                  const a = Array.from(prefix.toString()).length;
                  prefix.selectNodeContents(lastSpan);
                  prefix.setEnd(range.endContainer, range.endOffset);
                  const z = Array.from(prefix.toString()).length;
                  setStart(firstBlock);
                  setEnd(lastBlock);
                  setStartOffset(a);
                  setEndOffset(z);
                }}
              >
                <span className="mb-1 block text-xs text-muted-foreground">{b.label}</span>
                <span data-source-text data-block-id={b.id} className="select-text whitespace-pre-wrap">
                  {b.text}
                </span>
              </button>
            ))}
            {next !== null && snapshot && (
              <Button type="button" disabled={busy} onClick={() => void task(() => passages(snapshot, next))}>
                원문 더 보기
              </Button>
            )}
          </section>
          <aside className="border-t p-4 md:overflow-auto md:border-l md:border-t-0">
            <h3 className="font-semibold">선택한 범위</h3>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setActive(null);
                setStart(null);
                setEnd(null);
                setTitle("");
              }}
            >
              새 구간 만들기
            </Button>
            <p className="my-3 line-clamp-3 text-sm leading-7">
              시작:{" "}
              {start
                ? Array.from(start.text)
                    .slice(startOffset, start.id === last?.id ? (endOffset ?? undefined) : undefined)
                    .join("")
                : "원문을 선택하세요"}
            </p>
            <p className="my-3 line-clamp-3 text-sm leading-7">
              끝:{" "}
              {last
                ? Array.from(last.text)
                    .slice(start?.id === last.id ? startOffset : 0, endOffset ?? undefined)
                    .join("")
                : ""}
            </p>
            <label className="mb-3 block text-sm">
              구간 이름
              <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="mb-3 block text-sm">
              그룹
              <Input className="mt-1" value={group} onChange={(e) => setGroup(e.target.value)} />
            </label>
            <Button
              type="button"
              disabled={busy || !start || !title.trim()}
              onClick={() =>
                void task(async () => {
                  await saveRange();
                })
              }
            >
              구간 저장
            </Button>
            <h3 className="mb-2 mt-7 font-semibold">저장한 구간</h3>
            {ranges.map((r) => (
              <div key={r.id} className="mb-3 rounded border p-3">
                <button
                  type="button"
                  className="text-left text-sm font-medium underline"
                  onClick={() =>
                    void task(async () => {
                      if (!snapshot || snapshot.id !== r.snapshot_id)
                        throw new Error("원문이 갱신됐어요. 현재 원문에서 범위를 다시 선택해 주세요.");
                      const first = await fetchAPI<SourcePassages>(
                        `/admin/hoondok/source-snapshots/${snapshot.id}/passages?start_block_id=${r.start_block_id}&limit=1`,
                      );
                      const last = await fetchAPI<SourcePassages>(
                        `/admin/hoondok/source-snapshots/${snapshot.id}/passages?start_block_id=${r.end_block_id}&limit=1`,
                      );
                      setStart(first.blocks[0]);
                      setEnd(last.blocks[0]);
                      setStartOffset(r.start_offset ?? 0);
                      setEndOffset(r.end_offset ?? null);
                      setActive(r);
                      setTitle(r.title);
                      setGroup(r.group_title ?? "");
                      await passages(snapshot, 0, r.start_block_id);
                    })
                  }
                >
                  {" "}
                  {r.title}
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => apply(r)}>
                    사용
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !start}
                    onClick={() =>
                      void task(async () => {
                        const divided = await fetchAPI<SourceRangeResult[]>(
                          `/admin/hoondok/source-ranges/${r.id}/split`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              version: r.version,
                              after_block_id: start?.id,
                              after_offset: start?.id === end?.id ? endOffset : null,
                              first_title: r.title + " 앞부분",
                              second_title: r.title + " 뒷부분",
                            }),
                          },
                        );
                        setRanges(
                          await fetchAPI<SourceRangeResult[]>(`/admin/hoondok/source-ranges?content_right_id=${book}`),
                        );
                        await restoreRange(divided[0]);
                      })
                    }
                  >
                    선택 위치에서 나누기
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !active || active.id === r.id}
                    onClick={() =>
                      void task(async () => {
                        const merged = await fetchAPI<SourceRangeResult>(
                          `/admin/hoondok/source-ranges/${active?.id}/merge`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              version: active?.version,
                              other_id: r.id,
                              other_version: r.version,
                              title: title || r.title,
                            }),
                          },
                        );
                        setRanges(
                          await fetchAPI<SourceRangeResult[]>(`/admin/hoondok/source-ranges?content_right_id=${book}`),
                        );
                        await restoreRange(merged);
                      })
                    }
                  >
                    선택 구간과 합치기
                  </Button>
                </div>
              </div>
            ))}
          </aside>
        </div>
        <footer className="flex justify-end gap-2 border-t p-4">
          <Button
            type="button"
            disabled={busy || (!active && (!start || !title.trim()))}
            onClick={() =>
              void task(async () => {
                const range = start ? await saveRange() : active;
                if (range) apply(range);
              })
            }
          >
            이 범위 적용
          </Button>
        </footer>
      </DialogContent>
    </Dialog.Root>
  );
}
