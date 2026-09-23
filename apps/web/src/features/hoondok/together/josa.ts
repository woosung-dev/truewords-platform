// 한국어 목적격 조사 을/를 — 이름 끝 글자의 받침으로 고른다. 한글 음절이 아니면(숫자·영문 등) "을(를)".
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

export function withObjectParticle(name: string): string {
  const last = Array.from(name.trimEnd()).at(-1);
  const code = last?.codePointAt(0);
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) return `${name}을(를)`;
  return (code - HANGUL_FIRST) % 28 === 0 ? `${name}를` : `${name}을`;
}
