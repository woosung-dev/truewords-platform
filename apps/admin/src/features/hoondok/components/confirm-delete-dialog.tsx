"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  /** false 면 렌더하지 않는다. */
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/** 공식 정성·모임 삭제 확인. 되돌릴 수 없는 동작이라 브라우저 confirm 대신 문구를 충분히 보인다(bulk-rights-dialog 와 같은 Dialog). */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  confirmLabel,
  isPending,
  onConfirm,
  onOpenChange,
}: Props) {
  if (!open) return null;
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit w-full max-w-md flex-col rounded-2xl bg-popover p-6 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">{description}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirm} disabled={isPending}>
              {isPending ? "삭제 중..." : confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
