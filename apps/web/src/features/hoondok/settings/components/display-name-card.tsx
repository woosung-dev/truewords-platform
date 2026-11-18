"use client";

import { useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { DisplayNameForm } from "@/features/identity/display-name-form";
import type { HoondokUser } from "@/features/identity/types";
import { useCurrentUser } from "@/features/identity/use-current-user";

// 표시 이름 — 지금 이름을 보이고 "바꾸기"를 누르면 가입 직후 확인 화면과 같은 폼을 펼친다. 로그인 전에는 그리지 않는다.
export function DisplayNameCard() {
  const { user, isLoading } = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  if (isLoading || !user) return null;

  function handleDone(updated: HoondokUser | null) {
    setIsEditing(false);
    setSaved(updated !== null);
  }

  return (
    <div className="st-stack">
      <div className="st-group">
        <div className="st-row">
          <span className="st-row__bd">
            <b className="st-row__t">이름</b>
            <span className="st-row__d">{user.display_name}</span>
          </span>
          {!isEditing && (
            <HoondokButton
              variant="ghost"
              isSmall
              onClick={() => {
                setSaved(false);
                setIsEditing(true);
              }}
              aria-label="이름 바꾸기"
            >
              바꾸기
            </HoondokButton>
          )}
        </div>
      </div>
      {isEditing && (
        <DisplayNameForm
          initialName={user.display_name}
          submitLabel="저장"
          formLabel="이름 바꾸기"
          onDone={handleDone}
          onCancel={() => setIsEditing(false)}
        />
      )}
      {saved && (
        <p className="hint" role="status">
          <span>이름을 바꿨어요</span>
        </p>
      )}
    </div>
  );
}
