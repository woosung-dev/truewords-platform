"use client";

/**
 * 편성 등록/수정 공통 폼 (PLAN-HD-001 Phase 3 B). 필드는 ENT-HD-002 전부.
 *
 * admin UI 에 textarea·select·date picker 컴포넌트가 없어 raw 태그를 쓴다(chatbot-form 의 textarea 와 같은 관례).
 * 검증은 form.ts 의 validate() 가 하고 form 은 noValidate — 브라우저 말풍선 대신 인라인 오류로 통일한다.
 * edit 페이지는 데이터 로드 후에만 이 폼을 렌더하므로 초기값 동기화 effect 가 없다.
 */

import { BookOpen, CalendarDays, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type DailyReadingFormValues, emptyValues, type FormErrors, validate } from "@/features/hoondok/form";
import { GRADE_LABEL, REVIEW_LABEL } from "@/features/hoondok/labels";
import type { AuthorityGrade, ReviewStatus } from "@/features/hoondok/types";

export interface DailyReadingFormProps {
  mode: "create" | "edit";
  initialValues?: DailyReadingFormValues;
  /** 서버가 돌려준 필드 오류(409 날짜 충돌). 다음 제출 시 페이지가 비운다. */
  serverErrors?: FormErrors;
  onSubmit: (values: DailyReadingFormValues) => void | Promise<unknown>;
  isSubmitting: boolean;
  submitLabel: string;
  submitPendingLabel: string;
  onCancel: () => void;
  cancelLabel: string;
}

const FIELD_ID: Record<keyof DailyReadingFormValues, string> = {
  reading_date: "reading-date",
  title: "title",
  body: "body",
  speaker: "speaker",
  spoken_on: "spoken-on",
  work_title: "work-title",
  edition: "edition",
  authority_grade: "authority-grade",
  review_status: "review-status",
  source_note: "source-note",
  chunk_id: "chunk-id",
  estimated_minutes: "estimated-minutes",
};

const TEXTAREA_CLASS =
  "w-full rounded-lg border bg-background px-3 py-2.5 text-sm min-h-[240px] resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent aria-invalid:border-destructive";
