"use client";

// 모임 화면(SCR-PWA-017~021, PLAN-HD-010 W1) 공용 조각 — 로그인 안내·볼 수 없는 모임·시각 표기·인라인 확인·초대 공유.
// 문구 원칙: 미완료자 이름·상태·재촉을 그리지 않는다(DEC-PWA-023). "새벽"·"아직" 을 쓰지 않는다(D7).
import { AlertCircle, Copy, Share2, Users } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { onboardingHref } from "@/features/identity/gate";
import { groupErrorOf } from "../groups-api";
import { formatInviteCode, inviteLink, type ShareMethod, shareInvite } from "../invite-code";

export const GROUP_BETA_NOTICE = "독립 운영 베타 · 가정연합 공식 앱이 아닙니다";
export const HOME_HREF = "/hoondok";
export const READ_HREF = "/hoondok/read";

export const groupHref = (groupId: string) => `/hoondok/groups/${encodeURIComponent(groupId)}`;

// ---------- 표기 ----------

/** 이름 첫 글자(아바타). 이모지·결합 문자도 한 글자로 센다. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? "";
}

/** 서버 시각 문자열 → Date. 오프셋이 없으면 naive UTC(서버 규칙)로 읽는다. */
function toDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

/** 0~23시 → "오전 5:55" · "오후 12:05". ICU 빌드마다 ko-KR 오전/오후 표기가 달라(AM 으로 나오기도 한다) 직접 만든다. */
function koreanClock(hour: number, minute: number, isMinuteOptional = false): string {
  const half = hour < 12 ? "오전" : "오후";
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  if (isMinuteOptional && minute === 0) return `${half} ${clock}시`;
  return `${half} ${clock}:${String(minute).padStart(2, "0")}`;
}

/** "오전 5:55" — KST 로 고정한다(기기 시간대와 무관). */
export function formatKstTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return koreanClock(get("hour") % 24, get("minute"));
}

