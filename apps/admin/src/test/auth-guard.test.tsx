// AuthGuard 인증/관리자 게이트 동작 테스트 (시연 한시 requireAdmin 모드 포함)

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

describe("AuthGuard", () => {
  it("미인증(401) 시 /login으로 리다이렉트한다", async () => {
    vi.mocked(authAPI.me).mockRejectedValueOnce(new ApiError(401, { message: "인증이 필요합니다" }));

    render(
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

    render(
      <AuthGuard>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("children")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("requireAdmin: 비관리자는 반복 이동 없이 권한 안내로 이동한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
      email: "admin@test.com",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/access-denied");
    });
    expect(screen.queryByText("children")).not.toBeInTheDocument();
  });

  it("requireAdmin: email 없는 구 토큰(me.email 부재)은 /login으로 리다이렉트한다", async () => {
    // 배포 전 발급 토큰 — 재로그인으로 email claim 포함 토큰 재발급 유도
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "admin",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("일시 오류(5xx)는 /login으로 보내지 않고 재시도 UI를 렌더한다", async () => {
    vi.mocked(authAPI.me).mockRejectedValueOnce(new ApiError(502, { message: "Bad Gateway" }));

    render(
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
      expect(screen.getByText("children")).toBeInTheDocument();
    });
  });

  it("requireAdmin: 관리자 이메일(대소문자 무관)이면 children을 렌더한다", async () => {
    vi.mocked(authAPI.me).mockResolvedValueOnce({
      user_id: "u1",
      role: "super_admin",
      email: "Demo-Admin@Example.com",
    });

    render(
      <AuthGuard requireAdmin>
        <p>children</p>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("children")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("requireAdmin: 게이트 env 가 비어 있으면 관리자 이메일이라도 /access-denied 로 보낸다", async () => {
    // 빌드 env 누락(NEXT_PUBLIC_DEMO_ADMIN_EMAIL="") 시 빈 게이트와 빈 이메일이 "일치" 로 새지 않는다 — 서버 게이트와 같은 원칙.
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_EMAIL", "");
    try {
      vi.mocked(authAPI.me).mockResolvedValueOnce({
        user_id: "u1",
        role: "super_admin",
        email: "demo-admin@example.com",
      });

      render(
        <AuthGuard requireAdmin>
          <p>children</p>
        </AuthGuard>,
      );

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/access-denied");
      });
      expect(screen.queryByText("children")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
