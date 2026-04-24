import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// next/navigation mock
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
    // LoginPage 가 로그인 성공 후 router.prefetch("/") 를 호출 (Cloud Run
    // warm-up). mock 에 prefetch 가 없으면 TypeError → catch 블록 진입 →
    // push 호출되지 않아 테스트 실패하므로 mock 추가.
    prefetch: vi.fn(),
  }),
  usePathname: () => "/login",
}));

// LoginPage 가 fire-and-forget 으로 /api/chatbots 를 fetch — jsdom 에
// 글로벌 fetch 가 없을 수 있으므로 정의되지 않았을 때만 shim 추가.
// .catch() 로 처리되지만 TypeError 자체가 sync throw 되지 않도록.
if (typeof globalThis.fetch !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(() => Promise.resolve(new Response(null)));
}

// API mock
vi.mock("@/features/auth/api", () => ({
  authAPI: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

import { authAPI } from "@/features/auth/api";
import LoginPage from "@/app/login/page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("이메일과 비밀번호 입력 필드를 렌더링한다", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
  });

  it("TrueWords Admin 제목을 표시한다", () => {
    render(<LoginPage />);

    expect(screen.getByText("TrueWords Admin")).toBeInTheDocument();
  });

  it("로그인 성공 시 /chatbots로 이동한다", async () => {
    vi.mocked(authAPI.login).mockResolvedValueOnce({ message: "ok" });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "admin@test.com" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/chatbots");
    });
  });

  it("로그인 실패 시 에러 메시지를 표시한다", async () => {
    vi.mocked(authAPI.login).mockRejectedValueOnce(
      new Error("401 Unauthorized")
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "admin@test.com" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(
        screen.getByText("이메일 또는 비밀번호가 올바르지 않습니다")
      ).toBeInTheDocument();
    });
  });

  it("로딩 중 버튼이 비활성화된다", async () => {
    // 응답을 지연시킴
    vi.mocked(authAPI.login).mockImplementationOnce(
      () => new Promise(() => {})
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "admin@test.com" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그인 중..." })).toBeDisabled();
    });
  });
});
