// 형광펜 편의 설정 — 이 기기에만 둔다(계정·서버에 올리지 않는다). 사생활 창·저장 차단이면 기본값으로 돈다.
import { type HighlightColor, toHighlightColor } from "./highlight-range";

const COLOR_KEY = "hoondok:hl-color";
const HINT_KEY = "hoondok:hl-hint-dismissed";

/** 마지막으로 고른 형광펜 색 — 메모만 남길 때 새 형광펜의 기본색이다. */
export function readLastColor(): HighlightColor {
  try {
    return toHighlightColor(Number(localStorage.getItem(COLOR_KEY)));
  } catch {
    return 1;
  }
}

export function writeLastColor(color: HighlightColor): void {
  try {
    localStorage.setItem(COLOR_KEY, String(color));
  } catch {
    // 저장이 막혀도 이번 선택은 이미 반영됐다
  }
}

/** 첫 사용 안내("글자를 길게 누르면…")를 닫았는가 */
export function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHintDismissed(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // 저장이 막히면 이번 화면에서만 닫힌다
  }
}
