import { Info } from "lucide-react";
import Link from "next/link";

/** 미리보기에서 실행할 수 없는 행동의 이유와 돌아갈 곳. 입력 상태는 호출자가 보존한다. */
export function PreviewUnavailable({
  title,
  reason,
  href,
  linkLabel,
}: {
  title: string;
  reason: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="empty" role="status">
      <span className="empty__ic">
        <Info size={26} aria-hidden="true" />
      </span>
      <p className="empty__title">{title}</p>
      <p className="empty__body">{reason}</p>
      <Link className="btn btn-line btn--sm" href={href}>
        {linkLabel}
      </Link>
    </div>
  );
}
