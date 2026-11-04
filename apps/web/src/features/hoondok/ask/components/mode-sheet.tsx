"use client";

// 답변 모델 고르기 시트 — 새 질문 화면과 답변 상세의 "변경"이 함께 쓴다.
// 네이티브 라디오 묶음이라 방향키 이동·선택 읽기는 브라우저가 맡고, 라벨 전체가 44px 이상 누르는 자리다.
// 방향키도 change 를 일으키므로 고르기만으로는 확정하지 않는다 — 확정은 아래 버튼으로만 한다
// (상세의 "변경"은 확정하면 새 질문을 보낸다).
import { useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { ANSWER_CHOICES, type AnswerChoice } from "../modes";

export function ModeSheet({
  value,
  title = "답변 모델",
  lede,
  confirmLabel = "이 모델로 하기",
  onPick,
  onClose,
}: {
  value: AnswerChoice;
  title?: string;
  lede?: string;
  confirmLabel?: string;
  onPick: (choice: AnswerChoice) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<AnswerChoice>(value);
  return (
    <ReaderSheet title={title} onClose={onClose}>
      {lede && <p className="js-lede">{lede}</p>}
      <div className="ask-opts" role="radiogroup" aria-label={title}>
        {ANSWER_CHOICES.map((info) => {
          const Icon = info.icon;
          return (
            <label key={info.id} className="ask-opt">
              <input
                className="ask-opt__in"
                type="radio"
                name="ask-answer-mode"
                value={info.id}
                checked={selected === info.id}
                onChange={() => setSelected(info.id)}
              />
              <span className="ask-opt__ic" aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className="ask-opt__bd">
                <b>{info.label}</b>
                <span>{info.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="notice ask-opts__note">위기로 보이는 질문은 어떤 모델을 골라도 마음 돌봄이 답해요.</p>
      <button className="btn btn-primary ask-opts__ok" type="button" onClick={() => onPick(selected)}>
        {confirmLabel}
      </button>
    </ReaderSheet>
  );
}
