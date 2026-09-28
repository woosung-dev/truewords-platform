"use client";

// SCR-PWA-023 /hoondok/bookmark — 받는 순간 → 읽기 (PLAN-HD-012).
// 오늘 처음이면 책이 벌어지고 책갈피가 올라와 카드로 펼쳐진다(약 1.6초, 1회). 이미 받은 날은 모션 없이 바로 읽기.
// 받기 기록: 비로그인은 이 기기(localStorage KST 날짜 키), 로그인은 receive(049) — use-cards.ts.
// 버튼: 책에 다시 꽂기(주, 역방향 모션 뒤 서고 원문) · 나의 책갈피 · 건네기(시트).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardPublic } from "../api";
import { cardDotDate, cardLongDate } from "../format";
import {
  clearAnimations,
  flipTransform,
  foldSteps,
  type MotionTarget,
  playSteps,
  prefersReducedMotion,
  pulloutEnterSteps,
  receiveSteps,
} from "../motion";
import { cardWordsHref } from "../share";
import { useCardReceipt, useMarkShared } from "../use-cards";
import { Book, bookName } from "./book";
import { BookmarkCard } from "./bookmark-card";
import { type ShareOutcome, ShareSheet } from "./share-sheet";

type Phase = "wait" | "moment" | "read" | "fold";

const TOAST: Partial<Record<ShareOutcome, string>> = {
  file: "책갈피를 건넸어요",
  link: "책갈피를 건넸어요",
  clipboard: "말씀과 출처·링크를 복사했어요. 대화방에 붙여 넣어 주세요",
  copied: "말씀과 출처·링크를 글로 복사했어요",
};

