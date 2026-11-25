"use client";

// 공개 질문 열람 — 협회가 확인해 공개한 Q&A 를 읽기만 한다(댓글·반응 없음, DEC-PWA-025).
// 근거는 서버가 답의 인용 기록에서 복사한 것이라 원문 위치(chunk_id)가 없어 원문 링크를 달지 않는다.
// 열면 조회 1회를 기록한다(탭마다 질문당 한 번, 실패는 조용히). 조회수는 화면에 보이지 않는다 — 관리자 추천 순서에만 쓴다.
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { ReaderToast, useReaderToast } from "@/features/hoondok/library/components/reader-toast";
import { publicQuestionKey } from "../../query-keys";
import { useBookmarkToggle } from "../bookmarks";
import { askFullDate, sourceLabel } from "../format";
import { answerModeInfo } from "../modes";
import { publicQuestionsAPI } from "../public-api";
import { BookmarkButton } from "./bookmark-button";
import { EvidenceRail, EvidenceSheet, type RailItem, useEvidenceSheet } from "./evidence-rail";

const AnswerMarkdown = dynamic(() => import("./answer-markdown").then((module) => module.AnswerMarkdown));

// 이 탭에서 이미 센 공개 질문 id(sessionStorage). 저장소가 막힌 환경(사생활 모드)에서는 메모리로만 막는다. 질문 문장은 담지 않는다.
const VIEWED_PREFIX = "hoondok:ask-viewed:";
const viewedFallback = new Set<string>();

/** 처음이면 표시하고 true. StrictMode 의 effect 이중 실행에서도 한 번만 true 다. */
export function markViewedOnce(id: string): boolean {
  try {
    const key = `${VIEWED_PREFIX}${id}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    if (viewedFallback.has(id)) return false;
    viewedFallback.add(id);
    return true;
  }
}

/** "나도 물어보기" — 새 질문 화면을 이 질문으로 채우되 보내지는 않는다. from 은 서버가 실제로 답을 보관할 때만 센다. */
export function askAlsoHref(id: string, question: string): string {
  return `/ask/new?q=${encodeURIComponent(question)}&from=${encodeURIComponent(id)}`;
}

export function AskPublic({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: publicQuestionKey(id),
    queryFn: ({ signal }) => publicQuestionsAPI.detail(id, signal),
    retry: false,
  });
  const toast = useReaderToast();
  const bookmarks = useBookmarkToggle({ showToast: toast.show, returnTo: `/ask/p/${encodeURIComponent(id)}` });
  const isLoaded = detail.isSuccess;
  const sheet = useEvidenceSheet();

  // 있는 질문을 연 경우만 센다(404 는 세지 않는다). 실패해도 화면은 그대로다.
  useEffect(() => {
    if (!isLoaded || !markViewedOnce(id)) return;
    publicQuestionsAPI.recordView(id).catch(() => {
      // 조회 기록 실패는 사용자에게 알리지 않는다
    });
  }, [id, isLoaded]);

  if (detail.isPending) {
    return (
      <section className="col col--read">
        <p className="ask-state" role="status" aria-busy="true">
          질문을 불러오고 있어요
        </p>
      </section>
    );
  }
  if (detail.isError) {
    const isGone = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <section className="col col--read">
        <div className="empty">
          <span className="empty__ic">
            <MessageCircleQuestion size={26} aria-hidden="true" />
          </span>
          <h2 className="empty__title">{isGone ? "공개된 질문을 찾을 수 없어요" : "질문을 불러오지 못했어요"}</h2>
          <p className="empty__body">
            {isGone ? "작성자가 내렸거나 공개가 끝난 질문이에요." : "잠시 뒤 다시 열어 주세요."}
          </p>
          <Link className="btn btn-line ql-empty__cta" href="/ask">
            질문 목록으로
          </Link>
        </div>
      </section>
    );
  }

  const question = detail.data;
  const mode = answerModeInfo(question.answer_mode);
  const ModeIcon = mode.icon;
  const isBookmarked = question.bookmarked ?? false;
  // 공개 근거는 원문 위치가 없어 원문 링크를 달지 않는다(파일 머리말). 같은 권이 겹칠 수 있어 순번을 키에 넣는다.
  const items: RailItem[] = question.sources.map((source, order) => ({
    key: `${order}-${source.volume}`,
    label: sourceLabel({ volume: source.volume, display_name: null }),
    text: source.text,
  }));
  return (
    <section className="col col--read ask-detail">
      <h2 className="ask-q">{question.question}</h2>
      <div className="ask-head">
        <div className="ask-q__meta">
          <span className="ask-q__date">{askFullDate(question.published_at)}</span>
          <span className="badge badge--line">협회 확인</span>
        </div>
        <div className="ask-tools">
          <BookmarkButton
            size={22}
            isOn={isBookmarked}
            onToggle={() => void bookmarks.toggle({ kind: "pub", id: question.id }, !isBookmarked)}
          />
        </div>
      </div>

      <div className="card ask-model">
        <p className="ask-model__k">이 모델이 답변했어요</p>
        <div className="ask-model__row">
          <span className="ask-model__ic" aria-hidden="true">
            <ModeIcon size={20} />
          </span>
          <span className="ask-model__bd">
            <b>{mode.label}</b>
            <span>{mode.description}</span>
          </span>
        </div>
      </div>

      <div className="sect">
        <div className="ai-note">
          <div className="ai-note__lab">
            <Sparkles size={14} aria-hidden="true" />
            AI 설명 · 공식 해설 아님
          </div>
          <AnswerMarkdown answer={question.answer_md} />
        </div>
      </div>

      {items.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h3 className="sect__title">{`근거 말씀 ${items.length}`}</h3>
            <span className="sect__meta">누르면 전문을 볼 수 있어요</span>
          </div>
          <EvidenceRail items={items} onOpen={sheet.show} />
          {sheet.open !== null && (
            <EvidenceSheet items={items} index={sheet.open} onMove={sheet.show} onClose={sheet.close} />
          )}
        </div>
      )}

      <div className="sect">
        <Link className="btn btn-primary" href={askAlsoHref(question.id, question.question)}>
          나도 물어보기
        </Link>
        <p className="hint ask-hint-line">이 질문이 입력창에 채워져요. 보내기 전에 고칠 수 있어요.</p>
      </div>
      <p className="notice">이름 없이 공개된 질문이에요. AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다</p>
      {toast.toast && <ReaderToast toast={toast.toast} onDismiss={toast.dismiss} />}
    </section>
  );
}
