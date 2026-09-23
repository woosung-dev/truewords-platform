"use client";

// SCR-PWA-020 한 줄 나눔 쓰기 (PLAN-HD-010 §6, 프로토타입 group-share).
// 100자 한 줄 upsert — 오늘 이미 남겼으면 그 글로 채워 고친다. 오늘 훈독을 마친 사람만 쓴다(서버 409 READ_REQUIRED).
// 공백·줄바꿈 정리는 서버 규칙(normalize_share_body)과 같게 미리 해 두고, 빈 글은 보내지 않는다.
import { BookOpenText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type GroupDetail, groupErrorOf } from "../groups-api";
import { useGroup, usePutTodayShare } from "../use-groups";
import {
  GroupAlert,
  GroupLoadFailed,
  GroupLoading,
  GroupLoginRequired,
  GroupUnavailable,
  groupHref,
  isGroupGone,
  READ_HREF,
} from "./group-common";

export const SHARE_MAX = 100;

const STARTERS = [
  '오늘 마음에 머문 구절은 "',
  "이 말씀을 읽고 떠오른 사람은 ",
  "오늘 이 말씀을 이렇게 살아 보려 해요. ",
];

/** 줄마다 앞뒤 공백 제거 · 연속 공백 1칸 · 빈 줄 제거 (서버 normalize_share_body 와 같은 규칙). */
export function normalizeShareBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function ReadFirst() {
  return (
    <div className="card tg-read-first">
      <p className="tg-lede tg-lede--flush">한 줄은 오늘 훈독을 마친 뒤에 남길 수 있어요.</p>
      <Link className="btn btn-primary" href={READ_HREF}>
        <BookOpenText size={18} aria-hidden="true" />
        훈독하기
      </Link>
    </div>
  );
}

function ShareEditor({ detail }: { detail: GroupDetail }) {
  const router = useRouter();
  const put = usePutTodayShare(detail.id);
  const mine = detail.shares.find((share) => share.is_mine);
  const [body, setBody] = useState(mine?.body ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const backHref = groupHref(detail.id);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (put.isPending) return;
    const normalized = normalizeShareBody(body);
    if (!normalized) {
      setFormError("한 줄을 적어 주세요");
      return;
    }
    setFormError(null);
    put.mutate(normalized, { onSuccess: () => router.push(backHref) });
  };

  const { status, code } = groupErrorOf(put.error);
  if (put.isError && code === "READ_REQUIRED") return <ReadFirst />;
  if (put.isError && status === 404) return <GroupUnavailable />;
  const error =
    formError ??
    (put.isError
      ? status === 422
        ? `한 줄은 1~${SHARE_MAX}자로 적어 주세요`
        : status === 429
          ? "잠시 뒤 다시 시도해 주세요"
          : "남기지 못했어요. 잠시 뒤 다시 시도해 주세요"
      : null);

  return (
    <form onSubmit={submit} noValidate>
      {detail.today_reading && (
        <div className="field">
          <span className="field__label">오늘 읽은 말씀</span>
          <div className="card">
            <div className="src">
              <span>{detail.today_reading.speaker}</span>
              <span className="src__dot" />
              <span>{detail.today_reading.work_title}</span>
            </div>
            <p className="tg-range__t">{detail.today_reading.title}</p>
          </div>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor="gs-text">
          {detail.name}에 남길 한 줄
        </label>
        <textarea
          id="gs-text"
          value={body}
          maxLength={SHARE_MAX}
          rows={3}
          placeholder="오늘 마음에 머문 구절이나 떠오른 사람을 적어 주세요"
          aria-describedby="gs-count gs-help"
          onChange={(event) => setBody(event.target.value)}
        />
        <span className="tg-count" id="gs-count" aria-live="polite">
          {body.length} / {SHARE_MAX}
        </span>
        <span className="field__help" id="gs-help">
          모임에만 보여요. 내가 언제든 지울 수 있어요.
        </span>
      </div>

      <div className="field">
        <span className="field__label">이렇게 시작해 볼 수 있어요</span>
        <div className="tg-exs">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              className="tg-ex"
              type="button"
              onClick={() => {
                // 비어 있거나 다른 시작 문장만 있으면 바꾸고, 쓰던 글이 있으면 지우지 않고 뒤에 잇는다
                const current = body.trim();
                const isBlank = !current || STARTERS.some((item) => item.trim() === current);
                setBody(isBlank ? starter : `${body.trimEnd()} ${starter}`.slice(0, SHARE_MAX));
                document.getElementById("gs-text")?.focus();
              }}
            >
              {starter}
            </button>
          ))}
        </div>
      </div>

      {error && <GroupAlert>{error}</GroupAlert>}

      <div className="tg-cta">
        <HoondokButton type="submit" isLoading={put.isPending}>
          {mine ? "한 줄 고치기" : "한 줄 남기기"}
        </HoondokButton>
        <Link className="btn btn-ghost" href={backHref}>
          남기지 않고 돌아가기
        </Link>
      </div>
    </form>
  );
}

export function GroupShareForm({ groupId }: { groupId: string }) {
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const group = useGroup(user ? groupId : undefined);

  if (isUserLoading) return <GroupLoading />;
  if (!user)
    return (
      <section className="col tg-form tg-page">
        <GroupLoginRequired
          returnTo={`${groupHref(groupId)}/share`}
          title="로그인하면 한 줄을 남길 수 있어요"
          body="모임 식구에게만 보이는 한 줄 나눔이에요."
        />
      </section>
    );

  let content: ReactNode;
  if (group.isError && isGroupGone(group.error)) content = <GroupUnavailable />;
  else if (group.isPending) content = <GroupLoading />;
  else if (group.isError && !group.data) content = <GroupLoadFailed onRetry={() => void group.refetch()} />;
  else if (!group.data.me.has_read_today) content = <ReadFirst />;
  else content = <ShareEditor detail={group.data} />;

  return (
    <section className="col tg-form tg-page">
      <p className="tg-lede">훈독회의 &lsquo;대화&rsquo;처럼, 오늘 말씀에서 머문 마음을 한 줄로 나눠요.</p>
      {content}
      <p className="notice">한 줄에는 댓글을 달 수 없고, 반응은 &ldquo;함께 머물렀어요&rdquo; 한 가지예요</p>
    </section>
  );
}
