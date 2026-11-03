import type { ReactNode } from "react";
import { isHoondokMascotEnabled } from "@/features/hoondok/flag";

// 포즈 3개만 쓴다. 원본 그림에 박힌 노란 강조선·"z" 를 지운 192px WebP(장당 약 10KB)다.
// 불꽃(연속일)·하트(반응) 포즈와 AI 질문 화면 배치는 제품 규칙(보상 연출·재촉·AI 인격화) 때문에 들이지 않았다.
const POSE_SRC = {
  reading: "/hoondok/mascot/owl-reading.webp",
  search: "/hoondok/mascot/owl-search.webp",
  rest: "/hoondok/mascot/owl-rest.webp",
} as const;

export type MascotPose = keyof typeof POSE_SRC;

/**
 * 플래그가 켜져 있으면 부엉이, 아니면 fallback(기존 아이콘)을 그린다. 늘 장식이다 — 뜻은 옆의 제목·본문이 전한다.
 * 말풍선·1인칭 문구·모션을 붙이지 않는다(부엉이가 화자가 되면 AI 답과 섞여 보이고, 매일 보는 자리라 움직임은 피로가 된다).
 */
export function HoondokMascot({ pose, size, fallback }: { pose: MascotPose; size: number; fallback: ReactNode }) {
  if (!isHoondokMascotEnabled()) return <>{fallback}</>;
  return (
    <img
      className="owl"
      src={POSE_SRC[pose]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      data-pose={pose}
    />
  );
}
