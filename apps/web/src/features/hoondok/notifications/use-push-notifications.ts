"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isUnauthorized, useIdentityGate } from "@/features/identity/gate";
import { reportClientError } from "../observability/report";
import { notificationsAPI } from "./api";
import { detectPushSupport, type PushSupport, urlBase64ToUint8Array } from "./push-support";
import { notificationPrefsKey, PUSH_CONFIG_KEY } from "./query-keys";
import { type NotificationPrefs, PUSH_DISABLED_CODE } from "./types";

// 훈독하기 알림 한 종류의 켜기/끄기·시간을 한 곳에서 다룬다 (PLAN-HD-006 SCR-PWA-015).
// 서버(prefs)가 "켜짐" 의 기준이고, 이 기기의 구독 여부는 pushManager 가 따로 답한다 — 둘은 다를 수 있다.

/** 서버가 아직 답하지 않았을 때 화면이 기댈 기본값. read_time 은 프로토타입의 오전 6:00. */
export const DEFAULT_PREFS: NotificationPrefs = {
  read_enabled: false,
  read_time: "06:00",
  subscription_count: 0,
};

export const PUSH_MESSAGES = {
  permission: "브라우저 설정에서 알림을 허용해 주세요",
  pushDisabled: "알림 준비가 아직 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요",
  failed: "알림을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요",
  otherDevice: "이 기기에서 받으려면 다시 켜 주세요",
} as const;

/** `POST /hoondok/me/push` 의 user_agent 상한 (초과하면 422). */
const USER_AGENT_MAX = 400;

/** 브라우저 능력·권한은 구독할 외부 스토어가 없다 — 렌더마다 다시 읽기만 한다. */
const subscribeNever = () => () => {};

/** 권한 거절은 오류가 아니라 사용자의 선택이다 — 보고하지 않고 문구만 바꾼다. */
class PushPermissionError extends Error {}

type PushIntent = { readEnabled: boolean; readTime: string };

/**
 * 권한 요청은 클릭 핸들러 안에서 **동기적으로** 시작해야 한다. iOS WebKit 은 사용자 제스처 밖(await 뒤·mutationFn 안)의
 * requestPermission 을 탭 안의 요청으로 인정하지 않을 수 있다. 그래서 여기서 바로 부르고 promise 만 mutation 에 넘긴다.
 * 옛 콜백형 구현이 undefined 를 돌려줘도 Promise.resolve 로 감싸 같은 모양이 되고, 동기 예외는 거절된 promise 가 된다.
 */
