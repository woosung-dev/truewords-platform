"use client";

// SCR-PWA-022 홈 "오늘의 책갈피" 판. 하늘 지평선에 걸친 홈의 주인공 판으로, 오늘 꽂힌 책갈피를 그 자리에서 꺼낸다.
// 꺼내기 전에는 책 이름과 날짜만 보인다 — 본문·출처는 DOM 에 넣지 않는다. 꺼내면 종이가 들리며 가로형 사진 카드로 바뀌고
// (lift 모션, transform·opacity·filter 만), 카드 아래 "책에 다시 꽂기" 가 원문 자리로 이어 준다. 오늘 이미 꺼냈으면 모션 없이 연 상태다.
// 판 아래 52px 줄이 "나의 책갈피" 책장 입구다. 비로그인도 꺼낼 수 있고, 줄만 로그인 안내로 바뀐다.
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { BookOpen, Share2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HoondokMascot } from "@/components/hoondok";
import { SKY_OWL, useSkySlot } from "@/features/hoondok/components/home-sky";
import type { SkySlot } from "@/features/hoondok/sky";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { CardPublic } from "../api";
import { defaultBackground } from "../look";
import { prefersReducedMotion } from "../motion";
import { cardWordsHref } from "../share";
import { useCardReceipt, useMarkShared, useMyCards } from "../use-cards";
import { bookName } from "./book";
import { PhotoCard } from "./photo-card";
import { isGivenOutcome, type ShareOutcome, ShareSheet, ShareToast, shareToastMessage } from "./share-sheet";

const EXPO = "cubic-bezier(.16,1,.3,1)";
const SPRING = "cubic-bezier(.34,1.45,.64,1)";
/** 준비(종이 들림) 시간. 이 뒤에 카드로 바꾼다 */
const PREP_MS = 240;

type Phase = "idle" | "prep" | "lift";

type Motion = {
  list: Animation[];
  timers: ReturnType<typeof setTimeout>[];
  isReduced: boolean;
  h0: number;
  from: DOMRect | null;
};

/** fill 기본값 both. animate 가 없는 환경(jsdom)에서는 아무것도 하지 않는다 */
function play(
  list: Animation[],
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  if (!el || typeof el.animate !== "function") return;
  list.push(el.animate(keyframes, { fill: "both", ...options }));
}

