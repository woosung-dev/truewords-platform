"use client";

// 나의 책갈피 부채 (SCR-PWA-026, 시안 A "부채 돌리기"). 책등을 누르면 그 책에서 받은 카드가 부채로 펼쳐지고,
// 부채는 다이얼처럼 돈다 — 고른 카드는 늘 가운데에 똑바로 선다. 넘기기: 양옆 버튼·보이는 카드 누르기·가로 드래그·←/→/Home/End.
// 끝에서 더 넘기면 돌아 감지 않고 부채가 살짝 밀렸다 돌아온다. Esc·배경막·포커스 가둠은 <dialog> 가 맡는다.
// 부채에는 최근 7장까지만 놓는다 — 그보다 많으면 겹쳐 읽을 수 없다. 나머지는 아래 목록에 있다.
import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CardPublic, CardReceiptItem } from "../api";
import {
  dragPosition,
  dragUnit,
  type FanGeometry,
  fanPose,
  fitFan,
  releaseIndex,
  stepIndex,
} from "../fan-geometry";
import { defaultBackground, sourceText } from "../look";
import { prefersReducedMotion } from "../motion";
import { readCardLook } from "../storage";
import { PhotoCard } from "./photo-card";

export const FAN_MAX = 7;

const NAV = 52; // 넘김 버튼 지름
const PILL_H = 36; // 위치 알약 높이(CSS 와 같다)
const BUMP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** 무대 크기에 맞춘 부채 자리 */
type Layout = {
  g: FanGeometry;
  pivotX: number;
  pivotY: number;
  boxBottom: number;
  prev: { x: number; y: number };
  next: { x: number; y: number };
  glow: { x: number; y: number };
};

type Drag = { id: number; x0: number; y0: number; p0: number; isOn: boolean; hist: [number, number][] };

function measure(stage: HTMLElement, count: number): Layout {
  const isWide = window.innerWidth >= 768;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const hasNav = count > 1;
  const side = isWide && hasNav ? NAV + 20 : 0; // PC 는 부채 양옆에 버튼 자리
  // 모바일은 대화상자 좌우 여백까지 써도 된다(바깥 카드는 화면 끝에서 잘린다)
  const availW = Math.max(0, isWide ? sw - side * 2 : window.innerWidth - 8);
  const availH = Math.max(0, sh - (hasNav ? PILL_H + 26 : 0));
  const g = fitFan({ count, availW, availH, isWide });
  const bh = g.maxY - g.minY;
  const top = Math.max(0, (availH - bh) / 2);
  const pivotX = sw / 2 - (g.minX + g.maxX) / 2;
  const pivotY = top + g.maxY;
  const boxBottom = top + bh;
  const pillMid = boxBottom + 12 + PILL_H / 2;
  // PC: 버튼은 부채 양옆, 가운데 카드 높이의 가운데. 모바일: 알약과 같은 줄 양쪽
  const midY = pivotY - g.d - g.H / 2;
  const prev = isWide
    ? { x: Math.max(0, pivotX + g.minX - NAV - 16), y: midY - NAV / 2 }
    : { x: Math.max(0, pivotX - 150), y: pillMid - NAV / 2 };
  const next = isWide
    ? { x: Math.min(sw - NAV, pivotX + g.maxX + 16), y: midY - NAV / 2 }
    : { x: Math.min(sw - NAV, pivotX + 98), y: pillMid - NAV / 2 };
  const rect = stage.getBoundingClientRect();
  return { g, pivotX, pivotY, boxBottom, prev, next, glow: { x: rect.left + pivotX, y: rect.top + midY } };
}

