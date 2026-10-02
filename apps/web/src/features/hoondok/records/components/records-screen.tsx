"use client";

// 나의 기록 (C1, `/hoondok/records?tab=&color=&volume=`). 종류 탭 · 색 칩 · 권 칩으로 좁히고, 권을 고르면
// 목차(API-HD-024) 장 머리 아래에 원문 순서로 놓는다. URL 이 상태의 원본이라 원문을 보고 뒤로 오면 같은 칩이 골라져 있다.
import { useQuery } from "@tanstack/react-query";
import { Highlighter } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HoondokButton } from "@/components/hoondok";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI } from "../../library/api";
import { COLOR_NAME, HIGHLIGHT_COLORS } from "../../library/highlight-range";
import { sectionsKey } from "../../query-keys";
import {
  applyFilter,
  colorCounts,
  countRecords,
  formatCount,
  HIGHLIGHTS_LIMIT,
  marksOfTab,
  parseRecordsFilter,
  RECORD_TABS,
  RECORDS_PATH,
  type RecordEntry,
  type RecordSet,
  type RecordsFilter,
  type RecordTab,
  recordsHref,
  sectionGroups,
  volumeGroups,
} from "../records";
import { useRecords } from "../use-records";
import { RecordItem } from "./record-item";

const LIBRARY_HREF = "/hoondok/library";
const PRIVATE_NOTICE = "기록은 나만 봐요. 가족과 모임에도 보이지 않아요.";
const EMPTY_TITLE: Record<RecordTab, string> = {
  highlight: "아직 남긴 형광펜이 없어요",
  note: "아직 남긴 노트가 없어요",
};

/** 빈 상태는 문구와 서고 입구만 둔다 — 예시 말씀을 지어 넣지 않는다. 정원 섹션 안에서는 제목을 h3 로 낮춘다. */
export function RecordsEmpty({ title, isNested = false }: { title: string; isNested?: boolean }) {
  const Heading = isNested ? "h3" : "h2";
  return (
    <div className="empty gd-empty">
      <span className="empty__ic" aria-hidden="true">
        <Highlighter size={28} />
      </span>
      <Heading className="empty__title">{title}</Heading>
      <p className="empty__body">말씀 원문에서 구절을 고르면 형광펜·노트를 남길 수 있어요.</p>
      <p className="gd-cta">
        <Link className="btn btn-line btn--sm" href={LIBRARY_HREF}>
          말씀 서고로 가기
        </Link>
      </p>
    </div>
  );
}

export function RecordsError({ onRetry, isNested = false }: { onRetry: () => void; isNested?: boolean }) {
  const Heading = isNested ? "h3" : "h2";
  return (
    <div className="empty gd-empty" role="status">
      <Heading className="empty__title">기록을 불러오지 못했어요</Heading>
      <p className="empty__body">잠시 뒤 다시 시도해 주세요.</p>
      <p className="gd-cta">
        <HoondokButton variant="line" isSmall onClick={onRetry}>
          다시 시도
        </HoondokButton>
      </p>
    </div>
  );
}

function Loading() {
  return (
    <section className="col">
      <span className="skeleton gd-skeleton--row" role="status" aria-busy="true" aria-label="기록을 불러오는 중" />
    </section>
  );
}

function ColorChips({
  items,
  filter,
  isCapped,
  onPick,
}: {
  items: readonly RecordEntry[];
  filter: RecordsFilter;
  isCapped: boolean;
  onPick: (next: Partial<RecordsFilter>) => void;
}) {
  const counts = colorCounts(applyFilter(items, filter, "color"));
  return (
    <div className="chips rc-chips" role="group" aria-label="형광펜 색">
      <button
        className="chip-btn rc-chip"
        type="button"
        aria-pressed={filter.color === null}
        onClick={() => onPick({ color: null })}
      >
        전체
      </button>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          className="chip-btn rc-chip"
          type="button"
          aria-pressed={filter.color === color}
          onClick={() => onPick({ color: filter.color === color ? null : color })}
        >
          <span className={`rc-sw rc-sw--${color}`} aria-hidden="true" />
          {COLOR_NAME[color]} <small>{formatCount(counts[color], isCapped)}</small>
        </button>
      ))}
    </div>
  );
}

function VolumeChips({
  items,
  filter,
  isCapped,
  onPick,
}: {
  items: readonly RecordEntry[];
  isCapped: boolean;
  filter: RecordsFilter;
  onPick: (next: Partial<RecordsFilter>) => void;
}) {
  const groups = volumeGroups(applyFilter(items, filter, "volume"));
  // 고른 권이 이 탭에 없어도 칩은 남긴다 — 무엇이 골라져 있는지 보여야 풀 수 있다.
  if (filter.volume && !groups.some((group) => group.volume === filter.volume)) {
    const known = volumeGroups(items).find((group) => group.volume === filter.volume);
    groups.push({ volume: filter.volume, title: known?.title ?? filter.volume, count: 0 });
  }
  if (groups.length === 0) return null;
  return (
    <div className="chips rc-chips" role="group" aria-label="권">
      <button
        className="chip-btn rc-chip"
        type="button"
        aria-pressed={filter.volume === null}
        onClick={() => onPick({ volume: null })}
      >
        모든 권
      </button>
      {groups.map((group) => (
        <button
          key={group.volume}
          className="chip-btn rc-chip"
          type="button"
          aria-pressed={filter.volume === group.volume}
          onClick={() => onPick({ volume: filter.volume === group.volume ? null : group.volume })}
        >
          {group.title} <small>{formatCount(group.count, isCapped)}</small>
        </button>
      ))}
    </div>
  );
}

