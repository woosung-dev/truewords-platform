"use client";

// 원문 본문 + 구절 형광펜 도구 (API-HD-053). 글자를 고르면 "고른 구절" 도구(3색·메모·복사)가, 칠한 구절을 누르면
// 형광펜 도구(색 바꾸기·메모·복사·지우기)가 뜬다. 둘 다 본문 감싸개 안에 absolute 로 놓여 글과 함께 스크롤된다.
// 도구로 초점을 옮기지 않는다(옮기면 선택이 풀린다). 기본 선택 메뉴(복사·찾기)는 막지 않는다 — 손가락 조작이면
// 도구를 선택 아래에 두어 겹치지 않게 한다. 쓰기·시트·알림은 원문 뷰가 맡고 여기서는 무엇을 눌렀는지만 알린다.
import type { HighlightItem, WordChunk } from "@truewords/api-client-ts/types";
import { Check, Copy, NotebookPen, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  COLOR_NAME,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  type TextRange,
  toHighlightColor,
} from "../highlight-range";
import { isPendingHighlight } from "../use-reading";
import { type Anchor, anchorFrom, useTextSelection } from "../use-text-selection";

/** 앱바·하단 탭+리더 바가 가리는 높이. 도구가 이 안으로 들어가면 반대쪽으로 뒤집는다. */
const TOP_SAFE = 72;
const BOTTOM_SAFE = 148;
const EDGE = 8;
const GAP = 8;
/** 손가락 선택은 끝 손잡이가 글자 아래로 늘어진다 — 손잡이를 피해 조금 더 띄운다 */
const TOUCH_GAP = 28;

type Place = { top: number; left: number; placement: "above" | "below" };

/** 도구 위치(감싸개 기준). 마우스는 선택 위, 손가락은 선택 끝 아래가 기본이고 화면 밖이면 뒤집는다. 가로는 화면 안에 가둔다. */
export function placeFloating(
  anchor: Anchor,
  size: { width: number; height: number },
  base: { top: number; left: number },
  viewport: { width: number; height: number },
  gapBelow: number,
): Place {
  const above = anchor.first.top - GAP - size.height;
  const below = anchor.last.bottom + gapBelow;
  const fitsAbove = base.top + above >= TOP_SAFE;
  const fitsBelow = base.top + below + size.height <= viewport.height - BOTTOM_SAFE;
  const isBelow = anchor.isTouch ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
  const box = isBelow ? anchor.last : anchor.first;
  const center = (box.left + box.right) / 2;
  const minLeft = EDGE - base.left;
  const maxLeft = viewport.width - EDGE - size.width - base.left;
  return {
    top: isBelow ? below : above,
    left: Math.max(minLeft, Math.min(center - size.width / 2, maxLeft)),
    placement: isBelow ? "below" : "above",
  };
}

/** 좌우 화살표로 도구 안 버튼 사이를 옮긴다(ARIA toolbar). */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = (index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
  buttons[next]?.focus();
}

