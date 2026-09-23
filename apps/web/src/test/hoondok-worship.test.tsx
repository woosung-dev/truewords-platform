import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_CHALLENGES } from "@/features/hoondok/preview/fixtures/worship";
import { ChallengeDetail } from "@/features/hoondok/worship/components/challenge-detail";
import { SermonRequestForm } from "@/features/hoondok/worship/components/sermon-request-form";

// SCR-PWA-010~013 가정예배 프리뷰 셸 (PLAN-HD-002 W3-W).
// 프리뷰 플래그는 모듈 평가 시가 아니라 호출 시 읽히지만, 페이지 모듈이 `flag.ts` 를 통째로 들고 있으므로
// hoondok-screens.test 와 같은 방식(stubEnv → resetModules → 재import)으로 두 값 모두 확인한다.

const NOT_FOUND = "NEXT_NOT_FOUND";
const FAMILY = PREVIEW_CHALLENGES[0];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadPages(preview: "" | "1") {
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_PREVIEW", preview);
  vi.resetModules();
  // 실제 next/navigation 의 notFound 도 던진다 — 던지지 않으면 미존재 id 가 그대로 렌더될 수 있다
  const notFound = vi.fn(() => {
    throw new Error(NOT_FOUND);
  });
  vi.doMock("next/navigation", () => ({ notFound, usePathname: () => "/hoondok/worship" }));
  const [worship, challenge, sermons, request] = await Promise.all([
    import("../app/(hoondok)/hoondok/worship/page"),
    import("../app/(hoondok)/hoondok/worship/challenge/[id]/page"),
    import("../app/(hoondok)/hoondok/worship/sermons/page"),
    import("../app/(hoondok)/hoondok/worship/request/page"),
  ]);
  return {
    notFound,
    WorshipPage: worship.default,
    ChallengePage: challenge.default,
    SermonsPage: sermons.default,
    RequestPage: request.default,
  };
}

describe("프리뷰 플래그 게이트", () => {
  it("OFF: 가정예배 4화면이 모두 404 다", async () => {
    const { notFound, WorshipPage, ChallengePage, SermonsPage, RequestPage } = await loadPages("");
    expect(() => WorshipPage()).toThrow(NOT_FOUND);
    expect(() => SermonsPage()).toThrow(NOT_FOUND);
    expect(() => RequestPage()).toThrow(NOT_FOUND);
    await expect(ChallengePage({ params: Promise.resolve({ id: FAMILY.id }) })).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(4);
  });

  it("ON: 네 화면이 열리고, fixture 에 없는 챌린지 id 만 404 다", async () => {
    const { notFound, WorshipPage, ChallengePage, SermonsPage, RequestPage } = await loadPages("1");
    expect(() => WorshipPage()).not.toThrow();
    expect(() => SermonsPage()).not.toThrow();
    expect(() => RequestPage()).not.toThrow();
    await expect(ChallengePage({ params: Promise.resolve({ id: FAMILY.id }) })).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();

    await expect(ChallengePage({ params: Promise.resolve({ id: "no-such-challenge" }) })).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe("SCR-PWA-011 챌린지 상세 — DEC-PWA-019 순위 없음", () => {
  it("진행률·참여 인원만 보이고 등수·점수 표기가 없다", () => {
    const { container } = render(<ChallengeDetail challenge={FAMILY} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(FAMILY.progress?.percent));
    expect(screen.getByText("진행률")).toBeInTheDocument();
    expect(screen.getByText(FAMILY.opener)).toBeInTheDocument();

    // "n위"·"n점"·달란트·랭킹 같은 순위 표기가 어디에도 없다
    expect(container.textContent).not.toMatch(/\d+\s*위|\d+\s*점\b|달란트|랭킹|순위표/);
    // 참여자 목록은 순서가 의미 없는 <ul> 이다 — <ol> 이면 그 자체가 등수로 읽힌다
    const list = container.querySelector(".ch-list");
    expect(list?.tagName).toBe("UL");
  });

  it("오늘 읽은 사람만 보이고 응원·반응 버튼·미완료 표시가 없다 (DEC-PWA-023)", () => {
    const { container } = render(<ChallengeDetail challenge={FAMILY} />);
    expect(container.querySelectorAll(".ch-item")).toHaveLength(FAMILY.members.length);
    expect(screen.getByText(`오늘 ${FAMILY.members.length}명이 함께 읽었어요.`, { exact: false })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/아직|응원/);
    // 참여 표시 버튼 하나뿐이다 — 사람 행에는 버튼이 없다
    expect(container.querySelectorAll(".ch-item button")).toHaveLength(0);
    // 자유 입력창을 두지 않는다
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("교회 단위 챌린지는 없다 — 어떤 챌린지에도 교회 문구가 없다", () => {
    for (const challenge of PREVIEW_CHALLENGES) {
      const { container, unmount } = render(<ChallengeDetail challenge={challenge} />);
      expect(container.textContent).not.toMatch(/교회|아직|응원/);
      unmount();
    }
  });

  it("모집 중 챌린지는 진행 바 없이 시작일·참여 예정만 보인다", () => {
    const recruiting = PREVIEW_CHALLENGES.find((item) => item.progress === null);
    if (!recruiting) throw new Error("모집 중 fixture 가 필요합니다");
    render(<ChallengeDetail challenge={recruiting} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(recruiting.cardFoot)).toBeInTheDocument();
  });
});

describe("SCR-PWA-013 설교 섭외 폼 — 제출은 준비 중", () => {
  it("제출해도 네트워크를 타지 않고 인라인 상태만 바뀐다", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SermonRequestForm />);

    const form = screen.getByRole("form", { name: "설교 섭외 신청" });
    fireEvent.submit(form);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("접수는 준비 중이에요");
  });

  it("주제는 필수이고 기본값이 채워져 있다 (중복 입력 줄이기)", () => {
    render(<SermonRequestForm />);
    const topic = screen.getByLabelText("주제");
    expect(topic).toBeRequired();
    expect(topic).toHaveValue("자녀와 함께 읽는 참사랑");
  });
});
