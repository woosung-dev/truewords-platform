// 앱 안에서 뒤로 갈 기록이 있는지 — 앱바 ←·✕ 를 "들어온 곳으로" 돌릴 때 앱 밖(다른 사이트·빈 탭)으로 나가지 않게 한다.
// 지금 기록의 **위치**로 판단한다. history.length 는 뒤로 가도 줄지 않아, 주소로 바로 연 화면에서 앞으로 갔다 돌아오면
// 첫 화면인데도 "뒤가 있다"로 잘못 본다.
//  - Navigation API 가 있으면 `navigation.canGoBack`(같은 출처 기록만 센다)을 쓴다.
//  - 없는 브라우저는 첫 문서 로드 때의 history.length 보다 길어졌는지로 어림한다 `[가정]` — 이때는 위 오판이 남는다.
const initialLength = typeof window === "undefined" ? 0 : window.history.length;

export function canGoBackInApp(): boolean {
  try {
    if ("navigation" in window && window.navigation) return window.navigation.canGoBack;
    return window.history.length > initialLength;
  } catch {
    return false;
  }
}
