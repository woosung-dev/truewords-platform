"use client";

// 사진 카드 시트의 고르기 묶음 (크기·바탕·출처 표시·콜라주 바탕). 라디오 묶음이라 방향키로 고르고, 고른 칸만 탭 순서에 든다.
import { type ReactNode, useId } from "react";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";

export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "seg",
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; visual?: ReactNode }[];
  onChange: (value: T) => void;
  /** seg = 알약 두세 칸, swatch = 그림 칸(바탕) */
  variant?: "seg" | "swatch";
}) {
  const labelId = useId();
  return (
    <div className="pcs-ctl">
      <p className="pcs-ctl__lbl" id={labelId}>
        {label}
      </p>
      <div className={`pcs-${variant}`} role="radiogroup" aria-labelledby={labelId} onKeyDown={handleSegmentKeyDown}>
        {options.map((option) => {
          const isOn = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isOn}
              tabIndex={isOn ? 0 : -1}
              onClick={() => onChange(option.value)}
            >
              {option.visual}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
