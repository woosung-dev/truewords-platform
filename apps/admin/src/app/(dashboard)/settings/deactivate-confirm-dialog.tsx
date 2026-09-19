"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, Loader2, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// UI/UX 가이드 적용 (ui-ux-pro-max):
//   §1 a11y    — aria-describedby / focus trap(base-ui) / color-not-only(icon+text+color)
//   §2 touch   — loading-buttons (전환 중 disable + spinner)
//   §4 style   — destructive-emphasis, primary-action(취소가 안전한 default)
//   §7 motion  — modal-motion (scale+fade), CSS transition만 사용해 reduced-motion 호환
//   §8 forms   — confirmation-dialogs, error-clarity(결과를 문장으로 명시)
//
// delete-confirm-dialog 와 달리 타이핑 확인(typed-confirm)을 요구하지 않는다.
// 계정 비활성화는 목록에서 '활성화' 한 번으로 되돌릴 수 있어(undo-support) 마찰을
// 결과의 무게에 맞춘다. 타이핑을 요구하면 경고를 읽지 않고 통과하는 습관만 만든다.
interface DeactivateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

export default function DeactivateConfirmDialog({
  open,
  onOpenChange,
  email,
  busy = false,
  onConfirm,
}: DeactivateConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className="fixed inset-0 z-50 m-auto flex h-fit w-[calc(100%-2rem)] max-w-md flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95"
          aria-describedby="deactivate-effect-text"
        >
          <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/5 px-6 py-4 rounded-t-2xl">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-destructive">
              <UserX className="h-5 w-5" aria-hidden="true" />
              계정 비활성화
            </Dialog.Title>
            <Dialog.Close
              aria-label="닫기"
              className="rounded-lg p-1 text-muted-foreground hover:bg-admin-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border bg-admin-muted/30 p-3 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">대상</span>
                <span className="font-medium break-all">{email ?? "—"}</span>
              </div>
            </div>

            <div id="deactivate-effect-text" className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                이 계정은 <b className="text-foreground">로그인할 수 없게</b> 됩니다. 계정과 대화 기록은 삭제되지
                않으며, 목록에서 <b className="text-foreground">활성화</b>를 누르면 즉시 되돌릴 수 있습니다.
              </p>
            </div>

            {/* 알려진 한계를 숨기지 않는다 — 이 안내가 없으면 "비활성화했는데 아직 쓰고 있다"로 오인한다.
                본문은 text-foreground. text-warning 을 본문에 쓰면 warning-soft 위에서
                3.97:1 로 12px 본문 기준(4.5:1) 미달이라, 경고 성격은 아이콘·테두리·배경이 지고
                글자는 읽히는 색을 쓴다 (color-not-only 는 아이콘으로 충족). */}
            <div
              role="note"
              className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-foreground"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" aria-hidden="true" />
              <span>
                이미 로그인된 세션은 즉시 끊기지 않고 최대 24시간 뒤 쿠키가 만료될 때 차단됩니다. 새 로그인은 지금부터
                막힙니다.
              </span>
            </div>
          </div>

          <div className="flex gap-2 border-t px-6 py-4">
            <Button
              variant="outline"
              className="flex-1 justify-center"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              className="flex-1 justify-center"
              onClick={onConfirm}
              disabled={busy}
              aria-disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  처리 중...
                </>
              ) : (
                <>
                  <UserX className="w-4 h-4 mr-2" aria-hidden="true" />
                  비활성화
                </>
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
