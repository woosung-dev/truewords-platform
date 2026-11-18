"use client";

// AI 질문 홈 — 탭 추천(식구들이 공개를 허용한 답 중 관리자가 고른 Q&A) · 북마크 · 내 질문(내 계정) + 돋보기 검색 + "+ 질문하기".
// 큰 입력창을 두지 않는다: 질문 입력은 "+ 질문하기"나 말씀 단락처럼 행동이 있을 때만 연다(DEC-PWA-025).
// 추천은 로그인 없이 열람하고, 북마크·내 질문은 훈독 로그인 뒤 계정 목록을 읽는다.
// 검색은 추천 탭이면 서버(`GET /hoondok/questions?q=`), 북마크·내 질문 탭이면 받아 온 목록 안에서 거른다.
// 세 탭은 같은 카드(링크 + 형제 행동 버튼)를 쓴다. 조회수·나도 물어보기 수는 보이지 않는다 — 순위는 순서로만 드러난다.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { MyAskListResponse, MyAskSummary, PublicQuestionSummary } from "@truewords/api-client-ts/types";
import { ChevronRight, MessageCircleQuestion, Pin, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { ReaderToast, useReaderToast } from "@/features/hoondok/library/components/reader-toast";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { PUBLIC_BOOKMARKS_KEY, publicQuestionsKey } from "../../query-keys";
import { ASK_LIST_KEY, askDetailKey, asksAPI } from "../asks-api";
import { type BookmarkTarget, type ShowToast, useBookmarkToggle } from "../bookmarks";
import { askDateLabel, askMetaLabel } from "../format";
import { useClearLegacyAskItems } from "../legacy";
import { answeredByLabel, answerModeInfo } from "../modes";
import { PUBLIC_STATUS_LABEL, publicQuestionsAPI } from "../public-api";
import { AskLoginGate } from "./ask-gate";
import { BookmarkButton } from "./bookmark-button";

export type AskHomeTab = "recommended" | "saved" | "mine";

// id 는 예전 주소(`?tab=saved`)·링크와 맞추려고 saved 로 둔다. 화면 이름은 "북마크"다.
const TABS: readonly { id: AskHomeTab; label: string }[] = [
  { id: "recommended", label: "추천" },
  { id: "saved", label: "북마크" },
  { id: "mine", label: "내 질문" },
];

/** 공개 질문이 아직 없을 때 보이는 예시. 누르면 새 질문 화면을 채워서 연다(보내지는 않는다). */
export const ASK_EXAMPLES = [
  "참사랑이 직단거리로 간다는 말씀은 무슨 뜻인가요?",
  "정성을 드린다는 게 정확히 뭘 하는 건가요?",
  "자녀에게 말씀을 어떻게 가르치면 좋을까요?",
] as const;

/** 서버 검색어 상한(백엔드 q ≤ 100자). */
const QUERY_MAX = 100;
const SEARCH_DEBOUNCE_MS = 300;

/** `?tab=bookmarks` 도 북마크 탭으로 받는다(주소는 화면이 `?tab=saved` 로 정리한다). */
export function parseAskTab(raw: string | null): AskHomeTab {
  if (raw === "saved" || raw === "bookmarks") return "saved";
  return raw === "mine" ? "mine" : "recommended";
}

/** 인기순 목록은 쪽을 넘기는 사이 순서가 바뀌어 같은 id 가 두 쪽에 올 수 있다 — 처음 나온 것만 남긴다. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function newQuestionHref(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `/ask/new?q=${encodeURIComponent(trimmed)}` : "/ask/new";
}

type CardKind = "ask" | "pub";
const cardKey = (kind: CardKind, id: string) => `${kind}-${id}`;
const questionId = (kind: CardKind, id: string) => `ql-q-${cardKey(kind, id)}`;

/** 목록 카드 — 링크가 카드 전체를 덮고(::after) 행동 버튼만 그 위에 형제로 선다(링크 안에 버튼을 넣지 않는다). */
function QuestionCard({
  kind,
  id,
  href,
  question,
  meta,
  action,
}: {
  kind: CardKind;
  id: string;
  href: string;
  question: string;
  meta: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="ql-card" data-card={cardKey(kind, id)}>
      <Link className="ql-card__link" href={href}>
        <span className="ql-q" id={questionId(kind, id)}>
          {question}
        </span>
        <span className="ql-m">{meta}</span>
      </Link>
      {action}
    </li>
  );
}

/** 불러오는 중 — 읽히는 문장은 그대로 두고 그 아래 정적 카드 모양 3장(화면낭독기에는 숨긴다). */
function ListLoading({ label }: { label: string }) {
  return (
    <>
      <p className="ask-state ask-state--lead" role="status" aria-busy="true">
        {label}
      </p>
      <div className="ql-skels" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div className="ql-skel" key={index}>
            <span className="ql-skel__bar" />
            <span className="ql-skel__bar ql-skel__bar--72" />
            <span className="ql-skel__bar ql-skel__bar--36" />
          </div>
        ))}
      </div>
    </>
  );
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ask-state" role="status">
      <p>{message}</p>
      <button className="btn btn-line btn--sm" type="button" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

