// 책갈피 문장 찾기 (PLAN-HD-012 원문 연결). 카드 본문은 원문 그대로지만 단락 display_text 는 서버가 줄바꿈·공백·따옴표를
// 정리한 표시용이라 글자가 1:1 로 같지 않을 수 있다. 공백·문장부호·기호를 모두 지우고 비교한 뒤 원래 위치로 되돌린다.

// 비교에서 버리는 글자: 공백 전부 + 유니코드 문장부호(P*) + 기호(S*: 따옴표 대용 기호·말줄임 등)
const IGNORED = /[\s\p{P}\p{S}]/u;

/** 비교용 정규화: 버리는 글자를 지우고, 남은 글자마다 원문 위치를 기록한다. NFC 로 맞춰 한글 조합형 차이도 없앤다. */
export function normalizeForMatch(text: string): { chars: string; positions: number[] } {
  let chars = "";
  const positions: number[] = [];
  const source = text.normalize("NFC");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (IGNORED.test(char)) continue;
    chars += char.toLowerCase();
    positions.push(index);
  }
  return { chars, positions };
}

/**
 * display_text 안에서 카드 문장이 차지하는 [start, end) 범위. 못 찾으면 null(→ 단락 전체 강조).
 * 범위는 첫 글자~마지막 글자이고, 마지막 글자 바로 뒤의 닫는 문장부호(. ” 등)는 밑줄에 포함한다.
 */
export function findCardSentence(displayText: string, cardText: string): { start: number; end: number } | null {
  const source = displayText.normalize("NFC");
  const haystack = normalizeForMatch(source);
  const needle = normalizeForMatch(cardText).chars;
  if (!needle) return null;
  const at = haystack.chars.indexOf(needle);
  if (at < 0) return null;
  const start = haystack.positions[at];
  let end = haystack.positions[at + needle.length - 1] + 1;
  while (end < source.length && /[\p{Pe}\p{Pf}.!?。…]/u.test(source[end])) end += 1;
  return { start, end };
}
