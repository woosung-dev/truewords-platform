"use client";

// SCR-PWA-019 모임 만들기 (PLAN-HD-010 §6, 프로토타입 group-create · ?created=1).
// 오늘 범위 선택은 없다(D1) — 모든 모임이 공식 편성을 따른다. 만든 뒤에는 URL 을 `?created={id}` 로 바꿔
// 새로고침해도 초대 코드 화면이 남게 한다(상세 캐시는 만들기 응답으로 채워져 있다).
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type GroupCreate, groupErrorOf } from "../groups-api";
import { useCreateGroup, useGroup } from "../use-groups";
import {
  GroupAlert,
  GroupInviteShare,
  GroupLoading,
  GroupLoginRequired,
  GroupNotice,
  groupHref,
  isGroupGone,
} from "./group-common";

export const NEW_GROUP_PATH = "/hoondok/groups/new";
export const GROUP_NAME_MAX = 20;
export const DISPLAY_NAME_MAX = 12;
export const JEONGSEONG_TITLE_MAX = 24;

type Term = "21" | "40" | "custom";
const TERMS: { value: Term; label: string }[] = [
  { value: "21", label: "21일" },
  { value: "40", label: "40일" },
  { value: "custom", label: "직접" },
];

export type GroupCreateFormProps = {
  /** 서버가 계산한 KST 오늘 `YYYY-MM-DD` (정성 시작일 기본값) */
  today: string;
  /** `?created={id}` — 만든 직후 초대 코드 화면 */
  createdId?: string | null;
};

