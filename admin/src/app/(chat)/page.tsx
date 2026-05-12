"use client";

import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpen,
  Copy,
  Loader2,
  MessageSquarePlus,
  Square,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import {
  chatAPI,
  type ChatBot,
  type ChatResponse,
  type FeedbackType,
} from "@/features/chatbot/chat-api";
import { toFriendlyError } from "@/features/chat/error-message";
import {
  FollowupPills,
  PersonaSheet,
  PersonaRowTrigger,
  PERSONAS,
  SourceOriginalModal,
  type PersonaMode,
} from "@/components/truewords";
import { QuestionInput } from "@/components/truewords/question-input";
import {
  EmphasisSheet,
  EmphasisRowTrigger,
} from "@/features/chat/components/emphasis-sheet";
import {
  AssistantMessage,
  ClosingCallout,
} from "@/features/chat/components/assistant-message";
import type {
  AnswerMode,
  TheologicalEmphasis,
} from "@/features/chat/types";

interface Message {
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
}

// PERSONAS 배열에서 모드 키로 정의를 찾는다. 미일치 시 첫 항목(표준) fallback.
const personaForMode = (mode: string) =>
  PERSONAS.find((p) => p.key === mode) ?? PERSONAS[0];

const NEGATIVE_REASONS: { key: Exclude<FeedbackType, "helpful">; label: string }[] = [
  { key: "inaccurate", label: "부정확한 답변" },
  { key: "missing_citation", label: "출처 부족/누락" },
  { key: "irrelevant", label: "질문과 무관함" },
  { key: "other", label: "기타 (아래 의견 작성)" },
];

