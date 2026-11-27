"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { findActiveNavItem, NAV_ITEMS } from "./nav-items";

// 즐겨찾기·접힌 그룹·최근 연 메뉴는 이 브라우저에만 저장한다. 저장소를 못 쓰면 기본값으로 동작한다.
const STORAGE_KEY = "admin-nav:v1";
const RECENT_LIMIT = 5;
const KNOWN_HREFS = new Set(NAV_ITEMS.map((item) => item.href));

interface NavPrefsState {
  favorites: string[];
  collapsed: string[];
  recent: string[];
}

const EMPTY: NavPrefsState = { favorites: [], collapsed: [], recent: [] };

function hrefList(value: unknown): string[] {
  // 메뉴가 바뀌어 사라진 href 는 버린다
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && KNOWN_HREFS.has(v)) : [];
}

function readPrefs(): NavPrefsState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return EMPTY;
    const r = raw as Record<string, unknown>;
    return {
      favorites: hrefList(r.favorites),
      collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((v): v is string => typeof v === "string") : [],
      recent: hrefList(r.recent),
    };
  } catch {
    return EMPTY;
  }
}

function writePrefs(state: NavPrefsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 사생활 보호 모드 등: 저장만 건너뛴다
  }
}

interface NavPrefs extends NavPrefsState {
  toggleFavorite: (href: string) => void;
  toggleCollapsed: (groupId: string) => void;
  setAllCollapsed: (groupIds: string[], collapsed: boolean) => void;
}

const NavPrefsContext = createContext<NavPrefs | null>(null);

export function NavPrefsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<NavPrefsState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // 서버 렌더와 첫 화면을 맞추려고 저장값은 마운트 뒤에 읽는다
  useEffect(() => {
    setState(readPrefs());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writePrefs(state);
  }, [loaded, state]);

  // 최근 연 메뉴: 화면을 옮길 때마다 맨 앞에 둔다
  useEffect(() => {
    if (!loaded) return;
    const active = findActiveNavItem(pathname);
    if (!active) return;
    setState((s) =>
      s.recent[0] === active.href
        ? s
        : { ...s, recent: [active.href, ...s.recent.filter((h) => h !== active.href)].slice(0, RECENT_LIMIT) },
    );
  }, [loaded, pathname]);

  const toggleFavorite = useCallback((href: string) => {
    setState((s) => ({
      ...s,
      favorites: s.favorites.includes(href) ? s.favorites.filter((h) => h !== href) : [...s.favorites, href],
    }));
  }, []);

  const toggleCollapsed = useCallback((groupId: string) => {
    setState((s) => ({
      ...s,
      collapsed: s.collapsed.includes(groupId) ? s.collapsed.filter((g) => g !== groupId) : [...s.collapsed, groupId],
    }));
  }, []);

  const setAllCollapsed = useCallback((groupIds: string[], collapsed: boolean) => {
    setState((s) => ({ ...s, collapsed: collapsed ? groupIds : [] }));
  }, []);

  const value = useMemo(
    () => ({ ...state, toggleFavorite, toggleCollapsed, setAllCollapsed }),
    [state, toggleFavorite, toggleCollapsed, setAllCollapsed],
  );

  return <NavPrefsContext.Provider value={value}>{children}</NavPrefsContext.Provider>;
}

export function useNavPrefs(): NavPrefs {
  const ctx = useContext(NavPrefsContext);
  if (!ctx) throw new Error("useNavPrefs 는 NavPrefsProvider 안에서만 쓴다");
  return ctx;
}
