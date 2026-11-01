import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPublic, CardReceiptItem } from "@/features/hoondok/cards/api";
import { bookName, bookParts } from "@/features/hoondok/cards/components/book";
import { markParagraphs } from "@/features/hoondok/cards/components/words-card";
import { findCardSentence, normalizeForMatch } from "@/features/hoondok/cards/match";
import {
  foldSteps,
  pageSteps,
  pulloutEnterSteps,
  pulloutExitSteps,
  receiveSteps,
  type Step,
  totalDuration,
} from "@/features/hoondok/cards/motion";
import { cardCopyText, cardWordsHref, shareCard } from "@/features/hoondok/cards/share";
import { isReceivedToday, readLocalReceipt, writeLocalReceipt } from "@/features/hoondok/cards/storage";
import { formatKstDate } from "@/features/hoondok/today";

// 오늘의 책갈피 (PLAN-HD-012) — 매칭 정규화 · 공유 폴백 3단계 · 동작 줄이기 분기 · 오늘 받음 판정 · 화면 흐름.
const TODAY = formatKstDate().iso;
const CARD: CardPublic = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "우리가 원수를 대하여 분하고 절통한 마음이 우러날 때마다 하나님은 용서의 눈물을 흘리신다는 것을 알아야 합니다.",
  volume: "천성경 제1편",
  chunk_id: "chunk-42",
  chunk_index: 41,
  work_title: "천성경",
  source_label: "천성경 제1편 하나님 p.42",
  topic: "용서",
};

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("책 이름 (표지·홈 카드 제목)", () => {
  it("volume 이 파일명이어도 확장자를 붙여 보이지 않는다 — 운영 '천성경 .pdf' 재현", () => {
    expect(bookName({ work_title: "천성경", volume: "천성경.pdf" })).toBe("천성경");
    expect(bookParts({ work_title: "천성경", volume: "천성경.pdf" })).toEqual({ title: "천성경", sub: "" });
    expect(bookName({ work_title: "말씀선집", volume: "말씀선집 355권.PDF" })).toBe("말씀선집 355권");
    expect(bookName({ work_title: "평화경", volume: " 평화경 .docx " })).toBe("평화경");
    expect(bookName({ work_title: "천성경", volume: "천성경 제1편" })).toBe("천성경 제1편");
  });
});

describe("원문 문장 매칭 (공백·문장부호 느슨한 정규화)", () => {
  it("공백·문장부호·기호를 지우고 원래 위치를 기억한다", () => {
    const { chars, positions } = normalizeForMatch("“하나님, 사랑!”  이다");
    expect(chars).toBe("하나님사랑이다");
    expect(positions[0]).toBe(1);
  });

  it("줄바꿈·따옴표·쉼표가 달라도 찾고, 닫는 마침표까지 밑줄 범위에 넣는다", () => {
    const display = `앞 문장입니다. ‘우리가 원수를 대하여’ 분하고 절통한 마음이\n우러날 때마다, 하나님은 용서의 눈물을 흘리신다는 것을 알아야 합니다. 뒤 문장.`;
    const range = findCardSentence(display, CARD.text);
    expect(range).not.toBeNull();
    const marked = display.slice(range?.start, range?.end);
    expect(marked.startsWith("우리가")).toBe(true);
    expect(marked.endsWith("합니다.")).toBe(true);
    expect(marked).not.toContain("뒤 문장");
  });

  it("글자가 다르면 null — 화면은 단락 전체를 강조한다", () => {
    expect(findCardSentence("전혀 다른 원문입니다.", CARD.text)).toBeNull();
    expect(findCardSentence("아무 글", "  … ")).toBeNull();
    expect(markParagraphs("전혀 다른 원문입니다.", CARD.text).isMatched).toBe(false);
  });

  it("문단(\\n\\n)을 가로지르는 문장은 문단마다 밑줄 조각으로 나뉜다", () => {
    const { paragraphs, isMatched } = markParagraphs("첫 문단 가나다\n\n라마바 끝 문단", "가나다 라마바");
    expect(isMatched).toBe(true);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].parts).toEqual([
      { text: "첫 문단 ", isMarked: false },
      { text: "가나다", isMarked: true },
    ]);
    expect(paragraphs[1].parts[0]).toEqual({ text: "라마바", isMarked: true });
  });
});

