import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@truewords/api-client-ts", () => ({ createApiClient: () => ({ request }) }));

import { PushTestCard } from "@/features/hoondok/notifications/components/push-test-card";

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PushTestCard userId="tester" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  request.mockReset();
});

describe("기기 전용 테스트 알림", () => {
  it("허용되지 않은 계정에는 컨트롤을 노출하지 않는다", async () => {
    request.mockResolvedValue({ enabled: false, jobs: [] });
    const result = show();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(result.container).toBeEmptyDOMElement();
  });
  it("현재 구독 endpoint 와 선택한 지연만 보낸다", async () => {
    request.mockResolvedValue({ enabled: true, jobs: [] });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: {},
        getRegistration: vi
          .fn()
          .mockResolvedValue({
            pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: "https://push.example/current" }) },
          }),
      },
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "5분 뒤" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/hoondok/me/push-tests", expect.objectContaining({ method: "POST" })),
    );
    const options = request.mock.calls.find((call) => call[1]?.method === "POST")?.[1];
    expect(JSON.parse(options.body)).toEqual({
      endpoint: "https://push.example/current",
      delay_minutes: 5,
      request_id: expect.any(String),
    });
  });
  it("권한이 없으면 발송 예약을 만들지 않는다", async () => {
    request.mockResolvedValue({ enabled: true, jobs: [] });
    vi.stubGlobal("Notification", { permission: "denied" });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "10분 뒤" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("알림을 먼저 켜");
    expect(request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });
  it("서버 접수를 실제 도착으로 표시하지 않는다", async () => {
    request.mockResolvedValue({
      enabled: true,
      jobs: [{ id: "job", status: "accepted", scheduled_at: "2026-11-02T00:00:00Z" }],
    });
    show();
    expect(await screen.findByText(/푸시 서비스 접수/)).toBeInTheDocument();
    expect(screen.getByText(/실제 도착은 휴대폰/)).toBeInTheDocument();
  });
});
