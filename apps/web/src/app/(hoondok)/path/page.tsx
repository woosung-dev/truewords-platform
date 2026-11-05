// /path — 7일 정성 시작 흐름(로그인 안내 · 질문 2개 · 정성 고르기). 정성 플래그가 꺼진 빌드에서는 404 다.
import { notFound } from "next/navigation";
import { isHoondokPathsEnabled } from "@/features/hoondok/flag";
import { PathStartFlow } from "@/features/hoondok/path/components/path-start-flow";

export default function HoondokPathPage() {
  if (!isHoondokPathsEnabled()) notFound();
  return <PathStartFlow />;
}
