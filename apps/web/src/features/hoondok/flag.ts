// 훈독 기능 플래그 (PLAN-HD-001 결정 10). 빌드 시 고정되며 OFF(기본) 이면 /hoondok/* 은 404 다.
// 운영 이미지는 deploy-web 의 HOONDOK_ENABLED 를 넘겨야만 켜진다.
export function isHoondokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_ENABLED === "1";
}

// 함께 읽는 모임 킬 스위치 (PLAN-HD-010 D3). 빌드 시 고정. 코드에서는 미설정 = OFF 로 두고(잘못 빠진 배선이 켜지 않게),
// 배포(Dockerfile ARG·deploy-web HOONDOK_TOGETHER)·로컬 .env.example·Playwright 가 1 을 넘긴다.
// OFF 면 /hoondok/groups/** 가 404, 홈 모임 카드가 렌더되지 않는다. 백엔드 라우트·정정 문구는 플래그와 무관하다.
export function isHoondokTogetherEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_TOGETHER === "1";
}

// 오늘의 책갈피 (PLAN-HD-012 결정 5). 빌드 시 고정, 미설정 = OFF. 협회가 외부 공유를 허락하지 않으면 이 플래그를 끈다.
// OFF 면 홈 책갈피 카드가 없고 /hoondok/bookmarks · /hoondok/c/** 는 404 다. /hoondok/bookmark 는 알림 url 이라
// 404 대신 홈으로 보낸다(계획 §4 — 알림을 누른 사용자가 빈 화면을 보지 않게).
export function isHoondokCardsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_CARDS === "1";
}
