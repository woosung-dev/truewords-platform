import type { ComponentProps } from "react";

// 훈독 버튼 (DES-PWA-003 §1.5). 시연 챗의 shadcn Button 과 별개이며 hoondok.css .btn 만 쓴다.
type Variant = "primary" | "ghost" | "line";

export type HoondokButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  isSmall?: boolean;
};

export function HoondokButton({
  variant = "primary",
  isSmall,
  className = "",
  type = "button",
  ...rest
}: HoondokButtonProps) {
  const classes = ["btn", `btn-${variant}`, isSmall ? "btn--sm" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
