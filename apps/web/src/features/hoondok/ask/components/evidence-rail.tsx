"use client";

// 근거 말씀 — 질문 아래 색인 칩, 답 끝 근거 번호, 근거 카드 목록, 전문 시트. 질문 상세·공개 질문이 같이 쓴다.
// 공식 원문은 흰 카드·실선 인용·검은 사각 번호, AI 설명은 점선(.ai-note)이라 색이 아닌 모양으로 갈린다 (DES §3.3).
// 카드마다 출처 줄이 말씀보다 먼저 오고 모르는 칸은 생략하지 않는다 (REQ-PWA-012).
// 색인 칩·근거 번호·카드 어느 것을 눌러도 화면을 떠나지 않고 같은 전문 시트가 열린다. 근거 글은 답과 함께 이미 받았으므로
// 시트는 따로 불러오지 않는다. 열림 상태는 지역 상태다.
// 문장마다 근거 번호를 다는 것은 API 가 문장별 인용을 주지 않아 하지 않는다 — 지어낸 연결은 근거 신뢰를 깬다.
import { BookOpen, ChevronLeft, ChevronRight, Info, Lock, Star } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";

export type RailItem = {
  key: string;
  /** 저작물 이름(천성경 등). */
  label: string;
  text: string;
  /** 출처 둘째 줄 — 결측 항목 모음. 없으면 그리지 않는다. */
  meta?: string;
  /** 원문으로 갈 수 있으면 주소. 권리 확인 전·불가면 없다. */
  href?: string;
  /** href 가 없을 때 원문 링크 자리에 둘 안내. */
  notice?: string;
};

/** 열린 근거 번호(0부터)를 들고 있다. 색인 칩·근거 번호·목록이 같은 시트를 연다. */
export function useEvidenceSheet() {
  const [open, setOpen] = useState<number | null>(null);
  return { open, show: setOpen, close: () => setOpen(null) };
}

/** 공식 원문 번호 꼬리표. 답 끝 번호·칩·카드·시트가 같은 모양이라 짝이 바로 보인다. */
function Num({ n, size }: { n: number; size?: "sm" | "lg" }) {
  return (
    <span className={`ask-num${size ? ` ask-num--${size}` : ""}`} aria-hidden="true">
      {n}
    </span>
  );
}

function SourceHead({ item, index, size }: { item: RailItem; index: number; size?: "lg" }) {
  return (
    <div className="ask-src">
      <Num n={index + 1} size={size} />
      <div className="ask-src__t">
        <p className="ask-src__name">{item.label}</p>
        {item.meta && (
          <p className="ask-src__meta">
            <Info size={13} aria-hidden="true" />
            {item.meta}
          </p>
        )}
      </div>
    </div>
  );
}

/** 질문 아래 근거 색인 — 근거 이름만 먼저 보이고 전문은 목록·시트에서 읽는다. */
export function EvidenceIndex({ items, onOpen }: { items: RailItem[]; onOpen: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="ask-idx">
      <p className="ask-idx__k">
        <BookOpen size={14} aria-hidden="true" />
        {`근거 말씀 ${items.length}`}
      </p>
      <div className="ask-idx__chips">
        {items.map((item, index) => (
          <button
            type="button"
            className="ask-idx__chip"
            key={item.key}
            onClick={() => onOpen(index)}
            aria-label={`근거 ${index + 1} ${item.label} 말씀 보기`}
          >
            <Num n={index + 1} size="sm" />
            <span className="ask-idx__name">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 답 끝 근거 번호. 숫자가 의미를 담으므로 색만으로 구분하지 않는다 (DES §2.2). */
export function EvidenceRefs({ items, onOpen }: { items: RailItem[]; onOpen: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <p className="ask-refs">
      <span className="ask-refs__k">근거</span>
      {items.map((item, index) => (
        <button
          type="button"
          className="ask-ref"
          key={item.key}
          onClick={() => onOpen(index)}
          aria-label={`근거 ${index + 1} ${item.label} 말씀 보기`}
        >
          <Num n={index + 1} size="sm" />
        </button>
      ))}
    </p>
  );
}

/** 근거 카드 목록. 카드 전체가 전문 시트를 연다(원문 링크는 시트 안에 둔다 — 버튼 안에 링크를 겹치지 않는다). */
export function EvidenceRail({ items, onOpen }: { items: RailItem[]; onOpen: (index: number) => void }) {
  return (
    <ol className="ask-evl">
      {items.map((item, index) => (
        <li key={item.key}>
          <button
            type="button"
            className={`ask-ev${index === 0 ? " ask-ev--key" : ""}`}
            onClick={() => onOpen(index)}
            aria-label={`근거 ${index + 1} ${item.label} 말씀 전문 보기`}
          >
            {index === 0 && (
              <span className="ask-ev__band">
                <Star size={14} aria-hidden="true" />
                핵심 근거
              </span>
            )}
            <SourceHead item={item} index={index} />
            <span className="scripture ask-ev__t">{item.text}</span>
            <span className="ask-ev__foot">
              {item.href ? (
                <span className="ask-ev__more">
                  원문 보기
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              ) : (
                <>
                  <span className="ask-ev__notice">
                    {item.notice && <Lock size={14} aria-hidden="true" />}
                    {item.notice}
                  </span>
                  <ChevronRight className="ask-ev__chev" size={16} aria-hidden="true" />
                </>
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function EvidenceSheet({
  items,
  index,
  onMove,
  onClose,
}: {
  items: RailItem[];
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
}): ReactNode {
  const item = items[index];
  if (!item) return null;
  return (
    <ReaderSheet title={`근거 ${index + 1} · ${item.label}`} onClose={onClose}>
      <div className="ask-evs">
        {items.length > 1 && (
          <div className="ask-evs__pos" role="group" aria-label="근거 고르기">
            {items.map((other, i) => (
              <button
                type="button"
                key={other.key}
                className="ask-evs__go"
                onClick={() => onMove(i)}
                aria-current={i === index ? "true" : undefined}
                aria-label={`근거 ${i + 1} ${other.label}`}
              >
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ask-evs__card">
          <SourceHead item={item} index={index} size="lg" />
          <p className="scripture ask-evs__t">{item.text}</p>
        </div>
        {item.href ? (
          <Link className="ask-evs__orig" href={item.href}>
            원문 보기
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          item.notice && (
            <p className="ask-evs__note">
              <Lock size={14} aria-hidden="true" />
              {item.notice}
            </p>
          )
        )}
        {items.length > 1 && (
          <nav className="ask-evs__nav" aria-label="근거 넘기기">
            <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0}>
              <ChevronLeft size={18} aria-hidden="true" />
              이전 근거
            </button>
            <button type="button" onClick={() => onMove(index + 1)} disabled={index === items.length - 1}>
              다음 근거
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </ReaderSheet>
  );
}
