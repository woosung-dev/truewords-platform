// "HH:MM" → "오전 6:00" (프로토타입 표기). 알림이 꺼져 있을 때의 시간 행 글자로 쓴다.
export function formatKoreanTime(time: string): string {
  const [rawHour, rawMinute] = time.split(":");
  const hour = Number(rawHour);
  const minute = rawMinute ?? "00";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return time;
  const meridiem = hour < 12 ? "오전" : "오후";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${meridiem} ${display}:${minute}`;
}
