import { ChevronDown, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { ScheduleStockNavBadge } from "@/features/hoondok/components/schedule-stock";
import { cn } from "@/lib/utils";
import { findActiveNavItem, NAV_GROUPS, NAV_ITEMS, type NavItem, navItemByHref } from "./nav-items";
import { useNavPrefs } from "./nav-prefs";

// 사이드바(slate-950) 위에서는 전역 outline-ring/50(1.2:1)이 보이지 않으므로 밝은 sidebar-ring 링을 따로 준다.
export const SIDEBAR_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring";

const FAVORITES_ID = "favorites";
const ALL_SECTION_IDS = [FAVORITES_ID, ...NAV_GROUPS.map((g) => g.id)];

function NavRow({
  item,
  active,
  inFavorites,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  inFavorites: boolean;
  onNavigate?: () => void;
}) {
  const { favorites, toggleFavorite } = useNavPrefs();
  const starred = favorites.includes(item.href);
  const Icon = item.icon;
  return (
    <li
      className={cn(
        "group/row relative flex items-center rounded-md",
        active
          ? // 활성 글자는 밝은 전경(16:1), brass 는 좌측 막대·아이콘에만 쓴다(글자로 쓰면 3.3:1 미달).
            "bg-sidebar-accent before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
          : "hover:bg-sidebar-accent",
      )}
    >
      <Link
        href={item.href}
        onClick={onNavigate}
        // 즐겨찾기에도 같은 메뉴가 보이지만 현재 페이지 표시는 그룹 안 원래 항목 하나에만 준다
        aria-current={active && !inFavorites ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pl-3 pr-1 text-sm transition-colors",
          SIDEBAR_FOCUS,
          active ? "font-medium text-sidebar-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground",
        )}
      >
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
        <span className="truncate">{item.label}</span>
        {/* 편성 재고: 어느 관리 화면에서나 남은 일수를 본다. 편성 화면과 같은 쿼리라 요청이 늘지 않는다. */}
        {item.href === "/hoondok" && <ScheduleStockNavBadge />}
      </Link>
      {/* 별은 링크 밖 형제 버튼: 링크 이름에 섞이지 않고 키보드·터치로 바로 누른다 */}
      <button
        type="button"
        onClick={() => toggleFavorite(item.href)}
        aria-pressed={starred}
        aria-label={`${item.label} 즐겨찾기${starred ? "에서 빼기" : "에 담기"}`}
        className={cn(
          "mr-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          SIDEBAR_FOCUS,
          starred
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/40 hover:text-sidebar-foreground group-hover/row:text-sidebar-foreground/70",
        )}
      >
        <Star aria-hidden="true" className={cn("size-3.5", starred && "fill-current")} />
      </button>
    </li>
  );
}

function SectionHead({
  label,
  controls,
  open,
  current,
  onToggle,
  children,
}: {
  label: string;
  controls: string;
  open: boolean;
  current?: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      // 지금 보고 있는 메뉴가 든 그룹은 접지 않는다
      aria-disabled={current || undefined}
      title={current ? "지금 보고 있는 메뉴가 있어 펼쳐 둡니다" : undefined}
      onClick={() => {
        if (!current) onToggle();
      }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/60 transition-colors",
        SIDEBAR_FOCUS,
        current ? "cursor-default" : "hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <ChevronDown
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", !open && "-rotate-90")}
      />
      {label}
      {children}
      {current && <span className="ml-auto font-normal text-sidebar-foreground/50">현재</span>}
    </button>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const { favorites, collapsed, toggleCollapsed, setAllCollapsed } = useNavPrefs();
  const idPrefix = useId();
  const allCollapsed = ALL_SECTION_IDS.every((id) => collapsed.includes(id));
  const favoritesOpen = !collapsed.includes(FAVORITES_ID);
  const favoriteItems = favorites.map(navItemByHref).filter((item): item is NavItem => Boolean(item));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-3 pt-3">
        <button
          type="button"
          onClick={() => setAllCollapsed(ALL_SECTION_IDS, !allCollapsed)}
          className={cn(
            "rounded-md px-2 py-1 text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            SIDEBAR_FOCUS,
          )}
        >
          {allCollapsed ? "전체 펼치기" : "전체 접기"}
        </button>
      </div>

      <nav aria-label="관리자 메뉴" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-1">
        <div>
          <SectionHead
            label="즐겨찾기"
            controls={`${idPrefix}-${FAVORITES_ID}`}
            open={favoritesOpen}
            onToggle={() => toggleCollapsed(FAVORITES_ID)}
          />
          <ul id={`${idPrefix}-${FAVORITES_ID}`} hidden={!favoritesOpen} className="mt-0.5 space-y-0.5">
            {favoriteItems.length > 0 ? (
              favoriteItems.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  active={item === active}
                  inFavorites
                  onNavigate={onNavigate}
                />
              ))
            ) : (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/50">
                <Star aria-hidden="true" className="size-3.5" />
                별을 눌러 메뉴 담기
              </li>
            )}
          </ul>
        </div>

        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group.id);
          const current = active !== undefined && items.includes(active);
          // 활성 그룹은 저장된 접힘 값과 무관하게 펼친다(저장값은 그대로 둔다)
          const open = current || !collapsed.includes(group.id);
          const listId = `${idPrefix}-${group.id}`;
          return (
            <div key={group.id}>
              <SectionHead
                label={group.label}
                controls={listId}
                open={open}
                current={current}
                onToggle={() => toggleCollapsed(group.id)}
              >
                {/* 접혀 있어도 편성 재고 경고는 보인다 */}
                {group.id === "hoondok" && !open && <ScheduleStockNavBadge />}
              </SectionHead>
              <ul id={listId} hidden={!open} className="mt-0.5 space-y-0.5">
                {items.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    active={item === active}
                    inFavorites={false}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
