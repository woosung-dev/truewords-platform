import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 대시보드·검색 분석의 KPI 숫자 카드. 숫자는 천 단위 구분해 보이고, 값이 없으면 "—" 를 둔다.
// KPI 숫자는 중립색이 기본이다. 조치가 필요한 값(실패·부정 피드백 > 0)만 tone="danger" 로 알린다.
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  loading,
}: {
  label: string;
  value: number | string | undefined;
  icon?: LucideIcon;
  tone?: "default" | "danger";
  loading?: boolean;
}) {
  return (
    <Card className="space-y-3">
      {Icon ? (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className="w-8 h-8 rounded-md bg-admin-muted flex items-center justify-center">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p
          className={`text-3xl font-bold tracking-tight tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}
        >
          {value?.toLocaleString() ?? "—"}
        </p>
      )}
    </Card>
  );
}
