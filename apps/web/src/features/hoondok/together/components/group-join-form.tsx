"use client";

// SCR-PWA-018 모임 참여 (PLAN-HD-010 §6, 프로토타입 group-join · ?via=link).
// 코드 입력(링크로 오면 채워져 있다) → 미리보기(이름·리더·정성, 전체 인원 없음) → 이 모임에서 쓸 이름 → 공개 안내 → 참여.
// 비로그인은 미리보기 API 도 401 이라 묻지 않고, returnTo 에 코드까지 실어 온보딩으로 보낸다(가입 폼 초대 코드가 미리 채워진다).
import { ChevronRight, Eye, EyeOff, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type GroupJeongseongOut, groupErrorOf, type InvitePreview } from "../groups-api";
import { extractInviteCode, formatInviteCode, isValidInviteCode, JOIN_PATH, normalizeInviteCode } from "../invite-code";
import { useInvitePreview, useJoinGroup } from "../use-groups";
import { GroupAlert, GroupLoading, GroupLoginRequired, groupHref, HOME_HREF } from "./group-common";
import { DISPLAY_NAME_MAX } from "./group-create-form";

export const INVITE_NOT_FOUND_MESSAGE = "초대 코드가 맞지 않거나 만료됐어요. 리더에게 코드를 다시 받아 주세요";
const RATE_LIMITED_MESSAGE = "잠시 뒤 다시 시도해 주세요";

