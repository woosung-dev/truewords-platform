"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DuplicateCheckResponse } from "@/features/data-source/types";

export type DuplicateDecision = "overwrite" | "add-tag" | "cancel";

interface DuplicateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  targetSource: string;       // 사용자가 이번 업로드에 선택한 카테고리 key (빈 문자열 = 미분류)
  duplicate: DuplicateCheckResponse | null;
  onDecision: (decision: DuplicateDecision) => void;
}

export default function DuplicateConfirmDialog({
  open,
  onOpenChange,
  filename,
  targetSource,
  duplicate,
  onDecision,
}: DuplicateConfirmDialogProps) {
  if (!duplicate) return null;

  // "태그만 추가" 조건:
  // 1) 사용자가 카테고리를 선택했고 (미분류 아님)
  // 2) 기존 문서에 해당 태그가 아직 없고
  // 3) Qdrant에 청크가 실제로 존재할 때 (실제 포인트가 있어야 태그 추가 가능)
  const canAddTag =
    targetSource !== "" &&
    !duplicate.sources.includes(targetSource) &&
    duplicate.chunk_count > 0;

  const existingSourcesLabel =
    duplicate.sources.length > 0 ? duplicate.sources.join(", ") : "미분류";

  const lastUploadedLabel = duplicate.last_uploaded_at
    ? new Date(duplicate.last_uploaded_at).toLocaleString("ko-KR")
    : "-";

  const decide = (decision: DuplicateDecision) => {
    onDecision(decision);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit w-full max-w-md flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              동일 파일이 이미 존재합니다
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">파일명</span>
                <span className="font-medium break-all">{filename}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">기존 분류</span>
                <div className="flex flex-wrap gap-1">
                  {duplicate.sources.length > 0 ? (
                    duplicate.sources.map((src) => (
                      <Badge key={src} variant="outline" className="text-xs">
                        {src}
                      </Badge>
                    ))
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-50 text-amber-700 border-amber-200"
                    >
                      미분류
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">청크 수</span>
                <span>{duplicate.chunk_count.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">최근 업로드</span>
                <span className="text-muted-foreground">{lastUploadedLabel}</span>
              </div>
            </div>

            <div className="text-sm text-muted-foreground leading-relaxed">
              이대로 업로드하면 기존 문서를{" "}
              <span className="font-medium text-foreground">덮어쓰기</span>하며,
              기존 카테고리 태그(
              <span className="font-medium text-foreground">{existingSourcesLabel}</span>
              )는{" "}
              <span className="font-medium text-foreground">
                {targetSource ? targetSource : "미분류"}
              </span>
              로 대체됩니다.
            </div>
          </div>

          {/* 액션 */}
          <div className="flex flex-col gap-2 border-t px-6 py-4">
            {canAddTag && (
              <Button
                variant="default"
                className="w-full justify-center"
                onClick={() => decide("add-tag")}
              >
                기존 문서에 &quot;{targetSource}&quot; 태그만 추가
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full justify-center border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => decide("overwrite")}
            >
              덮어쓰고 다시 업로드
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-center"
              onClick={() => decide("cancel")}
            >
              취소
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
