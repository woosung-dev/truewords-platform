"use client";

// 공개 질문 열람 — 협회가 확인해 공개한 Q&A 를 읽기만 한다(댓글·반응 없음, DEC-PWA-025).
// 근거는 서버가 답의 인용 기록에서 복사한 것이라 원문 위치(chunk_id)가 없어 원문 링크를 달지 않는다.
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { askFullDate, sourceLabel } from "../format";
import { answerModeInfo } from "../modes";
import { publicQuestionsAPI } from "../public-api";

const AnswerMarkdown = dynamic(() => import("./answer-markdown").then((module) => module.AnswerMarkdown));

export function AskPublic({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ["hoondok", "public-question", id],
    queryFn: ({ signal }) => publicQuestionsAPI.detail(id, signal),
    retry: false,
  });

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
          <Link className="btn btn-line ql-empty__cta" href="/hoondok/ask">
            질문 목록으로
          </Link>
        </div>
      </section>
    );
  }

  const question = detail.data;
  const mode = answerModeInfo(question.answer_mode);
  const ModeIcon = mode.icon;
  return (
    <section className="col col--read ask-detail">
      <h2 className="ask-q">{question.question}</h2>
      <div className="ask-q__meta">
        <span className="ask-q__date">{askFullDate(question.published_at)}</span>
        <span className="badge badge--line">협회 확인</span>
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

      {question.sources.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h3 className="sect__title">{`근거 말씀 ${question.sources.length}`}</h3>
          </div>
          {question.sources.map((source, order) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 근거는 서버가 정한 순서로 고정된 읽기 전용 목록이고 같은 권이 겹칠 수 있다
            <article className="card ask-ev" key={`${order}-${source.volume}`}>
              <div className="src">
                <b className="ask-ev__no">{order + 1}</b>
                <span className="src__dot" />
                <span>{sourceLabel({ volume: source.volume, display_name: null })}</span>
              </div>
              <p className="scripture">{source.text}</p>
            </article>
          ))}
        </div>
      )}

      <div className="sect">
        <Link className="btn btn-primary" href="/hoondok/ask/new">
          나도 물어보기
        </Link>
      </div>
      <p className="notice">이름 없이 공개된 질문이에요. AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다</p>
    </section>
  );
}
