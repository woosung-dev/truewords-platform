import type { ReactNode } from "react";
import { isHoondokMascotEnabled } from "@/features/hoondok/flag";

// 포즈 6개만 쓴다. 원본 그림에 박힌 노란 강조선·"z"·불꽃 같은 떨어진 장식을 지운 192px WebP(장당 약 10KB)다.
// 같은 폴더에 아직 쓰지 않는 포즈(focus)와 큰 화면용 -512 판도 있다. cheer·heart 는 연속일 축하·반응으로
// 읽히기 쉬워 보상 연출 금지(DEC-PWA-019)·반응 1종 규칙을 먼저 확인하고 쓴다 — cheer 는 홈 하늘의 낮 시간대 그림으로만 쓰고
// 완료·연속일에 따라 바꾸지 않는다. heart 는 7일 정성 마침표 한 곳만(결정 4) 쓴다.
const POSE_SRC = {
  welcome: "/hoondok/mascot/owl-welcome.webp",
  reading: "/hoondok/mascot/owl-reading.webp",
  search: "/hoondok/mascot/owl-search.webp",
  rest: "/hoondok/mascot/owl-rest.webp",
  heart: "/hoondok/mascot/owl-heart.webp",
  cheer: "/hoondok/mascot/owl-cheer.webp",
} as const;

export type MascotPose = keyof typeof POSE_SRC;

/**
 * 플래그가 켜져 있으면 부엉이, 아니면 fallback(기존 아이콘 또는 없음)을 그린다. 늘 장식이다 — 뜻은 옆의 제목·본문이 전한다.
 * 말풍선·1인칭 대사를 붙이지 않는다(부엉이가 화자가 되면 AI 답과 섞여 보인다). 안내 한 줄은 앱의 문장으로 따로 쓴다.
 * motion: settle(자리에 놓일 때 1회, 기본) · breathe(AI 대기 중 2회 뒤 정지) · none. reduced-motion 이면 전역 규칙이 끈다.
 */
export function HoondokMascot({
  pose,
  size,
  fallback = null,
  motion = "settle",
}: {
  pose: MascotPose;
  size: number;
  fallback?: ReactNode;
  motion?: "settle" | "breathe" | "none";
}) {
  if (!isHoondokMascotEnabled()) return <>{fallback}</>;
  return (
    <img
      className={motion === "none" ? "owl" : `owl owl--${motion}`}
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
