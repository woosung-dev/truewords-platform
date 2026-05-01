"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DuplicateCheckResponse } from "@/features/data-source/types";

// ADR-30: 재업로드 시 사용자 의사결정.
//   merge   — 기존 분류 보존 + 신규 분류 합집합 + 콘텐츠 갱신 (default 권장)
//   add-tag — 임베딩 없이 카테고리 태그만 추가 (volume-tags API)
//   replace — 신규 분류로 통째 교체 + 콘텐츠 갱신 (위험)
//   cancel  — 업로드 중단
export type DuplicateDecision = "merge" | "add-tag" | "replace" | "cancel";

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

  const targetLabel = targetSource ? targetSource : "미분류";

  // merge 결과 미리보기 — 기존 ∪ 신규 (실제 backend 계산과 동일 시맨틱)
  const mergedPreview = (() => {
    const set = new Set(duplicate.sources.filter((s) => s));
    if (targetSource) set.add(targetSource);
    const arr = Array.from(set).sort();
    return arr.length > 0 ? arr.join(", ") : "미분류";
  })();

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
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-warning">
              <AlertTriangle className="h-5 w-5" />
              동일 파일이 이미 존재합니다
            </Dialog.Title>
            <Dialog.Close
              aria-label="닫기"
              className="rounded-lg p-1 text-muted-foreground hover:bg-admin-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border bg-admin-muted/30 p-3 text-sm space-y-2">
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
                      className="text-xs bg-warning-soft text-warning border-warning-border"
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
              {/* 파일 식별자 — PR #99 hash 시점 이동 후 PARTIAL 도 보존. 동일 파일 재업로드
                  여부를 사용자가 직관 확인 (동일 파일이면 hash 8자리 동일). */}
              {duplicate.content_hash && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">파일 식별자</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {duplicate.content_hash}
                  </span>
                </div>
              )}
            </div>

            <div className="text-sm text-muted-foreground leading-relaxed">
              아래 옵션을 선택하세요. 기본은 <span className="font-medium text-foreground">내용 갱신 (분류 유지)</span>로,
              기존 분류(<span className="font-medium text-foreground">{existingSourcesLabel}</span>)에 이번 업로드 분류
              (<span className="font-medium text-foreground">{targetLabel}</span>)를 합쳐{" "}
              <span className="font-medium text-foreground">{mergedPreview}</span>로 적재됩니다.
            </div>
          </div>

          {/* 액션 — ADR-30 결정 매트릭스 */}
          <div className="flex flex-col gap-2 border-t px-6 py-4">
            <Button
              variant="default"
              autoFocus
              className="w-full justify-center whitespace-normal break-words text-left"
              onClick={() => decide("merge")}
            >
              내용 갱신 (분류 유지: {mergedPreview})
            </Button>
            {canAddTag && (
              <Button
                variant="outline"
                className="w-full justify-center whitespace-normal break-words"
                onClick={() => decide("add-tag")}
              >
                임베딩 없이 &quot;{targetSource}&quot; 태그만 추가
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full justify-center whitespace-normal break-words border-warning-border text-warning hover:bg-warning-soft"
              aria-describedby="replace-warning-text"
              onClick={() => decide("replace")}
            >
              덮어쓰기 (분류를 &quot;{targetLabel}&quot;로 교체)
            </Button>
            <span id="replace-warning-text" className="sr-only">
              위험: 기존 분류가 사라지고 신규 분류로 통째 교체됩니다.
            </span>
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
