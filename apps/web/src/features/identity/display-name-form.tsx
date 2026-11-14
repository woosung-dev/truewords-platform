"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { AlertCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { identityAPI } from "./api";
import type { HoondokUser } from "./types";
import { CURRENT_USER_KEY } from "./use-current-user";

// 표시 이름 입력 폼 — 가입 직후 확인 화면(/onboarding/name)과 설정의 "이름" 항목이 함께 쓴다.
// 길이 규칙(앞뒤 공백 제거 후 1~64자)은 서버가 최종 검사하고, 여기서는 빈 값만 미리 막는다.
export const DISPLAY_NAME_MAX = 64;

function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return `이름은 1~${DISPLAY_NAME_MAX}자로 입력해 주세요`;
    if (error.status === 401) return "로그인이 풀렸어요. 다시 로그인한 뒤 바꿔 주세요";
  }
  return "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
}

type DisplayNameFormProps = {
  /** 입력란을 미리 채울 현재 이름 */
  initialName: string;
  submitLabel: string;
  /** 폼의 접근 가능한 이름 */
  formLabel: string;
  help?: string;
  /** 저장이 끝나면 부른다. 이름이 그대로라 API 를 부르지 않았으면 user 는 null 이다 */
  onDone: (user: HoondokUser | null) => void;
  /** 있으면 취소 버튼을 그린다(설정 화면) */
  onCancel?: () => void;
};

export function DisplayNameForm({ initialName, submitLabel, formLabel, help, onDone, onCancel }: DisplayNameFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState("");
  const helpId = useId();

  const save = useMutation({
    mutationFn: (displayName: string) => identityAPI.updateProfile(displayName),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(CURRENT_USER_KEY, user);
      onDone(user);
    },
    // 실패해도 입력값은 state 에 그대로 남겨 다시 낼 수 있게 한다
    onError: (error) => setMessage(saveErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("이름을 입력해 주세요");
      return;
    }
    // 바꾸지 않았으면 서버를 부르지 않는다
    if (trimmed === initialName.trim()) {
      onDone(null);
      return;
    }
    save.mutate(trimmed);
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label={formLabel} noValidate>
      <label className="field">
        <span className="field__label">이름</span>
        <input
          name="display_name"
          type="text"
          autoComplete="nickname"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={name}
          aria-describedby={help ? helpId : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
      {message && (
        // 오류는 색만으로 알리지 않는다 — 아이콘 + 문장
        <p className="hint hint--alert" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {message}
        </p>
      )}
      <div className="onb-cta">
        <HoondokButton type="submit" isLoading={save.isPending}>
          {submitLabel}
        </HoondokButton>
        {onCancel && (
          <HoondokButton variant="ghost" onClick={onCancel} disabled={save.isPending}>
            취소
          </HoondokButton>
        )}
      </div>
    </form>
  );
}
