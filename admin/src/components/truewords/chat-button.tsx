"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Plan B.1 — 모바일 우선 버튼 (44 / 48 / 56h)
const chatButtonVariants = cva(
  [
    "group inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-md font-medium whitespace-nowrap select-none",
    "transition-all duration-150 ease-out outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:scale-[0.97] active:transition-transform active:duration-100",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-(--tw-shadow-card) hover:bg-primary/90 hover:shadow-(--tw-shadow-card-hover)",
        // Brass CTA — 답변 페이지 핵심 액션 (P0-G floating bar 등)
        brass:
          "bg-accent text-accent-foreground shadow-(--tw-shadow-card) hover:bg-accent/90 hover:shadow-(--tw-shadow-card-hover)",
        ghost:
          "bg-transparent text-foreground hover:bg-secondary hover:text-foreground",
        outline:
          "border border-border bg-card text-foreground hover:bg-secondary",
        // Pastoral mode — 목회 상담 톤
        pastoral:
          "bg-pastoral text-pastoral-foreground hover:bg-pastoral/90 shadow-(--tw-shadow-card)",
        // Kakao login CTA
        kakao: "bg-[#FEE500] text-[#000000] hover:bg-[#FEE500]/90",
      },
      size: {
        sm: "h-9 px-3 text-sm gap-1.5 [&_svg]:size-4",
        md: "h-11 px-4 text-sm gap-2 [&_svg]:size-4", // 44px touch target
        lg: "h-12 px-5 text-base gap-2 [&_svg]:size-5", // 48px
        xl: "h-14 px-6 text-base gap-2 [&_svg]:size-5", // 56px (full-width CTA)
        icon: "size-11 [&_svg]:size-5", // 44 × 44 touch
        "icon-lg": "size-12 [&_svg]:size-6",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export type ChatButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof chatButtonVariants> & {
    loading?: boolean;
  };

export function ChatButton({
  className,
  variant,
  size,
  fullWidth,
  loading,
  disabled,
  children,
  ...props
}: ChatButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="chat-button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(chatButtonVariants({ variant, size, fullWidth, className }))}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </ButtonPrimitive>
  );
}

export { chatButtonVariants };
