"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OnDuplicateMode } from "@/features/data-source/api";
import type { DuplicateCheckResponse } from "@/features/data-source/types";

// ADR-30 follow-up — 일괄 업로드 사전 검사 결과를 모은 뒤 정책을 한 번에 결정.
// 단건 dialog가 마지막 1건만 표출되어 나머지가 silently 처리되지 않던 BUG-A 해결.
export interface BulkPrecheckEntry {
  filename: string;
  duplicate: DuplicateCheckResponse;
}

interface BulkPrecheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newCount: number;
  duplicates: BulkPrecheckEntry[];
  defaultPolicy: OnDuplicateMode;
  onConfirm: (policy: OnDuplicateMode) => void;
  onCancel: () => void;
}

const POLICY_OPTIONS: { value: OnDuplicateMode; label: string; hint: string }[] = [
  {
    value: "skip",
    label: "콘텐츠 동일 시 건너뜀 (skip)",
    hint: "Gemini 임베딩 호출 0회 — 비용 절감. 콘텐츠가 변경되었으면 자동으로 분류 보존하며 갱신.",
  },
  {
    value: "merge",
    label: "내용 갱신 + 분류 합집합 (merge)",
    hint: "기존 분류는 보존하고 새 분류를 합쳐 저장. 콘텐츠는 모든 청크 재임베딩.",
  },
  {
    value: "replace",
    label: "덮어쓰기 (분류 통째 교체)",
    hint: "기존 분류를 신규 분류로 통째 교체. 의도적 분류 재구성 시에만 사용.",
  },
];

export default function BulkPrecheckDialog({
  open,
  onOpenChange,
  newCount,
  duplicates,
  defaultPolicy,
  onConfirm,
  onCancel,
}: BulkPrecheckDialogProps) {
  const [policy, setPolicy] = useState<OnDuplicateMode>(defaultPolicy);
  const dupCount = duplicates.length;
  const totalCount = newCount + dupCount;

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };
  const handleConfirm = () => {
    onConfirm(policy);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit w-full max-w-lg flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              일괄 업로드 사전 검사 ({totalCount}개)
            </Dialog.Title>
            <Dialog.Close
              aria-label="닫기"
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="space-y-4 px-6 py-5 max-h-[60vh] overflow-y-auto">
            {/* 통계 */}
            <div className="flex gap-3 text-sm">
              <div className="flex-1 rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">신규</div>
                <div className="text-xl font-semibold">{newCount}</div>
              </div>
              <div className="flex-1 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="text-xs text-amber-700">중복 감지</div>
                <div className="text-xl font-semibold text-amber-800">{dupCount}</div>
              </div>
            </div>

            {/* 중복 파일 목록 */}
            {dupCount > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  중복 파일 목록
                </div>
                <ul className="space-y-1.5 text-sm">
                  {duplicates.map((d) => (
                    <li
                      key={d.filename}
                      className="flex items-center gap-2 min-w-0"
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate min-w-0 flex-1" title={d.filename}>
                        {d.filename}
                      </span>
                      <div className="flex flex-wrap gap-1 shrink-0">
                        {d.duplicate.sources.length > 0 ? (
                          d.duplicate.sources.map((src) => (
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
                        <span className="text-xs text-muted-foreground ml-1">
                          {d.duplicate.chunk_count.toLocaleString()}청크
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 정책 선택 */}
            {dupCount > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">중복 파일을 어떻게 처리할까요?</div>
                <div className="space-y-2">
                  {POLICY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${
                        policy === opt.value
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="bulk-policy"
                        value={opt.value}
                        checked={policy === opt.value}
                        onChange={() => setPolicy(opt.value)}
                        className="accent-primary mt-1"
                      />
                      <div className="text-sm">
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {opt.hint}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 액션 */}
          <div className="flex gap-2 border-t px-6 py-4">
            <Button
              variant="ghost"
              className="flex-1 justify-center"
              onClick={handleCancel}
            >
              취소
            </Button>
            <Button
              variant="default"
              className="flex-1 justify-center"
              autoFocus
              onClick={handleConfirm}
            >
              {totalCount}개 모두 업로드
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
