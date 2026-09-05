import { cva, type VariantProps } from "class-variance-authority"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusBadgeVariants = cva("border", {
  variants: {
    tone: {
      success:
        "bg-success-soft text-success border-success-border [a]:hover:bg-success-soft",
      warning:
        "bg-warning-soft text-warning border-warning-border [a]:hover:bg-warning-soft",
      danger:
        "bg-danger-soft text-destructive border-danger-border [a]:hover:bg-danger-soft",
      info: "bg-info-soft text-info border-info-border [a]:hover:bg-info-soft",
      neutral:
        "bg-secondary text-muted-foreground border-border [a]:hover:bg-secondary",
      brass:
        "bg-accent/10 text-accent border-accent/30 [a]:hover:bg-accent/10",
    },
    solid: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    {
      tone: "success",
      solid: true,
      class: "bg-success text-success-foreground border-transparent",
    },
    {
      tone: "warning",
      solid: true,
      class: "bg-warning text-warning-foreground border-transparent",
    },
    {
      tone: "danger",
      solid: true,
      class: "bg-destructive text-white border-transparent",
    },
    {
      tone: "info",
      solid: true,
      class: "bg-info text-pastoral-foreground border-transparent",
    },
    {
      tone: "neutral",
      solid: true,
      class: "bg-muted-foreground text-secondary border-transparent",
    },
    {
      tone: "brass",
      solid: true,
      class: "bg-accent text-accent-foreground border-transparent",
    },
  ],
  defaultVariants: {
    tone: "neutral",
    solid: false,
  },
})

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>

interface StatusBadgeProps extends React.ComponentProps<typeof Badge> {
  tone?: StatusTone
  solid?: boolean
}

export function StatusBadge({
  tone = "neutral",
  solid = false,
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(statusBadgeVariants({ tone, solid }), className)}
      {...props}
    />
  )
}
