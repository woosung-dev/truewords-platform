// 맞춤 첫 말씀 고르기 (순수 함수). 카드 목록(API-HD-054)을 기기 안에서 점수 매긴다 — 선택값은 서버로 가지 않는다.
// 점수 = 겹치는 마음 선택지마다 2점 + 겹치는 관심 주제마다 1점. 무작위가 없고, 동점은 (KST 날짜 + 카드 id) 해시로
// 정해 날마다 바뀌되 같은 날에는 같은 카드다. 0점이면 null → 화면은 오늘 편성 카드(API-HD-047)로 돌아간다.
import type { CardPublic } from "@truewords/api-client-ts/types";
import { CRISIS_MOOD_ID, INTEREST_OPTIONS, type InterestOption, MOOD_OPTIONS, type MoodOption } from "./options";

export type PickInput = { interests: readonly string[]; moods: readonly string[]; isCrisis?: boolean };

export type CardScore = {
  score: number;
  /** 이 카드와 겹친 관심 주제·마음 (선택지 정의 순서) */
  interests: InterestOption[];
  moods: MoodOption[];
};

export type PersonalPick = CardScore & { card: CardPublic };

/** 카드 topic("사랑, 기도") → 태그 목록. 비었으면 []. */
export function cardTags(topic: string | null | undefined): string[] {
  if (!topic) return [];
  return topic
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function selectedMoods(input: PickInput): MoodOption[] {
  const ids = new Set(input.moods);
  if (input.isCrisis) ids.add(CRISIS_MOOD_ID);
  return MOOD_OPTIONS.filter((o) => ids.has(o.id));
}

export function scoreCard(card: CardPublic, input: PickInput): CardScore {
  const tags = new Set(cardTags(card.topic));
  const interests = INTEREST_OPTIONS.filter(
    (o) =>
      input.interests.includes(o.id) &&
      (o.tags.some((tag) => tags.has(tag)) || Boolean(o.workTitles?.includes(card.work_title.trim()))),
  );
  const moods = selectedMoods(input).filter((o) => o.tags.some((tag) => tags.has(tag)));
  return { score: moods.length * 2 + interests.length, interests, moods };
}

/** FNV-1a 32비트. 동점 순서만 정하므로 암호학적 성질은 필요 없다. */
export function tieHash(today: string, cardId: string): number {
  let hash = 0x811c9dc5;
  const text = `${today}|${cardId}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** 가장 많이 겹치는 카드 한 장. 고른 답이 없거나 모두 0점이면 null. */
export function pickPersonalCard(cards: readonly CardPublic[], input: PickInput, today: string): PersonalPick | null {
  let best: { pick: PersonalPick; hash: number } | null = null;
  for (const card of cards) {
    const scored = scoreCard(card, input);
    if (scored.score === 0) continue;
    const hash = tieHash(today, card.id);
    if (
      !best ||
      scored.score > best.pick.score ||
      (scored.score === best.pick.score && (hash < best.hash || (hash === best.hash && card.id < best.pick.card.id)))
    ) {
      best = { pick: { ...scored, card }, hash };
    }
  }
  return best?.pick ?? null;
}

// --- 문구 -------------------------------------------------------------------

/** 0점·카드 없음일 때 오늘 편성 카드와 함께 보이는 까닭 문장. */
export const FALLBACK_REASON = "고르신 주제에 맞는 장을 아직 준비하고 있어요. 오늘 편성된 말씀을 먼저 드려요.";

/** 첫 말씀 화면 공식성 안내 한 줄(DESIGN-PLAN §8-7). */
export const OFFICIAL_NOTICE = "앱이 고른 원문 단락이에요. 공식 해설이나 지금 하신 말씀은 아니에요.";

/** 마지막 한글 글자에 받침이 있는가. 한글이 아니면(숫자·영문) 받침 없음으로 본다. */
function hasBatchim(word: string): boolean {
  const hangul = [...word].reverse().find((ch) => ch >= "가" && ch <= "힣");
  return hangul ? (hangul.charCodeAt(0) - 0xac00) % 28 !== 0 : false;
}

function quote(label: string): string {
  return `‘${label}’`;
}

/** ‘A’, ‘B’와 ‘C’를 — 따옴표 인용 목록 + 목적격 조사. */
function quotedList(labels: readonly string[]): string {
  const quoted = labels.map(quote);
  const last = labels[labels.length - 1];
  if (labels.length === 1) return `${quoted[0]}${hasBatchim(last) ? "을" : "를"}`;
  const head = labels.slice(0, -1);
  const lead = quoted
    .slice(0, -2)
    .map((q) => `${q}, `)
    .join("");
  const beforeLast = head[head.length - 1];
  return `${lead}${quoted[quoted.length - 2]}${hasBatchim(beforeLast) ? "과" : "와"} ${quoted[quoted.length - 1]}${hasBatchim(last) ? "을" : "를"}`;
}

/** 까닭에 인용하는 이름 수 상한. 넘으면 문장이 길어진다. */
const MAX_REASON_NAMES = 3;

/**
 * 고른 까닭 한 문장. 사용자가 고른 이름 중 이 카드와 실제로 겹친 것만 따옴표로 인용한다.
 * 단락 내용을 풀어 쓰지 않는다(공식성) — "겹치는 단락" 이라고만 말한다.
 */
export function buildReason(scored: Pick<CardScore, "interests" | "moods"> | null): string {
  if (!scored || (scored.interests.length === 0 && scored.moods.length === 0)) return FALLBACK_REASON;
  // "많이 힘들어요"는 이름으로 다시 들추지 않는다 — 위기 안내가 이미 맨 위에 있다
  const pick = { interests: scored.interests, moods: scored.moods.filter((o) => o.id !== CRISIS_MOOD_ID) };
  if (pick.interests.length === 0 && pick.moods.length === 0) return "고르신 마음과 겹치는 단락을 먼저 골랐어요.";
  // 주제를 먼저, 마음을 뒤에 적는다(시안 문장 순서). 상한을 넘으면 마음을 한 개 이상 남기고 주제를 줄인다.
  const moods = pick.moods.slice(0, MAX_REASON_NAMES - Math.min(1, pick.interests.length));
  const interests = pick.interests.slice(0, MAX_REASON_NAMES - moods.length);
  const names = [...interests.map((o) => o.label), ...moods.map((o) => o.label)];
  const tail =
    pick.moods.length > 0 && pick.interests.length > 0
      ? "주제와 마음이 함께 겹치는 단락을 먼저 골랐어요."
      : pick.moods.length > 0
        ? "그 마음과 겹치는 단락을 먼저 골랐어요."
        : "그 주제와 겹치는 단락을 먼저 골랐어요.";
  return `${quotedList(names)} 고르셔서 ${tail}`;
}

/** 홈 책갈피 카드 아래 한 줄. 이름은 두 개까지만 인용하고, 겹친 이름이 없으면(위기 선택지만 겹침) 이름 없이 말한다. */
export function homeReason(scored: Pick<CardScore, "interests" | "moods"> | null): string {
  if (!scored) return FALLBACK_REASON;
  const moods = scored.moods.filter((o) => o.id !== CRISIS_MOOD_ID);
  const names = [...scored.interests.map((o) => o.label), ...moods.map((o) => o.label)].slice(0, 2);
  if (names.length > 0) return `${quotedList(names)} 고르셔서 꽂아 둔 장이에요`;
  return scored.moods.length > 0 ? "고르신 마음에 맞춰 꽂아 둔 장이에요" : FALLBACK_REASON;
}

/** 첫 말씀 제목. 계정 이름이 있으면 부르고, 없으면 대체 호칭 없이 "오늘의 첫 말씀". */
export function firstWordTitle(displayName: string | null | undefined): string {
  const name = displayName?.trim();
  return name ? `${name}님을 위해 고른 첫 말씀` : "오늘의 첫 말씀";
}
