"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { RagTraceRequest } from "../types";

type AnswerMode = NonNullable<RagTraceRequest["answer_mode"]>;
type StopAfter = NonNullable<RagTraceRequest["stop_after"]>;

const ANSWER_MODES: { value: AnswerMode; label: string }[] = [
  { value: "standard", label: "표준" },
  { value: "theological", label: "신학자" },
  { value: "pastoral", label: "목회상담" },
  { value: "beginner", label: "초신자" },
  { value: "kids", label: "어린이" },
];

const STOP_AFTER: { value: StopAfter; label: string }[] = [
  { value: "full", label: "답변 생성까지 (전체)" },
  { value: "rerank", label: "rerank 까지 (생성 안 함)" },
  { value: "search", label: "검색까지 (생성 안 함)" },
];

const QUERY_MAX = 1000; // RagTraceRequest.query max_length 와 같다.

// 질문 입력은 Textarea primitive 가 없어 기본 <textarea> 에 Input 과 같은 토큰 클래스를 쓴다.
const TEXTAREA_CLASS =
  "min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

export interface ChatbotOption {
  chatbot_id: string;
  display_name: string;
  is_active: boolean;
}

interface Props {
  chatbots: ChatbotOption[];
  chatbotsLoading: boolean;
  chatbotsError: boolean;
  onRetryChatbots: () => void;
  pending: boolean;
  onSubmit: (req: RagTraceRequest) => void;
}

// 실행 중 경과 초. 실행할 때마다 새로 마운트되어 0초부터 센다.
function ElapsedSeconds() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-xs text-muted-foreground tabular-nums" aria-live="off">
      {elapsed.toFixed(1)}초 경과
    </span>
  );
}

// 운영 기본 봇 'all' 을 먼저, 없으면 첫 활성 봇을 고른다(목록은 최신 생성 순이라 첫 봇은 테스트 봇일 수 있다).
export function defaultChatbotId(chatbots: ChatbotOption[]): string {
  const all = chatbots.find((b) => b.chatbot_id === "all");
  return (all ?? chatbots.find((b) => b.is_active) ?? chatbots[0])?.chatbot_id ?? "";
}

function emptyBotLabel(loading: boolean, error: boolean): string {
  if (loading) return "불러오는 중…";
  if (error) return "목록을 불러오지 못함";
  return "챗봇 없음";
}

export function TraceForm({ chatbots, chatbotsLoading, chatbotsError, onRetryChatbots, pending, onSubmit }: Props) {
  const [query, setQuery] = useState("");
  // null = 아직 고르지 않음 → defaultChatbotId 를 쓴다.
  const [selectedBot, setSelectedBot] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode | "">("");
  const [forceRerank, setForceRerank] = useState(false);
  const [forceRewrite, setForceRewrite] = useState(false);
  const [stopAfter, setStopAfter] = useState<StopAfter>("full");

  const chatbotId = selectedBot ?? defaultChatbotId(chatbots);
  const trimmed = query.trim();
  const canSubmit = !pending && trimmed.length > 0 && chatbotId !== "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      query: trimmed,
      chatbot_id: chatbotId,
      answer_mode: answerMode === "" ? null : answerMode,
      // 체크하지 않으면 null — 봇 설정을 그대로 쓴다.
      overrides: {
        rerank_enabled: forceRerank ? true : null,
        query_rewrite_enabled: forceRewrite ? true : null,
      },
      stop_after: stopAfter,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-5 space-y-4">
      {chatbotsError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger-border bg-danger-soft px-4 py-2 text-sm text-destructive"
        >
          <span>챗봇 목록을 불러오지 못했습니다. 권한이나 네트워크를 확인해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetryChatbots}>
            다시 시도
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="trace-query">질문</Label>
        <textarea
          id="trace-query"
          className={TEXTAREA_CLASS}
          value={query}
          maxLength={QUERY_MAX}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="운영과 같은 단계로 다시 실행할 질문"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="trace-bot">챗봇</Label>
          <NativeSelect
            id="trace-bot"
            value={chatbotId}
            disabled={chatbotsLoading || chatbots.length === 0}
            onChange={(e) => setSelectedBot(e.target.value)}
          >
            {chatbots.length === 0 && <option value="">{emptyBotLabel(chatbotsLoading, chatbotsError)}</option>}
            {chatbots.map((bot) => (
              <option key={bot.chatbot_id} value={bot.chatbot_id}>
                {bot.display_name} ({bot.chatbot_id}){bot.is_active ? "" : " (비활성)"}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trace-mode">답변 모드</Label>
          <NativeSelect
            id="trace-mode"
            value={answerMode}
            onChange={(e) => setAnswerMode(e.target.value as AnswerMode | "")}
          >
            <option value="">자동 (봇 기본)</option>
            {ANSWER_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trace-stop">실행 범위</Label>
          <NativeSelect id="trace-stop" value={stopAfter} onChange={(e) => setStopAfter(e.target.value as StopAfter)}>
            {STOP_AFTER.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <Checkbox id="trace-rerank" checked={forceRerank} onCheckedChange={(c) => setForceRerank(c === true)} />
          <Label htmlFor="trace-rerank" className="cursor-pointer">
            rerank 강제 켜기
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <Checkbox id="trace-rewrite" checked={forceRewrite} onCheckedChange={(c) => setForceRewrite(c === true)} />
          <Label htmlFor="trace-rewrite" className="cursor-pointer">
            rewrite 강제 켜기
          </Label>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {pending && <ElapsedSeconds />}
          <Button type="submit" disabled={!canSubmit}>
            {pending ? "실행 중..." : "실행"}
          </Button>
        </div>
      </div>
    </form>
  );
}
