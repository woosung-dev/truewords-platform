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
import { Badge } from "@/components/ui/badge";
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
  Bot,
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

interface Message {
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  sources?: ChatResponse["sources"];
  feedback?: FeedbackType;
}

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

const SUGGESTED_PROMPTS = [
  "하나님을 왜 '하늘부모님'이라고 부르나요?",
  "참부모님의 위상과 가치는 왜 영원한가요?",
  "3일 금식은 반드시 해야 하나요?",
  "천일국 시대의 구원 조건은 무엇인가요?",
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 챗봇 목록 로드 + 콜드 스타트 감지
  useEffect(() => {
    const slowTimer = setTimeout(() => setWarmingUp(true), 2500);
    chatAPI
      .listBots()
      .then((data) => {
        setBots(data);
        if (data.length > 0) setSelectedBot(data[0].chatbot_id);
      })
      .catch(() => setBots([]))
      .finally(() => {
        clearTimeout(slowTimer);
        setBotsLoading(false);
        setWarmingUp(false);
      });
    return () => clearTimeout(slowTimer);
  }, []);

  // 메시지 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // textarea 자동 높이 조정 (modern AI chat 패턴)
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

  const handleSend = useCallback(async () => {
    const query = input.trim();
    if (!query || !selectedBot || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await chatAPI.sendMessage(
        query,
        selectedBot,
        sessionId,
        controller.signal,
      );
      setSessionId(res.session_id);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          messageId: res.message_id,
          sources: res.sources,
        },
      ]);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "(사용자가 응답 생성을 중단했습니다.)" },
        ]);
      } else {
        const errMsg = e instanceof Error ? e.message : "오류가 발생했습니다";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `오류: ${errMsg}` },
        ]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      // textarea focus 복원 (응답 후 자연스러운 연속 질문)
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [input, selectedBot, sessionId, loading]);

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

  const selectedBotName =
    bots.find((b) => b.chatbot_id === selectedBot)?.display_name ?? "";

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">TrueWords</h1>
        </div>
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
                  <SelectItem key={bot.chatbot_id} value={bot.chatbot_id}>
                    {bot.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-6 py-20 text-muted-foreground">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                {botsLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : (
                  <Bot className="h-8 w-8 text-primary" />
                )}
              </div>
              {botsLoading ? (
                <div
                  className="space-y-1.5 text-center"
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
                <>
                  <p className="text-center text-sm">
                    {selectedBotName
                      ? `${selectedBotName}에게 질문해보세요`
                      : "챗봇을 선택하고 질문해보세요"}
                  </p>
                  {selectedBot && (
                    <div className="flex w-full flex-col gap-2 px-2 sm:flex-row sm:flex-wrap sm:justify-center">
                      {SUGGESTED_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => {
                            setInput(prompt);
                            requestAnimationFrame(() =>
                              textareaRef.current?.focus(),
                            );
                          }}
                          className="rounded-full border bg-card px-4 py-2 text-xs text-foreground/80 transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`group flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] space-y-2 ${
                  msg.role === "user" ? "order-first" : ""
                }`}
              >
                <Card
                  className={`px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.role === "assistant"
                      ? stripDisclaimer(msg.content)
                      : msg.content}
                  </p>
                </Card>

                {/* 출처 배지 */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {msg.sources.map((src, j) => (
                      <Badge key={j} variant="outline" className="text-xs">
                        {src.volume}
                        {src.source && ` (${src.source})`}
                      </Badge>
                    ))}
                  </div>
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

                      {/* 긍정 — 미제출이거나 "helpful" 선택 시만 노출 */}
                      {(!msg.feedback || msg.feedback === "helpful") && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="도움이 됐어요"
                          aria-pressed={msg.feedback === "helpful"}
                          disabled={!!msg.feedback}
                          onClick={() => submitFeedback(i, "helpful")}
                          className={`h-7 w-7 ${
                            msg.feedback === "helpful"
                              ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-50 disabled:opacity-100 dark:bg-emerald-950/40"
                              : ""
                          }`}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                      )}

                      {/* 부정 — 미제출이거나 부정 선택 시만 노출 */}
                      {(!msg.feedback || msg.feedback !== "helpful") && (
                        <NegativeFeedbackPopover
                          disabled={!!msg.feedback}
                          active={!!msg.feedback}
                          onSubmit={(reason, comment) =>
                            submitFeedback(i, reason, comment)
                          }
                        />
                      )}
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
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <Card className="bg-muted px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
                </div>
              </Card>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 입력 영역 — ChatGPT / Claude 스타일 */}
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
                onClick={handleSend}
                disabled={!canSend}
                aria-label="메시지 전송"
                className="absolute bottom-2 right-2 h-9 w-9 rounded-xl"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 px-2 text-center text-[11px] text-muted-foreground">
            TrueWords AI 답변은 참고용이며, 신앙 지도자의 조언을 대체하지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

/** 부정 피드백 팝오버 — 사유 선택 + (선택) 의견 입력 */
function NegativeFeedbackPopover({
  disabled,
  active,
  onSubmit,
}: {
  disabled: boolean;
  active: boolean;
  onSubmit: (type: FeedbackType, comment?: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Exclude<FeedbackType, "helpful">>(
    "inaccurate",
  );
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
                ? "bg-rose-50 text-rose-600 hover:bg-rose-50 disabled:opacity-100 dark:bg-rose-950/40"
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              취소
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
