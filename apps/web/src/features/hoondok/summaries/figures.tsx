"use client";

import type { SummaryPublicImage } from "@truewords/api-client-ts/types";
import { useState } from "react";

const LABEL = { concept: "개념", scene: "장면" } as const;
type Kind = keyof typeof LABEL;

/** 개념·장면 그림 두 장을 토글로 보여 준다. 한 장뿐이면 토글 없이 그 그림만. */
export function SummaryFigures({ images }: { images: SummaryPublicImage[] }) {
  const ordered = (["concept", "scene"] as const)
    .map((kind) => images.find((image) => image.kind === kind))
    .filter((image): image is SummaryPublicImage => Boolean(image));
  const [selected, setSelected] = useState<Kind>(ordered[0]?.kind ?? "concept");
  const current = ordered.find((image) => image.kind === selected) ?? ordered[0];
  if (!current) return null;
  return (
    <section className="sum-figures" aria-label="그림">
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
        {/* 권리 검사를 거치는 같은 origin 이미지에는 이미지 프록시 캐시를 쓰지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt={current.alt} />
        {current.caption && <figcaption>{current.caption}</figcaption>}
      </figure>
    </section>
  );
}
