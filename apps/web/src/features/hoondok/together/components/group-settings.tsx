"use client";

// SCR-PWA-021 모임 설정 (PLAN-HD-010 D2, 프로토타입 group-settings · ?role=member).
// 리더 5가지 = 모임 이름 변경 · 식구 목록(전체 인원은 여기서만) · 초대 코드 새로 만들기 · 식구 내보내기 · 나가기/모임 삭제.
// 모임원 = 내 이름 변경 · 나가기. 식구 목록에 읽음 상태를 넣지 않는다. 리더 넘기기는 후속이다.
// 되돌릴 수 없는 동작은 인라인 확인 카드(InlineConfirm)를 거친다. 나가기·삭제 뒤에는 홈으로 간다.
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type GroupDetail, groupErrorOf, type MemberList } from "../groups-api";
import {
  useDeleteGroup,
  useGroup,
  useGroupMembers,
  useLeaveGroup,
  useRegenerateInvite,
  useRemoveMember,
  useRenameGroup,
  useUpdateMyName,
} from "../use-groups";
import {
  formatKstDay,
  GroupAlert,
  GroupInviteShare,
  GroupLoadFailed,
  GroupLoading,
  GroupLoginRequired,
  GroupUnavailable,
  groupHref,
  HOME_HREF,
  InlineConfirm,
  initialOf,
  isGroupGone,
} from "./group-common";
import { DISPLAY_NAME_MAX, GROUP_NAME_MAX } from "./group-create-form";

function mutationMessage(error: unknown): string {
  const { status, code } = groupErrorOf(error);
  if (code === "DISPLAY_NAME_TAKEN") return "이 모임에 같은 이름이 있어요. 다른 이름을 적어 주세요";
  if (code === "LEADER_MUST_HANDOVER") return "다른 식구가 있으면 리더는 나갈 수 없어요";
  if (code === "CANNOT_REMOVE_SELF") return "나 자신은 내보낼 수 없어요";
  if (status === 403) return "리더만 바꿀 수 있어요";
  if (status === 422) return "입력한 값을 다시 확인해 주세요";
  if (status === 429) return "잠시 뒤 다시 시도해 주세요";
  return "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

/** 입력 + 저장 한 줄 (모임 이름·내 이름). 공백만이면 보내지 않는다. */
function InlineTextField({
  id,
  label,
  help,
  initialValue,
  maxLength,
  emptyMessage,
  onSave,
  isPending,
  error,
}: {
  id: string;
  label: string;
  help: string;
  initialValue: string;
  maxLength: number;
  emptyMessage: string;
  onSave: (value: string, onDone: () => void) => void;
  isPending: boolean;
  error: unknown;
}) {
  const [value, setValue] = useState(initialValue);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setLocalError(emptyMessage);
      return;
    }
    setLocalError(null);
    setIsSaved(false);
    onSave(trimmed, () => {
      setValue(trimmed);
      setIsSaved(true);
    });
  };

  const message = localError ?? (error ? mutationMessage(error) : null);
  return (
    <form className="field" onSubmit={submit} noValidate>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="tg-inline">
        <input
          id={id}
          type="text"
          value={value}
          maxLength={maxLength}
          autoComplete="off"
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setValue(event.target.value);
            setIsSaved(false);
          }}
        />
        <HoondokButton type="submit" variant="line" isSmall isLoading={isPending}>
          저장
        </HoondokButton>
      </div>
      <span className="field__help" id={`${id}-help`}>
        {help}
      </span>
      {message && <GroupAlert>{message}</GroupAlert>}
      {isSaved && !message && (
        <p className="tg-status" role="status">
          저장했어요
        </p>
      )}
    </form>
  );
}

