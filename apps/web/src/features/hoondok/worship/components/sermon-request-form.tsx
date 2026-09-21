"use client";

// SCR-PWA-013 설교 섭외·신청 폼 (PLAN-HD-002 W3-W 프리뷰 셸).
// `DEC-PWA-021`(섭외 운영 주체)이 미결이라 받는 곳이 없다 — 제출은 preventDefault 로 멈추고 인라인 상태만 알린다.
// 네트워크 요청 0, 저장 0. 입력값은 컴포넌트가 사는 동안만 남는다(비제어 입력).
//
// 라디오는 프로토타입의 `role="radio"` 커스텀 대신 네이티브 input 을 라벨로 감쌌다 — 화살표 키 이동과
// 폼 검증을 브라우저가 맡고 모양만 CSS 가 입힌다 (W1-J `.js-opt` 선례).
import { Info, Send } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
  PREVIEW_LEAD,
  REQUEST_KINDS,
  REQUEST_LEDE,
  REQUEST_NOTE,
  REQUEST_NOTICE,
  REQUEST_TARGETS,
  REQUEST_TOPIC_DEFAULT,
  REQUEST_WHEN_OPTIONS,
} from "@/features/hoondok/preview/fixtures/worship";
import { PreviewUnavailable } from "@/features/hoondok/preview/unavailable";
import { PreviewAvatar } from "./preview-avatar";

const SUBMIT_MESSAGE = "접수는 준비 중이에요";
const TOPIC_MAX_LENGTH = 60;

export function SermonRequestForm() {
  const fieldId = useId();
  const [status, setStatus] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 받는 API 가 없다 — 아무것도 보내지 않고 상태만 바꾼다
    event.preventDefault();
    setStatus(SUBMIT_MESSAGE);
  }

  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      <p className="rq-lede">{REQUEST_LEDE}</p>

      <form className="form rq-form" onSubmit={handleSubmit} aria-label="설교 섭외 신청">
        <div className="field rq-field">
          <span className="field__label" id={`${fieldId}-who`}>
            누구에게
          </span>
          <ul className="card rq-pick" aria-labelledby={`${fieldId}-who`}>
            {REQUEST_TARGETS.map((target, index) => (
              <li key={target.id}>
                <label className="rq-pick__it">
                  <input
                    type="radio"
                    name={`${fieldId}-target`}
                    value={target.id}
                    defaultChecked={index === 0}
                    required
                  />
                  <span className="rq-radio" aria-hidden="true" />
                  <PreviewAvatar name={target.name} />
                  <span className="ch-item__bd">
                    <span className="ch-item__t">{target.name}</span>
                    <span className="ch-item__m">{target.note}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="field rq-field">
          <span className="field__label" id={`${fieldId}-kind`}>
            형식
          </span>
          <div className="rq-opts" role="radiogroup" aria-labelledby={`${fieldId}-kind`}>
            {REQUEST_KINDS.map((kind, index) => (
              <label className="rq-opt" key={kind.id}>
                <input type="radio" name={`${fieldId}-kind`} value={kind.id} defaultChecked={index === 0} required />
                <b>{kind.title}</b>
                <span>{kind.note}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field rq-field">
          <label className="field__label" htmlFor={`${fieldId}-topic`}>
            주제
          </label>
          <input
            id={`${fieldId}-topic`}
            name="topic"
            type="text"
            autoComplete="off"
            maxLength={TOPIC_MAX_LENGTH}
            required
            defaultValue={REQUEST_TOPIC_DEFAULT}
          />
          <span className="field__help">미리보기 예시 주제예요. 바꿔도 돼요.</span>
        </div>

        <div className="field rq-field">
          <label className="field__label" htmlFor={`${fieldId}-when`}>
            희망 시기
          </label>
          <select
            id={`${fieldId}-when`}
            className="rq-select"
            name="when"
            required
            defaultValue={REQUEST_WHEN_OPTIONS[0]}
          >
            {REQUEST_WHEN_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="field rq-field">
          <label className="field__label" htmlFor={`${fieldId}-memo`}>
            교회장께 한마디 (선택)
          </label>
          <textarea
            id={`${fieldId}-memo`}
            className="rq-memo"
            name="memo"
            rows={3}
            placeholder="예: 초등학생 자녀와 함께 들을 수 있는 내용이면 좋겠어요"
          />
        </div>

        <p className="rq-note">
          <Info size={20} aria-hidden="true" />
          <span>{REQUEST_NOTE}</span>
        </p>

        <button className="btn btn-primary rq-submit" type="submit">
          <Send size={20} aria-hidden="true" />
          요청 보내기
        </button>
        {/* 제출 결과는 버튼 바로 아래에서 글자로 알린다 — 색만으로 구분하지 않는다 */}
        {status && (
          <PreviewUnavailable
            title={status}
            reason="섭외를 접수할 운영 주체가 아직 정해지지 않아 전송하지 않았어요. 입력한 내용은 이 화면에 남아 있어요."
            href="/hoondok/worship/sermons"
            linkLabel="설교 목록으로 돌아가기"
          />
        )}
      </form>

      <p className="notice">{REQUEST_NOTICE}</p>
    </section>
  );
}
