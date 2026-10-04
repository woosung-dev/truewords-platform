import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 파일명 끝의 확장자(.txt, .pdf, .docx 등)를 제거. 표시명 미설정 시
// 채팅 답변 출처/admin 입력 placeholder fallback 에 쓰인다.
export function stripFileExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,6}$/i, "");
}

// 차트 축·툴팁용 날짜. "2026-04-11" → "4/11". API 가 주는 날짜 문자열을 그대로 잘라 시간대 변환을 하지 않는다.
export function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.slice(0, 10).split("-");
  if (!month || !day) return isoDate;
  return `${Number(month)}/${Number(day)}`;
}

// 목록 한 줄용 시각. "10/5 14:02" (브라우저 현지 시각).
export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}

// 페이지 범위 표시. 빈 페이지를 "1–0건"으로 보이지 않게 한다.
export function formatPageRange(offset: number, count: number): string {
  if (count === 0) return "0건";
  return `${offset + 1}–${offset + count}건`;
}
