import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusDotVariants = cva("inline-block rounded-full shrink-0", {
  variants: {
    tone: {
      active: "bg-success",
      idle: "bg-muted-foreground/45",
      warning: "bg-warning",
      danger: "bg-destructive",
      info: "bg-info",
      brass: "bg-accent",
    },
    size: {
      sm: "size-1.5",
      md: "size-2",
      lg: "size-2.5",
    },
    pulse: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    tone: "idle",
    size: "md",
    pulse: false,
  },
})

export type StatusDotTone = NonNullable<VariantProps<typeof statusDotVariants>["tone"]>

interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusDotVariants> {}

export function StatusDot({
  tone,
  size,
  pulse,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      className={cn(statusDotVariants({ tone, size, pulse }), className)}
      aria-hidden
      {...props}
    />
  )
}
