"use client";

import { clearHoondokStorage } from "./use-delete-me";

// 기기 저장 기록(질문·이어 읽기·최근 검색)에는 계정 정보가 없다.
// 주인 표시가 없으면 앞 사람이 남긴 질문·답·읽던 위치가 다음에 로그인한 계정 화면에 그대로 보인다.
const OWNER_KEY = "hoondok:device-owner";

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    // 사생활 모드·차단 — 주인을 모르면 남의 것으로 본다
    return null;
  }
}

function writeOwner(userId: string): void {
  try {
    window.localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // 표시를 못 남겨도 로그인은 계속된다
  }
}

/**
 * 로그인·가입 성공 직후 호출. 기기에 남은 기록의 주인이 다르면 먼저 지운다.
 * 가입이면서 앞선 주인 표시가 없을 때만 남긴다 — 둘러보기로 질문한 본인 기록이다.
 */
export function claimDeviceForUser(userId: string, isNewAccount: boolean): void {
  const owner = readOwner();
  const isOwnAnonymousData = owner === null && isNewAccount;
  if (owner !== userId && !isOwnAnonymousData) clearHoondokStorage();
  writeOwner(userId);
}
