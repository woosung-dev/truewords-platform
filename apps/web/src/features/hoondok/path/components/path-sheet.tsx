"use client";

// 정성 시트 껍데기 (돌아온 날 · 정성 옮기기 확인). ReaderSheet 와 같은 <dialog> 패턴 — 배경막·Esc·포커스 가둠은 dialog 가 맡고,
// 열리면 제목으로 포커스를 옮기며 닫히면 연 곳으로 돌려준다. 닫기 버튼은 각 시트가 자기 문구로 둔다.
import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";

function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function PathSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      openerRef.current = document.activeElement;
      openDialog(dialog);
      titleRef.current?.focus();
    }
    return () => {
      queueMicrotask(() => {
        const opener = openerRef.current;
        if (!dialog?.isConnected && opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
  }, []);

  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  return (
    <dialog className="sheet" ref={dialogRef} aria-labelledby={titleId} onClose={onClose} onClick={handleBackdrop}>
      <div className="sheet__panel path-sheet">
        <div className="sheet__grip" aria-hidden="true" />
        <h2 className="js-title" id={titleId} tabIndex={-1} ref={titleRef}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
