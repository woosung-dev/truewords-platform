import type { CardPublic } from "@truewords/api-client-ts/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRISIS_MOOD_ID,
  countLimitedMoods,
  INTEREST_OPTIONS,
  MOOD_OPTIONS,
  toggleMood,
} from "@/features/hoondok/personal/options";
import {
  buildReason,
  cardTags,
  FALLBACK_REASON,
  firstWordTitle,
  pickPersonalCard,
  scoreCard,
  tieHash,
} from "@/features/hoondok/personal/pick";
import {
  ANSWERS_KEY,
  EMPTY_ANSWERS,
  NOTE_KEY,
  NOTE_MAX_LENGTH,
  parseAnswers,
  readAnswers,
  readNote,
  writeAnswers,
  writeNote,
} from "@/features/hoondok/personal/storage";
import { PREVIEW_CARDS } from "@/features/hoondok/preview/fixtures/cards";
import { clearHoondokStorage } from "@/features/identity/use-delete-me";

// 맞춤 첫 말씀 — 기기 안 카드 고르기(점수·동점·0점 폴백)·까닭 문장·기기 저장 내성.
const DAY = "2026-10-23";

function card(n: number, topic: string | null, workTitle = "천성경"): CardPublic {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    text: `본문 ${n}`,
    volume: workTitle,
    chunk_id: `c-${n}`,
    chunk_index: n,
    work_title: workTitle,
    source_label: `${workTitle} ${n}`,
    topic,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("선택지 정의", () => {
  it("관심 주제 12개·마음 9개, id 가 겹치지 않는다", () => {
    expect(INTEREST_OPTIONS).toHaveLength(12);
    expect(MOOD_OPTIONS).toHaveLength(9);
    expect(new Set(INTEREST_OPTIONS.map((o) => o.id)).size).toBe(12);
    expect(new Set(MOOD_OPTIONS.map((o) => o.id)).size).toBe(9);
  });

  it("매핑 태그는 기존 카드 태그 23종 안에서만 쓴다", () => {
    const known = new Set(
      "사랑, 하나님(하늘부모님), 위하는 삶, 자녀·부모, 희망, 가정, 부부, 감사, 자연·만물, 고난·인내, 효정, 위로, 기쁨, 기도, 평화, 참부모님, 믿음, 사명, 양심, 용서, 영계·영원, 겸손, 청년".split(
        ", ",
      ),
    );
    expect(known.size).toBe(23);
    for (const option of [...INTEREST_OPTIONS, ...MOOD_OPTIONS]) {
      for (const tag of option.tags) expect(known.has(tag), `${option.id}:${tag}`).toBe(true);
    }
  });
});

describe("마음 두 개 제한", () => {
  it("위기 아닌 마음은 두 개까지만 켜진다", () => {
    let selected = toggleMood([], "tired");
    selected = toggleMood(selected, "thankful");
    expect(toggleMood(selected, "joy")).toEqual(["tired", "thankful"]);
    expect(toggleMood(selected, "tired")).toEqual(["thankful"]);
  });

  it("'많이 힘들어요'는 두 개를 고른 뒤에도 켜지고 개수에 세지 않는다", () => {
    const selected = toggleMood(["tired", "thankful"], CRISIS_MOOD_ID);
    expect(selected).toEqual(["tired", "thankful", CRISIS_MOOD_ID]);
    expect(countLimitedMoods(selected)).toBe(2);
    // 위기를 먼저 골라도 다른 마음 두 개를 더 고를 수 있다
    expect(toggleMood(toggleMood([CRISIS_MOOD_ID], "joy"), "lonely")).toEqual([CRISIS_MOOD_ID, "joy", "lonely"]);
  });

  it("모르는 id 는 무시한다", () => {
    expect(toggleMood(["tired"], "unknown")).toEqual(["tired"]);
  });
});

describe("카드 점수", () => {
  it("topic 은 쉼표 구분 태그다", () => {
    expect(cardTags(" 사랑, 기도 ,,")).toEqual(["사랑", "기도"]);
    expect(cardTags(null)).toEqual([]);
  });

  it("겹치는 마음은 2점, 겹치는 관심 주제는 1점", () => {
    const scored = scoreCard(card(1, "가정, 위로"), { interests: ["family"], moods: ["tired"] });
    expect(scored.score).toBe(3);
    expect(scored.interests.map((o) => o.id)).toEqual(["family"]);
    expect(scored.moods.map((o) => o.id)).toEqual(["tired"]);
    // 한 선택지의 태그가 여럿 겹쳐도 한 번만 센다
    expect(scoreCard(card(2, "가정, 부부"), { interests: ["family"], moods: [] }).score).toBe(1);
  });

  it("마음 일치가 주제 일치보다 앞선다", () => {
    const cards = [card(1, "가정"), card(2, "감사")];
    const pick = pickPersonalCard(cards, { interests: ["family", "blessing"], moods: ["thankful"] }, DAY);
    expect(pick?.card.id).toBe(cards[1].id);
  });

  it("원리 공부는 태그 대신 work_title 로 겹친다", () => {
    const principle = { interests: ["principle"], moods: [] };
    expect(scoreCard(card(1, "사랑", "원리강론"), principle).score).toBe(1);
    expect(scoreCard(card(2, null, "통일사상요강"), principle).score).toBe(1);
    expect(scoreCard(card(3, "사랑", "천성경"), principle).score).toBe(0);
  });

  it("위기 표시는 '많이 힘들어요' 태그(위로)로 점수에 든다", () => {
    expect(scoreCard(card(1, "위로"), { interests: [], moods: [], isCrisis: true }).score).toBe(2);
  });
});

describe("동점과 폴백", () => {
  const ties = [card(1, "기도"), card(2, "기도"), card(3, "기도"), card(4, "기도")];
  const input = { interests: ["prayer"], moods: [] };

  it("무작위가 없다 — 같은 날·같은 입력이면 순서를 바꿔도 같은 카드", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random 을 쓰면 안 된다");
    });
    const first = pickPersonalCard(ties, input, DAY)?.card.id;
    expect(pickPersonalCard([...ties].reverse(), input, DAY)?.card.id).toBe(first);
    const expected = [...ties].sort((a, b) => tieHash(DAY, a.id) - tieHash(DAY, b.id))[0].id;
    expect(first).toBe(expected);
  });

  it("동점 카드는 날마다 바뀐다", () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const picks = new Set(days.map((d) => pickPersonalCard(ties, input, d)?.card.id));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("더 높은 점수는 해시와 무관하게 이긴다", () => {
    const best = card(9, "기도, 양심");
    expect(pickPersonalCard([...ties, best], { interests: ["prayer", "daily"], moods: ["worry"] }, DAY)?.card.id).toBe(
      best.id,
    );
  });

  it("고른 답이 없거나 모두 0점이면 null(→ 오늘 편성 카드)", () => {
    expect(pickPersonalCard(ties, { interests: [], moods: [] }, DAY)).toBeNull();
    expect(pickPersonalCard(ties, { interests: ["peace"], moods: ["joy"] }, DAY)).toBeNull();
    expect(pickPersonalCard([], input, DAY)).toBeNull();
  });

  it("프리뷰 fixture 로도 맞춤·폴백 두 경우를 모두 볼 수 있다", () => {
    expect(pickPersonalCard(PREVIEW_CARDS, { interests: ["family"], moods: ["tired"] }, DAY)).not.toBeNull();
    expect(pickPersonalCard(PREVIEW_CARDS, { interests: ["principle"], moods: [] }, DAY)).toBeNull();
  });
});