type FocusPlan = { kind: "removed"; key: string; index: number } | { kind: "restored"; key: string };

/**
 * 카드가 빠지거나 돌아온 뒤 포커스 자리. 빠지면 다음 카드 링크 → 이전 카드 링크 → 활성 탭 버튼, 돌아오면 그 카드 링크.
 * 누른 버튼이 사라지면 포커스가 body 로 떨어지므로 직접 옮긴다. 카드 목록이 실제로 바뀐 렌더에서만 움직인다.
 */
function useListFocus(keys: readonly string[], tabId: string) {
  const listRef = useRef<HTMLOListElement>(null);
  const planRef = useRef<FocusPlan | null>(null);
  useLayoutEffect(() => {
    const plan = planRef.current;
    if (!plan) return;
    const isPresent = keys.includes(plan.key);
    if (plan.kind === "removed" ? isPresent : !isPresent) return;
    planRef.current = null;
    const list = listRef.current;
    if (plan.kind === "restored") {
      list?.querySelector<HTMLElement>(`[data-card="${plan.key}"] .ql-card__link`)?.focus();
      return;
    }
    const links = Array.from(list?.querySelectorAll<HTMLElement>(".ql-card__link") ?? []);
    (links[plan.index] ?? links[plan.index - 1] ?? document.getElementById(tabId))?.focus();
  });
  return {
    listRef,
    setPlan: (plan: FocusPlan | null) => {
      planRef.current = plan;
    },
  };
}

