import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPublic, CardReceiptItem } from "@/features/hoondok/cards/api";
import { bookName, bookParts } from "@/features/hoondok/cards/components/book";
import { markParagraphs } from "@/features/hoondok/cards/components/words-card";
import {
  bookColorIndex,
  defaultBackground,
  parseCollageQuery,
  parseImageQuery,
  sourceText,
  toLook,
} from "@/features/hoondok/cards/look";
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
import { collageQuoteSize, collageRows } from "@/features/hoondok/cards/og/card-image";
import {
  cardCopyText,
  cardImagePath,
  cardWordsHref,
  collageImagePath,
  photoCardImagePath,
  shareCard,
  shareImageFile,
} from "@/features/hoondok/cards/share";
import {
  isReceivedToday,
  readCardLook,
  readLocalReceipt,
  writeCardLook,
  writeLocalReceipt,
} from "@/features/hoondok/cards/storage";
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
    expect(cardCopyText(CARD, link)).toBe(`“${CARD.text}”\n천성경 제1편 하나님 p.42 · 훈독\n${link}`);
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
    expect(cardWordsHref(CARD)).toBe(`/words/${encodeURIComponent("천성경 제1편")}?chunk_id=chunk-42&card=${CARD.id}`);
  });
});

describe("사진 카드 이미지 쿼리 (허용 목록)", () => {
  const q = (query: string) => parseImageQuery(new URLSearchParams(query));

  it("쿼리 없는 주소와 예전 형식은 그대로 — OG·보낸 링크 호환", () => {
    expect(q("")).toEqual({ format: "link" });
    expect(q("f=link&bg=lake")).toEqual({ format: "link" });
    expect(q("f=square&src=book")).toEqual({ format: "square" });
    expect(q("f=story")).toEqual({ format: "story", bg: "field", src: "full" });
  });

  it("feed·story 는 bg·src 를 목록 안에서만 받고, 모르는 값은 기본값", () => {
    expect(q("f=feed&bg=orchard&src=book")).toEqual({ format: "feed", bg: "orchard", src: "book" });
    expect(q("f=feed&bg=book")).toEqual({ format: "feed", bg: "book", src: "full" });
    expect(q("f=feed&bg=../../etc&src=none")).toEqual({ format: "feed", bg: "field", src: "full" });
    expect(q("f=gif")).toEqual({ format: "link" });
  });

  it("출처: 자세히는 source_label, 책 이름만은 편·권까지의 책 이름. 빼기는 없다", () => {
    expect(sourceText(CARD, "full")).toBe("천성경 제1편 하나님 p.42");
    expect(sourceText(CARD, "book")).toBe("천성경 제1편");
  });

  it("기기에 저장된 모양은 하나라도 목록 밖이면 버린다", () => {
    expect(toLook({ format: "story", bg: "lake", src: "book" })).toEqual({ format: "story", bg: "lake", src: "book" });
    expect(toLook({ format: "story", bg: "lake", src: "none" })).toBeNull();
    expect(toLook("feed")).toBeNull();
  });

  it("같은 책은 늘 같은 색, 같은 카드는 늘 같은 기본 사진", () => {
    expect(bookColorIndex("천성경")).toBe(bookColorIndex(" 천성경 "));
    expect(bookColorIndex("천성경")).toBeGreaterThanOrEqual(1);
    expect(bookColorIndex("천성경")).toBeLessThanOrEqual(6);
    expect(defaultBackground(CARD.id)).toBe(defaultBackground(CARD.id));
  });
});

