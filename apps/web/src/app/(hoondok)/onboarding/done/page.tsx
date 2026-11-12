"use client";

// 구글 콜백 도착 페이지 — 서버가 /onboarding/done?status=…|error=… 로 302 한다. 화면은 잠깐 안내만 보이고 곧 이동한다.
// code·state 는 서버가 처리하고 이 주소에 담기지 않는다. returnTo 는 safeReturnTo 로 다시 검증한다.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useRef } from "react";
import { afterSignupHref } from "@/features/hoondok/personal/start";
import { completeSignIn } from "@/features/identity/after-sign-in";
import { safeReturnTo } from "@/features/identity/gate";
import { CURRENT_USER_KEY, fetchCurrentUser } from "@/features/identity/use-current-user";

type SearchParams = Record<string, string | string[] | undefined>;

const SETTINGS_PATH = "/settings";

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function onboardingErrorHref(error: string, returnTo: string): string {
  return `/onboarding?error=${encodeURIComponent(error)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function DoneNotice() {
  return (
    <p className="card" role="status">
      로그인을 마무리하고 있어요…
    </p>
  );
}

function DoneRunner({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = use(searchParams);
  const router = useRouter();
  const queryClient = useQueryClient();
  const started = useRef(false);

  const status = first(params.status);
  const error = first(params.error);
  const rawReturnTo = first(params.returnTo);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const returnTo = safeReturnTo(rawReturnTo);

    if (error) {
      router.replace(onboardingErrorHref(error, returnTo));
      return;
    }
    if (status !== "signed_in" && status !== "created" && status !== "linked") {
      router.replace(onboardingErrorHref("failed", returnTo));
      return;
    }

    void (async () => {
      try {
        const user = await fetchCurrentUser();
        // 쿠키가 안 붙었으면 null — 로그인된 것으로 다루지 않는다
        if (!user) {
          router.replace(onboardingErrorHref("failed", returnTo));
          return;
        }
        if (status === "linked") {
          queryClient.setQueryData(CURRENT_USER_KEY, user);
          // returnTo 가 없으면 연결을 시작한 설정 화면으로 돌아간다
          router.replace(rawReturnTo ? returnTo : SETTINGS_PATH);
          return;
        }
        // 기기에 남은 앞 사람의 기록 정리까지 비밀번호 로그인과 같은 함수가 맡는다
        completeSignIn(queryClient, user, status === "created");
        // 가입 직후 돌아갈 곳이 기본값(홈)이면 맞춤 첫 말씀 질문으로 보낸다. returnTo 가 따로 있으면 그쪽이 먼저다
        router.replace(status === "created" ? afterSignupHref(returnTo) : returnTo);
      } catch {
        router.replace(onboardingErrorHref("failed", returnTo));
      }
    })();
  }, [error, rawReturnTo, router, queryClient, status]);

  return <DoneNotice />;
}

export default function OnboardingDonePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <section className="col col--onb">
      <div className="sect">
        <Suspense fallback={<DoneNotice />}>
          <DoneRunner searchParams={searchParams} />
        </Suspense>
      </div>
    </section>
  );
}