function MemberSection({ detail, members }: { detail: GroupDetail; members: MemberList }) {
  const remove = useRemoveMember(detail.id);
  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">식구</h3>
        <span className="sect__rule" />
        <span className="sect__meta">식구 {members.member_count}명</span>
      </div>
      <ul className="card tg-people" aria-label="식구 목록">
        {members.items.map((member) => {
          const isMe = member.id === detail.me.member_id;
          const isLeader = member.role === "leader";
          return (
            <li className={isMe ? "tg-person" : "tg-person tg-member"} key={member.id}>
              <span className={isMe ? "tg-av tg-av--me" : "tg-av"} aria-hidden="true">
                {initialOf(member.display_name)}
              </span>
              <span className="tg-person__bd">
                <b>
                  {member.display_name}
                  {isMe && " (나)"}
                </b>
                <span>
                  {isLeader
                    ? `리더 · ${formatKstDay(member.joined_at)}에 만들었어요`
                    : `모임원 · ${formatKstDay(member.joined_at)}에 들어왔어요`}
                </span>
              </span>
              {!isMe && (
                <InlineConfirm
                  openLabel="내보내기"
                  label={`${member.display_name} 님 내보내기 확인`}
                  message={`${member.display_name} 님을 내보낼까요? ${member.display_name} 님이 남긴 한 줄과 반응도 함께 지워져요. 지금 초대 코드로는 다시 들어올 수 있어요 — 막으려면 초대 코드를 새로 만들어 주세요.`}
                  confirmLabel="내보내기"
                  isPending={remove.isPending && remove.variables === member.id}
                  onConfirm={() => remove.mutate(member.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {remove.isError && <GroupAlert>{mutationMessage(remove.error)}</GroupAlert>}
      <p className="tg-again">이 목록에는 오늘 읽었는지 표시하지 않아요. 전체 인원도 리더 설정에서만 보여요.</p>
    </div>
  );
}

function InviteSection({ detail }: { detail: GroupDetail }) {
  const regenerate = useRegenerateInvite(detail.id);
  if (!detail.invite_code) return null;
  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">초대 코드</h3>
        <span className="sect__rule" />
        {detail.invite_expires_at && <span className="sect__meta">{formatKstDay(detail.invite_expires_at)}까지</span>}
      </div>
      <div className="card">
        <GroupInviteShare groupName={detail.name} code={detail.invite_code} />
        <p className="tg-again">코드를 받은 사람은 누구나 들어올 수 있어요. 만든 날부터 30일 동안 쓸 수 있어요.</p>
        <div className="tg-regen">
          {/* 코드가 바뀌면 key 로 확인 카드를 닫는다 */}
          <InlineConfirm
            key={detail.invite_code}
            openLabel="초대 코드 새로 만들기"
            openClassName="btn btn-line btn--sm tg-wide"
            openIcon={<RefreshCw size={16} aria-hidden="true" />}
            label="초대 코드 새로 만들기 확인"
            message={
              <>
                새 코드를 만들까요? <b>이전 코드는 바로 막혀요.</b> 이미 들어온 식구는 그대로예요.
              </>
            }
            confirmLabel="새로 만들기"
            isPending={regenerate.isPending}
            onConfirm={() => regenerate.mutate()}
          />
        </div>
        {regenerate.isError && <GroupAlert>{mutationMessage(regenerate.error)}</GroupAlert>}
      </div>
    </div>
  );
}

function DangerSection({ detail, memberCount }: { detail: GroupDetail; memberCount: number | null }) {
  const router = useRouter();
  const leave = useLeaveGroup(detail.id);
  const remove = useDeleteGroup(detail.id);
  const isLeader = detail.me.role === "leader";
  // 식구 목록을 아직 못 읽었으면 다른 식구가 있다고 본다(나가기 잠금이 안전한 쪽).
  const isAlone = memberCount === 1;
  const goHome = () => router.replace(HOME_HREF);
  const error = leave.error ?? remove.error;

  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">{isLeader ? "나가기 · 모임 삭제" : "모임 나가기"}</h3>
        <span className="sect__rule" />
      </div>
      <div className="card tg-set">
        {isLeader && !isAlone && (
          <div className="tg-set__row">
            <span className="tg-set__bd">
              <b>모임 나가기</b>
              <span>다른 식구가 있으면 리더는 나갈 수 없어요 · 리더 넘기기는 준비 중</span>
            </span>
            <button className="btn btn-line btn--sm" type="button" disabled aria-disabled="true">
              나가기
            </button>
          </div>
        )}
        {(!isLeader || isAlone) && (
          <div className="tg-set__row">
            <span className="tg-set__bd">
              <b>모임 나가기</b>
              <span>
                {isLeader ? "혼자 남은 리더가 나가면 모임이 삭제돼요" : "나가면 내가 남긴 한 줄과 반응도 함께 지워져요"}
              </span>
            </span>
            <InlineConfirm
              openLabel="나가기"
              label="모임 나가기 확인"
              message={
                isLeader
                  ? `${detail.name}을(를) 나갈까요? 다른 식구가 없어 모임이 함께 삭제돼요. 내 훈독 기록은 그대로 남아요.`
                  : `${detail.name}을(를) 나갈까요? 나가면 내 한 줄도 함께 지워져요. 다시 들어오려면 초대 코드가 필요해요. 내 훈독 기록은 그대로 남아요.`
              }
              confirmLabel="나가기"
              isPending={leave.isPending}
              onConfirm={() => leave.mutate(undefined, { onSuccess: goHome })}
            />
          </div>
        )}
        {isLeader && (
          <div className="tg-set__row">
            <span className="tg-set__bd">
              <b>모임 삭제</b>
              <span>식구·한 줄 나눔·모임 정성이 모두 지워져요. 되돌릴 수 없어요</span>
            </span>
            <InlineConfirm
              openLabel="삭제"
              label="모임 삭제 확인"
              message={`${detail.name}을(를) 지울까요? 식구 모두 모임에서 빠지고 한 줄 나눔·모임 정성도 함께 지워져요. 각자의 훈독 기록과 개인 정성은 그대로 남아요.`}
              confirmLabel="모임 삭제"
              isPending={remove.isPending}
              onConfirm={() => remove.mutate(undefined, { onSuccess: goHome })}
            />
          </div>
        )}
      </div>
      {error && <GroupAlert>{mutationMessage(error)}</GroupAlert>}
    </div>
  );
}

function SettingsBody({ detail }: { detail: GroupDetail }) {
  const isLeader = detail.me.role === "leader";
  const members = useGroupMembers(detail.id, isLeader);
  const rename = useRenameGroup(detail.id);
  const updateName = useUpdateMyName(detail.id);

  return (
    <>
      <p className="tg-lede">
        {isLeader
          ? `${detail.name}의 리더 설정이에요. 모임 이름·식구·초대 코드를 관리해요.`
          : `${detail.name}에서 쓰는 내 이름을 바꾸거나 모임을 나갈 수 있어요.`}
      </p>

      {isLeader && (
        <InlineTextField
          id="gt-name"
          label="모임 이름"
          help="바꾸면 식구 모두에게 새 이름이 보여요. 교회 이름은 쓰지 않아도 돼요."
          initialValue={detail.name}
          maxLength={GROUP_NAME_MAX}
          emptyMessage="모임 이름을 적어 주세요"
          isPending={rename.isPending}
          error={rename.error}
          onSave={(value, onDone) => rename.mutate(value, { onSuccess: onDone })}
        />
      )}

      <InlineTextField
        id="gt-me"
        label="이 모임에서 쓸 내 이름"
        help="이 모임에서만 쓰는 이름이에요. 같은 모임에 같은 이름은 쓸 수 없어요."
        initialValue={detail.me.display_name}
        maxLength={DISPLAY_NAME_MAX}
        emptyMessage="이 모임에서 쓸 이름을 적어 주세요"
        isPending={updateName.isPending}
        error={updateName.error}
        onSave={(value, onDone) => updateName.mutate(value, { onSuccess: onDone })}
      />

      {isLeader &&
        (members.data ? (
          <MemberSection detail={detail} members={members.data} />
        ) : members.isError ? (
          <GroupAlert>식구 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요</GroupAlert>
        ) : (
          <GroupLoading label="식구 목록을 불러오는 중" />
        ))}

      {isLeader && <InviteSection detail={detail} />}

      <DangerSection detail={detail} memberCount={members.data?.member_count ?? null} />
      <p className="notice">모임 설정은 이 모임 식구에게만 영향을 줘요. 모임은 검색되지 않아요</p>
    </>
  );
}

export function GroupSettings({ groupId }: { groupId: string }) {
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const group = useGroup(user ? groupId : undefined);

  if (isUserLoading) return <GroupLoading />;

  let content: ReactNode;
  if (!user)
    content = (
      <GroupLoginRequired
        returnTo={`${groupHref(groupId)}/settings`}
        title="로그인하면 모임 설정을 볼 수 있어요"
        body="모임 식구만 설정을 열 수 있어요."
      />
    );
  else if (group.isError && isGroupGone(group.error)) content = <GroupUnavailable />;
  else if (group.isPending) content = <GroupLoading />;
  else if (group.isError && !group.data) content = <GroupLoadFailed onRetry={() => void group.refetch()} />;
  // key: 다른 모임으로 옮겨 가면 입력 칸 초기값을 새로 잡는다
  else content = <SettingsBody key={group.data.id} detail={group.data} />;

  return <section className="col tg-form tg-page">{content}</section>;
}
