"use client";

// SCR-PWA-017 훈독 모임 상세 (PLAN-HD-010 §6, 프로토타입 group).
// 머리에 전체 인원을 두지 않는다 — 인원은 리더 설정의 식구 목록에만 있다(D2·D5).
// "오늘 함께 읽은 식구" 는 완료자만 그린다. 미완료자 이름·수·상태를 그릴 자리를 만들지 않는다(DEC-PWA-023).
// 한 줄 반응 수는 내 한 줄에만, 나에게만 보인다. 내보내졌거나 모임이 지워지면(404) 안내 화면으로 바뀐다.
import { BookOpenText, ChevronRight, HandHeart, Lock, Settings, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type GroupDetail, type GroupJeongseongOut, type GroupShareOut, groupErrorOf } from "../groups-api";
import { inviteLink, shareInvite } from "../invite-code";
import { useDeleteShare, useGroup, useToggleReaction } from "../use-groups";
import {
  formatKstDay,
  formatKstTime,
  formatMeetingTime,
  GroupAlert,
  GroupLoadFailed,
  GroupLoading,
  GroupLoginRequired,
  GroupNotice,
  GroupUnavailable,
  groupHref,
  InlineConfirm,
  initialOf,
  isGroupGone,
  READ_HREF,
} from "./group-common";

/** 정성 한 줄 머리 "12일차 / 총 21일". 시작 전이면 "{시작일} 시작". */
export function jeongseongDayText(item: GroupJeongseongOut): string {
  return item.day_index === null
    ? `${formatKstDay(item.started_on)} 시작`
    : `${item.day_index}일차 / 총 ${item.duration_days}일`;
}

function JeongseongRow({ item }: { item: GroupJeongseongOut }) {
  const day = item.day_index ?? 0;
  const percent = Math.min(100, Math.round((day / item.duration_days) * 100));
  return (
    <div className="tg-js">
      <div className="tg-js__top">
        <span>
          <b className="tg-js__t">{item.title}</b>
          <span className="tg-js__by">{item.is_official ? "공식 정성 · 협회 공지를 편성자가 등록" : "모임 정성"}</span>
        </span>
        <span className="tg-js__day">
          {item.day_index === null ? <b className="tg-js__soon">곧 시작</b> : <b>{item.day_index}일차</b>}
          {item.day_index === null ? formatKstDay(item.started_on) : `/ 총 ${item.duration_days}일`}
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label={`${item.title} ${jeongseongDayText(item)}`}
        aria-valuenow={day}
        aria-valuemin={0}
        aria-valuemax={item.duration_days}
      >
        <i className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="tg-js__ft">
        <span>{formatKstDay(item.started_on)}부터</span>
        {item.is_official ? (
          <span className="badge badge--accent">공식</span>
        ) : (
          <span className="badge badge--line">모임</span>
        )}
      </div>
    </div>
  );
}

function TodayRange({ reading }: { reading: GroupDetail["today_reading"] }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">오늘 범위</h3>
        <span className="sect__rule" />
        <span className="sect__meta">공식 편성</span>
      </div>
      {reading ? (
        <Link className="card tg-range" href={READ_HREF} aria-label={`오늘 범위, ${reading.title} 훈독하기로 열기`}>
          <div className="src">
            <span>{reading.speaker}</span>
            <span className="src__dot" />
            <span>{reading.work_title}</span>
          </div>
          <p className="tg-range__t">{reading.title}</p>
          <div className="tg-range__ft">
            <span>약 {reading.estimated_minutes}분</span>
            <span className="tg-link">
              훈독하기
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </div>
        </Link>
      ) : (
        <div className="card">
          <p className="tg-lede tg-lede--flush">오늘 편성된 말씀이 없어요. 편성되면 여기에 보여요.</p>
        </div>
      )}
    </div>
  );
}

/** "은정 (리더)" · "효진 (나)" */
function readerLabel(reader: GroupDetail["readers"][number]): string {
  const tags = [reader.is_leader && "리더", reader.is_me && "나"].filter(Boolean);
  return tags.length > 0 ? `${reader.display_name} (${tags.join(" · ")})` : reader.display_name;
}

