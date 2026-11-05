import { hasBatchim } from "../personal/pick";
import type { PathRunView, PathStepSummary, PreferredSlot } from "./api";

// 7일 정성 화면 글자 조립. 날짜는 모두 서버가 준 KST ISO 날짜(YYYY-MM-DD)만 쓰고 기기 시계를 보지 않는다.

const SLOT_LABEL: Record<PreferredSlot, string> = { dawn: "새벽 기도 뒤", morning: "아침", evening: "저녁" };

/** 정한 때 이름. 고르지 않았으면 "편할 때". */
export function slotLabel(slot: PreferredSlot | null | undefined): string {
  return slot ? SLOT_LABEL[slot] : "편할 때";
}

export function minutesLabel(minutes: number): string {
  return `약 ${minutes}분`;
}

/** "1편 3장이에요" · "머리말이에요/예요" — 받침에 맞춘 서술격 조사. */
export function withIeyo(word: string): string {
  return `${word}${hasBatchim(word) ? "이에요" : "예요"}`;
}

/** "천성경 7일 정성을" — 받침에 맞춘 목적격 조사. */
export function withEul(word: string): string {
  return `${word}${hasBatchim(word) ? "을" : "를"}`;
}

/** `2026-11-05` → `11월 5일` */
export function monthDayLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

/** ISO 날짜의 요일(0=일 … 6=토). 시간대와 무관하게 날짜만 본다. */
export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * 이번 주(월요일 시작, 홈 "이번 주" 요일 줄과 같다) 읽은 날 7칸. 서버 `week_read_dates` 는 월요일부터 오늘까지라
 * 그 범위 밖 날짜는 버린다. 반환 배열의 0번이 월요일이다.
 */
export function weekDoneByDay(today: string, readDates: readonly string[]): boolean[] {
  const todayIndex = (weekdayOf(today) + 6) % 7; // 월=0
  const monday = dayNumber(today) - todayIndex;
  const done = Array<boolean>(7).fill(false);
  for (const iso of readDates) {
    const offset = dayNumber(iso) - monday;
    if (offset >= 0 && offset <= todayIndex) done[offset] = true;
  }
  return done;
}

/** 장 목록 창. 7장 이하면 전부, 그보다 길면 다음 장을 넷째 칸쯤에 두는 7칸 창이다. */
export function stepWindow(steps: readonly PathStepSummary[], nextDay: number | null): PathStepSummary[] {
  if (steps.length <= 7) return [...steps];
  const nextIndex = nextDay === null ? steps.length - 1 : steps.findIndex((s) => s.day_index === nextDay);
  const start = Math.min(Math.max((nextIndex < 0 ? 0 : nextIndex) - 3, 0), steps.length - 7);
  return steps.slice(start, start + 7);
}

export function nextStepOf(run: Pick<PathRunView, "steps" | "next_step">): PathStepSummary | null {
  if (run.next_step === null) return null;
  return run.steps.find((s) => s.day_index === run.next_step) ?? null;
}

/** 홈 "오늘 읽을 장" 한 줄. 읽은 장이 없으면 "부터 시작", 있으면 "부터 이어 읽기". */
export function todayWhatLine(run: Pick<PathRunView, "done_steps">, next: PathStepSummary): string {
  return run.done_steps === 0 ? `${next.title}부터 시작` : `${next.title}부터 이어 읽기`;
}

/** finished_at(UTC ISO 시각) → KST 날짜 ISO. */
export function kstDateOf(isoDateTime: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(isoDateTime));
}
