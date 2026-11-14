"use client";

// 가입 직후 표시 이름 확인 — /onboarding/done 이 새 계정(status=created)일 때 보낸다.
// 구글 계정 이름을 그대로 가져왔으므로 한 번 보여 주고 고칠 기회를 준다. 설정의 "이름" 항목에서도 같은 폼으로 바꿀 수 있다.
// returnTo 는 safeReturnTo 로 다시 검증하고, 끝나면 가입 직후 규칙(afterSignupHref)으로 보낸다.
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect } from "react";
import { HoondokButton } from "@/components/hoondok";
import { afterSignupHref } from "@/features/hoondok/personal/start";
import { DisplayNameForm } from "@/features/identity/display-name-form";
import { onboardingHref, safeReturnTo } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function NameNotice() {
  return (
    <p className="card" role="status">
      계정 정보를 불러오고 있어요…
    </p>
  );
}

function NameBody({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = use(searchParams);
  const router = useRouter();
  const returnTo = safeReturnTo(first(params.returnTo));
  const { user, isLoading, isError, refetch } = useCurrentUser();
  // 401(null)만 미로그인이다. 네트워크 오류는 미로그인으로 오판하지 않고 다시 시도를 보인다
  const signedOut = !isLoading && !isError && !user;

  useEffect(() => {
    if (signedOut) router.replace(onboardingHref(returnTo));
  }, [signedOut, returnTo, router]);

  if (isError && !user) {
    return (
      <div className="card" role="alert">
        <p className="field__help">계정 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>
        <div className="onb-cta">
          <HoondokButton variant="ghost" onClick={() => void refetch()}>
            다시 시도
          </HoondokButton>
        </div>
      </div>
    );
  }
  if (!user) return <NameNotice />;

  return (
    <DisplayNameForm
      key={user.id}
      initialName={user.display_name}
      submitLabel="이 이름으로 시작"
      formLabel="표시 이름 확인"
      help="설정에서 언제든 바꿀 수 있어요"
      onDone={() => router.replace(afterSignupHref(returnTo))}
    />
  );
}

export default function OnboardingNamePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <section className="col col--onb">
      <h2 className="onb-title">이렇게 불러 드릴까요?</h2>
      <p className="onb-lede">구글 계정의 이름을 가져왔어요. 다르게 불리고 싶으면 고쳐 주세요.</p>
      <div className="sect">
        <Suspense fallback={<NameNotice />}>
          <NameBody searchParams={searchParams} />
        </Suspense>
      </div>
    </section>
  );
}
