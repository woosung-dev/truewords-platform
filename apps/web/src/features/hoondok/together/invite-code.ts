// 모임 초대 코드 (PLAN-HD-010 §5, API-HD-035). Crockford base32 8자 `XXXX-XXXX`.
// 서버도 같은 규칙으로 정규화한다 — 여기서는 입력 표시와 링크 모양만 맞춘다. 판정은 서버 404 가 한다.
const ALPHABET = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export const JOIN_PATH = "/hoondok/groups/join";

// 하이픈 자리에 올 수 있는 문자 — 공백·하이픈·en/em dash 등 (카톡·메모 앱이 하이픈을 대시로 바꾼다)
const SEPARATORS = /[\s\-\u2010-\u2015\u2212]+/g;

/** 대문자화 · 공백/하이픈(대시 포함) 제거 · Crockford 별칭(I·L→1, O→0). */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(SEPARATORS, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

export function isValidInviteCode(raw: string): boolean {
  return ALPHABET.test(normalizeInviteCode(raw));
}

// 문장 속 코드 — 4자 + (구분자 0~1개) + 4자. 앞뒤가 영숫자·하이픈이면 더 긴 단어의 일부라 코드로 보지 않는다
// (예: 베타 코드 `QA-BETA-2026` 의 `BETA-2026`). 별칭 I·L·O 도 받고 정규화에서 바꾼다.
const CODE_IN_TEXT = /(?<![0-9A-Za-z-])[0-9A-Za-z]{4}[\s\-\u2010-\u2015\u2212]?[0-9A-Za-z]{4}(?![0-9A-Za-z-])/g;
const CODE_PARAM = /[?&]code=([^&#\s]+)/;

/**
 * 붙여 넣은 글에서 모임 초대 코드를 찾는다. 찾으면 `XXXX-XXXX`, 없으면 null.
 * 순서: 링크의 `code` 파라미터 → 글 전체가 코드 → 글 속 첫 8자 코드("초대 코드: WMDM-5QH5").
 */
export function extractInviteCode(text: string): string | null {
  const param = CODE_PARAM.exec(text)?.[1];
  if (param) {
    let decoded = param;
    try {
      decoded = decodeURIComponent(param);
    } catch {
      // 깨진 % 인코딩이면 원문으로 판정한다
    }
    if (isValidInviteCode(decoded)) return formatInviteCode(decoded);
  }
  if (isValidInviteCode(text)) return formatInviteCode(text);
  for (const match of text.matchAll(CODE_IN_TEXT)) {
    if (isValidInviteCode(match[0])) return formatInviteCode(match[0]);
  }
  return null;
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
