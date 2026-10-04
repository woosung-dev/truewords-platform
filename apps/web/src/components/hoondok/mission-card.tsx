import { Check, type LucideIcon } from "lucide-react";
import Link from "next/link";

// 미션 카드 (DES-PWA-003 §2.1). 카드 본체는 <a>, 체크는 형제 <button> — 중첩 인터랙티브 금지.
// 체크는 누를 수 있을 때·완료했을 때·불러오는 동안만 그린다. 준비 중이거나 다른 곳에서 기록하는 카드(말씀 읽기는
// 원문 끝에서 읽음으로 기록)에 빈 원을 두면 누를 수 있는 컨트롤처럼 보이기 때문이다.
export type MissionCardProps = {
  kind: string;
  title: string;
  meta: string;
  icon: LucideIcon;
  href?: string;
  isDone?: boolean;
  /** 준비 중 (기도하기·말씀 읽기). 이동·체크 모두 비활성 */
  isDisabled?: boolean;
  /** 불러오는 중 — 제목·메타 자리에 한 줄씩 회색 막대를 두어 카드 높이를 지킨다 */
  isPending?: boolean;
  /** 오늘 먼저 할 일 한 장 — 제목을 한 단계 키우고 아이콘 칩에 액센트를 쓴다 */
  isLead?: boolean;
  onToggle?: () => void;
};

export function MissionCard({
  kind,
  title,
  meta,
  icon: Icon,
  href,
  isDone,
  isDisabled,
  isPending,
  isLead,
  onToggle,
}: MissionCardProps) {
  const body = (
    <>
      <span className="mission__ic">
        <Icon size={24} />
      </span>
      <span className="mission__bd">
        <span className="mission__kind">{isDisabled ? `${kind} · 준비 중` : kind}</span>
        <span className="mission__title">
          {isPending ? <span className="mission__skel" aria-hidden="true" /> : title}
        </span>
        <span className="mission__meta">
          {isPending ? <span className="mission__skel" aria-hidden="true" /> : meta}
        </span>
      </span>
    </>
  );
  return (
    <div
      className={isLead ? "mission mission--lead" : "mission"}
      data-done={isDone ? "" : undefined}
      data-disabled={isDisabled ? "" : undefined}
      data-pending={isPending ? "" : undefined}
    >
      {href && !isDisabled ? (
        <Link className="mission__link" href={href} aria-busy={isPending || undefined}>
          {body}
        </Link>
      ) : (
        <span className="mission__link" aria-disabled={isDisabled ? "true" : undefined}>
          {body}
        </span>
      )}
      {!isDisabled && (isDone || isPending || onToggle) && (
        <button
          type="button"
          className="check"
          aria-pressed={Boolean(isDone)}
          aria-label={`${kind} 완료`}
          disabled={!onToggle}
          onClick={onToggle}
        >
          <Check size={16} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