describe("건네기 공유 폴백 (파일 → 링크 → 클립보드 → 직접 표시)", () => {
  const link = "https://example.test/hoondok/c/1";
  const file = new File(["png"], "card.png", { type: "image/png" });

  it("파일을 받을 수 있으면 이미지 + 링크를 보낸다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareCard({ card: CARD, link, file, nav: { share, canShare: () => true } });
    expect(result).toBe("file");
    expect(share).toHaveBeenCalledWith({ title: "오늘의 책갈피 · 천성경", url: link, files: [file] });
  });

  it("파일 공유를 못 하면 링크만 보낸다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareCard({ card: CARD, link, file, nav: { share, canShare: () => false } });
    expect(result).toBe("link");
    expect(share).toHaveBeenCalledWith({ title: "오늘의 책갈피 · 천성경", url: link });
  });

  it("공유 시트가 없으면 본문·출처·훈독·링크를 클립보드로", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await shareCard({ card: CARD, link, file, nav: { clipboard: { writeText } as never } });
    expect(result).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith(cardCopyText(CARD, link));
    expect(cardCopyText(CARD, link)).toBe(`“${CARD.text}”\n— 천성경 제1편 하나님 p.42 · 훈독\n${link}`);
  });

  it("둘 다 없으면 none(링크 직접 표시), 사용자가 시트를 닫으면 cancelled(복사하지 않음)", async () => {
    expect(await shareCard({ card: CARD, link, file: null, nav: {} })).toBe("none");
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const result = await shareCard({ card: CARD, link, file: null, nav: { share, clipboard: { writeText } as never } });
    expect(result).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("공유가 다른 이유로 실패하면 클립보드로 내려간다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    expect(
      await shareCard({
        card: CARD,
        link,
        file,
        nav: { share, canShare: () => true, clipboard: { writeText } as never },
      }),
    ).toBe("clipboard");
  });

  it("원문 연결 주소는 인용 단락 + card 파라미터", () => {
    expect(cardWordsHref(CARD)).toBe(
      `/hoondok/words/${encodeURIComponent("천성경 제1편")}?chunk_id=chunk-42&card=${CARD.id}`,
    );
  });
});

describe("동작 줄이기 분기 (transform·opacity 만, 줄이면 페이드만)", () => {
  const onlyOpacity = (steps: Step[]) =>
    steps.every((step) =>
      step.keyframes.every((frame) => Object.keys(frame).every((k) => ["opacity", "offset", "easing"].includes(k))),
    );
  const onlyTransformOpacity = (steps: Step[]) =>
    steps.every((step) =>
      step.keyframes.every((frame) =>
        Object.keys(frame).every((k) => ["opacity", "transform", "offset", "easing"].includes(k)),
      ),
    );

  it("받는 순간: 기본은 약 1.56초 · 줄이면 400ms 페이드", () => {
    const full = receiveSteps({ reduced: false, flipStart: "translate(1px, 2px) scale(0.1, 0.2)" });
    expect(onlyTransformOpacity(full)).toBe(true);
    expect(totalDuration(full)).toBe(1560);
    const reduced = receiveSteps({ reduced: true, flipStart: "none" });
    expect(onlyOpacity(reduced)).toBe(true);
    expect(totalDuration(reduced)).toBeLessThanOrEqual(400);
  });

  it("책에 다시 꽂기·원문 펼침·다시 꺼내기도 같은 규칙", () => {
    expect(totalDuration(foldSteps({ reduced: false, flipEnd: "none" }))).toBe(900);
    expect(totalDuration(pageSteps(false))).toBe(900);
    for (const steps of [
      foldSteps({ reduced: false, flipEnd: "none" }),
      pageSteps(false),
      pulloutExitSteps(false),
      pulloutEnterSteps(false),
    ])
      expect(onlyTransformOpacity(steps)).toBe(true);
    for (const steps of [foldSteps({ reduced: true, flipEnd: "none" }), pageSteps(true), pulloutEnterSteps(true)]) {
      expect(onlyOpacity(steps)).toBe(true);
      expect(totalDuration(steps)).toBeLessThanOrEqual(400);
    }
    expect(pulloutExitSteps(true)).toEqual([]);
  });
});

describe("오늘 받음 판정", () => {
  const item = (received_on: string, id = CARD.id): CardReceiptItem => ({
    card: { ...CARD, id },
    received_on,
    shared_at: null,
  });

  it("비로그인: 이 기기의 오늘 기록이 같은 카드일 때만", () => {
    expect(isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: { date: TODAY, cardId: CARD.id } })).toBe(
      true,
    );
    expect(isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: { date: TODAY, cardId: "other" } })).toBe(
      false,
    );
    expect(isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: null })).toBe(false);
  });

  it("로그인: 서버 receipt 가 오늘 날짜일 때 — 회전으로 예전에 받은 카드가 다시 온 날은 아직 안 받음", () => {
    expect(isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: null, serverItems: [item(TODAY)] })).toBe(
      true,
    );
    expect(
      isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: null, serverItems: [item("2026-01-01")] }),
    ).toBe(false);
    expect(
      isReceivedToday({ today: TODAY, cardId: CARD.id, localReceipt: null, serverItems: [item(TODAY, "x")] }),
    ).toBe(false);
  });

  it("기기 기록은 KST 날짜 키 — 지난 날짜는 읽을 때 지운다", () => {
    writeLocalReceipt({ date: "2026-01-01", cardId: CARD.id });
    expect(readLocalReceipt(TODAY)).toBeNull();
    expect(window.localStorage.getItem("hoondok:card:received")).toBeNull();
    writeLocalReceipt({ date: TODAY, cardId: CARD.id }, "user-1");
    expect(readLocalReceipt(TODAY, "user-1")).toEqual({ date: TODAY, cardId: CARD.id });
    expect(readLocalReceipt(TODAY)).toBeNull();
  });
});

