"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContentRightInput, ContentRightResponse } from "@truewords/api-client-ts/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveErrorMessage } from "@/features/hoondok/api";
import { GRADE_LABEL } from "@/features/hoondok/labels";
import { rightsAPI } from "@/features/hoondok/rights-api";

const EMPTY: ContentRightInput = {
  volume: "",
  work_title: "",
  source_keys: [],
  book_series: null,
  authority_grade: "R",
  status: "pending",
  scope_search: false,
  scope_full_text: false,
  scope_jeongseong: false,
  note: "",
};
const STATUS_LABEL = { pending: "확인 대기", allowed: "허용", withdrawn: "철회" };
const SCOPES = [
  ["scope_search", "검색 스니펫"],
  ["scope_full_text", "원문 전재"],
  ["scope_jeongseong", "정성 말씀"],
] as const;

export default function ContentRightsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["hoondok", "content-rights"], queryFn: rightsAPI.list });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContentRightInput>(EMPTY);
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: (data: ContentRightInput) => (editingId ? rightsAPI.update(editingId, data) : rightsAPI.create(data)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["hoondok", "content-rights"] });
      setMessage("권리 기록을 저장했습니다.");
      setEditingId(null);
      setForm(EMPTY);
    },
  });
  function edit(right: ContentRightResponse) {
    setEditingId(right.id);
    setForm({
      volume: right.volume,
      work_title: right.work_title,
      source_keys: right.source_keys,
      book_series: right.book_series,
      authority_grade: right.authority_grade,
      status: right.status,
      scope_search: right.scope_search,
      scope_full_text: right.scope_full_text,
      scope_jeongseong: right.scope_jeongseong,
      note: right.note,
    });
    setMessage("");
    mutation.reset();
  }
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">훈독 권리 원장</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          저작물별 승인 상태와 기능별 권리를 각각 확인해 주세요. 새 기록은 확인 대기로 시작합니다.
        </p>
      </div>
      <form
        className="rounded-xl border bg-card p-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          mutation.mutate({
            ...form,
            source_keys: (form.source_keys ?? []).map((value) => value.trim()).filter(Boolean),
          });
        }}
      >
        <h2 className="font-semibold">{editingId ? "권리 수정" : "권리 등록"}</h2>
        {mutation.isError ? (
          <p role="alert" className="text-destructive">
            {saveErrorMessage(mutation.error, "저장하지 못했습니다. 입력 내용을 유지했으니 다시 시도해 주세요.")}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="volume">코퍼스 저작물 ID (volume)</Label>
              <Input
                id="volume"
                required
                maxLength={512}
                value={form.volume}
                onChange={(e) => setForm({ ...form, volume: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-title">표시 제목</Label>
              <Input
                id="work-title"
                required
                maxLength={200}
                value={form.work_title}
                onChange={(e) => setForm({ ...form, work_title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sources">출처 키 (쉼표로 구분)</Label>
              <Input
                id="sources"
                value={(form.source_keys ?? []).join(",")}
                onChange={(e) => setForm({ ...form, source_keys: e.target.value.split(",") })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series">총서</Label>
              <Input
                id="series"
                maxLength={200}
                value={form.book_series ?? ""}
                onChange={(e) => setForm({ ...form, book_series: e.target.value || null })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">승인 상태</Label>
              <select
                id="status"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ContentRightInput["status"] })}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grade">공식성 등급</Label>
              <select
                id="grade"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.authority_grade}
                onChange={(e) =>
                  setForm({ ...form, authority_grade: e.target.value as ContentRightInput["authority_grade"] })
                }
              >
                {["R", "O1", "O2", "O3", "O4", "O5"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium">기능별 허용 범위</legend>
            {SCOPES.map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form[key] ?? false}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="note">승인 근거 · 메모</Label>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="note"
              maxLength={2000}
              value={form.note ?? ""}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">{mutation.isPending ? "저장 중…" : "저장"}</Button>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                  mutation.reset();
                }}
              >
                수정 취소
              </Button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {query.isPending ? (
        <p role="status">권리 목록을 불러오는 중입니다.</p>
      ) : query.isError ? (
        <div role="alert">
          <p>목록을 불러오지 못했습니다.</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-muted-foreground">
          등록된 권리가 없습니다. 승인 근거를 확인한 저작물을 등록해 주세요.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {query.data.map((right) => (
            <li key={right.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="font-medium break-words">{right.work_title}</h2>
                <p className="text-sm text-muted-foreground break-all">
                  {right.volume} · {STATUS_LABEL[right.status ?? "pending"]} ·{" "}
                  {GRADE_LABEL[right.authority_grade ?? "R"]}
                </p>
                <p className="text-sm">
                  {SCOPES.filter(([key]) => right[key])
                    .map(([, label]) => label)
                    .join(" · ") || "허용 범위 없음"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => edit(right)}
                aria-label={`${right.work_title} 수정`}
              >
                수정
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
