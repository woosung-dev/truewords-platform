// 메뉴 이름 검색: 띄어쓰기 무시 → 정확 > 시작 > 포함 > 초성 > 자모(조합 중 글자) 순으로 등급을 매긴다.

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ",
  "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ", "ㅡ", "ㅡㅣ", "ㅣ",
];
const JONG = [
  "", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ",
  "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
// 홀로 입력된 겹모음·겹받침도 풀어 써야 "말ㅆ" 같은 조합 중 입력이 맞는다
const COMPAT: Record<string, string> = {
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
};

const SYL_START = 0xac00;
const SYL_END = 0xd7a3;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s·\-_]/g, "");
}

function syllableIndex(ch: string): number | null {
  const c = ch.charCodeAt(0);
  return c >= SYL_START && c <= SYL_END ? c - SYL_START : null;
}

function initials(s: string): string {
  let out = "";
  for (const ch of normalize(s)) {
    const i = syllableIndex(ch);
    out += i === null ? ch : CHO[Math.floor(i / 588)];
  }
  return out;
}

function jamo(s: string): string {
  let out = "";
  for (const ch of normalize(s)) {
    const i = syllableIndex(ch);
    out += i === null ? (COMPAT[ch] ?? ch) : CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
  }
  return out;
}

/** 일치 등급(클수록 위). 맞지 않으면 null. */
export function matchScore(label: string, query: string): number | null {
  const q = normalize(query);
  if (!q) return null;
  const l = normalize(label);
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  if (l.includes(q)) return 60;
  if (/^[ㄱ-ㅎ]+$/.test(q)) {
    const ini = initials(label);
    if (ini.startsWith(q)) return 55;
    if (ini.includes(q)) return 50;
  }
  const jq = jamo(q);
  if (jq.length >= 2) {
    const jl = jamo(label);
    if (jl.startsWith(jq)) return 48;
    if (jl.includes(jq)) return 45;
  }
  return null;
}

/** 등급 > 즐겨찾기 > 원래 순서로 정렬한 일치 목록. */
export function searchByLabel<T extends { href: string; label: string }>(
  items: readonly T[],
  query: string,
  favorites: readonly string[] = [],
): T[] {
  return items
    .map((item, index) => ({ item, index, score: matchScore(item.label, query) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(favorites.includes(b.item.href)) - Number(favorites.includes(a.item.href)) ||
        a.index - b.index,
    )
    .map((r) => r.item);
}
