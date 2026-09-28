// 전체 메뉴의 즐겨찾기. 계정이 아니라 이 기기의 localStorage 한 키에만 둔다 — 로그인 없이 쓰고 서버 계약을 늘리지 않는다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다. 순서는 추가한 순서다.
import { useSyncExternalStore } from "react";

const KEY = "hoondok:favorites";
const CHANGE_EVENT = "hoondok:favorites-change";

/** 칩 이름을 서고 응답 없이 그리려고 제목을 함께 저장한다 */
export type FavoriteWork = { series: string; title: string };
export type Favorites = { menu: readonly string[]; works: readonly FavoriteWork[] };

export const EMPTY_FAVORITES: Favorites = { menu: [], works: [] };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isFavoriteWork(value: unknown): value is FavoriteWork {
  if (typeof value !== "object" || value === null) return false;
  const { series, title } = value as Record<string, unknown>;
  return typeof series === "string" && series !== "" && typeof title === "string" && title !== "";
}

/** 저장값 검증. 모양이 틀린 항목은 버리고 나머지는 살린다 — 한 칸이 깨져도 전체를 잃지 않는다. */
export function parseFavorites(raw: string | null): Favorites {
  if (!raw) return EMPTY_FAVORITES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_FAVORITES;
  }
  if (typeof data !== "object" || data === null) return EMPTY_FAVORITES;
  const { menu, works } = data as Record<string, unknown>;
  const menuIds = Array.isArray(menu) ? menu.filter((id): id is string => typeof id === "string") : [];
  const workItems = Array.isArray(works) ? works.filter(isFavoriteWork) : [];
  const seen = new Set<string>();
  return {
    menu: [...new Set(menuIds)],
    works: workItems
      .filter((work) => !seen.has(work.series) && seen.add(work.series))
      .map(({ series, title }) => ({ series, title })),
  };
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

// useSyncExternalStore 는 같은 값이면 같은 객체를 돌려받아야 한다 — 원문 문자열이 같으면 파싱 결과를 재사용한다.
let cachedRaw: string | null = null;
let cachedValue: Favorites = EMPTY_FAVORITES;

export function readFavorites(): Favorites {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseFavorites(raw);
  }
  return cachedValue;
}

export function writeFavorites(next: Favorites): void {
  try {
    const store = storage();
    if (next.menu.length === 0 && next.works.length === 0) store?.removeItem(KEY);
    else store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 실패(용량·차단)해도 화면은 멈추지 않는다 — 다음 읽기에서 이전 값으로 돌아간다
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR·구형 환경
  }
}

export function toggleMenuFavorite(id: string): void {
  const current = readFavorites();
  const menu = current.menu.includes(id) ? current.menu.filter((item) => item !== id) : [...current.menu, id];
  writeFavorites({ ...current, menu });
}

export function toggleWorkFavorite(work: FavoriteWork): void {
  const current = readFavorites();
  const isSaved = current.works.some((item) => item.series === work.series);
  const works = isSaved
    ? current.works.filter((item) => item.series !== work.series)
    : [...current.works, { series: work.series, title: work.title }];
  writeFavorites({ ...current, works });
}

/** 같은 탭의 쓰기와 다른 탭의 storage 이벤트를 함께 듣는다 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useFavorites(): Favorites {
  return useSyncExternalStore(subscribe, readFavorites, () => EMPTY_FAVORITES);
}
