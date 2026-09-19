// 훈독 기능 플래그 (PLAN-HD-001 결정 10). 빌드 시 고정되며 OFF(기본) 이면 /hoondok/* 은 404 다.
// 운영 이미지는 deploy-web 의 HOONDOK_ENABLED 를 넘겨야만 켜진다.
export function isHoondokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_ENABLED === "1";
}

// 훈독 프리뷰 플래그 (PLAN-HD-002 W0-W). 준비 중 탭(말씀·가정예배)과 말씀 검색 진입만 켠다.
// 운영 미노출 — Dockerfile·Makefile 에 배선하지 않는다. 로컬·Playwright(W3) 에서만 1 로 둔다.
export function isHoondokPreviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_PREVIEW === "1";
}
