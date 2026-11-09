// /path/done — 7일 정성 마침표. 정성 플래그가 꺼진 빌드에서는 404 다.
import { notFound } from "next/navigation";
import { isHoondokPathsEnabled } from "@/features/hoondok/flag";
import { PathDoneScreen } from "@/features/hoondok/path/components/path-done-screen";

export default function HoondokPathDonePage() {
  if (!isHoondokPathsEnabled()) notFound();
  return <PathDoneScreen />;
}
