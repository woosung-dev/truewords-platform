"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

// 관리자 모달 공통 껍데기 — Portal·Backdrop·Popup 스타일을 한 곳에 둔다.
// Root·Title·Description·Close 는 호출하는 쪽이 base-ui Dialog 를 그대로 쓴다.
// 폭(max-w-*)·안쪽 여백·높이 제한은 className 으로 화면마다 정한다.
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed inset-0 z-50 m-auto flex h-fit w-[calc(100%-2rem)] flex-col rounded-2xl bg-popover text-popover-foreground shadow-2xl transition duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { DialogContent };