function createErrorMessage(error: unknown): string {
  const { status, code } = groupErrorOf(error);
  if (code === "LEADER_LIMIT") return "리더로는 모임을 3개까지 만들 수 있어요";
  if (code === "JOIN_LIMIT") return "모임은 5개까지 함께할 수 있어요. 다른 모임을 나간 뒤 만들어 주세요";
  if (code === "STARTED_ON_OUT_OF_RANGE") return "정성 시작일은 오늘 앞뒤 30일 안에서 골라 주세요";
  if (code === "JEONGSEONG_ALREADY_ENDED") return "이미 끝난 기간이에요. 시작일이나 기간을 바꿔 주세요";
  if (status === 422) return "입력한 값을 다시 확인해 주세요";
  if (status === 429) return "잠시 뒤 다시 시도해 주세요";
  if (status === 401) return "로그인이 풀렸어요. 다시 로그인해 주세요";
  return "모임을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

/** 만든 직후 : 초대 코드 + 공유 + 모임으로 가기 */
function CreatedCard({ groupId }: { groupId: string }) {
  const group = useGroup(groupId);
  if (group.isPending) return <GroupLoading label="초대 코드를 불러오는 중" />;
  if (group.isError || !group.data.invite_code) {
    return (
      <div className="card" role="status">
        <b className="tg-done__t">
          {isGroupGone(group.error) ? "이 모임을 볼 수 없어요" : "초대 코드를 불러오지 못했어요"}
        </b>
        <Link className="tg-link" href={groupHref(groupId)}>
          모임으로 가기
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    );
  }
  return (
    <div className="card tg-done" role="status">
      <b className="tg-done__t">모임을 만들었어요</b>
      <p className="tg-lede">이 코드를 식구들에게 보내 주세요. 코드를 받은 사람만 들어올 수 있어요.</p>
      <GroupInviteShare groupName={group.data.name} code={group.data.invite_code} />
      <Link className="tg-link" href={groupHref(groupId)}>
        모임으로 가기
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function GroupCreateForm({ today, createdId }: GroupCreateFormProps) {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const create = useCreateGroup();

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [meetingTime, setMeetingTime] = useState("");
  const [hasJeongseong, setHasJeongseong] = useState(false);
  const [jsTitle, setJsTitle] = useState("");
  const [term, setTerm] = useState<Term>("40");
  const [customDays, setCustomDays] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [formError, setFormError] = useState<string | null>(null);

  if (isUserLoading) return <GroupLoading />;
  if (!user)
    return (
      <section className="col tg-form tg-page">
        <GroupLoginRequired
          returnTo={NEW_GROUP_PATH}
          title="로그인하면 모임을 만들 수 있어요"
          body="초대 코드를 받은 식구들과 같은 말씀을 함께 읽어요."
        />
        <GroupNotice />
      </section>
    );

  if (createdId)
    return (
      <section className="col tg-form tg-page">
        <CreatedCard groupId={createdId} />
        <p className="notice">모임은 검색되지 않아요. 순위·점수·보상은 없습니다</p>
      </section>
    );

  // 표시 이름 기본값 = 계정 이름(12자까지). 사용자가 한 번이라도 고치면 그 값을 쓴다.
  const myName = displayName ?? Array.from(user.display_name).slice(0, DISPLAY_NAME_MAX).join("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // 버튼 비활성과 별개로 Enter 연타도 막는다 — 요청이 가는 동안 두 번째 제출은 버린다.
    if (create.isPending) return;
    const trimmedName = name.trim();
    const trimmedMe = myName.trim();
    if (!trimmedName) return setFormError("모임 이름을 적어 주세요");
    if (!trimmedMe) return setFormError("이 모임에서 쓸 내 이름을 적어 주세요");
    const body: GroupCreate = {
      name: trimmedName,
      display_name: trimmedMe,
      meeting_time: meetingTime ? meetingTime : null,
    };
    if (hasJeongseong) {
      const title = jsTitle.trim();
      const days = term === "custom" ? Number(customDays) : Number(term);
      if (!title) return setFormError("정성 이름을 적어 주세요");
      if (!Number.isInteger(days) || days < 1 || days > 100) return setFormError("정성 기간은 1~100일로 정해 주세요");
      if (!startedOn) return setFormError("정성 시작일을 골라 주세요");
      body.jeongseong = { title, duration_days: days, started_on: startedOn };
    }
    setFormError(null);
    create.mutate(body, {
      onSuccess: (detail) => router.replace(`${NEW_GROUP_PATH}?created=${encodeURIComponent(detail.id)}`),
    });
  };

  const error = formError ?? (create.isError ? createErrorMessage(create.error) : null);

  return (
    <section className="col tg-form tg-page">
      <p className="tg-lede">
        훈독 모임을 만들고 초대 코드로 식구들을 불러요. 모임 안에서는 오늘 읽은 사람과 한 줄 나눔만 보여요.
      </p>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <span className="field__label" id="gc-kind">
            모임 종류
          </span>
          <div className="tg-opts" role="radiogroup" aria-labelledby="gc-kind">
            <button className="tg-opt" type="button" role="radio" aria-checked="true">
              <span className="tg-radio" aria-hidden="true" />
              <span className="tg-opt__bd">
                <b>소그룹 · 훈독가정교회</b>
                <span>구역·청년·축복 기수처럼 서로 아는 식구 몇 명</span>
              </span>
            </button>
            <button className="tg-opt" type="button" role="radio" aria-checked="false" aria-disabled="true">
              <span className="tg-radio" aria-hidden="true" />
              <span className="tg-opt__bd">
                <b>가족 모임</b>
                <span>곧 열려요</span>
              </span>
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="gc-name">
            모임 이름
          </label>
          <input
            id="gc-name"
            type="text"
            value={name}
            maxLength={GROUP_NAME_MAX}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            aria-describedby="gc-name-help"
          />
          <span className="field__help" id="gc-name-help">
            {GROUP_NAME_MAX}자까지 · 교회 이름을 쓰지 않아도 돼요. 모임 식구들이 알아볼 별칭이면 충분해요.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="gc-me">
            이 모임에서 쓸 내 이름
          </label>
          <input
            id="gc-me"
            type="text"
            value={myName}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="off"
            onChange={(event) => setDisplayName(event.target.value)}
            aria-describedby="gc-me-help"
          />
          <span className="field__help" id="gc-me-help">
            {DISPLAY_NAME_MAX}자까지 · 리더로 표시돼요. 실명도 애칭도 괜찮아요.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="gc-time">
            모임 시간 (선택)
          </label>
          <input
            id="gc-time"
            type="time"
            value={meetingTime}
            onChange={(event) => setMeetingTime(event.target.value)}
            aria-describedby="gc-time-help"
          />
          <span className="field__help" id="gc-time-help">
            모임 머리에 &ldquo;매일 오전 6시&rdquo; 처럼 보여요. 알림은 보내지 않아요.
          </span>
        </div>

        <p className="field__help tg-note-line">오늘 범위는 모든 모임이 공식 편성(오늘 훈독과 같은 말씀)을 따라요.</p>

        <div className="field">
          <div className="card">
            {/* 줄 전체가 토글 버튼이다 — 글자를 눌러도 켜지고 누르는 영역이 44px 이상이다(어르신 사용자) */}
            <button
              className="tg-toggle-row"
              type="button"
              aria-pressed={hasJeongseong}
              aria-labelledby="gc-js-label"
              aria-describedby="gc-js-desc"
              onClick={() => setHasJeongseong((value) => !value)}
            >
              <span>
                <b id="gc-js-label">모임 정성 열기</b>
                <span id="gc-js-desc">선택 · 공식 정성과 따로 우리 모임이 드리는 정성</span>
              </span>
              <span className="toggle" aria-hidden="true" />
            </button>
            {hasJeongseong && (
              <div className="tg-sub">
                <div className="field">
                  <label className="field__label" htmlFor="gc-js-name">
                    정성 이름
                  </label>
                  <input
                    id="gc-js-name"
                    type="text"
                    value={jsTitle}
                    maxLength={JEONGSEONG_TITLE_MAX}
                    autoComplete="off"
                    onChange={(event) => setJsTitle(event.target.value)}
                  />
                </div>
                <div className="field">
                  <span className="field__label" id="gc-js-term">
                    기간
                  </span>
                  <div className="tg-opts tg-opts--row" role="radiogroup" aria-labelledby="gc-js-term">
                    {TERMS.map((option) => (
                      <button
                        key={option.value}
                        className="tg-opt"
                        type="button"
                        role="radio"
                        aria-checked={term === option.value}
                        onClick={() => setTerm(option.value)}
                      >
                        <Check size={16} className="tg-opt__ck" aria-hidden="true" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {term === "custom" && (
                  <div className="field">
                    <label className="field__label" htmlFor="gc-js-days">
                      기간 (1~100일)
                    </label>
                    <input
                      id="gc-js-days"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      value={customDays}
                      onChange={(event) => setCustomDays(event.target.value)}
                    />
                  </div>
                )}
                <div className="field">
                  <label className="field__label" htmlFor="gc-js-start">
                    시작일
                  </label>
                  <input
                    id="gc-js-start"
                    type="date"
                    value={startedOn}
                    onChange={(event) => setStartedOn(event.target.value)}
                    aria-describedby="gc-js-start-help"
                  />
                  <span className="field__help" id="gc-js-start-help">
                    진행은 &ldquo;N일차&rdquo;로만 보여요. 빠진 날이 있어도 정성은 이어지고, 개인별 기록은 보이지
                    않아요.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && <GroupAlert>{error}</GroupAlert>}

        <div className="tg-cta">
          <HoondokButton type="submit" isLoading={create.isPending}>
            모임 만들기
          </HoondokButton>
        </div>
      </form>
      <p className="notice">모임은 검색되지 않아요. 순위·점수·보상은 없습니다</p>
    </section>
  );
}
