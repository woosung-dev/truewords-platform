"use client";

// /path/done — 7일 정성 마침표. 읽은 범위 · 읽은 장/읽은 날 · 고른 구절 · 남긴 한 줄 → 다음 정성 / 다시 / 오늘 훈독으로.
// 숫자는 서버 값만 쓴다(퍼센트·배지·평가 문장 없음). 부엉이는 heart 96 한 번(결정 4), 플래그 OFF 면 제목이 위로 붙는다.
// 고른 구절은 run 기간·장 범위로 형광펜을 모은다(계획 §6-6 1a 방식) — 같은 범위를 run 밖에서 고른 것도 섞일 수 있다.
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { useQueries } from "@tanstack/react-query";
import type { HighlightItem } from "@truewords/api-client-ts/types";
import { useRouter } from "next/navigation";
import { useEffect, useId } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { libraryAPI } from "@/features/hoondok/library/api";
import { highlightsKey } from "@/features/hoondok/query-keys";
import type { PathRunFinishRequest, PathRunView, ReadingPathSummary } from "../api";
import { kstDateOf, monthDayLabel, withEul } from "../format";
import { usePathRun, usePaths, useFinishPathRun } from "../use-path-run";
import { PathTop } from "./path-top";

/** run 장 범위 안, run 시작일 이후에 남긴 형광펜 인용(본문 순서). */
export function pickQuotes(run: PathRunView, items: readonly HighlightItem[]): string[] {
  const seen = new Set<string>();
  const quotes: string[] = [];
  const sorted = [...items].sort(
    (a, b) => a.volume.localeCompare(b.volume) || a.start_chunk_index - b.start_chunk_index,
  );
  for (const item of sorted) {
    if (kstDateOf(item.created_at) < run.started_on) continue;
    const isInside = run.steps.some(
      (s) =>
        s.volume === item.volume &&
        item.start_chunk_index >= s.start_chunk_index &&
        item.start_chunk_index <= s.end_chunk_index,
    );
    if (!isInside || seen.has(item.id)) continue;
    seen.add(item.id);
    quotes.push(item.quote);
  }
  return quotes;
}

/** [가정] 다음 정성 제안 = 같은 책의 더 긴 정성 중 목록 첫 번째. 없으면 제안하지 않는다. */
export function nextPathFor(run: PathRunView, paths: readonly ReadingPathSummary[]): ReadingPathSummary | null {
  return paths.find((p) => p.slug !== run.slug && p.book === run.book && p.duration_days > run.duration_days) ?? null;
}

function DoneSkeleton() {
  return (
    <div className="path-skel path-skel--done" aria-busy="true">
      <span className="wd-skel wd-skel--head" aria-hidden="true" />
      <span className="wd-skel wd-skel--meta" aria-hidden="true" />
      <span className="wd-skel path-skel__card" aria-hidden="true" />
      <span className="wd-skel path-skel__card" aria-hidden="true" />
    </div>
  );
}

