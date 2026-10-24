"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PersonaMode } from "@/components/truewords/persona-sheet";
import {
  type ChatBot,
  type ChatRequestOptions,
  type ChatResponse,
  chatAPI,
  type FeaturedMalssum,
  type FeedbackType,
} from "@/features/chatbot/chat-api";
import { toFriendlyError } from "./error-message";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  sources?: ChatResponse["sources"];
  feedback?: FeedbackType;
  // P0-A — 답변 후속 추천 질문 3개. None/빈 배열이면 미노출.
  suggestedFollowups?: string[] | null;
  // P1-J — 기도문/결의문 마무리. 비활성/실패 시 null. ClosingCallout 가 정적 보조멘트로 fallback.
  closing?: string | null;
  // 답변 시점의 답변 모드 — 메시지 옆 아바타 아이콘이 모드 변경에 따라 과거 답변까지 바뀌지 않도록 보존.
  persona?: PersonaMode;
  // 레드팀 시연 — 답변에 곁들이는 무작위 말씀 (답변별 보존). 없으면 카드 미표시.
  featuredMalssum?: FeaturedMalssum | null;
}

// 백엔드 safety layer가 답변 말미에 붙이는 면책 고지를 제거.
// 동일 문구는 입력창 하단 footer에 고정으로 이미 노출된다.
const DISCLAIMER_PREFIX = "\n\n---\n_이 답변은 AI가 생성한";
export const stripDisclaimer = (text: string): string => {
  const idx = text.indexOf(DISCLAIMER_PREFIX);
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
};

// LLM 이 답변 끝에 emit 하는 INLINE_CITATIONS 블록 제거.
// SSE 스트림에서 chunk 단위로 누적되는 동안 사용자에게 잠깐도 보이지 않도록
// onChunk 시점에서 매번 strip. 동기 응답 + sources 도착 시점에도 한 번 더 적용.
// (backend service 가 ChatResponse.answer 에 cleaned 본문을 보내지만, stream chunk
// 는 raw 라 frontend 에서도 strip 필요)
const stripCitationsBlock = (text: string): string => {
  const idx = text.indexOf("INLINE_CITATIONS:");
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
};

/** 전송·복원·취소를 요청별로 묶어 늦은 응답이 새 대화를 바꾸지 못하게 한다. */
export function useChatConversation(bot: ChatBot | undefined, options: ChatRequestOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const session = useRef<string | undefined>(undefined);
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const resume = useRef<{ id: string; promise: ReturnType<typeof chatAPI.getSessionHistory> } | null>(null);

  useEffect(() => {
    mounted.current = true;
    if (!resume.current) {
      const id = new URLSearchParams(window.location.search).get("session");
      if (id) {
        window.history.replaceState(null, "", "/");
        resume.current = { id, promise: chatAPI.getSessionHistory(id) };
      }
    }
    let active = true;
    const version = request.current;
    const pending = resume.current;
    if (pending)
      void pending.promise
        .then((data) => {
          if (!active || request.current !== version) return;
          session.current = pending.id;
          setMessages(
            data.messages.map((message, index) => ({
              id: `${pending.id}-${index}`,
              role: message.role.toLowerCase() === "user" ? "user" : "assistant",
              content: message.content,
            })),
          );
        })
        .catch(() => {
          if (active && request.current === version)
            toast.error("이전 대화를 불러오지 못했어요. 목록에서 다시 시도해 주세요.");
        });
    return () => {
      active = false;
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    request.current += 1;
    abort.current?.abort();
    abort.current = null;
    session.current = undefined;
    setMessages([]);
    setLoading(false);
  }, []);
  const stop = useCallback(() => abort.current?.abort(), []);
  const { answer_mode, participant_name, participant_category } = options;
  const send = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!query || !bot || abort.current) return;
      const version = ++request.current;
      const controller = new AbortController();
      abort.current = controller;
      const id = `${version}-assistant`;
      const current = () => mounted.current && request.current === version;
      const patch = (update: (message: Message) => Message) => {
        if (current())
          setMessages((previous) => previous.map((message) => (message.id === id ? update(message) : message)));
      };
      setMessages((previous) => [
        ...previous,
        { id: `${version}-user`, role: "user", content: query },
        { id, role: "assistant", content: "", persona: answer_mode ?? "standard" },
      ]);
      setLoading(true);
      const requestOptions = { answer_mode, participant_name, participant_category };
      const onSources = (
        data: Pick<
          ChatResponse,
          "session_id" | "message_id" | "sources" | "closing" | "suggested_followups" | "featured_malssum"
        >,
      ) => {
        if (!current()) return;
        session.current = data.session_id;
        patch((message) => ({
          ...message,
          content: stripCitationsBlock(stripDisclaimer(message.content)),
          messageId: data.message_id,
          sources: data.sources,
          closing: data.closing ?? null,
          suggestedFollowups: data.suggested_followups ?? null,
          featuredMalssum: data.featured_malssum ?? null,
        }));
      };
      try {
        if (bot.streaming_enabled !== false) {
          let pendingSources: Parameters<typeof onSources>[0] | undefined;
          await chatAPI.streamMessage(query, bot.chatbot_id, session.current, controller.signal, requestOptions, {
            onChunk: (text) =>
              patch((message) => ({ ...message, content: stripCitationsBlock(message.content + text) })),
            onSources: (data) => {
              pendingSources = data;
            },
            onDone: () => {},
          });
          if (pendingSources) onSources(pendingSources);
        } else {
          const result = await chatAPI.sendMessage(
            query,
            bot.chatbot_id,
            session.current,
            controller.signal,
            requestOptions,
          );
          patch((message) => ({ ...message, content: stripCitationsBlock(stripDisclaimer(result.answer)) }));
          onSources(result);
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          patch((message) => ({
            ...message,
            content:
              message.content +
              (message.content ? "\n\n_(사용자가 응답 생성을 중단했습니다.)_" : "(사용자가 응답 생성을 중단했습니다.)"),
          }));
        } else {
          const friendly = toFriendlyError(error);
          patch((message) => ({
            ...message,
            content: message.content ? `${message.content}\n\n_— ${friendly.content}_` : friendly.content,
            suggestedFollowups: message.suggestedFollowups ?? friendly.suggestedFollowups ?? null,
          }));
        }
      } finally {
        if (current()) {
          abort.current = null;
          setLoading(false);
        }
      }
    },
    [bot, answer_mode, participant_name, participant_category],
  );

  const feedback = useCallback(async (message: Message, type?: FeedbackType, comment?: string) => {
    if (!message.messageId) throw new Error("이 답변에는 피드백을 남길 수 없습니다");
    const next = type === message.feedback ? undefined : type;
    if (next === undefined) await chatAPI.deleteFeedback(message.messageId);
    else await chatAPI.submitFeedback({ message_id: message.messageId, feedback_type: next, comment });
    if (mounted.current)
      setMessages((previous) => previous.map((item) => (item.id === message.id ? { ...item, feedback: next } : item)));
    return next;
  }, []);
  return { messages, loading, send, stop, reset, feedback };
}