const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function DailyReadingForm({
  mode,
  initialValues,
  serverErrors,
  onSubmit,
  isSubmitting,
  submitLabel,
  submitPendingLabel,
  onCancel,
  cancelLabel,
}: DailyReadingFormProps) {
  const [values, setValues] = useState<DailyReadingFormValues>(() => initialValues ?? emptyValues());
  const [localErrors, setLocalErrors] = useState<FormErrors>({});
  const errors: FormErrors = { ...serverErrors, ...localErrors };

  function patch<K extends keyof DailyReadingFormValues>(key: K, value: DailyReadingFormValues[K]) {
    setValues((s) => ({ ...s, [key]: value }));
    if (localErrors[key]) setLocalErrors((e) => ({ ...e, [key]: undefined }));
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validate(values);
    setLocalErrors(found);
    const first = (Object.keys(found) as (keyof DailyReadingFormValues)[]).find((key) => found[key]);
    if (first) {
      document.getElementById(FIELD_ID[first])?.focus();
      return;
    }
    void onSubmit(values);
  }

  /** 필드별 aria 속성 — 오류가 있으면 invalid + 설명 연결. */
  function aria(key: keyof DailyReadingFormValues) {
    const id = FIELD_ID[key];
    return errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* 섹션 1: 편성 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">편성</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.reading_date}>
              편성일 <span className="text-destructive">*</span>
            </Label>
            <Input
              id={FIELD_ID.reading_date}
              type="date"
              value={values.reading_date}
              onChange={(e) => patch("reading_date", e.target.value)}
              required
              {...aria("reading_date")}
            />
            <FieldError id={FIELD_ID.reading_date} message={errors.reading_date} />
            {mode === "edit" && <p className="text-xs text-muted-foreground">날짜를 바꾸면 그날로 옮겨요</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.estimated_minutes}>
              예상 읽기 시간(분) <span className="text-destructive">*</span>
            </Label>
            <Input
              id={FIELD_ID.estimated_minutes}
              type="number"
              min={1}
              max={60}
              step={1}
              inputMode="numeric"
              value={values.estimated_minutes}
              onChange={(e) => patch("estimated_minutes", e.target.value)}
              required
              className="w-28"
              {...aria("estimated_minutes")}
            />
            <FieldError id={FIELD_ID.estimated_minutes} message={errors.estimated_minutes} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.title}>
            제목 <span className="text-destructive">*</span>
          </Label>
          <Input
            id={FIELD_ID.title}
            value={values.title}
            onChange={(e) => patch("title", e.target.value)}
            maxLength={200}
            placeholder="카드에 보이는 한 줄 제목"
            required
            {...aria("title")}
          />
          <FieldError id={FIELD_ID.title} message={errors.title} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.body}>
            본문 <span className="text-destructive">*</span>
          </Label>
          <textarea
            id={FIELD_ID.body}
            className={TEXTAREA_CLASS}
            value={values.body}
            onChange={(e) => patch("body", e.target.value)}
            placeholder="말씀 원문을 그대로 붙여 넣어요. 요약·재작성하지 않아요."
            required
            {...aria("body")}
          />
          <FieldError id={FIELD_ID.body} message={errors.body} />
        </div>
      </div>

      {/* 섹션 2: 출처 (AC-016-01 메타) */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">출처</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.speaker}>
              화자 <span className="text-destructive">*</span>
            </Label>
            <Input
              id={FIELD_ID.speaker}
              value={values.speaker}
              onChange={(e) => patch("speaker", e.target.value)}
              maxLength={64}
              placeholder="예: 참어머님"
              required
              {...aria("speaker")}
            />
            <FieldError id={FIELD_ID.speaker} message={errors.speaker} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.spoken_on}>원문 날짜</Label>
            <Input
              id={FIELD_ID.spoken_on}
              value={values.spoken_on}
              onChange={(e) => patch("spoken_on", e.target.value)}
              maxLength={32}
              placeholder="예: 2012.9.17 (표기 그대로)"
              {...aria("spoken_on")}
            />
            <FieldError id={FIELD_ID.spoken_on} message={errors.spoken_on} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.work_title}>
              저작물 <span className="text-destructive">*</span>
            </Label>
            <Input
              id={FIELD_ID.work_title}
              value={values.work_title}
              onChange={(e) => patch("work_title", e.target.value)}
              maxLength={200}
              placeholder="예: 참어머님 말씀 모음"
              required
              {...aria("work_title")}
            />
            <FieldError id={FIELD_ID.work_title} message={errors.work_title} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.edition}>판본</Label>
            <Input
              id={FIELD_ID.edition}
              value={values.edition}
              onChange={(e) => patch("edition", e.target.value)}
              maxLength={120}
              placeholder="예: 최종본 2012년~"
              {...aria("edition")}
            />
            <FieldError id={FIELD_ID.edition} message={errors.edition} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.source_note}>출처 메모</Label>
          <Input
            id={FIELD_ID.source_note}
            value={values.source_note}
            onChange={(e) => patch("source_note", e.target.value)}
            maxLength={500}
            placeholder="페이지·출전 등 운영자 메모 (화면에 안 보여요)"
            {...aria("source_note")}
          />
          <FieldError id={FIELD_ID.source_note} message={errors.source_note} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.chunk_id}>원문 chunk id</Label>
          <Input
            id={FIELD_ID.chunk_id}
            value={values.chunk_id}
            onChange={(e) => patch("chunk_id", e.target.value)}
            maxLength={128}
            placeholder="Qdrant point id (선택)"
            className="font-mono text-xs"
            {...aria("chunk_id")}
          />
          <FieldError id={FIELD_ID.chunk_id} message={errors.chunk_id} />
        </div>
      </div>

      {/* 섹션 3: 공식성·검수 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">공식성·검수</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.authority_grade}>
              공식성 등급 <span className="text-destructive">*</span>
            </Label>
            <select
              id={FIELD_ID.authority_grade}
              className={SELECT_CLASS}
              value={values.authority_grade}
              onChange={(e) => patch("authority_grade", e.target.value as AuthorityGrade)}
              required
              {...aria("authority_grade")}
            >
              {(Object.keys(GRADE_LABEL) as AuthorityGrade[]).map((grade) => (
                <option key={grade} value={grade}>
                  {GRADE_LABEL[grade]}
                </option>
              ))}
            </select>
            <FieldError id={FIELD_ID.authority_grade} message={errors.authority_grade} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={FIELD_ID.review_status}>
              검수 상태 <span className="text-destructive">*</span>
            </Label>
            <select
              id={FIELD_ID.review_status}
              className={SELECT_CLASS}
              value={values.review_status}
              onChange={(e) => patch("review_status", e.target.value as ReviewStatus)}
              required
              {...aria("review_status")}
            >
              {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((status) => (
                <option key={status} value={status}>
                  {REVIEW_LABEL[status]}
                </option>
              ))}
            </select>
            <FieldError id={FIELD_ID.review_status} message={errors.review_status} />
            <p className="text-xs text-muted-foreground">철회하면 그날 홈에 본문이 나오지 않아요. 삭제는 없어요.</p>
          </div>
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 flex gap-3 border-t bg-background/80 backdrop-blur-sm py-4 -mx-6 px-6">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? submitPendingLabel : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
