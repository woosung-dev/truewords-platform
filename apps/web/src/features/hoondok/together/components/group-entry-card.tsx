// 모임이 없을 때의 진입 카드 (PLAN-HD-010 §6 홈, 프로토타입 today `?together=none` 의 `.card.tg-entry`).
// 비로그인(또는 세션 만료 401)이면 두 버튼 모두 온보딩을 거쳐 원래 목적지로 돌아온다(returnTo).
import { House } from "lucide-react";
import Link from "next/link";
import { onboardingHref } from "@/features/identity/gate";
import { JOIN_PATH } from "../invite-code";

const CREATE_PATH = "/hoondok/groups/new";

export function GroupEntryCard({ isLoggedIn }: { isLoggedIn: boolean }) {
  const to = (target: string) => (isLoggedIn ? target : onboardingHref(target));
  return (
    <div className="card tg-entry">
      <b>훈독 모임에서 함께 읽어요</b>
      <span>리더가 모임을 만들고 초대 코드를 보내요. 모임 안에서는 오늘 읽은 사람과 한 줄 나눔만 보여요.</span>
      <div className="tg-join">
        <Link className="btn btn-primary btn--sm" href={to(CREATE_PATH)}>
          모임 만들기
        </Link>
        <Link className="btn btn-line btn--sm" href={to(JOIN_PATH)}>
          초대 코드로 참여
        </Link>
      </div>
      <p className="tg-soon">
        <House size={16} aria-hidden="true" />
        가족 모임은 곧 열려요
      </p>
    </div>
  );
}
