import { safeLocalStorage as storage } from "@/lib/safe-storage";

// 설치 안내 카드 상태 (PLAN-HD-001 Phase 3 E). pending.ts 와 같은 규칙 — 저장소는 없거나 던질 수 있으므로 전부 try/catch.
// 키마다 한 의미다: eligible(직접 완료가 처음 기록됨 또는 서로 다른 KST 날짜로 2번째 방문) · hidden-until("나중에") ·
// dismiss-count("나중에" 횟수, 숨김 기간 단계) · installed(설치 완료) · visit(마지막 방문 KST 날짜와 방문 날짜 수).
const KEY_ELIGIBLE = "hoondok:install:eligible";
const KEY_HIDDEN_UNTIL = "hoondok:install:hidden-until";
const KEY_DISMISS_COUNT = "hoondok:install:dismiss-count";
const KEY_INSTALLED = "hoondok:install:installed";
const KEY_VISIT = "hoondok:install:visit";
// pending 의 이벤트와 분리한다 — 설치 상태 변경이 HomeMissions 를 다시 그리지 않게.
const CHANGE_EVENT = "hoondok:install-change";

// "나중에" 를 누를수록 길게 숨긴다 — 첫 거절 한 번으로 한 달을 잃지 않게. 마지막 단계(30일)가 상한이다.
export const INSTALL_DISMISS_SCHEDULE = [3, 7, 30] as const;
export const INSTALL_DISMISS_DAYS = 30;
/** 서로 다른 KST 날짜로 이만큼 들어오면 완료 기록이 없어도 설치를 권한다 (다시 왔다 = 관심의 증거). */
export const INSTALL_ELIGIBLE_VISIT_DAYS = 2;

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // 저장 실패해도 화면 상태는 유지한다
  }
}

export function notifyInstallChange(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

/** 사용자가 직접 완료해 서버에 처음 기록된 뒤 호출한다 (소급 동기화 경로는 부르지 않는다). */
export function markInstallEligible(): void {
  write(KEY_ELIGIBLE, "1");
  notifyInstallChange();
}

/** 그동안 "나중에" 를 누른 횟수. 깨진 값은 0. */
function readDismissCount(): number {
  const count = Number.parseInt(read(KEY_DISMISS_COUNT) ?? "", 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/** "나중에" — days 를 주지 않으면 누른 횟수에 따라 3일 → 7일 → 30일 뒤까지 숨긴다. */
export function dismissInstallCard(days?: number, now: number = Date.now()): void {
  const count = readDismissCount();
  const span = days ?? INSTALL_DISMISS_SCHEDULE[Math.min(count, INSTALL_DISMISS_SCHEDULE.length - 1)];
  write(KEY_HIDDEN_UNTIL, new Date(now + span * 24 * 60 * 60 * 1000).toISOString());
  write(KEY_DISMISS_COUNT, String(count + 1));
  notifyInstallChange();
}

/**
 * 방문 기록 — 오늘(KST) 처음 들어왔으면 방문 날짜 수를 하나 올리고, 2번째 날부터 설치 자격을 준다.
 * 같은 날 여러 번 열어도 한 번으로 센다. 저장값이 깨졌으면 첫 방문으로 다시 센다.
 */
export function recordInstallVisit(today: string): void {
  let last: unknown = null;
  let days = 0;
  try {
    const parsed: unknown = JSON.parse(read(KEY_VISIT) ?? "null");
    if (parsed && typeof parsed === "object") {
      last = (parsed as { last?: unknown }).last;
      const raw = (parsed as { days?: unknown }).days;
      days = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    }
  } catch {
    // 깨진 JSON — 처음부터 센다
  }
  if (last === today) return;
  days += 1;
  write(KEY_VISIT, JSON.stringify({ last: today, days }));
  if (days >= INSTALL_ELIGIBLE_VISIT_DAYS && read(KEY_ELIGIBLE) !== "1") markInstallEligible();
}

/** appinstalled 또는 prompt 수락 — 이 브라우저에서는 다시 보이지 않는다. */
export function markInstalled(): void {
  write(KEY_INSTALLED, "1");
  notifyInstallChange();
}

export type InstallState = { isEligible: boolean; isHidden: boolean; isInstalled: boolean };

export function readInstallState(now: number = Date.now()): InstallState {
  const hiddenUntil = Date.parse(read(KEY_HIDDEN_UNTIL) ?? "");
  return {
    isEligible: read(KEY_ELIGIBLE) === "1",
    // 값이 깨졌으면(NaN) 숨김으로 보지 않는다
    isHidden: Number.isFinite(hiddenUntil) && hiddenUntil > now,
    isInstalled: read(KEY_INSTALLED) === "1",
  };
}

/** useSyncExternalStore 용 구독 — 같은 탭의 변경 이벤트와 다른 탭의 storage 이벤트. */
export function subscribeInstall(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