function FloatingBar({
  label,
  anchor,
  wrapRef,
  gapBelow,
  onHold,
  children,
}: {
  label: string;
  anchor: Anchor;
  wrapRef: RefObject<HTMLElement | null>;
  gapBelow: number;
  onHold: () => void;
  children: ReactNode;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  // 제 크기를 재야 자리를 정할 수 있다 — 그리기 직후 한 번 재서 DOM 에 바로 적는다(상태를 거치면 한 번 더 그린다)
  useLayoutEffect(() => {
    const bar = barRef.current;
    const wrap = wrapRef.current;
    if (!bar || !wrap) return;
    const place = placeFloating(
      anchor,
      { width: bar.offsetWidth, height: bar.offsetHeight },
      wrap.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      gapBelow,
    );
    bar.style.top = `${place.top}px`;
    bar.style.left = `${place.left}px`;
    bar.dataset.placement = place.placement;
  }, [anchor, wrapRef, gapBelow]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 떠 있는 도구 묶음이다 — 폼 필드 묶음(fieldset)이 아니다
    <div
      className="hl-bar"
      role="toolbar"
      aria-label={label}
      ref={barRef}
      onPointerDown={onHold}
      // 데스크톱: 도구를 눌러도 글자 선택이 풀리지 않게 한다
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={moveFocus}
    >
      {children}
    </div>
  );
}

function Swatch({
  color,
  isPressed,
  onPick,
}: {
  color: HighlightColor;
  /** 형광펜 도구에서만 — 지금 색이면 체크 표시(색만으로 알리지 않는다) */
  isPressed?: boolean;
  onPick: (color: HighlightColor) => void;
}) {
  return (
    <button
      type="button"
      className="hl-bar__sw"
      aria-label={`${COLOR_NAME[color]} 형광펜`}
      aria-pressed={isPressed}
      onClick={() => onPick(color)}
    >
      <span className={`hl-bar__dot hl-bar__dot--${color}`}>
        {isPressed && <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
      </span>
    </button>
  );
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="hl-bar__act" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

export type HighlightActions = {
  /** 고른 구절을 이 색으로 칠한다(비로그인이면 로그인 안내) */
  onCreate: (range: TextRange, color: HighlightColor) => void;
  /** 메모 시트 — 새 구절이면 range, 이미 칠한 구절이면 형광펜 id */
  onOpenMemo: (target: { range: TextRange } | { id: string }) => void;
  onCopy: (quote: string, chunkIndex: number) => void;
  onRecolor: (item: HighlightItem, color: HighlightColor) => void;
  onErase: (item: HighlightItem) => void;
};

type ChunkText = Pick<WordChunk, "chunk_id" | "chunk_index" | "display_text">;

export function HighlightLayer({
  chunks,
  items,
  actions,
  children,
}: {
  chunks: ChunkText[];
  items: HighlightItem[];
  actions: HighlightActions;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const selection = useTextSelection({ rootRef: articleRef, wrapRef, chunks });
  const { picked, release, dismiss, hold } = selection;
  const [popover, setPopover] = useState<{ id: string; anchor: Anchor } | null>(null);
  // 새로 고른 구절이 있으면 형광펜 도구는 물러난다. 지워진 형광펜의 도구도 그리지 않는다.
  const current = popover && !picked ? items.find((item) => item.id === popover.id) : undefined;
  const isOpen = Boolean(picked || current);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      release();
      setPopover(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".hl-bar")) return;
      dismiss();
      setPopover(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen, release, dismiss]);

  // 칠한 구절·메모 표지 누르기. 글자를 끌어 고르는 중이면(선택이 남아 있으면) 도구를 열지 않는다.
  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const memo = target.closest<HTMLElement>("[data-hl-memo]")?.dataset.hlMemo;
    if (memo) {
      setPopover(null);
      actions.onOpenMemo({ id: memo });
      return;
    }
    const mark = target.closest<HTMLElement>("mark[data-hl-id]");
    const id = mark?.dataset.hlId;
    const wrap = wrapRef.current;
    if (!mark || !id || !wrap || isPendingHighlight(id)) return;
    if (window.getSelection()?.isCollapsed === false) return;
    setPopover({ id, anchor: anchorFrom(mark.getClientRects(), wrap.getBoundingClientRect(), selection.isTouch()) });
  }

  function closePopover() {
    setPopover(null);
  }

  return (
    <div className="wd-body" ref={wrapRef}>
      {/* 칠한 구절은 포인터 보조 경로다 — 키보드·스크린리더는 메모 표지 버튼, 노트 탭 목록, 단락 시트로 같은 일을 한다 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 위임 클릭 — 키보드 경로는 안쪽 버튼이 따로 있다 */}
      <article aria-label="원문 본문" ref={articleRef} onClick={handleClick}>
        {children}
      </article>
      {picked && (
        <FloatingBar label="고른 구절" anchor={picked.anchor} wrapRef={wrapRef} gapBelow={TOUCH_GAP} onHold={hold}>
          {HIGHLIGHT_COLORS.map((color) => (
            <Swatch
              key={color}
              color={color}
              onPick={(next) => {
                actions.onCreate(picked.range, next);
                release();
              }}
            />
          ))}
          <span className="hl-bar__div" aria-hidden="true" />
          <ActionButton
            icon={<NotebookPen size={20} aria-hidden="true" />}
            label="메모"
            onClick={() => {
              actions.onOpenMemo({ range: picked.range });
              release();
            }}
          />
          <ActionButton
            icon={<Copy size={20} aria-hidden="true" />}
            label="복사"
            onClick={() => {
              actions.onCopy(picked.range.quote, picked.range.startChunkIndex);
              release();
            }}
          />
        </FloatingBar>
      )}
      {current && popover && (
        <FloatingBar label="칠한 구절" anchor={popover.anchor} wrapRef={wrapRef} gapBelow={GAP} onHold={hold}>
          {HIGHLIGHT_COLORS.map((color) => (
            <Swatch
              key={color}
              color={color}
              isPressed={toHighlightColor(current.color) === color}
              onPick={(next) => {
                if (next !== current.color) actions.onRecolor(current, next);
                closePopover();
              }}
            />
          ))}
          <span className="hl-bar__div" aria-hidden="true" />
          <ActionButton
            icon={<NotebookPen size={20} aria-hidden="true" />}
            label="메모"
            onClick={() => {
              actions.onOpenMemo({ id: current.id });
              closePopover();
            }}
          />
          <ActionButton
            icon={<Copy size={20} aria-hidden="true" />}
            label="복사"
            onClick={() => {
              actions.onCopy(current.quote, current.start_chunk_index);
              closePopover();
            }}
          />
          <ActionButton
            icon={<Trash2 size={20} aria-hidden="true" />}
            label="지우기"
            onClick={() => {
              actions.onErase(current);
              closePopover();
            }}
          />
        </FloatingBar>
      )}
    </div>
  );
}
