"use client";

// 나의 정원 "나에게 맞추기" — 관심사와 마음 바꾸기·마음 한 장 진입. 둘 다 이 기기 저장소만 쓰므로 로그인과 상관없이 보인다.
// 책갈피 플래그가 꺼지면 맞춘 카드가 없으므로 그리지 않는다.
import { ChevronRight, PenLine, Sprout } from "lucide-react";
import Link from "next/link";
import { isHoondokCardsEnabled } from "../../flag";
import { interestLabel, moodLabel } from "../options";
import { usePersonalAnswers } from "../use-personal";
import { INTERESTS_PATH } from "./home-bookmark";

/** "가정과 부부 외 1개" — 고른 이름 첫 개와 나머지 개수. */
function answersSummary(names: string[]): string {
  if (names.length === 0) return "아직 고르지 않았어요";
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}개`;
}

export function PersonalGardenEntry() {
  const { answers } = usePersonalAnswers();
  if (!isHoondokCardsEnabled()) return null;
  const names = [...answers.interests.map(interestLabel), ...answers.moods.map(moodLabel)].filter(
    (name): name is string => Boolean(name),
  );
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">나에게 맞추기</h2>
      </div>
      <div className="card ps-list">
        <Link className="ps-list__row" href={INTERESTS_PATH}>
          <Sprout size={22} aria-hidden="true" />
          <span className="fm-entry__bd">
            <b>관심사와 마음</b>
            <span>{answersSummary(names)}</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
        <Link className="ps-list__row" href="/hoondok/pray">
          <PenLine size={22} aria-hidden="true" />
          <span className="fm-entry__bd">
            <b>마음 한 장</b>
            <span>지금 마음에 맞는 말씀 한 장 · 한 줄은 이 기기에만</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
