import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// P1-J — 답변 끝 상황 맞춤 기도문 / 결의문
export type ClosingTemplateKind = "prayer" | "resolution" | "off";

export interface ClosingTemplateProps {
  kind: Exclude<ClosingTemplateKind, "off">;
  body: string;
  /** 서명 (예: "예수 그리스도의 이름으로 기도드립니다. 아멘.") */
  signature?: string;
  className?: string;
}

const HEADING_BY_KIND: Record<Exclude<ClosingTemplateKind, "off">, string> = {
  prayer: "오늘의 기도",
  resolution: "오늘의 결의",
};

export function ClosingTemplate({
  kind,
  body,
  signature,
  className,
}: ClosingTemplateProps) {
  return (
    <aside
      aria-label={HEADING_BY_KIND[kind]}
      className={cn(
        "rounded-xl border-l-[3px] border-l-border-strong border border-border",
        "bg-surface-muted px-5 py-4",
        className
      )}
    >
      <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent">
        <Sparkles className="size-3.5" aria-hidden="true" />
        {HEADING_BY_KIND[kind]}
      </div>
      <p className="font-reading text-[15px] leading-[1.85] italic text-foreground break-keep-all whitespace-pre-line">
        {body}
      </p>
      {signature ? (
        <p className="mt-2 text-right text-sm text-muted-foreground italic break-keep-all">
          — {signature}
        </p>
      ) : null}
    </aside>
  );
}
