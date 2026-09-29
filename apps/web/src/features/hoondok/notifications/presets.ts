// 훈독하기 알림의 추천 시각 4칸. 모두 15분 격자라 발송기(cron */15)가 그 시각 즈음 보낸다.
// 저녁은 21:30 — 22:00 이면 조용한 시간 안내("오후 10시부터")와 부딪힌다.
// 서버 기본값 06:00 은 칸에 없다 — 그 사용자는 '직접 정하기' 로 보인다.
export type ReadTimePreset = { time: string; label: string };

export const READ_TIME_PRESETS: readonly ReadTimePreset[] = [
  { time: "05:30", label: "새벽" },
  { time: "07:30", label: "아침" },
  { time: "12:30", label: "점심" },
  { time: "21:30", label: "저녁" },
];

const DAY_MINUTES = 24 * 60;

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function isPresetTime(time: string): boolean {
  return READ_TIME_PRESETS.some((preset) => preset.time === time);
}

/** 지금 KST 의 하루 중 분(0~1439). 서버 발송 기준이 KST 라 기기 시간대와 무관하게 KST 로 잰다. */
export function kstMinutesNow(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * 하루를 원으로 보고 가장 가까운 칸. 자정 무렵(00:00)은 전날 저녁 칸이 더 가깝다.
 * 거리가 같으면 지금보다 앞선 칸 — 알림은 평소 읽는 때보다 먼저 와야 쓸모가 있다.
 */
export function nearestPreset(minutes: number): ReadTimePreset {
  let best = READ_TIME_PRESETS[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const preset of READ_TIME_PRESETS) {
    const since = (((minutes - toMinutes(preset.time)) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const until = (DAY_MINUTES - since) % DAY_MINUTES;
    // 거리 × 2 + (앞선 칸이면 0, 뒤 칸이면 1) — 동률만 앞선 칸으로 가른다
    const score = Math.min(since, until) * 2 + (since <= until ? 0 : 1);
    if (score < bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return best;
}
