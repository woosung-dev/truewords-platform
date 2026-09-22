// 알림 전용 쿼리 키 (PLAN-HD-006). 진행 상태 키(../query-keys.ts)와 무효화 묶음이 다르므로 여기 따로 둔다.
export const PUSH_CONFIG_KEY = ["hoondok", "push-config"] as const;
export const NOTIFICATION_PREFS_KEY = ["hoondok", "notification-prefs"] as const;

/** 설정은 계정마다 다르다 — 로그아웃·계정 전환이 남의 값을 보여주지 않게 사용자 id 를 키에 넣는다. */
export const notificationPrefsKey = (userId: string | null) => [...NOTIFICATION_PREFS_KEY, userId] as const;
