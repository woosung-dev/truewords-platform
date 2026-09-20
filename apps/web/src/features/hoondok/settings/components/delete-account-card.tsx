"use client";

import { ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { isUnauthorized, onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useDeleteMe } from "@/features/identity/use-delete-me";

// 내 데이터 삭제 2단계 (API-HD-011, PLAN-HD-002 §9 계정 삭제 결정).
// 1단계 = 평범한 설정 행, 2단계 = 인라인 확인 카드. 되돌릴 수 없으므로 한 번의 탭으로는 지워지지 않는다.
const SETTINGS_PATH = "/hoondok/settings";
const CONFIRM_TEXT = "정말 지울까요? 훈독 기록·정성·계정 정보를 모두 지워요. 되돌릴 수 없어요";
const FAILURE_TEXT = "지우지 못했어요. 잠시 뒤 다시 시도해 주세요";

export function DeleteAccountCard() {
  const { user, isLoading } = useCurrentUser();
  const router = useRouter();
  const deleteMe = useDeleteMe();
  const [isConfirming, setIsConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 1단계 행이 사라지면 초점이 body 로 떨어진다 — 파괴적이지 않은 쪽(취소)으로 옮긴다.
  useEffect(() => {
    if (isConfirming) cancelRef.current?.focus();
  }, [isConfirming]);

  // 로그인 여부를 아는 순간까지는 아무것도 약속하지 않는다 (안내 → 행으로 튀는 깜빡임 방지).
  if (isLoading) return null;

  if (!user) {
    return (
      <p className="hint">
        <span>로그인하면 내 데이터를 관리할 수 있어요</span>
        <Link href={onboardingHref(SETTINGS_PATH)}>로그인 →</Link>
      </p>
    );
  }

  if (!isConfirming) {
    return (
      <div className="st-group st-group--danger">
        <button className="st-row st-row--link" type="button" onClick={() => setIsConfirming(true)}>
          <span className="st-row__bd">
            <b className="st-row__t">내 데이터 삭제</b>
            <span className="st-row__d">질문과 노트, 기록을 모두 지워요</span>
          </span>
          <span className="st-go" aria-hidden="true">
            <ChevronRight size={20} />
          </span>
        </button>
      </div>
    );
  }

  function handleDelete() {
    deleteMe.mutate(undefined, {
      // 캐시·localStorage 정리는 훅이 끝냈다. 화면 이동만 여기서 한다.
      onSuccess: () => router.replace("/hoondok"),
      // 쿠키가 이미 만료됐으면 지울 자격부터 다시 받아야 한다.
      onError: (error) => {
        if (isUnauthorized(error)) router.push(onboardingHref(SETTINGS_PATH));
      },
    });
  }

  return (
    <div className="card st-danger" role="group" aria-label="내 데이터 삭제 확인">
      <p className="st-danger__lead">
        <span className="st-danger__ic" aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <span>{CONFIRM_TEXT}</span>
      </p>
      <div className="st-danger__cta">
        <HoondokButton isSmall onClick={handleDelete} disabled={deleteMe.isPending}>
          {deleteMe.isPending ? "지우는 중…" : "지우기"}
        </HoondokButton>
        <HoondokButton
          variant="ghost"
          isSmall
          ref={cancelRef}
          onClick={() => setIsConfirming(false)}
          disabled={deleteMe.isPending}
        >
          취소
        </HoondokButton>
      </div>
      {deleteMe.isError && !isUnauthorized(deleteMe.error) && (
        <p className="hint" role="alert">
          <span>{FAILURE_TEXT}</span>
        </p>
      )}
    </div>
  );
}
