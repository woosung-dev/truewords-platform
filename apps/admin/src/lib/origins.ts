// 앱 간 이동만 공개 origin을 사용한다. 로그인 복귀 URL은 외부 입력을 받지 않는다.
export const WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