/** 한 권: 장 머리 아래 원문 순서. 목차가 없거나(0건·404) 못 읽으면 머리 없이 원문 순서만 둔다. */
function VolumeList({ volume, items }: { volume: string; items: RecordEntry[] }) {
  const sections = useQuery({
    queryKey: sectionsKey(volume),
    queryFn: ({ signal }) => libraryAPI.sections(volume, signal),
    retry: false,
    staleTime: 0,
  });
  if (sections.isPending)
    return (
      <span className="skeleton gd-skeleton--row" role="status" aria-busy="true" aria-label="목차를 불러오는 중" />
    );
  const groups = sectionGroups(items, sections.data?.sections ?? []);
  return (
    <div className="card rc-listcard">
      {groups.map((group, index) => (
        <div key={group.section?.position ?? `none-${index}`} className="rc-chap">
          {group.section && <h3 className="rc-chap__t">{group.section.title}</h3>}
          <ul className="rc-list">
            {group.items.map((entry) => (
              <RecordItem key={entry.key} entry={entry} showVolume={false} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RecordsBody({ records }: { records: RecordSet }) {
  const router = useRouter();
  const filter = parseRecordsFilter(useSearchParams());
  const pick = (next: Partial<RecordsFilter>) => router.replace(recordsHref({ ...filter, ...next }), { scroll: false });
  const { items, capped } = records;
  const counts = countRecords(items);
  const tabItems = marksOfTab(items, filter.tab);
  const shown = applyFilter(items, filter);
  const volumeName = filter.volume ? volumeGroups(items).find((group) => group.volume === filter.volume)?.title : null;

  return (
    <section className="col">
      <div className="pill-seg" role="tablist" aria-label="기록 종류">
        {RECORD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`rc-tab-${tab.id}`}
            aria-selected={filter.tab === tab.id}
            aria-controls="rc-panel"
            className={filter.tab === tab.id ? "is-on" : undefined}
            onClick={() => pick({ tab: tab.id })}
          >
            {tab.label} <span className="rc-n">{formatCount(counts[tab.id], capped[tab.id])}</span>
          </button>
        ))}
      </div>
      <div id="rc-panel" role="tabpanel" aria-labelledby={`rc-tab-${filter.tab}`}>
        {tabItems.length === 0 ? (
          <div className="card rc-empty">
            <RecordsEmpty title={EMPTY_TITLE[filter.tab]} />
          </div>
        ) : (
          <>
            <ColorChips items={items} filter={filter} isCapped={capped[filter.tab]} onPick={pick} />
            <VolumeChips items={items} filter={filter} isCapped={capped[filter.tab]} onPick={pick} />
            <div className="sect">
              <div className="sect__head">
                <h2 className="sect__title">{filter.volume ? (volumeName ?? filter.volume) : "최근 남긴 순"}</h2>
                {filter.volume && <span className="sect__meta">원문 순서</span>}
              </div>
              {shown.length === 0 ? (
                <p className="rc-none">고른 조건에 맞는 기록이 없어요.</p>
              ) : filter.volume ? (
                <VolumeList volume={filter.volume} items={shown} />
              ) : (
                <div className="card rc-listcard">
                  <ul className="rc-list">
                    {shown.map((entry) => (
                      <RecordItem key={entry.key} entry={entry} showVolume />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {capped[filter.tab] && <p className="notice">최근 형광펜 {HIGHLIGHTS_LIMIT}개까지 모아 보여요.</p>}
      <p className="notice">{PRIVATE_NOTICE}</p>
    </section>
  );
}

export function RecordsScreen() {
  const { user, isLoading } = useCurrentUser();
  const records = useRecords(Boolean(user));

  if (isLoading) return <Loading />;

  if (!user)
    return (
      <section className="col">
        <div className="card">
          <div className="empty">
            <span className="empty__ic" aria-hidden="true">
              <Highlighter size={28} />
            </span>
            <h2 className="empty__title">로그인하면 형광펜·노트가 여기에 모여요</h2>
            <p className="empty__body">원문에서 남긴 기록을 책별로, 원문 순서대로 다시 볼 수 있어요.</p>
            <p className="gd-cta">
              <Link className="btn btn-primary" href={onboardingHref(RECORDS_PATH)}>
                시작하기
              </Link>
            </p>
          </div>
        </div>
      </section>
    );

  if (records.isError)
    return (
      <section className="col">
        <div className="card">
          <RecordsError onRetry={records.refetch} />
        </div>
      </section>
    );

  if (!records.data) return <Loading />;

  if (records.data.items.length === 0)
    return (
      <section className="col">
        <div className="card">
          <RecordsEmpty title="아직 남긴 기록이 없어요" />
        </div>
        <p className="notice">{PRIVATE_NOTICE}</p>
      </section>
    );

  return <RecordsBody records={records.data} />;
}
