import { ApiError, createApiClient } from "@truewords/api-client-ts";
import type {
  DisplayNameInput,
  GroupCreate,
  GroupDetail,
  GroupJeongseongInput,
  GroupJeongseongOut,
  GroupMe,
  GroupRename,
  GroupShareOut,
  InviteOut,
  InvitePreview,
  JoinResult,
  MemberList,
  MyGroupItem,
  ReactionState,
  ShareInput,
} from "@truewords/api-client-ts/types";
import { hoondokFetch } from "../observability/report";

// 함께 읽는 모임 2단계 (API-HD-030~041, PLAN-HD-010). 브라우저에서 쿠키와 함께 /api/backend 프록시로 간다.
// POST·PUT·PATCH·DELETE 의 X-Requested-With 는 createApiClient 의 transport 가 붙인다.
// 비모임원에게 서버는 모임 존재를 알리지 않고 404 를 준다 — 화면은 "없는 모임"과 구분하지 않는다.
export type {
  DisplayNameInput,
  GroupCreate,
  GroupDetail,
  GroupJeongseongInput,
  GroupJeongseongOut,
  GroupMe,
  GroupShareOut,
  InviteOut,
  InvitePreview,
  JoinResult,
  MemberList,
  MyGroupItem,
  ReactionState,
};

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });

