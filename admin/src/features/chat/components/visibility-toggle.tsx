"use client";

import * as React from "react";
import { Lock, Link2, Globe2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VISIBILITY_OPTIONS,
  type Visibility,
  type VisibilityDef,
} from "@/features/chat/types";

// W2-② P2-D — 공개여부 3종 토글 (segmented control)
const ICON_MAP: Record<Visibility, LucideIcon> = {
  private: Lock,
  unlisted: Link2,
  public: Globe2,
};

export interface VisibilityToggleProps {
  value: Visibility;
  onChange: (value: Visibility) => void;
  className?: string;
  label?: string;
}

export function VisibilityToggle({
  value,
  onChange,
  className,
  label = "공개여부",
}: VisibilityToggleProps) {
  const current = VISIBILITY_OPTIONS.find((o) => o.key === value);
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        {current ? (
          <span className="text-xs text-muted-foreground break-keep-all">
            {current.description}
          </span>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="공개여부 3종"
        className="mt-2 flex gap-1 rounded-lg bg-secondary p-1"
      >
        {VISIBILITY_OPTIONS.map((opt) => (
          <VisibilityOption
            key={opt.key}
            opt={opt}
            active={value === opt.key}
            onClick={() => onChange(opt.key)}
          />
        ))}
      </div>
    </div>
  );
}

interface VisibilityOptionProps {
  opt: VisibilityDef;
  active: boolean;
  onClick: () => void;
}

function VisibilityOption({ opt, active, onClick }: VisibilityOptionProps) {
  const Icon = ICON_MAP[opt.key];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={`${opt.label} — ${opt.description}`}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium",
        "transition-all duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{opt.label}</span>
    </button>
  );
}
