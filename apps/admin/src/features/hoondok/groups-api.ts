import type { AdminGroupItem } from "@truewords/api-client-ts/types";
import { ApiError, fetchAPI } from "@/lib/api";

export type { AdminGroupItem };

const BASE = "/admin/hoondok/groups";

// 모임 admin API (API-HD-043). 목록은 이름·인원·생성일만 온다 — 모임원 이름·한 줄은 admin 에게도 없다.
export const groupsAPI = {
  list: () => fetchAPI<AdminGroupItem[]>(BASE),
  /** 하드 삭제(신고 대응). 되돌릴 수 없다. */
  remove: (id: string) => fetchAPI<void>(`${BASE}/${id}`, { method: "DELETE" }),
};

/**
 * 서버 datetime 은 시간대 없는 UTC(`2026-09-23T01:02:03`)로 온다. 접미사가 없으면 UTC 로 읽고 KST 날짜로 보인다.
 * 파싱할 수 없으면 원문을 그대로 돌려준다.
 */
export function formatKstDate(value: string): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 목록 조회 실패 문구. 401 은 fetchAPI 가 이미 /login 으로 보낸다. */
export function loadErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "로그인이 필요해요. 로그인 화면으로 이동해요";
    if (err.status === 403) return "이 화면을 볼 권한이 없어요";
  }
  return fallback;
}

/**
 * 변경(등록·수정·삭제) 실패 문구. 404 는 다른 편성자가 먼저 지운 경우라 부드럽게 알리고 화면이 목록을 새로 고친다.
 * 403 은 권한(게이트) 또는 CSRF 거부다.
 */
export function mutationErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "이미 삭제된 항목이에요. 목록을 새로 고쳤어요";
    if (err.status === 401) return "로그인이 필요해요. 로그인 화면으로 이동해요";
    if (err.status === 403) return "권한이 없어요. 관리자 계정으로 다시 로그인해 주세요";
    if (err.status === 422) return "입력값을 확인해 주세요";
  }
  return fallback;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