function requestPermissionNow(): Promise<NotificationPermission> {
  let request: Promise<NotificationPermission>;
  try {
    request = Promise.resolve(Notification.requestPermission());
  } catch (error) {
    request = Promise.reject(error);
  }
  // mutationFn 이 await 하기 전에 거절돼도 처리되지 않은 거절로 찍히지 않게 한다 — 결과는 mutationFn 이 그대로 받는다.
  request.catch(() => undefined);
  return request;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export function usePushNotifications() {
  const queryClient = useQueryClient();
  const { user, isLoading: isUserLoading, redirectToOnboarding } = useIdentityGate();
  const [hasDeviceSubscription, setHasDeviceSubscription] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: PUSH_CONFIG_KEY,
    queryFn: notificationsAPI.config,
    retry: false,
    staleTime: 5 * 60_000,
  });
  // 설정을 못 읽으면(404·5xx·오프라인) 켤 방법이 없다 — "준비 중" 과 같은 화면으로 수렴시킨다.
  const isConfigSettled = configQuery.isSuccess || configQuery.isError;
  const isConfigEnabled = configQuery.data?.enabled === true && Boolean(configQuery.data.public_key);

  // 권한·플랫폼 판정은 브라우저에서만 참이다. useSyncExternalStore 로 읽으면 SSR 스냅샷과 어긋나도
  // React 가 하이드레이션 뒤에 다시 그려 주고(경고 없음), 렌더마다 다시 읽으므로 권한 변화도 따라온다.
  const browserSupport = useSyncExternalStore(
    subscribeNever,
    () => detectPushSupport(true),
    () => "unsupported" as PushSupport,
  );
  // 설정을 기다리는 동안은 아무것도 약속하지 않는다(null) — "준비 중" 과 "미지원" 사이를 깜빡이지 않게.
  const support: PushSupport | null = !isConfigSettled ? null : isConfigEnabled ? browserSupport : "disabled";

  const prefsQuery = useQuery({
    queryKey: notificationPrefsKey(user?.id ?? null),
    queryFn: notificationsAPI.prefs,
    enabled: isConfigEnabled && Boolean(user),
    retry: false,
  });
  const prefs = prefsQuery.data ?? DEFAULT_PREFS;

  // 서버는 켜졌다는데 이 기기에 구독이 없으면(다른 기기에서 켰거나 브라우저 데이터 삭제) 보조 문구를 띄운다.
  useEffect(() => {
    if (support !== "ready" || !prefs.read_enabled) return;
    let isActive = true;
    void currentSubscription()
      .then((subscription) => isActive && setHasDeviceSubscription(subscription !== null))
      .catch(() => isActive && setHasDeviceSubscription(null));
    return () => {
      isActive = false;
    };
  }, [support, prefs.read_enabled]);

  function applyPrefs(next: NotificationPrefs) {
    queryClient.setQueryData(notificationPrefsKey(user?.id ?? null), next);
  }

  const mutation = useMutation({
    // permission 은 켜는 경우에만 있다 — 클릭 핸들러가 이미 시작한 권한 요청이다(requestPermissionNow).
    mutationFn: async (intent: PushIntent & { permission: Promise<NotificationPermission> | null }) => {
      if (intent.permission) {
        const permission = await intent.permission;
        if (permission !== "granted") throw new PushPermissionError(permission);
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(configQuery.data?.public_key ?? ""),
        });
        const json = subscription.toJSON();
        try {
          await notificationsAPI.subscribe({
            endpoint: json.endpoint ?? subscription.endpoint,
            keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
            // backend 는 400자를 넘으면 422 로 돌려준다 — 진단용 값 하나 때문에 구독을 잃지 않는다.
            user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, USER_AGENT_MAX),
          });
        } catch (error) {
          // 서버가 받지 못한 구독은 브라우저에도 남기지 않는다(409 PUSH_DISABLED 등 — 고아 구독 방지).
          await subscription.unsubscribe().catch(() => undefined);
          throw error;
        }
      }
      if (!intent.readEnabled && prefs.read_enabled) {
        // 이 기기 구독만 지운다. 다른 기기 구독은 그 기기가 끌 때 지워진다.
        const subscription = await currentSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          await notificationsAPI.unsubscribe(subscription.endpoint);
        }
      }
      return notificationsAPI.savePrefs({
        read_enabled: intent.readEnabled,
        read_time: intent.readTime,
      });
    },
    onSuccess: (next) => {
      setMessage(null);
      applyPrefs(next);
      setHasDeviceSubscription(next.read_enabled ? true : null);
    },
    onError: (error) => {
      if (error instanceof PushPermissionError) {
        // 거절하면 Notification.permission 이 "denied" 로 바뀌고, 다음 렌더의 스냅샷이 그대로 읽는다.
        setMessage(PUSH_MESSAGES.permission);
        return;
      }
      if (isUnauthorized(error)) {
        redirectToOnboarding();
        return;
      }
      reportClientError("push_subscribe");
      const isPushDisabled = error instanceof ApiError && error.errorCode === PUSH_DISABLED_CODE;
      setMessage(isPushDisabled ? PUSH_MESSAGES.pushDisabled : PUSH_MESSAGES.failed);
      if (isPushDisabled) void queryClient.invalidateQueries({ queryKey: PUSH_CONFIG_KEY });
    },
  });

  // 클릭 핸들러에서 곧바로 불린다 — 켜는 경우의 권한 요청이 await 없이 여기서 시작돼야 제스처 안의 요청이 된다.
  const submit = (patch: Partial<PushIntent>) => {
    if (!user) return;
    const readEnabled = patch.readEnabled ?? prefs.read_enabled;
    mutation.mutate({
      readEnabled,
      readTime: patch.readTime ?? prefs.read_time,
      permission: readEnabled && !prefs.read_enabled ? requestPermissionNow() : null,
    });
  };

  return {
    support,
    isSignedIn: Boolean(user),
    isUserLoading,
    prefs,
    /** 서버 설정을 실제로 읽었다 — 그 전의 prefs 는 DEFAULT_PREFS(꺼짐)라 "켜져 있지 않다" 의 근거가 못 된다 */
    isPrefsReady: prefsQuery.isSuccess,
    isSaving: mutation.isPending,
    message,
    /** 서버는 켜졌는데 이 기기 구독이 없거나, 서버 구독 행이 하나도 없을 때(발송기가 지운 경우) true */
    isDeviceMissing:
      support === "ready" && prefs.read_enabled && (hasDeviceSubscription === false || prefs.subscription_count === 0),
    toggle: (readEnabled: boolean) => submit({ readEnabled }),
    /** 알림 받기 제안 카드의 주 버튼. 클릭 핸들러에서 바로 불러야 한다(권한 요청이 제스처 안에서 시작된다). */
    enable: () => submit({ readEnabled: true }),
    setReadTime: (readTime: string) => submit({ readTime }),
  };
}
