"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";

interface Props {
  /** false 면 렌더하지 않는다. */
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** 진행 중 버튼 문구. 기본 "삭제 중..." */
  pendingLabel?: string;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/** 공식 정성·모임 삭제, 데이터 소스 카테고리 비활성화·태그 제거 확인. 브라우저 confirm 대신 문구를 충분히 보인다(bulk-rights-dialog 와 같은 Dialog). */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = "삭제 중...",
  isPending,
  onConfirm,
  onOpenChange,
}: Props) {
  if (!open) return null;
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-muted-foreground">{description}</Dialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            취소
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
