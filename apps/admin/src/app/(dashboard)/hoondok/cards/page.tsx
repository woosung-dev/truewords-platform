"use client";

import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CARD_STATUS_LABEL,
  type CardAdminItem,
  type CardStatus,
  cardMutationErrorMessage,
  cardSourceUrl,
  cardsAPI,
  type TodayCardResponse,
} from "@/features/hoondok/cards-api";
import { kstTodayIso } from "@/features/hoondok/dates";
import { isNotFound, loadErrorMessage } from "@/features/hoondok/groups-api";

// 오늘 카드 키가 목록 키로 시작하므로 변경 뒤 무효화 한 번에 둘 다 새로 고친다.
const LIST_KEY = ["hoondok", "cards"];
const TODAY_KEY = ["hoondok", "cards", "today"];

// 상태 배지 — 편성 목록의 검수 배지 토큰을 그대로 쓴다(새 디자인 없음).
const STATUS_BADGE: Record<CardStatus, string> = {
  active: "bg-success-soft text-success hover:bg-success-soft border border-success-border",
  draft: "bg-transparent text-muted-foreground hover:bg-transparent border border-dashed border-border",
  retired: "bg-admin-muted text-muted-foreground hover:bg-admin-muted border border-border",
};

const FILTERS: { value: CardStatus | null; label: string }[] = [
  { value: null, label: "전체" },
  { value: "draft", label: CARD_STATUS_LABEL.draft },
  { value: "active", label: CARD_STATUS_LABEL.active },
  { value: "retired", label: CARD_STATUS_LABEL.retired },
];

type PinEditing = { id: string; value: string } | null;

