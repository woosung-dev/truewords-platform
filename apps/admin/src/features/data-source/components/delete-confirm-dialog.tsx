"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, FileText, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// UI/UX 가이드 적용 (ui-ux-pro-max):
//   §1 a11y    — aria-label / aria-describedby / focus management / color-not-only
//   §2 touch   — loading-buttons (삭제 중 disable + spinner)
//   §4 style   — destructive-emphasis (red), primary-action(취소가 default), elevation
//   §7 motion  — modal-motion (scale+fade), reduced-motion 호환 (CSS transition만 사용)
//   §8 forms   — confirmation-dialogs + typed-confirm + input-labels + error-clarity
export interface DeleteTarget {
  volume: string;          // 타이핑 confirm 대상 (NFC 정규화된 volume_key)
  sources: string[];       // 분류 태그
  chunkCount: number;
}

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: DeleteTarget[];
  busy?: boolean;          // 외부에서 삭제 진행 중 표시
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

const VISIBLE_BULK_LIST_LIMIT = 8;

export default function DeleteConfirmDialog({
  open,
  onOpenChange,
  targets,
  busy = false,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isSingle = targets.length === 1;
  const totalChunks = targets.reduce((acc, t) => acc + (t.chunkCount || 0), 0);

  // typed-confirm 기준 — single은 volume 정확 입력, bulk는 "DELETE {N}" 같은 sentinel.
  // bulk에 카운트를 끼워 다른 N과 혼동 못 하도록 함.
  const expectedConfirm = useMemo(() => {
    if (isSingle) return targets[0]?.volume ?? "";
    return `DELETE ${targets.length}`;
  }, [isSingle, targets]);

  const matched = typedValue.trim() === expectedConfirm;
  const canSubmit = matched && !busy && targets.length > 0;

  useEffect(() => {
    if (open) {
      // open 전이 시점에 typed input을 reset + 포커스. 기존 chatbot-form/volume-transfer-sheet
      // 와 동일 패턴 (eslint react-hooks/set-state-in-effect는 의도된 동작이라 disable).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTypedValue("");
      // a11y — focus-management: base-ui Dialog의 자체 focus trap이 default focusable
      // (보통 Close 버튼)에 먼저 focus를 주므로, setTimeout으로 다음 tick에서 input에 다시 이동.
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    await onConfirm();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className="fixed inset-0 z-50 m-auto flex h-fit w-full max-w-lg flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95"
          aria-describedby="delete-warning-text"
        >
          {/* 헤더 — destructive 시각 강조 (color + icon + text) */}
          <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/5 px-6 py-4 rounded-t-2xl">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="h-5 w-5" />
              {isSingle ? "파일 영구 삭제" : `${targets.length}개 파일 영구 삭제`}
            </Dialog.Title>
            <Dialog.Close
              aria-label="닫기"
              className="rounded-lg p-1 text-muted-foreground hover:bg-admin-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="space-y-4 px-6 py-5 max-h-[60vh] overflow-y-auto">
            {/* 영향 데이터 */}
            {isSingle ? (
              <div className="rounded-lg border bg-admin-muted/30 p-3 text-sm space-y-2">
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">파일명</span>
                  <span className="font-medium break-all">{targets[0]?.volume}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">분류</span>
                  <div className="flex flex-wrap gap-1">
                    {targets[0]?.sources && targets[0].sources.length > 0 ? (
                      targets[0].sources.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">
                          {s}
                        </Badge>
                      ))
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs bg-warning-soft text-warning border-warning-border"
                      >
                        미분류
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">청크 수</span>
                  <span className="tabular-nums">
                    {(targets[0]?.chunkCount ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-admin-muted/30 p-3 text-sm">
                <div className="flex gap-3 mb-2">
                  <span className="text-muted-foreground">총</span>
                  <span className="font-medium tabular-nums">
                    {targets.length}개 파일 / {totalChunks.toLocaleString()}개 청크
                  </span>
                </div>
                <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                  {targets.slice(0, VISIBLE_BULK_LIST_LIMIT).map((t) => (
                    <li
                      key={t.volume}
                      className="flex items-center gap-2 min-w-0"
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span
                        className="truncate min-w-0 flex-1"
                        title={t.volume}
                      >
                        {t.volume}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {t.chunkCount.toLocaleString()}청크
                      </span>
                    </li>
                  ))}
                </ul>
                {targets.length > VISIBLE_BULK_LIST_LIMIT && (
                  <div className="text-xs text-muted-foreground mt-2 text-right">
                    … 외 {targets.length - VISIBLE_BULK_LIST_LIMIT}개
                  </div>
                )}
              </div>
            )}

            {/* 위험 안내 — color-not-only 충족 (icon + text + color) */}
            <div
              id="delete-warning-text"
              role="alert"
              aria-live="polite"
              className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-medium">되돌릴 수 없는 작업입니다.</div>
                <div className="text-xs text-destructive/80">
                  Qdrant의 모든 청크와 적재 이력(IngestionJob)이 영구 삭제됩니다.
                  취소하려면 같은 파일을 다시 업로드해야 합니다.
                </div>
              </div>
            </div>

            {/* typed-confirm — input-labels + helper-text + autoFocus */}
            <div className="space-y-2">
              <label
                htmlFor="delete-typed-confirm"
                className="block text-sm font-medium"
              >
                확인을 위해{" "}
                <code className="px-1.5 py-0.5 rounded bg-admin-muted text-xs font-mono break-all">
                  {expectedConfirm}
                </code>
                을 입력하세요
              </label>
              <input
                id="delete-typed-confirm"
                ref={inputRef}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                aria-invalid={typedValue.length > 0 && !matched}
                aria-describedby="delete-typed-helper"
                className={`w-full rounded-md border px-3 py-2 text-sm bg-background outline-none transition-colors ${
                  typedValue.length > 0 && !matched
                    ? "border-destructive/60 focus:border-destructive"
                    : matched
                      ? "border-success focus:border-success"
                      : "border-input focus:border-ring"
                }`}
                placeholder={expectedConfirm}
                disabled={busy}
              />
              <p
                id="delete-typed-helper"
                className="text-xs text-muted-foreground"
              >
                {matched
                  ? "✓ 일치합니다. 아래 영구 삭제를 누르면 즉시 실행됩니다."
                  : "정확히 일치하지 않으면 영구 삭제 버튼이 활성되지 않습니다."}
              </p>
            </div>
          </div>

          {/* 액션 — primary-action(취소가 안전한 default) + destructive 분리 */}
          <div className="flex gap-2 border-t px-6 py-4">
            <Button
              variant="outline"
              className="flex-1 justify-center"
              onClick={handleCancel}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              className="flex-1 justify-center"
              onClick={handleConfirm}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  삭제 중...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  영구 삭제
                </>
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
