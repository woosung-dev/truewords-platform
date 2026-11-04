"use client";

// 원문 뷰 "AI 설명" 탭 (PLAN-HD-007 §2-7). AI 질문과 같은 `/hoondok/ask/stream` 을 써서 로그인·하루 횟수 상한을
// 함께 받는다(익명 `/chat/stream` 은 비용 상한 밖이라 닫았다). 사용자가 단락을 고른 뒤 버튼을 누를 때만 1회 요청하고,
// 답은 AI 질문처럼 내 계정 기록에 남는다.
import { useMutation } from "@tanstack/react-query";
import type { WordChunk } from "@truewords/api-client-ts/types";
import { Sparkles } from "lucide-react";
import { type AskResult, askErrorMessage, requestHoondokAsk } from "@/features/hoondok/ask/ask-stream";
import { AnswerMarkdown } from "@/features/hoondok/ask/components/answer-markdown";
import { verseNumber } from "../api";

/** 질문 앞머리 — 공식 해설이 아님을 전제로 두고 근거 말씀을 함께 요구한다. */
export const EXPLAIN_PREFIX =
  "다음 말씀을 초신자에게 쉽게 설명해 주세요. 공식 해설이 아님을 전제로, 근거 말씀을 함께 보여 주세요.\n\n";

export function explainQuery(text: string): string {
  return EXPLAIN_PREFIX + text;
}

const GATE_MESSAGE = "근거 말씀을 찾지 못했어요. 다른 단락을 골라 보거나 AI 질문에서 물어봐 주세요";

export function AiExplain({ chunk }: { chunk: WordChunk | null }) {
  const ask = useMutation<AskResult, unknown, string>({ mutationFn: (query) => requestHoondokAsk(query) });

  if (!chunk) {
    return (
      <div className="ai-note">
        <p className="ai-note__lab">
          <Sparkles size={14} aria-hidden="true" />
          AI 설명 · 공식 해설 아님
        </p>
        <p className="ai-note__body">본문에서 단락 번호를 눌러 단락을 하나 골라 주세요. 고른 단락만 설명해요.</p>
      </div>
    );
  }
  const result = ask.data;
  return (
    <div className="ai-note">
      <p className="ai-note__lab">
        <Sparkles size={14} aria-hidden="true" />
        AI 설명 · 공식 해설 아님
      </p>
      <p className="rd-ai__quote">
        <span className="verse__n">{verseNumber(chunk.chunk_index)}</span>
        {/* 보이는 인용은 정리된 표시 텍스트, AI 에 보내는 질문은 원본 text 다(PLAN-HD-008) */}
        {chunk.display_text}
      </p>
      <button
        className="btn btn-line btn--sm"
        type="button"
        onClick={() => ask.mutate(explainQuery(chunk.text))}
        disabled={ask.isPending}
      >
        이 단락 설명 요청
      </button>
      {ask.isPending && (
        <p className="ai-note__body" role="status" aria-busy="true">
          근거 말씀을 찾고 있어요. 잠시만 기다려 주세요.
        </p>
      )}
      {ask.isError && <p className="ai-note__body">{askErrorMessage(ask.error)}</p>}
      {result &&
        (result.sources.length === 0 ? (
          <p className="ai-note__body">{GATE_MESSAGE}</p>
        ) : (
          <>
            <AnswerMarkdown answer={result.answer} />
            {result.disclaimer && <p className="ai-note__micro">{result.disclaimer}</p>}
          </>
        ))}
      <p className="notice">
        로그인이 필요하고 하루 질문 횟수를 1회 써요. 설명은 내 질문 기록에 남아요. 공식 해설이 아니고 근거 말씀이 있을
        때만 보여 드려요.
      </p>
    </div>
  );
}
