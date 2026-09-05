"use client";

// 대화 기록 페이지 — 로그인 사용자의 지난 대화를 2-pane(목록 + 리딩)으로 열람하고 이어서 대화
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  Copy,
  Inbox,
  LogOut,
  MessageSquare,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authAPI } from "@/features/auth/api";
import { AssistantMessage } from "@/features/chat/components/assistant-message";
import { chatAPI, type SessionListItem } from "@/features/chatbot/chat-api";

// ── 날짜 그룹 / 상대시간 유틸 ───────────────────────────────────
type Bucket = "today" | "yesterday" | "7d" | "30d" | "older";
const BUCKET_ORDER: Bucket[] = ["today", "yesterday", "7d", "30d", "older"];
const BUCKET_LABEL: Record<Bucket, string> = {
  today: "오늘",
  yesterday: "어제",
  "7d": "지난 7일",
  "30d": "지난 30일",
  older: "이전",
};

// 백엔드 timestamp 는 naive UTC (datetime.utcnow()) — tz 지정자가 없으면 'Z' 를 붙여
// UTC 로 파싱한다. 안 그러면 브라우저가 로컬시간으로 오해해 KST 기준 9시간 어긋난다.
function parseUtc(iso: string): Date {
  return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : iso + "Z");
}

// 백엔드 safety layer 가 답변 끝에 붙이는 면책 고지 제거 — 하단 고정 문구와 중복 방지.
const DISCLAIMER_PREFIX = "\n\n---\n_이 답변은 AI가 생성한";
function stripDisclaimer(text: string): string {
  const idx = text.indexOf(DISCLAIMER_PREFIX);
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

function bucketOf(iso: string): Bucket {
  const d = parseUtc(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startToday - dDay) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff <= 7) return "7d";
  if (diff <= 30) return "30d";
  return "older";
}