/** 미리보기 오류 → 문구. 잘못·만료·정원 초과는 서버가 같은 404 로 준다. */
function previewErrorMessage(error: unknown): string {
  const { status } = groupErrorOf(error);
  if (status === 404) return INVITE_NOT_FOUND_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  return "모임을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

/** 참여 오류 → 문구. ALREADY_MEMBER 는 문구 대신 "모임으로 가기" 카드로 바꾼다(미리보기 재조회). */
export function joinErrorMessage(error: unknown): string {
  const { status, code } = groupErrorOf(error);
  if (status === 404) return INVITE_NOT_FOUND_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (code === "ALREADY_MEMBER") return "이미 이 모임 식구예요";
  if (code === "DISPLAY_NAME_TAKEN") return "이 모임에 같은 이름이 있어요. 다른 이름을 적어 주세요";
  if (code === "GROUP_FULL") return "모임 정원이 다 찼어요. 리더에게 알려 주세요";
  if (code === "JOIN_LIMIT") return "모임은 5개까지 함께할 수 있어요. 다른 모임을 나간 뒤 참여해 주세요";
  if (status === 422) return `이름은 1~${DISPLAY_NAME_MAX}자로 적어 주세요`;
  if (status === 401) return "로그인이 풀렸어요. 다시 로그인해 주세요";
  return "참여하지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

function jeongseongSummary(items: GroupJeongseongOut[]): string {
  return items
    .map((item) => (item.day_index === null ? `${item.title} 곧 시작` : `${item.title} ${item.day_index}일차`))
    .join(" · ");
}

function PreviewCard({ preview }: { preview: InvitePreview }) {
  return (
    <div className="field">
      <span className="field__label">이 모임</span>
      <div className="card">
        <span className="badge badge--line">소그룹 · 훈독가정교회</span>
        <h2 className="tg-head__nm">{preview.name}</h2>
        <p className="tg-head__meta">리더 {preview.leader_display_name} · 오늘 범위는 공식 편성을 따라요</p>
        {preview.jeongseongs.length > 0 && (
          <p className="tg-head__meta">함께 드리는 정성: {jeongseongSummary(preview.jeongseongs)}</p>
        )}
      </div>
    </div>
  );
}

function VisibilityNotice() {
  return (
    <div className="field">
      <span className="field__label">모임에 보이는 것</span>
      <div className="card">
        <p className="tg-lede tg-lede--flush">
          모임에는 오늘 읽었는지와 내가 남긴 한 줄만 보여요. 형광펜·노트·질문은 항상 나만 봐요.
        </p>
        <ul className="tg-vis">
          <li className="is-shown">
            <Eye size={16} aria-hidden="true" />
            <span>
              <b>보여요</b> · 이 모임에서 쓸 이름, 읽은 날의 읽은 시각, 내가 남긴 한 줄
            </span>
          </li>
          <li className="is-hidden">
            <EyeOff size={16} aria-hidden="true" />
            <span>
              <b>안 보여요</b> · 읽지 않은 날, 형광펜·노트·질문, 연속일
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export type GroupJoinFormProps = {
  /** `?code=` 원문. 링크로 들어오면 채워져 있다 */
  initialCode?: string | null;
};

export function GroupJoinForm({ initialCode }: GroupJoinFormProps) {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const fromLink = initialCode ? formatInviteCode(initialCode) : "";
  const isLinkValid = Boolean(initialCode) && isValidInviteCode(fromLink);

  const [codeInput, setCodeInput] = useState(fromLink);
  // 확인을 누른(또는 링크로 받은) 정규화 코드. 미리보기는 이 값으로만 묻는다(입력 중 요청 없음).
  const [checkedCode, setCheckedCode] = useState(isLinkValid ? normalizeInviteCode(fromLink) : "");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const preview = useInvitePreview(checkedCode, Boolean(user) && Boolean(checkedCode));
  const join = useJoinGroup();

  if (isUserLoading) return <GroupLoading label="초대를 확인하는 중" />;

  if (!user) {
    const returnTo = fromLink ? `${JOIN_PATH}?code=${encodeURIComponent(fromLink)}` : JOIN_PATH;
    return (
      <section className="col tg-form tg-page">
        <p className="tg-lede">리더에게 받은 초대 코드로 모임에 들어가요. 먼저 가입하거나 로그인해 주세요.</p>
        {fromLink && (
          <div className="field">
            <span className="field__label">받은 초대 코드</span>
            <div className="tg-via">
              <Link2 size={18} aria-hidden="true" />
              <span>{fromLink}</span>
            </div>
          </div>
        )}
        <div className="field">
          <GroupLoginRequired
            returnTo={returnTo}
            title="로그인하면 모임에 참여할 수 있어요"
            body="가입 뒤 이 화면으로 돌아오고, 코드는 그대로 남아 있어요."
          />
        </div>
      </section>
    );
  }

  const myName = displayName ?? Array.from(user.display_name).slice(0, DISPLAY_NAME_MAX).join("");

  const checkCode = () => {
    const normalized = normalizeInviteCode(extractInviteCode(codeInput) ?? codeInput);
    if (!isValidInviteCode(normalized)) {
      setCodeError("초대 코드는 8자리예요 (예: 7K2M-Q9XD)");
      return;
    }
    setCodeError(null);
    join.reset();
    setCodeInput(formatInviteCode(normalized));
    setCheckedCode(normalized);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // 버튼 비활성과 별개로 연타·Enter 반복 제출을 버린다.
    if (join.isPending || !preview.data) return;
    const trimmed = myName.trim();
    if (!trimmed) {
      setNameError("이 모임에서 쓸 이름을 적어 주세요");
      return;
    }
    setNameError(null);
    join.mutate(
      { code: checkedCode, displayName: trimmed },
      {
        onSuccess: ({ group_id }) => router.push(groupHref(group_id)),
        // 이미 식구면 미리보기의 is_member·group_id 로 "모임으로 가기" 를 보인다.
        onError: (error) => {
          if (groupErrorOf(error).code === "ALREADY_MEMBER") void preview.refetch();
        },
      },
    );
  };

  const isLinkEntry = isLinkValid && checkedCode === normalizeInviteCode(fromLink);
  const joinError =
    join.isError && groupErrorOf(join.error).code !== "ALREADY_MEMBER" ? joinErrorMessage(join.error) : null;

  return (
    <section className="col tg-form tg-page">
      <p className="tg-lede">리더에게 받은 초대 코드를 넣어 주세요. 초대 링크로 들어오면 코드가 이미 채워져 있어요.</p>

      <div className="field">
        <label className="field__label" htmlFor="gj-code">
          초대 코드
        </label>
        <div className="tg-code-row">
          <input
            id="gj-code"
            type="text"
            value={codeInput}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            // 카톡 메시지·링크 전체를 붙여 넣어도 잘리지 않게 넉넉히 받고, 코드가 보이면 그 코드만 남긴다
            maxLength={512}
            aria-invalid={Boolean(codeError) || undefined}
            onChange={(event) => setCodeInput(extractInviteCode(event.target.value) ?? event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                checkCode();
              }
            }}
          />
          <HoondokButton variant="line" isSmall onClick={checkCode} disabled={preview.isFetching}>
            확인
          </HoondokButton>
        </div>
        {codeError && <GroupAlert>{codeError}</GroupAlert>}
      </div>

      {isLinkEntry && preview.data && (
        <div className="field">
          <span className="field__label">초대 링크</span>
          <div className="tg-via">
            <Link2 size={18} aria-hidden="true" />
            <span>{preview.data.leader_display_name} 님이 보낸 링크로 들어왔어요</span>
          </div>
        </div>
      )}

      {checkedCode && preview.isPending && <GroupLoading label="모임을 확인하는 중" />}
      {checkedCode && preview.isError && <GroupAlert>{previewErrorMessage(preview.error)}</GroupAlert>}

      {preview.data?.is_member && preview.data.group_id ? (
        <>
          <PreviewCard preview={preview.data} />
          <div className="card tg-done" role="status">
            <b className="tg-done__t">이미 이 모임 식구예요</b>
            {/* 이 화면의 유일한 다음 행동이라 글자 링크가 아닌 주 버튼으로 둔다 */}
            <Link className="btn btn-primary tg-done__go" href={groupHref(preview.data.group_id)}>
              모임으로 가기
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </>
      ) : preview.data && !preview.isError ? (
        <form onSubmit={submit} noValidate>
          <PreviewCard preview={preview.data} />

          <div className="field">
            <label className="field__label" htmlFor="gj-name">
              이 모임에서 쓸 이름
            </label>
            <input
              id="gj-name"
              type="text"
              value={myName}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              aria-describedby="gj-name-help"
              aria-invalid={Boolean(nameError) || undefined}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <span className="field__help" id="gj-name-help">
              {DISPLAY_NAME_MAX}자까지 · 모임마다 다르게 정할 수 있어요. 실명도 애칭도 괜찮아요.
            </span>
            {nameError && <GroupAlert>{nameError}</GroupAlert>}
          </div>

          <VisibilityNotice />

          {joinError && <GroupAlert>{joinError}</GroupAlert>}

          <div className="tg-cta">
            <HoondokButton type="submit" isLoading={join.isPending}>
              모임에 참여하기
            </HoondokButton>
            <Link className="btn btn-ghost" href={HOME_HREF}>
              나중에
            </Link>
          </div>
        </form>
      ) : null}

      <p className="notice">모임은 언제든 나갈 수 있고, 나가면 내 한 줄도 함께 지워져요</p>
    </section>
  );
}
