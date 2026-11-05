"use client";

// /path — 7일 정성 시작 흐름: (로그인 안내 | 이미 정성 중) → 질문 1 하루 분량 → 질문 2 읽을 때 → 정성 고르기 → 시작.
// 로그인은 질문을 다 받은 뒤가 아니라 첫 화면에서 묻는다(결정 5). 단계는 이 화면의 상태이고 주소에 싣지 않는다.
// 단계가 바뀌면 맨 위로 올리고 새 제목(h2)으로 포커스를 옮긴다(전환 애니메이션 없음). 부엉이는 질문 1 한 곳뿐이다.
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { ChoiceRadioGroup } from "@/features/hoondok/personal/components/choice-row";
import { useAbandonJeongseong, useJeongseongCurrent } from "@/features/hoondok/use-jeongseong";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import type { MinutesTier, PreferredSlot, ReadingPathSummary } from "../api";
import { minutesLabel, slotLabel } from "../format";
import { isUnauthorizedError, pathErrorCode, usePathRun, usePaths, useStartPathRun } from "../use-path-run";
import { PathSheet } from "./path-sheet";
import { PathProgress, PathTop } from "./path-top";

type Step = "gate" | "conflict" | "minutes" | "slot" | "choose";

const DOCUMENT_TITLES: Record<Step, string> = {
  gate: "정성 시작하기",
  conflict: "이미 드리는 정성",
  minutes: "질문 1 / 3",
  slot: "질문 2 / 3",
  choose: "정성 고르기",
};

const MINUTES_OPTIONS = [
  { id: "3", label: "약 3분", description: "짧은 한 단락" },
  { id: "7", label: "약 7분", description: "한 장 남짓, 처음 시작할 때 알맞아요" },
  { id: "15", label: "약 15분", description: "두세 장" },
] as const;

const SLOT_OPTIONS = [
  { id: "dawn", label: "새벽 기도 뒤", description: "새벽 기도를 마친 뒤" },
  { id: "morning", label: "아침", description: "하루를 시작할 때" },
  { id: "evening", label: "저녁", description: "하루를 마무리할 때" },
] as const;

const PATH_HREF = "/path";

function toTier(id: string): MinutesTier {
  return id === "3" ? 3 : id === "15" ? 15 : 7;
}

function Title({
  titleRef,
  id,
  children,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2 className="onb-title" id={id} tabIndex={-1} ref={titleRef}>
      {children}
    </h2>
  );
}

