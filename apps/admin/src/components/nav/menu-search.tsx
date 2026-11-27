import { Search, Star, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { findActiveNavItem, groupLabel, NAV_GROUPS, NAV_ITEMS, type NavItem, navItemByHref } from "./nav-items";
import { useNavPrefs } from "./nav-prefs";
import { searchByLabel } from "./menu-match";

const noopSubscribe = () => () => {};

interface Section {
  title?: string;
  items: NavItem[];
}

function groupedSections(): Section[] {
  return NAV_GROUPS.map((g) => ({ title: g.label, items: NAV_ITEMS.filter((item) => item.group === g.id) }));
}

function toItems(hrefs: string[]): NavItem[] {
  return hrefs.map(navItemByHref).filter((item): item is NavItem => Boolean(item));
}

// 이름에 그대로 들어 있는 부분만 굵게 표시한다(초성·자모 일치는 표시하지 않는다)
function Highlight({ label, query }: { label: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? label.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <mark className="rounded-sm bg-primary/15 text-foreground">{label.slice(at, at + q.length)}</mark>
      {label.slice(at + q.length)}
    </>
  );
}

export function MenuSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const { favorites, recent, toggleFavorite } = useNavPrefs();
  const idPrefix = useId();
  const listId = `${idPrefix}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // 서버 렌더에서는 비워 두고 브라우저에서 운영체제별 단축키를 표시한다
  const shortcut = useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => "",
  );

  const trimmed = query.trim();
  const results = useMemo(() => searchByLabel(NAV_ITEMS, trimmed, favorites), [trimmed, favorites]);
  const noResults = trimmed !== "" && results.length === 0;

  const sections: Section[] = useMemo(() => {
    if (trimmed) {
      if (results.length > 0) return [{ items: results }];
      return showAll ? groupedSections() : [];
    }
    const current = findActiveNavItem(pathname)?.href;
    const recentItems = toItems(recent.filter((h) => h !== current));
    const favoriteItems = toItems(favorites.filter((h) => !recentItems.some((item) => item.href === h)));
    const out: Section[] = [];
    if (recentItems.length) out.push({ title: "최근 연 메뉴", items: recentItems });
    if (favoriteItems.length) out.push({ title: "즐겨찾기", items: favoriteItems });
    return out.length ? out : groupedSections();
  }, [trimmed, results, showAll, pathname, recent, favorites]);

  // 키보드 이동 대상: 메뉴 항목들, 결과가 없을 때는 "전체 메뉴 보기" 하나
  const flat = sections.flatMap((s) => s.items);
  const showAllOption = noResults && !showAll;
  const optionCount = showAllOption ? 1 : flat.length;
  const safeIndex = Math.min(activeIndex, Math.max(optionCount - 1, 0));
  const optionId = (i: number) => `${idPrefix}-opt-${i}`;

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    setMobileOpen(false);
    setShowAll(false);
    setQuery("");
    setActiveIndex(0);
    if (restoreFocus) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus();
      else inputRef.current?.blur();
    }
  }

  function go(item: NavItem) {
    returnFocusRef.current = null;
    close({ restoreFocus: false });
    inputRef.current?.blur();
    router.push(item.href);
  }

  function openSearch() {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== inputRef.current) {
      returnFocusRef.current = document.activeElement;
    }
    setMobileOpen(true);
    setOpen(true);
    // 모바일 검색 막대는 열린 뒤에야 보이므로 다음 프레임에 포커스한다
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ⌘K / Ctrl+K: 어느 화면에서나 검색을 열고, 열려 있으면 닫는다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.code !== "KeyK") return;
      e.preventDefault();
      if (open && document.activeElement === inputRef.current) close({ restoreFocus: true });
      else openSearch();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter·방향키는 IME 몫이다
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((safeIndex + step + optionCount) % optionCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showAllOption) {
        setShowAll(true);
        setActiveIndex(0);
      } else if (flat[safeIndex]) go(flat[safeIndex]);
    } else if (e.key === "*" && !showAllOption && flat[safeIndex]) {
      e.preventDefault();
      toggleFavorite(flat[safeIndex].href);
    }
  }

  const liveText = !open ? "" : noResults && !showAll ? "결과 없음" : `결과 ${flat.length}개`;

  return (
    <>
      <button
        type="button"
        aria-label="메뉴 검색 열기"
        onClick={openSearch}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "ml-auto md:hidden" })}
      >
        <Search aria-hidden="true" className="size-5" />
      </button>

      <div
        ref={wrapRef}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
            setMobileOpen(false);
          }
        }}
        className={cn(
          mobileOpen
            ? "fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b bg-admin-bg px-4"
            : "hidden",
          "md:static md:z-auto md:mx-auto md:flex md:h-auto md:w-full md:max-w-md md:border-0 md:bg-transparent md:px-0",
        )}
      >
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="메뉴 검색"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && optionCount > 0 ? optionId(safeIndex) : undefined}
            placeholder="메뉴 이름으로 이동"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowAll(false);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            // 모바일 16px: iOS 가 입력 시 화면을 확대하지 않는다
            className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-14 text-base outline-none transition-colors placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:text-sm"
          />
          {shortcut && !query && (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground md:block">
              {shortcut}
            </kbd>
          )}

          {open && (
            <div
              // 목록을 눌러도 입력창 포커스를 잃지 않게 한다
              onMouseDown={(e) => e.preventDefault()}
              className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
            >
              <div id={listId} role="listbox" aria-label="메뉴 검색 결과" className="max-h-[min(60vh,24rem)] overflow-y-auto p-1">
                {noResults && (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">‘{trimmed}’와 맞는 메뉴가 없습니다.</p>
                )}
                {showAllOption && (
                  <div
                    id={optionId(0)}
                    role="option"
                    aria-selected={safeIndex === 0}
                    onClick={() => {
                      setShowAll(true);
                      setActiveIndex(0);
                    }}
                    onMouseMove={() => setActiveIndex(0)}
                    className={cn(
                      "cursor-pointer rounded-md px-2.5 py-2 text-sm",
                      safeIndex === 0 && "bg-muted",
                    )}
                  >
                    전체 메뉴 보기
                  </div>
                )}
                {sections.map((section) => (
                  <div key={section.title ?? "results"} role="group" aria-label={section.title}>
                    {section.title && (
                      <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.title}</div>
                    )}
                    {section.items.map((item) => {
                      const i = flat.indexOf(item);
                      const selected = i === safeIndex;
                      const starred = favorites.includes(item.href);
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.href}
                          id={optionId(i)}
                          role="option"
                          aria-selected={selected}
                          onClick={() => go(item)}
                          onMouseMove={() => setActiveIndex(i)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-1 text-sm",
                            selected && "bg-muted",
                          )}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            <Highlight label={item.label} query={trimmed} />
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{groupLabel(item.group)}</span>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-pressed={starred}
                            aria-label={`${item.label} 즐겨찾기${starred ? "에서 빼기" : "에 담기"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(item.href);
                            }}
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background",
                              starred ? "text-sidebar-primary" : "text-muted-foreground",
                            )}
                          >
                            <Star aria-hidden="true" className={cn("size-3.5", starred && "fill-current")} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="hidden border-t px-2.5 py-1.5 text-xs text-muted-foreground md:block">
                ↑↓ 이동 · Enter 열기 · * 즐겨찾기 · Esc 닫기
              </div>
            </div>
          )}
        </div>

        {mobileOpen && (
          <button
            type="button"
            aria-label="검색 닫기"
            onClick={() => close({ restoreFocus: true })}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "md:hidden" })}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        )}
      </div>

      <span aria-live="polite" className="sr-only">
        {liveText}
      </span>
    </>
  );
}
