// 훈독 Web Push 계약 타입 (PLAN-HD-006 sub-PR A). 생성 SDK(@truewords/api-client-ts)가 아직 이 엔드포인트를
// 담지 않아 여기 로컬로 둔다 — 필드명은 FastAPI 응답과 정확히 같으므로 contracts 재생성 뒤 생성 타입으로 바꾸면 된다.

/** 잠금 화면 문구 수준. 기본은 신앙 맥락이 드러나지 않는 중립형(DES-PWA-003 F7). */
export type LockScreenLevel = "neutral" | "faith";

/** `GET /hoondok/push/config` (공개) — VAPID 공개키가 없으면 서버가 알림을 보낼 수 없다. */
export type PushConfig = { enabled: boolean; public_key: string | null };

/** `GET|PUT /hoondok/me/notifications` (로그인). read_time 은 "HH:MM"(KST). */
export type NotificationPrefs = {
  read_enabled: boolean;
  read_time: string;
  lock_screen_level: LockScreenLevel;
  /** 이 계정에 등록된 구독 수 — 기기 수다(이 기기의 구독 여부는 pushManager 가 따로 답한다). */
  subscription_count: number;
};

export type NotificationPrefsInput = Pick<NotificationPrefs, "read_enabled" | "read_time" | "lock_screen_level">;

/** `POST /hoondok/me/push` 본문. endpoint·keys 는 PushSubscription.toJSON() 그대로다. */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent: string | null;
};

export type PushSubscriptionCreated = { id: string; endpoint: string; created_at: string };

/** 서버가 알림을 보낼 준비가 안 됐을 때의 409 코드 (`POST /hoondok/me/push`). */
export const PUSH_DISABLED_CODE = "PUSH_DISABLED";