function Bar({ count, isWarn, children }: { count: string; isWarn?: boolean; children: ReactNode }) {
  return (
    <div className="onb-bar">
      <div className="onb-bar__info">
        <span className="onb-bar__count" aria-live="polite" data-warn={isWarn || undefined}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function FlowSkeleton() {
  return (
    <div className="path-skel" aria-busy="true">
      <span className="wd-skel wd-skel--head" aria-hidden="true" />
      <span className="wd-skel path-skel__choice" aria-hidden="true" />
      <span className="wd-skel path-skel__choice" aria-hidden="true" />
      <span className="wd-skel path-skel__choice" aria-hidden="true" />
    </div>
  );
}

function tierMinutes(path: ReadingPathSummary, tier: MinutesTier): number | null {
  return path.tiers.find((t) => t.minutes_tier === tier)?.estimated_minutes ?? null;
}

function pathDescription(path: ReadingPathSummary, tier: MinutesTier): string {
  const minutes = tierMinutes(path, tier);
  const amount = minutes === null ? null : `하루 ${minutesLabel(minutes)}`;
  return [path.when_line, amount].filter(Boolean).join(" · ");
}

export function PathStartFlow() {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const jeongseong = useJeongseongCurrent(Boolean(user));
  const runState = usePathRun();
  // 이미 정성이 있으면 질문을 받지 않는다 — 진행 중이면 홈(정성 홈), 마침표 전이면 마침표로
  const redirect =
    runState.status === "ready" && runState.run.status !== "abandoned"
      ? runState.run.status === "completed"
        ? "/path/done"
        : "/"
      : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  // 진입 판정은 처음 한 번만 — 계정 → 진행 중 정성 기간 → 질문 1. 판정 뒤에는 Flow 가 자기 단계를 가진다
  if (isUserLoading) return <FlowLoading />;
  if (!user) return <Flow initialStep="gate" />;
  if (jeongseong.isPending || runState.status === "loading" || redirect) return <FlowLoading />;
  return <Flow initialStep={jeongseong.data?.period ? "conflict" : "minutes"} />;
}

function FlowLoading() {
  return (
    <section className="col col--read path path-flow">
      <PathTop left={{ label: "닫기", href: "/" }} />
      <FlowSkeleton />
    </section>
  );
}

function Flow({ initialStep }: { initialStep: Step }) {
  const router = useRouter();
  const { user } = useCurrentUser();
  const jeongseong = useJeongseongCurrent(Boolean(user));
  const [step, setStep] = useState<Step>(initialStep);
  const [tier, setTier] = useState<MinutesTier>(7);
  const [slot, setSlot] = useState<PreferredSlot | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [startWarn, setStartWarn] = useState<string | null>(null);
  const [hasChosen, setHasChosen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hasMoved = useRef(false);
  const titleId = useId();
  const paths = usePaths(Boolean(user));
  const start = useStartPathRun();
  const abandonJeongseong = useAbandonJeongseong();

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = `${DOCUMENT_TITLES[step]} · 훈독`;
    if (!hasMoved.current) return;
    window.scrollTo(0, 0);
    titleRef.current?.focus();
  }, [step]);

  // 목록이 오면 첫 정성을 기본으로 고른다
  const list = paths.data?.paths ?? [];
  const selected = list.find((p) => p.slug === slug) ?? list[0] ?? null;

  function go(next: Step) {
    hasMoved.current = true;
    setStep(next);
  }

  function begin(target: ReadingPathSummary) {
    setStartWarn(null);
    setHasChosen(true);
    start.mutate(
      { slug: target.slug, minutes_tier: tier, preferred_slot: slot },
      {
        onSuccess: () => router.replace("/"),
        onError: (error) => {
          if (isUnauthorizedError(error)) {
            window.location.assign(onboardingHref(PATH_HREF));
            return;
          }
          const code = pathErrorCode(error);
          if (code === "PATH_RUN_ACTIVE") router.replace("/");
          else if (code === "JEONGSEONG_ACTIVE") go("conflict");
          else if (code === "RIGHTS_CLOSED") setStartWarn("이 정성은 지금 시작할 수 없어요. 다른 정성을 골라 주세요.");
          else setStartWarn("시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
        },
      },
    );
  }

  function endJeongseong() {
    abandonJeongseong.mutate(undefined, {
      onSuccess: () => {
        setIsConfirming(false);
        // 고르기에서 409 로 온 경우는 고른 값이 다 있으니 바로 시작한다
        if (hasChosen && selected) begin(selected);
        else go("minutes");
      },
    });
  }

  if (step === "gate")
    return (
      <section className="col col--read path path-flow">
        <PathTop left={{ label: "닫기", href: "/" }} />
        <div className="onb__intro">
          <Title titleRef={titleRef}>정성을 시작하려면 로그인해 주세요</Title>
          <p className="onb-lede">읽은 장과 고른 구절을 내 계정에만 남겨요. 다른 사람에게 보이지 않아요.</p>
        </div>
        <div className="path-cta">
          <Link className="btn btn-primary" href={onboardingHref(PATH_HREF)}>
            로그인하고 시작하기
          </Link>
          <Link className="btn btn-ghost" href="/">
            나중에
          </Link>
        </div>
      </section>
    );

  if (step === "conflict") {
    const period = jeongseong.data?.period ?? null;
    return (
      <section className="col col--read path path-flow">
        <PathTop left={{ label: "닫기", href: "/" }} />
        <div className="onb__intro">
          <Title titleRef={titleRef}>이미 드리고 있는 정성이 있어요</Title>
          {period && <p className="onb-lede">{`${period.duration_days}일 정성 · ${period.topic}`}</p>}
          <p className="path-flow__p">정성은 한 번에 하나만 드릴 수 있어요.</p>
        </div>
        <div className="path-cta">
          <Link className="btn btn-primary" href="/">
            지금 정성 이어 드리기
          </Link>
          <button type="button" className="btn btn-line" onClick={() => setIsConfirming(true)}>
            지금 정성을 마치고 새로 시작
          </button>
        </div>
        {isConfirming && (
          <PathSheet title="지금 정성을 마칠까요?" onClose={() => setIsConfirming(false)}>
            <p className="path-return__body">그동안 읽은 기록은 지우지 않아요. 마치면 새 정성을 고를 수 있어요.</p>
            {abandonJeongseong.isError && (
              <p className="hint hint--alert" role="alert">
                정성을 마치지 못했어요. 다시 시도해 주세요.
              </p>
            )}
            <div className="path-return__cta">
              <HoondokButton isLoading={abandonJeongseong.isPending || start.isPending} onClick={endJeongseong}>
                마치고 새로 시작
              </HoondokButton>
              <button type="button" className="btn btn-ghost" onClick={() => setIsConfirming(false)}>
                돌아가기
              </button>
            </div>
          </PathSheet>
        )}
      </section>
    );
  }

  if (step === "minutes")
    return (
      <section className="col col--read path path-flow">
        <PathTop left={{ label: "닫기", href: "/" }} center={<PathProgress index={1} total={3} />} />
        <div className="onb__intro">
          <HoondokMascot pose="welcome" size={72} />
          <Title titleRef={titleRef} id={titleId}>
            하루에 얼마나 읽을까요?
          </Title>
          <p className="onb-lede">분량과 때를 정하고 정성을 고르시면 돼요.</p>
        </div>
        <ChoiceRadioGroup
          className="onb-choices"
          labelledBy={titleId}
          options={MINUTES_OPTIONS}
          value={String(tier)}
          onChange={(id) => {
            if (id) setTier(toTier(id));
          }}
        />
        <div className="onb__spacer" />
        <Bar count={minutesLabel(tier)}>
          <button type="button" className="btn btn-primary" onClick={() => go("slot")}>
            다음
          </button>
        </Bar>
      </section>
    );

  if (step === "slot")
    return (
      <section className="col col--read path path-flow">
        <PathTop left={{ label: "이전", onClick: () => go("minutes") }} center={<PathProgress index={2} total={3} />} />
        <div className="onb__intro">
          <Title titleRef={titleRef} id={titleId}>
            언제 읽으시겠어요?
          </Title>
          <p className="onb-lede">고르신 때는 오늘 훈독 카드에 적어 둘게요.</p>
        </div>
        <ChoiceRadioGroup
          className="onb-choices"
          labelledBy={titleId}
          options={SLOT_OPTIONS}
          value={slot}
          onChange={(id) => setSlot(id === "dawn" || id === "morning" || id === "evening" ? id : null)}
        />
        <div className="onb__spacer" />
        <Bar count={slot ? slotLabel(slot) : "고르지 않아도 돼요"}>
          <button type="button" className="btn btn-primary" onClick={() => go("choose")}>
            다음
          </button>
        </Bar>
      </section>
    );

  // choose
  return (
    <section className="col col--read path path-flow">
      <PathTop left={{ label: "이전", onClick: () => go("slot") }} center={<PathProgress index={3} total={3} />} />
      <div className="onb__intro">
        <Title titleRef={titleRef} id={titleId}>
          어떤 정성을 드릴까요?
        </Title>
        <p className="onb-lede">편한 날에 하루 한 장씩 읽으시면 돼요.</p>
      </div>
      {paths.isPending ? (
        <FlowSkeleton />
      ) : paths.isError ? (
        <div className="path-alert" role="alert">
          <WarningCircleIcon size={20} aria-hidden="true" />
          <span className="path-alert__tx">정성 목록을 불러오지 못했어요.</span>
          <button type="button" className="btn btn-line path-alert__retry" onClick={() => void paths.refetch()}>
            다시 시도
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <p className="empty__title path-empty__title">지금 시작할 수 있는 정성이 없어요</p>
          <div className="path-cta">
            <Link className="btn btn-line" href="/">
              오늘 훈독으로
            </Link>
          </div>
        </div>
      ) : (
        <ChoiceRadioGroup
          className="onb-choices"
          labelledBy={titleId}
          options={list.map((p) => ({ id: p.slug, label: p.title, description: pathDescription(p, tier) }))}
          value={selected?.slug ?? null}
          onChange={(id) => {
            if (id) {
              setSlug(id);
              setStartWarn(null);
            }
          }}
        />
      )}
      <div className="onb__spacer" />
      {selected && (
        <Bar count={startWarn ?? selected.title} isWarn={Boolean(startWarn)}>
          <HoondokButton isLoading={start.isPending} onClick={() => begin(selected)}>
            이 정성 시작
          </HoondokButton>
        </Bar>
      )}
    </section>
  );
}
