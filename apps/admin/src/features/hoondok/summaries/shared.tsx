"use client";

import type { ReactNode } from "react";
import type { StatusTone } from "@/components/status-badge";
import { ApiError } from "@/lib/api";

export type Status = "draft" | "review" | "published" | "withdrawn";
export const STATUS: Record<Status | "none", string> = {
  none: "콘텐츠 없음",
  draft: "초안",
  review: "검수 중",
  published: "공개",
  withdrawn: "내림",
};
// 발행 관리 트리·편집 화면이 같은 색으로 상태를 읽게 한다
export const STATUS_TONE: Record<Status | "none", StatusTone> = {
  none: "neutral",
  draft: "info",
  review: "warning",
  published: "success",
  withdrawn: "danger",
};
// 서버 값은 소문자지만 예전 값·대문자가 와도 같은 상태로 읽는다.
export function normalizeStatus(value: unknown): Status | "none" {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return status in STATUS ? (status as Status | "none") : "draft";
}
export function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return `${error.message} 편집 내용을 복사해 둔 뒤 최신 내용을 다시 불러와 주세요.`;
    if (error.status === 422) return `${error.message} 원문 위치·필수 입력값과 그림 설명을 확인해 주세요.`;
    return error.message;
  }
  return "저장하지 못했습니다. 입력 내용은 유지되어 있어요. 연결을 확인한 뒤 다시 시도해 주세요.";
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="summary-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
