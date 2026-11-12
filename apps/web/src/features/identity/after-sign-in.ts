import type { QueryClient } from "@tanstack/react-query";
import { claimDeviceForUser } from "./device-owner";
import type { HoondokUser } from "./types";
import { CURRENT_USER_KEY } from "./use-current-user";

/**
 * 로그인·가입 성공 직후 공통 처리 (비밀번호 로그인과 구글 콜백 도착 페이지가 같이 쓴다).
 * 계정이 바뀌었으므로 이전 계정의 요약을 재사용하지 않는다. 소급 POST 는 돌아간 화면의 훅이 한다.
 * 캐시만 비우면 기기 저장 기록(질문·이어 읽기·최근 검색)은 남아 다음 계정 화면에 그대로 보이므로 주인도 확인한다.
 */
export function completeSignIn(queryClient: QueryClient, user: HoondokUser, isNewAccount: boolean): void {
  claimDeviceForUser(user.id, isNewAccount);
  queryClient.setQueryData(CURRENT_USER_KEY, user);
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] === "hoondok" && query.queryKey[1] !== "me",
  });
}
