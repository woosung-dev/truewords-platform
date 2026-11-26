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
  isDelayedEnter = false,
  isStatus = false,
  children,
}: {
  lead: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** done = 완료 색 (훈독을 마친 순간·알림 설정 완료) */
  tone?: "plain" | "done";
  /**
   * 1.2초 뒤 조용히 나타난다 — 방금 훈독을 마친 순간 "오늘 훈독을 마쳤어요" 를 먼저 보게 한다.
   * 펼침·접힘으로 값이 바뀌면 애니메이션이 다시 돌아 카드가 잠시 사라지므로, 같은 안내 안에서는 값을 유지한다.
   */
  isDelayedEnter?: boolean;
  isStatus?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <aside
      className="notice-slot"
      data-tone={tone}
      data-enter={isDelayedEnter ? "delayed" : undefined}
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
