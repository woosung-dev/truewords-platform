import type { PathRunView } from "./api";

// 돌아온 날 시트 — 빈 날이 이틀 이상이고 오늘 아직 읽지 않았으면 하루 한 번 띄운다.
// "나중에"로 닫은 기록은 이 기기에만 남긴다(run·서버 오늘 날짜 키). 저장이 막혀도 이번 화면 상태로는 닫힌 채다.

const PREFIX = "hoondok:path-return:";

export function returnSheetKey(runId: string, today: string): string {
  return `${PREFIX}${runId}:${today}`;
}

export function isReturnSheetDismissed(runId: string, today: string): boolean {
  try {
    return window.localStorage.getItem(returnSheetKey(runId, today)) === "1";
  } catch {
    return false;
  }
}

export function dismissReturnSheet(runId: string, today: string): void {
  try {
    window.localStorage.setItem(returnSheetKey(runId, today), "1");
  } catch {
    // 사생활 모드 등 — 화면 상태로만 닫힘을 지킨다
  }
}

/** 시트를 띄울 조건(저장된 닫힘 기록은 따로 본다). */
export function shouldOfferReturn(run: Pick<PathRunView, "status" | "gap_days" | "read_today" | "next_step">): boolean {
  return run.status === "active" && run.gap_days >= 2 && !run.read_today && run.next_step !== null;
}
