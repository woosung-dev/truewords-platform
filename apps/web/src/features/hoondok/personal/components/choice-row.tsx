"use client";

// 답 행 (DESIGN-PLAN §7 ChoiceRow). 행 전체가 누르는 자리이고 최소 높이 72px(--onb-row-min)이다.
// 상태는 행의 aria-checked 가 말하고 체크 원은 장식(aria-hidden)이다. 꺼진 행은 aria-disabled 로 두어 포커스는 받되
// 눌러도 바뀌지 않는다 — 왜 못 고르는지는 하단 막대 문구가 알린다.
import { Check } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

type ChoiceRowProps = {
  role: "checkbox" | "radio";
  isChecked: boolean;
  isDisabled?: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
  tabIndex?: number;
};

export function ChoiceRow({ role, isChecked, isDisabled, label, description, onSelect, tabIndex }: ChoiceRowProps) {
  return (
    <button
      type="button"
      className={`choice${description ? "" : " choice--single"}`}
      role={role}
      aria-checked={isChecked}
      aria-disabled={isDisabled || undefined}
      tabIndex={tabIndex}
      onClick={() => {
        if (!isDisabled) onSelect();
      }}
    >
      <span className="choice__tx">
        <span className="choice__t">{label}</span>
        {description && <span className="choice__d">{description}</span>}
      </span>
      <span className="choice__mark" aria-hidden="true">
        <Check size={15} strokeWidth={3} />
      </span>
    </button>
  );
}

type RadioOption = { id: string; label: string; description: string };

/**
 * 고르지 않아도 되는 라디오 묶음(질문 3). 화살표로 옮기면 그 행을 고르고(APG radio group), 고른 행을 다시 누르면 푼다.
 * Tab 은 묶음 안의 한 행(고른 것, 없으면 첫 행)에만 멈춘다.
 */
export function ChoiceRadioGroup({
  labelledBy,
  options,
  value,
  onChange,
  className,
}: {
  labelledBy: string;
  options: readonly RadioOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = options.findIndex((o) => o.id === value);
    const next = (Math.max(current, 0) + (current < 0 ? 0 : step) + options.length) % options.length;
    onChange(options[next].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div className={className} role="radiogroup" aria-labelledby={labelledBy} ref={ref} onKeyDown={handleKeyDown}>
      {options.map((option, index) => (
        <ChoiceRow
          key={option.id}
          role="radio"
          isChecked={option.id === value}
          label={option.label}
          description={option.description}
          tabIndex={index === focusIndex ? 0 : -1}
          onSelect={() => onChange(option.id === value ? null : option.id)}
        />
      ))}
    </div>
  );
}
