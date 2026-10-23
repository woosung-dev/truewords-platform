// 맞춤 첫 말씀 질문의 선택지. id 는 저장·비교용 영어 slug 로 고정하고 표시 이름과 분리한다(이름을 고쳐도 저장값이 깨지지 않게).
// 태그는 카드 topic(쉼표 구분 기존 태그 23종) 이름 그대로다. 새 태깅 없이 이 고정 매핑만 쓴다.

/** 질문 1 관심 주제. `workTitles` 가 있으면 태그 대신 카드의 work_title 로 겹침을 본다(원리 공부). */
export type InterestOption = {
  id: string;
  label: string;
  description: string;
  tags: readonly string[];
  workTitles?: readonly string[];
};

export const INTEREST_OPTIONS: readonly InterestOption[] = [
  { id: "family", label: "가정과 부부", description: "축복가정으로 사는 하루, 부부의 대화", tags: ["가정", "부부"] },
  {
    id: "children",
    label: "자녀와 부모",
    description: "자녀 교육과 효정, 3대가 함께 사는 집",
    tags: ["자녀·부모", "효정"],
  },
  { id: "tp_life", label: "참부모님의 생애", description: "참부모님이 걸어오신 길과 일화", tags: ["참부모님"] },
  { id: "prayer", label: "기도와 정성", description: "기도하는 자리, 정성 들이는 생활", tags: ["기도"] },
  { id: "heart", label: "하나님의 심정", description: "하늘부모님의 사랑과 슬픔", tags: ["하나님(하늘부모님)"] },
  { id: "blessing", label: "축복과 결혼 준비", description: "축복을 앞둔 청년과 2세의 준비", tags: ["부부", "청년"] },
  {
    id: "daily",
    label: "일터와 살림 속 신앙",
    description: "직장과 집안일 속에서 말씀대로 살기",
    tags: ["위하는 삶", "양심"],
  },
  { id: "others", label: "위하여 사는 삶", description: "섬김과 전도, 이웃과 나누기", tags: ["위하는 삶", "사명"] },
  {
    id: "principle",
    label: "원리 공부",
    description: "원리강론을 차근차근 이해하기",
    tags: [],
    workTitles: ["원리강론", "통일사상요강"],
  },
  { id: "spirit", label: "영계와 인생의 마무리", description: "나이 듦과 성화, 영원한 생명", tags: ["영계·영원"] },
  { id: "peace", label: "평화와 통일", description: "평화사상과 남북통일을 위한 기도", tags: ["평화"] },
  { id: "forgive", label: "용서와 관계 회복", description: "서운한 마음을 풀고 다시 잇기", tags: ["용서"] },
];

export type MoodOption = { id: string; label: string; tags: readonly string[] };

/** "많이 힘들어요". 고르면 말씀보다 위기 안내가 먼저이고, 두 개 제한에서 빠지며, 오래 저장하지 않는다. */
export const CRISIS_MOOD_ID = "hard";

/** 질문 2 요즘 마음. 위기 선택지를 뺀 나머지 중 두 개까지 고른다. */
export const MOOD_OPTIONS: readonly MoodOption[] = [
  { id: "tired", label: "지쳤어요", tags: ["위로", "고난·인내"] },
  { id: "thankful", label: "감사해요", tags: ["감사"] },
  { id: "worry", label: "고민이 있어요", tags: ["믿음", "기도"] },
  { id: "lonely", label: "외로워요", tags: ["위로", "하나님(하늘부모님)"] },
  { id: "seeking", label: "길을 찾고 있어요", tags: ["사명", "희망"] },
  { id: "relation", label: "관계가 어려워요", tags: ["용서", "겸손"] },
  { id: "restart", label: "다시 시작하고 싶어요", tags: ["희망", "용서"] },
  { id: "joy", label: "기쁜 일이 있어요", tags: ["기쁨", "감사"] },
  { id: CRISIS_MOOD_ID, label: "많이 힘들어요", tags: ["위로"] },
];

export const MAX_MOODS = 2;

/** 질문 3 (선택). 홈 분량 문구에만 쓰고 알림은 켜지 않는다. */
export type PlainOption = { id: string; label: string; description: string };

export const READING_TIME_OPTIONS: readonly PlainOption[] = [
  { id: "dawn", label: "새벽 기도 뒤", description: "해 뜨기 전 조용한 때" },
  { id: "commute", label: "아침 출근길", description: "이동하며 한 손으로" },
  { id: "noon", label: "낮에 잠깐", description: "점심 뒤 짧은 틈" },
  { id: "night", label: "잠들기 전", description: "하루를 마무리하며" },
];

export const READING_LENGTH_OPTIONS: readonly PlainOption[] = [
  { id: "short", label: "3분", description: "한 단락씩" },
  { id: "long", label: "10분", description: "한 구간씩" },
];

/** 위기 안내 연락처. 화면은 tel: 버튼으로 걸고 "24시간"을 함께 적는다. 문구는 `[확인 필요]`(README §6). */
export const CRISIS_CONTACTS = [
  { id: "suicide", label: "자살예방상담", number: "109", tel: "tel:109" },
  { id: "mental", label: "정신건강위기상담", number: "1577-0199", tel: "tel:15770199" },
] as const;

const INTEREST_IDS = new Set(INTEREST_OPTIONS.map((o) => o.id));
const MOOD_IDS = new Set(MOOD_OPTIONS.map((o) => o.id));

export function isInterestId(id: string): boolean {
  return INTEREST_IDS.has(id);
}

export function isMoodId(id: string): boolean {
  return MOOD_IDS.has(id);
}

/**
 * 마음 선택 토글. 위기 선택지는 개수와 상관없이 켜고 끌 수 있다(두 개 제한에서 빠진다).
 * 그 밖의 마음이 이미 두 개면 새로 켜지 않고 그대로 돌려준다 — 화면은 이때 고른 것 하나를 먼저 풀어 달라고 알린다.
 */
export function toggleMood(selected: readonly string[], id: string): string[] {
  if (!isMoodId(id)) return [...selected];
  if (selected.includes(id)) return selected.filter((v) => v !== id);
  if (id !== CRISIS_MOOD_ID && countLimitedMoods(selected) >= MAX_MOODS) return [...selected];
  return [...selected, id];
}

/** 두 개 제한에 세는 마음 수(위기 선택지 제외). */
export function countLimitedMoods(selected: readonly string[]): number {
  return selected.filter((id) => id !== CRISIS_MOOD_ID).length;
}

export function interestLabel(id: string): string | null {
  return INTEREST_OPTIONS.find((o) => o.id === id)?.label ?? null;
}

export function moodLabel(id: string): string | null {
  return MOOD_OPTIONS.find((o) => o.id === id)?.label ?? null;
}
