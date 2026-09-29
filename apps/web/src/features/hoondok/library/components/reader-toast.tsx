"use client";

// 원문 뷰 알림 한 줄 (DES-PWA-003 §2.11 토스트). 되돌리기가 있으면 5초, 없으면 2.2초 뒤 사라진다.
// 시트(<dialog> 모달)가 열려 있으면 바깥은 눌리지 않는다(inert) — 원문 뷰가 열린 시트 안에 넣어 그린다.
import { useCallback, useEffect, useRef, useState } from "react";

export type Toast = { key: number; message: string; action?: { label: string; run: () => void } };

const PLAIN_MS = 2200;
const ACTION_MS = 5000;

export function useReaderToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const show = useCallback((message: string, action?: Toast["action"]) => {
    counter.current += 1;
    setToast({ key: counter.current, message, action });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? ACTION_MS : PLAIN_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return { toast, show, dismiss };
}

export function ReaderToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { action } = toast;
  return (
    <div className="rd-toast" role="status" key={toast.key}>
      <span className="rd-toast__msg">{toast.message}</span>
      {action && (
        <button
          className="rd-toast__act"
          type="button"
          onClick={() => {
            action.run();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
