import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockFetchAPI = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchAPI: (...args: unknown[]) => mockFetchAPI(...args),
  };
});

const mockMe = vi.fn();
vi.mock("@/features/auth/api", () => ({
  authAPI: {
    me: () => mockMe(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
  },
}));

import { ApiError } from "@/lib/api";
import SettingsPage from "@/app/(dashboard)/settings/page";

const SELF_ID = "11111111-1111-1111-1111-111111111111";
const TRIAL_ID = "22222222-2222-2222-2222-222222222222";
const OFF_ID = "33333333-3333-3333-3333-333333333333";

const ADMINS = [
  {
    id: SELF_ID,
    email: "owner@example.com",
    role: "SUPER_ADMIN",
    is_active: true,
    created_at: "2026-07-06T09:00:00",
  },
  {
    id: TRIAL_ID,
    email: "trial@example.com",
    role: "ADMIN",
    is_active: true,
    created_at: "2026-07-07T09:00:00",
  },
  {
    id: OFF_ID,
    email: "ended@example.com",
    role: "ADMIN",
    is_active: false,
    created_at: "2026-07-07T09:00:00",
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

/** 이메일 텍스트가 들어 있는 테이블 행을 찾는다. */
function rowFor(email: string) {
  return screen.getByText(email).closest("tr") as HTMLElement;
}

beforeEach(() => {
  mockFetchAPI.mockReset();
  mockMe.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockMe.mockResolvedValue({ user_id: SELF_ID, role: "admin", email: "owner@example.com" });
  mockFetchAPI.mockImplementation((path: string) => {
    if (path === "/admin/users") return Promise.resolve(ADMINS);
    return Promise.resolve({});
  });
});

afterEach(cleanup);

describe("설정 — 관리자 계정 목록", () => {
  it("활성/비활성 상태를 색이 아닌 텍스트로도 구분해 보여준다", async () => {
    renderPage();
    await screen.findByText("trial@example.com");

    expect(within(rowFor("trial@example.com")).getByText("활성")).toBeInTheDocument();
    expect(within(rowFor("ended@example.com")).getByText("비활성")).toBeInTheDocument();
  });

  it("본인 계정의 비활성화 버튼은 비활성 처리된다", async () => {
    renderPage();
    await screen.findByText("owner@example.com");

    const selfBtn = within(rowFor("owner@example.com")).getByRole("button", {
      name: /본인 계정은 비활성화할 수 없습니다/,
    });
    expect(selfBtn).toBeDisabled();
  });

  it("다른 계정은 확인 다이얼로그를 거쳐 비활성화된다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("trial@example.com");

    await user.click(
      within(rowFor("trial@example.com")).getByRole("button", { name: /비활성화/ })
    );

    // 확인 없이 곧바로 요청하지 않는다 (confirmation-dialogs)
    expect(mockFetchAPI).not.toHaveBeenCalledWith(
      expect.stringContaining("/status"),
      expect.anything()
    );

    const dialog = await screen.findByRole("dialog");
    // 기존 세션이 즉시 끊기지 않는다는 한계를 다이얼로그가 알린다
    expect(within(dialog).getByText(/최대 24시간/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^비활성화$/ }));

    await waitFor(() => {
      expect(mockFetchAPI).toHaveBeenCalledWith(
        `/admin/users/${TRIAL_ID}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ is_active: false }),
        })
      );
    });
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("확인 다이얼로그에서 취소하면 요청하지 않는다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("trial@example.com");

    await user.click(
      within(rowFor("trial@example.com")).getByRole("button", { name: /비활성화/ })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "취소" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockFetchAPI).not.toHaveBeenCalledWith(
      expect.stringContaining("/status"),
      expect.anything()
    );
  });

  it("활성화는 되돌리기 경로라 확인 없이 즉시 실행된다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("ended@example.com");

    await user.click(
      within(rowFor("ended@example.com")).getByRole("button", { name: /활성화/ })
    );

    await waitFor(() => {
      expect(mockFetchAPI).toHaveBeenCalledWith(
        `/admin/users/${OFF_ID}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ is_active: true }),
        })
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("상태 필터로 활성 계정만 추려 본다", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("trial@example.com");

    await user.click(screen.getByRole("button", { name: /^활성/ }));

    expect(screen.queryByText("ended@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("trial@example.com")).toBeInTheDocument();
  });

  it("실패 시 status 에 맞는 안내를 띄운다", async () => {
    const user = userEvent.setup();
    mockFetchAPI.mockImplementation((path: string) => {
      if (path === "/admin/users") return Promise.resolve(ADMINS);
      // backend 는 HTTPException 을 {"detail": ...} 로 내려 message 에 status 가 없다.
      // 그래도 status 기반 분기가 올바른 문구를 고르는지 확인한다.
      return Promise.reject(new ApiError(400, { message: "요청 실패 (400)" }));
    });

    renderPage();
    await screen.findByText("trial@example.com");

    await user.click(
      within(rowFor("trial@example.com")).getByRole("button", { name: /비활성화/ })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^비활성화$/ }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("본인 계정은 비활성화할 수 없습니다")
      );
    });
  });
});
