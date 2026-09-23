"use client";

// 원문 뷰가 쓰는 시트 껍데기 (DES-PWA-003 §2.7). 정성 시트와 달리 열림 상태가 URL 이 아니라 지역 상태다 —
// 단락 선택·목차 열기는 뒤로가기로 돌아갈 만한 이동이 아니다. 배경막·Esc·포커스 가둠은 <dialog> 가 맡는다.
import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";

/** showModal 이 없는 환경(jsdom)에서는 open 속성만 세운다 — 문구·역할 검증은 그대로 돈다. */
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function ReaderSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) openDialog(dialog);
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }
  return (
    <dialog className="sheet" ref={dialogRef} aria-labelledby={titleId} onClose={onClose} onClick={handleBackdrop}>
      <div className="sheet__panel">
        <div className="sheet__grip" aria-hidden="true" />
        <h2 className="js-title" id={titleId}>
          {title}
        </h2>
        {children}
        <button className="btn btn-ghost rd-sheet__close" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </dialog>
  );
}
