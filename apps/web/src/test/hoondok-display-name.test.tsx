import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/features/identity/api", () => ({ identityAPI: { me: vi.fn(), updateProfile: vi.fn() } }));
// 카드 기능 플래그와 무관하게 가입 직후 이동 규칙만 본다
vi.mock("@/features/hoondok/personal/start", () => ({
  afterSignupHref: (next: string) => (next === "/" ? "/start" : next),
}));

import OnboardingNamePage from "@/app/(hoondok)/onboarding/name/page";
import { DisplayNameCard } from "@/features/hoondok/settings/components/display-name-card";
import { identityAPI } from "@/features/identity/api";
import { CURRENT_USER_KEY } from "@/features/identity/use-current-user";

const USER = { id: "u1", email: "a@b.c", display_name: "Hyojin Kim", login_methods: [] };

let client: QueryClient;
async function renderWithClient(ui: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return view;
}

function renderNamePage(params: Record<string, string>) {
  return renderWithClient(<OnboardingNamePage searchParams={Promise.resolve(params)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 앞 테스트가 소비하지 않은 mock*Once 가 넘어오지 않게 한다
  vi.mocked(identityAPI.updateProfile).mockReset();
  vi.mocked(identityAPI.me).mockReset();
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
});

describe("가입 직후 이름 확인 (/onboarding/name)", () => {
  it("구글 이름을 미리 채운다", async () => {
    await renderNamePage({ returnTo: "/read" });
    expect(screen.getByRole("heading", { name: "이렇게 불러 드릴까요?" })).toBeInTheDocument();
    expect(await screen.findByLabelText("이름")).toHaveValue("Hyojin Kim");
  });

  it("바꾼 이름을 앞뒤 공백 없이 저장하고 me 캐시를 갱신한 뒤 가입 직후 규칙으로 간다", async () => {
    const updated = { ...USER, display_name: "효진" };
    vi.mocked(identityAPI.updateProfile).mockResolvedValueOnce({ user: updated });
    await renderNamePage({});
    fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "  효진 " } });
    fireEvent.click(screen.getByRole("button", { name: "이 이름으로 시작" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/start"));
    expect(identityAPI.updateProfile).toHaveBeenCalledWith("효진");
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(updated);
  });

  it("이름을 그대로 두면 API 없이 returnTo 로 간다(외부 주소는 홈 규칙)", async () => {
    const first = await renderNamePage({ returnTo: "/ask" });
    fireEvent.click(await screen.findByRole("button", { name: "이 이름으로 시작" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/ask"));
    expect(identityAPI.updateProfile).not.toHaveBeenCalled();
    first.unmount();
    mockReplace.mockClear();
    await renderNamePage({ returnTo: "https://evil.example/x" });
    fireEvent.click(await screen.findByRole("button", { name: "이 이름으로 시작" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/start"));
  });

  it("저장이 실패하면 입력을 남기고 오류를 보이며 이동하지 않는다", async () => {
    vi.mocked(identityAPI.updateProfile).mockRejectedValueOnce(new TypeError("fetch failed"));
    await renderNamePage({ returnTo: "/read" });
    const input = await screen.findByLabelText("이름");
    fireEvent.change(input, { target: { value: "새벽" } });
    fireEvent.click(screen.getByRole("button", { name: "이 이름으로 시작" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했어요");
    expect(input).toHaveValue("새벽");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("서버가 422 를 주면 길이 안내를 보인다", async () => {
    vi.mocked(identityAPI.updateProfile).mockRejectedValueOnce(new ApiError(422, { message: "x" }));
    await renderNamePage({});
    fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "새벽" } });
    fireEvent.click(screen.getByRole("button", { name: "이 이름으로 시작" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이름은 1~64자로 입력해 주세요");
  });

  it("공백만 입력하면 서버를 부르지 않고 안내한다", async () => {
    await renderNamePage({});
    fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이 이름으로 시작" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이름을 입력해 주세요");
    expect(identityAPI.updateProfile).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("로그인돼 있지 않으면 returnTo 를 들고 온보딩으로 보낸다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    await renderNamePage({ returnTo: "/read" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding?returnTo=%2Fread"));
  });

  it("사용자 조회가 네트워크 오류면 미로그인으로 보지 않고 다시 시도를 보인다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new TypeError("fetch failed"));
    await renderNamePage({});
    expect(await screen.findByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("설정 — 이름 항목", () => {
  it("지금 이름을 보이고 바꾸면 저장 후 새 이름을 보인다", async () => {
    vi.mocked(identityAPI.updateProfile).mockResolvedValueOnce({ user: { ...USER, display_name: "효진" } });
    await renderWithClient(<DisplayNameCard />);
    expect(await screen.findByText("Hyojin Kim")).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    const input = screen.getByLabelText("이름");
    expect(input).toHaveValue("Hyojin Kim");
    fireEvent.change(input, { target: { value: "효진" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("이름을 바꿨어요")).toBeInTheDocument();
    expect(identityAPI.updateProfile).toHaveBeenCalledWith("효진");
    expect(screen.getByText("효진")).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).toBeNull();
  });

  it("취소하면 폼을 닫고, 실패하면 입력을 남긴다", async () => {
    vi.mocked(identityAPI.updateProfile).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    await renderWithClient(<DisplayNameCard />);
    fireEvent.click(await screen.findByRole("button", { name: "이름 바꾸기" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText("이름")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이름 바꾸기" }));
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "새벽" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("로그인이 풀렸어요");
    expect(screen.getByLabelText("이름")).toHaveValue("새벽");
  });

  it("로그인 전에는 그리지 않는다", async () => {
    vi.mocked(identityAPI.me).mockRejectedValueOnce(new ApiError(401, { message: "x" }));
    const { container } = await renderWithClient(<DisplayNameCard />);
    await waitFor(() => expect(identityAPI.me).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
