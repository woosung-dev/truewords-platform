import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPush = vi.fn();
let returnToParam: string | null = "/read";
let errorParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/onboarding",
  useSearchParams: () => ({
    get: (key: string) => (key === "returnTo" ? returnToParam : key === "error" ? errorParam : null),
  }),
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), oauthStart: vi.fn(), unlinkIdentity: vi.fn() },
}));

import OnboardingPage from "@/app/(hoondok)/onboarding/page";
import { identityAPI } from "@/features/identity/api";
import { onboardingHref, safeReturnTo } from "@/features/identity/gate";
import { isInAppBrowser } from "@/features/identity/oauth";
import { fetchCurrentUser } from "@/features/identity/use-current-user";

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  returnToParam = "/read";
  errorParam = null;
  vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "로그인이 필요합니다" }));
});

describe("returnTo 검증 (open redirect 방지)", () => {
  it("같은 origin 의 절대 경로만 허용하고 나머지는 홈으로", () => {
    expect(safeReturnTo("/read")).toBe("/read");
    expect(safeReturnTo("/?x=1")).toBe("/?x=1");
    expect(safeReturnTo("/")).toBe("/");
    // 웹 루트 이전 전 주소는 루트 경로로 바꾼다 (DEC-PWA-026)
    expect(safeReturnTo("/hoondok/read")).toBe("/read");
    expect(safeReturnTo("/hoondok")).toBe("/");
    expect(safeReturnTo("/hoondok?x=1")).toBe("/?x=1");
    expect(safeReturnTo("/hoondok/words/a?chunk=c1")).toBe("/words/a?chunk=c1");
    expect(safeReturnTo("/hoondokx")).toBe("/hoondokx");
    expect(safeReturnTo("/hoondok/onboarding")).toBe("/");
    expect(safeReturnTo("/hoondok//evil.example")).toBe("/");
    expect(safeReturnTo("/hoondok/\\evil.example")).toBe("/");
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "read",
      "javascript:alert(1)",
      "/onboarding",
      "/onboarding?returnTo=%2Fread",
      // 보안 점검 web-safe-return-to-control-char-open-redirect — URL 파서가 탭·줄바꿈을 지우면 `//evil.example`
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r//evil.example",
      "/hoondok/\t/evil.example",
      "/\u007f",
      "",
      null,
    ]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
    expect(onboardingHref("/read")).toBe("/onboarding?returnTo=%2Fread");
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

describe("온보딩 (구글 로그인 + 예전 이메일 로그인)", () => {
  const assign = vi.fn();
  const originalLocation = window.location;
  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, "location", { value: { ...originalLocation, assign, href: "https://t.example/onboarding" }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
    Reflect.deleteProperty(navigator, "userAgent");
  });

  it("가입 화면이 없고 구글 버튼·둘러보기·저장 항목 안내를 보인다", async () => {
    render(wrap(<OnboardingPage />));
    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /둘러보기/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("img", { name: "아침 햇살 속 들판" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/이름/)).toBeNull();
    expect(screen.queryByRole("button", { name: "가입하기" })).toBeNull();
    expect(screen.getByText(/구글 계정의 이름·이메일·식별번호/)).toBeInTheDocument();
    expect(screen.queryByLabelText("비밀번호")).toBeNull();
  });

  it("구글 버튼은 login 의도·returnTo·초대 코드로 start 를 부르고 인증 주소로 이동한다", async () => {
    vi.mocked(identityAPI.oauthStart).mockResolvedValueOnce({ authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
    render(wrap(<OnboardingPage />));
    fireEvent.click(screen.getByText("초대 코드가 있어요"));
    fireEvent.change(screen.getByLabelText(/초대 코드/), { target: { value: "  새벽-2026 " } });
    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
    expect(identityAPI.oauthStart).toHaveBeenCalledWith("google", {
      intent: "login",
      return_to: "/read",
      invite_code: "새벽-2026",
    });
  });

  it("초대 코드를 비우면 invite_code 를 보내지 않고, 외부 returnTo 는 홈으로 바꾼다", async () => {
    returnToParam = "https://evil.example/x";
    vi.mocked(identityAPI.oauthStart).mockResolvedValueOnce({ authorization_url: "https://g.example/a" });
    render(wrap(<OnboardingPage />));
    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(identityAPI.oauthStart).toHaveBeenCalledWith("google", { intent: "login", return_to: "/" });
  });

  it("start 실패(구글 미설정·네트워크)는 안내하고 이동하지 않는다", async () => {
    vi.mocked(identityAPI.oauthStart).mockRejectedValueOnce(
      new ApiError(404, { error_code: "OAUTH_PROVIDER_UNAVAILABLE", message: "x" }),
    );
    render(wrap(<OnboardingPage />));
    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("지금은 구글 로그인을 쓸 수 없어요");
    expect(assign).not.toHaveBeenCalled();
    vi.mocked(identityAPI.oauthStart).mockRejectedValueOnce(new TypeError("fetch failed"));
    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요"));
  });

  it("?error=email_exists 면 문구를 보이고 비밀번호 폼을 바로 펼친다", () => {
    errorParam = "email_exists";
    render(wrap(<OnboardingPage />));
    expect(screen.getByRole("alert")).toHaveTextContent("이 이메일로 가입한 계정이 있어요");
    expect(screen.getByRole("form", { name: "이메일 로그인" })).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
  });

  it("다른 오류 코드는 코드별 문구를, 모르는 코드는 일반 실패 문구를 보인다", () => {
    errorParam = "cancelled";
    const first = render(wrap(<OnboardingPage />));
    expect(screen.getByRole("alert")).toHaveTextContent("취소");
    expect(screen.queryByLabelText("비밀번호")).toBeNull();
    first.unmount();
    errorParam = "weird";
    render(wrap(<OnboardingPage />));
    expect(screen.getByRole("alert")).toHaveTextContent("구글 로그인을 마치지 못했어요");
  });

  it("인앱 브라우저는 구글 버튼 대신 안내와 주소 복사를 보이고 비밀번호 경로는 남는다", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 KAKAOTALK 10.4.0",
      configurable: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(wrap(<OnboardingPage />));
    expect(await screen.findByText("다른 브라우저(Chrome·Safari)로 열어 주세요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google로 계속하기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "주소 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://t.example/onboarding"));
    expect(screen.getByRole("button", { name: "예전에 이메일로 가입했어요" })).toBeInTheDocument();
  });

  it("isInAppBrowser 는 인앱·웹뷰 UA 만 가린다", () => {
    for (const ua of [
      "... KAKAOTALK 10.0",
      "... NAVER(inapp; search; 1000)",
      "... Instagram 300.0",
      "[FBAN/FBIOS;FBAV/400]",
      "Mozilla/5.0 Line/13.0",
      "Mozilla/5.0 (Linux; Android 13; Pixel; wv) AppleWebKit/537.36",
    ])
      expect(isInAppBrowser(ua), ua).toBe(true);
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0) Chrome/128 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
    ])
      expect(isInAppBrowser(ua), ua).toBe(false);
  });

  async function openPasswordForm() {
    render(wrap(<OnboardingPage />));
    fireEvent.click(screen.getByRole("button", { name: "예전에 이메일로 가입했어요" }));
    fireEvent.change(await screen.findByLabelText("이메일"), { target: { value: "old@example.com" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password1" } });
    fireEvent.submit(screen.getByRole("form", { name: "이메일 로그인" }));
  }

  it("비밀번호 로그인에 구글이 이미 연결돼 있으면 바로 returnTo 로 간다", async () => {
    vi.mocked(identityAPI.login).mockResolvedValueOnce({
      user: {
        ...USER,
        login_methods: [
          { provider: "password", identity_id: null },
          { provider: "google", identity_id: "i1", email: "a@gmail.com" },
        ],
      },
    });
    await openPasswordForm();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/read"));
    expect(identityAPI.login).toHaveBeenCalledWith({ email: "old@example.com", password: "password1" });
  });

  it("비밀번호뿐인 계정은 연결 안내를 보이고, 연결하기는 link 의도로 start 를 부른다", async () => {
    vi.mocked(identityAPI.login).mockResolvedValueOnce({
      user: { ...USER, login_methods: [{ provider: "password", identity_id: null }] },
    });
    vi.mocked(identityAPI.oauthStart).mockResolvedValueOnce({ authorization_url: "https://g.example/link" });
    await openPasswordForm();
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결하기" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://g.example/link"));
    expect(identityAPI.oauthStart).toHaveBeenCalledWith("google", { intent: "link", return_to: "/read" });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("연결 안내에서 나중에 할게요는 returnTo 로 이동한다", async () => {
    vi.mocked(identityAPI.login).mockResolvedValueOnce({ user: { ...USER, login_methods: [] } });
    await openPasswordForm();
    fireEvent.click(await screen.findByRole("button", { name: "나중에 할게요" }));
    expect(mockReplace).toHaveBeenCalledWith("/read");
    expect(identityAPI.oauthStart).not.toHaveBeenCalled();
  });

  it("401 · 네트워크 오류를 구분해 안내한다", async () => {
    vi.mocked(identityAPI.login).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    await openPasswordForm();
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다");
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull();
    vi.mocked(identityAPI.login).mockRejectedValueOnce(new TypeError("fetch failed"));
    fireEvent.submit(screen.getByRole("form", { name: "이메일 로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요"));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("이미 로그인이면 폼 대신 계속하기·로그아웃을 보인다", async () => {
    vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
    vi.mocked(identityAPI.logout).mockResolvedValue({});
    render(wrap(<OnboardingPage />));
    expect(await screen.findByRole("status")).toHaveTextContent("효진님, 이미 로그인돼 있어요");
    expect(screen.getByRole("link", { name: "계속하기" })).toHaveAttribute("href", "/read");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("button", { name: "Google로 계속하기" });
    expect(identityAPI.logout).toHaveBeenCalledOnce();
  });
});
