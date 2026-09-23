import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@truewords/api-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 함께 읽는 모임 W1 화면 (PLAN-HD-010 §9 Vitest W1): 만들기 페이로드·공유 폴백, ?code= 자동 채움·정규화, 404·409·429 안내,
// 상세 완료자만·공개 안내·반응 aria-pressed·내 한 줄 반응 수, 설정 리더/모임원 분기·확인 카드·리더 나가기 비활성,
// 연타 방지·내보내진 뒤 404 안내·공백 이름 차단. 서버는 groupsAPI 만 바꿔 흉내 낸다(오류 해석은 실제 groupErrorOf).
const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/hoondok/groups/join",
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/features/identity/api", () => ({
  identityAPI: { signup: vi.fn(), login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock("@/features/hoondok/together/groups-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/hoondok/together/groups-api")>();
  return {
    ...original,
    groupsAPI: {
      mine: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      regenerateInvite: vi.fn(),
      previewInvite: vi.fn(),
      join: vi.fn(),
      updateMyName: vi.fn(),
      leave: vi.fn(),
      members: vi.fn(),
      removeMember: vi.fn(),
      addJeongseong: vi.fn(),
      deleteJeongseong: vi.fn(),
      putTodayShare: vi.fn(),
      deleteShare: vi.fn(),
      setReaction: vi.fn(),
    },
  };
});

import GroupDetailPage from "@/app/(hoondok)/hoondok/groups/[id]/page";
import GroupSettingsPage from "@/app/(hoondok)/hoondok/groups/[id]/settings/page";
import GroupSharePage from "@/app/(hoondok)/hoondok/groups/[id]/share/page";
import GroupJoinPage from "@/app/(hoondok)/hoondok/groups/join/page";
import GroupNewPage from "@/app/(hoondok)/hoondok/groups/new/page";
import { formatKstTime, formatMeetingTime } from "@/features/hoondok/together/components/group-common";
import { GroupCreateForm } from "@/features/hoondok/together/components/group-create-form";
import { GroupDetailView } from "@/features/hoondok/together/components/group-detail";
import { GroupJoinForm } from "@/features/hoondok/together/components/group-join-form";
import { GroupSettings } from "@/features/hoondok/together/components/group-settings";
import { GroupShareForm, normalizeShareBody } from "@/features/hoondok/together/components/group-share-form";
import {
  type GroupDetail,
  groupsAPI,
  type InvitePreview,
  type MemberList,
} from "@/features/hoondok/together/groups-api";
import { identityAPI } from "@/features/identity/api";

const G = "0b8f0e0e-0000-4000-8000-000000000001";
const USER = { id: "u1", email: "a@b.c", display_name: "효진" };

function apiError(status: number, detail?: string) {
  return new ApiError(status, { message: detail ?? `요청 실패 (${status})`, details: detail });
}