function Readers({ readers }: { readers: GroupDetail["readers"] }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">오늘 함께 읽은 식구</h3>
        <span className="sect__rule" />
        {readers.length > 0 && <span className="sect__meta">가나다순</span>}
      </div>
      {readers.length > 0 ? (
        <ul className="card tg-people" aria-label="오늘 함께 읽은 식구">
          {readers.map((reader) => (
            <li className="tg-person" key={`${reader.display_name}-${reader.read_at_kst}`}>
              <span className={reader.is_me ? "tg-av tg-av--me" : "tg-av"} aria-hidden="true">
                {initialOf(reader.display_name)}
              </span>
              <span className="tg-person__bd">
                <b>{readerLabel(reader)}</b>
                <span>{formatKstTime(reader.read_at_kst)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card">
          <p className="tg-lede tg-lede--flush">오늘 첫 번째로 함께 읽어 보세요.</p>
        </div>
      )}
      <p className="tg-again">안 읽은 사람은 표시하지 않아요.</p>
    </div>
  );
}

type ShareItemProps = {
  share: GroupShareOut;
  groupId: string;
  isLeader: boolean;
  onGone: () => void;
};

function ShareItem({ share, groupId, isLeader, onGone }: ShareItemProps) {
  const toggle = useToggleReaction(groupId);
  const remove = useDeleteShare(groupId);
  const [error, setError] = useState<string | null>(null);

  const onError = (err: unknown) => {
    if (groupErrorOf(err).status === 404) {
      onGone();
      return;
    }
    setError("잠시 뒤 다시 시도해 주세요");
  };

  const canDelete = share.is_mine || isLeader;

  return (
    <li className="tg-note">
      <span className={share.is_mine ? "tg-av tg-av--me" : "tg-av"} aria-hidden="true">
        {initialOf(share.display_name)}
      </span>
      <div className="tg-note__bd">
        <div className="tg-note__who">
          <b>{share.is_mine ? `${share.display_name} (나)` : share.display_name}</b>
          {formatKstTime(share.created_at_kst)}
        </div>
        <p className="tg-note__tx">{share.body}</p>
        {share.is_mine ? (
          <span className="tg-stay__mine">
            <HandHeart size={16} aria-hidden="true" />
            {share.reaction_count ?? 0}명이 함께 머물렀어요 · 나에게만 보여요
          </span>
        ) : (
          <button
            className="tg-stay"
            type="button"
            aria-pressed={share.has_my_reaction}
            disabled={toggle.isPending}
            onClick={() => {
              setError(null);
              toggle.mutate({ shareId: share.id, isOn: !share.has_my_reaction }, { onError });
            }}
          >
            <HandHeart size={16} aria-hidden="true" />
            함께 머물렀어요
          </button>
        )}
        {canDelete && (
          <div className="tg-note__acts">
            {share.is_mine && (
              <Link className="tg-text-btn" href={`${groupHref(groupId)}/share`}>
                고치기
              </Link>
            )}
            <InlineConfirm
              openLabel="지우기"
              openClassName="tg-text-btn tg-danger"
              label={share.is_mine ? "내 한 줄 지우기 확인" : `${share.display_name} 님의 한 줄 지우기 확인`}
              message={
                share.is_mine
                  ? "오늘 남긴 한 줄을 지울까요? 받은 반응도 함께 지워져요."
                  : `${share.display_name} 님의 한 줄을 지울까요? 리더만 지울 수 있고, 되돌릴 수 없어요.`
              }
              confirmLabel="지우기"
              isPending={remove.isPending}
              onConfirm={() => {
                setError(null);
                remove.mutate(share.id, { onError });
              }}
            />
          </div>
        )}
        {error && <GroupAlert>{error}</GroupAlert>}
      </div>
    </li>
  );
}

function Shares({ detail, onGone }: { detail: GroupDetail; onGone: () => void }) {
  const href = `${groupHref(detail.id)}/share`;
  const isLeader = detail.me.role === "leader";
  return (
    <div className="sect">
      <div className="sect__head">
        <h3 className="sect__title">오늘의 한 줄</h3>
        <span className="sect__rule" />
        {detail.me.has_read_today && (
          <Link className="sect__meta tg-sect-link" href={href}>
            {detail.me.has_shared_today ? "내 한 줄 고치기" : "한 줄 남기기"}
          </Link>
        )}
      </div>
      {detail.shares.length > 0 ? (
        <ul className="card tg-notes" aria-label="오늘의 한 줄">
          {detail.shares.map((share) => (
            <ShareItem key={share.id} share={share} groupId={detail.id} isLeader={isLeader} onGone={onGone} />
          ))}
        </ul>
      ) : (
        <div className="card">
          <p className="tg-lede tg-lede--flush">오늘 남긴 한 줄이 없어요.</p>
        </div>
      )}
      {!detail.me.has_read_today && (
        <div className="card tg-read-first">
          <p className="tg-lede tg-lede--flush">오늘 훈독을 마치면 모임에 한 줄을 남길 수 있어요.</p>
          <Link className="btn btn-primary" href={READ_HREF}>
            <BookOpenText size={18} aria-hidden="true" />
            훈독하기
          </Link>
        </div>
      )}
    </div>
  );
}

function InviteButton({ detail }: { detail: GroupDetail }) {
  const [result, setResult] = useState<string | null>(null);
  if (!detail.invite_code) return null;
  const code = detail.invite_code;
  return (
    <>
      <HoondokButton
        isSmall
        onClick={async () => {
          const method = await shareInvite({ groupName: detail.name, link: inviteLink(code) });
          setResult(
            method === "clipboard"
              ? "공유를 지원하지 않아 링크를 복사했어요"
              : method === "none"
                ? "모임 설정에서 초대 코드를 확인해 주세요"
                : null,
          );
        }}
      >
        <Share2 size={16} aria-hidden="true" />
        초대하기
      </HoondokButton>
      {result && (
        <p className="tg-status" role="status">
          {result}
        </p>
      )}
    </>
  );
}

export function GroupDetailView({ groupId }: { groupId: string }) {
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const group = useGroup(user ? groupId : undefined);

  if (isUserLoading) return <GroupLoading />;
  if (!user)
    return (
      <section className="col tg-page">
        <GroupLoginRequired
          returnTo={groupHref(groupId)}
          title="로그인하면 모임을 볼 수 있어요"
          body="모임 식구만 오늘 읽은 사람과 한 줄 나눔을 볼 수 있어요."
        />
        <GroupNotice />
      </section>
    );

  // 새로고침·포커스 재조회에서 404 면 남아 있는 옛 데이터보다 안내가 먼저다(내보내짐·삭제).
  if (group.isError && isGroupGone(group.error))
    return (
      <section className="col tg-page">
        <GroupUnavailable />
      </section>
    );
  if (group.isPending) return <GroupLoading />;
  if (group.isError && !group.data)
    return (
      <section className="col tg-page">
        <GroupLoadFailed onRetry={() => void group.refetch()} />
      </section>
    );

  const detail = group.data;
  const onGone = () => void group.refetch();

  return (
    <section className="col tg-page">
      <div className="tg-head">
        <span className="badge badge--line">소그룹 · 훈독가정교회</span>
        <h2 className="tg-head__nm">{detail.name}</h2>
        <p className="tg-head__meta">
          리더 {detail.leader_display_name}
          {detail.meeting_time && ` · 매일 ${formatMeetingTime(detail.meeting_time)}`}
        </p>
        <div className="tg-acts">
          <InviteButton detail={detail} />
          <Link className="btn btn-line btn--sm" href={`${groupHref(detail.id)}/settings`}>
            <Settings size={16} aria-hidden="true" />
            모임 설정
          </Link>
        </div>
      </div>

      <TodayRange reading={detail.today_reading} />

      {detail.jeongseongs.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h3 className="sect__title">함께 드리는 정성</h3>
            <span className="sect__rule" />
          </div>
          <div className="card">
            {detail.jeongseongs.map((item) => (
              <JeongseongRow key={item.id} item={item} />
            ))}
            <p className="tg-again">하루 쉬어도 정성은 이어져요. 오늘부터 다시 함께 읽어요.</p>
          </div>
        </div>
      )}

      <Readers readers={detail.readers} />

      <Shares detail={detail} onGone={onGone} />

      <p className="tg-privacy">
        <Lock size={16} aria-hidden="true" />
        <span>모임 안에서만 보여요. 안 읽은 사람은 표시하지 않아요. 순위도 점수도 없습니다.</span>
      </p>
      <GroupNotice />
    </section>
  );
}
