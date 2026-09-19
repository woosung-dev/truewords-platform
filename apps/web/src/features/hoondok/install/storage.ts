// 설치 안내 카드 상태 (PLAN-HD-001 Phase 3 E). pending.ts 와 같은 규칙 — 저장소는 없거나 던질 수 있으므로 전부 try/catch.
// 키 3개가 각각 한 의미다: eligible(직접 완료가 처음 기록됨) · hidden-until("나중에", 30일) · installed(설치 완료).
const KEY_ELIGIBLE = "hoondok:install:eligible";
const KEY_HIDDEN_UNTIL = "hoondok:install:hidden-until";
const KEY_INSTALLED = "hoondok:install:installed";
// pending 의 이벤트와 분리한다 — 설치 상태 변경이 HomeMissions 를 다시 그리지 않게.
const CHANGE_EVENT = "hoondok:install-change";

export const INSTALL_DISMISS_DAYS = 30;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

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

/** "나중에" — 기본 30일 뒤까지 숨긴다. */
export function dismissInstallCard(days: number = INSTALL_DISMISS_DAYS, now: number = Date.now()): void {
  write(KEY_HIDDEN_UNTIL, new Date(now + days * 24 * 60 * 60 * 1000).toISOString());
  notifyInstallChange();
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