/** 끝나지 않는 요청 — 진행 중(isPending) 상태를 붙잡아 연타를 흉내 낸다. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

const JEONGSEONG_OFFICIAL = {
  id: "j1",
  title: "21일 특별정성",
  started_on: "2026-09-12",
  duration_days: 21,
  day_index: 12,
  state: "active" as const,
  is_official: true,
  source_note: "협회 공지" as string | null,
};

function detail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: G,
    name: "새벽별 훈독모임",
    kind: "small_group",
    leader_display_name: "은정",
    meeting_time: "06:00:00",
    date: "2026-09-23",
    today_reading: {
      id: "r1",
      reading_date: "2026-09-23",
      title: "참사랑은 직단거리를 갑니다",
      speaker: "참아버님",
      work_title: "천성경",
      chunk_id: null,
      estimated_minutes: 3,
    },
    jeongseongs: [JEONGSEONG_OFFICIAL],
    readers: [
      { display_name: "미카", read_at_kst: "2026-09-23T05:55:00+09:00", is_me: false, is_leader: false },
      { display_name: "효진", read_at_kst: "2026-09-23T06:12:00+09:00", is_me: true, is_leader: false },
    ],
    shares: [
      {
        id: "s1",
        display_name: "미카",
        body: "오늘은 소리 내어 같이 읽었어요.",
        created_at_kst: "2026-09-23T06:01:00+09:00",
        is_mine: false,
        has_my_reaction: false,
        reaction_count: null,
      },
      {
        id: "s2",
        display_name: "효진",
        body: "아이에게 먼저 말을 걸어 볼게요.",
        created_at_kst: "2026-09-23T06:14:00+09:00",
        is_mine: true,
        has_my_reaction: false,
        reaction_count: 2,
      },
    ],
    me: { member_id: "m-me", display_name: "효진", role: "member", has_read_today: true, has_shared_today: true },
    invite_code: null,
    invite_expires_at: null,
    ...overrides,
  };
}

const LEADER_DETAIL = (): GroupDetail =>
  detail({
    me: { member_id: "m-me", display_name: "은정", role: "leader", has_read_today: true, has_shared_today: false },
    invite_code: "7K2MQ9XD",
    invite_expires_at: "2026-10-23T00:00:00",
    shares: detail().shares.map((share) => ({ ...share, is_mine: false, reaction_count: null })),
  });

const MEMBERS: MemberList = {
  member_count: 3,
  items: [
    { id: "m-me", display_name: "은정", role: "leader", joined_at: "2026-09-12T00:00:00" },
    { id: "m-2", display_name: "미카", role: "member", joined_at: "2026-09-13T00:00:00" },
    { id: "m-3", display_name: "서연", role: "member", joined_at: "2026-09-14T00:00:00" },
  ],
};

const PREVIEW: InvitePreview = {
  name: "새벽별 훈독모임",
  kind: "small_group",
  leader_display_name: "은정",
  jeongseongs: [JEONGSEONG_OFFICIAL],
  is_member: false,
  group_id: null,
};

function renderUi(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_HOONDOK_TOGETHER", "1");
  vi.mocked(identityAPI.me).mockResolvedValue({ user: USER });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("라우트 킬 스위치 (D3)", () => {
  it("플래그 OFF 면 모임 5라우트가 모두 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOONDOK_TOGETHER", "");
    const params = Promise.resolve({ id: G });
    await expect(GroupNewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GroupJoinPage({ searchParams: Promise.resolve({ code: "7K2M-Q9XD" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(GroupDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GroupSharePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GroupSettingsPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("플래그 ON 이면 참여 페이지가 ?code 를 화면에 넘긴다", async () => {
    const element = await GroupJoinPage({ searchParams: Promise.resolve({ code: "7k2m-q9xd" }) });
    expect(element.props.initialCode).toBe("7k2m-q9xd");
  });
});

describe("표기", () => {
  it("완료 시각·모임 시간은 KST 오전/오후로", () => {
    expect(formatKstTime("2026-09-23T05:55:00+09:00")).toBe("오전 5:55");
    expect(formatKstTime("2026-09-22T20:55:00Z")).toBe("오전 5:55");
    expect(formatMeetingTime("06:00:00")).toBe("오전 6시");
    expect(formatMeetingTime("20:30")).toBe("오후 8:30");
    expect(formatKstTime("2026-09-23T03:05:00")).toBe("오후 12:05");
  });

  it("한 줄 정리 규칙은 서버와 같다 — 줄마다 공백 정리 · 빈 줄 제거", () => {
    expect(normalizeShareBody("  오늘은  \r\n\n   감사  합니다 \n")).toBe("오늘은\n감사 합니다");
    expect(normalizeShareBody(" \n \t ")).toBe("");
  });
});

describe("SCR-PWA-019 모임 만들기", () => {
  it("이름 20자·내 이름 12자 제한, 앞뒤 공백을 지운 페이로드, 성공하면 ?created= 로 바꾼다", async () => {
    vi.mocked(groupsAPI.create).mockResolvedValue(LEADER_DETAIL());
    renderUi(<GroupCreateForm today="2026-09-23" />);
    const name = await screen.findByLabelText("모임 이름");
    expect(name).toHaveAttribute("maxLength", "20");
    const me = screen.getByLabelText("이 모임에서 쓸 내 이름");
    expect(me).toHaveAttribute("maxLength", "12");
    expect(me).toHaveValue("효진");
    fireEvent.change(name, { target: { value: "  새벽별 훈독모임 " } });
    fireEvent.click(screen.getByRole("button", { name: "모임 만들기" }));
    await waitFor(() =>
      expect(groupsAPI.create).toHaveBeenCalledWith({
        name: "새벽별 훈독모임",
        display_name: "효진",
        meeting_time: null,
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/hoondok/groups/new?created=${G}`));
  });

  it("모임 정성 토글을 켜면 제목·기간·시작일을 함께 보낸다 (직접 1~100일)", async () => {
    vi.mocked(groupsAPI.create).mockResolvedValue(LEADER_DETAIL());
    renderUi(<GroupCreateForm today="2026-09-23" />);
    fireEvent.change(await screen.findByLabelText("모임 이름"), { target: { value: "청년 모임" } });
    fireEvent.change(screen.getByLabelText("모임 시간 (선택)"), { target: { value: "06:30" } });
    const toggle = screen.getByRole("button", { name: "모임 정성 열기" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // 줄 전체가 버튼이라 설명 글자를 눌러도 켜진다 (QA P2-8)
    fireEvent.click(screen.getByText("선택 · 공식 정성과 따로 우리 모임이 드리는 정성"));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("정성 이름")).toHaveAttribute("maxLength", "24");
    fireEvent.change(screen.getByLabelText("정성 이름"), { target: { value: "우리 모임 정성" } });
    fireEvent.click(screen.getByRole("radio", { name: "직접" }));
    fireEvent.change(screen.getByLabelText("기간 (1~100일)"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "모임 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("정성 기간은 1~100일로 정해 주세요");
    expect(groupsAPI.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText("기간 (1~100일)")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("기간 (1~100일)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "모임 만들기" }));
    await waitFor(() =>
      expect(groupsAPI.create).toHaveBeenCalledWith({
        name: "청년 모임",
        display_name: "효진",
        meeting_time: "06:30",
        jeongseong: { title: "우리 모임 정성", duration_days: 30, started_on: "2026-09-23" },
      }),
    );
  });

  it("공백만 있는 이름은 보내지 않는다", async () => {
    renderUi(<GroupCreateForm today="2026-09-23" />);
    fireEvent.change(await screen.findByLabelText("모임 이름"), { target: { value: "모임" } });
    fireEvent.change(screen.getByLabelText("이 모임에서 쓸 내 이름"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "모임 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이 모임에서 쓸 내 이름을 적어 주세요");
    expect(groupsAPI.create).not.toHaveBeenCalled();
    // 오류는 버튼 위에 뜨므로 고칠 칸으로 초점이 옮겨 간다
    expect(screen.getByLabelText("이 모임에서 쓸 내 이름")).toHaveFocus();
  });

  it("연타: 요청 중에는 버튼이 잠기고 두 번째 제출은 가지 않는다", async () => {
    vi.mocked(groupsAPI.create).mockReturnValue(pending());
    renderUi(<GroupCreateForm today="2026-09-23" />);
    fireEvent.change(await screen.findByLabelText("모임 이름"), { target: { value: "모임" } });
    const button = screen.getByRole("button", { name: "모임 만들기" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(groupsAPI.create).toHaveBeenCalledTimes(1);
  });

  it("리더 한도 409 는 안내 문구로", async () => {
    vi.mocked(groupsAPI.create).mockRejectedValue(apiError(409, "LEADER_LIMIT"));
    renderUi(<GroupCreateForm today="2026-09-23" />);
    fireEvent.change(await screen.findByLabelText("모임 이름"), { target: { value: "모임" } });
    fireEvent.click(screen.getByRole("button", { name: "모임 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("리더로는 모임을 3개까지");
  });

  it("?created= 이면 초대 코드와 공유 — navigator.share 가 없으면 클립보드로 복사했다고 알린다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderUi(<GroupCreateForm today="2026-09-23" createdId={G} />);
    expect(await screen.findByText("모임을 만들었어요")).toBeInTheDocument();
    expect(screen.getByLabelText("초대 코드 7K2M-Q9XD")).toHaveTextContent("7K2M-Q9XD");
    expect(screen.getByRole("link", { name: /모임으로 가기/ })).toHaveAttribute("href", `/hoondok/groups/${G}`);
    fireEvent.click(screen.getByRole("button", { name: /초대 링크 보내기/ }));
    expect(await screen.findByText("공유를 지원하지 않아 링크를 복사했어요")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/hoondok/groups/join?code=7K2M-Q9XD"));
  });

  it("navigator.share 가 있으면 공유 시트를 연다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    renderUi(<GroupCreateForm today="2026-09-23" createdId={G} />);
    fireEvent.click(await screen.findByRole("button", { name: /초대 링크 보내기/ }));
    expect(await screen.findByText("공유 창을 열었어요")).toBeInTheDocument();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "새벽별 훈독모임" }));
  });
});

describe("SCR-PWA-018 모임 참여", () => {
  it("카톡 메시지·링크 전체를 붙여 넣어도 코드만 남는다 (QA P2-10)", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    renderUi(<GroupJoinForm />);
    const input = await screen.findByLabelText("초대 코드");
    expect(Number(input.getAttribute("maxLength"))).toBeGreaterThan(100);
    fireEvent.change(input, { target: { value: "[새벽별 훈독모임] 초대 코드: 7k2m–q9xd" } });
    expect(input).toHaveValue("7K2M-Q9XD");
    fireEvent.change(input, {
      target: { value: "새벽별 훈독모임\nhttps://truewords.woosung.dev/hoondok/groups/join?code=7K2M-Q9XD" },
    });
    expect(input).toHaveValue("7K2M-Q9XD");
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(groupsAPI.previewInvite).toHaveBeenCalledWith("7K2MQ9XD"));
  });

  it("?code= 를 채우고 정규화한 코드로 미리보기 — 인원 수 없이 이름·리더·정성 + 공개 안내", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    renderUi(<GroupJoinForm initialCode=" 7k2m q9xd " />);
    expect(await screen.findByRole("heading", { name: "새벽별 훈독모임" })).toBeInTheDocument();
    expect(groupsAPI.previewInvite).toHaveBeenCalledWith("7K2MQ9XD");
    expect(screen.getByLabelText("초대 코드")).toHaveValue("7K2M-Q9XD");
    expect(screen.getByText("은정 님이 보낸 링크로 들어왔어요")).toBeInTheDocument();
    expect(screen.getByText(/리더 은정/)).toBeInTheDocument();
    expect(screen.getByText(/21일 특별정성 12일차/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/식구 \d+명|\d+명이 있어요/);
    expect(screen.getByText("모임에 보이는 것")).toBeInTheDocument();
    expect(screen.getByText(/이 모임에서 쓸 이름, 읽은 날의 읽은 시각, 내가 남긴 한 줄/)).toBeInTheDocument();
  });

  it("붙여 넣은 소문자·공백·o/l 섞인 코드도 확인 버튼으로 정규화된다", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    renderUi(<GroupJoinForm />);
    const input = await screen.findByLabelText("초대 코드");
    fireEvent.change(input, { target: { value: "abcd" } });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("초대 코드는 8자리예요");
    expect(groupsAPI.previewInvite).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " 7k2m-q9xo\n" } });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(groupsAPI.previewInvite).toHaveBeenCalledWith("7K2MQ9X0"));
    expect(input).toHaveValue("7K2M-Q9X0");
    fireEvent.change(input, { target: { value: "l1l1 2222" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(groupsAPI.previewInvite).toHaveBeenCalledWith("11112222"));
  });

  it("비로그인은 코드를 실은 returnTo 로 온보딩에 보낸다 (미리보기 요청 없음)", async () => {
    vi.mocked(identityAPI.me).mockRejectedValue(apiError(401));
    renderUi(<GroupJoinForm initialCode="7k2mq9xd" />);
    const link = await screen.findByRole("link", { name: "가입하거나 로그인하기" });
    expect(link).toHaveAttribute(
      "href",
      `/hoondok/onboarding?returnTo=${encodeURIComponent("/hoondok/groups/join?code=7K2M-Q9XD")}`,
    );
    expect(screen.getByText("7K2M-Q9XD")).toBeInTheDocument();
    expect(groupsAPI.previewInvite).not.toHaveBeenCalled();
  });

  it("없는·만료 코드(404)와 limiter(429) 안내", async () => {
    vi.mocked(groupsAPI.previewInvite).mockRejectedValueOnce(apiError(404, "INVITE_NOT_FOUND"));
    const { unmount } = renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "초대 코드가 맞지 않거나 만료됐어요. 리더에게 코드를 다시 받아 주세요",
    );
    expect(screen.queryByRole("button", { name: "모임에 참여하기" })).not.toBeInTheDocument();
    unmount();
    vi.mocked(groupsAPI.previewInvite).mockRejectedValueOnce(apiError(429, "RATE_LIMIT_EXCEEDED"));
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 뒤 다시 시도해 주세요");
  });

  it("이미 식구면 참여 대신 모임으로 가기", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue({ ...PREVIEW, is_member: true, group_id: G });
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    expect(await screen.findByText("이미 이 모임 식구예요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /모임으로 가기/ })).toHaveAttribute("href", `/hoondok/groups/${G}`);
    expect(screen.queryByRole("button", { name: "모임에 참여하기" })).not.toBeInTheDocument();
  });

  it("참여 성공 → 모임 상세로, 이름은 앞뒤 공백을 지워 보낸다", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    vi.mocked(groupsAPI.join).mockResolvedValue({ group_id: G });
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    const name = await screen.findByLabelText("이 모임에서 쓸 이름");
    expect(name).toHaveAttribute("maxLength", "12");
    fireEvent.change(name, { target: { value: "  민수 " } });
    fireEvent.click(screen.getByRole("button", { name: "모임에 참여하기" }));
    await waitFor(() => expect(groupsAPI.join).toHaveBeenCalledWith("7K2MQ9XD", { display_name: "민수" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/hoondok/groups/${G}`));
  });

  it("공백만 있는 이름은 막고, 요청 중 연타는 한 번만 보낸다", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    vi.mocked(groupsAPI.join).mockReturnValue(pending());
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    const name = await screen.findByLabelText("이 모임에서 쓸 이름");
    fireEvent.change(name, { target: { value: "   " } });
    const button = screen.getByRole("button", { name: "모임에 참여하기" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("이 모임에서 쓸 이름을 적어 주세요");
    expect(groupsAPI.join).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "민수" } });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(groupsAPI.join).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["DISPLAY_NAME_TAKEN", "이 모임에 같은 이름이 있어요"],
    ["GROUP_FULL", "모임 정원이 다 찼어요"],
    ["JOIN_LIMIT", "모임은 5개까지 함께할 수 있어요"],
  ])("409 %s 안내", async (code, message) => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    vi.mocked(groupsAPI.join).mockRejectedValue(apiError(409, code));
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    fireEvent.click(await screen.findByRole("button", { name: "모임에 참여하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("409 ALREADY_MEMBER 는 미리보기를 다시 읽어 모임 링크로 바꾼다", async () => {
    vi.mocked(groupsAPI.previewInvite)
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValue({ ...PREVIEW, is_member: true, group_id: G });
    vi.mocked(groupsAPI.join).mockRejectedValue(apiError(409, "ALREADY_MEMBER"));
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    fireEvent.click(await screen.findByRole("button", { name: "모임에 참여하기" }));
    expect(await screen.findByText("이미 이 모임 식구예요")).toBeInTheDocument();
  });

  it("미리보기 뒤 코드가 새로 만들어졌으면(참여 404) 코드 안내", async () => {
    vi.mocked(groupsAPI.previewInvite).mockResolvedValue(PREVIEW);
    vi.mocked(groupsAPI.join).mockRejectedValue(apiError(404, "INVITE_NOT_FOUND"));
    renderUi(<GroupJoinForm initialCode="7K2M-Q9XD" />);
    fireEvent.click(await screen.findByRole("button", { name: "모임에 참여하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "초대 코드가 맞지 않거나 만료됐어요. 리더에게 코드를 다시 받아 주세요",
    );
  });
});

describe("SCR-PWA-017 모임 상세", () => {
  it("머리에 인원 없음 · 오늘 읽은 식구는 완료자만 시각과 함께 · 공개 안내", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail());
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByRole("heading", { name: "새벽별 훈독모임" })).toBeInTheDocument();
    expect(screen.getByText("리더 은정 · 매일 오전 6시")).toBeInTheDocument();
    const readers = screen.getByRole("list", { name: "오늘 함께 읽은 식구" });
    expect(within(readers).getAllByRole("listitem")).toHaveLength(2);
    expect(within(readers).getByText("오전 5:55")).toBeInTheDocument();
    expect(within(readers).getByText("효진 (나)")).toBeInTheDocument();
    expect(screen.getByText("안 읽은 사람은 표시하지 않아요.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/식구 \d+명|아직/);
    // 완료자 수만 머리에 — "N명 · 가나다순" (프로토타입 group)
    expect(screen.getByText("2명 · 가나다순")).toBeInTheDocument();
    // 정성은 모임 전체 N일차 · M일 중 · 시작~끝 날짜 + 공식 표시 (21일: 9월 12일 ~ 10월 2일)
    expect(screen.getByText("12일차").parentElement).toHaveTextContent("12일차21일 중");
    expect(screen.getByText("9월 12일 ~ 10월 2일")).toBeInTheDocument();
    expect(screen.getByText("공식")).toBeInTheDocument();
    // 출처는 관리자가 적은 source_note 그대로 (QA P2-13)
    expect(screen.getByText("공식 정성 · 출처: 협회 공지")).toBeInTheDocument();
    // 오늘 범위는 훈독하기로, 설정 진입은 모두에게
    expect(screen.getByRole("link", { name: /오늘 범위/ })).toHaveAttribute("href", "/hoondok/read");
    expect(screen.getByRole("link", { name: /모임 설정/ })).toHaveAttribute("href", `/hoondok/groups/${G}/settings`);
    // 모임원에게는 초대 코드가 없으므로 초대하기 버튼도 없다
    expect(screen.queryByRole("button", { name: /초대하기/ })).not.toBeInTheDocument();
  });

  it("남의 한 줄은 '함께 머물렀어요' 토글(aria-pressed), 내 한 줄은 반응 수를 나에게만", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail());
    vi.mocked(groupsAPI.setReaction).mockResolvedValue({ has_reacted: true });
    renderUi(<GroupDetailView groupId={G} />);
    const stay = await screen.findByRole("button", { name: "함께 머물렀어요" });
    expect(stay).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(stay);
    await waitFor(() => expect(groupsAPI.setReaction).toHaveBeenCalledWith(G, "s1", true));
    await waitFor(() => expect(stay).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("2명이 함께 머물렀어요 · 나에게만 보여요")).toBeInTheDocument();
    // 내 한 줄에는 반응 버튼이 없다 — 토글은 남의 한 줄 1개뿐
    expect(screen.getAllByRole("button", { name: "함께 머물렀어요" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "고치기" })).toHaveAttribute("href", `/hoondok/groups/${G}/share`);
    expect(screen.getByRole("link", { name: "내 한 줄 고치기" })).toBeInTheDocument();
  });

  it("공식 정성 출처가 없으면 출처 문구를 지어내지 않는다 (QA P2-13)", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(
      detail({ jeongseongs: [{ ...JEONGSEONG_OFFICIAL, source_note: null }] }),
    );
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByText("공식 정성")).toBeInTheDocument();
    expect(screen.queryByText(/출처|협회 공지/)).not.toBeInTheDocument();
  });

  it("내 한 줄에 반응이 0개면 '0명이 함께 머물렀어요' 를 보이지 않는다 (QA P2-2)", async () => {
    const base = detail();
    vi.mocked(groupsAPI.get).mockResolvedValue({
      ...base,
      shares: base.shares.map((share) => (share.is_mine ? { ...share, reaction_count: 0 } : share)),
    });
    renderUi(<GroupDetailView groupId={G} />);
    await screen.findByRole("button", { name: "함께 머물렀어요" });
    expect(screen.queryByText(/명이 함께 머물렀어요/)).not.toBeInTheDocument();
  });

  it("오늘 훈독 전이면 한 줄 남기기 대신 훈독하기", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(
      detail({
        shares: [],
        me: { member_id: "m-me", display_name: "효진", role: "member", has_read_today: false, has_shared_today: false },
      }),
    );
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByRole("link", { name: "훈독하기" })).toHaveAttribute("href", "/hoondok/read");
    expect(screen.queryByRole("link", { name: "한 줄 남기기" })).not.toBeInTheDocument();
  });

  it("리더는 남의 한 줄을 확인 뒤 지울 수 있고, 초대하기가 보인다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    vi.mocked(groupsAPI.deleteShare).mockResolvedValue(undefined);
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByRole("button", { name: /초대하기/ })).toBeInTheDocument();
    const [open] = screen.getAllByRole("button", { name: "지우기", expanded: false });
    fireEvent.click(open);
    const box = screen.getByRole("group", { name: "미카 님의 한 줄 지우기 확인" });
    expect(box).toBeVisible();
    await waitFor(() => expect(within(box).getByRole("button", { name: "취소" })).toHaveFocus());
    fireEvent.click(within(box).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(groupsAPI.deleteShare).toHaveBeenCalledWith(G, "s1"));
  });

  it("내보내졌거나 삭제된 모임(404) — 새로고침하면 안내 화면, 오류로 무너지지 않는다", async () => {
    vi.mocked(groupsAPI.get).mockRejectedValue(apiError(404, "GROUP_NOT_FOUND"));
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByText("이 모임을 볼 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/hoondok");
  });

  it("보던 중 내보내지면 — 반응 404 뒤 다시 읽어 안내 화면으로", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValueOnce(detail()).mockRejectedValue(apiError(404, "GROUP_NOT_FOUND"));
    vi.mocked(groupsAPI.setReaction).mockRejectedValue(apiError(404, "GROUP_NOT_FOUND"));
    renderUi(<GroupDetailView groupId={G} />);
    fireEvent.click(await screen.findByRole("button", { name: "함께 머물렀어요" }));
    expect(await screen.findByText("이 모임을 볼 수 없어요")).toBeInTheDocument();
  });

  it("비로그인은 상세 요청 없이 로그인 안내", async () => {
    vi.mocked(identityAPI.me).mockRejectedValue(apiError(401));
    renderUi(<GroupDetailView groupId={G} />);
    expect(await screen.findByRole("link", { name: "가입하거나 로그인하기" })).toHaveAttribute(
      "href",
      `/hoondok/onboarding?returnTo=${encodeURIComponent(`/hoondok/groups/${G}`)}`,
    );
    expect(groupsAPI.get).not.toHaveBeenCalled();
  });
});

describe("SCR-PWA-020 한 줄 쓰기", () => {
  it("100자 카운터 · 공백/줄바꿈 정리 뒤 upsert · 성공하면 상세로", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail({ shares: [] }));
    vi.mocked(groupsAPI.putTodayShare).mockResolvedValue(detail().shares[1]);
    renderUi(<GroupShareForm groupId={G} />);
    const text = await screen.findByLabelText("새벽별 훈독모임에 남길 한 줄");
    expect(text).toHaveAttribute("maxLength", "100");
    expect(screen.getByText("0 / 100")).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "  오늘은   감사  \n\n 합니다 " } });
    expect(screen.getByText("19 / 100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "한 줄 남기기" }));
    await waitFor(() => expect(groupsAPI.putTodayShare).toHaveBeenCalledWith(G, { body: "오늘은 감사\n합니다" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/hoondok/groups/${G}`));
  });

  it("이미 남긴 한 줄은 채워서 고친다 · 빈 글은 보내지 않는다 · 연타는 한 번", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail());
    vi.mocked(groupsAPI.putTodayShare).mockReturnValue(pending());
    renderUi(<GroupShareForm groupId={G} />);
    const text = await screen.findByLabelText("새벽별 훈독모임에 남길 한 줄");
    expect(text).toHaveValue("아이에게 먼저 말을 걸어 볼게요.");
    fireEvent.change(text, { target: { value: " \n  " } });
    const button = screen.getByRole("button", { name: "한 줄 고치기" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("한 줄을 적어 주세요");
    expect(groupsAPI.putTodayShare).not.toHaveBeenCalled();
    fireEvent.change(text, { target: { value: "다시 적어요" } });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(groupsAPI.putTodayShare).toHaveBeenCalledTimes(1);
  });

  it("시작 문장은 빈 칸이면 채우고, 쓰던 글이 있으면 지우지 않고 뒤에 잇는다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail());
    renderUi(<GroupShareForm groupId={G} />);
    const text = await screen.findByLabelText("새벽별 훈독모임에 남길 한 줄");
    fireEvent.click(screen.getByRole("button", { name: "이 말씀을 읽고 떠오른 사람은" }));
    expect(text).toHaveValue("아이에게 먼저 말을 걸어 볼게요. 이 말씀을 읽고 떠오른 사람은 ");
    fireEvent.change(text, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "이 말씀을 읽고 떠오른 사람은" }));
    expect(text).toHaveValue("이 말씀을 읽고 떠오른 사람은 ");
    // 다른 시작 문장만 있으면 바꾼다(겹쳐 쌓지 않는다)
    fireEvent.click(screen.getByRole("button", { name: /오늘 이 말씀을 이렇게 살아 보려 해요/ }));
    expect(text).toHaveValue("오늘 이 말씀을 이렇게 살아 보려 해요. ");
  });

  it("오늘 훈독 전이면 쓰기 대신 훈독하기, 서버 409 READ_REQUIRED 도 같은 안내", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail({ shares: [] }));
    vi.mocked(groupsAPI.putTodayShare).mockRejectedValue(apiError(409, "READ_REQUIRED"));
    renderUi(<GroupShareForm groupId={G} />);
    fireEvent.change(await screen.findByLabelText("새벽별 훈독모임에 남길 한 줄"), { target: { value: "한 줄" } });
    fireEvent.click(screen.getByRole("button", { name: "한 줄 남기기" }));
    expect(await screen.findByRole("link", { name: "훈독하기" })).toHaveAttribute("href", "/hoondok/read");
  });

  it("시작 문장을 누르면 입력칸을 채운다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail({ shares: [] }));
    renderUi(<GroupShareForm groupId={G} />);
    fireEvent.click(await screen.findByRole("button", { name: /이 말씀을 읽고 떠오른 사람은/ }));
    expect(screen.getByLabelText("새벽별 훈독모임에 남길 한 줄")).toHaveValue("이 말씀을 읽고 떠오른 사람은 ");
  });
});

describe("SCR-PWA-021 모임 설정", () => {
  it("리더: 식구 N명(읽음 상태 없음) · 초대 코드 만료일 · 새로 만들기 확인 · 리더 나가기 잠금", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    vi.mocked(groupsAPI.members).mockResolvedValue(MEMBERS);
    vi.mocked(groupsAPI.regenerateInvite).mockResolvedValue({
      invite_code: "AAAABBBB",
      invite_expires_at: "2026-10-24T00:00:00",
    });
    renderUi(<GroupSettings groupId={G} />);
    expect(await screen.findByText("식구 3명")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "식구 목록" });
    expect(within(list).getByText("은정 (나)")).toBeInTheDocument();
    expect(within(list).getByText("모임원 · 9월 13일에 들어왔어요")).toBeInTheDocument();
    expect(list.textContent).not.toMatch(/읽었|오전|오후/);
    expect(screen.getByLabelText("모임 이름")).toHaveValue("새벽별 훈독모임");
    expect(screen.getByText("10월 23일까지")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "초대 코드 새로 만들기" }));
    const regen = screen.getByRole("group", { name: "초대 코드 새로 만들기 확인" });
    expect(regen).toHaveTextContent("이전 코드는 바로 막혀요");
    fireEvent.click(within(regen).getByRole("button", { name: "새로 만들기" }));
    await waitFor(() => expect(groupsAPI.regenerateInvite).toHaveBeenCalledWith(G));
    expect(await screen.findByLabelText("초대 코드 AAAA-BBBB")).toBeInTheDocument();

    // 다른 식구가 있으면 리더는 나갈 수 없다
    expect(screen.getByText("다른 식구가 있으면 리더는 나갈 수 없어요 · 리더 넘기기는 준비 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "나가기" })).toBeDisabled();
  });

  it("리더: 식구 내보내기 확인 · 모임 삭제 확인 뒤 홈으로", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    vi.mocked(groupsAPI.members).mockResolvedValue(MEMBERS);
    vi.mocked(groupsAPI.removeMember).mockResolvedValue(undefined);
    vi.mocked(groupsAPI.remove).mockResolvedValue(undefined);
    renderUi(<GroupSettings groupId={G} />);
    await screen.findByText("식구 3명");
    // 나 자신에게는 내보내기가 없다
    // 여는 버튼마다 대상 이름이 접근 이름에 들어간다 (QA P2-4)
    expect(screen.getAllByRole("button", { name: /^.+ 내보내기$/, expanded: false })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "서연 내보내기" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "미카 내보내기" }));
    const kick = screen.getByRole("group", { name: "미카 님 내보내기 확인" });
    fireEvent.click(within(kick).getByRole("button", { name: "내보내기" }));
    await waitFor(() => expect(groupsAPI.removeMember).toHaveBeenCalledWith(G, "m-2"));

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const del = screen.getByRole("group", { name: "모임 삭제 확인" });
    fireEvent.click(within(del).getByRole("button", { name: "모임 삭제" }));
    await waitFor(() => expect(groupsAPI.remove).toHaveBeenCalledWith(G));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/hoondok"));
  });

  it("확인 카드: 취소하면 닫히고 초점이 여는 버튼으로 돌아간다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    vi.mocked(groupsAPI.members).mockResolvedValue(MEMBERS);
    renderUi(<GroupSettings groupId={G} />);
    const opener = await screen.findByRole("button", { name: "삭제" });
    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    const box = screen.getByRole("group", { name: "모임 삭제 확인" });
    await act(async () => {
      fireEvent.click(within(box).getByRole("button", { name: "취소" }));
    });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveFocus();
    expect(groupsAPI.remove).not.toHaveBeenCalled();
  });

  it("혼자 남은 리더는 나가기 = 모임 삭제라고 알리고 나갈 수 있다", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(LEADER_DETAIL());
    vi.mocked(groupsAPI.members).mockResolvedValue({ member_count: 1, items: [MEMBERS.items[0]] });
    vi.mocked(groupsAPI.leave).mockResolvedValue(undefined);
    renderUi(<GroupSettings groupId={G} />);
    expect(await screen.findByText("혼자 남은 리더가 나가면 모임이 삭제돼요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "모임 나가기 확인" })).getByRole("button", { name: "나가기" }),
    );
    await waitFor(() => expect(groupsAPI.leave).toHaveBeenCalledWith(G));
  });

  it("모임원: 내 이름 + 나가기(확인 '나가면 내 한 줄도 함께 지워져요') → 홈, 식구 목록·초대 코드 없음", async () => {
    vi.mocked(groupsAPI.get).mockResolvedValue(detail());
    vi.mocked(groupsAPI.leave).mockResolvedValue(undefined);
    vi.mocked(groupsAPI.updateMyName).mockRejectedValue(apiError(409, "DISPLAY_NAME_TAKEN"));
    renderUi(<GroupSettings groupId={G} />);
    const me = await screen.findByLabelText("이 모임에서 쓸 내 이름");
    expect(me).toHaveValue("효진");
    expect(screen.queryByLabelText("모임 이름")).not.toBeInTheDocument();
    expect(screen.queryByText(/식구 \d+명/)).not.toBeInTheDocument();
    expect(screen.queryByText("초대 코드")).not.toBeInTheDocument();
    expect(groupsAPI.members).not.toHaveBeenCalled();

    // 공백만 있는 이름은 막고, 중복은 서버 409 안내
    fireEvent.change(me, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이 모임에서 쓸 이름을 적어 주세요");
    expect(groupsAPI.updateMyName).not.toHaveBeenCalled();
    fireEvent.change(me, { target: { value: "미카" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이 모임에 같은 이름이 있어요");

    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    const box = screen.getByRole("group", { name: "모임 나가기 확인" });
    expect(box).toHaveTextContent("나가면 내 한 줄도 함께 지워져요");
    // 받침 없는 "모임" → 조사 "을" (QA P2-5)
    expect(box).toHaveTextContent("새벽별 훈독모임을 나갈까요?");
    expect(box).not.toHaveTextContent("을(를)");
    fireEvent.click(within(box).getByRole("button", { name: "나가기" }));
    await waitFor(() => expect(groupsAPI.leave).toHaveBeenCalledWith(G));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/hoondok"));
  });

  it("내보내진 뒤 설정을 열면 안내 화면", async () => {
    vi.mocked(groupsAPI.get).mockRejectedValue(apiError(404, "GROUP_NOT_FOUND"));
    renderUi(<GroupSettings groupId={G} />);
    expect(await screen.findByText("이 모임을 볼 수 없어요")).toBeInTheDocument();
  });
});
