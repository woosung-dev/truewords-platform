import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 화면 위쪽 오류 한 줄. 한 화면에 하나만 두고, 아래 카드들은 "불러오지 못했어요"만 조용히 보인다. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
