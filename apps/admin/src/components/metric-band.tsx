import { Skeleton } from "@/components/ui/skeleton";

export interface Metric {
  label: string;
  value: number | string;
  /** 값 아래 한 줄. 기간·단위처럼 숫자만으로 모자란 맥락을 적는다. */
  hint?: string;
  /** 조치가 필요한 값만 색으로 알린다. */
  tone?: "danger";
  loading?: boolean;
}

/** 대시보드·검색 분석·데이터 소스가 같이 쓰는 KPI 한 띠. 칸 사이 1px 선은 바탕(border 색)을 gap 으로 비춰 그린다. */
export function MetricBand({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="bg-card px-5 py-4">
          <dt className="text-xs text-muted-foreground">{metric.label}</dt>
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${
              metric.tone === "danger" ? "text-destructive" : "text-foreground"
            }`}
          >
            {metric.loading ? (
              <Skeleton className="h-8 w-16" />
            ) : typeof metric.value === "number" ? (
              metric.value.toLocaleString()
            ) : (
              metric.value
            )}
          </dd>
          {metric.hint && !metric.loading && <dd className="mt-0.5 text-xs text-muted-foreground">{metric.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** 불러오지 못한 지표. 0 으로 보이면 "실패 0건"처럼 정상으로 오해한다. */
export const METRIC_ERROR = { value: "—", hint: "불러오지 못함" } as const;