describe("이번 달 모은 말씀 콜라주", () => {
  const ids = ["a", "b", "c", "d", "e"].map((c) => `${c.repeat(8)}-1111-4111-8111-111111111111`);

  it("ids 는 UUID 꼴만, 겹치면 하나로, 4장까지", () => {
    const parsed = parseCollageQuery(
      new URLSearchParams(`ids=${[ids[0], ids[0].toUpperCase(), "x", ...ids.slice(1)].join(",")}`),
    );
    expect(parsed.ids).toEqual(ids.slice(0, 4));
    expect(parsed).toMatchObject({ theme: "paper", format: "feed" });
    expect(parseCollageQuery(new URLSearchParams("ids=../x&theme=red&f=link"))).toEqual({
      ids: [],
      theme: "paper",
      format: "feed",
    });
    expect(parseCollageQuery(new URLSearchParams(`ids=${ids[1]}&theme=night&f=story`))).toMatchObject({
      theme: "night",
      format: "story",
    });
  });

  it("배치: 피드는 2열(3장이면 첫 장 한 줄), 스토리는 한 줄에 한 장", () => {
    expect(collageRows(1, "feed")).toEqual([1]);
    expect(collageRows(3, "feed")).toEqual([1, 2]);
    expect(collageRows(4, "feed")).toEqual([2, 2]);
    expect(collageRows(4, "story")).toEqual([1, 1, 1, 1]);
  });

  it("긴 말씀은 줄이지 않고 글자를 줄인다 (22~52px)", () => {
    const box = { width: 400, height: 380 };
    expect(collageQuoteSize("짧은 말씀", box)).toBe(52);
    expect(collageQuoteSize("가".repeat(400), box)).toBe(22);
  });

  it("ids 가 없으면 400, 플래그 OFF 면 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "1");
    const { GET } = await import("../app/(hoondok)/c/collage/image/route");
    expect((await GET(new Request("http://x/c/collage/image?ids=nope"))).status).toBe(400);
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "");
    expect((await GET(new Request(`http://x/c/collage/image?ids=${ids[0]}`))).status).toBe(404);
  });
});

describe("사진 카드 주소 · 이미지 파일 공유", () => {
  it("예전 link·square 주소는 그대로, 사진 카드는 f·bg·src 를 모두 싣는다", () => {
    expect(cardImagePath(CARD.id, "link")).toBe(`/c/${CARD.id}/image?f=link`);
    expect(photoCardImagePath(CARD.id, { format: "story", bg: "lake", src: "book" })).toBe(
      `/c/${CARD.id}/image?f=story&bg=lake&src=book`,
    );
    expect(collageImagePath(["a", "b"], "night", "feed")).toBe("/c/collage/image?ids=a,b&theme=night&f=feed");
  });

  it("콜라주는 파일만 건넨다 — 파일 공유가 안 되면 링크·클립보드로 내려가지 않고 none", async () => {
    const file = new File(["png"], "c.png", { type: "image/png" });
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareImageFile({ file, title: "t", nav: { share, canShare: () => true } })).toBe("file");
    expect(share).toHaveBeenCalledWith({ title: "t", files: [file] });
    expect(await shareImageFile({ file, title: "t", nav: { share, canShare: () => false } })).toBe("none");
    expect(await shareImageFile({ file: null, title: "t", nav: { share, canShare: () => true } })).toBe("none");
    const closed = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    expect(await shareImageFile({ file, title: "t", nav: { share: closed, canShare: () => true } })).toBe("cancelled");
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
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/bookmark" }));
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
    expect(screen.getByRole("link", { name: "나의 책갈피" })).toHaveAttribute("href", "/bookmarks");
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
    expect(await screen.findByRole("link", { name: "책갈피 꺼내기" })).toHaveAttribute("href", "/bookmark");
    unmount();
    writeLocalReceipt({ date: TODAY, cardId: CARD.id });
    render(wrap(<BookmarkHomeCard card={CARD} dateLabel="9월 28일 월요일" />));
    expect(await screen.findByRole("link", { name: "책갈피 다시 보기" })).toBeInTheDocument();
    // 비로그인에게는 타일이 없다
    expect(screen.queryByRole("link", { name: /내 카드 갤러리/ })).toBeNull();
  });

  it("홈 타일: 로그인하면 나의 책갈피·내 카드 갤러리 장수(서버 값)를 보인다", async () => {
    const item = { card: CARD, received_on: TODAY, shared_at: null };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/hoondok/auth/me")) return json({ user: { id: "u1", email: "a@b.c", display_name: "효진" } });
      if (url.includes("filter=shared")) return json({ items: [], shelves: [] });
      if (url.includes("/hoondok/me/cards"))
        return json({ items: [item], shelves: [{ work_title: "천성경", count: 1 }] });
      return json({ detail: "not found" }, 404);
    });
    const { BookmarkHomeCard } = await import("@/features/hoondok/cards/components/home-card");
    render(wrap(<BookmarkHomeCard card={CARD} dateLabel="9월 28일 월요일" />));
    expect(await screen.findByRole("link", { name: /나의 책갈피\s*1장/ })).toHaveAttribute("href", "/bookmarks");
    expect(await screen.findByRole("link", { name: /내 카드 갤러리\s*건넨 카드 0장/ })).toHaveAttribute(
      "href",
      "/bookmarks?filter=shared",
    );
  });
});

