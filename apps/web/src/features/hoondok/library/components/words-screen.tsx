"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { Bookmark, BookOpenText, Check, Highlighter, List, NotebookPen, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthorityBadge, HoondokButton } from "@/components/hoondok";
import { useHoondokScreenTitle } from "@/features/hoondok/screen-title";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI, wordsHref } from "../api";
import { writeLastReading } from "../last-reading";

const READER_TOOLS = [
  { label: "형광펜", Icon: Highlighter },
  { label: "노트", Icon: NotebookPen },
  { label: "북마크", Icon: Bookmark },
  { label: "목차", Icon: List },
  { label: "설정", Icon: Settings },
] as const;
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
const SEGMENTS = [
  { id: "text", label: "본문" },
  { id: "ai", label: "AI 설명" },
  { id: "note", label: "노트" },
] as const;

function StudyComplete() {
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("study", user, isLoading);
  const isDone = completion.isDone || Boolean(summary?.today.study);
  return (
    <div className="sect">
      {isDone ? (
        <div className="card read-done" role="status">
          <p>오늘 말씀 읽기를 마쳤어요.</p>
          {completion.isUnsynced && (
            <Link href={onboardingHref("/hoondok/library")}>로그인하면 오늘 기록이 남아요 →</Link>
          )}
          {completion.hasSaveFailed && <p>기록을 아직 저장하지 못했어요. 연결되면 다시 시도해요.</p>}
        </div>
      ) : (
        <HoondokButton onClick={completion.markDone} isLoading={completion.isSaving} disabled={isLoading}>
          <Check size={20} />
          읽음
        </HoondokButton>
      )}
      <p className="notice">말씀 읽기 완료를 기록해요. 연속 훈독일은 훈독하기 완료를 기준으로 계산해요.</p>
      <Link className="btn btn-line" href="/hoondok">
        오늘 훈독으로 돌아가기
      </Link>
    </div>
  );
}

export function WordsScreen({ volume, page, chunkId }: { volume: string; page: number; chunkId?: string }) {
  const [segment, setSegment] = useState<"text" | "ai" | "note">("text");
  const query = useQuery({
    queryKey: ["hoondok", "words", volume, page, chunkId],
    queryFn: ({ signal }) => libraryAPI.words(volume, page, chunkId, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  useHoondokScreenTitle(query.isSuccess ? query.data.work_title : null);
  const lastVolume = query.isSuccess ? query.data.volume : null;
  const lastPage = query.isSuccess ? query.data.page : null;
  useEffect(() => {
    if (lastVolume && lastPage) writeLastReading({ volume: lastVolume, page: lastPage });
  }, [lastVolume, lastPage]);
  if (query.isPending)
    return (
      <section className="col col--read">
        <p role="status" aria-busy="true">
          원문을 불러오고 있어요
        </p>
      </section>
    );
  if (query.isError) {
    const isMissing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="col col--read">
        <div className="empty" role="status">
          <span className="empty__ic">
            <BookOpenText size={26} />
          </span>
          <p className="empty__title">{isMissing ? "이 원문을 열 수 없어요" : "원문을 불러오지 못했어요"}</p>
          <p className="empty__body">
            {isMissing
              ? "원문 공개가 허용되지 않았거나 해당 구간을 찾을 수 없어요."
              : "연결을 확인하고 다시 시도해 주세요."}
          </p>
          {!isMissing && (
            <button className="btn btn-line" type="button" onClick={() => void query.refetch()}>
              다시 시도
            </button>
          )}
          <Link className="btn btn-line" href="/hoondok/library">
            서고로 돌아가기
          </Link>
        </div>
      </section>
    );
  }
  const doc = query.data;
  return (
    <section className="col col--read words">
      <aside className="toc" aria-label="원문 구간">
        <p className="toc__title">{doc.work_title}</p>
        {Array.from({ length: doc.total_pages }, (_, index) => index + 1).map((sectionPage) => (
          <Link
            key={sectionPage}
            className="toc__item"
            href={`${wordsHref(volume)}?page=${sectionPage}`}
            aria-current={sectionPage === doc.page ? "page" : undefined}
          >
            원문 구간 {sectionPage}
          </Link>
        ))}
      </aside>
      <div className="words__main">
        <h2 className="lede">{doc.work_title}</h2>
        <div className="src lede-src">
          <span>{doc.volume}</span>
          <span>화자 확인되지 않음</span>
          <span>날짜 확인되지 않음</span>
          <span>판본 확인되지 않음</span>
          {doc.authority_grade === "R" ? (
            <span className="badge badge--dashed">공식성 확인되지 않음</span>
          ) : (
            <AuthorityBadge grade={doc.authority_grade} />
          )}
        </div>
        <div className="lede-rule" />
        <ReaderBar modifier="reader--top" />
        <div className="pill-seg" role="tablist" aria-label="원문 보기">
          {SEGMENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`wd-seg-${item.id}`}
              aria-selected={segment === item.id}
              aria-controls="wd-seg-panel"
              className={segment === item.id ? "is-on" : ""}
              onClick={() => setSegment(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id="wd-seg-panel" className="wd-panel" role="tabpanel" aria-labelledby={`wd-seg-${segment}`}>
          {segment === "text" && (
            <>
              <p className="notice">보유한 원문을 순서대로 보여드려요. 구간 번호는 책의 장·절 번호가 아닙니다.</p>
              {chunkId && <p className="notice">인용한 말씀이 포함된 원문 구간이에요.</p>}
              <article aria-label="원문 본문">
                <p className="scripture words-body">{doc.body}</p>
              </article>
              <nav className="words-pages" aria-label="원문 구간 이동">
                {doc.page > 1 && (
                  <Link className="btn btn-line btn--sm" href={`${wordsHref(volume)}?page=${doc.page - 1}`}>
                    이전 구간
                  </Link>
                )}
                <span>
                  {doc.page} / {doc.total_pages} 구간
                </span>
                {doc.page < doc.total_pages && (
                  <Link className="btn btn-line btn--sm" href={`${wordsHref(volume)}?page=${doc.page + 1}`}>
                    다음 구간
                  </Link>
                )}
              </nav>
              <StudyComplete />
            </>
          )}
          {segment === "ai" && (
            <div className="ai-note">
              <p className="ai-note__lab">AI 설명</p>
              <p className="ai-note__body">
                문단마다 붙는 AI 설명은 준비 중이에요. 근거 말씀과 함께 답하는 설명은 AI 질문에서 쓸 수 있어요.
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
                원문 메모는 아직 저장할 수 없어요. 오늘의 한 줄은 훈독하기에서 쓸 수 있어요.
              </p>
              <Link className="btn btn-line btn--sm" href="/hoondok/read">
                오늘 훈독 읽기
              </Link>
            </div>
          )}
        </div>
        <p className="notice">형광펜·노트·북마크·설정은 준비 중이에요</p>
        <Link className="btn btn-line btn--sm" href="/hoondok/ask">
          이 말씀에 질문하기
        </Link>
      </div>
      <ReaderBar modifier="reader--bottom" />
    </section>
  );
}
