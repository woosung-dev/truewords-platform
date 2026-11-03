"use client";

// AI 질문 홈 — 탭 추천(식구들이 공개를 허용한 답 중 관리자가 고른 Q&A) · 저장 · 내 질문(내 계정) + 돋보기 검색 + "+ 질문하기".
// 큰 입력창을 두지 않는다: 질문 입력은 "+ 질문하기"나 말씀 단락처럼 행동이 있을 때만 연다(DEC-PWA-025).
// 추천은 로그인 없이 열람하고, 저장·내 질문은 훈독 로그인 뒤 계정 목록(`GET /hoondok/me/asks`)을 읽는다.
// 검색은 추천 탭이면 서버(`GET /hoondok/questions?q=`), 저장·내 질문 탭이면 받아 온 목록 안에서 거른다.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { MyAskSummary } from "@truewords/api-client-ts/types";
import { ChevronRight, MessageCircleQuestion, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { HoondokMascot } from "@/components/hoondok";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { ASK_LIST_KEY, asksAPI } from "../asks-api";
import { askMetaLabel } from "../format";
import { useClearLegacyAskItems } from "../legacy";
import { answeredByLabel } from "../modes";
import { PUBLIC_STATUS_LABEL, publicQuestionsAPI } from "../public-api";
import { AskLoginGate } from "./ask-gate";

export type AskHomeTab = "recommended" | "saved" | "mine";

const TABS: readonly { id: AskHomeTab; label: string }[] = [
  { id: "recommended", label: "추천" },
  { id: "saved", label: "저장" },
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

export function parseAskTab(raw: string | null): AskHomeTab {
  return raw === "saved" || raw === "mine" ? raw : "recommended";
}

function newQuestionHref(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `/ask/new?q=${encodeURIComponent(trimmed)}` : "/ask/new";
}

function RecommendedPanel({ query, term }: { query: string; term: string }) {
  const list = useInfiniteQuery({
    queryKey: ["hoondok", "public-questions", query],
    queryFn: ({ pageParam, signal }) => publicQuestionsAPI.list({ q: query || undefined, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  if (list.isPending) {
    return (
      <p className="ask-state" role="status" aria-busy="true">
        추천 질문을 불러오고 있어요
      </p>
    );
  }
  if (list.isError) {
    return (
      <div className="ask-state" role="status">
        <p>추천 질문을 불러오지 못했어요.</p>
        <button className="btn btn-line btn--sm" type="button" onClick={() => void list.refetch()}>
          다시 시도
        </button>
      </div>
    );
  }
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
          {items.map((entry) => (
            <li key={entry.id}>
              <Link href={`/ask/p/${encodeURIComponent(entry.id)}`}>
                <span className="ql-q">{entry.question}</span>
                <span className="ql-m">{answeredByLabel(entry.answer_mode)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <button
          className="btn btn-line btn--sm ask-more"
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          더 보기
        </button>
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

/** 저장·내 질문 탭 — 비로그인이면 로그인 안내, 로그인이면 계정 목록. */
function MinePanel({ tab, term }: { tab: "saved" | "mine"; term: string }) {
  const { user, isLoading } = useCurrentUser();
  const list = useQuery({
    queryKey: ASK_LIST_KEY,
    queryFn: ({ signal }) => asksAPI.list(signal),
    enabled: Boolean(user),
    retry: false,
  });
  if (!user && !isLoading) {
    return (
      <AskLoginGate
        title={tab === "saved" ? "로그인하면 저장한 답을 볼 수 있어요" : "로그인하면 내 질문을 볼 수 있어요"}
        body="질문과 답은 내 계정에만 보관돼요. 다른 사람은 볼 수 없어요."
        returnTo={`/ask?tab=${tab}`}
      />
    );
  }
  if (isLoading || list.isPending) {
    return (
      <p className="ask-state" role="status" aria-busy="true">
        내 질문을 불러오고 있어요
      </p>
    );
  }
  if (list.isError) {
    return (
      <div className="ask-state" role="status">
        <p>내 질문을 불러오지 못했어요.</p>
        <button className="btn btn-line btn--sm" type="button" onClick={() => void list.refetch()}>
          다시 시도
        </button>
      </div>
    );
  }
  return <LocalPanel tab={tab} items={list.data.items} term={term} />;
}

function LocalPanel({ tab, items, term }: { tab: "saved" | "mine"; items: MyAskSummary[]; term: string }) {
  const needle = term.trim().toLowerCase();
  const scoped = tab === "saved" ? items.filter((item) => item.saved) : items;
  const shown = needle ? scoped.filter((item) => item.question.toLowerCase().includes(needle)) : scoped;

  if (shown.length === 0) {
    if (needle) {
      return (
        <>
          <p className="ask-state__k">{`'${term.trim()}' 검색 결과가 없어요`}</p>
          <NewFromSearch term={term} />
        </>
      );
    }
    return (
      <div className="empty">
        <span className="empty__ic">
          <HoondokMascot pose="reading" size={72} fallback={<MessageCircleQuestion size={26} aria-hidden="true" />} />
        </span>
        <h2 className="empty__title">{tab === "saved" ? "저장한 답이 없어요" : "아직 질문이 없어요"}</h2>
        <p className="empty__body">
          {tab === "saved" ? "답 아래의 저장을 누르면 여기에 모여요." : "말씀을 읽다 생긴 물음을 편하게 적어 보세요."}
        </p>
      </div>
    );
  }
  return (
    <ol className="ql-list">
      {shown.map((item) => (
        <li key={item.id}>
          <Link href={`/ask/${item.id}`}>
            <span className="ql-q">{item.question}</span>
            <span className="ql-m">
              {askMetaLabel(item)}
              {item.saved && <span className="badge ql-saved">저장됨</span>}
              {item.public_status && (
                <span className="badge badge--line ql-saved">{PUBLIC_STATUS_LABEL[item.public_status]}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function AskHomeView({ initialTab }: { initialTab: AskHomeTab }) {
  useClearLegacyAskItems();
  const router = useRouter();
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
          <RecommendedPanel query={isSearching ? query : ""} term={term} />
        ) : (
          <MinePanel tab={tab} term={isSearching ? term : ""} />
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
    </section>
  );
}

function AskHomeWithQuery() {
  // `/ask/log` 와 메뉴 "질문 기록" 이 `?tab=mine` 으로 들어온다
  return <AskHomeView initialTab={parseAskTab(useSearchParams().get("tab"))} />;
}

export function AskHome() {
  return (
    <Suspense fallback={<AskHomeView initialTab="recommended" />}>
      <AskHomeWithQuery />
    </Suspense>
  );
}
