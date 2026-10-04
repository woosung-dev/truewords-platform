import { AlertCircle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { HoondokButton } from "@/components/hoondok";

/**
 * 상태·오류 안내 상자 (DES-PWA-003 §1.5 error). 베타 고지 줄(`.notice`)과 다른 왼쪽 정렬 상자에 아이콘 + 원인 문장을 둔다.
 * `onRetry` 는 조회 실패일 때만 넘긴다 — 대체 편성을 보여 주는 안내처럼 다시 불러올 것이 없으면 버튼이 없다.
 */
export function StatusBox({
  children,
  onRetry,
  isRetrying = false,
}: {
  children: ReactNode;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const Icon = onRetry ? AlertCircle : Info;
  return (
    <div className="status-box" role="status">
      <Icon size={20} aria-hidden="true" />
      <p className="status-box__t">{children}</p>
      {onRetry && (
        <HoondokButton variant="line" isSmall isLoading={isRetrying} onClick={onRetry}>
          다시 불러오기
        </HoondokButton>
      )}
    </div>
  );
}
