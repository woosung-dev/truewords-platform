"use client";

import type { SummaryPublicImage } from "@truewords/api-client-ts/types";
import { Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const LABEL = { concept: "개념", scene: "장면" } as const;
type Kind = keyof typeof LABEL;

/** 개념·장면 그림 두 장을 토글로 보여 주고, 크게 보기로 화면 가득 펼친다. 한 장뿐이면 토글 없이 그 그림만. */
export function SummaryFigures({ images, id }: { images: SummaryPublicImage[]; id?: string }) {
  const ordered = (["concept", "scene"] as const)
    .map((kind) => images.find((image) => image.kind === kind))
    .filter((image): image is SummaryPublicImage => Boolean(image));
  const [selected, setSelected] = useState<Kind>(ordered[0]?.kind ?? "concept");
  const [zoomed, setZoomed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!zoomed || !dialog || dialog.open) return;
    // 배경막·포커스 가둠·Esc 는 showModal 이 맡는다. 없는 환경(jsdom)에서는 open 속성만 세운다.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, [zoomed]);
  const current = ordered.find((image) => image.kind === selected) ?? ordered[0];
  if (!current) return null;
  const close = () => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
    setZoomed(false);
  };
  return (
    <section className="sum-figures" aria-label="그림" id={id}>
      {ordered.length > 1 && (
        <div className="sum-figure-toggle" role="group" aria-label="그림 고르기">
          {ordered.map((image) => (
            <button
              key={image.kind}
              type="button"
              aria-pressed={image.kind === current.kind}
              onClick={() => setSelected(image.kind)}
            >
              {LABEL[image.kind]} 그림
            </button>
          ))}
        </div>
      )}
      <figure className="sum-figure">
        <div className="sum-figure__frame">
          {/* 권리 검사를 거치는 같은 origin 이미지에는 이미지 프록시 캐시를 쓰지 않는다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.url} alt={current.alt} />
          <button type="button" className="sum-figure__zoom" onClick={() => setZoomed(true)}>
            <Maximize2 size={16} aria-hidden="true" />
            크게 보기
          </button>
        </div>
        {current.caption && <figcaption>{current.caption}</figcaption>}
      </figure>
      <dialog
        ref={dialogRef}
        className="sum-zoom"
        aria-label={`${LABEL[current.kind]} 그림 크게 보기`}
        onClose={() => setZoomed(false)}
        onClick={(event) => {
          // 배경막을 누르면 닫는다 — 그림·캡션·닫기 버튼 위 클릭은 그대로 둔다
          if (event.target === event.currentTarget) close();
        }}
      >
        {zoomed && (
          <>
            <button type="button" className="sum-zoom__close" onClick={close} aria-label="크게 보기 닫기">
              <X size={22} aria-hidden="true" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={current.alt} />
            {current.caption && <p className="sum-zoom__caption">{current.caption}</p>}
          </>
        )}
      </dialog>
    </section>
  );
}
