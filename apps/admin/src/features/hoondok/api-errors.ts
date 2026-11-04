import { ApiError } from "@/lib/api";

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
