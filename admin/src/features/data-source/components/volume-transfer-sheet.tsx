"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VolumeTransfer from "@/features/data-source/components/volume-transfer";
import { useAllVolumes, useActiveCategories, useAddVolumeTag, useRemoveVolumeTag } from "@/features/data-source/hooks";
import { getCategoryColors } from "@/features/data-source/category-colors";

interface VolumeTransferSheetProps {
  /** Sheet 열림 상태 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 대상 카테고리 key (미분류 모드일 때 null) */
  categoryKey: string | null;
  /** 대상 카테고리 이름 */
  categoryName: string;
  /** 대상 카테고리 색상 */
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
  const addTagMutation = useAddVolumeTag();
  const removeTagMutation = useRemoveVolumeTag();

  // 현재 포함된 volume Set (로컬 state)
  const [includedVolumes, setIncludedVolumes] = useState<Set<string>>(
    new Set()
  );
  // 초기 상태 (diff 계산용)
  const [initialIncluded, setInitialIncluded] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // 카테고리 key → { name, color } 매핑 (뱃지 렌더링용)
  const categoryMap = useMemo(
    () => new Map(activeCategories.map((c) => [c.key, { name: c.name, color: c.color }])),
    [activeCategories]
  );

  // 미분류 모드에서 선택한 카테고리
  const [selectedCategoryForUncategorized, setSelectedCategoryForUncategorized] =
    useState<string>("");

  // 실제 사용할 카테고리 key
  const effectiveKey = categoryKey ?? selectedCategoryForUncategorized;

  // Sheet 열릴 때 데이터 fetch + 초기 상태 설정
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

  // 이동 핸들러 (로컬 state만 변경)
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

  // diff 계산
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

  // 일괄 저장
  const handleSave = async () => {
    if (!effectiveKey || !hasChanges) return;

    setSaving(true);
    const totalOps = diff.added.length + diff.removed.length;
    setProgress({ current: 0, total: totalOps });

    let completed = 0;
    const errors: string[] = [];

    // 추가 처리
    for (const volume of diff.added) {
      try {
        await addTagMutation.mutateAsync({ volume, source: effectiveKey });
        completed++;
        setProgress({ current: completed, total: totalOps });
      } catch {
        errors.push(`추가 실패: ${volume}`);
      }
    }

    // 제거 처리
    for (const volume of diff.removed) {
      try {
        await removeTagMutation.mutateAsync({ volume, source: effectiveKey });
        completed++;
        setProgress({ current: completed, total: totalOps });
      } catch {
        errors.push(`제거 실패: ${volume}`);
      }
    }

    setSaving(false);

    if (errors.length > 0) {
      toast.error(`일부 작업 실패 (${errors.length}건)`, {
        description: errors.slice(0, 3).join(", "),
      });
    } else {
      toast.success(
        `저장 완료 (추가 ${diff.added.length}건, 제거 ${diff.removed.length}건)`
      );
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
      queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
      onOpenChange(false);
    }
  };

  // 취소 (변경사항 버리기)
  const handleCancel = () => {
    setIncludedVolumes(initialIncluded);
    onOpenChange(false);
  };

  const colors = categoryColor ? getCategoryColors(categoryColor) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
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
          </SheetTitle>
        </SheetHeader>

        {/* 미분류 모드: 카테고리 선택 드롭다운 */}
        {!categoryKey && (
          <div className="mt-3 px-1">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              분류할 카테고리 선택
            </label>
            <select
              value={selectedCategoryForUncategorized}
              onChange={(e) => setSelectedCategoryForUncategorized(e.target.value)}
              className="w-full text-sm border rounded-md px-3 py-2 bg-background"
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
        <div className="flex-1 min-h-0 mt-4">
          <VolumeTransfer
            allVolumes={allVolumes}
            includedVolumes={includedVolumes}
            onMove={handleMove}
            categoryMap={categoryMap}
          />
        </div>

        {/* 변경 요약 */}
        {hasChanges && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
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
          <div className="mt-2 text-sm text-muted-foreground text-center">
            {progress.total}건 중 {progress.current}건 처리 중...
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving || !effectiveKey}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                저장 중...
              </>
            ) : hasChanges ? (
              `저장 (${diff.added.length + diff.removed.length}건 변경)`
            ) : (
              "변경 없음"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
