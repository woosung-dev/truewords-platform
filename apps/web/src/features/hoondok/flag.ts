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

// 함께 읽는 모임 킬 스위치 (PLAN-HD-010 D3). 빌드 시 고정. 코드에서는 미설정 = OFF 로 두고(잘못 빠진 배선이 켜지 않게),
// 배포(Dockerfile ARG·deploy-web HOONDOK_TOGETHER)·로컬 .env.example·Playwright 가 1 을 넘긴다.
// OFF 면 /hoondok/groups/** 가 404, 홈 모임 카드가 렌더되지 않는다. 백엔드 라우트·정정 문구는 플래그와 무관하다.
export function isHoondokTogetherEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_TOGETHER === "1";
}