/** 가운데 기준 FLIP: from 사각형에서 to 사각형으로 */
function centerFlip(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

function BoardOwl({ serverSlot }: { serverSlot: SkySlot }) {
  const slot = useSkySlot(serverSlot);
  return (
    <span className="home-board__owl">
      <HoondokMascot pose={SKY_OWL[slot]} size={64} />
    </span>
  );
}

/** 판 아래 책장 줄. 로그인 사용자는 나의 책갈피로, 비로그인은 로그인 안내로 간다. 장수는 서버 값이 온 뒤에만 말한다 */
function ShelfRow({ isIn }: { isIn: boolean }) {
  const { user, isLoading } = useCurrentUser();
  const received = useMyCards("received", user?.id ?? null);
  if (isLoading) return <span className="home-board__shelf home-board__shelf--wait" aria-hidden="true" />;
  const spines = (
    <span className="home-board__sps" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <b />
    </span>
  );
  const nub = (
    <span className="home-board__shelf-nub" aria-hidden="true">
      <ArrowRightIcon size={16} />
    </span>
  );
  if (!user)
    return (
      <Link className="home-board__shelf" href={onboardingHref("/")} data-row="">
        {spines}
        <span className="home-board__shelf-t">로그인하면 책갈피를 모아 둘 수 있어요</span>
        {nub}
      </Link>
    );
  const count = received.data?.items.length;
  return (
    <Link className="home-board__shelf" href="/bookmarks" data-row="">
      {spines}
      <span className="home-board__shelf-t">
        <b>
          나의 책갈피
          {count !== undefined && (
            <>
              {" "}
              <span className={`home-board__shelf-n${isIn ? " is-in" : ""}`}>{count}</span>장
            </>
          )}
        </b>{" "}
        <span>· 모두 보기</span>
      </span>
      {nub}
    </Link>
  );
}

/** 판이 아직 무엇을 그릴지 모를 때(서버·hydration·받음 판정 전)의 정적 자리. 닫힌 판과 같은 높이를 지킨다 */
export function HomeBoardSkeleton({ serverSlot }: { serverSlot: SkySlot }) {
  return (
    <section className="home-board" data-state="loading" aria-busy="true" aria-label="오늘의 책갈피를 불러오는 중">
      <BoardOwl serverSlot={serverSlot} />
      <div className="home-board__core">
        <span className="home-board__kick">오늘의 책갈피</span>
        <p className="home-board__title" aria-hidden="true">
          <span className="home-board__skel" />
        </p>
        <p className="home-board__lede" aria-hidden="true">
          <span className="home-board__skel home-board__skel--short" />
        </p>
        <div className="home-board__pocket" aria-hidden="true">
          <div className="home-board__pages" />
        </div>
        <span className="home-board__pull home-board__pull--wait" aria-hidden="true" />
        <span className="home-board__shelf home-board__shelf--wait" aria-hidden="true" />
      </div>
    </section>
  );
}

/** 카드가 없는 날(기능 꺼짐·오늘 카드 없음): 서고·검색으로 안내한다 */
export function HomeBoardFallback({ serverSlot }: { serverSlot: SkySlot }) {
  const kickId = useId();
  return (
    <section className="home-board" data-state="fallback" aria-labelledby={kickId}>
      <BoardOwl serverSlot={serverSlot} />
      <div className="home-board__core">
        <h2 className="home-board__kick" id={kickId}>
          말씀 서고
        </h2>
        <p className="home-board__title">말씀 서고에서 골라 읽어요</p>
        <p className="home-board__lede">읽고 싶은 말씀을 직접 골라 읽을 수 있어요.</p>
        <Link className="btn btn-primary home-board__go" href="/library">
          서고에서 고르기
          <span className="home-board__nub" aria-hidden="true">
            <BooksIcon size={20} />
          </span>
        </Link>
        <Link className="btn btn-ghost home-board__go home-board__go--2" href="/search">
          말씀 검색
          <span className="home-board__nub" aria-hidden="true">
            <MagnifyingGlassIcon size={18} />
          </span>
        </Link>
      </div>
    </section>
  );
}

export function HomeBookmarkBoard({
  card,
  dateLabel,
  serverSlot,
  footer,
}: {
  card: CardPublic;
  dateLabel: string;
  serverSlot: SkySlot;
  /** 닫힌 판 맨 아래 맞춤 줄(까닭·바꾸기 또는 고르기). 연 판에서는 그리지 않는다 */
  footer?: ReactNode;
}) {
  const kickId = useId();
  const { isReceived, isResolved, markReceived, userId } = useCardReceipt(card.id);
  const markShared = useMarkShared();
  // markReceived 는 기기 기록을 바로 써서 isReceived 가 즉시 바뀐다 — 모션 순서는 판이 따로 쥔다
  const [phase, setPhase] = useState<Phase>("idle");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const motion = useRef<Motion>({ list: [], timers: [], isReduced: true, h0: 0, from: null });

  const view =
    phase === "lift" ? "open" : phase === "prep" ? "closed" : !isResolved ? "loading" : isReceived ? "open" : "closed";

  function stopMotion() {
    const m = motion.current;
    for (const timer of m.timers) clearTimeout(timer);
    for (const animation of m.list) animation.cancel();
    m.timers = [];
    m.list = [];
  }

  // 화면을 떠나면 남은 타이머·모션을 걷는다
  useEffect(() => () => stopMotion(), []);

  function pull() {
    if (phase !== "idle") return;
    markReceived(card.id);
    const m = motion.current;
    const core = coreRef.current;
    if (!core || typeof core.animate !== "function" || prefersReducedMotion()) {
      m.isReduced = true;
      setPhase("lift");
      return;
    }
    m.isReduced = false;
    setPhase("prep");
    // 1) 준비: 글·버튼은 비켜 주고 종이는 살짝 들린다
    for (const el of core.querySelectorAll("[data-prep]"))
      play(m.list, el, [{ opacity: 1 }, { opacity: 0 }], { duration: PREP_MS - 40, easing: "ease-out" });
    const slip = core.querySelector("[data-slip]");
    play(m.list, slip, [{ transform: "none" }, { transform: "translateY(-18px) scale(1.03)" }], {
      duration: PREP_MS,
      easing: SPRING,
    });
    m.timers.push(
      setTimeout(() => {
        m.from = slip?.getBoundingClientRect() ?? null;
        m.h0 = core.offsetHeight;
        setPhase("lift");
      }, PREP_MS),
    );
  }

  // 2) 카드로 바뀐 직후(그리기 전) 새 자리를 재고 모션을 건다
  useLayoutEffect(() => {
    if (phase !== "lift") return;
    const m = motion.current;
    const core = coreRef.current;
    const frame = frameRef.current;
    frame?.focus({ preventScroll: true });
    if (!core || !frame) return;
    const cta = core.querySelector("[data-cta]");
    const row = core.querySelector("[data-row]");
    if (m.isReduced) {
      for (const el of [frame, cta, row]) play(m.list, el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      m.timers.push(setTimeout(stopMotion, 260));
      return;
    }
    const h1 = core.offsetHeight;
    if (h1 !== m.h0) {
      core.style.overflow = "hidden";
      play(m.list, core, [{ height: `${m.h0}px` }, { height: `${h1}px` }], {
        duration: 620,
        easing: EXPO,
        fill: "none",
      });
    }
    play(m.list, core.querySelector("[data-kick]"), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: 300,
      easing: "ease-out",
    });
    const to = frame.getBoundingClientRect();
    if (m.from)
      play(
        m.list,
        frame,
        [
          { transform: centerFlip(m.from, to), borderRadius: "12px" },
          { transform: "none", borderRadius: "16px" },
        ],
        { duration: 680, easing: EXPO },
      );
    const q = (selector: string) => frame.querySelector(selector);
    play(m.list, q(".pc-frame__paper"), [{ opacity: 1 }, { opacity: 0 }], {
      duration: 360,
      delay: 90,
      easing: "ease-out",
    });
    play(
      m.list,
      q(".pc__img"),
      [
        { transform: "scale(1.22)", filter: "blur(14px) saturate(.7)" },
        { transform: "none", filter: "none" },
      ],
      { duration: 1000, easing: EXPO },
    );
    play(
      m.list,
      q(".pc__quote"),
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 420, delay: 260, easing: EXPO },
    );
    // 사진 카드는 낱말을 나누지 않는다 — 본문을 한 덩이로 띄우고, 끝 시각만 낱말 수로 잡는다
    play(
      m.list,
      q(".pc__text"),
      [
        { opacity: 0, transform: "translateY(.45em)", filter: "blur(4px)" },
        { opacity: 1, transform: "none", filter: "none" },
      ],
      { duration: 460, delay: 300, easing: EXPO },
    );
    const wordCount = (q(".pc__text")?.textContent ?? "").trim().split(/\s+/).length;
    const textEnd = 300 + wordCount * 26;
    play(m.list, q(".pc__foot"), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 360,
      delay: textEnd,
      easing: "ease-out",
    });
    play(m.list, q(".pc-frame__share"), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: textEnd,
      easing: "ease-out",
    });
    for (const [index, el] of [cta, row].entries())
      play(
        m.list,
        el,
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 420, delay: 420 + index * 60, easing: EXPO },
      );
    // 시계가 멈춘 환경(백그라운드 탭)에서도 최종 모양이 남도록 fill 을 걷는다
    m.timers.push(
      setTimeout(
        () => {
          stopMotion();
          core.style.overflow = "";
        },
        Math.max(1400, textEnd + 800),
      ),
    );
  }, [phase]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleShareDone(outcome: ShareOutcome) {
    if (isGivenOutcome(outcome) && userId) markShared.mutate(card.id);
    const message = shareToastMessage(outcome, Boolean(userId));
    if (message) setToast(message);
    if (outcome === "file" || outcome === "link") setIsSheetOpen(false);
  }

  if (view === "loading") return <HomeBoardSkeleton serverSlot={serverSlot} />;
  return (
    <section className="home-board" data-state={view} aria-labelledby={kickId}>
      <BoardOwl serverSlot={serverSlot} />
      <div className="home-board__core" ref={coreRef}>
        <h2 className="home-board__kick" id={kickId} data-kick="" data-prep="">
          오늘의 책갈피
        </h2>
        {view === "closed" ? (
          <>
            <p className="home-board__title" data-prep="">
              새 책갈피가 한 장 꽂혀 있어요
            </p>
            <p className="home-board__lede" data-prep="">
              꺼내면 이 문장이 있는 원문 자리로 바로 들어가요.
            </p>
            <div className="home-board__pocket" aria-hidden="true">
              <div className="home-board__slip" data-slip="">
                <span className="home-board__ribbon" />
                <span className="home-board__ln" />
                <span className="home-board__ln" />
                <span className="home-board__ln" />
                <span className="home-board__ln" />
              </div>
              <div className="home-board__pages" />
              <p className="home-board__note" data-prep="">
                <span>{bookName(card)}에서 고른 한 장</span>
                <span>{dateLabel}</span>
              </p>
            </div>
            <button
              className="btn btn-primary home-board__pull"
              type="button"
              aria-label="오늘의 책갈피 꺼내기"
              onClick={pull}
              data-prep=""
            >
              꺼내기
              <span className="home-board__nub" aria-hidden="true">
                <ArrowUpIcon size={20} />
              </span>
            </button>
            {footer && (
              <div className="home-board__foot" data-prep="">
                {footer}
              </div>
            )}
          </>
        ) : (
          <div className="home-board__pk">
            <div className="pc-frame" ref={frameRef} tabIndex={-1} role="group" aria-label="꺼낸 오늘의 책갈피">
              <PhotoCard
                card={card}
                bg={defaultBackground(card.id)}
                className="pc--wide"
                label="오늘의 책갈피 카드"
              />
              <button
                className="pc-frame__share"
                type="button"
                aria-label="건네기"
                onClick={() => setIsSheetOpen(true)}
              >
                <Share2 aria-hidden="true" />
              </button>
              <span className="pc-frame__paper" aria-hidden="true" />
            </div>
            <Link className="pc-cta" href={cardWordsHref(card)} data-cta="">
              <span>
                책에 다시 꽂기
                <small>앞뒤 문맥을 원문에서 읽어요</small>
              </span>
              <span className="pc-cta__ic" aria-hidden="true">
                <BookOpen size={22} />
              </span>
            </Link>
          </div>
        )}
        <ShelfRow isIn={phase !== "idle"} />
      </div>
      {!isSheetOpen && <ShareToast message={toast} />}
      {isSheetOpen && (
        <ShareSheet
          card={card}
          onClose={() => setIsSheetOpen(false)}
          onDone={handleShareDone}
          toast={<ShareToast message={toast} />}
        />
      )}
    </section>
  );
}