function option<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((o) => o.id === id);
  if (!found) throw new Error(`선택지 없음: ${id}`);
  return found;
}

describe("까닭 문장", () => {
  const family = option(INTEREST_OPTIONS, "family");
  const prayer = option(INTEREST_OPTIONS, "prayer");
  const tired = option(MOOD_OPTIONS, "tired");
  const lonely = option(MOOD_OPTIONS, "lonely");

  it("겹친 이름을 따옴표로 인용하고 조사를 받침에 맞춘다", () => {
    expect(buildReason({ interests: [family], moods: [tired] })).toBe(
      "‘가정과 부부’와 ‘지쳤어요’를 고르셔서 주제와 마음이 함께 겹치는 단락을 먼저 골랐어요.",
    );
    expect(buildReason({ interests: [prayer], moods: [] })).toBe(
      "‘기도와 정성’을 고르셔서 그 주제와 겹치는 단락을 먼저 골랐어요.",
    );
    expect(buildReason({ interests: [], moods: [lonely] })).toBe(
      "‘외로워요’를 고르셔서 그 마음과 겹치는 단락을 먼저 골랐어요.",
    );
  });

  it("세 개까지만 인용한다", () => {
    expect(buildReason({ interests: [family, prayer], moods: [tired, lonely] })).toBe(
      "‘가정과 부부’, ‘지쳤어요’와 ‘외로워요’를 고르셔서 주제와 마음이 함께 겹치는 단락을 먼저 골랐어요.",
    );
  });

  it("'많이 힘들어요'는 이름으로 인용하지 않는다", () => {
    const hard = option(MOOD_OPTIONS, "hard");
    expect(buildReason({ interests: [family], moods: [hard] })).toBe(
      "‘가정과 부부’를 고르셔서 그 주제와 겹치는 단락을 먼저 골랐어요.",
    );
    expect(buildReason({ interests: [], moods: [hard] })).toBe("고르신 마음과 겹치는 단락을 먼저 골랐어요.");
  });

  it("겹친 것이 없으면 폴백 문장", () => {
    expect(buildReason(null)).toBe(FALLBACK_REASON);
    expect(buildReason({ interests: [], moods: [] })).toBe(FALLBACK_REASON);
  });

  it("문구 규칙: 긴 대시·느낌표·금지어 없음", () => {
    const sentences = [
      buildReason({ interests: [family, prayer], moods: [tired] }),
      buildReason({ interests: [prayer], moods: [] }),
      buildReason({ interests: [], moods: [lonely] }),
      FALLBACK_REASON,
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/[—–!]/);
      expect(s).not.toMatch(/뽑|운세|랜덤|AI/);
    }
  });

  it("이름이 있을 때만 부른다", () => {
    expect(firstWordTitle("은혜")).toBe("은혜님을 위해 고른 첫 말씀");
    expect(firstWordTitle("  ")).toBe("오늘의 첫 말씀");
    expect(firstWordTitle(null)).toBe("오늘의 첫 말씀");
  });
});

