"use client";

// SCR-PWA-001 온보딩 — 구글로 계속하기(가입·로그인 공통) + 예전 이메일 가입자의 비밀번호 로그인.
// 비밀번호 가입은 서버가 닫았다(410). 비밀번호 로그인은 기존 가입자가 구글을 연결하는 임시 경로다.
// 교회 선택·약관 동의 체크는 비범위(DEC-PWA-001 확정 전). 초대 코드는 서버 HOONDOK_INVITE_CODE 가 설정된 환경에서만 요구된다.
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { identityAPI } from "@/features/identity/api";
import { completeSignIn } from "@/features/identity/after-sign-in";
import { safeReturnTo } from "@/features/identity/gate";
import { isInAppBrowser, oauthErrorMessage, oauthStartErrorMessage, startOAuth } from "@/features/identity/oauth";
import type { HoondokUser } from "@/features/identity/types";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useLogout } from "@/features/identity/use-logout";

function passwordErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "이메일 또는 비밀번호가 올바르지 않습니다";
    if (error.status === 422) return "입력값을 확인해 주세요";
  }
  return "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요";
}

const subscribeNever = () => () => {};
// 서버·hydration 첫 렌더는 false(일반 안내)이고 클라이언트에서 UA 를 읽는다.
const inAppSnapshot = () => isInAppBrowser(navigator.userAgent);

