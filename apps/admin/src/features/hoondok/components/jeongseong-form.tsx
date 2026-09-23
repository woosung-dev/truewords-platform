"use client";

/**
 * 공식 정성 등록/수정 폼 (API-HD-042). daily-reading-form 과 같은 관례 —
 * 검증은 jeongseong-form.ts 의 validateJeongseong() 이 하고 form 은 noValidate 로 인라인 오류만 보인다.
 * 수정 대상이 바뀌면 부모가 key 로 다시 마운트한다(초기값 동기화 effect 없음).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DURATION_MAX,
  DURATION_MIN,
  emptyJeongseongValues,
  type JeongseongFormErrors,
  type JeongseongFormValues,
  SOURCE_NOTE_MAX,
  TITLE_MAX,
  validateJeongseong,
} from "@/features/hoondok/jeongseong-form";

export interface JeongseongFormProps {
  mode: "create" | "edit";
  initialValues?: JeongseongFormValues;
  isSubmitting: boolean;
  onSubmit: (values: JeongseongFormValues) => void;
  onCancel: () => void;
}

const FIELD_ID: Record<keyof JeongseongFormValues, string> = {
  title: "jeongseong-title",
  started_on: "jeongseong-started-on",
  duration_days: "jeongseong-duration",
  source_note: "jeongseong-source-note",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

export function JeongseongForm({ mode, initialValues, isSubmitting, onSubmit, onCancel }: JeongseongFormProps) {
  const [values, setValues] = useState<JeongseongFormValues>(() => initialValues ?? emptyJeongseongValues());
  const [errors, setErrors] = useState<JeongseongFormErrors>({});

  function patch<K extends keyof JeongseongFormValues>(key: K, value: JeongseongFormValues[K]) {
    setValues((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validateJeongseong(values);
    setErrors(found);
    const first = (Object.keys(found) as (keyof JeongseongFormValues)[]).find((key) => found[key]);
    if (first) {
      document.getElementById(FIELD_ID[first])?.focus();
      return;
    }
    onSubmit(values);
  }

  function aria(key: keyof JeongseongFormValues) {
    const id = FIELD_ID[key];
    return errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="font-semibold text-sm border-b pb-3">{mode === "create" ? "새 공식 정성" : "공식 정성 수정"}</h2>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_ID.title}>
          제목 <span className="text-destructive">*</span>
        </Label>
        <Input
          id={FIELD_ID.title}
          value={values.title}
          onChange={(e) => patch("title", e.target.value)}
          maxLength={TITLE_MAX}
          placeholder="예: 추석 40일 정성"
          required
          {...aria("title")}
        />
        <FieldError id={FIELD_ID.title} message={errors.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.started_on}>
            시작일 <span className="text-destructive">*</span>
          </Label>
          <Input
            id={FIELD_ID.started_on}
            type="date"
            value={values.started_on}
            onChange={(e) => patch("started_on", e.target.value)}
            required
            {...aria("started_on")}
          />
          <FieldError id={FIELD_ID.started_on} message={errors.started_on} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={FIELD_ID.duration_days}>
            기간(일) <span className="text-destructive">*</span>
          </Label>
          <Input
            id={FIELD_ID.duration_days}
            type="number"
            min={DURATION_MIN}
            max={DURATION_MAX}
            step={1}
            inputMode="numeric"
            value={values.duration_days}
            onChange={(e) => patch("duration_days", e.target.value)}
            required
            className="w-28"
            {...aria("duration_days")}
          />
          <FieldError id={FIELD_ID.duration_days} message={errors.duration_days} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={FIELD_ID.source_note}>출처 메모</Label>
        <Input
          id={FIELD_ID.source_note}
          value={values.source_note}
          onChange={(e) => patch("source_note", e.target.value)}
          maxLength={SOURCE_NOTE_MAX}
          placeholder="예: 협회 공지 2026-09-20 (선택)"
          {...aria("source_note")}
        />
        <FieldError id={FIELD_ID.source_note} message={errors.source_note} />
      </div>

      <p className="text-xs text-muted-foreground">등록하면 모든 모임 상세에 자동으로 보여요.</p>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "저장 중..." : mode === "create" ? "등록" : "저장"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}
