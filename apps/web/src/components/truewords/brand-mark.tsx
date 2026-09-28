import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// 사용자 웹 브랜드 표식 — 남색 책 아이콘 배지 + Cormorant 세리프 워드마크.
// 로그인·참여 게이트·채팅·대화 기록이 같은 표식을 쓴다.

export interface BrandIconProps {
  /** 남색(primary) 배경 위에 놓일 때 색을 뒤집는다 */
  inverse?: boolean;
  className?: string;
}

export function BrandIcon({ inverse, className }: BrandIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        inverse ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      <BookOpen className="size-4" />
    </span>
  );
}

export interface BrandMarkProps extends BrandIconProps {
  /** 워드마크를 화면 제목(h1)으로 렌더한다 */
  asHeading?: boolean;
  /** 좁은 화면(< sm)에서 워드마크를 시각적으로 숨긴다(스크린 리더에는 유지) — 헤더 조작부가 많은 화면용 */
  compact?: boolean;
}

export function BrandMark({ inverse, asHeading, compact, className }: BrandMarkProps) {
  const Wordmark = asHeading ? "h1" : "span";
  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      <BrandIcon inverse={inverse} />
      <Wordmark
        className={cn(
          "font-display text-xl font-semibold tracking-wide whitespace-nowrap",
          compact && "max-sm:sr-only",
        )}
      >
        TrueWords
      </Wordmark>
    </span>
  );
}
