// 챗봇 입력 화면 상태머신 (bots 로드 + messages + SSE 스트리밍 + 피드백) 을
// 한 곳에 묶는 커스텀 훅. page 는 UI state (input/textarea/chunkModal) 과 JSX 만 담당.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatAPI } from "./api";
import type {
  AnswerMode,
  ChatBot,
  FeedbackType,
  Message,
  SourceChunkDetail,
} from "./types";
import { toFriendlyError } from "./error-message";
import { stripCitationsBlock, stripDisclaimer } from "./utils";

/**
 * P0-B — 인용 카드 "원문보기" 모달의 청크 fetch 훅.
 *
 * (chunkId, chatbotId) 캐시 키. 원문은 거의 변하지 않으므로 5분 staleTime.
 * Provider default(30s) 를 의도적으로 override.
 */
export function useSourceChunk(
  chunkId: string | null,
  chatbotId: string,
  enabled: boolean,
) {
  return useQuery<SourceChunkDetail>({
    queryKey: ["source-chunk", chunkId, chatbotId],
    enabled: enabled && !!chunkId && !!chatbotId,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => chatAPI.getSourceChunk(chunkId!, chatbotId, signal),
  });
}

export interface UseChatResult {
  bots: ChatBot[];
  selectedBot: string;
  selectedBotInfo: ChatBot | undefined;
  botsLoading: boolean;
  warmingUp: boolean;
  messages: Message[];
  visibleMessages: Message[];
  sessionId: string | undefined;
  loading: boolean;
  handleBotChange: (value: string | null) => void;
  handleNewChat: () => void;
  handleSend: (query: string, options: { answerMode: AnswerMode }) => Promise<void>;
  handleStop: () => void;
  submitFeedback: (
    idx: number,
    type: FeedbackType,
    comment?: string,
  ) => Promise<void>;
  cancelFeedback: (idx: number) => void;
}