// ---------- 화면 ----------
const push = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("받기·읽기 화면 (SCR-PWA-023)", () => {
  beforeEach(() => {
    push.mockReset();
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/hoondok/bookmark" }));
    // 비로그인
    fetchMock.mockImplementation(async () => json({ detail: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("오늘 처음이면 받은 기록을 남기고 읽기로 넘어간다 → 책에 다시 꽂기는 원문(밑줄)으로", async () => {
    const { BookmarkScreen } = await import("@/features/hoondok/cards/components/bookmark-screen");
    render(wrap(<BookmarkScreen card={CARD} today={TODAY} />));
    const reinsert = await screen.findByRole("button", { name: /책에 다시 꽂기/ });
    await waitFor(() => expect(reinsert).toBeEnabled());
    expect(readLocalReceipt(TODAY)).toEqual({ date: TODAY, cardId: CARD.id });
    expect(screen.getByText(CARD.text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "나의 책갈피" })).toHaveAttribute("href", "/hoondok/bookmarks");
    fireEvent.click(reinsert);
    await waitFor(() => expect(push).toHaveBeenCalledWith(cardWordsHref(CARD)));
  });

  it("오늘 이미 받았으면 받는 순간 무대를 그리지 않는다", async () => {
    writeLocalReceipt({ date: TODAY, cardId: CARD.id });
    const { BookmarkScreen } = await import("@/features/hoondok/cards/components/bookmark-screen");
    const { container } = render(wrap(<BookmarkScreen card={CARD} today={TODAY} />));
    await waitFor(() => expect(container.querySelector(".bmk--read")).not.toBeNull());
    expect(container.querySelector(".bmk-moment")).toHaveAttribute("hidden");
  });

  it("홈 카드: 받기 전엔 책 이름과 꺼내기, 받은 뒤엔 다시 보기", async () => {
    const { BookmarkHomeCard } = await import("@/features/hoondok/cards/components/home-card");
    const { unmount } = render(wrap(<BookmarkHomeCard card={CARD} dateLabel="9월 28일 월요일" />));
    expect(screen.getByText("천성경 제1편")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "책갈피 꺼내기" })).toHaveAttribute("href", "/hoondok/bookmark");
    unmount();
    writeLocalReceipt({ date: TODAY, cardId: CARD.id });
    render(wrap(<BookmarkHomeCard card={CARD} dateLabel="9월 28일 월요일" />));
    expect(await screen.findByRole("link", { name: "책갈피 다시 보기" })).toBeInTheDocument();
  });
});

describe("플래그 · 화면 레지스트리", () => {
  it("OFF 면 나의 책갈피·받은 사람 화면은 404, 받기 화면은 홈으로", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "");
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    const redirect = vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    });
    vi.doMock("next/navigation", () => ({ notFound, redirect, useRouter: () => ({ push }) }));
    const bookmarks = await import("../app/(hoondok)/hoondok/bookmarks/page");
    await expect(bookmarks.default({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    const recipient = await import("../app/(hoondok)/hoondok/c/[id]/page");
    await expect(recipient.default({ params: Promise.resolve({ id: CARD.id }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const bookmark = await import("../app/(hoondok)/hoondok/bookmark/page");
    await expect(bookmark.default({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/hoondok");
  });

  it("OFF 면 이미지 라우트도 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "");
    const { GET } = await import("../app/(hoondok)/hoondok/c/[id]/image/route");
    const response = await GET(new Request("http://x/hoondok/c/1/image?f=link"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("나의 책갈피는 나의 정원 탭 · 받은 사람 화면은 뒤로 링크 없음", async () => {
    const { screenFor } = await import("@/features/hoondok/screens");
    expect(screenFor("/hoondok/bookmarks")).toMatchObject({
      title: "나의 책갈피",
      tabId: "garden",
      backHref: "/hoondok/garden",
    });
    expect(screenFor("/hoondok/bookmark")).toMatchObject({
      title: "오늘의 책갈피",
      tabId: "today",
      backHref: "/hoondok",
    });
    const recipient = screenFor(`/hoondok/c/${CARD.id}`);
    expect(recipient).toMatchObject({ title: "오늘의 책갈피", tabId: "today" });
    expect(recipient.backHref).toBeUndefined();
  });
});
