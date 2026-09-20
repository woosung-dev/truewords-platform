"use client";

// SCR-PWA-009 원문 뷰 (PLAN-HD-002 W3-L). 프리뷰 셸 — 형광펜·노트·북마크·목차·설정은 표시만 하고
// 어떤 상태도 바꾸지 않는다. 판본 나란히·TTS·용어 칩은 비범위(§1.3)라 프로토타입에서 덜어 냈다.
// ≥1224px 에서 목차 레일 + 본문 2-pane (DES-PWA-003 §4.3), 그 아래는 단일 컬럼이다.
import { Bookmark, Highlighter, List, NotebookPen, Settings } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import type { PreviewVerse, PreviewWord } from "@/features/hoondok/preview/fixtures/library";

type SegmentId = "text" | "ai" | "note";

/** 본문으로 쓸 문서. 오늘 말씀이 편성돼 있으면 그 글이 그대로 원문 자리에 들어간다. */
export type WordsDocument = {
  title: string;
  /** 출처 줄 조각 (화자 · 말한 날 · 저작물 · 판본) */
  source: readonly string[];
  grade: PreviewWord["grade"];
  verses: readonly PreviewVerse[];
};

// 프로토타입 `.reader` 5개. 아이콘은 lucide 로 바꾸고 크기는 22 로 통일한다(≥1024 는 CSS 가 20 으로 줄인다).
const READER_TOOLS = [
  { label: "형광펜", Icon: Highlighter },
  { label: "노트", Icon: NotebookPen },
  { label: "북마크", Icon: Bookmark },
  { label: "목차", Icon: List },
  { label: "설정", Icon: Settings },
] as const;

const SEGMENTS: readonly { id: SegmentId; label: string }[] = [
  { id: "text", label: "본문" },
  { id: "ai", label: "AI 설명" },
  { id: "note", label: "노트" },
];

/** 읽기 도구 줄. 눌러도 아무 것도 바뀌지 않으므로 버튼이 아니라 표시다. */
function ReaderBar({ modifier }: { modifier: "reader--top" | "reader--bottom" }) {
  return (
    <div className={`reader ${modifier}`} aria-label="읽기 도구">
      {READER_TOOLS.map(({ label, Icon }) => (
        <span key={label} className={label === "목차" ? "reader__toc" : undefined}>
          <Icon size={22} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

function Verse({ verse }: { verse: PreviewVerse }) {
  return (
    <p className="verse">
      <span className="verse__n">{verse.no}</span>
      <span>
        {verse.segments.map((segment, index) =>
          segment.highlight ? (
            <mark key={`${verse.no}-${index}`} className={segment.highlight}>
              {segment.text}
            </mark>
          ) : (
            <Fragment key={`${verse.no}-${index}`}>{segment.text}</Fragment>
          ),
        )}
      </span>
    </p>
  );
}

export function WordsScreen({ doc, toc, tocTitle }: { doc: WordsDocument; toc: PreviewWord["toc"]; tocTitle: string }) {
  const [segment, setSegment] = useState<SegmentId>("text");

  return (
    <section className="col col--read words">
      {/* 목차 레일 : ≥1224px 에서만 보인다. 폰의 오버레이는 프로토타입과 같이 생략했다 */}
      <aside className="toc" aria-label="목차">
        <p className="toc__title">{tocTitle}</p>
        {toc.map((item) => (
          <span key={item.label} className="toc__item" aria-current={item.isCurrent ? "true" : undefined}>
            {item.label}
          </span>
        ))}
      </aside>

      <div className="words__main">
        <p className="notice">미리보기 예시 데이터입니다</p>
        {/* 앱바 제목은 화면 레지스트리가 고정하므로 문서 이름은 본문에서 한 번 더 말한다 */}
        <h2 className="lede">{doc.title}</h2>
        <div className="src lede-src">
          {doc.source.map((part, index) => (
            <Fragment key={part}>
              {index > 0 && <span className="src__dot" />}
              <span>{part}</span>
            </Fragment>
          ))}
          <AuthorityBadge grade={doc.grade} />
        </div>
        <div className="lede-rule" />

        <ReaderBar modifier="reader--top" />

        <div className="pill-seg" role="tablist" aria-label="원문 보기">
          {SEGMENTS.map((item) => (
            <button
              key={item.id}
              className={item.id === segment ? "is-on" : ""}
              type="button"
              role="tab"
              id={`wd-seg-${item.id}`}
              aria-selected={item.id === segment}
              aria-controls="wd-seg-panel"
              onClick={() => setSegment(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id="wd-seg-panel" className="wd-panel" role="tabpanel" aria-labelledby={`wd-seg-${segment}`}>
          {segment === "text" && doc.verses.map((verse) => <Verse key={verse.no} verse={verse} />)}

          {segment === "ai" && (
            <div className="ai-note">
              <p className="ai-note__lab">AI 설명</p>
              <p className="ai-note__body">
                문단마다 붙는 AI 설명은 준비 중이에요. 근거 말씀과 함께 답하는 설명은 AI 질문에서 먼저 쓸 수 있어요.
              </p>
              <Link className="btn btn-line btn--sm" href="/hoondok/ask">
                AI 질문으로 가기
              </Link>
            </div>
          )}

          {segment === "note" && (
            <div className="empty">
              <span className="empty__ic">
                <NotebookPen size={26} aria-hidden="true" />
              </span>
              <p className="empty__title">노트는 준비 중이에요</p>
              <p className="empty__body">
                읽으면서 남긴 메모를 여기에 모아요. 오늘의 한 줄은 훈독하기에서 쓸 수 있어요.
              </p>
            </div>
          )}
        </div>

        <p className="notice">형광펜·노트·북마크·설정은 준비 중이에요</p>
      </div>

      {/* 폰 하단 리더 바 — ≥1024px 에서는 숨고 위의 reader--top 이 대신한다 */}
      <ReaderBar modifier="reader--bottom" />
    </section>
  );
}