function RecommendedPanel({ query, term, showToast }: { query: string; term: string; showToast: ShowToast }) {
  const list = useInfiniteQuery({
    queryKey: publicQuestionsKey(query),
    queryFn: ({ pageParam, signal }) => publicQuestionsAPI.list({ q: query || undefined, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
  const bookmarks = useBookmarkToggle({ showToast, returnTo: "/ask" });
  const items = uniqueById(list.data?.pages.flatMap((page) => page.items) ?? []);

  if (list.isPending) return <ListLoading label="추천 질문을 불러오고 있어요" />;
  if (list.isError) return <ListError message="추천 질문을 불러오지 못했어요." onRetry={() => void list.refetch()} />;
  if (items.length === 0 && !query) {
    return (
      <div className="ask-examples">
        <p className="ask-examples__k">아직 공개된 질문이 없어요. 이렇게 물어볼 수 있어요</p>
        {ASK_EXAMPLES.map((example) => (
          <Link key={example} className="chip-btn qs-starter" href={newQuestionHref(example)}>
            {example}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <>
      {query && (
        // 더 불러올 쪽이 남았으면 지금까지 읽은 개수는 전체가 아니다 — 개수를 적지 않는다
        <p className="ask-state__k">{`'${query}' 검색 결과${list.hasNextPage ? "" : ` ${items.length}개`}`}</p>
      )}
      {items.length > 0 && (
        <ol className="ql-list">
          {items.map((entry) => {
            const isOn = entry.bookmarked ?? false;
            return (
              <QuestionCard
                key={entry.id}
                kind="pub"
                id={entry.id}
                href={`/ask/p/${encodeURIComponent(entry.id)}`}
                question={entry.question}
                meta={
                  <>
                    {entry.pinned && (
                      <span className="badge ql-pin">
                        <Pin size={14} aria-hidden="true" />
                        고정
                      </span>
                    )}
                    <span>{answeredByLabel(entry.answer_mode)}</span>
                  </>
                }
                action={
                  <BookmarkButton
                    className="icon-btn ql-card__act"
                    isOn={isOn}
                    describedBy={questionId("pub", entry.id)}
                    onToggle={() => void bookmarks.toggle({ kind: "pub", id: entry.id, summary: entry }, !isOn)}
                  />
                }
              />
            );
          })}
        </ol>
      )}
      {list.hasNextPage && (
        // 새로 붙은 카드로 포커스를 옮기지 않는다 — 버튼에 남는다
        <HoondokButton
          variant="line"
          isSmall
          className="ask-more"
          isLoading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          더 보기
        </HoondokButton>
      )}
      {query && <NewFromSearch term={term} />}
    </>
  );
}

function NewFromSearch({ term }: { term: string }) {
  return (
    <Link className="ask-newline" href={newQuestionHref(term)}>
      <span>찾는 질문이 없나요?</span>
      <b>
        이 말로 새로 묻기
        <ChevronRight size={18} aria-hidden="true" />
      </b>
    </Link>
  );
}

function NoSearchResult({ term }: { term: string }) {
  return (
    <>
      <p className="ask-state__k">{`'${term.trim()}' 검색 결과가 없어요`}</p>
      <NewFromSearch term={term} />
    </>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <span className="empty__ic">
        <HoondokMascot pose="reading" size={72} fallback={<MessageCircleQuestion size={26} aria-hidden="true" />} />
      </span>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
    </div>
  );
}

/** 북마크·내 질문 탭 — 비로그인이면 로그인 안내, 로그인이면 계정 목록. */
function AccountPanel({ tab, term, showToast }: { tab: "saved" | "mine"; term: string; showToast: ShowToast }) {
  const { user, isLoading } = useCurrentUser();
  if (!user && !isLoading) {
    return (
      <AskLoginGate
        title={tab === "saved" ? "로그인하면 북마크한 질문을 볼 수 있어요" : "로그인하면 내 질문을 볼 수 있어요"}
        body="질문과 답은 내 계정에만 보관돼요. 다른 사람은 볼 수 없어요."
        returnTo={`/ask?tab=${tab}`}
      />
    );
  }
  if (isLoading) return <ListLoading label="내 질문을 불러오고 있어요" />;
  return tab === "saved" ? (
    <BookmarksPanel term={term} showToast={showToast} />
  ) : (
    <MyAsksPanel term={term} showToast={showToast} />
  );
}

function matches(question: string, needle: string): boolean {
  return !needle || question.toLowerCase().includes(needle);
}

type BookmarkEntry = { kind: "ask"; item: MyAskSummary } | { kind: "pub"; item: PublicQuestionSummary };

/**
 * 북마크한 내 질문(saved) + 북마크한 추천 질문을 한 목록으로. 두 목록에 같은 "북마크한 시각"이 없어
 * 서로 다른 시각을 섞어 가짜 시간순을 만들지 않는다 — 내 질문(최근 답 순) 뒤에 추천 질문(서버의 최근 북마크 순)을 잇는다.
 */
export function mergeBookmarks(
  asks: readonly MyAskSummary[],
  pubs: readonly PublicQuestionSummary[],
): BookmarkEntry[] {
  const mine = asks
    .filter((item) => item.saved)
    .sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at))
    .map((item): BookmarkEntry => ({ kind: "ask", item }));
  return [...mine, ...uniqueById(pubs).map((item): BookmarkEntry => ({ kind: "pub", item }))];
}

function BookmarksPanel({ term, showToast }: { term: string; showToast: ShowToast }) {
  const asks = useQuery({ queryKey: ASK_LIST_KEY, queryFn: ({ signal }) => asksAPI.list(signal), retry: false });
  const pubs = useQuery({
    queryKey: PUBLIC_BOOKMARKS_KEY,
    queryFn: ({ signal }) => publicQuestionsAPI.bookmarks(signal),
    retry: false,
  });
  const bookmarks = useBookmarkToggle({ showToast, returnTo: "/ask?tab=saved" });
  const needle = term.trim().toLowerCase();
  const all = mergeBookmarks(asks.data?.items ?? [], pubs.data?.items ?? []);
  const shown = all.filter((entry) => matches(entry.item.question, needle));
  const focus = useListFocus(
    shown.map((entry) => cardKey(entry.kind, entry.item.id)),
    "ask-tab-saved",
  );

  if (asks.isPending || pubs.isPending) return <ListLoading label="북마크한 질문을 불러오고 있어요" />;
  if (asks.isError && pubs.isError) {
    return (
      <ListError
        message="북마크한 질문을 불러오지 못했어요."
        onRetry={() => {
          void asks.refetch();
          void pubs.refetch();
        }}
      />
    );
  }

  // 한쪽만 실패하면 받은 쪽은 보이고 실패한 쪽만 다시 받는다
  const partial = asks.isError ? (
    <div className="ask-partial" role="status">
      <p className="ask-state__k">내 질문 북마크를 불러오지 못했어요</p>
      <button className="btn btn-line btn--sm" type="button" onClick={() => void asks.refetch()}>
        다시 시도
      </button>
    </div>
  ) : pubs.isError ? (
    <div className="ask-partial" role="status">
      <p className="ask-state__k">추천 질문 북마크를 불러오지 못했어요</p>
      <button className="btn btn-line btn--sm" type="button" onClick={() => void pubs.refetch()}>
        다시 시도
      </button>
    </div>
  ) : null;

  function remove(entry: BookmarkEntry, index: number) {
    const key = cardKey(entry.kind, entry.item.id);
    focus.setPlan({ kind: "removed", key, index });
    const target: BookmarkTarget = { kind: entry.kind, id: entry.item.id };
    void bookmarks
      .toggle(target, false, { undo: { onRestore: () => focus.setPlan({ kind: "restored", key }) } })
      .then((isDone) => {
        if (!isDone) focus.setPlan(null);
      });
  }

  if (shown.length === 0) {
    return (
      <>
        {partial}
        {needle ? (
          <NoSearchResult term={term} />
        ) : (
          !partial && (
            <EmptyState
              title="북마크한 질문이 없어요"
              body="추천 질문이나 내 답에서 북마크를 누르면 여기에 모여요."
            />
          )
        )}
      </>
    );
  }
  return (
    <>
      {partial}
      <ol className="ql-list" ref={focus.listRef}>
        {shown.map((entry, index) => {
          const { kind, item } = entry;
          return (
            <QuestionCard
              key={cardKey(kind, item.id)}
              kind={kind}
              id={item.id}
              href={kind === "ask" ? `/ask/${item.id}` : `/ask/p/${encodeURIComponent(item.id)}`}
              question={item.question}
              meta={
                kind === "ask" ? (
                  <span>
                    {["내 질문", askDateLabel(item.created_at), answerModeInfo(item.answer_mode).label]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : (
                  <>
                    <span className="badge">추천 질문</span>
                    <span>{answeredByLabel(item.answer_mode)}</span>
                  </>
                )
              }
              action={
                <BookmarkButton
                  className="icon-btn ql-card__act"
                  isOn
                  describedBy={questionId(kind, item.id)}
                  onToggle={() => remove(entry, index)}
                />
              }
            />
          );
        })}
      </ol>
      {needle && <NewFromSearch term={term} />}
    </>
  );
}

/** 내 질문 메타 한 줄 — 날짜 · 모델 · (이어서 n번) · 공개 상태(없으면 비공개). */
export function myAskMeta(item: MyAskSummary): string {
  return `${askMetaLabel(item)} · ${item.public_status ? PUBLIC_STATUS_LABEL[item.public_status] : "비공개"}`;
}

function MyAsksPanel({ term, showToast }: { term: string; showToast: ShowToast }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ASK_LIST_KEY, queryFn: ({ signal }) => asksAPI.list(signal), retry: false });
  const [deleting, setDeleting] = useState<{ item: MyAskSummary; index: number } | null>(null);
  const needle = term.trim().toLowerCase();
  const shown = (list.data?.items ?? []).filter((item) => matches(item.question, needle));
  const focus = useListFocus(
    shown.map((item) => cardKey("ask", item.id)),
    "ask-tab-mine",
  );

  if (list.isPending) return <ListLoading label="내 질문을 불러오고 있어요" />;
  if (list.isError) return <ListError message="내 질문을 불러오지 못했어요." onRetry={() => void list.refetch()} />;

  // 되돌릴 수 없는 작업이라 낙관적으로 빼지 않는다 — 서버가 지운 뒤 목록·상세 캐시에서 뺀다
  function handleDeleted(item: MyAskSummary, index: number) {
    focus.setPlan({ kind: "removed", key: cardKey("ask", item.id), index });
    queryClient.setQueryData<MyAskListResponse>(ASK_LIST_KEY, (data) =>
      data ? { ...data, items: data.items.filter((entry) => entry.id !== item.id) } : data,
    );
    queryClient.removeQueries({ queryKey: askDetailKey(item.id) });
    void queryClient.invalidateQueries({ queryKey: ASK_LIST_KEY });
    setDeleting(null);
    showToast("질문을 지웠어요");
  }

  if (shown.length === 0) {
    if (needle) return <NoSearchResult term={term} />;
    return <EmptyState title="아직 질문이 없어요" body="말씀을 읽다 생긴 물음을 편하게 적어 보세요." />;
  }
  return (
    <>
      <ol className="ql-list" ref={focus.listRef}>
        {shown.map((item, index) => (
          <QuestionCard
            key={item.id}
            kind="ask"
            id={item.id}
            href={`/ask/${item.id}`}
            question={item.question}
            meta={<span>{myAskMeta(item)}</span>}
            action={
              <button
                type="button"
                className="icon-btn ql-card__act"
                aria-label="질문 삭제"
                aria-describedby={questionId("ask", item.id)}
                aria-haspopup="dialog"
                onClick={() => setDeleting({ item, index })}
              >
                <Trash2 size={20} aria-hidden="true" />
              </button>
            }
          />
        ))}
      </ol>
      {deleting && (
        <DeleteAskSheet
          item={deleting.item}
          onClose={() => setDeleting(null)}
          onDeleted={() => handleDeleted(deleting.item, deleting.index)}
        />
      )}
    </>
  );
}

const PUBLIC_COPY_NOTE = {
  published:
    "추천 질문으로 공개된 사본은 함께 지워지지 않아요. 먼저 질문을 열어 '추천에서 내리기'를 눌러 주세요.",
  pending: "공개를 허용한 사본은 함께 지워지지 않아요. 먼저 질문을 열어 '공개 허용 취소'를 눌러 주세요.",
  hidden: "공개를 허용한 사본은 함께 지워지지 않아요. 먼저 질문을 열어 '공개 허용 취소'를 눌러 주세요.",
} as const;

function DeleteAskSheet({
  item,
  onClose,
  onDeleted,
}: {
  item: MyAskSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: async () => {
      try {
        await asksAPI.remove(item.id);
      } catch (error) {
        // 이미 지워졌으면(404) 지운 것과 같다
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: onDeleted,
  });
  return (
    <ReaderSheet title="이 질문을 지울까요?" onClose={onClose}>
      <p className="js-lede">질문과 답, 이어서 한 대화가 내 계정에서 모두 지워져요. 되돌릴 수 없어요.</p>
      {item.public_status && <p className="js-lede">{PUBLIC_COPY_NOTE[item.public_status]}</p>}
      {remove.isError && <p role="alert">지우지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      <div className="ask-acts">
        <HoondokButton variant="primary" isSmall isLoading={remove.isPending} onClick={() => remove.mutate()}>
          지우기
        </HoondokButton>
      </div>
    </ReaderSheet>
  );
}

function AskHomeView({ initialTab }: { initialTab: AskHomeTab }) {
  useClearLegacyAskItems();
  const router = useRouter();
  const toast = useReaderToast();
  const [tab, setTab] = useState<AskHomeTab>(initialTab);
  // 이미 이 화면에 있을 때 메뉴 "질문 기록"(?tab=mine) 으로 오면 다시 마운트되지 않는다 — 주소의 탭을 따른다
  const [urlTab, setUrlTab] = useState<AskHomeTab>(initialTab);
  if (initialTab !== urlTab) {
    setUrlTab(initialTab);
    setTab(initialTab);
  }

  // 탭을 주소에 남겨 상세에서 뒤로 오면 보던 탭으로 돌아온다
  function selectTab(next: AskHomeTab) {
    setTab(next);
    router.replace(next === "recommended" ? "/ask" : `/ask?tab=${next}`, { scroll: false });
  }
  const [isSearching, setIsSearching] = useState(false);
  const [term, setTerm] = useState("");
  // 서버 검색은 입력이 멈춘 뒤 한 번만 보낸다
  const [query, setQuery] = useState("");
  useEffect(() => {
    const next = term.trim().slice(0, QUERY_MAX);
    const timer = window.setTimeout(() => setQuery(next), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  // 닫은 뒤 포커스가 body 로 떨어지지 않게 돋보기로 돌려준다 — 돋보기는 닫힌 뒤에야 다시 그려지므로 ref 콜백에서 잡는다
  const shouldRefocusRef = useRef(false);
  function focusSearchButton(node: HTMLButtonElement | null) {
    if (!node || !shouldRefocusRef.current) return;
    shouldRefocusRef.current = false;
    node.focus();
  }

  function closeSearch() {
    setIsSearching(false);
    setTerm("");
    setQuery("");
    shouldRefocusRef.current = true;
  }

  return (
    <section className="col col--read ask-home">
      {isSearching && (
        <div className="ask-search">
          <Search size={20} aria-hidden="true" />
          <input
            className="ask-search__in"
            type="search"
            enterKeyHint="search"
            aria-label="질문 검색어"
            placeholder="질문을 찾아보세요"
            maxLength={QUERY_MAX}
            // biome-ignore lint/a11y/noAutofocus: 돋보기를 누른 직후의 입력창이라 바로 적을 수 있어야 한다
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
          />
          <button className="icon-btn" type="button" aria-label="검색 닫기" onClick={closeSearch}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="ask-home__head">
        <div className="pill-seg ask-home__tabs" role="tablist" aria-label="질문 보기" onKeyDown={handleSegmentKeyDown}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === tab ? "is-on" : ""}
              type="button"
              role="tab"
              id={`ask-tab-${entry.id}`}
              aria-selected={entry.id === tab}
              aria-controls="ask-tab-panel"
              tabIndex={entry.id === tab ? 0 : -1}
              onClick={() => selectTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {!isSearching && (
          <button
            ref={focusSearchButton}
            className="icon-btn ask-home__search"
            type="button"
            aria-label="질문 검색"
            onClick={() => setIsSearching(true)}
          >
            <Search size={22} aria-hidden="true" />
          </button>
        )}
      </div>

      <div id="ask-tab-panel" className="ask-home__panel" role="tabpanel" aria-labelledby={`ask-tab-${tab}`}>
        {tab === "recommended" ? (
          <RecommendedPanel query={isSearching ? query : ""} term={term} showToast={toast.show} />
        ) : (
          <AccountPanel tab={tab} term={isSearching ? term : ""} showToast={toast.show} />
        )}
      </div>

      <p className="notice">
        질문은 로그인한 분만 하루 5번까지 할 수 있어요. 질문과 답은 내 계정에만 보관되고, 공개를 고른 답 중 관리자가
        고른 것만 이름 없이 추천 질문에 올라가요.
      </p>

      <Link className="ask-fab" href="/ask/new">
        <Plus size={20} aria-hidden="true" />
        질문하기
      </Link>

      {/* role="status" 라 포커스를 뺏지 않는다. 폰은 FAB 위(하단 180px), 1024px 이상은 가운데 아래라 FAB 와 겹치지 않는다 */}
      {toast.toast && <ReaderToast toast={toast.toast} onDismiss={toast.dismiss} />}
    </section>
  );
}

function AskHomeWithQuery() {
  // `/ask/log` 와 메뉴 "질문 기록" 이 `?tab=mine` 으로 들어온다. `?tab=bookmarks` 는 정규 주소 `?tab=saved` 로 맞춘다
  const router = useRouter();
  const raw = useSearchParams().get("tab");
  useEffect(() => {
    if (raw === "bookmarks") router.replace("/ask?tab=saved", { scroll: false });
  }, [raw, router]);
  return <AskHomeView initialTab={parseAskTab(raw)} />;
}

export function AskHome() {
  return (
    <Suspense fallback={<AskHomeView initialTab="recommended" />}>
      <AskHomeWithQuery />
    </Suspense>
  );
}
