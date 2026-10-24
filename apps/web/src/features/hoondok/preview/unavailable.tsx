import { Info } from "lucide-react";
import Link from "next/link";

/** 예시와 실제 서비스의 경계를 행동하기 전에 알린다. */
export function PreviewNotice() {
  return (
    <aside className="notice notice--lead" aria-label="미리보기 안내">
      <strong>미리보기 예시 데이터입니다</strong>
      <span>재생·초대·전송·설정 저장은 준비 중이에요.</span>
    </aside>
  );
}

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