export function FanDialog({
  title,
  items,
  onShare,
  onClose,
}: {
  title: string;
  /** 그 책에서 받은 책갈피(최신순) */
  items: CardReceiptItem[];
  onShare: (card: CardPublic) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();
  const deckId = useId();
  const shown = useMemo(() => items.slice(0, FAN_MAX), [items]);
  const count = shown.length;
  const [current, setCurrent] = useState(0);
  /** 지금 가운데 있는 자리. 드래그 중에는 소수 */
  const [pos, setPos] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  /** 열릴 때 한 묶음에서 부채로 펼쳐진다. 펼치기 전에는 모두 가운데에 모여 있다 */
  const [isSpread, setIsSpread] = useState(prefersReducedMotion);
  const [isDragging, setIsDragging] = useState(false);
  const [live, setLive] = useState("");
  const dragRef = useRef<Drag | null>(null);
  const wasDraggedRef = useRef(false);
  const openerRef = useRef<Element | null>(null);
  const selected = shown[current] ?? shown[0];

  // 열 때 누른 책등을 기억했다가 닫으면 그 자리로 포커스를 돌려준다(ReaderSheet 와 같은 규칙).
  // 정리 함수는 늘 돌려준다 — StrictMode 의 두 번째 실행에서 빠지면 닫을 때 포커스가 body 로 간다.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      openerRef.current = document.activeElement;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      // 포커스는 대화상자 자체에 둔다 — 방향키로 바로 넘길 수 있고, Tab 은 이전 버튼부터 돈다
      dialog.focus();
    }
    return () => {
      queueMicrotask(() => {
        const opener = openerRef.current;
        if (
          !dialog?.isConnected &&
          opener instanceof HTMLElement &&
          opener.isConnected &&
          document.activeElement !== opener
        )
          opener.focus();
      });
    };
  }, []);

  // 무대 크기가 바뀌면(회전·창 크기) 부채를 다시 맞춘다
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setLayout(measure(stage, count));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [count]);

  // 모인 자리를 한 번 그린 다음 프레임에 펼친다. 동작 줄이기면 처음부터 펼친 채로 보인다
  const hasLayout = layout !== null;
  useEffect(() => {
    if (!hasLayout || isSpread) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setIsSpread(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [hasLayout, isSpread]);

  // 카드 그림은 넘길 때마다 다시 그리지 않는다(자세는 바깥 팔이 맡는다)
  const faces = useMemo(
    () =>
      shown.map((item) => (
        <PhotoCard
          key={item.card.id}
          card={item.card}
          bg={readCardLook(item.card.id)?.bg ?? defaultBackground(item.card.id)}
          src="book"
          isDecorative
        />
      )),
    [shown],
  );

  function go(target: number) {
    const next = Math.max(0, Math.min(count - 1, target));
    setPos(next);
    if (next === current) return;
    setCurrent(next);
    setLive(`${count}장 중 ${next + 1}번째 말씀이에요`);
  }

  // 끝에서 더 넘기려 하면 부채가 살짝 밀렸다 돌아온다 (돌아 감기 대신)
  function bump(dir: -1 | 1) {
    setLive(dir < 0 ? "첫 번째 말씀이에요" : "마지막 말씀이에요");
    const deck = deckRef.current;
    if (!deck || prefersReducedMotion() || typeof deck.animate !== "function") return;
    deck.animate(
      [{ transform: "none" }, { transform: `rotate(${dir < 0 ? 2.4 : -2.4}deg)`, offset: 0.4 }, { transform: "none" }],
      { duration: 420, easing: BUMP_EASE },
    );
  }

  function step(dir: -1 | 1) {
    const target = stepIndex(current, dir, count);
    if (target === null) bump(dir);
    else go(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (count < 2) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      go(event.key === "Home" ? 0 : count - 1);
    }
  }

  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  // 가로 드래그: 손가락을 따라 부채가 돌고, 놓으면 빠르기를 더해 가까운 카드에 멈춘다
  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (count < 2 || event.button !== 0 || (event.target as Element).closest(".bks-fan__nav")) return;
    dragRef.current = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      p0: current,
      isOn: false,
      hist: [[event.timeStamp, event.clientX]],
    };
    wasDraggedRef.current = false;
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id || !layout) return;
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.isOn) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      drag.isOn = true;
      wasDraggedRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsDragging(true);
    }
    drag.hist.push([event.timeStamp, event.clientX]);
    if (drag.hist.length > 6) drag.hist.shift();
    setPos(dragPosition(drag.p0, dx, dragUnit(layout.g), count));
  }

  function handlePointerEnd(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    dragRef.current = null;
    if (!drag.isOn || !layout) return;
    setIsDragging(false);
    const [t0, x0] = drag.hist[0];
    const velocity = (event.clientX - x0) / Math.max(16, event.timeStamp - t0);
    go(releaseIndex(pos, velocity, dragUnit(layout.g), count));
    // 드래그 끝의 click 이 카드 누르기로 읽히지 않게 한 틱 뒤에 푼다
    setTimeout(() => {
      wasDraggedRef.current = false;
    }, 0);
  }

  const reduced = prefersReducedMotion();
  const g = layout?.g;
  const radius = g ? g.d + g.H : 0;
  const hasNav = count > 1;
  const dialogStyle = layout
    ? ({ "--fan-glow-x": `${layout.glow.x}px`, "--fan-glow-y": `${layout.glow.y}px` } as CSSProperties)
    : undefined;

  return (
    <dialog
      className={["bks-fan", isSpread ? "" : "is-gathered", isDragging ? "is-drag" : ""].filter(Boolean).join(" ")}
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      tabIndex={-1}
      style={dialogStyle}
      onClose={onClose}
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="bks-fan__in">
        <header className="bks-fan__head">
          <p className="bks-fan__eye">{items.length}장 모았어요</p>
          <h2 className="bks-fan__title" id={titleId}>
            {title}
          </h2>
          <p className="bks-fan__hint" id={hintId}>
            {hasNav ? "양옆 화살표나 옆 카드를 누르면 넘어가요" : "받은 말씀을 건네 보세요"}
          </p>
        </header>
        <section
          className="bks-fan__stage"
          ref={stageRef}
          aria-roledescription="carousel"
          aria-label={`${title} 말씀 카드 ${count}장`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div
            className="bks-fan__deck"
            id={deckId}
            ref={deckRef}
            style={layout ? { transformOrigin: `${layout.pivotX}px ${layout.pivotY}px` } : undefined}
          >
            {shown.map((item, index) => {
              const offset = index - pos;
              const pose = g ? fanPose(offset, g) : null;
              const distance = Math.abs(index - current);
              // 먼 카드일수록 조금 늦게 따라온다. 펼칠 때는 가운데부터 차례로
              const delay = reduced || isDragging ? 0 : isSpread ? Math.min(4, distance) * 22 : 60 + distance * 45;
              const armStyle: CSSProperties =
                layout && g && pose
                  ? {
                      width: g.W,
                      left: layout.pivotX - g.W / 2,
                      top: layout.pivotY - radius,
                      transformOrigin: `50% ${radius}px`,
                      transform: isSpread ? `rotate(${pose.angle.toFixed(3)}deg)` : "translateY(40px)",
                      opacity: isSpread ? pose.opacity : 0,
                      zIndex: 100 - Math.round(Math.abs(offset) * 10),
                      transitionDelay: `${delay}ms`,
                      pointerEvents: pose.opacity < 0.5 ? "none" : undefined,
                    }
                  : { opacity: 0 };
              return (
                <div key={item.card.id} className="bks-fan__arm" style={armStyle}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="bks-fan__card"
                    aria-label={item.card.text}
                    aria-current={index === current}
                    style={
                      pose
                        ? {
                            transform: `translateY(${(-pose.lift).toFixed(2)}px) scale(${pose.scale.toFixed(4)})`,
                            transitionDelay: `${delay}ms`,
                          }
                        : undefined
                    }
                    // 마우스로 눌러도 카드에 포커스를 두지 않는다(키보드는 ←/→ 와 버튼)
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!wasDraggedRef.current && index !== current) go(index);
                    }}
                  >
                    {faces[index]}
                    <span
                      className="bks-fan__dim"
                      aria-hidden="true"
                      style={pose ? { opacity: pose.dim.toFixed(3), transitionDelay: `${delay}ms` } : undefined}
                    />
                    <span
                      className="bks-fan__ring"
                      aria-hidden="true"
                      style={pose ? { opacity: Math.max(0, 1 - Math.abs(offset) * 2.5).toFixed(3) } : undefined}
                    />
                  </button>
                </div>
              );
            })}
          </div>
          {hasNav && layout && (
            <>
              <button
                className="bks-fan__nav"
                type="button"
                aria-label="이전 말씀"
                aria-controls={deckId}
                aria-disabled={current === 0}
                style={{ left: layout.prev.x, top: layout.prev.y }}
                onClick={() => step(-1)}
              >
                <ChevronLeft size={26} aria-hidden="true" />
              </button>
              <p
                className="bks-fan__count"
                aria-hidden="true"
                style={{ left: layout.pivotX, top: layout.boxBottom + 12 }}
              >
                <b>{current + 1}</b> / {count}
              </p>
              <button
                className="bks-fan__nav"
                type="button"
                aria-label="다음 말씀"
                aria-controls={deckId}
                aria-disabled={current === count - 1}
                style={{ left: layout.next.x, top: layout.next.y }}
                onClick={() => step(1)}
              >
                <ChevronRight size={26} aria-hidden="true" />
              </button>
            </>
          )}
        </section>
        <div className="bks-fan__info">
          {/* 모든 말씀을 한 칸에 겹쳐 두고 고른 것만 보인다 — 칸 높이가 가장 긴 말씀에 맞춰져 넘길 때 출렁이지 않는다 */}
          <div className="bks-fan__txt">
            {shown.map((item, index) => (
              <div
                key={item.card.id}
                className="bks-fan__say"
                data-on={index === current ? "1" : undefined}
                aria-hidden={index !== current}
              >
                <p className="bks-fan__q">{item.card.text}</p>
                <p className="bks-fan__src">{sourceText(item.card, "full")}</p>
              </div>
            ))}
          </div>
          {items.length > count && (
            <p className="bks-fan__more">그 밖의 {items.length - count}장은 아래 목록에 있어요</p>
          )}
          <div className="bks-fan__acts">
            <button
              className="pc-cta pc-cta--gold"
              type="button"
              disabled={!selected}
              onClick={() => selected && onShare(selected.card)}
            >
              이 말씀 건네기
              <span className="pc-cta__ic" aria-hidden="true">
                <Share2 size={22} />
              </span>
            </button>
            <button className="bks-fan__close" type="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <p className="bks-fan__live" aria-live="polite">
          {live}
        </p>
      </div>
    </dialog>
  );
}
