"use client";

// SCR-PWA-004 정성 기간 만들기 폼. 필드 순서·문구는 프로토타입 `#sheet-jeongseong` 그대로이고
// 가족 챌린지 토글만 뺐다(W3 범위). 저장은 API-HD-009 `POST /hoondok/me/jeongseong` 한 번이다.
// 정성 알림은 따로 두지 않고 훈독하기 알림(설정 › 훈독하기 시각)에 합쳤다 — 그래서 알림 시각 칸이 없고 reminder_time 도 보내지 않는다.
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import type { JeongseongDuration } from "@/features/hoondok/jeongseong-api";
import { formatKstDate } from "@/features/hoondok/today";
import { createErrorMessage, UNAUTHORIZED, useCreateJeongseong } from "@/features/hoondok/use-jeongseong";
import { onboardingHref } from "@/features/identity/gate";
import { DEFAULT_DURATION, DURATION_OPTIONS, startRange, TOPIC_CHIPS, TOPIC_MAX_LENGTH } from "../format";

/** 401 로 온보딩에 갔다 돌아올 때 시트를 다시 연다. */
const RETURN_TO = "/hoondok?sheet=jeongseong";

export function JeongseongForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const create = useCreateJeongseong();
  const fieldId = useId();
  const today = formatKstDate().iso;
  const range = startRange(today);
  const [duration, setDuration] = useState<JeongseongDuration>(DEFAULT_DURATION);
  const [topic, setTopic] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    create.mutate(
      {
        topic: topic.trim(),
        duration_days: duration,
        started_on: startedOn,
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          const text = createErrorMessage(error);
          // 쿠키가 만료된 채 폼을 냈을 때 — 돌아오면 같은 시트가 다시 열린다
          if (text === UNAUTHORIZED) router.push(onboardingHref(RETURN_TO));
          else setMessage(text);
        },
      },
    );
  }

  return (
    <form className="js-form" onSubmit={handleSubmit} aria-label="정성 기간 만들기">
      <div className="field js-field">
        <span className="field__label" id={`${fieldId}-term`}>
          기간
        </span>
        {/* 네이티브 라디오를 라벨로 감싼다 — 화살표 키·폼 연결을 브라우저가 맡고 칩 모양만 CSS 가 입힌다 */}
        <div className="js-opts" role="radiogroup" aria-labelledby={`${fieldId}-term`}>
          {DURATION_OPTIONS.map((option) => (
            <label className="js-opt" key={option.days} data-on={option.days === duration ? "" : undefined}>
              <input
                type="radio"
                name={`${fieldId}-duration`}
                value={option.days}
                checked={option.days === duration}
                onChange={() => setDuration(option.days)}
              />
              <b>{option.days}</b>
              <span>{option.note}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field js-field">
        <label className="field__label" htmlFor={`${fieldId}-topic`}>
          주제
        </label>
        <div className="chips">
          {TOPIC_CHIPS.map((chip) => (
            <button
              className="chip-btn"
              type="button"
              key={chip}
              aria-pressed={chip === topic}
              onClick={() => setTopic(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
        <input
          id={`${fieldId}-topic`}
          name="topic"
          autoComplete="off"
          maxLength={TOPIC_MAX_LENGTH}
          required
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <span className="field__help">칩을 고르거나 직접 적어요. {TOPIC_MAX_LENGTH}자까지 들어가요</span>
      </div>

      <div className="field js-field">
        <label className="field__label" htmlFor={`${fieldId}-start`}>
          시작일
        </label>
        <input
          id={`${fieldId}-start`}
          type="date"
          name="started_on"
          required
          min={range.min}
          max={range.max}
          value={startedOn}
          onChange={(event) => setStartedOn(event.target.value)}
        />
        <span className="field__help">
          알림은 <Link href="/hoondok/settings">설정 › 훈독하기</Link> 시각에 맞춰 가요
        </span>
        <span className="field__help">하루를 놓쳐도 정성은 끊기지 않아요. 진행은 &quot;N일차&quot;로만 보여요.</span>
      </div>

      {message && (
        <p className="hint hint--alert" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {message}
        </p>
      )}

      <div className="js-cta">
        <HoondokButton type="submit" isLoading={create.isPending}>
          정성 시작하기
        </HoondokButton>
        <HoondokButton variant="ghost" onClick={onClose}>
          닫기
        </HoondokButton>
      </div>
    </form>
  );
}
