// 훈독 기능 플래그 (PLAN-HD-001 결정 10). 빌드 시 고정되며 OFF(기본) 이면 /hoondok/* 은 404 다.
// 운영 이미지는 deploy-web 의 HOONDOK_ENABLED 를 넘겨야만 켜진다.
export function isHoondokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_ENABLED === "1";
}
