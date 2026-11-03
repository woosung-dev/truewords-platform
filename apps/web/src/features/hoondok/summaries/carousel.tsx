"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Slide = { asset_id: string; url: string; alt: string; caption: string };

export function SummaryCarousel({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedIndex, setIndex] = useState(0);
  const index = Math.min(selectedIndex, Math.max(0, slides.length - 1));
  const selected = useRef(0);
  useEffect(() => {
    const element = track.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => element.scrollTo({ left: Math.min(selected.current, slides.length - 1) * element.clientWidth, behavior: "instant" }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [slides.length]);
  if (!slides.length) return null;
  const move = (position: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, position));
    track.current?.scrollTo({ left: next * track.current.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <section className="sum-carousel" aria-label="요약 이미지" aria-roledescription="캐러셀">
    <div ref={track} className="sum-track" tabIndex={0} aria-label="이미지 슬라이드. 좌우 방향키로 이동" onScroll={() => {
      if (track.current?.clientWidth) {
        selected.current = Math.max(0, Math.min(slides.length - 1, Math.round(track.current.scrollLeft / track.current.clientWidth)));
        setIndex(selected.current);
      }
    }} onKeyDown={(event) => {
      const positions: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1 };
      if (event.key in positions) { event.preventDefault(); move(positions[event.key]); }
    }}>
      {slides.map((slide, i) => <figure key={slide.asset_id} className="sum-slide" aria-label={`${i + 1} / ${slides.length}`} aria-roledescription="슬라이드">
        {/* 권리 검사를 거치는 같은 origin 이미지에는 이미지 프록시 캐시를 사용하지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slide.url} alt={slide.alt} loading={i === 0 ? "eager" : "lazy"} />
      </figure>)}
    </div>
    <div className="sum-controls">
      <div className="sum-dots">{slides.map((slide, i) => <button key={slide.asset_id} type="button" onClick={() => move(i)} aria-label={`${i + 1}번째 이미지`} aria-current={i === index ? "true" : undefined}><span /></button>)}</div>
      <span aria-live="polite">{index + 1} / {slides.length}</span>
      <button type="button" disabled={index === 0} aria-label="이전 이미지" onClick={() => move(index - 1)}><ChevronLeft size={19} /></button>
      <button type="button" disabled={index === slides.length - 1} aria-label="다음 이미지" onClick={() => move(index + 1)}><ChevronRight size={19} /></button>
      <button type="button" aria-label="현재 이미지 확대" onClick={() => dialog.current?.showModal()}><Expand size={17} /></button>
    </div>
    <p className="sum-caption">{slides[index].caption}</p>
    <dialog ref={dialog} className="sum-dialog" aria-label="요약 이미지 확대">
      <button type="button" className="sum-close" aria-label="확대 이미지 닫기" onClick={() => dialog.current?.close()}><X size={22} /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={slides[index].url} alt={slides[index].alt} />
      <p>{slides[index].caption}</p>
    </dialog>
  </section>;
}
