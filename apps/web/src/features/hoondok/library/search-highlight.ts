// 검색 결과 조각에서 검색어가 나온 곳을 표시한다.
// 서버 검색은 의미 검색을 섞어 쓰므로 검색어가 본문에 없을 수도 있다 — 그때는 표시 없이 앞부분을 보인다.

export type SnippetPart = { text: string; hit: boolean };

/** 첫 일치 앞에 남길 글자 수. 이보다 뒤에서 처음 나오면 앞을 "…" 로 줄인다. */
const LEAD = 40;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 검색어 전체와 두 글자 이상 낱말을 긴 것부터 찾는다. 따옴표는 구절 표시일 뿐이라 뺀다. */
function termsOf(query: string): string[] {
  const phrase = query.replace(/["'“”‘’]/g, "").trim();
  const words = phrase.split(/\s+/).filter((word) => word.length >= 2);
  return [...new Set([phrase, ...words])].filter(Boolean).sort((a, b) => b.length - a.length);
}

function patternOf(query: string): RegExp | null {
  const terms = termsOf(query);
  return terms.length === 0 ? null : new RegExp(terms.map(escapeRegExp).join("|"), "gi");
}

function splitByPattern(text: string, pattern: RegExp): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), hit: false });
    parts.push({ text: match[0], hit: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

/** 본문 전체를 자르지 않고 검색어 위치만 나눈다 (원문 뷰용). */
export function markSearchTerms(text: string, query: string): SnippetPart[] {
  const pattern = patternOf(query);
  return pattern ? splitByPattern(text, pattern) : [{ text, hit: false }];
}

/** 검색 결과 목록용 — 첫 일치가 뒤쪽이면 그 근처부터 보이도록 앞을 줄인다. */
export function highlightSnippet(text: string, query: string): SnippetPart[] {
  const pattern = patternOf(query);
  if (!pattern) return [{ text, hit: false }];
  const first = text.search(pattern);
  if (first < 0) return [{ text, hit: false }];

  // 첫 일치가 뒤쪽이면 그 근처부터 보여 준다. 낱말 중간에서 자르지 않도록 앞 공백까지 당긴다.
  let start = 0;
  if (first > LEAD) {
    const space = text.lastIndexOf(" ", first - LEAD);
    start = space > 0 ? space + 1 : first - LEAD;
  }
  const parts = splitByPattern(text.slice(start), pattern);
  return start > 0 ? [{ text: "…", hit: false }, ...parts] : parts;
}
