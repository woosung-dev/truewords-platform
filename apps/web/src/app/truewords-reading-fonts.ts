// 묵상/본문 한국어 세리프(Noto Serif KR). .prose-reading·font-reading 본문은 400, 원문 보기 강조(font-medium)는 500 을 쓴다.
// font-display 제목의 한글은 이 글꼴이 아니라 OS 대체 글꼴로 그려진다(theme 유틸리티가 Cormorant 스택만 둔다) — 700 은 싣지 않는다.
// 굵기마다 @font-face 가 120여 개라 본문 세리프가 없는 로그인 화면에는 넣지 않는다.
import "@fontsource/noto-serif-kr/400.css";
import "@fontsource/noto-serif-kr/500.css";
