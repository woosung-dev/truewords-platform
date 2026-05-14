// (dashboard) 그룹 ErrorBoundary — segment 안에서 throw 된 에러를 잡아
// reset 버튼으로 retry 한다.
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry 같은 외부 모니터링 연동 시점 — 현재는 console.error 만.
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">화면을 불러올 수 없습니다</p>
        <p className="text-xs text-muted-foreground">
          {error.message || "잠시 후 다시 시도해주세요"}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={reset}>
        다시 시도
      </Button>
    </div>
  );
}
