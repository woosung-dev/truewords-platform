import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CardPublic } from "@truewords/api-client-ts/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 맞춤 말씀 앱 안 화면 — 홈 책갈피 까닭 줄 · 받기 화면 카드 · 관심사와 마음 바꾸기 · 마음 한 장.
const cards = vi.hoisted(() => ({ list: vi.fn(), today: vi.fn(), mine: vi.fn(), receive: vi.fn(), shared: vi.fn() }));
vi.mock("@/features/hoondok/cards/api", () => ({ cardsAPI: cards }));
vi.mock("@/features/identity/use-current-user", () => ({
  CURRENT_USER_KEY: ["hoondok", "me"],
  useCurrentUser: () => ({ user: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));
// 받기 화면은 모션·FLIP 을 쓰므로 어떤 카드로 열렸는지만 본다
const bookmarkScreen = vi.hoisted(() => vi.fn());
vi.mock("@/features/hoondok/cards/components/bookmark-screen", () => ({
  BookmarkScreen: (props: { card: CardPublic }) => {
    bookmarkScreen(props.card.id);
    return <p>받기 화면 {props.card.id}</p>;
  },
}));

import { PersonalBookmarkHome } from "@/features/hoondok/personal/components/home-bookmark";
import { InterestsScreen } from "@/features/hoondok/personal/components/interests-screen";
import { PersonalBookmarkScreen } from "@/features/hoondok/personal/components/personal-bookmark-screen";
import { PrayScreen } from "@/features/hoondok/personal/components/pray-screen";
import { FALLBACK_REASON, homeReason, scoreCard } from "@/features/hoondok/personal/pick";
import { ANSWERS_KEY, NOTE_KEY } from "@/features/hoondok/personal/storage";
import { formatKstDate } from "@/features/hoondok/today";

const FAMILY_CARD: CardPublic = {
  id: "00000000-0000-4000-8000-0000000c0002",
  text: "역사는 남성과 여성을 접촉시켜 나왔습니다.",
  volume: "천성경 제3편",
  chunk_id: "chunk-10",
  chunk_index: 9,
  work_title: "천성경",
  source_label: "천성경 제3편 1장 10",
  topic: "부부, 가정",
};
const COMFORT_CARD: CardPublic = {
  ...FAMILY_CARD,
  id: "00000000-0000-4000-8000-0000000c0003",
  volume: "천성경 제5편",
  source_label: "천성경 제5편 2장 4",
  topic: "위로, 고난·인내",
};
const TODAY_CARD: CardPublic = {
  ...FAMILY_CARD,
  id: "today-card",
  volume: "천성경 제1편",
  topic: "사랑",
  source_label: "천성경 제1편 3장 2",
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function storeAnswers(value: Record<string, unknown>) {
  localStorage.setItem(
    ANSWERS_KEY,
    JSON.stringify({ interests: [], moods: [], crisisOn: null, readingTime: null, readingLength: null, ...value }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "1");
  cards.list.mockResolvedValue({ items: [FAMILY_CARD, COMFORT_CARD, TODAY_CARD] });
  cards.today.mockResolvedValue({ date: "2026-10-23", card: TODAY_CARD });
  window.scrollTo = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("홈 책갈피 까닭 한 줄", () => {
  it("homeReason: 겹친 이름을 두 개까지 인용하고, 위기 선택지는 이름으로 들추지 않는다", () => {
    const both = scoreCard(FAMILY_CARD, { interests: ["family", "blessing", "prayer"], moods: [] });
    expect(homeReason(both)).toBe("‘가정과 부부’와 ‘축복과 결혼 준비’를 고르셔서 꽂아 둔 장이에요");
    const crisisOnly = scoreCard(COMFORT_CARD, { interests: [], moods: [], isCrisis: true });
    expect(homeReason(crisisOnly)).toBe("고르신 마음에 맞춰 꽂아 둔 장이에요");
    expect(homeReason(null)).toBe(FALLBACK_REASON);
    for (const text of [homeReason(both), homeReason(crisisOnly)]) expect(text).not.toMatch(/[—–!]|많이 힘들어요/);
  });

  it("답이 없으면 오늘 편성 카드 그대로에 '고르기' 줄이 질문 흐름으로 이어지고, 카드 목록을 받지 않는다", () => {
    wrap(<PersonalBookmarkHome todayCard={TODAY_CARD} dateLabel="10월 23일" />);
    expect(screen.getByText("천성경 제1편")).toBeInTheDocument();
    expect(screen.getByText("관심 주제를 고르면 맞춘 장이 꽂혀요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관심 주제 고르기" })).toHaveAttribute("href", "/hoondok/start");
    expect(cards.list).not.toHaveBeenCalled();
  });

  it("답이 있으면 맞춘 카드로 바뀌고 까닭 줄과 '바꾸기'(관심사 화면)가 붙는다", async () => {
    storeAnswers({ interests: ["family"], moods: ["tired"] });
    wrap(<PersonalBookmarkHome todayCard={TODAY_CARD} dateLabel="10월 23일" />);
    // 마음 일치 2점(위로 카드)이 주제 일치 1점(가정 카드)보다 앞선다
    expect(await screen.findByText("천성경 제5편")).toBeInTheDocument();
    expect(screen.getByText("‘지쳤어요’")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관심사와 마음 바꾸기" })).toHaveAttribute(
      "href",
      "/hoondok/garden/interests",
    );
    // 선택값은 요청에 실리지 않는다(쿼리 없는 목록 하나)
    expect(cards.list).toHaveBeenCalledWith();
  });

  it("겹치는 카드가 없으면 오늘 편성 카드와 준비 중 문장으로 돌아간다", async () => {
    storeAnswers({ interests: ["principle"] });
    wrap(<PersonalBookmarkHome todayCard={TODAY_CARD} dateLabel="10월 23일" />);
    expect(await screen.findByText(FALLBACK_REASON)).toBeInTheDocument();
    expect(screen.getByText("천성경 제1편")).toBeInTheDocument();
  });
});

describe("받기 화면은 홈과 같은 카드를 받는다", () => {
  it("답이 있으면 고르기가 끝난 뒤 맞춘 카드로만 열린다(오늘 카드로 먼저 열지 않는다)", async () => {
    storeAnswers({ moods: ["tired"] });
    wrap(<PersonalBookmarkScreen todayCard={TODAY_CARD} today="2026-10-23" empty={<p>빈 상태</p>} />);
    expect(await screen.findByText(`받기 화면 ${COMFORT_CARD.id}`)).toBeInTheDocument();
    expect(bookmarkScreen).not.toHaveBeenCalledWith(TODAY_CARD.id);
  });

  it("답이 없고 오늘 카드도 없으면 빈 상태다", () => {
    wrap(<PersonalBookmarkScreen todayCard={null} today="2026-10-23" empty={<p>빈 상태</p>} />);
    expect(screen.getByText("빈 상태")).toBeInTheDocument();
  });
});

describe("관심사와 마음 바꾸기", () => {
  it("'많이 힘들어요' 칩이 없고, 마음은 두 개까지만 켜진다", () => {
    wrap(<InterestsScreen />);
    expect(screen.queryByRole("button", { name: /많이 힘들어요/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "지쳤어요" }));
    fireEvent.click(screen.getByRole("button", { name: "감사해요" }));
    const third = screen.getByRole("button", { name: "외로워요" });
    expect(third).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(third);
    expect(third).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/두 개까지 고를 수 있어요/)).toBeInTheDocument();
  });

  it("저장은 바뀐 것이 있을 때만 되고, 이 기기에만 쓰며 오늘 켜진 위기 표시는 그대로 둔다", () => {
    const today = formatKstDate().iso;
    storeAnswers({ interests: ["family"], crisisOn: today });
    wrap(<InterestsScreen />);
    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    expect(screen.getByText("고른 답은 이 기기에만 저장돼요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기도와 정성" }));
    expect(screen.getByRole("status")).toHaveTextContent("바뀐 내용이 있어요");
    fireEvent.click(save);
    const stored = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}");
    expect(stored.interests).toEqual(["family", "prayer"]);
    expect(stored.crisisOn).toBe(today);
    expect(screen.getByRole("status")).toHaveTextContent("저장했어요");
  });

  it("모두 지우기는 확인 카드를 거쳐 저장값을 지운다", () => {
    storeAnswers({ interests: ["family"], moods: ["tired"] });
    wrap(<InterestsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "모두 지우기" }));
    const confirm = screen.getByRole("group", { name: "고른 답 모두 지우기 확인" });
    expect(within(confirm).getByRole("button", { name: "취소" })).toHaveFocus();
    fireEvent.click(within(confirm).getByRole("button", { name: "지우기" }));
    expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "가정과 부부" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("마음 한 장", () => {
  it("마음 하나 → 맞춘 말씀 → 한 줄(기기에만) → 건네기 → 마침, 단계마다 새 제목으로 포커스", async () => {
    wrap(<PrayScreen />);
    expect(screen.getByRole("button", { name: "말씀 받기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "지쳤어요" }));
    expect(screen.getByRole("radio", { name: "지쳤어요" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "말씀 받기" }));
    expect(screen.getByRole("heading", { level: 2, name: "지금 마음에 맞춘 말씀이에요" })).toHaveFocus();
    expect(await screen.findByText(COMFORT_CARD.source_label)).toBeInTheDocument();
    expect(screen.getByText("앱이 고른 원문 단락이에요. 공식 해설이나 지금 하신 말씀은 아니에요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 줄 적기" }));
    fireEvent.change(screen.getByLabelText("내 메모"), { target: { value: "  먼저 고맙다고 말하기  " } });
    expect(screen.getByText("적은 한 줄은 이 기기에만 남아요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    const note = JSON.parse(localStorage.getItem(NOTE_KEY) ?? "{}");
    expect(note).toMatchObject({ cardId: COMFORT_CARD.id, text: "먼저 고맙다고 말하기" });

    expect(screen.getByRole("heading", { level: 2, name: "이 말씀을 건넬까요?" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "건네지 않고 마치기" }));
    expect(screen.getByRole("heading", { level: 2, name: "오늘 마음 한 장을 마쳤어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 훈독으로" })).toHaveAttribute("href", "/hoondok");
    // 마음 한 장의 마음은 저장된 답을 바꾸지 않는다
    expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
  });

  it("'많이 힘들어요'를 고르면 상담 안내가 바로 보이고, 말씀 화면에서도 까닭·말씀보다 먼저다", async () => {
    wrap(<PrayScreen />);
    fireEvent.click(screen.getByRole("radio", { name: "많이 힘들어요" }));
    expect(screen.getByRole("region", { name: "혼자 견디지 않으셔도 돼요" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "말씀 받기" }));
    await screen.findByText(COMFORT_CARD.source_label);
    const crisis = screen.getByRole("region", { name: "혼자 견디지 않으셔도 돼요" });
    expect(within(crisis).getByRole("link", { name: /109/ })).toHaveAttribute("href", "tel:109");
    expect(within(crisis).getByRole("link", { name: /1577-0199/ })).toHaveAttribute("href", "tel:15770199");
    const card = screen.getByRole("article");
    expect(crisis.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/‘많이 힘들어요’/)).not.toBeInTheDocument();
  });
});