function ErrorHint({ message }: { message: string }) {
  // 오류는 색만으로 알리지 않는다(DES §3.3) — 아이콘 + 문장. 입력값은 state 에 남아 있어 그대로 다시 낼 수 있다(REQ-PWA-013).
  return (
    <p className="hint hint--alert" role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

function InAppBrowserNotice() {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <div className="card" role="status">
      <p className="greet">다른 브라우저(Chrome·Safari)로 열어 주세요</p>
      <p className="field__help">이 앱 안의 브라우저에서는 구글 로그인을 쓸 수 없어요. 주소를 복사해 기본 브라우저에서 열어 주세요.</p>
      <div className="onb-cta">
        <HoondokButton variant="ghost" onClick={handleCopy}>
          주소 복사
        </HoondokButton>
      </div>
      {copyState === "done" && <p className="field__help">주소를 복사했어요</p>}
      {copyState === "failed" && <p className="field__help">복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요</p>}
    </div>
  );
}

function LinkPrompt({ returnTo, onLater }: { returnTo: string; onLater: () => void }) {
  const [message, setMessage] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  async function handleLink() {
    setMessage("");
    setIsStarting(true);
    try {
      await startOAuth({ intent: "link", returnTo });
    } catch (error) {
      setMessage(oauthStartErrorMessage(error, "link"));
      setIsStarting(false);
    }
  }
  return (
    <div className="card" role="group" aria-label="구글 계정 연결 안내">
      <p className="greet">구글 계정을 연결해 두세요</p>
      <p className="field__help">
        이메일·비밀번호 로그인은 곧 없어질 예정이에요. 구글 계정을 연결하면 지금 기록 그대로 구글로 로그인할 수 있어요.
      </p>
      {message && <ErrorHint message={message} />}
      <div className="onb-cta">
        <HoondokButton onClick={handleLink} isLoading={isStarting}>
          구글 계정 연결하기
        </HoondokButton>
        <HoondokButton variant="ghost" onClick={onLater} disabled={isStarting}>
          나중에 할게요
        </HoondokButton>
      </div>
    </div>
  );
}

function PasswordLoginForm({ onSignedIn }: { onSignedIn: (user: HoondokUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      const { user } = await identityAPI.login({ email, password });
      onSignedIn(user);
    } catch (error) {
      setMessage(passwordErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label="이메일 로그인">
      <label className="field">
        <span className="field__label">이메일</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {message && <ErrorHint message={message} />}
      <div className="onb-cta">
        {/* 저장 중에는 라벨을 유지한 채 스피너를 붙이고 중복 제출을 막는다 (DES §1.5 loading) */}
        <HoondokButton type="submit" isLoading={isSubmitting}>
          로그인
        </HoondokButton>
      </div>
    </form>
  );
}

function OnboardingBody() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const errorMessage = oauthErrorMessage(params.get("error"));
  const { user, isLoading } = useCurrentUser();
  const isInApp = useSyncExternalStore(subscribeNever, inAppSnapshot, () => false);
  // email_exists 는 예전 이메일 계정이 있다는 뜻이라 비밀번호 폼을 바로 펼친다
  const [showPassword, setShowPassword] = useState(params.get("error") === "email_exists");
  const [inviteCode, setInviteCode] = useState("");
  const [oauthMessage, setOauthMessage] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [linkPrompt, setLinkPrompt] = useState(false);
  const [message, setMessage] = useState("");
  const logout = useLogout();

  async function handleGoogle() {
    setOauthMessage("");
    setIsStarting(true);
    try {
      await startOAuth({ intent: "login", returnTo, inviteCode });
    } catch (error) {
      setOauthMessage(oauthStartErrorMessage(error, "login"));
      setIsStarting(false);
    }
  }

  function handlePasswordSignedIn(signedIn: HoondokUser) {
    completeSignIn(queryClient, signedIn, false);
    // 비밀번호뿐인 계정이면 바로 떠나지 않고 구글 연결을 한 번 권한다
    const hasOtherMethod = (signedIn.login_methods ?? []).some((method) => method.provider !== "password");
    if (hasOtherMethod) router.replace(returnTo);
    else setLinkPrompt(true);
  }

  function handleLogout() {
    // 공용 기기에서 다음 사람이 앞 사람의 질문·읽던 위치를 보지 않게 기기 기록도 함께 지운다.
    logout.mutate(
      { clearDevice: true },
      { onError: () => setMessage("로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.") },
    );
  }

  if (linkPrompt) return <LinkPrompt returnTo={returnTo} onLater={() => router.replace(returnTo)} />;

  if (!isLoading && user) {
    return (
      <div className="card" role="status">
        <p className="greet">{user.display_name}님, 이미 로그인돼 있어요.</p>
        {message && <p role="status">{message}</p>}
        <div className="onb-cta">
          <Link className="btn btn-primary" href={returnTo}>
            계속하기
          </Link>
          <HoondokButton variant="ghost" onClick={handleLogout}>
            로그아웃
          </HoondokButton>
        </div>
      </div>
    );
  }

  return (
    <div className="form">
      {errorMessage && <ErrorHint message={errorMessage} />}
      {isInApp ? (
        <InAppBrowserNotice />
      ) : (
        <>
          <div className="onb-cta">
            <HoondokButton onClick={handleGoogle} isLoading={isStarting}>
              Google로 계속하기
            </HoondokButton>
          </div>
          {oauthMessage && <ErrorHint message={oauthMessage} />}
          <details>
            <summary>초대 코드가 있어요</summary>
            <label className="field">
              <span className="field__label">초대 코드</span>
              <input
                name="invite_code"
                autoComplete="off"
                autoCapitalize="off"
                maxLength={64}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
              <span className="field__help">베타 초대를 받았다면 입력해요. 없으면 비워 두세요</span>
            </label>
          </details>
        </>
      )}
      <div className="onb-cta">
        <Link className="btn btn-ghost" href="/">
          둘러보기 (로그인 없이)
        </Link>
      </div>
      {showPassword ? (
        <PasswordLoginForm onSignedIn={handlePasswordSignedIn} />
      ) : (
        <p className="form__switch">
          <button type="button" onClick={() => setShowPassword(true)}>
            예전에 이메일로 가입했어요
          </button>
        </p>
      )}
    </div>
  );
}

export default function HoondokOnboardingPage() {
  return (
    // `col--onb` = 첫 화면만 거터 24px (DES-PWA-003 §5 001 행). 다른 화면의 --gutter 20px 와 의도적으로 다르다.
    <section className="col col--onb">
      {/* 첫 화면 사진 히어로 (DES-PWA-003 §5 001 · 2026-09-22 DES-PWA-003-Q2 되돌림).
          글자를 올리지 않는 장식 사진이라 veil 위 텍스트는 없고 alt 는 장면만 말한다. */}
      <div className="shot onb-hero">
        <img src="/hoondok/photos/onboarding-sunlit-field.webp" alt="아침 햇살 속 들판" />
      </div>
      <p className="onb-eyebrow">독립 운영 베타</p>
      <h2 className="onb-title">
        아침 3분 훈독으로
        <br />
        오늘을 시작해요
      </h2>
      <p className="onb-lede">
        매일 말씀 한 편을 읽고, 완료를 기록하면 연속일이 쌓여요. 구글 계정으로 간단히 시작할 수 있어요.
      </p>
      <div className="sect">
        <Suspense fallback={null}>
          <OnboardingBody />
        </Suspense>
      </div>
      <p className="notice">
        베타 기간에는 구글 계정의 이름·이메일·식별번호만 저장하고 다른 곳에 쓰지 않아요. 이용약관·처리방침은 정식 안내 전입니다.
      </p>
    </section>
  );
}
