"use client";

// /hoondok/garden/interests — 관심사와 마음 바꾸기 (DESIGN-PLAN §6-7). 질문 흐름과 같은 답을 칩 세 묶음으로 고친다.
// "많이 힘들어요"는 여기 두지 않는다(그날의 위기 안내는 질문 흐름·마음 한 장에서만 연다). 이미 켜진 위기 표시는 저장해도 그대로 둔다.
// 저장은 이 기기에만 한다. 계정 동기화 토글은 후속 결정이라 없다.
import { Check, Info, Lock, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { InlineConfirm } from "../../together/components/group-common";
import {
  CRISIS_MOOD_ID,
  countLimitedMoods,
  INTEREST_OPTIONS,
  MAX_MOODS,
  MOOD_OPTIONS,
  type PlainOption,
  READING_LENGTH_OPTIONS,
  READING_TIME_OPTIONS,
  toggleMood,
} from "../options";
import { usePersonalAnswers } from "../use-personal";

type Draft = { interests: string[]; moods: string[]; readingTime: string | null; readingLength: string | null };

const LIMITED_MOODS = MOOD_OPTIONS.filter((o) => o.id !== CRISIS_MOOD_ID);

function sameDraft(a: Draft, b: Draft): boolean {
  const sameSet = (x: string[], y: string[]) => x.length === y.length && x.every((v) => y.includes(v));
  return (
    sameSet(a.interests, b.interests) &&
    sameSet(a.moods, b.moods) &&
    a.readingTime === b.readingTime &&
    a.readingLength === b.readingLength
  );
}

function Chip({
  label,
  isOn,
  isDisabled,
  onToggle,
}: {
  label: string;
  isOn: boolean;
  isDisabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="chip-btn ps-chip"
      aria-pressed={isOn}
      aria-disabled={isDisabled || undefined}
      onClick={() => {
        if (!isDisabled) onToggle();
      }}
    >
      {isOn && <Check size={18} aria-hidden="true" />}
      {label}
    </button>
  );
}

function Group({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="ps-group" aria-labelledby={id}>
      <div className="sect__head">
        <h2 className="sect__title" id={id}>
          {title}
        </h2>
        {meta && <span className="sect__meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function SingleChips({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly PlainOption[];
  value: string | null;
  format: (o: PlainOption) => string;
  onChange: (next: string | null) => void;
}) {
  return (
    <fieldset className="ps-sub">
      <legend className="ps-sub__t">{label}</legend>
      <div className="chips">
        {options.map((o) => (
          <Chip
            key={o.id}
            label={format(o)}
            isOn={value === o.id}
            onToggle={() => onChange(value === o.id ? null : o.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function InterestsScreen() {
  const { answers, save, clear } = usePersonalAnswers();
  const saved = useMemo<Draft>(
    () => ({
      interests: answers.interests,
      moods: answers.moods,
      readingTime: answers.readingTime,
      readingLength: answers.readingLength,
    }),
    [answers],
  );
  // 고치기 전에는 저장값을 그대로 보이고, 하나라도 누르면 그때부터 화면 안의 초안을 쓴다
  const [edited, setEdited] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const draft = edited ?? saved;
  const isChanged = !sameDraft(draft, saved);
  const isMoodFull = countLimitedMoods(draft.moods) >= MAX_MOODS;

  function update(next: Partial<Draft>) {
    setEdited({ ...draft, ...next });
    setStatus(null);
  }

  function handleSave() {
    save({ ...draft, isCrisis: answers.isCrisis });
    setEdited(null);
    setStatus("저장했어요. 홈 책갈피에 고른 답이 바로 반영돼요");
  }

  function handleClear() {
    clear();
    setEdited(null);
    setStatus("고른 답을 이 기기에서 지웠어요");
  }

  const hasAny =
    saved.interests.length > 0 || saved.moods.length > 0 || Boolean(saved.readingTime) || Boolean(saved.readingLength);
  const barText = status ?? (isChanged ? "바뀐 내용이 있어요" : "바뀐 내용이 없어요");

  return (
    <section className="col ps-form">
      <p className="onb-why ps-lede">
        <Info size={20} aria-hidden="true" />
        <span>고른 답에 맞춰 홈 책갈피에 꽂아 두는 장이 바뀌어요.</span>
      </p>

      <Group title="관심 주제" meta={`${draft.interests.length}개 골랐어요`}>
        <div className="chips">
          {INTEREST_OPTIONS.map((o) => {
            const isOn = draft.interests.includes(o.id);
            return (
              <Chip
                key={o.id}
                label={o.label}
                isOn={isOn}
                onToggle={() =>
                  update({ interests: isOn ? draft.interests.filter((v) => v !== o.id) : [...draft.interests, o.id] })
                }
              />
            );
          })}
        </div>
      </Group>

      <Group title="요즘 마음" meta="두 개까지">
        <div className="chips">
          {LIMITED_MOODS.map((o) => {
            const isOn = draft.moods.includes(o.id);
            return (
              <Chip
                key={o.id}
                label={o.label}
                isOn={isOn}
                isDisabled={!isOn && isMoodFull}
                onToggle={() => update({ moods: toggleMood(draft.moods, o.id) })}
              />
            );
          })}
        </div>
        {isMoodFull && <p className="ps-hint">두 개까지 고를 수 있어요. 하나를 풀면 다른 것을 고를 수 있어요.</p>}
      </Group>

      <Group title="읽는 때와 길이" meta="고르지 않아도 돼요">
        <SingleChips
          label="읽는 때"
          options={READING_TIME_OPTIONS}
          value={draft.readingTime}
          format={(o) => o.label}
          onChange={(readingTime) => update({ readingTime })}
        />
        <SingleChips
          label="한 번에 읽는 길이"
          options={READING_LENGTH_OPTIONS}
          value={draft.readingLength}
          format={(o) => `${o.label} ${o.description}`}
          onChange={(readingLength) => update({ readingLength })}
        />
      </Group>

      <p className="onb-why onb-why--store">
        <Lock size={20} aria-hidden="true" />
        <span>고른 답은 이 기기에만 저장돼요</span>
      </p>

      {hasAny && (
        <div className="ps-clear">
          <InlineConfirm
            openLabel="모두 지우기"
            openIcon={<Trash2 size={20} aria-hidden="true" />}
            openClassName="btn btn-line"
            label="고른 답 모두 지우기 확인"
            message="관심 주제, 요즘 마음, 읽는 때가 이 기기에서 지워져요. 홈에는 오늘 편성된 장이 꽂혀요."
            confirmLabel="지우기"
            onConfirm={handleClear}
          />
        </div>
      )}

      <div className="ps-bar">
        <p className="ps-bar__t" role="status" aria-live="polite">
          {barText}
        </p>
        <button type="button" className="btn btn-primary" disabled={!isChanged} onClick={handleSave}>
          저장
        </button>
      </div>
    </section>
  );
}