/** "9월 12일" — KST. `YYYY-MM-DD` 날짜만 오면 그 날짜 그대로. */
export function formatKstDay(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+09:00`) : toDate(value);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(date);
}

/** 모임 시간 `HH:MM[:SS]` → "오전 6시" · "오후 8:30". 표시용이다. */
export function formatMeetingTime(value: string): string {
  const [hourText = "0", minuteText = "0"] = value.split(":");
  return koreanClock(Number(hourText), Number(minuteText), true);
}

/** 404(없음·비모임원·내보내짐·삭제)와 403 은 같은 "볼 수 없는 모임" 이다 — 서버도 존재를 알리지 않는다. */
export function isGroupGone(error: unknown): boolean {
  const { status } = groupErrorOf(error);
  return status === 404 || status === 403;
}

// ---------- 상태 화면 ----------

export function GroupNotice() {
  return <p className="notice">{GROUP_BETA_NOTICE}</p>;
}

export function GroupLoading({ label = "모임을 불러오는 중" }: { label?: string }) {
  return (
    <div className="tg-loading" role="status" aria-busy="true" aria-label={label}>
      <span className="skeleton tg-skeleton" />
      <span className="skeleton tg-skeleton--tall" />
    </div>
  );
}

/** 모임 화면은 모두 로그인 뒤에 쓴다. returnTo 에 쿼리까지 넣어 초대 코드가 온보딩을 지나도 남게 한다. */
export function GroupLoginRequired({ returnTo, title, body }: { returnTo: string; title: string; body: string }) {
  return (
    <div className="card">
      <div className="empty">
        <span className="empty__ic" aria-hidden="true">
          <Users size={28} />
        </span>
        <h2 className="empty__title">{title}</h2>
        <p className="empty__body">{body}</p>
        <p className="tg-empty-cta">
          <Link className="btn btn-primary" href={onboardingHref(returnTo)}>
            가입하거나 로그인하기
          </Link>
        </p>
      </div>
    </div>
  );
}

/** 내보내졌거나 모임이 지워진 뒤 새로고침한 화면. 오류로 보이지 않게 안내만 한다. */
export function GroupUnavailable() {
  return (
    <div className="card" role="status">
      <div className="empty">
        <span className="empty__ic" aria-hidden="true">
          <Users size={28} />
        </span>
        <h2 className="empty__title">이 모임을 볼 수 없어요</h2>
        <p className="empty__body">모임에서 나갔거나 모임이 삭제되었을 수 있어요.</p>
        <p className="tg-empty-cta">
          <Link className="btn btn-line" href={HOME_HREF}>
            홈으로
          </Link>
        </p>
      </div>
    </div>
  );
}

export function GroupLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card">
      <div className="empty" role="status">
        <h2 className="empty__title">모임을 불러오지 못했어요</h2>
        <p className="empty__body">잠시 뒤 다시 시도해 주세요.</p>
        <p className="tg-empty-cta">
          <HoondokButton variant="line" isSmall onClick={onRetry}>
            다시 시도
          </HoondokButton>
        </p>
      </div>
    </div>
  );
}

/** 오류 안내 — 색만으로 알리지 않는다(아이콘 + 문장, DES §3.3). */
export function GroupAlert({ children }: { children: ReactNode }) {
  return (
    <p className="hint hint--alert" role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// ---------- 되돌릴 수 없는 동작 : 인라인 확인 카드 (프로토타입 data-confirm / tg-confirm) ----------

export type InlineConfirmProps = {
  /** 여는 버튼 글자 */
  openLabel: string;
  /** 여는 버튼 접근 이름 — 같은 글자 버튼이 여러 개일 때 대상을 붙인다 (예: "미카 내보내기") */
  openAriaLabel?: string;
  /** 확인 카드 aria-label (예: "미카 님 내보내기 확인") */
  label: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  openClassName?: string;
  openIcon?: ReactNode;
};

/** 누르면 바로 아래 확인 카드가 열리고 초점은 취소로 간다. 취소하면 원래 버튼으로 돌아간다. */
export function InlineConfirm({
  openLabel,
  openAriaLabel,
  label,
  message,
  confirmLabel,
  onConfirm,
  isPending,
  openClassName = "btn btn-line btn--sm tg-danger",
  openIcon,
}: InlineConfirmProps) {
  const [isOpen, setIsOpen] = useState(false);
  const boxId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) cancelRef.current?.focus();
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    openerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={openClassName}
        aria-label={openAriaLabel}
        aria-expanded={isOpen}
        aria-controls={boxId}
        onClick={() => setIsOpen((value) => !value)}
      >
        {openIcon}
        {openLabel}
      </button>
      <div className="tg-confirm" id={boxId} role="group" aria-label={label} hidden={!isOpen}>
        <p>{message}</p>
        <div className="tg-confirm__cta">
          <button ref={cancelRef} type="button" className="btn btn-ghost btn--sm" onClick={close} disabled={isPending}>
            취소
          </button>
          <HoondokButton isSmall isLoading={isPending} onClick={onConfirm}>
            {confirmLabel}
          </HoondokButton>
        </div>
      </div>
    </>
  );
}

// ---------- 초대 공유 : navigator.share → 클립보드 → 코드 직접 ----------

const SHARE_RESULT: Record<ShareMethod, string | null> = {
  share: "공유 창을 열었어요",
  clipboard: "공유를 지원하지 않아 링크를 복사했어요",
  cancelled: null,
  none: "공유·복사를 할 수 없어요. 위 코드를 직접 알려 주세요",
};

/** 초대 코드 + "초대 링크 보내기"(공유 시트, 없으면 클립보드) + "링크 복사". 어느 쪽으로 됐는지 알려 준다. */
export function GroupInviteShare({ groupName, code }: { groupName: string; code: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const formatted = formatInviteCode(code);

  const share = async () => {
    setIsBusy(true);
    try {
      setResult(SHARE_RESULT[await shareInvite({ groupName, link: inviteLink(code) })]);
    } finally {
      setIsBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${groupName}\n${inviteLink(code)}`);
      setResult("링크를 복사했어요");
    } catch {
      setResult(SHARE_RESULT.none);
    }
  };

  return (
    <>
      <p className="tg-code" aria-label={`초대 코드 ${formatted}`}>
        {formatted}
      </p>
      <div className="tg-join">
        <HoondokButton isSmall onClick={share} disabled={isBusy}>
          <Share2 size={16} aria-hidden="true" />
          초대 링크 보내기
        </HoondokButton>
        <HoondokButton variant="line" isSmall onClick={copy}>
          <Copy size={16} aria-hidden="true" />
          링크 복사
        </HoondokButton>
      </div>
      <p className="tg-status" role="status" aria-live="polite">
        {result}
      </p>
    </>
  );
}
