import { ApiError } from "@truewords/api-client-ts";
import { identityAPI } from "./api";

export type OAuthIntent = "login" | "link";

/** 서버 콜백이 `/onboarding/done?error=` 로 돌려주는 코드. */
export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  failed: "구글 로그인을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요",
  cancelled: "구글 로그인을 취소했어요. 다시 하려면 아래 버튼을 눌러 주세요",
  email_unverified: "구글에서 인증되지 않은 이메일이에요. 이메일 인증을 마친 계정으로 시도해 주세요",
  already_linked: "이미 다른 계정에 연결된 구글 계정이에요",
  session_mismatch: "로그인한 계정이 바뀌어 연결을 마치지 못했어요. 다시 로그인한 뒤 시도해 주세요",
  provider_linked: "이 계정에는 이미 다른 구글 계정이 연결돼 있어요",
  email_exists:
    "이 이메일로 가입한 계정이 있어요. 이메일과 비밀번호로 로그인한 뒤 구글 계정을 연결해 주세요",
  invite_required: "초대 코드가 필요해요. 초대받은 코드를 입력하고 다시 시도해 주세요",
};

export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(OAUTH_ERROR_MESSAGES, code) ? OAUTH_ERROR_MESSAGES[code] : OAUTH_ERROR_MESSAGES.failed;
}

/** start 호출 실패를 사용자 문구로 바꾼다. */
export function oauthStartErrorMessage(error: unknown, intent: OAuthIntent): string {
  if (error instanceof ApiError) {
    // 비밀번호 계정이 구글을 연결할 때의 재확인 실패(없음·불일치)
    if (error.status === 401 && error.errorCode === "REAUTH_REQUIRED") return "비밀번호가 올바르지 않아요";
    if (error.errorCode === "OAUTH_PROVIDER_UNAVAILABLE") return "지금은 구글 로그인을 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요";
    if (error.status === 401 && intent === "link") return "로그인이 풀렸어요. 다시 로그인한 뒤 연결해 주세요";
    if (error.status === 429) return "요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요";
  }
  return "서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요";
}

/**
 * 공급자 로그인·연결을 시작한다 — start 로 인증 주소를 받아 브라우저를 그리로 보낸다.
 * 이 함수는 던진다. 호출자가 oauthStartErrorMessage 로 문구를 만든다.
 */
export async function startOAuth(options: {
  provider?: string;
  intent: OAuthIntent;
  returnTo?: string;
  inviteCode?: string;
  /** 비밀번호 계정이 intent=link 를 시작할 때의 재확인. 호출자 상태에서만 오고, 어디에도 저장하지 않는다. */
  password?: string;
}): Promise<void> {
  const inviteCode = options.inviteCode?.trim();
  const { authorization_url } = await identityAPI.oauthStart(options.provider ?? "google", {
    intent: options.intent,
    return_to: options.returnTo ?? null,
    // 비워 두면 보내지 않는다
    ...(inviteCode ? { invite_code: inviteCode } : {}),
    ...(options.password ? { password: options.password } : {}),
  });
  window.location.assign(authorization_url);
}

/** 인앱 브라우저는 구글이 OAuth 를 막는다(disallowed_useragent) — 일반 브라우저로 열게 안내한다. */
export function isInAppBrowser(ua: string): boolean {
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|(?:^|[\s;])Line\/|; wv\)/i.test(ua);
}
