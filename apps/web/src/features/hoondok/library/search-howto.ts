// SCR-PWA-008 검색 진입 안내 칩 (PLAN-HD-002 W3-L).
// 서버로 가지 않는 고정 예시 값이며, 문장의 원본은 프로토타입 app.html 의 data-screen="search" 블록이다.

/** 검색 진입 안내 칩 (프로토타입 `.howto`). 프로토타입의 "목차"(천성경 1편 등)는 본문 검색으로 목차에 가지 않아 뺐다 — 목차는 서고에서 연다. */
export const SEARCH_HOWTO: readonly { key: string; chips: readonly string[] }[] = [
  { key: "단어", chips: ["탕감복귀", "정성", "축복"] },
  { key: "구절", chips: ['"참사랑은 직단거리를 갑니다"'] },
  { key: "상황", chips: ["자녀와 갈등이 있을 때", "새벽에 일어나기 힘들 때"] },
];
