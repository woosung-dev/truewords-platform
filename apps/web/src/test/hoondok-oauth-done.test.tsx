import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, prefetch: vi.fn() }),
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn() } }));
vi.mock("@/features/identity/device-owner", () => ({ claimDeviceForUser: vi.fn() }));
// 카드 기능 플래그와 무관하게 가입 직후 이동 규칙만 본다
vi.mock("@/features/hoondok/personal/start", () => ({
  afterSignupHref: (next: string) => (next === "/" ? "/start" : next),
}));

import OnboardingDonePage from "@/app/(hoondok)/onboarding/done/page";
import { identityAPI } from "@/features/identity/api";
import { claimDeviceForUser } from "@/features/identity/device-owner";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";

const USER = { id: "u1", email: "a@b.c", display_name: "효진", login_methods: [] };

let client: QueryClient;
async function renderDone(params: Record<string, string>) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={client}>
      <OnboardingDonePage searchParams={Promise.resolve(params)} />
    </QueryClientProvider>
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui);
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
});

describe("구글 로그인 도착 페이지 (/onboarding/done)", () => {
  it("signed_in 은 기존 계정으로 기기 기록을 확인하고 returnTo 로 간다", async () => {
    await renderDone({ status: "signed_in", returnTo: "/read" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/read"));
    expect(claimDeviceForUser).toHaveBeenCalledWith("u1", false);
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(USER);
  });

  it("created 는 새 계정으로 기기 기록을 이어받고 가입 직후 규칙으로 이동한다", async () => {
    await renderDone({ status: "created" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/start"));
    expect(claimDeviceForUser).toHaveBeenCalledWith("u1", true);
  });

  it("created 에 returnTo 가 있으면 그쪽이 먼저다", async () => {
    await renderDone({ status: "created", returnTo: "/ask" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/ask"));
  });

  it("외부·잘못된 returnTo 는 홈(/)으로 처리한다", async () => {
    await renderDone({ status: "signed_in", returnTo: "https://evil.example/x" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
  });

  it("linked 는 me 캐시를 갱신하고 device claim 없이 returnTo, 없으면 설정으로 간다", async () => {
    const first = await renderDone({ status: "linked", returnTo: "/read" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/read"));
    expect(claimDeviceForUser).not.toHaveBeenCalled();
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(USER);
    first.unmount();
    mockReplace.mockClear();
    await renderDone({ status: "linked" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/settings"));
  });

  it("error 는 코드와 검증된 returnTo 를 들고 온보딩으로 replace 한다", async () => {
    await renderDone({ error: "email_exists", returnTo: "/read" });
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/onboarding?error=email_exists&returnTo=%2Fread"),
    );
    expect(identityAPI.me).not.toHaveBeenCalled();
  });

  it("사용자 조회가 401 이거나 실패하면 failed 로 보낸다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    const first = await renderDone({ status: "signed_in", returnTo: "/read" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding?error=failed&returnTo=%2Fread"));
    expect(claimDeviceForUser).not.toHaveBeenCalled();
    first.unmount();
    mockReplace.mockClear();
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new TypeError("fetch failed"));
    await renderDone({ status: "signed_in" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding?error=failed&returnTo=%2F"));
  });

  it("status 도 error 도 없으면 failed 로 보낸다", async () => {
    await renderDone({});
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding?error=failed&returnTo=%2F"));
  });
});
