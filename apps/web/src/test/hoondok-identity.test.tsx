import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPush = vi.fn();
let returnToParam: string | null = "/hoondok/read";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/hoondok/onboarding",
  useSearchParams: () => ({ get: (key: string) => (key === "returnTo" ? returnToParam : null) }),
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import OnboardingPage from "@/app/(hoondok)/hoondok/onboarding/page";
import { identityAPI } from "@/features/identity/api";
import { onboardingHref, safeReturnTo } from "@/features/identity/gate";
import { fetchCurrentUser } from "@/features/identity/use-current-user";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  returnToParam = "/hoondok/read";
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
});

describe("returnTo 검증 (open redirect 방지)", () => {
  it("/hoondok 아래만 허용하고 나머지는 홈으로", () => {
    expect(safeReturnTo("/hoondok/read")).toBe("/hoondok/read");
    expect(safeReturnTo("/hoondok?x=1")).toBe("/hoondok?x=1");
    expect(safeReturnTo("/hoondok")).toBe("/hoondok");
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/login",
      "/hoondokx",
      "/hoondok/onboarding",
      "",
      null,
    ]) {
      expect(safeReturnTo(bad)).toBe("/hoondok");
    }
    expect(onboardingHref("/hoondok/read")).toBe("/hoondok/onboarding?returnTo=%2Fhoondok%2Fread");
  });
});

describe("fetchCurrentUser", () => {
  it("401 은 null, 5xx·네트워크는 error 로 남긴다 (오프라인 ≠ 미인증)", async () => {
    expect(await fetchCurrentUser()).toBeNull();
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new ApiError(503, { message: "down" }));
    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(ApiError);
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(TypeError);
    vi.mocked(identityAPI.me).mockResolvedValueOnce({ user: USER });
    expect(await fetchCurrentUser()).toEqual(USER);
  });
});

describe("온보딩 (SCR-PWA-001 최소형)", () => {
  async function fillAndSubmit(mode: "signup" | "login") {
    if (mode === "login") fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    else await screen.findByRole("form", { name: "가입" });
    if (mode === "signup") fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "새벽" } });
    fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "password1" } });
    fireEvent.submit(screen.getByRole("form"));
  }

  it("베타 고지를 보이고, 가입 성공 시 returnTo 로 돌아간다", async () => {
    vi.mocked(identityAPI.signup).mockResolvedValueOnce({ user: USER });
    render(wrap(<OnboardingPage />));
    expect(screen.getByText(/독립 운영 베타/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull(); // 교회 선택 없음
    await fillAndSubmit("signup");
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/hoondok/read"));
    expect(identityAPI.signup).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "password1",
      display_name: "새벽",
    });
  });

  it("외부 returnTo 는 홈으로 대체한다", async () => {
    returnToParam = "https://evil.example/x";
    vi.mocked(identityAPI.login).mockResolvedValueOnce({ user: USER });
    render(wrap(<OnboardingPage />));
    await fillAndSubmit("login");
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/hoondok"));
  });

  it("409 · 401 · 네트워크 오류를 구분해 안내한다", async () => {
    vi.mocked(identityAPI.signup).mockRejectedValueOnce(new ApiError(409, { message: "이미 등록된 이메일입니다" }));
    render(wrap(<OnboardingPage />));
    await fillAndSubmit("signup");
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 가입된 이메일");
    // 색만으로 오류를 알리지 않는다 (DES §3.3) — 아이콘이 함께 있다
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull();

    vi.mocked(identityAPI.login).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    await fillAndSubmit("login");
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다");

    vi.mocked(identityAPI.login).mockRejectedValueOnce(new TypeError("fetch failed"));
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("초대 코드는 가입 모드에만 있고, 입력하면 공백을 다듬어 invite_code 로 보낸다", async () => {
    vi.mocked(identityAPI.signup).mockResolvedValueOnce({ user: USER });
    render(wrap(<OnboardingPage />));
    await screen.findByRole("form", { name: "가입" });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.queryByLabelText(/초대 코드/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "새벽" } });
    fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText(/초대 코드/), { target: { value: "  새벽-2026 " } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() =>
      expect(identityAPI.signup).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "password1",
        display_name: "새벽",
        invite_code: "새벽-2026",
      }),
    );
  });

  it("403 INVITE_REQUIRED 는 error_code 로 구분해 초대 코드 안내를 보인다", async () => {
    vi.mocked(identityAPI.signup).mockRejectedValueOnce(
      new ApiError(403, { error_code: "INVITE_REQUIRED", message: "초대 코드가 필요해요" }),
    );
    render(wrap(<OnboardingPage />));
    await fillAndSubmit("signup");
    expect(await screen.findByRole("alert")).toHaveTextContent("초대 코드가 필요해요. 초대받은 코드를 확인해 주세요");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("제출 중에는 라벨을 유지한 채 잠그고 aria-busy 로 진행을 알린다", async () => {
    let settle: (value: { user: typeof USER }) => void = () => {};
    vi.mocked(identityAPI.signup).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(wrap(<OnboardingPage />));
    await fillAndSubmit("signup");
    const submit = screen.getByRole("button", { name: "가입하고 시작하기" });
    await waitFor(() => expect(submit).toHaveAttribute("aria-busy", "true"));
    expect(submit).toBeDisabled();
    settle({ user: USER });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/hoondok/read"));
  });

  it("이미 로그인이면 폼 대신 계속하기·로그아웃을 보인다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(identityAPI.logout).mockResolvedValue({});
    render(wrap(<OnboardingPage />));
    expect(await screen.findByRole("status")).toHaveTextContent("효진님, 이미 로그인돼 있어요");
    expect(screen.getByRole("link", { name: "계속하기" })).toHaveAttribute("href", "/hoondok/read");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("form", { name: "가입" });
    expect(identityAPI.logout).toHaveBeenCalledOnce();
  });
});
