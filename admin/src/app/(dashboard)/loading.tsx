// (dashboard) 그룹 진입 시 client 컴포넌트 hydration 동안 보여줄 router-level fallback.

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-4 max-w-5xl">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-64" />
      <div className="rounded-xl border bg-card p-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