function relTime(iso: string): string {
  const d = parseUtc(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const b = bucketOf(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (b === "today") return `${Math.floor(min / 60)}시간 전`;
  if (b === "yesterday") return `어제 ${hh}:${mm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

type Period = "all" | "today" | "week" | "month";
function inPeriod(iso: string, period: Period): boolean {
  if (period === "all") return true;
  const b = bucketOf(iso);
  if (period === "today") return b === "today";
  if (period === "week") return b === "today" || b === "yesterday" || b === "7d";
  return b !== "older"; // month
}

export default function HistoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [botFilter, setBotFilter] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [showReader, setShowReader] = useState(false); // 모바일 pane 전환

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: () => chatAPI.listSessions(),
  });
  const sessions = useMemo(() => data?.items ?? [], [data]);

  // 봇 필터 옵션 — 실제 데이터의 chatbot_name 에서 도출.
  const botOptions = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach((s) => s.chatbot_name && names.add(s.chatbot_name));
    return Array.from(names);
  }, [sessions]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          (botFilter === "all" || s.chatbot_name === botFilter) &&
          inPeriod(s.last_activity, period) &&
          (!q || s.preview.toLowerCase().includes(q)),
      ),
    [sessions, botFilter, period, q],
  );

  const groups = useMemo(
    () =>
      BUCKET_ORDER.map((bk) => ({
        bk,
        label: BUCKET_LABEL[bk],
        items: filtered.filter((s) => bucketOf(s.last_activity) === bk),
      })).filter((g) => g.items.length > 0),
    [filtered],
  );

  // 데스크톱: 아무것도 선택 안 됐으면 첫 항목 자동 선택.
  useEffect(() => {
    if (!selectedId && sessions.length > 0) setSelectedId(sessions[0].session_id);
  }, [sessions, selectedId]);

  const selected = sessions.find((s) => s.session_id === selectedId) ?? null;

  const { data: transcript, isLoading: tLoading } = useQuery({
    queryKey: ["chat-session", selectedId],
    queryFn: () => chatAPI.getSessionHistory(selectedId as string),
    enabled: !!selectedId,
  });

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setShowReader(true);
  }, []);

  const handleContinue = useCallback(() => {
    if (selectedId) router.push(`/?session=${selectedId}`);
  }, [selectedId, router]);

  const handleLogout = useCallback(async () => {
    try {
      await authAPI.logout();
    } finally {
      queryClient.clear();
      router.push("/login");
    }
  }, [router, queryClient]);

  const hasNoSessions = !isLoading && !isError && sessions.length === 0;

  return (
    <div className="flex h-dvh flex-col bg-secondary">
      {/* ── 상단바 (채팅 진입점과 동일 톤) ── */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="채팅으로"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-4 w-4" />
          </span>
          <span className="font-display text-xl font-semibold tracking-wide">TrueWords</span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => router.push("/")}
            className="gap-1.5"
            aria-label="새 대화"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden text-xs sm:inline">새 대화</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleLogout}
            className="gap-1.5"
            aria-label="로그아웃"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden text-xs sm:inline">로그아웃</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-4 py-4 sm:px-5">
        <div className="mb-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">대화 기록</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            지난 대화를 목록에서 찾아 읽고, 이어서 대화할 수 있어요.
          </p>
        </div>

        {hasNoSessions ? (
          <EmptyAll onStart={() => router.push("/")} />
        ) : (
          <div
            className={`flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-[0_6px_20px_-6px_rgba(28,23,20,0.12)] ${
              showReader ? "reader-open" : ""
            }`}
          >
            {/* ── 사이드바: 목록 ── */}
            <aside
              className={`flex w-full min-w-0 flex-col border-r bg-background sm:w-[320px] sm:min-w-[320px] ${
                showReader ? "hidden sm:flex" : "flex"
              }`}
              aria-label="대화 목록"
            >
              <div className="flex flex-col gap-2 border-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="지난 대화 검색…"
                    aria-label="대화 검색"
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30"
                  />
                </div>
                {/* 봇 필터 */}
                {botOptions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FilterChip active={botFilter === "all"} onClick={() => setBotFilter("all")}>
                      전체
                    </FilterChip>
                    {botOptions.map((name) => (
                      <FilterChip
                        key={name}
                        active={botFilter === name}
                        onClick={() => setBotFilter(name)}
                      >
                        {name}
                      </FilterChip>
                    ))}
                  </div>
                )}
                {/* 기간 필터 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ["all", "전체"],
                      ["today", "오늘"],
                      ["week", "이번 주"],
                      ["month", "이번 달"],
                    ] as [Period, string][]
                  ).map(([value, label]) => (
                    <FilterChip
                      key={value}
                      active={period === value}
                      onClick={() => setPeriod(value)}
                    >
                      {label}
                    </FilterChip>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {isLoading ? (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : isError ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
                  </p>
                ) : groups.length === 0 ? (
                  <div className="px-3 pt-4">
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
                      <p className="font-medium text-foreground">일치하는 대화가 없어요</p>
                      <p className="mt-0.5 text-xs">검색어나 필터를 바꿔보세요.</p>
                    </div>
                  </div>
                ) : (
                  groups.map((g) => (
                    <div key={g.bk}>
                      <h2 className="sticky top-0 z-[2] bg-gradient-to-b from-background from-80% to-transparent px-4 pb-1.5 pt-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {g.label}
                      </h2>
                      <ul className="space-y-0.5 px-1.5">
                        {g.items.map((s) => (
                          <ThreadRow
                            key={s.session_id}
                            item={s}
                            active={s.session_id === selectedId}
                            onSelect={() => handleSelect(s.session_id)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* ── 리딩 pane ── */}
            <section
              className={`min-w-0 flex-1 flex-col bg-card ${
                showReader ? "flex" : "hidden sm:flex"
              }`}
              aria-label="대화 내용"
            >
              {selected ? (
                <>
                  <div className="flex items-start justify-between gap-3 border-b p-4">
                    <div className="flex min-w-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowReader(false)}
                        aria-label="목록으로"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card sm:hidden"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <div className="min-w-0">
                        <h2 className="line-clamp-2 text-base font-semibold leading-snug">
                          {selected.preview || "제목 없는 대화"}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {selected.chatbot_name && (
                            <span className="rounded-full border bg-secondary px-2 py-0.5 font-medium text-foreground/70">
                              {selected.chatbot_name}
                            </span>
                          )}
                          <span>메시지 {selected.message_count}개</span>
                          <span className="opacity-50">·</span>
                          <span>마지막 활동 {relTime(selected.last_activity)}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={handleContinue}
                      className="shrink-0 gap-1.5 bg-accent text-white hover:bg-accent/90"
                    >
                      <ArrowRight className="h-4 w-4" />
                      <span className="whitespace-nowrap">이어서 대화</span>
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                    {tLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="ml-auto h-16 w-2/3 rounded-2xl" />
                        <Skeleton className="h-24 w-4/5 rounded-2xl" />
                        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
                      </div>
                    ) : transcript && transcript.messages.length > 0 ? (
                      <div className="flex flex-col gap-4">
                        {transcript.messages.map((m, i) => {
                          const isUser = m.role.toLowerCase() === "user";
                          const body = isUser ? m.content : stripDisclaimer(m.content);
                          return (
                            <div
                              key={i}
                              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                                  isUser
                                    ? "whitespace-pre-wrap rounded-br-sm bg-primary text-[14.5px] leading-[1.75] text-primary-foreground"
                                    : "rounded-bl-sm border bg-background text-foreground"
                                }`}
                              >
                                <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider opacity-60">
                                  {isUser ? "나" : selected.chatbot_name || "TrueWords"}
                                </span>
                                {isUser ? (
                                  body
                                ) : (
                                  <>
                                    <AssistantMessage content={body} />
                                    <CopyButton text={body} />
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <p className="mt-1 border-t pt-3 text-center text-[11.5px] text-muted-foreground">
                          이 답변은 AI가 생성한 참고 자료이며, 신앙 지도자의 조언을 대체하지 않습니다.
                        </p>
                      </div>
                    ) : (
                      <p className="pt-10 text-center text-sm text-muted-foreground">
                        이 대화에는 표시할 메시지가 없어요.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm">왼쪽 목록에서 대화를 선택하세요.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

// ── 목록 항목 ───────────────────────────────────────────────
function ThreadRow({
  item,
  active,
  onSelect,
}: {
  item: SessionListItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-[44px] w-full flex-col items-start gap-1 rounded-lg border-l-2 px-3 py-2.5 text-left transition-colors ${
          active
            ? "border-accent bg-accent/10"
            : "border-transparent hover:bg-secondary"
        }`}
      >
        <span
          className={`line-clamp-2 text-[13.5px] leading-snug ${
            active ? "font-semibold text-primary" : "font-medium text-foreground"
          }`}
        >
          {item.preview || "제목 없는 대화"}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span>{relTime(item.last_activity)}</span>
          <span className="opacity-50">·</span>
          <span>{item.message_count}개 메시지</span>
          {item.chatbot_name && (
            <>
              <span className="opacity-50">·</span>
              <span className="rounded-full border bg-card px-1.5 py-px font-medium text-foreground/70">
                {item.chatbot_name}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[28px] rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/60"
      }`}
    >
      {children}
    </button>
  );
}

// ── 응답 복사 버튼 ───────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("응답을 복사했어요");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("복사에 실패했어요");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label="응답 복사"
      className="mt-2.5 inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

// ── 전체 빈 상태 (대화가 하나도 없음) ─────────────────────────
function EmptyAll({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-sm rounded-xl border border-dashed bg-card p-8 text-center">
        <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
        <p className="text-base font-semibold">아직 나눈 대화가 없어요</p>
        <p className="mt-1 text-sm text-muted-foreground">
          첫 질문을 건네보세요. 대화는 여기에 자동으로 쌓여요.
        </p>
        <Button onClick={onStart} className="mt-4 gap-1.5">
          <Plus className="h-4 w-4" />새 대화 시작하기
        </Button>
      </div>
    </div>
  );
}