export function BookmarkScreen({ card, today, from }: { card: CardPublic; today: string; from?: string }) {
  const router = useRouter();
  const { isReceived, isResolved, markReceived, userId } = useCardReceipt(card.id);
  const markShared = useMarkShared();
  const [phase, setPhase] = useState<Phase>("wait");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const els = useRef<Partial<Record<MotionTarget, HTMLElement | null>>>({});
  const bind = (target: MotionTarget) => (element: HTMLElement | null) => {
    els.current[target] = element;
  };
  const stageRef = useRef<HTMLDivElement>(null);
  const resolve = useCallback((target: MotionTarget) => els.current[target], []);

  // 리본 제자리(열림) 사각형 = 리본 위 끝 ~ 표지 위 모서리. 닫힘 transform 을 잠시 걷고 잰다.
  const ribbonRect = useCallback(() => {
    const rib = els.current.rib;
    const cover = els.current.cover;
    if (!rib || !cover) return null;
    const previous = rib.style.transform;
    rib.style.transform = "none";
    const r = rib.getBoundingClientRect();
    rib.style.transform = previous;
    const c = cover.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: Math.max(1, c.y - r.y) };
  }, []);

  // 1) 받음 판정이 끝나면 한 번만 단계를 정한다 (판정 전에는 카드를 보이지 않는다)
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !isResolved) return;
    decided.current = true;
    if (isReceived) {
      setPhase("read");
      return;
    }
    markReceived(card.id);
    setPhase("moment");
  }, [isResolved, isReceived, markReceived, card.id]);

  // 2) 받는 순간 재생 (레이아웃이 그려진 뒤 FLIP 좌표를 잰다)
  useLayoutEffect(() => {
    if (phase !== "moment") return;
    const cardEl = els.current.card;
    const from = ribbonRect();
    if (!cardEl || !from) {
      setPhase("read");
      return;
    }
    const steps = receiveSteps({
      reduced: prefersReducedMotion(),
      flipStart: flipTransform(from, cardEl.getBoundingClientRect()),
    });
    let isCancelled = false;
    void playSteps(steps, resolve).then(() => {
      if (isCancelled) return;
      setPhase("read");
    });
    return () => {
      isCancelled = true;
    };
  }, [phase, resolve, ribbonRect]);

  // 읽기로 넘어오면 모션 fill 을 걷어 CSS 상태로 둔다. 원문에서 "다시 꺼내기" 로 왔으면 카드가 아래에서 올라온다.
  const hasPulledOut = useRef(false);
  useLayoutEffect(() => {
    if (phase !== "read") return;
    clearAnimations(stageRef.current);
    if (from === "words" && !hasPulledOut.current) {
      hasPulledOut.current = true;
      void playSteps(pulloutEnterSteps(prefersReducedMotion()), resolve).then(() => clearAnimations(stageRef.current));
    }
  }, [phase, from, resolve]);

  // 3) 책에 다시 꽂기: 역방향 모션(약 0.9초) 뒤 서고 원문으로
  useLayoutEffect(() => {
    if (phase !== "fold") return;
    const cardEl = els.current.card;
    const to = ribbonRect();
    const href = cardWordsHref(card);
    if (!cardEl || !to) {
      router.push(href);
      return;
    }
    const steps = foldSteps({
      reduced: prefersReducedMotion(),
      flipEnd: flipTransform(to, cardEl.getBoundingClientRect()),
    });
    void playSteps(steps, resolve).then(() => router.push(href));
  }, [phase, card, resolve, ribbonRect, router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleShareDone(outcome: ShareOutcome) {
    const isGiven = outcome === "file" || outcome === "link" || outcome === "clipboard" || outcome === "copied";
    if (isGiven && userId) markShared.mutate(card.id);
    const message = TOAST[outcome];
    if (message) setToast(isGiven && userId && outcome !== "copied" ? `${message} · 나의 책갈피에 남았어요` : message);
    if (outcome === "file" || outcome === "link") setIsSheetOpen(false);
  }

  const isMomentShown = phase === "moment" || phase === "fold";
  const className = ["bmk", `bmk--${phase}`].join(" ");
  return (
    <section className={`col ${className}`}>
      <div className="bmk-stage" ref={stageRef}>
        <BookmarkCard
          card={card}
          eyebrow={`오늘의 책갈피 · ${cardDotDate(today)}`}
          className="bm--full bmk-card"
          refs={{ card: bind("card"), inner: bind("inner"), veil: bind("veil") }}
        />
        <div className="bmk-moment" ref={bind("moment")} aria-hidden="true" hidden={!isMomentShown}>
          <p className="bmk-moment__date">{cardLongDate(today)}</p>
          <p className="bmk-moment__t">오늘의 책갈피</p>
          <div className="bmk-moment__bk" ref={bind("book")}>
            <Book
              card={card}
              size="lg"
              isOpen={phase === "fold"}
              refs={{ cover: bind("cover"), glow: bind("glow"), rib: bind("rib"), tassel: bind("tassel") }}
            />
          </div>
          <p className="bmk-moment__cap" ref={bind("caption")}>
            {bookName(card)}에서 꺼냈어요
          </p>
        </div>
      </div>
      <div className="bmk-actions" ref={bind("ui")}>
        <button
          className="btn btn-primary btn--tall"
          type="button"
          disabled={phase !== "read"}
          onClick={() => setPhase("fold")}
        >
          책에 다시 꽂기
          <small>앞뒤 문맥을 원문에서 읽어요</small>
        </button>
        <div className="bmk-row2">
          <Link className="btn btn-line" href="/hoondok/bookmarks">
            나의 책갈피
          </Link>
          <button className="btn btn-line" type="button" onClick={() => setIsSheetOpen(true)}>
            건네기
          </button>
        </div>
      </div>
      <p className="bmk-toast" role="status" aria-live="polite" data-on={toast ? "1" : undefined}>
        {toast}
      </p>
      {isSheetOpen && <ShareSheet card={card} onClose={() => setIsSheetOpen(false)} onDone={handleShareDone} />}
    </section>
  );
}
