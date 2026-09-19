"use client";

// SCR-PWA-004 정성 기간 시트. 프로토타입과 같은 URL(`?sheet=jeongseong`)이 열림 상태의 원본이라
// 뒤로가기로 닫히고 링크로 다시 열린다. 배경막·포커스 가둠·Esc 는 <dialog>.showModal() 이 맡는다.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, Suspense, useCallback, useEffect, useRef } from "react";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { JeongseongForm } from "./jeongseong-form";

const SHEET_PARAM = "jeongseong";
const HOME = "/hoondok";

/** showModal·close 가 없는 환경(jsdom 29)에서는 open 속성만 세운다 — 마크업·문구 검증은 그대로 돈다. */
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function JeongseongSheetPanel() {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 닫기 = URL 에서 sheet 를 지우는 것 하나. Esc·백드롭·닫기 버튼·성공이 모두 여기로 모인다.
  const close = useCallback(() => router.replace(HOME, { scroll: false }), [router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) openDialog(dialog);
    // 열기 전 포커스를 기억했다가 닫힐 때 돌려준다 (DES-PWA-003 §2.7)
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // <dialog> 는 배경막 영역의 클릭도 자신이 받는다 — 패널 밖일 때만 닫는다
  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) close();
  }

  return (
    <dialog className="sheet" ref={dialogRef} aria-labelledby="js-title" onClose={close} onClick={handleBackdrop}>
      <div className="sheet__panel">
        <div className="sheet__grip" aria-hidden="true" />
        <h2 className="js-title" id="js-title">
          정성 기간 만들기
        </h2>
        <p className="js-lede">
          기간 동안 매일 주제에 맞는 말씀을 골라 드려요. 말씀은 권리가 확인된 정본 안에서만 고르고, AI가 만들지 않아요.
        </p>
        {isLoading || user ? (
          <JeongseongForm onClose={close} />
        ) : (
          <div className="js-cta">
            <p className="js-gate">정성은 기록이 남는 기능이라 로그인이 필요해요.</p>
            <Link className="btn btn-primary" href={onboardingHref(`${HOME}?sheet=${SHEET_PARAM}`)}>
              로그인하고 시작하기
            </Link>
            <button className="btn btn-ghost" type="button" onClick={close}>
              닫기
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}

function JeongseongSheetGate() {
  const isOpen = useSearchParams().get("sheet") === SHEET_PARAM;
  // 닫힌 동안은 마운트하지 않는다 — showModal 은 마운트 직후 한 번만 부르면 된다.
  return isOpen ? <JeongseongSheetPanel /> : null;
}

export function JeongseongSheet() {
  return (
    <Suspense fallback={null}>
      <JeongseongSheetGate />
    </Suspense>
  );
}