describe("기기 저장", () => {
  it("저장한 답을 다시 읽는다 — 마음은 두 개, 위기는 오늘만", () => {
    writeAnswers(
      { interests: ["family", "nope"], moods: ["tired", CRISIS_MOOD_ID, "joy", "lonely"], readingTime: "dawn" },
      DAY,
    );
    const answers = readAnswers(DAY);
    expect(answers).toEqual({
      interests: ["family"],
      moods: ["tired", "joy"],
      isCrisis: true,
      readingTime: "dawn",
      readingLength: null,
    });
    // 위기 선택지는 마음 목록에 남지 않고, 다음 날에는 꺼진다
    expect(JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}").moods).not.toContain(CRISIS_MOOD_ID);
    expect(readAnswers("2026-10-24").isCrisis).toBe(false);
  });

  it("깨진 값·다른 형식은 빈 답으로 읽는다", () => {
    expect(parseAnswers("{not json", DAY)).toEqual(EMPTY_ANSWERS);
    expect(parseAnswers("[1,2]", DAY).interests).toEqual([]);
    expect(parseAnswers(JSON.stringify({ interests: "family", moods: [1, "tired"] }), DAY)).toMatchObject({
      interests: [],
      moods: ["tired"],
    });
  });

  it("저장소가 던져도 읽기·쓰기가 터지지 않는다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeAnswers({ interests: ["family"] }, DAY)).not.toThrow();
    expect(readAnswers(DAY)).toEqual(EMPTY_ANSWERS);
    expect(() => writeNote({ date: DAY, cardId: null, text: "한 줄" })).not.toThrow();
    expect(readNote()).toBeNull();
  });

  it("localStorage 접근 자체가 막혀도 빈 답", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readAnswers(DAY)).toEqual(EMPTY_ANSWERS);
    expect(() => writeAnswers({ moods: ["tired"] }, DAY)).not.toThrow();
  });

  it("한 줄은 앞뒤 공백을 떼고 100자로 자르며, 비면 지운다", () => {
    writeNote({ date: DAY, cardId: "c1", text: `  ${"가".repeat(NOTE_MAX_LENGTH + 20)}  ` });
    expect(readNote()?.text).toHaveLength(NOTE_MAX_LENGTH);
    writeNote({ date: DAY, cardId: "c1", text: "   " });
    expect(localStorage.getItem(NOTE_KEY)).toBeNull();
  });

  it("로그아웃 '이 기기 기록 지우기'가 답과 한 줄을 함께 지운다", () => {
    writeAnswers({ interests: ["family"], moods: ["tired"] }, DAY);
    writeNote({ date: DAY, cardId: null, text: "한 줄" });
    localStorage.setItem("other:key", "keep");
    clearHoondokStorage();
    expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
    expect(localStorage.getItem(NOTE_KEY)).toBeNull();
    expect(localStorage.getItem("other:key")).toBe("keep");
  });
});