const group = (groupId: string) => `/hoondok/groups/${encodeURIComponent(groupId)}`;
const invite = (code: string) => `/hoondok/invites/${encodeURIComponent(code)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

async function noContent(path: string, method: "DELETE"): Promise<void> {
  await request<Record<string, never>>(path, { method });
}

export const groupsAPI = {
  /** API-HD-030 내 모임. 0건이면 []. */
  mine: () => request<MyGroupItem[]>("/hoondok/me/groups"),
  /** API-HD-031 만들기 — 201 상세(리더라 invite_code 포함). 409 LEADER_LIMIT·JOIN_LIMIT. */
  create: (body: GroupCreate) => request<GroupDetail>("/hoondok/groups", json("POST", body)),
  /** API-HD-032 상세 — 비모임원 404 GROUP_NOT_FOUND. */
  get: (groupId: string) => request<GroupDetail>(group(groupId)),
  /** API-HD-033 이름 변경(리더). */
  rename: (groupId: string, body: GroupRename) => request<GroupDetail>(group(groupId), json("PATCH", body)),
  /** API-HD-033 모임 삭제(리더) — 204. */
  remove: (groupId: string) => noContent(group(groupId), "DELETE"),
  /** API-HD-034 초대 코드 재발급(리더) — 이전 코드는 즉시 무효. */
  regenerateInvite: (groupId: string) => request<InviteOut>(`${group(groupId)}/invite`, { method: "POST" }),
  /** API-HD-035 초대 미리보기 — 잘못·만료·정원 초과는 모두 404 INVITE_NOT_FOUND, 429 초대 limiter. */
  previewInvite: (code: string) => request<InvitePreview>(invite(code)),
  /** API-HD-036 참여 — 201 {group_id}. 409 ALREADY_MEMBER·DISPLAY_NAME_TAKEN·GROUP_FULL·JOIN_LIMIT. */
  join: (code: string, body: DisplayNameInput) => request<JoinResult>(`${invite(code)}/join`, json("POST", body)),
  /** API-HD-037 이 모임에서 내 이름 변경 — 409 DISPLAY_NAME_TAKEN. */
  updateMyName: (groupId: string, body: DisplayNameInput) =>
    request<GroupMe>(`${group(groupId)}/me`, json("PATCH", body)),
  /** API-HD-037 나가기 — 204. 리더는 다른 식구가 있으면 409 LEADER_MUST_HANDOVER. */
  leave: (groupId: string) => noContent(`${group(groupId)}/me`, "DELETE"),
  /** API-HD-038 식구 목록(리더) — 전체 인원은 여기만 있다. */
  members: (groupId: string) => request<MemberList>(`${group(groupId)}/members`),
  /** API-HD-038 내보내기(리더) — 204. 자기 자신 409 CANNOT_REMOVE_SELF. */
  removeMember: (groupId: string, memberId: string) =>
    noContent(`${group(groupId)}/members/${encodeURIComponent(memberId)}`, "DELETE"),
  /** API-HD-039 모임 정성 추가(리더) — 201. 409 JEONGSEONG_LIMIT · 422 STARTED_ON_OUT_OF_RANGE·JEONGSEONG_ALREADY_ENDED. */
  addJeongseong: (groupId: string, body: GroupJeongseongInput) =>
    request<GroupJeongseongOut>(`${group(groupId)}/jeongseongs`, json("POST", body)),
  /** API-HD-039 모임 정성 삭제(리더) — 204. 공식 정성은 404. */
  deleteJeongseong: (groupId: string, jeongseongId: string) =>
    noContent(`${group(groupId)}/jeongseongs/${encodeURIComponent(jeongseongId)}`, "DELETE"),
  /** API-HD-040 오늘 한 줄 쓰기·고치기(upsert) — 오늘 훈독 미완료면 409 READ_REQUIRED. */
  putTodayShare: (groupId: string, body: ShareInput) =>
    request<GroupShareOut>(`${group(groupId)}/shares/today`, json("PUT", body)),
  /** API-HD-040 한 줄 삭제(작성자·리더) — 204. 그 외 403 NOT_ALLOWED. */
  deleteShare: (groupId: string, shareId: string) =>
    noContent(`${group(groupId)}/shares/${encodeURIComponent(shareId)}`, "DELETE"),
  /** API-HD-041 "함께 머물렀어요" 켜기(PUT)·끄기(DELETE). 둘 다 멱등, 자기 한 줄 409 OWN_SHARE. */
  setReaction: (groupId: string, shareId: string, isOn: boolean) =>
    request<ReactionState>(`${group(groupId)}/shares/${encodeURIComponent(shareId)}/reaction`, {
      method: isOn ? "PUT" : "DELETE",
    }),
};

/** 서버가 주는 모임 오류 코드 (docs/specs/api/hoondok-api.md PLAN-HD-010 공통). 화면 문구 분기에만 쓴다. */
export type GroupErrorCode =
  | "GROUP_NOT_FOUND"
  | "INVITE_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "SHARE_NOT_FOUND"
  | "JEONGSEONG_NOT_FOUND"
  | "LEADER_ONLY"
  | "NOT_ALLOWED"
  | "LEADER_LIMIT"
  | "JOIN_LIMIT"
  | "GROUP_FULL"
  | "ALREADY_MEMBER"
  | "DISPLAY_NAME_TAKEN"
  | "JEONGSEONG_LIMIT"
  | "READ_REQUIRED"
  | "LEADER_MUST_HANDOVER"
  | "CANNOT_REMOVE_SELF"
  | "OWN_SHARE"
  | "STARTED_ON_OUT_OF_RANGE"
  | "JEONGSEONG_ALREADY_ENDED"
  | "RATE_LIMIT_EXCEEDED";

export type GroupError = {
  /** HTTP 상태. 네트워크 실패(오프라인)는 0 */
  status: number;
  /** `{"detail": "<코드>"}` 또는 `error_code` 의 코드. Pydantic 422(배열 detail)·빈 응답은 null */
  code: string | null;
};

/**
 * 모임 API 오류를 상태 + 코드로 푼다. 공용 SDK 는 `detail` 문자열을 message·details 에 담고
 * error_code 는 비워 두므로(ErrorResponse 만 error_code) 두 자리를 모두 본다.
 */
export function groupErrorOf(error: unknown): GroupError {
  if (!(error instanceof ApiError)) return { status: 0, code: null };
  const code = error.errorCode ?? (typeof error.details === "string" ? error.details : null);
  return { status: error.status, code };
}

/** 코드 일치 확인 — `isGroupError(e, "GROUP_FULL")`. */
export function isGroupError(error: unknown, code: GroupErrorCode): boolean {
  return groupErrorOf(error).code === code;
}
