import { Check } from "lucide-react";
import type { AuthorityGrade, ReviewStatus } from "@/features/hoondok/today";

// 권위 층 배지 (DES-PWA-003 §2.3). O1·O2 초록(--ok-soft), O3~O5 중립, R 점선.
// 등급 배지는 항상 "숫자 + 한국어 라벨", 완료 배지는 항상 체크 아이콘을 함께 둔다.
// 배지에 aria-hidden 을 두지 않는다 — 읽는 순서에 등급이 포함돼야 한다.
const GRADE_LABEL: Record<AuthorityGrade, string> = {
  O1: "공식 원문",
  O2: "공식 편집",
  O3: "공식 해설",
  O4: "교회 자료",
  O5: "지역 콘텐츠",
  R: "권리 확인 중",
};

export function AuthorityBadge({ grade }: { grade: AuthorityGrade }) {
  const modifier = grade === "O1" || grade === "O2" ? "badge--rank" : grade === "R" ? "badge--dashed" : "";
  const label = grade === "R" ? GRADE_LABEL.R : `${grade} ${GRADE_LABEL[grade]}`;
  return <span className={`badge ${modifier}`.trim()}>{label}</span>;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status !== "unverified") return null;
  return <span className="badge badge--dashed">확인되지 않음</span>;
}

export function DoneBadge() {
  return (
    <span className="badge badge--rank">
      <Check size={12} strokeWidth={3} />
      완료
    </span>
  );
}
