"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VolumeTransfer from "@/features/data-source/components/volume-transfer";
import {
  useAllVolumes,
  useActiveCategories,
  useAddVolumeTagsBulk,
  useRemoveVolumeTagsBulk,
} from "@/features/data-source/hooks";
import { getCategoryColors } from "@/features/data-source/category-colors";

interface VolumeTransferSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryKey: string | null;
  categoryName: string;
  categoryColor?: string;
}

export default function VolumeTransferSheet({
  open,
  onOpenChange,
  categoryKey,
  categoryName,
  categoryColor,
}: VolumeTransferSheetProps) {
  const queryClient = useQueryClient();
  const { data: allVolumes = [], refetch } = useAllVolumes();
  const { data: activeCategories = [] } = useActiveCategories();
  const bulkAddMutation = useAddVolumeTagsBulk();
  const bulkRemoveMutation = useRemoveVolumeTagsBulk();

  const [includedVolumes, setIncludedVolumes] = useState<Set<string>>(new Set());
  const [initialIncluded, setInitialIncluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const categoryMap = useMemo(
    () => new Map(activeCategories.map((c) => [c.key, { name: c.name, color: c.color }])),
    [activeCategories]
  );

  const [selectedCategoryForUncategorized, setSelectedCategoryForUncategorized] =
    useState<string>("");

  const effectiveKey = categoryKey ?? selectedCategoryForUncategorized;

  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && allVolumes.length > 0 && effectiveKey) {
      const included = new Set(
        allVolumes
          .filter((v) => v.sources.includes(effectiveKey))
          .map((v) => v.volume)
      );
      setIncludedVolumes(included);
      setInitialIncluded(included);
    }
  }, [open, allVolumes, effectiveKey]);

  const handleMove = useCallback(
    (volumes: string[], direction: "add" | "remove") => {
      setIncludedVolumes((prev) => {
        const next = new Set(prev);
        if (direction === "add") {
          volumes.forEach((v) => next.add(v));
        } else {
          volumes.forEach((v) => next.delete(v));
        }
        return next;
      });
    },
    []
  );

  const diff = useMemo(() => {
    const added = Array.from(includedVolumes).filter(
      (v) => !initialIncluded.has(v)
    );
    const removed = Array.from(initialIncluded).filter(
      (v) => !includedVolumes.has(v)
    );
    return { added, removed };
  }, [includedVolumes, initialIncluded]);

  const hasChanges = diff.added.length > 0 || diff.removed.length > 0;

  const handleSave = async () => {
    if (!effectiveKey || !hasChanges) return;

    setSaving(true);
    const errors: string[] = [];
    const skippedMessages: string[] = [];
    let totalChunks = 0;

    try {
      if (diff.added.length > 0) {
        const res = await bulkAddMutation.mutateAsync({
          volumes: diff.added,
          source: effectiveKey,
        });
        totalChunks += res.total_chunks_modified;
        res.skipped_volumes.forEach((s) =>
          skippedMessages.push(`${s.volume}: ${s.reason}`)
        );
      }
      if (diff.removed.length > 0) {
        const res = await bulkRemoveMutation.mutateAsync({
          volumes: diff.removed,
          source: effectiveKey,
        });
        totalChunks += res.total_chunks_modified;
        res.skipped_volumes.forEach((s) =>
          skippedMessages.push(`${s.volume}: ${s.reason}`)
        );
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "요청 실패");
    }

    setSaving(false);

    if (errors.length > 0) {
      toast.error("저장 실패", { description: errors.join(", ") });
      return;
    }

    if (skippedMessages.length > 0) {
      toast.warning(`일부 볼륨 스킵 (${skippedMessages.length}건)`, {
        description: skippedMessages.slice(0, 3).join(", "),
      });
    } else {
      toast.success(
        `저장 완료 (추가 ${diff.added.length}건, 제거 ${diff.removed.length}건, ${totalChunks.toLocaleString()}청크)`
      );
    }
    queryClient.invalidateQueries({ queryKey: ["category-stats"] });
    queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
    onOpenChange(false);
  };

  const handleCancel = () => {
    setIncludedVolumes(initialIncluded);
    onOpenChange(false);
  };

  const colors = categoryColor ? getCategoryColors(categoryColor) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-4 z-50 mx-auto my-auto flex max-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95 sm:inset-8 sm:max-h-[calc(100vh-6rem)]">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
            <Dialog.Title className="flex items-center gap-2.5 text-base font-semibold">
              {categoryKey ? (
                <>
                  <Badge
                    variant="outline"
                    className={`font-mono text-xs ${colors?.text ?? ""} ${colors?.bg ?? ""}`}
                  >
                    {categoryKey}
                  </Badge>
                  {categoryName}
                </>
              ) : (
                <span className="text-amber-700">미분류 문서 분류</span>
              )}
              <span className="text-muted-foreground font-normal text-sm">
                — 문서 관리
              </span>
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {/* 미분류 모드: 카테고리 선택 */}
          {!categoryKey && (
            <div className="px-6 pt-4 shrink-0">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                분류할 카테고리 선택
              </label>
              <select
                value={selectedCategoryForUncategorized}
                onChange={(e) => setSelectedCategoryForUncategorized(e.target.value)}
                className="w-full max-w-xs text-sm border rounded-lg px-3 py-2 bg-background"
              >
                <option value="">카테고리를 선택하세요</option>
                {activeCategories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} ({c.key})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Transfer 컴포넌트 */}
          <div className="flex-1 min-h-0 px-6 py-4">
            <VolumeTransfer
              allVolumes={allVolumes}
              includedVolumes={includedVolumes}
              onMove={handleMove}
              categoryMap={categoryMap}
            />
          </div>

          {/* 하단 */}
          <div className="border-t px-6 py-4 shrink-0">
            {/* 변경 요약 */}
            {hasChanges && (
              <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                변경 예정:
                {diff.added.length > 0 && (
                  <span className="font-medium"> +{diff.added.length}건 추가</span>
                )}
                {diff.removed.length > 0 && (
                  <span className="font-medium"> -{diff.removed.length}건 제거</span>
                )}
              </div>
            )}

            {/* 저장 프로그레스 */}
            {saving && (
              <div className="mb-3 text-sm text-muted-foreground text-center">
                처리 중... (한 번의 요청으로 일괄 적용)
              </div>
            )}

            {/* 버튼 */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                취소
              </Button>
              <Button onClick={handleSave} disabled={!hasChanges || saving || !effectiveKey}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    저장 중...
                  </>
                ) : hasChanges ? (
                  `저장 (${diff.added.length + diff.removed.length}건 변경)`
                ) : (
                  "변경 없음"
                )}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
