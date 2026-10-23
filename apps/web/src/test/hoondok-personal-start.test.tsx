import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { CardPublic } from "@truewords/api-client-ts/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 맞춤 첫 말씀 질문 흐름 (/hoondok/start) — 단계 이동·포커스·두 개 제한·위기 안내·기기 저장·첫 말씀 상태.
const cards = vi.hoisted(() => ({ list: vi.fn(), today: vi.fn() }));
vi.mock("@/features/hoondok/cards/api", () => ({ cardsAPI: { list: cards.list, today: cards.today } }));
const currentUser = vi.hoisted(() => ({ value: { user: null as { display_name: string } | null } }));
vi.mock("@/features/identity/use-current-user", () => ({
  CURRENT_USER_KEY: ["hoondok", "me"],
  useCurrentUser: () => ({ ...currentUser.value, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { StartFlow } from "@/features/hoondok/personal/components/start-flow";
import { afterSignupHref, START_PATH } from "@/features/hoondok/personal/start";
import { ANSWERS_KEY } from "@/features/hoondok/personal/storage";

const FAMILY_CARD: CardPublic = {
  id: "00000000-0000-4000-8000-0000000c0002",
  text: "역사는 남성과 여성을 접촉시켜 나왔습니다.",
  volume: "천성경 제1편",
  chunk_id: "chunk-10",
  chunk_index: 9,
  work_title: "천성경",
  source_label: "천성경 제1편 3장 10",
  topic: "부부, 가정",
};
const TODAY_CARD: CardPublic = { ...FAMILY_CARD, id: "today-card", topic: "사랑", source_label: "천성경 제1편 3장 2" };

function renderFlow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StartFlow />
    </QueryClientProvider>,
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

beforeEach(() => {
  localStorage.clear();
  currentUser.value = { user: { display_name: "은혜" } };
  cards.list.mockResolvedValue({ items: [FAMILY_CARD, TODAY_CARD] });
  cards.today.mockResolvedValue({ date: "2026-10-23", card: TODAY_CARD });
  window.scrollTo = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("맞춤 첫 말씀 질문 흐름", () => {
  it("환영 → 질문 1: 새 제목으로 포커스가 옮겨 가고 문서 제목이 바뀐다", () => {
    renderFlow();
    expect(screen.getByRole("heading", { level: 2, name: "먼저 세 가지만 여쭐게요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "질문 없이 시작하기" })).toHaveAttribute("href", "/hoondok");
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    const title = screen.getByRole("heading", { level: 2, name: "어떤 말씀을 자주 펼치고 싶으세요?" });
    expect(title).toHaveFocus();
    expect(document.title).toBe("질문 1 / 3 · 훈독");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "질문 3개 중 1번째");
  });

  it("질문 1은 하나 이상 골라야 넘어가고, 행이 checkbox 로 상태를 말한다", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.getByText("하나 이상 고르면 넘어갈 수 있어요")).toBeInTheDocument();
    const row = screen.getByRole("checkbox", { name: /가정과 부부/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1개 골랐어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  it("질문 2: 두 개를 고르면 나머지가 꺼지고, '많이 힘들어요'는 제한 밖이며 위기 안내를 바로 아래 펼친다", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /가정과 부부/ }));
    next();
    fireEvent.click(screen.getByRole("checkbox", { name: "지쳤어요" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "고민이 있어요" }));
    const thankful = screen.getByRole("checkbox", { name: "감사해요" });
    expect(thankful).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(thankful);
    expect(thankful).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("두 개까지 고를 수 있어요")).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "혼자 견디지 않으셔도 돼요" })).not.toBeInTheDocument();
    const hard = screen.getByRole("checkbox", { name: "많이 힘들어요" });
    expect(hard).not.toHaveAttribute("aria-disabled");
    fireEvent.click(hard);
    expect(hard).toHaveAttribute("aria-checked", "true");
    const notice = screen.getByRole("region", { name: "혼자 견디지 않으셔도 돼요" });
    expect(within(notice).getByRole("link", { name: /자살예방상담 109/ })).toHaveAttribute("href", "tel:109");
    expect(within(notice).getByRole("link", { name: /정신건강위기상담 1577-0199/ })).toHaveAttribute(
      "href",
      "tel:15770199",
    );
  });

  it("질문 3 → 첫 말씀: 답을 이 기기에만 저장하고, 겹치는 실제 카드와 이름 제목·까닭·공식성 안내를 보인다", async () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /가정과 부부/ }));
    next();
    next();
    const dawn = screen.getByRole("radio", { name: /새벽 기도 뒤/ });
    fireEvent.click(dawn);
    expect(dawn).toHaveAttribute("aria-checked", "true");
    // 화살표로 옮기면 그 행을 고른다
    fireEvent.keyDown(dawn, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: /아침 출근길/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "첫 말씀 보기" }));

    const stored = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}");
    expect(stored).toMatchObject({ interests: ["family"], moods: [], readingTime: "commute", crisisOn: null });

    expect(await screen.findByText(FAMILY_CARD.text)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "은혜님을 위해 고른 첫 말씀" })).toHaveFocus();
    expect(screen.getByText(/고르셔서 그 주제와 겹치는 단락을 먼저 골랐어요/)).toBeInTheDocument();
    expect(screen.getByText("앱이 고른 원문 단락이에요. 공식 해설이나 지금 하신 말씀은 아니에요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이 단락 읽기" }).getAttribute("href")).toContain(`card=${FAMILY_CARD.id}`);
    expect(screen.getByRole("link", { name: "오늘 훈독으로" })).toHaveAttribute("href", "/hoondok");
    // 예시 구절·등급 배지를 만들지 않는다
    expect(screen.queryByText(/예시 구절|공식 원문/)).not.toBeInTheDocument();
    // 선택값을 주소·요청에 싣지 않는다 — 목록 API 는 인자 없이 부른다
    expect(cards.list).toHaveBeenCalledWith();
  });

  it("겹치는 장이 없으면 오늘 편성 카드로 돌아가고 '고른' 말씀이라 부르지 않는다", async () => {
    currentUser.value = { user: null };
    cards.list.mockResolvedValue({ items: [TODAY_CARD] });
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /평화와 통일/ }));
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(await screen.findByText(TODAY_CARD.text)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "오늘 말씀부터 드릴게요" })).toBeInTheDocument();
    expect(
      screen.getByText("고르신 주제에 맞는 장을 아직 준비하고 있어요. 오늘 편성된 말씀을 먼저 드려요"),
    ).toBeInTheDocument();
  });

  it("카드를 못 받으면 고른 답을 지키고 다시 받기를 준다. 위기 표시는 결과 맨 위에도 같은 블록이다", async () => {
    // 목록 훅은 한 번 다시 시도한다(retry 1) — 두 번 모두 실패시킨다
    cards.list.mockRejectedValue(new Error("offline"));
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /가정과 부부/ }));
    next();
    fireEvent.click(screen.getByRole("checkbox", { name: "많이 힘들어요" }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "첫 말씀 보기" }));
    // 재시도 대기(1초) 뒤 오류 상태다
    expect(await screen.findByText("말씀을 받지 못했어요", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "혼자 견디지 않으셔도 돼요" })).toBeInTheDocument();
    // 위기 선택지는 마음 목록이 아니라 오늘 날짜 표시로만 남는다
    const stored = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}");
    expect(stored.moods).toEqual([]);
    expect(typeof stored.crisisOn).toBe("string");

    cards.list.mockResolvedValue({ items: [FAMILY_CARD, TODAY_CARD] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
    });
    expect(await screen.findByText(FAMILY_CARD.text)).toBeInTheDocument();
  });

  it("답 바꾸기는 질문 1로 돌아가고 고른 답이 남아 있다", async () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /자녀와 부모/ }));
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "첫 말씀 보기" }));
    await screen.findByText(TODAY_CARD.text);
    fireEvent.click(screen.getAllByRole("button", { name: "답 바꾸기" })[0]);
    expect(screen.getByRole("checkbox", { name: /자녀와 부모/ })).toHaveAttribute("aria-checked", "true");
  });
});

describe("첫 말씀 제목", () => {
  it("이름이 없으면 대체 호칭 없이 '오늘의 첫 말씀' 이다", async () => {
    currentUser.value = { user: null };
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /가정과 부부/ }));
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "첫 말씀 보기" }));
    expect(await screen.findByRole("heading", { level: 2, name: "오늘의 첫 말씀" })).toBeInTheDocument();
  });
});

describe("가입 직후 이동", () => {
  it("돌아갈 곳이 기본값(홈)이고 책갈피가 켜진 빌드일 때만 질문 흐름으로 보낸다", () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "1");
    expect(afterSignupHref("/hoondok")).toBe(START_PATH);
    expect(afterSignupHref("/hoondok/groups/join?code=7K2MQ9XD")).toBe("/hoondok/groups/join?code=7K2MQ9XD");
    expect(afterSignupHref("/hoondok/read")).toBe("/hoondok/read");
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_CARDS", "0");
    expect(afterSignupHref("/hoondok")).toBe("/hoondok");
  });
});
