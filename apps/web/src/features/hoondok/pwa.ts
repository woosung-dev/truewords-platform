// 훈독 PWA 설치 메타 (PLAN-HD-001 Phase 3 C). manifest·아이콘·폰트는 /hoondok 스코프의 public 정적 자산이다.
// HOONDOK_THEME_COLOR 는 hoondok.css 의 --paper 와 같은 값이어야 한다 — hoondok-pwa.test.ts 가 css·manifest·viewport 3곳 동기화를 단언한다.
export const HOONDOK_MANIFEST_PATH = "/hoondok/manifest.webmanifest";
export const HOONDOK_THEME_COLOR = "#fbfaf8";
export const HOONDOK_ICON_192 = "/hoondok/icons/icon-192.png";
export const HOONDOK_APPLE_TOUCH_ICON = "/hoondok/icons/apple-touch-icon-180.png";
