import type { ComponentProps } from "react";

// 훈독 버튼 (DES-PWA-003 §1.5). 시연 챗의 shadcn Button 과 별개이며 hoondok.css .btn 만 쓴다.
type Variant = "primary" | "ghost" | "line";

export type HoondokButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  isSmall?: boolean;
  /** 제출·저장 진행 중 (DES §1.5 loading): 라벨을 그대로 두고 왼쪽 16px 스피너 + aria-busy + 중복 제출 차단. */
  isLoading?: boolean;
};

export function HoondokButton({
  variant = "primary",
  isSmall,
  isLoading,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}: HoondokButtonProps) {
  const classes = ["btn", `btn-${variant}`, isSmall ? "btn--sm" : "", className].filter(Boolean).join(" ");
  // `disabled` 는 호출부 값과 합치고(둘 중 하나면 잠근다), `aria-busy` 는 rest 가 뒤에 오므로 호출부가 명시하면 그 값이 이긴다.
  return (
    <button
      type={type}
      className={classes}
      aria-busy={isLoading || undefined}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
