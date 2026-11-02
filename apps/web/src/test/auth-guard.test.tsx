// AuthGuard 인증/관리자 게이트 동작 테스트 (시연 한시 requireAdmin 모드 포함)

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// next/navigation mock
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}));

// API mock
vi.mock("@/features/auth/api", () => ({
  authAPI: {
    me: vi.fn(),
  },
}));

import { authAPI } from "@/features/auth/api";
import AuthGuard from "@/features/auth/components/auth-guard";
import { ApiError } from "@/lib/api";

beforeEach(() => {
  vi.clearAllMocks();
});

// children 은 확인 중에도 숨긴 채 마운트되므로 "보이는지"는 aria-hidden 래퍼 밖인지로 판정한다.
function expectShown() {
  expect(screen.getByText("children").closest('[aria-hidden="true"]')).toBeNull();
}

// AuthGuard 는 React Query(me)를 쓴다 — 테스트마다 새 캐시로 감싼다.
function renderGuard(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("AuthGuard", () => {
  it("확인 중에도 children 을 숨긴 채 마운트해 화면 요청이 me 를 기다리지 않는다", () => {
    vi.mocked(authAPI.me).mockReturnValueOnce(new Promise(() => {}));

    renderGuard(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>,
    );

    expect(screen.getByText("확인 중...")).toBeInTheDocument();
    expect(screen.getByText("children").closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("미인증(401) 시 /login으로 리다이렉트한다", async () => {
    vi.mocked(authAPI.me).mockRejectedValueOnce(new ApiError(401, { message: "인증이 필요합니다" }));

    renderGuard(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(screen.queryByText("children")).not.toBeInTheDocument();
  });

  it("일반 모드: 로그인만 되어 있으면 children을 렌더한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
      email: "admin@test.com",
    });

    renderGuard(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expectShown();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("일시 오류(5xx)는 /login으로 보내지 않고 재시도 UI를 렌더한다", async () => {
    vi.mocked(authAPI.me).mockRejectedValueOnce(new ApiError(502, { message: "Bad Gateway" }));

    renderGuard(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();

    // 재시도 성공 시 children 렌더
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
      email: "admin@test.com",
    });
    screen.getByRole("button", { name: "다시 시도" }).click();

    await waitFor(() => {
      expectShown();
    });
  });
});
