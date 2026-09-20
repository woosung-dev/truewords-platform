"use client";

// SCR-PWA-001 온보딩 최소형 — 베타 고지 · 가입 · 로그인. 교회 선택·약관 동의 체크는 비범위(DEC-PWA-001 확정 전).
// 초대 코드 1칸(Phase 3 F)은 선택 입력 — 서버 HOONDOK_INVITE_CODE 가 설정된 환경에서만 403 INVITE_REQUIRED 로 요구된다.
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { SUMMARY_KEY } from "@/features/hoondok/use-missions";
import { identityAPI } from "@/features/identity/api";
import { safeReturnTo } from "@/features/identity/gate";
import { CURRENT_USER_KEY, useCurrentUser } from "@/features/identity/use-current-user";

type Mode = "signup" | "login";

function messageFor(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    // 403 은 CSRF 와 겹치므로 상태가 아니라 error_code 로 구분한다
    if (error.errorCode === "INVITE_REQUIRED") return "초대 코드가 필요해요. 초대받은 코드를 확인해 주세요";
    if (error.status === 401) return "이메일 또는 비밀번호가 올바르지 않습니다";
    if (error.status === 409) return "이미 가입된 이메일이에요. 로그인해 주세요";
    if (error.status === 422)
      return mode === "signup" ? "이메일 형식과 비밀번호(8자 이상)를 확인해 주세요" : "입력값을 확인해 주세요";
  }
  return "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요";
}

function OnboardingForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const { user, isLoading } = useCurrentUser();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      const { user: signedIn } =
        mode === "signup"
          ? await identityAPI.signup({
              email,
              password,
              display_name: displayName,
              // 비워 두면 보내지 않는다 — 게이트 OFF 환경의 페이로드는 그대로다
              ...(inviteCode.trim() ? { invite_code: inviteCode.trim() } : {}),
            })
          : await identityAPI.login({ email, password });
      // 계정이 바뀌었으므로 이전 계정의 요약을 재사용하지 않는다. 소급 POST 는 돌아간 화면의 훅이 한다.
      queryClient.setQueryData(CURRENT_USER_KEY, signedIn);
      queryClient.removeQueries({ queryKey: SUMMARY_KEY });
      router.replace(returnTo);
    } catch (error) {
      setMessage(messageFor(error, mode));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await identityAPI.logout();
    } catch {
      // 만료된 쿠키여도 화면은 로그아웃 상태로 둔다
    }
    queryClient.setQueryData(CURRENT_USER_KEY, null);
    queryClient.removeQueries({ queryKey: SUMMARY_KEY });
  }

  if (!isLoading && user) {
    return (
      <div className="card" role="status">
        <p className="greet">{user.display_name}님, 이미 로그인돼 있어요.</p>
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
    <form className="form" onSubmit={handleSubmit} aria-label={mode === "signup" ? "가입" : "로그인"}>
      {mode === "signup" && (
        <label className="field">
          <span className="field__label">이름</span>
          <input
            name="display_name"
            autoComplete="nickname"
            maxLength={64}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <span className="field__help">홈 인사에 쓰여요. 실명이 아니어도 괜찮아요</span>
        </label>
      )}
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
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signup" && <span className="field__help">8자 이상. 재설정은 베타 기간 운영자에게 요청해요</span>}
      </label>
      {mode === "signup" && (
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
      )}
      {/* 오류는 색만으로 알리지 않는다(DES §3.3) — 아이콘 + 문장. 정성 시트 폼과 같은 `.hint--alert` 를 쓴다.
          입력값은 state 에 남아 있어 그대로 다시 낼 수 있다(REQ-PWA-013). */}
      {message && (
        <p className="hint hint--alert" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {message}
        </p>
      )}
      <div className="onb-cta">
        {/* 저장 중에는 라벨을 유지한 채 중복 제출만 막는다 (DES §1.5 loading) */}
        <HoondokButton type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {mode === "signup" ? "가입하고 시작하기" : "로그인"}
        </HoondokButton>
        <Link className="btn btn-ghost" href="/hoondok">
          둘러보기 (로그인 없이)
        </Link>
      </div>
      <p className="form__switch">
        {mode === "signup" ? "이미 계정이 있어요? " : "처음이에요? "}
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "로그인" : "가입하기"}
        </button>
      </p>
    </form>
  );
}

export default function HoondokOnboardingPage() {
  return (
    // `col--onb` = 첫 화면만 거터 24px (DES-PWA-003 §5 001 행). 다른 화면의 --gutter 20px 와 의도적으로 다르다.
    <section className="col col--onb">
      <p className="onb-eyebrow">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
      <h2 className="onb-title">
        아침 3분 훈독으로
        <br />
        오늘을 시작해요
      </h2>
      <p className="onb-lede">
        매일 말씀 한 편을 읽고, 완료를 기록하면 연속일이 쌓여요. 이메일과 비밀번호만 있으면 돼요.
      </p>
      <div className="sect">
        <Suspense fallback={null}>
          <OnboardingForm />
        </Suspense>
      </div>
      <p className="notice">
        베타 기간에는 이름·이메일만 저장하고 다른 곳에 쓰지 않아요. 이용약관·처리방침은 정식 안내 전입니다.
      </p>
    </section>
  );
}
