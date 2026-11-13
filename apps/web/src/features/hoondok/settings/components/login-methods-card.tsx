"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { type FormEvent, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { startOAuth, oauthStartErrorMessage } from "@/features/identity/oauth";
import { identityAPI } from "@/features/identity/api";
import { CURRENT_USER_KEY, useCurrentUser } from "@/features/identity/use-current-user";

// 로그인 수단 관리 — 연결된 수단을 보이고, 구글을 연결·해제한다. 마지막 수단은 해제할 수 없다(서버도 409 로 막는다).
const SETTINGS_PATH = "/settings";
const LAST_METHOD_TEXT = "마지막 로그인 수단은 해제할 수 없어요. 다른 수단을 먼저 연결해 주세요";
const FAILURE_TEXT = "해제하지 못했어요. 잠시 뒤 다시 시도해 주세요";

export function LoginMethodsCard() {
  const { user, isLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  // 비밀번호 수단이 있는 계정은 구글을 연결하기 전에 비밀번호를 다시 받는다. 컴포넌트 상태에만 둔다.
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState("");

  const unlink = useMutation({
    mutationFn: (identityId: string) => identityAPI.unlinkIdentity(identityId),
    onSuccess: () => {
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setMessage(LAST_METHOD_TEXT);
      else setMessage(FAILURE_TEXT);
    },
  });

  if (isLoading || !user) return null;

  const methods = user.login_methods ?? [];
  const hasGoogle = methods.some((method) => method.provider === "google");
  const isLastMethod = methods.length <= 1;

  const hasPassword = methods.some((method) => method.provider === "password");

  async function startLink(confirmedPassword?: string) {
    setMessage("");
    setIsLinking(true);
    try {
      await startOAuth({ intent: "link", returnTo: SETTINGS_PATH, password: confirmedPassword });
    } catch (error) {
      setMessage(oauthStartErrorMessage(error, "link"));
      setPassword(""); // 틀렸을 때 남겨 두지 않는다
      setIsLinking(false);
    }
  }

  function handleLinkClick() {
    if (hasPassword) {
      setMessage("");
      setAskPassword(true);
    } else {
      void startLink();
    }
  }

  function handlePasswordCancel() {
    setAskPassword(false);
    setPassword(""); // 입력값을 남겨 두지 않는다
    setMessage("");
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void startLink(password);
  }

  return (
    <div className="st-stack">
      <div className="st-group">
        {methods.map((method) => (
          <div className="st-row" key={method.identity_id ?? method.provider}>
            <span className="st-row__bd">
              {method.provider === "google" ? (
                <>
                  <b className="st-row__t">구글</b>
                  <span className="st-row__d">{method.email ?? "연결됨"}</span>
                </>
              ) : (
                <>
                  <b className="st-row__t">이메일·비밀번호</b>
                  <span className="st-row__d">이전 방식이에요. 구글을 연결하면 사라져요</span>
                </>
              )}
            </span>
            {method.identity_id && (
              <HoondokButton
                variant="ghost"
                isSmall
                onClick={() => unlink.mutate(method.identity_id as string)}
                disabled={isLastMethod || unlink.isPending}
                aria-label="구글 연결 해제"
              >
                해제
              </HoondokButton>
            )}
          </div>
        ))}
      </div>
      {isLastMethod && hasGoogle && <p className="hint">{LAST_METHOD_TEXT}</p>}
      {!hasGoogle && !askPassword && (
        <HoondokButton onClick={handleLinkClick} isLoading={isLinking}>
          구글 계정 연결
        </HoondokButton>
      )}
      {!hasGoogle && askPassword && (
        <form className="form" onSubmit={handlePasswordSubmit} aria-label="구글 연결을 위한 비밀번호 확인">
          <label className="field">
            <span className="field__label">비밀번호 확인</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p className="field__help">계정을 지키기 위해 한 번 더 확인해요</p>
          <HoondokButton type="submit" isLoading={isLinking}>
            구글 계정 연결 계속하기
          </HoondokButton>
          <HoondokButton variant="ghost" onClick={handlePasswordCancel} disabled={isLinking}>
            취소
          </HoondokButton>
        </form>
      )}
      {message && (
        <p className="hint" role="alert">
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}