/** API-HD-052 오늘의 책갈피 카드 풀. 본문은 원문 그대로라 읽기 전용이고, 상태와 날짜 고정만 바꾼다. */
export default function HoondokCardsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CardStatus | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pinEditing, setPinEditing] = useState<PinEditing>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...LIST_KEY, status, page],
    queryFn: () => cardsAPI.list(status, page),
  });
  const today = useQuery({ queryKey: TODAY_KEY, queryFn: () => cardsAPI.today() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: LIST_KEY });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof cardsAPI.update>[1] }) =>
      cardsAPI.update(id, patch),
    onSuccess: () => {
      toast.success("저장되었습니다");
      setPinEditing(null);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(cardMutationErrorMessage(err, "저장에 실패했습니다"));
      if (isNotFound(err)) refresh();
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.allSettled(ids.map((id) => cardsAPI.update(id, { status: "active" }))),
    onSuccess: (results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) toast.success(`${results.length}장을 활성화했습니다`);
      else toast.error(`${results.length}장 중 ${failed}장을 활성화하지 못했습니다`);
      setSelected(new Set());
      refresh();
    },
  });

  function changeFilter(next: CardStatus | null) {
    setStatus(next);
    setPage(1);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const selectable = items.filter((c) => c.status !== "active");
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));
  const busy = updateMutation.isPending || bulkMutation.isPending;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">오늘의 책갈피</h1>
        <p className="text-sm text-muted-foreground mt-1">
          본문은 원문 그대로라 고칠 수 없어요. 상태와 날짜 고정만 바꿔요.
        </p>
      </div>

      <TodayPreview query={today} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="상태 필터" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              aria-pressed={status === f.value}
              onClick={() => changeFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {selected.size > 0 && (
          <Button size="sm" disabled={busy} onClick={() => bulkMutation.mutate([...selected])}>
            선택한 {selected.size}장 활성화
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          {["s1", "s2", "s3", "s4", "s5"].map((key, i) => (
            <div key={key} className={`px-5 py-4 ${i !== 0 ? "border-t" : ""}`}>
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">{loadErrorMessage(error, "카드 목록을 불러올 수 없습니다.")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">이 상태의 카드가 없습니다.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="활성화할 카드 모두 선택"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onCheckedChange={(checked) =>
                        setSelected(checked ? new Set(selectable.map((c) => c.id)) : new Set())
                      }
                    />
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">본문</TableHead>
                  <TableHead className="font-semibold text-foreground">출처</TableHead>
                  <TableHead className="font-semibold text-foreground">상태</TableHead>
                  <TableHead className="font-semibold text-foreground">날짜 고정</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((card) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    checked={selected.has(card.id)}
                    onToggle={() => toggle(card.id)}
                    pinEditing={pinEditing?.id === card.id ? pinEditing.value : null}
                    onPinEdit={(value) => setPinEditing(value === null ? null : { id: card.id, value })}
                    busy={busy}
                    onPatch={(patch) => updateMutation.mutate({ id: card.id, patch })}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <nav aria-label="페이지" className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              총 {data?.total ?? 0}장 · {page} / {totalPages}쪽
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                다음
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

/** 서버 회전 규칙이 고른 오늘 카드(API-HD-047). 미리보기 API 가 없어 내일 카드는 보이지 않는다. */
function TodayPreview({ query }: { query: UseQueryResult<TodayCardResponse> }) {
  const card = query.data?.card;
  return (
    <section aria-labelledby="today-card-heading" className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-card-heading" className="text-sm font-medium">
          오늘 나가는 카드
        </h2>
        <span className="text-xs text-muted-foreground">{query.data?.date ?? kstTodayIso()}</span>
      </div>
      {query.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground">오늘 카드를 불러올 수 없습니다.</p>
      ) : !card ? (
        <p className="text-sm text-muted-foreground">활성 카드가 없어 오늘은 나갈 카드가 없어요.</p>
      ) : (
        <>
          <p className="text-sm leading-relaxed whitespace-pre-line">{card.text}</p>
          <a
            href={cardSourceUrl(card)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {card.source_label} · {card.work_title}
            <ExternalLink className="w-3 h-3" aria-hidden />
          </a>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        그날 고정한 카드가 있으면 그 카드, 없으면 활성 카드가 날마다 돌아가며 나가요.
      </p>
    </section>
  );
}

interface CardRowProps {
  card: CardAdminItem;
  checked: boolean;
  onToggle: () => void;
  /** 편집 중인 고정 날짜. null 이면 편집 중이 아니다. */
  pinEditing: string | null;
  onPinEdit: (value: string | null) => void;
  busy: boolean;
  onPatch: (patch: Parameters<typeof cardsAPI.update>[1]) => void;
}

function CardRow({ card, checked, onToggle, pinEditing, onPinEdit, busy, onPatch }: CardRowProps) {
  const isActive = card.status === "active";
  return (
    <TableRow data-id={card.id} className="hover:bg-admin-muted/30 transition-colors align-top">
      <TableCell>
        <Checkbox aria-label="활성화할 카드로 선택" checked={checked} disabled={isActive} onCheckedChange={onToggle} />
      </TableCell>
      <TableCell className="min-w-[16rem] max-w-[28rem]">
        <p className="text-sm leading-relaxed line-clamp-2 whitespace-normal">{card.text}</p>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground min-w-[12rem] max-w-[18rem] whitespace-normal">
        <a
          href={cardSourceUrl(card)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {card.source_label}
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
        </a>
        <div className="text-xs">{card.work_title}</div>
      </TableCell>
      <TableCell>
        <Badge className={STATUS_BADGE[card.status]}>{CARD_STATUS_LABEL[card.status]}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {pinEditing !== null ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="고정할 날짜"
              value={pinEditing}
              min={kstTodayIso()}
              onChange={(e) => onPinEdit(e.target.value)}
              className="h-8 w-36"
            />
            <Button size="sm" disabled={busy || !pinEditing} onClick={() => onPatch({ pinned_on: pinEditing })}>
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onPinEdit(null)}>
              취소
            </Button>
          </div>
        ) : card.pinned_on ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="text-sm font-medium hover:underline"
              onClick={() => onPinEdit(card.pinned_on ?? "")}
            >
              {card.pinned_on}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => onPatch({ pinned_on: null })}
            >
              <PinOff className="w-3.5 h-3.5 mr-1" />
              해제
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onPinEdit(kstTodayIso())}
          >
            <Pin className="w-3.5 h-3.5 mr-1" />
            고정
          </Button>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {isActive ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => onPatch({ status: "retired" })}
          >
            중지
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onPatch({ status: "active" })}>
            활성화
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
