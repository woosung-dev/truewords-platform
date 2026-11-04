"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { HoondokButton } from "@/components/hoondok";

type InlineConfirmProps = {
  /** 여는 버튼 글자 */
  openLabel: string;
  /** 확인 카드 aria-label */
  label: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  openClassName: string;
  openIcon?: ReactNode;
};

/** 누르면 바로 아래 확인 카드가 열리고 초점은 취소로 간다. 취소하면 원래 버튼으로 돌아간다. */
export function InlineConfirm({
  openLabel,
  label,
  message,
  confirmLabel,
  onConfirm,
  openClassName,
  openIcon,
}: InlineConfirmProps) {
  const [isOpen, setIsOpen] = useState(false);
  const boxId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) cancelRef.current?.focus();
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    openerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={openClassName}
        aria-expanded={isOpen}
        aria-controls={boxId}
        onClick={() => setIsOpen((value) => !value)}
      >
        {openIcon}
        {openLabel}
      </button>
      <div className="tg-confirm" id={boxId} role="group" aria-label={label} hidden={!isOpen}>
        <p>{message}</p>
        <div className="tg-confirm__cta">
          <button ref={cancelRef} type="button" className="btn btn-ghost btn--sm" onClick={close}>
            취소
          </button>
          <HoondokButton isSmall onClick={onConfirm}>
            {confirmLabel}
          </HoondokButton>
        </div>
      </div>
    </>
  );
}
