import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { me: vi.fn(), oauthStart: vi.fn(), unlinkIdentity: vi.fn() },
}));

import { LoginMethodsCard } from "@/features/hoondok/settings/components/login-methods-card";
import { identityAPI } from "@/features/identity/api";
import type { HoondokUser } from "@/features/identity/types";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";

const PASSWORD = { provider: "password", identity_id: null };
const GOOGLE = { provider: "google", identity_id: "i1", email: "g@gmail.com" };
const base = { id: "u1", email: "a@b.c", display_name: "효진" };

let client: QueryClient;
function renderCard(user: HoondokUser) {
  vi.mocked(identityAPI.me).mockResolvedValue({ user });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={client}>
      <LoginMethodsCard />
    </QueryClientProvider>
  );
  return render(ui);
}

const assign = vi.fn();
const originalLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { ...originalLocation, assign }, configurable: true });
});
afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
});

describe("로그인 수단 카드", () => {
  it("구글 이메일과 비밀번호 안내를 보이고, 수단이 둘이면 해제할 수 있다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD, GOOGLE] });
    expect(await screen.findByText("g@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("이전 방식이에요. 구글을 연결하면 사라져요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "구글 계정 연결" })).toBeNull();
    vi.mocked(identityAPI.unlinkIdentity).mockResolvedValueOnce(undefined);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "구글 연결 해제" }));
    await waitFor(() => expect(identityAPI.unlinkIdentity).toHaveBeenCalledWith("i1"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: CURRENT_USER_KEY }));
  });

  it("수단이 하나뿐이면 해제 버튼을 잠그고 안내한다", async () => {
    renderCard({ ...base, login_methods: [GOOGLE] });
    const unlink = await screen.findByRole("button", { name: "구글 연결 해제" });
    expect(unlink).toBeDisabled();
    expect(screen.getByText(/마지막 로그인 수단은 해제할 수 없어요/)).toBeInTheDocument();
  });

  it("서버가 409 를 주면 안내로 처리한다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD, GOOGLE] });
    vi.mocked(identityAPI.unlinkIdentity).mockRejectedValueOnce(
      new ApiError(409, { error_code: "LAST_LOGIN_METHOD", message: "x" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "구글 연결 해제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("마지막 로그인 수단은 해제할 수 없어요");
  });

  it("비밀번호 수단이 있으면 연결을 누를 때 비밀번호 확인 입력을 펼치고, 입력 전에는 start 를 부르지 않는다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD] });
    expect(screen.queryByLabelText("비밀번호 확인")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결" }));
    expect(await screen.findByLabelText("비밀번호 확인")).toHaveAttribute("type", "password");
    expect(identityAPI.oauthStart).not.toHaveBeenCalled();
  });

  it("확인한 비밀번호를 link 의도·설정 returnTo 와 함께 start 로 보내고, 저장소에는 남기지 않는다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD] });
    vi.mocked(identityAPI.oauthStart).mockResolvedValueOnce({ authorization_url: "https://g.example/link" });
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결" }));
    fireEvent.change(await screen.findByLabelText("비밀번호 확인"), { target: { value: "password1" } });
    fireEvent.submit(screen.getByRole("form", { name: "구글 연결을 위한 비밀번호 확인" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://g.example/link"));
    expect(identityAPI.oauthStart).toHaveBeenCalledWith("google", {
      intent: "link",
      return_to: "/settings",
      password: "password1",
    });
    for (const store of [window.localStorage, window.sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toContain("password1");
    }
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("password1");
  });

  it("401 REAUTH_REQUIRED 면 비밀번호가 올바르지 않다고 안내하고 이동하지 않는다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD] });
    vi.mocked(identityAPI.oauthStart).mockRejectedValueOnce(
      new ApiError(401, { error_code: "REAUTH_REQUIRED", message: "x" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결" }));
    fireEvent.change(await screen.findByLabelText("비밀번호 확인"), { target: { value: "wrong-pass" } });
    fireEvent.submit(screen.getByRole("form", { name: "구글 연결을 위한 비밀번호 확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("비밀번호가 올바르지 않아요");
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByLabelText("비밀번호 확인")).toHaveValue(""); // 다시 입력할 수 있게 비우고 폼은 유지한다
  });

  it("비밀번호 확인 폼의 취소는 입력을 닫고 비우며 start 를 부르지 않는다", async () => {
    renderCard({ ...base, login_methods: [PASSWORD] });
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결" }));
    fireEvent.change(await screen.findByLabelText("비밀번호 확인"), { target: { value: "typed-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("비밀번호 확인")).toBeNull();
    expect(identityAPI.oauthStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "구글 계정 연결" }));
    expect(await screen.findByLabelText("비밀번호 확인")).toHaveValue("");
  });

  it("비밀번호 수단이 없는 계정은 확인 입력 없이 바로 start 를 부른다", async () => {
    renderCard({ ...base, login_methods: [{ provider: "kakao", identity_id: "k1", email: "k@kakao.com" }] });
    vi.mocked(identityAPI.oauthStart).mockResolvedValueOnce({ authorization_url: "https://g.example/link" });
    fireEvent.click(await screen.findByRole("button", { name: "구글 계정 연결" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://g.example/link"));
    expect(identityAPI.oauthStart).toHaveBeenCalledWith("google", { intent: "link", return_to: "/settings" });
    expect(screen.queryByLabelText("비밀번호 확인")).toBeNull();
  });

  it("비로그인이면 아무것도 그리지 않는다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValue(new ApiError(401, { message: "x" }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <LoginMethodsCard />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
