// 모임 초대 코드 (PLAN-HD-010 §5, API-HD-035). Crockford base32 8자 `XXXX-XXXX`.
// 서버도 같은 규칙으로 정규화한다 — 여기서는 입력 표시와 링크 모양만 맞춘다. 판정은 서버 404 가 한다.
const ALPHABET = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export const JOIN_PATH = "/hoondok/groups/join";

/** 대문자화 · 공백/하이픈 제거 · Crockford 별칭(I·L→1, O→0). */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export function isValidInviteCode(raw: string): boolean {
  return ALPHABET.test(normalizeInviteCode(raw));
}

/** 유효하면 `XXXX-XXXX`, 아니면 정규화 값 그대로(입력 중 표시용). */
export function formatInviteCode(raw: string): string {
  const code = normalizeInviteCode(raw);
  return ALPHABET.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** 참여 링크. 브라우저면 현재 origin 을 붙인 절대 URL, 서버 렌더면 상대 경로. */
export function inviteLink(code: string): string {
  const path = `${JOIN_PATH}?code=${encodeURIComponent(formatInviteCode(code))}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

export type ShareMethod = "share" | "clipboard" | "cancelled" | "none";

/**
 * 초대 공유. `navigator.share` → 미지원이면 클립보드 → 둘 다 안 되면 "none"(화면이 코드를 직접 보여 준다).
 * 공유 텍스트는 모임 이름과 링크뿐이다(카카오 SDK 없음, PLAN-HD-010 §6).
 * 사용자가 공유 시트를 닫은 AbortError 는 "cancelled" — 클립보드로 넘어가 뜻밖에 복사하지 않는다.
 */
export async function shareInvite({ groupName, link }: { groupName: string; link: string }): Promise<ShareMethod> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: groupName, text: groupName, url: link });
      return "share";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${groupName}\n${link}`);
      return "clipboard";
    } catch {
      return "none";
    }
  }
  return "none";
}
