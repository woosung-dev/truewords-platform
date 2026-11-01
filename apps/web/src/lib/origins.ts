// 서버 컴포넌트·라우트 핸들러가 쓰는 origin. 브라우저 요청은 같은 origin 프록시 `/api/backend` 를 쓴다.
// API origin: 운영 http://backend:8080, E2E 127.0.0.1:8000 (NEXT_PUBLIC_API_URL).
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// 웹 공개 origin — OG 메타데이터의 절대 URL 기준.
export const WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
