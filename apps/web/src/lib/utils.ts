import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 파일명 끝의 확장자(.txt, .pdf, .docx 등)를 제거. 표시명 미설정 시
// 채팅 답변 출처/admin 입력 placeholder fallback 에 쓰인다.
export function stripFileExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,6}$/i, "");
}