describe("사진 카드로 건네기 시트 (SCR-PWA-024)", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => json({ detail: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("고른 크기·바탕·출처가 미리보기와 사진 저장 주소에 그대로 실린다", async () => {
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    const onDone = vi.fn();
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={onDone} />));
    const preview = screen.getByRole("img", { name: /건넬 사진 카드/ });
    expect(preview.getAttribute("src")).toMatch(/f=feed&bg=\w+&src=full$/);
    fireEvent.click(screen.getByRole("radio", { name: "9:16 스토리" }));
    fireEvent.click(screen.getByRole("radio", { name: "책 색" }));
    fireEvent.click(screen.getByRole("radio", { name: "책 이름만" }));
    const url = `/c/${CARD.id}/image?f=story&bg=book&src=book`;
    expect(screen.getByRole("img", { name: /건넬 사진 카드/ })).toHaveAttribute("src", url);
    expect(screen.getByRole("link", { name: "사진 저장" })).toHaveAttribute("href", url);
    expect(screen.getByRole("radio", { name: "책 색" })).toHaveAttribute("aria-checked", "true");
    // 빼기는 없다
    expect(screen.queryByRole("radio", { name: "빼기" })).toBeNull();
    expect(screen.getByText("출처와 훈독 표시는 카드에 늘 함께 가요")).toBeInTheDocument();
  });

  it("글로 복사하면 고른 모양을 이 카드에 남기고, 다음에 같은 모양으로 연다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    const onDone = vi.fn();
    const { unmount } = render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={onDone} />));
    fireEvent.click(screen.getByRole("radio", { name: "호수" }));
    fireEvent.click(screen.getByRole("button", { name: "글로 복사" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("copied"));
    expect(readCardLook(CARD.id)).toEqual({ format: "feed", bg: "lake", src: "full" });
    unmount();
    writeCardLook(CARD.id, { format: "story", bg: "orchard", src: "book" });
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={onDone} />));
    expect(screen.getByRole("img", { name: /건넬 사진 카드/ })).toHaveAttribute(
      "src",
      `/c/${CARD.id}/image?f=story&bg=orchard&src=book`,
    );
  });

  it("미리보기를 못 불러오면 다시 시도를 보인다", async () => {
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={() => {}} />));
    fireEvent.error(screen.getByRole("img", { name: /건넬 사진 카드/ }));
    expect(await screen.findByText("미리보기를 불러오지 못했어요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.getByRole("img", { name: /건넬 사진 카드/ })).toBeInTheDocument();
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
    const bookmarks = await import("../app/(hoondok)/bookmarks/page");
    await expect(bookmarks.default({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    const recipient = await import("../app/(hoondok)/c/[id]/page");
    await expect(recipient.default({ params: Promise.resolve({ id: CARD.id }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const bookmark = await import("../app/(hoondok)/bookmark/page");
    await expect(bookmark.default({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("OFF 면 이미지 라우트도 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "");
    const { GET } = await import("../app/(hoondok)/c/[id]/image/route");
    const response = await GET(new Request("http://x/hoondok/c/1/image?f=link"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("나의 책갈피는 나의 정원 탭 · 받은 사람 화면은 뒤로 링크 없음", async () => {
    const { screenFor } = await import("@/features/hoondok/screens");
    expect(screenFor("/bookmarks")).toMatchObject({
      title: "나의 책갈피",
      tabId: "garden",
      backHref: "/garden",
    });
    expect(screenFor("/bookmark")).toMatchObject({
      title: "오늘의 책갈피",
      tabId: "today",
      backHref: "/",
    });
    const recipient = screenFor(`/c/${CARD.id}`);
    expect(recipient).toMatchObject({ title: "오늘의 책갈피", tabId: "today" });
    expect(recipient.backHref).toBeUndefined();
  });
});
