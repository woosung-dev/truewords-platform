"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Plan B.2 + P0-C — 두 줄 placeholder + char counter
export interface QuestionInputProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  placeholderLine1?: string;
  placeholderLine2?: string;
  maxLength?: number;
  helperText?: string;
  errorText?: string;
}

const DEFAULT_MAX = 1000; // SAFETY_MAX_QUERY_LENGTH

export function QuestionInput({
  placeholderLine1 = "고민이나 질문을 입력해주세요",
  placeholderLine2 = "내용이 구체적일수록 답변이 정확해요",
  maxLength = DEFAULT_MAX,
  helperText,
  errorText,
  value,
  defaultValue,
  className,
  onChange,
  ...props
}: QuestionInputProps) {
  const [internalValue, setInternalValue] = React.useState(
    (defaultValue as string) ?? ""
  );
  const isControlled = value !== undefined;
  const currentValue = (isControlled ? (value as string) : internalValue) ?? "";

  const length = currentValue.length;
  const warn = length >= maxLength * 0.8;
  const danger = length >= maxLength * 0.95;
  const empty = length === 0;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!isControlled) setInternalValue(e.target.value);
    onChange?.(e);
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card px-4 py-3 transition-colors",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        errorText
          ? "border-destructive ring-2 ring-destructive/20"
          : "border-border",
        className
      )}
      data-slot="question-input"
    >
      {/* Placeholder — 입력 없을 때만 노출, 두 줄 가이드 (P0-C) */}
      {empty ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-3 select-none"
        >
          <p className="text-base text-muted-foreground">{placeholderLine1}</p>
          <p className="mt-1 text-sm text-fg-subtle group-focus-within:opacity-60 transition-opacity">
            {placeholderLine2}
          </p>
        </div>
      ) : null}

      <textarea
        {...props}
        value={isControlled ? currentValue : undefined}
        defaultValue={!isControlled ? (defaultValue as string) : undefined}
        onChange={handleChange}
        maxLength={maxLength}
        rows={empty ? 4 : Math.max(4, Math.min(10, currentValue.split("\n").length + 1))}
        aria-label={props["aria-label"] ?? "질문 입력"}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={
          errorText
            ? "question-input-error"
            : helperText
              ? "question-input-helper"
              : "question-input-counter"
        }
        className={cn(
          "block w-full resize-none bg-transparent text-base leading-relaxed",
          "text-foreground placeholder:text-transparent outline-none",
          "min-h-24 break-keep-all"
        )}
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex-1">
          {errorText ? (
            <p
              id="question-input-error"
              role="alert"
              className="text-destructive"
            >
              {errorText}
            </p>
          ) : helperText ? (
            <p id="question-input-helper" className="text-muted-foreground">
              {helperText}
            </p>
          ) : null}
        </div>
        <span
          id="question-input-counter"
          className={cn(
            "font-mono tabular-nums",
            danger
              ? "text-destructive"
              : warn
                ? "text-muted-foreground"
                : "text-fg-subtle"
          )}
        >
          {length} / {maxLength}
        </span>
      </div>
    </div>
  );
}
