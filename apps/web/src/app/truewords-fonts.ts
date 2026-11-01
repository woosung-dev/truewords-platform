// 시연 챗(TrueWords) 디스플레이 세리프. 루트 layout 에 두면 훈독(세리프 금지)까지 모든 화면의 렌더 차단 CSS 가 되므로
// font-display 를 쓰는 진입점((chat) layout·login·about)에서만 import 한다.
// Fontsource 로 자체 호스팅한다 — Next 의 Google 폰트 로더는 빌드·dev 중 Google Fonts 를 받아
// Turbopack 버그(vercel/next.js#99114)로 무작위 실패한다. CSS 변수는 globals.css :root 에서 정의.
// font-display 는 모두 font-semibold 로만 쓰여 600 한 굵기만 싣는다(워드마크·영문 제목).
import "@fontsource/cormorant-garamond/600.css";
