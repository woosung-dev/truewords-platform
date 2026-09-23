"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { GRADE_LABEL, STATUS_LABEL } from "../labels";
import { rightsAPI } from "../rights-api";
import type { BulkRightsInput, ContentRight, SeriesSummaryItem } from "../types";

// "변경하지 않음" — 등급을 보내지 않는다는 뜻의 화면 전용 값. 서버 enum 과 겹치지 않는 문자열이다.
const KEEP_GRADE = "keep";
const GRADES: NonNullable<ContentRight["authority_grade"]>[] = ["R", "O1", "O2", "O3", "O4", "O5"];

const SCOPES = [
  ["scope_search", "검색 스니펫"],
  ["scope_full_text", "원문 전재"],
  ["scope_jeongseong", "정성 말씀"],
] as const;

type ScopeKey = (typeof SCOPES)[number][0];
type Status = BulkRightsInput["status"];

// 확정값 4·5 기본값: 승인은 허용, 범위는 검색 스니펫·원문 전재만 켠다.
const DEFAULT_SCOPES: Record<ScopeKey, boolean> = {
  scope_search: true,
  scope_full_text: true,
  scope_jeongseong: false,
};

interface Props {
  /** 대상 시리즈. null 이면 닫힌 상태다. 부모가 `key={series}` 로 마운트를 갈아 기본값을 되돌린다. */
  target: SeriesSummaryItem | null;
  onOpenChange: (open: boolean) => void;
  /** 성공 시 부모가 토스트·쿼리 무효화를 맡는다. */
  onDone: (updated: number) => void;
}

/** API-HD-027 시리즈 일괄 승인·철회. 등급은 운영자가 고른 경우에만 페이로드에 넣는다(확정값 11). */
export default function BulkRightsDialog({ target, onOpenChange, onDone }: Props) {
  const [status, setStatus] = useState<Status>("allowed");
  const [scopes, setScopes] = useState<Record<ScopeKey, boolean>>(DEFAULT_SCOPES);
  const [grade, setGrade] = useState<string>(KEEP_GRADE);

  const mutation = useMutation({
    mutationFn: (data: BulkRightsInput) => rightsAPI.bulk(data),
    onSuccess: (result) => {
      onDone(result.updated);
      onOpenChange(false);
    },
  });

  if (!target) return null;

  const errorMessage = mutation.isError
    ? mutation.error instanceof ApiError && mutation.error.status === 404
      ? "이 시리즈에 해당하는 권리 기록이 없습니다. 목록을 새로 고친 뒤 다시 시도해 주세요."
      : "일괄 변경에 실패했습니다. 잠시 후 다시 시도해 주세요."
    : null;

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-popover p-6 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{target.title} 일괄 변경</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            이 시리즈의 {target.registered}권이 전부 바뀝니다.
          </Dialog.Description>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate({
                book_series: target.series,
                status,
                ...scopes,
                ...(grade === KEEP_GRADE
                  ? {}
                  : { authority_grade: grade as NonNullable<ContentRight["authority_grade"]> }),
              });
            }}
          >
            {errorMessage ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage}
              </p>
            ) : null}
            <fieldset disabled={mutation.isPending} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bulk-status">승인 상태</Label>
                <select
                  id="bulk-status"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as Status)}
                >
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-2 text-sm font-medium">기능별 허용 범위</legend>
                {SCOPES.map(([key, label]) => (
                  <label key={key} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scopes[key]}
                      onChange={(event) => setScopes({ ...scopes, [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="bulk-grade">공식성 등급</Label>
                <select
                  id="bulk-grade"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={grade}
                  onChange={(event) => setGrade(event.target.value)}
                >
                  <option value={KEEP_GRADE}>변경하지 않음</option>
                  {GRADES.map((value) => (
                    <option key={value} value={value}>
                      {GRADE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "변경 중…" : "일괄 변경"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
