import { notFound } from "next/navigation";
import { SeriesScreen } from "@/features/hoondok/library/components/series-screen";

export default async function HoondokSeriesPage({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  // 원문 라우트와 같은 규칙 — 경로 경계에서 한 번만 복원하고 API 어댑터가 다시 인코딩한다.
  let decoded: string;
  try {
    decoded = decodeURIComponent(series);
  } catch {
    notFound();
  }
  return <SeriesScreen series={decoded} />;
}
