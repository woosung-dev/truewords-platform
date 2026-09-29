"use client";

import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import type { HoondokUser } from "@/features/identity/types";
import type { useLogout } from "@/features/identity/use-logout";

// 나의 정원 맨 아래 계정 묶음. 어느 계정으로 들어와 있는지 이메일로 보여 주고 로그아웃을 둔다.
// 로그아웃은 서버 기록을 지우지 않으므로 위험 행이 아니다 — 되돌릴 수 없는 "내 데이터 삭제" 는 알림·설치 화면에 따로 있다.
// 한 번 탭으로 끝내지 않고 확인 카드를 거친다: 이 기기에만 있는 기록을 함께 지울지 여기서 고른다.
// 기본은 지우기 — 여럿이 쓰는 기기에서 다음 사람이 앞 사람의 질문을 보지 않게 한다(온보딩 로그아웃과 같은 동작).
const FAILURE_TEXT = "로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요";

type AccountSectionProps = {
  user: HoondokUser;
  /** 화면이 들고 있는 로그아웃 상태. 로그아웃하면 이 묶음이 사라지므로 성공 안내는 화면이 그린다 */
  logout: ReturnType<typeof useLogout>;
};

export function AccountSection({ user, logout }: AccountSectionProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [shouldClearDevice, setShouldClearDevice] = useState(true);
  const cardRef = useRef<HTMLFieldSetElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 로그아웃 행이 사라지면 초점이 body 로 떨어진다 — 아무 일도 일으키지 않는 쪽(취소)으로 옮긴다.
  // 화면 맨 아래라 카드가 하단 탭 뒤로 들어간다. 초점 이동의 자동 스크롤은 버튼만 겨우 보이게 하므로
  // 카드 전체를 먼저 올리고(탭 높이는 CSS scroll-margin) 초점은 스크롤 없이 옮긴다.
  useEffect(() => {
    if (!isConfirming) return;
    cardRef.current?.scrollIntoView({ block: "nearest" });
    cancelRef.current?.focus({ preventScroll: true });
  }, [isConfirming]);

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">계정</h2>
      </div>
      {isConfirming ? (
        <fieldset className="card gd-logout" aria-label="로그아웃 확인" ref={cardRef}>
          <p className="st-danger__lead">
            <span className="st-danger__ic" aria-hidden="true">
              <LogOut size={20} />
            </span>
            <span>
              <b className="gd-logout__t">로그아웃할까요?</b>
              계정에 저장된 기록은 그대로 남아요. 다시 로그인하면 이어서 볼 수 있어요.
            </span>
          </p>
          <label className="gd-logout__opt">
            <input
              type="checkbox"
              checked={shouldClearDevice}
              onChange={(event) => setShouldClearDevice(event.target.checked)}
              disabled={logout.isPending}
            />
            <span>
              <b className="gd-logout__t">이 기기에 남은 기록도 지우기</b>
              <span className="gd-logout__d">
                AI 질문 기록·오늘의 한 줄·읽던 자리는 이 기기에만 있어요. 여럿이 쓰는 기기라면 켜 두세요.
              </span>
            </span>
          </label>
          <div className="st-danger__cta">
            <HoondokButton
              isSmall
              onClick={() => logout.mutate({ clearDevice: shouldClearDevice })}
              isLoading={logout.isPending}
            >
              {logout.isPending ? "로그아웃 중…" : "로그아웃"}
            </HoondokButton>
            <HoondokButton
              variant="ghost"
              isSmall
              ref={cancelRef}
              onClick={() => {
                logout.reset();
                setIsConfirming(false);
              }}
              disabled={logout.isPending}
            >
              취소
            </HoondokButton>
          </div>
          {logout.isError && (
            <p className="hint" role="alert">
              <span>{FAILURE_TEXT}</span>
            </p>
          )}
        </fieldset>
      ) : (
        <div className="st-group">
          <div className="st-row">
            <span className="st-row__bd">
              <b className="st-row__t gd-account__email">{user.email}</b>
              <span className="st-row__d">이 계정으로 로그인돼 있어요</span>
            </span>
          </div>
          <button className="st-row st-row--link" type="button" onClick={() => setIsConfirming(true)}>
            <span className="st-row__bd">
              <b className="st-row__t">로그아웃</b>
            </span>
            <span className="st-go" aria-hidden="true">
              <LogOut size={20} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
