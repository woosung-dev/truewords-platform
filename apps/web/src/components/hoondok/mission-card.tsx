import { Check, type LucideIcon } from "lucide-react";
import Link from "next/link";

// 미션 카드 (DES-PWA-003 §2.1). 카드 본체는 <a>, 체크는 형제 <button> — 중첩 인터랙티브 금지.
// Phase 1 은 표시·이동만이며 체크 기록(mission_logs)은 Phase 2 다.
export type MissionCardProps = {
  kind: string;
  title: string;
  meta: string;
  icon: LucideIcon;
  href?: string;
  isDone?: boolean;
  /** 준비 중 (기도하기·말씀 읽기). 이동·체크 모두 비활성 */
  isDisabled?: boolean;
  onToggle?: () => void;
};

export function MissionCard({ kind, title, meta, icon: Icon, href, isDone, isDisabled, onToggle }: MissionCardProps) {
  const body = (
    <>
      <span className="mission__ic">
        <Icon size={24} />
      </span>
      <span className="mission__bd">
        <span className="mission__kind">{isDisabled ? `${kind} · 준비 중` : kind}</span>
        <span className="mission__title">{title}</span>
        <span className="mission__meta">{meta}</span>
      </span>
    </>
  );
  return (
    <div className="mission" data-done={isDone ? "" : undefined} data-disabled={isDisabled ? "" : undefined}>
      {href && !isDisabled ? (
        <Link className="mission__link" href={href}>
          {body}
        </Link>
      ) : (
        <span className="mission__link" aria-disabled={isDisabled ? "true" : undefined}>
          {body}
        </span>
      )}
      <button
        type="button"
        className="check"
        aria-pressed={Boolean(isDone)}
        aria-label={`${kind} 완료`}
        disabled={isDisabled || !onToggle}
        onClick={onToggle}
      >
        <Check size={16} strokeWidth={3} />
      </button>
    </div>
  );
}
