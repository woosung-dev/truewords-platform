// 맞춤 첫 말씀 질문 흐름 진입. 회원가입 직후 돌아갈 곳이 기본값(홈)일 때만 질문으로 보낸다(기본값 10).
// 모임 초대 등 returnTo 가 따로 있으면 그쪽이 먼저다. 기존 로그인 사용자는 강제로 질문을 받지 않는다.
// 첫 말씀은 책갈피 카드에서 고르므로 책갈피 플래그가 꺼진 빌드에서는 흐름이 없다.
import { isHoondokCardsEnabled } from "../flag";

export const START_PATH = "/hoondok/start";

export function afterSignupHref(next: string): string {
  return next === "/hoondok" && isHoondokCardsEnabled() ? START_PATH : next;
}
