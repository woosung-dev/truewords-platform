"use client";

// SCR-PWA-005b 질문 기록 — 묻기 홈에서 분리한 라이브러리(DES-PWA-003 §2.9 2026-09-16 정정).
// 목록의 원본은 이 기기의 localStorage 하나뿐이라 다른 기기·계정에서는 보이지 않는다(REQ-PWA-015).
import { MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { askMetaLabel } from "../format";
import { type AskItem, EMPTY_ASK_ITEMS, readAskItems, subscribeAsk } from "../storage";

type SegmentId = "mine" | "saved" | "family";

export function AskLog() {
  const items = useSyncExternalStore(subscribeAsk, readAskItems, () => EMPTY_ASK_ITEMS as AskItem[]);
  const [segment, setSegment] = useState<SegmentId>("mine");
  const saved = items.filter((item) => item.isSaved);
  const shown = segment === "saved" ? saved : items;

  const segments = [
    { id: "mine" as const, label: `내 질문 ${items.length}` },
    { id: "saved" as const, label: `저장한 답 ${saved.length}` },
    // 커뮤니티(식구들 질문)는 이번 범위가 아니다 — 형태만 두고 왜 꺼졌는지는 글자가 말한다(§3.3).
    { id: "family" as const, label: "식구들 질문", isSoon: true },
  ];

  return (
    <section className="col col--read">
      <div className="pill-seg" role="tablist" aria-label="질문 기록 보기">
        {segments.map((item) => (
          <button
            key={item.id}
            className={item.id === segment ? "is-on" : ""}
            type="button"
            role="tab"
            id={`ask-seg-${item.id}`}
            aria-selected={item.id === segment}
            aria-controls="ask-seg-panel"
            disabled={item.isSoon}
            aria-disabled={item.isSoon}
            onClick={() => setSegment(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {/* 왜 꺼져 있는지는 색이 아니라 글자가 말한다 (DES-PWA-003 §3.3). 세그먼트 안에 넣으면 390px 에서 두 줄이 된다 */}
      <p className="pill-seg__soon">식구들 질문은 준비 중이에요</p>

      <div id="ask-seg-panel" role="tabpanel" aria-labelledby={`ask-seg-${segment}`}>
        {shown.length === 0 ? (
          <div className="empty">
            <span className="empty__ic">
              <MessageCircleQuestion size={26} aria-hidden="true" />
            </span>
            <h2 className="empty__title">{segment === "saved" ? "저장한 답이 없어요" : "아직 질문이 없어요"}</h2>
            <p className="empty__body">말씀을 읽다 생긴 물음을 편하게 적어 보세요.</p>
            <Link className="btn btn-line ql-empty__cta" href="/hoondok/ask">
              질문하러 가기
            </Link>
          </div>
        ) : (
          <ol className="ql-list">
            {shown.map((item) => (
              <li key={item.id}>
                <Link href={`/hoondok/ask/${item.id}`}>
                  <span className="ql-q">{item.question}</span>
                  <span className="ql-m">
                    {askMetaLabel(item)}
                    {item.isSaved && <span className="badge ql-saved">저장됨</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="notice">질문과 답은 이 기기에만 저장돼요</p>
    </section>
  );
}
