"use client";

import { X } from "lucide-react";
import { type ReactNode, useId } from "react";

// 하단 안내 자리의 겉모양 하나. 설치 안내·알림 제안이 같은 틀을 쓰고, 펼치면 같은 자리에서 아래로 내용이 붙는다.
// 닫기는 늘 오른쪽 X 하나다 — 접힌 상태에서는 "나중에", 펼친 상태에서는 "접기".
export function NoticeFrame({
  lead,
  title,
  sub,
  action,
  closeLabel,
  onClose,
  tone = "plain",
  isStatus = false,
  children,
}: {
  lead: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** done = 방금 훈독을 마친 순간 (완료 색, 1.2초 뒤 조용히 나타남) */
  tone?: "plain" | "done";
  isStatus?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <aside
      className="notice-slot"
      data-tone={tone}
      data-expanded={children ? "" : undefined}
      aria-labelledby={titleId}
      role={isStatus ? "status" : undefined}
    >
      <div className="notice-slot__row">
        <span className="notice-slot__lead" aria-hidden="true">
          {lead}
        </span>
        <div className="notice-slot__bd">
          <p className="notice-slot__title" id={titleId}>
            {title}
          </p>
          {sub && <p className="notice-slot__sub">{sub}</p>}
        </div>
        {action}
        <button className="notice-slot__close" type="button" aria-label={closeLabel} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children && <div className="notice-slot__more">{children}</div>}
    </aside>
  );
}
