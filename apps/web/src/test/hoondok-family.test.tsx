import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 016 가족·친구 프리뷰 (PLAN-HD-002 W3-F). 프리뷰 플래그는 렌더할 때 읽히므로 stubEnv 뒤 모듈을 다시 불러온다.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

const USER = { id: "u1", email: "a@b.c", display_name: "효진" };
const SUMMARY = {
  today: { read: true, pray: false, study: false },
  streak_days: 3,
  best_streak_days: 12,
  total_days: 47,
  week: [],
};

/** 프리뷰 화면은 서버를 부르지 않는다 — 부르면 테스트가 깨지도록 실패하는 fetch 를 심는다 */
function spyOnFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.reject(new Error("프리뷰 화면은 네트워크를 쓰지 않는다")));
}

async function loadFamilyPage(preview: "" | "1") {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", preview);
  vi.resetModules();
  const notFound = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  vi.doMock("next/navigation", () => ({ notFound, usePathname: () => "/hoondok/family" }));
  const { default: Page } = await import("../app/(hoondok)/hoondok/family/page");
  return { Page, notFound };
}

async function renderGarden(preview: "" | "1") {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", preview);
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    notFound: vi.fn(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => "/hoondok/garden",
  }));
  vi.doMock("@/features/identity/api", () => ({
    identityAPI: { me: vi.fn().mockResolvedValue({ user: USER }), signup: vi.fn(), login: vi.fn(), logout: vi.fn() },
  }));
  vi.doMock("@/features/hoondok/missions-api", () => ({
    missionsAPI: { summary: vi.fn().mockResolvedValue(SUMMARY), complete: vi.fn() },
  }));
  vi.doMock("@/features/hoondok/history-api", () => ({
    historyAPI: { month: vi.fn().mockResolvedValue({ month: "2026-09", days: [] }) },
  }));
  vi.doMock("@/features/hoondok/jeongseong-api", () => ({
    jeongseongAPI: { current: vi.fn().mockResolvedValue({ period: null }), create: vi.fn(), abandon: vi.fn() },
  }));
  const { GardenScreen } = await import("../features/hoondok/garden/components/garden-screen");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GardenScreen month="2026-09" today="2026-09-10" />
    </QueryClientProvider>,
  );
}

describe("016 가족·친구 프리뷰 셸", () => {
  it("프리뷰 OFF(기본): 404 다 — 운영에 없는 화면이다", async () => {
    const { Page, notFound } = await loadFamilyPage("");
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("프리뷰 ON: 예시 데이터 안내 · 가족·친구 목록 · 공개 범위를 그린다", async () => {
    const { Page, notFound } = await loadFamilyPage("1");
    render(<Page />);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByText("미리보기 예시 데이터입니다")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "우리 가족" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "친구" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내가 보여주는 범위" })).toBeInTheDocument();
    // 사람별 완료/미완료 배지는 없고 친구는 읽은 수만 요약한다 (DEC-PWA-023)
    expect(screen.getByText("오늘 3명이 함께 읽었어요")).toBeInTheDocument();
    expect(screen.queryByText(/오늘 완료|아직/)).toBeNull();
    // 소속 교회를 받지 않으므로 교회명이 없다
    expect(screen.queryByText(/교회/)).toBeNull();
  });

  it("초대·추가 버튼: 네트워크 요청 0 · 인라인 '준비 중' 을 글자로 알린다", async () => {
    const fetchSpy = spyOnFetch();
    const { Page } = await loadFamilyPage("1");
    render(<Page />);

    fireEvent.click(screen.getByRole("button", { name: /가족 초대하기/ }));
    fireEvent.click(screen.getByRole("button", { name: /친구 추가하기/ }));

    const notices = screen.getAllByRole("status");
    expect(notices.map((node) => node.querySelector(".empty__title")?.textContent)).toEqual([
      "가족 초대는 준비 중이에요",
      "친구 추가는 준비 중이에요",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("공개 범위: 선택만 바뀌고 저장하지 않는다 · 노트와 질문은 항상 비공개", async () => {
    const fetchSpy = spyOnFetch();
    const { Page } = await loadFamilyPage("1");
    const { container } = render(<Page />);

    const done = screen.getByRole("button", { name: "오늘 읽은 날 표시 공개" });
    const jeongseong = screen.getByRole("button", { name: "진행 중인 정성 이름 공개" });
    expect(done).toHaveAttribute("aria-pressed", "true");
    expect(jeongseong).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(jeongseong);
    expect(jeongseong).toHaveAttribute("aria-pressed", "true");
    // 서로 독립된 항목이라 다른 행은 그대로다
    expect(done).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(done);
    expect(done).toHaveAttribute("aria-pressed", "false");

    // 바꿀 수 없는 행은 컨트롤 없이 글자만 둔다 (REQ-PWA-015)
    expect(screen.getByText("항상 비공개")).toBeInTheDocument();
    expect(container.querySelectorAll(".fm-scope__row .toggle")).toHaveLength(2);
    // fieldset + legend 로 한 묶음이다
    expect(container.querySelector("fieldset.fm-scope > legend")).toHaveTextContent(
      "가족과 친구에게 어디까지 보일지 정해요.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("014 정원의 가족·친구 진입", () => {
  it("프리뷰 ON: 정성 다음에 016 진입 섹션이 붙는다", async () => {
    await renderGarden("1");
    const link = await screen.findByRole("link", { name: /가족·친구와 함께 읽어요/ });
    expect(link).toHaveAttribute("href", "/hoondok/family");
    expect(screen.getByRole("heading", { name: "함께 읽는 사람들" })).toBeInTheDocument();
  });

  it("프리뷰 OFF(기본): 진입 섹션을 그리지 않는다", async () => {
    await renderGarden("");
    // 정원 본문이 뜬 뒤에도 (프로필 이름 기준) 진입 섹션은 없다
    expect(await screen.findByText("효진")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "함께 읽는 사람들" })).toBeNull();
    expect(screen.queryByRole("link", { name: /가족·친구와 함께 읽어요/ })).toBeNull();
  });
});