// 백엔드 safety layer가 답변 말미에 붙이는 면책 고지를 제거.
// 동일 문구는 입력창 하단 footer에 고정으로 이미 노출된다.
const DISCLAIMER_PREFIX = "\n\n---\n_이 답변은 AI가 생성한";
const stripDisclaimer = (text: string): string => {
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

// 봇별 동적 추천이 비어있을 때만 사용하는 fallback. backend cron 갱신 전 / 신규 봇 대응.
const FALLBACK_PROMPTS = [
  "하나님을 왜 '하늘부모님'이라고 부르나요?",
  "참부모님의 위상과 가치는 왜 영원한가요?",
  "3일 금식은 반드시 해야 하나요?",
  "천일국 시대의 구원 조건은 무엇인가요?",
];

// P0-D — 면책 4문장 + 모델 버전 footer
// (env 미연동, 하드코딩 OK — ADR-46 spec)
const DISCLAIMER_LINES = [
  "TrueWords AI 답변은 참고용이며, 신앙 지도자의 조언을 대체하지 않습니다.",
  "AI는 종교 텍스트를 학습한 모델이며 교단의 공식 입장과 다를 수 있습니다.",
  "민감한 주제는 반드시 출처 원문과 지도자 안내를 함께 확인해 주세요.",
  "대화 내용은 품질 개선과 안전 점검 목적으로 익명 분석될 수 있습니다.",
];

export default function ChatPage() {
  const [bots, setBots] = useState<ChatBot[]>([]);
  const [selectedBot, setSelectedBot] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [botsLoading, setBotsLoading] = useState(true);
  // 2.5초 이상 로딩이 지속되면 "서버를 깨우고 있어요" 문구로 전환.
  // Cloud Run 콜드 스타트 상황에서 사용자에게 대기 이유를 설명한다.
  const [warmingUp, setWarmingUp] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();

  // P0-B — 인용 카드 → 원문보기 모달 상태
  // displayName 은 admin 인라인 편집으로 지정한 사람 친화적 표시명. 모달의
  // fallbackLabel 로 전달되어 백엔드 chunk detail fetch 전/후 모두 우선 노출.
  const [chunkModal, setChunkModal] = useState<{
    open: boolean;
    chunkId: string | null;
    snippet: string | null;
    displayName: string | null;
  }>({ open: false, chunkId: null, snippet: null, displayName: null });

  // W2-② P0-E / P1-G / P2-D — 입력 화면 옵션 state
  const [answerMode, setAnswerMode] = useState<AnswerMode>("standard");
  const [emphasis, setEmphasis] = useState<TheologicalEmphasis>("all");
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const [emphasisSheetOpen, setEmphasisSheetOpen] = useState(false);

  // P0-G — 답변 화면 floating action bar (새 질문 / 북마크 / 공유) 전체 숨김.
  // 북마크는 백엔드 영속화 미구현이고, 새 질문/공유도 헤더 액션과 중복돼 사용자
  // 결정으로 일괄 hide. 인프라 도입 시 FloatingActionBar 와 followup sheet 동시 재활성.
  // const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => new Set());
  // const [followupOpen, setFollowupOpen] = useState(false);

  // 새 질문 전송 시 사용자 메시지를 viewport 상단으로 scrollIntoView 하여
  // 답변이 그 아래에서 점진 노출되는 Claude/ChatGPT 패턴을 따른다.
  // chunk 누적 동안 자동 하단 스크롤로 문맥이 가려지는 어색함 해소.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // 새 user 메시지가 추가될 때만 그 element 를 viewport 상단으로 스크롤.
  // chunk 누적 동안에는 자동 스크롤 안 함 — 사용자가 답변 첫 줄부터 자연스럽게 읽도록.
  // (Claude/ChatGPT 패턴)
  const userMsgCountRef = useRef(0);
  useEffect(() => {
    const userCount = messages.filter((m) => m.role === "user").length;
    if (userCount > userMsgCountRef.current) {
      // 새로 추가된 user 메시지 element (DOM 의 마지막 [data-msg-role=user]) 를 상단 정렬.
      // RAF 두 번으로 React commit + layout 완료 후 실행.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const userBubbles = document.querySelectorAll('[data-msg-role="user"]');
          const last = userBubbles[userBubbles.length - 1] as HTMLElement | undefined;
          last?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
    userMsgCountRef.current = userCount;
  }, [messages]);

  // textarea 자동 높이 조정 (modern AI chat 패턴) — 후속 질문용 컴팩트 입력바
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 200); // max 200px
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const canSend = useMemo(
    () => !!input.trim() && !!selectedBot && !loading,
    [input, selectedBot, loading],
  );

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
  const handleSend = useCallback(async (override?: string) => {
    if (sendingRef.current) return;
    const raw = override ?? input;
    const query = raw.trim();
    if (!query || !selectedBot) return;
    sendingRef.current = true;

    if (override === undefined) setInput("");
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
        secondLast.content === query
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
        { role: "user", content: query },
        { role: "assistant", content: "", persona: answerMode as PersonaMode },
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
          query,
          selectedBot,
          sessionId,
          controller.signal,
          { answer_mode: answerMode, theological_emphasis: emphasis },
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
          query,
          selectedBot,
          sessionId,
          controller.signal,
          { answer_mode: answerMode, theological_emphasis: emphasis },
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
            (m.content ? "\n\n_(사용자가 응답 생성을 중단했습니다.)_" : "(사용자가 응답 생성을 중단했습니다.)"),
        }));
      } else {
        const friendly = toFriendlyError(e);
        // 부분 보존 + 에러 인디케이터. content 가 비어있으면 friendly 메시지로 대체.
        patchLastAssistant((m) => ({
          ...m,
          content: m.content ? `${m.content}\n\n_— ${friendly.content}_` : friendly.content,
          suggestedFollowups: m.suggestedFollowups ?? friendly.suggestedFollowups ?? null,
        }));
      }
    } finally {
      setLoading(false);
      sendingRef.current = false;
      abortRef.current = null;
      // textarea focus 복원 (응답 후 자연스러운 연속 질문)
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [input, selectedBot, sessionId, loading, answerMode, emphasis, selectedBotInfo]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 전송, Shift+Enter 줄바꿈, IME 조합 중엔 무시
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleBotChange = (value: string | null) => {
    if (!value) return;
    setSelectedBot(value);
    setMessages([]);
    setSessionId(undefined);
  };

  const handleNewChat = () => {
    if (loading) handleStop();
    setMessages([]);
    setSessionId(undefined);
    textareaRef.current?.focus();
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("답변이 복사되었습니다");
    } catch {
      toast.error("복사에 실패했습니다");
    }
  };

  const submitFeedback = async (
    idx: number,
    type: FeedbackType,
    comment?: string,
  ) => {
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
  };

  const selectedBotName = selectedBotInfo?.display_name ?? "";

  // 메시지가 없을 때는 ADR-46 Screen 2 입력 화면(QuestionInput + 맞춤 설정 + footer)을,
  // 메시지가 있으면 기존 채팅 흐름을 유지한다.
  const isEmptyState = messages.length === 0 && !loading;

  // FloatingActionBar 전체 hide. latestAssistant 추출 + 핸들러는 인프라 추가 시 재활성.
  // - handleFloatingNewQuestion: setFollowupOpen(true) + textarea focus
  // - handleFloatingBookmark: setBookmarkedIds (영속화 미구현)
  // - handleFloatingShare: navigator.share / clipboard fallback

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        {/* 로고 클릭 시 홈(입력 화면)으로 복귀 — handleNewChat 재사용 */}
        <button
          type="button"
          onClick={handleNewChat}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="홈으로"
        >
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">TrueWords</h1>
        </button>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleNewChat}
              className="gap-1.5"
              aria-label="새 대화"
            >
              <MessageSquarePlus className="h-4 w-4" />
              <span className="hidden sm:inline text-xs">새 대화</span>
            </Button>
          )}
          {botsLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <Select
              value={selectedBot}
              onValueChange={(val) => handleBotChange(val)}
            >
              <SelectTrigger className="w-48">
                {/* base-ui-react Select는 라벨 변환을 children 함수로 받는다.
                    미지정 시 trigger에 raw value(chatbot_id)가 그대로 노출됨. */}
                <SelectValue placeholder="챗봇 선택">
                  {(value: string | null) =>
                    value
                      ? (bots.find((b) => b.chatbot_id === value)
                          ?.display_name ?? value)
                      : null
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {bots.map((bot) => (
                  <SelectItem
                    key={bot.chatbot_id}
                    value={bot.chatbot_id}
                    // 봇 select 의 hover/선택 highlight 도 채팅 메인 CTA 와 동일한 navy 톤으로
                    // 통일. base ui/select 가 focus 시 brass(accent) 를 깔던 것을 override.
                    className="focus:bg-primary/10 focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground"
                  >
                    {bot.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      {isEmptyState ? (
        // ── ADR-46 Screen 2 — 입력 화면 ─────────────────────────────
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {/* 인사말 — empty state 아이콘은 현재 답변 모드에 따라 동적으로 변경된다. */}
            <div className="flex flex-col items-center gap-3 pt-6 pb-2 text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-persona-icon-bg">
                {botsLoading ? (
                  <Loader2 className="h-7 w-7 animate-spin text-accent" />
                ) : (() => {
                  const ModeIcon = personaForMode(answerMode).Icon;
                  return <ModeIcon size={28} />;
                })()}
              </div>
              {botsLoading ? (
                <div
                  className="space-y-1 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-sm font-medium text-foreground/80">
                    {warmingUp
                      ? "서버를 깨우고 있어요"
                      : "챗봇을 불러오는 중..."}
                  </p>
                  {warmingUp && (
                    <p className="text-xs">
                      첫 접속 시 최대 10초 정도 걸릴 수 있어요
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-center text-sm">
                  {selectedBotName
                    ? `${selectedBotName}에게 질문해 보세요`
                    : "챗봇을 선택하고 질문해 보세요"}
                </p>
              )}
            </div>

            {/* P0-C QuestionInput — 두 줄 placeholder */}
            <QuestionInput
              value={input}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setInput(e.target.value)
              }
              placeholderLine1="고민이나 질문을 입력해 주세요"
              placeholderLine2="내용이 구체적일수록 답변이 정확해요"
              disabled={!selectedBot || botsLoading}
              aria-label="질문 입력"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            {/* 추천 질문 (chip) — 봇별 동적 (backend cron 매일 갱신), 비어있으면 FALLBACK */}
            {!botsLoading && selectedBot && (() => {
              const dynamic = selectedBotInfo?.suggested_questions ?? [];
              const prompts = dynamic.length > 0 ? dynamic : FALLBACK_PROMPTS;
              return (
                <div className="flex w-full flex-wrap justify-center gap-2">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      className="rounded-full border bg-card px-4 py-2 text-xs text-foreground/80 transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* 맞춤 설정 영역: persona / emphasis / visibility */}
            <section
              className="flex flex-col gap-2"
              aria-label="맞춤 설정"
            >
              <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                맞춤 설정
              </h2>

              <PersonaRowTrigger
                value={answerMode as PersonaMode}
                onClick={() => setPersonaSheetOpen(true)}
              />

              <EmphasisRowTrigger
                value={emphasis}
                onClick={() => setEmphasisSheetOpen(true)}
              />

            </section>

            {/* 보내기 CTA */}
            <Button
              type="button"
              size="lg"
              onClick={() => handleSend()}
              disabled={!canSend}
              className="h-12 rounded-xl text-base font-semibold"
            >
              <ArrowUp className="mr-1.5 h-4 w-4" />
              질문 보내기
            </Button>
          </div>
        </div>
      ) : (
        // ── 채팅 진행 중: 메시지 + 후속 질문 입력바 ───────────────────
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {/* pb-[60vh] — 답변이 짧아도 새 user 메시지를 viewport 상단으로
                정확히 scrollIntoView 할 수 있도록 하단 여유 공간 확보. (ChatGPT/Claude 패턴) */}
            <div
              className="mx-auto max-w-2xl space-y-4 pb-[60vh]"
            >
              {visibleMessages.map((msg) => {
                const msgIdx = messages.indexOf(msg);
                return (
                <div
                  key={msgIdx}
                  data-msg-role={msg.role}
                  className={`group flex gap-3 ${msg.role === "user" ? "justify-end scroll-mt-4" : ""}`}
                >
                  {msg.role === "assistant" && (() => {
                    // 답변 시점의 모드를 우선 — 사용자가 모드를 바꿔도 과거 답변 아바타는 고정.
                    const ModeIcon = personaForMode(msg.persona ?? answerMode).Icon;
                    return (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-persona-icon-bg">
                        <ModeIcon size={16} />
                      </div>
                    );
                  })()}
                  <div
                    className={`max-w-[85%] space-y-2 ${
                      msg.role === "user" ? "order-first" : ""
                    }`}
                  >
                    {msg.role === "user" ? (
                      <Card className="bg-primary px-4 py-3 text-primary-foreground">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {msg.content}
                        </p>
                      </Card>
                    ) : (
                      <Card className="bg-card px-4 py-3 shadow-sm">
                        {msg.content?.trim() ? (
                          <AssistantMessage
                            content={stripDisclaimer(msg.content)}
                            sources={msg.sources}
                            onSourceClick={(src) =>
                              setChunkModal({
                                open: true,
                                chunkId: src.chunk_id ?? null,
                                // cited_phrase 우선 — 모달이 chunk 안에서 그 phrase 만 highlight.
                                // 누락 시 src.text 전체 fallback (이전 동작 그대로).
                                snippet: src.cited_phrase?.trim() || src.text,
                                displayName: src.display_name ?? null,
                              })
                            }
                          />
                        ) : (
                          // chunk 도착 전 placeholder 상태 — typing indicator 만 노출.
                          // 본문 비어있을 때 ClosingCallout 까지 보이면 빈 답변처럼 보여 어색.
                          <div className="flex items-center gap-1.5 py-2 text-muted-foreground" aria-label="응답 생성 중">
                            <span className="size-1.5 rounded-full bg-current animate-pulse" />
                            <span className="size-1.5 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
                            <span className="size-1.5 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
                          </div>
                        )}
                        {/* B1 — 본문/권유 시각 분리. messageId 도착(=응답 완료) 후에만 노출.
                            chunk 진행 중엔 본문만 누적되어 자연스럽게. */}
                        {msg.messageId && (
                          <ClosingCallout
                            closing={msg.closing}
                            className="mt-3"
                          />
                        )}
                      </Card>
                    )}

                    {/* P0-A — 답변 후속 추천 질문 3개. SuggestedFollowupsStage 가 채움. */}
                    {msg.role === "assistant" &&
                      msg.suggestedFollowups &&
                      msg.suggestedFollowups.length > 0 && (
                        <FollowupPills
                          suggestions={msg.suggestedFollowups}
                          onSelect={(q) => handleSend(q)}
                          heading="다음 질문을 추천해 드립니다"
                          className="mt-6 pl-1"
                        />
                      )}

                    {/* 어시스턴트 메시지 하단 액션 툴바: 복사 | 👍 / 👎 */}
                    {msg.role === "assistant" && msg.messageId && (
                      <div
                        className={`flex items-center gap-2 pl-1 transition ${
                          msg.feedback
                            ? "opacity-100"
                            : "opacity-60 group-hover:opacity-100"
                        }`}
                      >
                        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-card/70 px-1 py-0.5 shadow-sm">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label="답변 복사"
                            onClick={() => handleCopy(stripDisclaimer(msg.content))}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>

                          <div
                            className="mx-0.5 h-4 w-px bg-border"
                            aria-hidden="true"
                          />

                          {/* 긍정 — 항상 노출. 같은 helpful 다시 누르면 토글 취소 (#9). */}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={
                              msg.feedback === "helpful"
                                ? "피드백 취소"
                                : "도움이 됐어요"
                            }
                            aria-pressed={msg.feedback === "helpful"}
                            onClick={() => submitFeedback(msgIdx, "helpful")}
                            className={`h-7 w-7 ${
                              msg.feedback === "helpful"
                                ? "bg-success-soft text-success hover:bg-success-soft"
                                : ""
                            }`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </Button>

                          {/* 부정 — 항상 노출. popover 가 reason+comment 입력 단계를 거치므로
                              실수 클릭은 popover 단계에서 차단됨. 제출 후에도 popover 재오픈으로 변경 가능. */}
                          <NegativeFeedbackPopover
                            disabled={false}
                            active={!!msg.feedback && msg.feedback !== "helpful"}
                            currentReason={
                              msg.feedback && msg.feedback !== "helpful"
                                ? msg.feedback
                                : null
                            }
                            onSubmit={(reason, comment) =>
                              submitFeedback(msgIdx, reason, comment)
                            }
                            onCancel={() =>
                              setMessages((prev) =>
                                prev.map((m, j) =>
                                  j === msgIdx ? { ...m, feedback: undefined } : m,
                                ),
                              )
                            }
                          />
                        </div>

                        {msg.feedback && (
                          <span className="text-[11px] text-muted-foreground">
                            {msg.feedback === "helpful"
                              ? "피드백 감사합니다"
                              : "의견이 기록됐습니다"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                      <User className="h-4 w-4 text-secondary-foreground" />
                    </div>
                  )}
                </div>
                );
              })}

            </div>
          </div>

          {/* 입력 영역 — 후속 질문용 컴팩트 입력바 (ChatGPT / Claude 스타일) */}
          <div className="border-t bg-background px-4 pb-4 pt-3">
            <div className="mx-auto max-w-2xl">
              <div
                className={`relative flex items-end rounded-2xl border bg-card shadow-sm transition focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 ${
                  !selectedBot ? "opacity-60" : ""
                }`}
              >
                <Textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setInput(e.target.value)
                  }
                  onKeyDown={handleKeyDown}
                  placeholder={
                    botsLoading
                      ? warmingUp
                        ? "서버를 깨우고 있어요... 잠시만 기다려주세요"
                        : "챗봇을 불러오는 중..."
                      : selectedBot
                        ? "메시지를 입력하세요 (Shift+Enter로 줄바꿈)"
                        : "상단에서 먼저 챗봇을 선택해 주세요"
                  }
                  disabled={!selectedBot}
                  autoFocus
                  className="min-h-[48px] max-h-[200px] resize-none border-0 bg-transparent px-4 py-3 pr-14 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {loading ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    onClick={handleStop}
                    aria-label="응답 생성 중단"
                    className="absolute bottom-2 right-2 h-9 w-9 rounded-xl"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    onClick={() => handleSend()}
                    disabled={!canSend}
                    aria-label="메시지 전송"
                    className="absolute bottom-2 right-2 h-9 w-9 rounded-xl"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* P0-D — 면책 4문장 footer (전 화면 공통) */}
      <footer className="border-t bg-background px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <ul className="space-y-0.5 text-center text-[11px] leading-relaxed text-muted-foreground">
            {DISCLAIMER_LINES.map((line) => (
              <li key={line} className="break-keep-all">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </footer>

      {/* P0-E PersonaSheet — 답변 모드 5종 */}
      <PersonaSheet
        open={personaSheetOpen}
        onOpenChange={setPersonaSheetOpen}
        value={answerMode as PersonaMode}
        onValueChange={(v) => setAnswerMode(v as AnswerMode)}
      />

      {/* P1-G EmphasisSheet — 강조점 5종 */}
      <EmphasisSheet
        open={emphasisSheetOpen}
        onOpenChange={setEmphasisSheetOpen}
        value={emphasis}
        onValueChange={setEmphasis}
      />

      {/* P0-B — 인용 카드 원문보기 모달. display_name 있으면 fallbackLabel 우선 노출. */}
      <SourceOriginalModal
        open={chunkModal.open}
        onOpenChange={(open) =>
          setChunkModal((prev) => ({ ...prev, open }))
        }
        chunkId={chunkModal.chunkId}
        chatbotId={selectedBot}
        highlightSnippet={chunkModal.snippet ?? undefined}
        fallbackLabel={chunkModal.displayName ?? undefined}
      />

      {/* 추천 follow-up sheet 는 FloatingActionBar 와 함께 숨김. 재활성 시 같이 복구. */}
    </div>
  );
}

/** 부정 피드백 팝오버 — 사유 선택 + (선택) 의견 입력 + (active 시) 취소 */
function NegativeFeedbackPopover({
  disabled,
  active,
  currentReason,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  active: boolean;
  /** 이미 기록된 부정 피드백 reason — 라디오 default 동기화용. 없으면 inaccurate. */
  currentReason?: Exclude<FeedbackType, "helpful"> | null;
  onSubmit: (type: FeedbackType, comment?: string) => Promise<void> | void;
  /** active 일 때만 노출되는 "피드백 취소" 액션. 로컬 state 만 비운다. */
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Exclude<FeedbackType, "helpful">>(
    currentReason ?? "inaccurate",
  );
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 팝오버를 다시 열 때 currentReason 동기화 — 어떤 사유가 활성인지 사용자가 즉시 인지.
  useEffect(() => {
    if (open) setReason(currentReason ?? "inaccurate");
  }, [open, currentReason]);

  const handleSend = async () => {
    setSubmitting(true);
    try {
      await onSubmit(reason, comment.trim() || undefined);
      setOpen(false);
      setComment("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    setOpen(false);
    setComment("");
  };

  return (
    <Popover open={open} onOpenChange={(v: boolean) => !disabled && setOpen(v)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="개선이 필요해요"
            aria-pressed={active}
            disabled={disabled}
            className={`h-7 w-7 ${
              active
                ? "bg-danger-soft text-destructive hover:bg-danger-soft disabled:opacity-100"
                : ""
            }`}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">어떤 점이 아쉬웠나요?</p>
            <p className="text-xs text-muted-foreground">
              선택한 사유는 품질 개선에 쓰입니다.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {NEGATIVE_REASONS.map((r) => (
              <label
                key={r.key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <input
                  type="radio"
                  name="neg-reason"
                  checked={reason === r.key}
                  onChange={() => setReason(r.key)}
                  className="h-4 w-4"
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
          <Textarea
            value={comment}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
            placeholder="추가 의견이 있다면 자유롭게 적어주세요 (선택)"
            className="h-20 resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            {active && onCancel && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                disabled={submitting}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                피드백 취소
              </Button>
            )}
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              닫기
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSend}
              disabled={submitting}
            >
              보내기
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
