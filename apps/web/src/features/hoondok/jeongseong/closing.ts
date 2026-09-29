// 마무리 카드 닫힘 기록. 기간 id 마다 한 키이고 이 기기에만 남는다 — 로그아웃·계정 삭제로 `hoondok:` 키가 지워지면
// 서버가 last_ended 를 주는 동안(끝난 뒤 7일) 다시 보일 수 있다(수용). 저장소는 없거나 던질 수 있으므로 전부 try/catch.
const PREFIX = "hoondok:jeongseong-closed:";

export function isClosingDismissed(periodId: string): boolean {
  try {
    return window.localStorage.getItem(`${PREFIX}${periodId}`) === "1";
  } catch {
    // 읽지 못하면 닫지 않은 것으로 본다 — 카드가 한 번 더 보일 뿐이다
    return false;
  }
}

export function dismissClosing(periodId: string): void {
  try {
    window.localStorage.setItem(`${PREFIX}${periodId}`, "1");
  } catch {
    // 저장 실패해도 화면은 호출자 상태로 닫힌다
  }
}