export function useChat(): UseChatResult {
  const [bots, setBots] = useState<ChatBot[]>([]);
  const [selectedBot, setSelectedBot] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [botsLoading, setBotsLoading] = useState(true);
  // 2.5초 이상 로딩이 지속되면 "서버를 깨우고 있어요" 문구로 전환.
  // Cloud Run 콜드 스타트 상황에서 사용자에게 대기 이유를 설명한다.
  const [warmingUp, setWarmingUp] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);
  // setLoading 은 비동기 React state 갱신이라 빠른 더블 트리거 (Enter+button 동시,
  // IME composition 직후 Enter 등) 시 두 호출 모두 가드를 통과해 placeholder 가
  // 두 개 push 되는 회귀 발생. ref 는 동기 가드라 즉시 반영 → 단일 호출 보장.
  const sendingRef = useRef(false);

  // 챗봇 목록 로드 + 콜드 스타트 감지
  useEffect(() => {
    const slowTimer = setTimeout(() => setWarmingUp(true), 2500);
    chatAPI
      .listBots()
      .then((data) => {
        setBots(data);
        if (data.length > 0) {
          // 디폴트는 "전체 검색" (chatbot_id="all"). 비활성/삭제 시 첫 항목 fallback.
          const defaultBot = data.find((b) => b.chatbot_id === "all") ?? data[0];
          setSelectedBot(defaultBot.chatbot_id);
        }
      })
      .catch(() => setBots([]))
      .finally(() => {
        clearTimeout(slowTimer);
        setBotsLoading(false);
        setWarmingUp(false);
      });
    return () => clearTimeout(slowTimer);
  }, []);

  // 렌더 레벨 placeholder dedupe — state 가드 (sendingRef/setMessages 가드)
  // 가 어떤 경로 (React 18 동시성 모드 functional updater 더블 invoke,
  // event double-fire 등) 로 통과해 placeholder 가 누적되더라도 화면엔 마지막
  // 한 개만 노출. 답변이 도착한(content/messageId 있는) assistant 는 모두 유지.
  const visibleMessages = useMemo(() => {
    let lastPlaceholderIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && !m.content?.trim() && !m.messageId) {
        lastPlaceholderIdx = i;
        break;
      }
    }
    return messages.filter((m, i) => {
      const isPlaceholder =
        m.role === "assistant" && !m.content?.trim() && !m.messageId;
      return !isPlaceholder || i === lastPlaceholderIdx;
    });
  }, [messages]);

  const selectedBotInfo = useMemo(
    () => bots.find((b) => b.chatbot_id === selectedBot),
    [bots, selectedBot],
  );

  // override: 추천 카드/follow-up 클릭 시 input 채우지 않고 즉시 query 로 전송.
  // 사용자 클릭 → setInput 은 다음 렌더 후 적용이라 즉시 send 가 stale 가 될 수 있음.
  // 따라서 직접 query 를 받아 처리한다.
  const handleSend = useCallback(
    async (query: string, options: { answerMode: AnswerMode }) => {
      if (sendingRef.current) return;
      const trimmed = query.trim();
      if (!trimmed || !selectedBot) return;
      sendingRef.current = true;

      const { answerMode } = options;

      // user 메시지 + assistant placeholder 를 동시에 push.
      // chunk 이벤트 도착마다 마지막 assistant 의 content 를 누적 append (#12 streaming).
      //
      // 이중 가드:
      //  (a) 같은 query 의 user+placeholder 가 이미 있으면 no-op (event double-fire 방어).
      //  (b) 마지막이 stuck placeholder (assistant + no content + no messageId) 면
      //      제거 후 새 pair push — 이전 응답이 chunk 못 받고 끝나거나 abort 된 상태에서
      //      새 질문이 들어와 placeholder 두 개로 누적되는 회귀 방어.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const secondLast = prev[prev.length - 2];

        // (a) dedupe — 같은 query 의 placeholder 가 이미 있음
        if (
          last?.role === "assistant" &&
          !last.content?.trim() &&
          !last.messageId &&
          secondLast?.role === "user" &&
          secondLast.content === trimmed
        ) {
          return prev;
        }

        // (b) stuck placeholder 제거 — 이전 응답이 빈 placeholder 로 끝나면 그것을 버리고
        //     새 pair 만 남긴다 (다른 query 라도 동일 처리).
        let base = prev;
        if (last?.role === "assistant" && !last.content?.trim() && !last.messageId) {
          base = prev.slice(0, -1);
        }
        return [
          ...base,
          { role: "user", content: trimmed },
          { role: "assistant", content: "", persona: answerMode },
        ];
      });
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // 마지막 assistant 메시지 (placeholder/누적 content) 를 patch 하는 헬퍼.
      // setMessages(prev => …) 패턴으로 stale closure 안전.
      const patchLastAssistant = (patch: (m: Message) => Message) => {
        setMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
            next[lastIdx] = patch(next[lastIdx]);
          }
          return next;
        });
      };

      try {
        // 봇별 streaming_enabled 분기 — false 면 비스트림 단일 응답.
        // ChatBot.streaming_enabled 가 undefined 면 default true (회귀 0).
        const useStreaming = selectedBotInfo?.streaming_enabled !== false;

        if (useStreaming) {
          await chatAPI.streamMessage(
            trimmed,
            selectedBot,
            sessionId,
            controller.signal,
            { answer_mode: answerMode },
            {
              onChunk: (text) => {
                // INLINE_CITATIONS 블록은 매 chunk 누적 후 즉시 strip (사용자에게 잠깐도
                // 노출되지 않도록). disclaimer 는 본문 끝부분만이라 sources 시 한 번만.
                patchLastAssistant((m) => ({
                  ...m,
                  content: stripCitationsBlock((m.content ?? "") + text),
                }));
              },
              onSources: (data) => {
                setSessionId(data.session_id);
                patchLastAssistant((m) => ({
                  ...m,
                  content: stripCitationsBlock(stripDisclaimer(m.content ?? "")),
                  messageId: data.message_id,
                  sources: data.sources,
                  closing: data.closing ?? null,
                  suggestedFollowups: data.suggested_followups ?? null,
                }));
              },
              onDone: () => {
                // disclaimer 는 입력창 하단 footer 에 고정 노출 — 본문에 추가하지 않음.
              },
            },
          );
        } else {
          // 비스트림 모드 — chatAPI.sendMessage 가 single response 반환.
          // 도착 시 placeholder 자리에 한 번에 patch (typing indicator → 본문 직접 전환).
          const res = await chatAPI.sendMessage(
            trimmed,
            selectedBot,
            sessionId,
            controller.signal,
            { answer_mode: answerMode },
          );
          setSessionId(res.session_id);
          patchLastAssistant((m) => ({
            ...m,
            content: stripCitationsBlock(stripDisclaimer(res.answer)),
            messageId: res.message_id,
            sources: res.sources,
            closing: res.closing ?? null,
            suggestedFollowups: res.suggested_followups ?? null,
          }));
        }
      } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        if (aborted) {
          // 부분 보존 정책: 받은 텍스트는 유지하고 끝에 끊김 인디케이터만 추가.
          patchLastAssistant((m) => ({
            ...m,
            content:
              (m.content ?? "") +
              (m.content
                ? "\n\n_(사용자가 응답 생성을 중단했습니다.)_"
                : "(사용자가 응답 생성을 중단했습니다.)"),
          }));
        } else {
          const friendly = toFriendlyError(e);
          // 부분 보존 + 에러 인디케이터. content 가 비어있으면 friendly 메시지로 대체.
          patchLastAssistant((m) => ({
            ...m,
            content: m.content
              ? `${m.content}\n\n_— ${friendly.content}_`
              : friendly.content,
            suggestedFollowups:
              m.suggestedFollowups ?? friendly.suggestedFollowups ?? null,
          }));
        }
      } finally {
        setLoading(false);
        sendingRef.current = false;
        abortRef.current = null;
      }
    },
    [selectedBot, sessionId, selectedBotInfo],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleBotChange = useCallback((value: string | null) => {
    if (!value) return;
    // 진행 중 SSE 스트림이 있으면 abort. race condition fix — 챗봇 변경 후에도
    // 이전 스트림이 계속 patchLastAssistant 호출해 새 봇의 빈 메시지 영역에 이전 응답이
    // 끼어들던 결함 (codex 리뷰 발견).
    abortRef.current?.abort();
    setSelectedBot(value);
    setMessages([]);
    setSessionId(undefined);
  }, []);

  const handleNewChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setSessionId(undefined);
  }, []);

  const submitFeedback = useCallback(
    async (idx: number, type: FeedbackType, comment?: string) => {
      const msg = messages[idx];
      if (!msg?.messageId) {
        toast.error("이 답변에는 피드백을 남길 수 없습니다");
        return;
      }
      // 피드백 토글: 동일 type 을 다시 보내면 로컬 취소 (긍정/부정 reason 모두).
      // 백엔드 AnswerFeedback row 는 라벨링/분석용 보존. 운영자가 최신 상태만 보려면
      // (message_id, created_at desc) 기준으로 후처리 가능.
      // 백엔드 DELETE 엔드포인트 도입은 docs/TODO 로 follow-up.
      if (msg.feedback === type) {
        setMessages((prev) =>
          prev.map((m, i) => (i === idx ? { ...m, feedback: undefined } : m)),
        );
        toast("피드백을 취소했습니다");
        return;
      }
      try {
        await chatAPI.submitFeedback({
          message_id: msg.messageId,
          feedback_type: type,
          comment,
        });
        setMessages((prev) =>
          prev.map((m, i) => (i === idx ? { ...m, feedback: type } : m)),
        );
        toast.success(
          type === "helpful"
            ? "긍정 피드백 감사합니다"
            : "피드백을 기록했습니다",
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "피드백 전송 실패";
        toast.error(errMsg);
      }
    },
    [messages],
  );

  const cancelFeedback = useCallback((idx: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, feedback: undefined } : m)),
    );
  }, []);

  return {
    bots,
    selectedBot,
    selectedBotInfo,
    botsLoading,
    warmingUp,
    messages,
    visibleMessages,
    sessionId,
    loading,
    handleBotChange,
    handleNewChat,
    handleSend,
    handleStop,
    submitFeedback,
    cancelFeedback,
  };
}
