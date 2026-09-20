// 훈독 기능 플래그 (PLAN-HD-001 결정 10). 빌드 시 고정되며 OFF(기본) 이면 /hoondok/* 은 404 다.
// 운영 이미지는 deploy-web 의 HOONDOK_ENABLED 를 넘겨야만 켜진다.
export function isHoondokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_ENABLED === "1";
}

// 훈독 프리뷰 플래그 (PLAN-HD-002 W0-W·W3). 프리뷰 셸 8라우트(말씀 3·가정예배 4·가족 1)와 그 진입(탭 2·말씀 검색·정원의 가족 섹션)을 켠다.
// OFF 면 각 프리뷰 page 가 notFound() 로 404 를 낸다 — 라우트 목록은 ON/OFF 가 같고 게이트는 런타임이다.
// 운영 미노출 — Dockerfile·Makefile 에 배선하지 않는다. 로컬·Playwright(W3) 에서만 1 로 둔다.
export function isHoondokPreviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_PREVIEW === "1";
}
