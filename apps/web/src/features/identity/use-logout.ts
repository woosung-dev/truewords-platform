"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { identityAPI } from "./api";
import { CURRENT_USER_KEY } from "./use-current-user";
import { clearHoondokStorage } from "./use-delete-me";

/**
 * 이 기기의 알림 구독을 해지한다. 로그아웃한 기기로 앞 계정의 훈독 알림이 계속 가지 않게 한다.
 * 서버 기록은 지우지 않는다 — 쿠키가 사라진 뒤라 지울 자격이 없고, 해지된 구독은 다음 발송에서 404/410 을 받아 서버가 지운다(push_sender).
 * `serviceWorker.ready` 는 등록이 없으면 끝나지 않으므로 등록을 직접 찾는다. 실패는 로그아웃을 막지 않는다.
 */
async function unsubscribeThisDevice(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // 알림 미지원 브라우저·사생활 모드 — 해지할 구독이 없다
  }
}

/**
 * 훈독 로그아웃. 계정에 저장된 기록은 그대로 두고 이 기기와 계정의 연결만 끊는다. 성공 시:
 * 1. 알림 구독 해지
 * 2. me 캐시를 null 로 세우고 나머지 ["hoondok"] 캐시 제거 — 화면이 재요청 없이 "비로그인" 을 본다
 * 3. clearDevice 면 localStorage 의 hoondok:* 도 제거(기기 주인 표시 포함). 남겨 두면 다른 계정이 로그인할 때
 *    claimDeviceForUser 가 지운다.
 * 로그아웃 요청이 실패하면 아무것도 건드리지 않는다.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clearDevice }: { clearDevice: boolean }) => {
      await identityAPI.logout();
      await unsubscribeThisDevice();
      return clearDevice;
    },
    onSuccess: (clearDevice) => {
      queryClient.setQueryData(CURRENT_USER_KEY, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] === "hoondok" && query.queryKey[1] !== "me",
      });
      if (clearDevice) clearHoondokStorage();
    },
  });
}