function Done({ run }: { run: PathRunView }) {
  const router = useRouter();
  const picksId = useId();
  const notesId = useId();
  const finish = useFinishPathRun();
  const paths = usePaths(true);
  const volumes = [...new Set(run.steps.map((s) => s.volume))];
  const highlightQueries = useQueries({
    queries: volumes.map((volume) => ({
      queryKey: highlightsKey(volume),
      queryFn: () => libraryAPI.highlights({ volume }),
      retry: false,
    })),
  });
  const items = highlightQueries.flatMap((q) => q.data?.items ?? []);
  const isPicksLoading = highlightQueries.some((q) => q.isPending);
  const picks = pickQuotes(run, items);
  const notes = run.steps.map((s) => s.note).filter((n): n is string => Boolean(n));
  const done = run.steps.filter((s) => s.state === "done");
  const firstTitle = done[0]?.title ?? run.steps[0]?.title;
  const lastTitle = done.at(-1)?.title ?? run.steps.at(-1)?.title;
  const endOn = run.finished_at ? kstDateOf(run.finished_at) : run.today;
  const next = paths.data ? nextPathFor(run, paths.data.paths) : null;

  function act(body: PathRunFinishRequest) {
    finish.mutate(body, { onSuccess: () => router.replace("/") });
  }
  const pending = finish.isPending ? finish.variables?.action : undefined;

  return (
    <div className="path-done">
      <HoondokMascot pose="heart" size={96} />
      <h2 className="onb-title">{`${withEul(run.title)} 마쳤어요`}</h2>
      <p className="path-done__sub">{`${monthDayLabel(run.started_on)}부터 ${monthDayLabel(endOn)}까지`}</p>
      {firstTitle && lastTitle && <p className="path-done__range">{`${firstTitle}부터 ${lastTitle}까지`}</p>}
      <dl className="path-done__stats">
        <div>
          <dt>읽은 장</dt>
          <dd>{`${run.done_steps}장`}</dd>
        </div>
        <div>
          <dt>읽은 날</dt>
          <dd>{`${run.read_days}일`}</dd>
        </div>
      </dl>
      <section className="card path-done__box" aria-labelledby={picksId} aria-busy={isPicksLoading || undefined}>
        <h3 className="path-done__h" id={picksId}>
          내가 고른 구절
        </h3>
        {isPicksLoading ? (
          <span className="wd-skel wd-skel--verse path-done__quote" aria-hidden="true" />
        ) : picks.length > 0 ? (
          picks.map((quote) => (
            <blockquote className="scripture path-done__quote" key={quote}>
              {quote}
            </blockquote>
          ))
        ) : (
          <p className="path-done__empty">이번 정성에서 고른 구절은 없어요.</p>
        )}
      </section>
      {notes.length > 0 && (
        <section className="path-done__notes" aria-labelledby={notesId}>
          <h3 className="path-done__h" id={notesId}>
            남긴 한 줄
          </h3>
          {notes.map((note) => (
            <figure className="js-vow" key={note}>
              <figcaption>
                <LockIcon size={14} aria-hidden="true" />
                나만 봐요
              </figcaption>
              <blockquote>{note}</blockquote>
            </figure>
          ))}
        </section>
      )}
      {finish.isError && (
        <p className="hint hint--alert path-done__alert" role="alert">
          다음으로 넘어가지 못했어요. 다시 눌러 주세요.
        </p>
      )}
      <div className="path-cta">
        {next && (
          <HoondokButton
            isLoading={pending === "next"}
            disabled={finish.isPending}
            onClick={() => act({ action: "next", slug: next.slug })}
          >
            {`${next.title} 이어 드리기`}
          </HoondokButton>
        )}
        <HoondokButton
          variant={next ? "line" : "primary"}
          isLoading={pending === "repeat"}
          disabled={finish.isPending}
          onClick={() => act({ action: "repeat" })}
        >
          같은 정성 다시 드리기
        </HoondokButton>
        <HoondokButton
          variant="ghost"
          isLoading={pending === "rest"}
          disabled={finish.isPending}
          onClick={() => act({ action: "rest" })}
        >
          오늘 훈독으로
        </HoondokButton>
      </div>
    </div>
  );
}

export function PathDoneScreen() {
  const router = useRouter();
  const state = usePathRun();
  const run = state.status === "ready" && state.run.status === "completed" ? state.run : null;
  const isGone =
    state.status === "none" ||
    state.status === "off" ||
    state.status === "anonymous" ||
    (state.status === "ready" && !run);
  useEffect(() => {
    if (isGone) router.replace("/");
  }, [isGone, router]);

  return (
    <section className="col col--read path">
      <PathTop left={{ label: "닫기", href: "/" }} />
      {run ? (
        <Done run={run} />
      ) : state.status === "error" ? (
        <div className="path-alert" role="alert">
          <span className="path-alert__tx">정성 기록을 불러오지 못했어요.</span>
          <button type="button" className="btn btn-line path-alert__retry" onClick={state.retry}>
            다시 시도
          </button>
        </div>
      ) : (
        <DoneSkeleton />
      )}
    </section>
  );
}
