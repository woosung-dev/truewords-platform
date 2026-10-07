// 시연 챗(TrueWords) 브랜드 폰트. 루트 layout 에 두면 훈독까지 모든 화면의 렌더 차단 CSS 가 되므로
// 이 글꼴을 쓰는 진입점((chat) layout·login·about·design-system)에서만 import 한다.
// Fontsource 로 자체 호스팅한다 — Next 의 Google 폰트 로더는 빌드·dev 중 Google Fonts 를 받아
// Turbopack 버그(vercel/next.js#99114)로 무작위 실패한다. CSS 변수는 globals.css :root 에서 정의.
import "@fontsource-variable/inter";
// 디스플레이 헤딩 — 학술적 권위
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
