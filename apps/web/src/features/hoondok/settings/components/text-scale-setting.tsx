"use client";

// 말씀 글자 크기 4단계 (설정 "그 밖의 설정"). 리더 바에는 두지 않는다(DES §8 2026-09-29 "설정은 리더 바에서 뺐다").
// 네이티브 라디오를 라벨로 감싼다 — 화살표 키·묶음 이름은 브라우저가 맡고 모양만 settings.css 가 입힌다.
import { useSyncExternalStore } from "react";
import { readTextScale, subscribeTextScale, TEXT_SCALES, type TextScaleId, writeTextScale } from "../text-scale";

const PREVIEW = "참사랑은 직단거리를 갑니다.";

export function TextScaleSetting() {
  // 서버 스냅샷은 "보통" — hydration 뒤 저장값으로 다시 그린다
  const current = useSyncExternalStore(subscribeTextScale, readTextScale, () => "normal" as TextScaleId);
  return (
    <fieldset className="st-group st-scale">
      <legend className="st-scale__q">말씀 글자 크기</legend>
      <p className="st-row__d">원문·훈독하기·AI 답 본문에 적용돼요. 이 기기에만 저장돼요.</p>
      <div className="st-scale__opts">
        {TEXT_SCALES.map((option) => (
          <label key={option.id} className="st-scale__opt" data-on={current === option.id ? "" : undefined}>
            <input
              type="radio"
              name="hoondok-text-scale"
              value={option.id}
              checked={current === option.id}
              onChange={() => writeTextScale(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {/* 미리보기 — 훈독 루트의 --read-scale 을 그대로 받아 고른 크기로 보인다 */}
      <p className="st-scale__preview" aria-hidden="true">
        {PREVIEW}
      </p>
    </fieldset>
  );
}
