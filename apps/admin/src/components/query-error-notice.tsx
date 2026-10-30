import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QueryErrorNotice({
  message,
  hasPreviousData = false,
  isRetrying = false,
  onRetry,
}: {
  message: string;
  hasPreviousData?: boolean;
  isRetrying?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-border bg-danger-soft p-4 text-sm"
    >
      <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{message}</p>
        <p className="text-muted-foreground">
          {hasPreviousData ? "이전에 불러온 정보를 표시하고 있습니다." : "연결 상태를 확인하고 다시 시도해 주세요."}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={isRetrying} onClick={onRetry}>
        {isRetrying ? "다시 불러오는 중…" : "다시 시도"}
      </Button>
    </div>
  );
}
