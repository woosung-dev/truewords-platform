// 훈독 기능 플래그 (PLAN-HD-001 결정 10). 빌드 시 고정되며 OFF(기본) 이면 훈독 화면(웹 루트 전체)은 404 다.
// 운영 이미지는 deploy-web 의 HOONDOK_ENABLED 를 넘겨야만 켜진다.
export function isHoondokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_ENABLED === "1";
}

// 오늘의 책갈피 (PLAN-HD-012 결정 5). 빌드 시 고정, 미설정 = OFF. 협회가 외부 공유를 허락하지 않으면 이 플래그를 끈다.
// OFF 면 홈 책갈피 카드가 없고 /bookmarks · /c/** 는 404 다. /bookmark 는 알림 url 이라
// 404 대신 홈으로 보낸다(계획 §4 — 알림을 누른 사용자가 빈 화면을 보지 않게).
export function isHoondokCardsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_CARDS === "1";
}

// 부엉이 마스코트 (조용한 곁 — 빈 상태·오프라인·편성 없는 날에만). 빌드 시 고정, 미설정 = OFF.
// OFF 면 지금 아이콘 그대로이고, ON 이면 그 자리에 부엉이 그림이 들어가고 정원 연속일의 불꽃 아이콘이 빠진다.
export function isHoondokMascotEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOONDOK_MASCOT === "1";
}
