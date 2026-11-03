// 에디터의 선택 값은 서버가 허용하는 문서 속성 범위와 일치한다.
export const ALLOWED_COLORS = ["#242424", "#5b5b5b", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#1d4ed8", "#7e22ce"];
export const ALLOWED_FONT_SIZES = ["14px", "16px", "18px", "20px", "24px"];
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 64;
export function normalizeFontSize(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?px$/.test(value)) return null;
  return `${Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(parseFloat(value))))}px`;
}
