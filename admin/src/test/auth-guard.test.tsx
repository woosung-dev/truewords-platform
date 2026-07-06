// AuthGuard 인증/관리자 게이트 동작 테스트 (시연 한시 requireAdmin 모드 포함)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthGuard", () => {
  it("미인증(me 실패) 시 /login으로 리다이렉트한다", async () => {
    vi.mocked(authAPI.me).mockRejectedValueOnce(new Error("401"));

    render(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>
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

    render(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("children")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("requireAdmin: 비관리자 이메일이면 루트(/)로 리다이렉트한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
      email: "admin@test.com",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("children")).not.toBeInTheDocument();
  });

  it("requireAdmin: email 없는 구 토큰(me.email 부재)도 루트(/)로 리다이렉트한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("requireAdmin: 관리자 이메일(대소문자 무관)이면 children을 렌더한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "super_admin",
      email: "JangWooSeng97@Gmail.com",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("children")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
