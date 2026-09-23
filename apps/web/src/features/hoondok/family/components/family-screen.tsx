"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  FAMILY_MEMBERS,
  type FamilyPerson,
  FRIENDS,
  FRIENDS_TODAY_LABEL,
  SCOPE_ROWS,
} from "@/features/hoondok/preview/fixtures/family";
// SCR-PWA-016 가족·친구 (PLAN-HD-002 W3-F) — 프리뷰 셸. 마크업·문구의 원본은 프로토타입 app.html
// data-screen="family" 이고, 연결·초대·공개 범위 저장은 이번 범위가 아니라 네트워크 요청을 하나도 보내지 않는다.
// 초대·추가 버튼은 형태만 두고 왜 눌러도 진행되지 않는지는 색이 아니라 글자가 말한다 (DES-PWA-003 §3.3).
// 사람별 완료/미완료 배지는 두지 않는다 — 읽은 사람 수만 요약한다 (DEC-PWA-023).
import { PreviewUnavailable } from "@/features/hoondok/preview/unavailable";

const PREVIEW_NOTICE = "미리보기 예시 데이터입니다";
const FOOT_NOTICE = "연결은 양쪽이 동의할 때만 만들어지고, 언제든 끊을 수 있어요.";

type PendingAction = { title: string; note: string; soon: string };

/** 이름 첫 글자 아바타. 프로토타입의 사진은 외부 요청이라 정원 프로필(.gd-profile__av)과 같은 이니셜로 바꿨다 */
function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? "";
}

function PersonRow({ person, isLarge }: { person: FamilyPerson; isLarge: boolean }) {
  return (
    <li className="fm-item">
      <span className={isLarge ? "fm-item__av fm-item__av--lg" : "fm-item__av"} aria-hidden="true">
        {initialOf(person.name)}
      </span>
      <span className="fm-item__bd">
        <b className="fm-item__t">{person.name}</b>
        <span className="fm-item__m">{person.meta}</span>
      </span>
    </li>
  );
}

function PeopleSection({
  title,
  meta,
  people,
  action,
  isLarge,
}: {
  title: string;
  meta: string;
  people: readonly FamilyPerson[];
  action: PendingAction;
  isLarge: boolean;
}) {
  const [isSoonShown, setIsSoonShown] = useState(false);
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">{title}</h2>
        <span className="sect__meta">{meta}</span>
      </div>
      <ul className="fm-list">
        {people.map((person) => (
          <PersonRow key={person.id} person={person} isLarge={isLarge} />
        ))}
        <li>
          <button className="fm-item fm-item--action" type="button" onClick={() => setIsSoonShown(true)}>
            <span className={isLarge ? "fm-item__av fm-item__av--lg fm-add" : "fm-item__av fm-add"} aria-hidden="true">
              <Plus size={20} />
            </span>
            <span className="fm-item__bd">
              <b className="fm-item__t">{action.title}</b>
              <span className="fm-item__m">{action.note}</span>
            </span>
          </button>
        </li>
      </ul>
      {isSoonShown && (
        <PreviewUnavailable
          title={action.soon}
          reason="가족·친구 연결 운영 방식이 정해지지 않아 초대를 보내지 않았어요."
          href="/hoondok/garden"
          linkLabel="나의 정원으로 돌아가기"
        />
      )}
    </div>
  );
}

/** 공개 범위 — 선택만 바뀌고 저장하지 않는다. 노트와 질문은 컨트롤 없이 "항상 비공개" 다 (REQ-PWA-015) */
function ScopeSection() {
  const [scope, setScope] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SCOPE_ROWS.filter((row) => !row.fixedNote).map((row) => [row.id, row.isOn === true])),
  );
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">내가 보여주는 범위</h2>
      </div>
      <fieldset className="card fm-scope">
        <legend className="st-lead">가족과 친구에게 어디까지 보일지 정해요.</legend>
        {SCOPE_ROWS.map((row) => (
          <div className="fm-scope__row" key={row.id}>
            <span className="fm-scope__k">{row.label}</span>
            {row.fixedNote ? (
              <span className="fm-scope__fixed">{row.fixedNote}</span>
            ) : (
              <button
                className="toggle"
                type="button"
                aria-pressed={scope[row.id] === true}
                aria-label={`${row.label} 공개`}
                onClick={() => setScope((prev) => ({ ...prev, [row.id]: prev[row.id] !== true }))}
              />
            )}
          </div>
        ))}
      </fieldset>
      <p className="st-row__soon fm-soon">저장은 준비 중이에요 — 지금은 선택만 바뀝니다</p>
    </div>
  );
}

export function FamilyScreen() {
  return (
    <section className="col">
      <p className="notice">{PREVIEW_NOTICE}</p>

      <PeopleSection
        title="우리 가족"
        meta="양쪽이 동의해야 연결돼요"
        people={FAMILY_MEMBERS}
        isLarge
        action={{
          title: "가족 초대하기",
          note: "초대 링크 또는 코드 · 보상 없음",
          soon: "가족 초대는 준비 중이에요",
        }}
      />

      <PeopleSection
        title="친구"
        meta={FRIENDS_TODAY_LABEL}
        people={FRIENDS}
        isLarge={false}
        action={{
          title: "친구 추가하기",
          note: "초대 링크로 연결해요 · 순위 없음",
          soon: "친구 추가는 준비 중이에요",
        }}
      />

      <ScopeSection />

      <p className="notice">{FOOT_NOTICE}</p>
      <Link className="btn btn-line" href="/hoondok/garden">
        나의 정원으로 돌아가기
      </Link>
    </section>
  );
}
