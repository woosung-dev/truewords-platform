// /path/read/[day] — 정성 장 하나 읽기(숨 고르기 → 본문 → 마침). 정성 플래그가 꺼진 빌드나 잘못된 장 번호는 404 다.
import { notFound } from "next/navigation";
import { isHoondokPathsEnabled } from "@/features/hoondok/flag";
import { PathReaderScreen } from "@/features/hoondok/path/components/path-reader-screen";

export default async function HoondokPathReadPage({ params }: { params: Promise<{ day: string }> }) {
  if (!isHoondokPathsEnabled()) notFound();
  const { day } = await params;
  const value = Number(day);
  if (!/^\d{1,3}$/.test(day) || value < 1 || value > 366) notFound();
  return <PathReaderScreen day={value} />;
}
