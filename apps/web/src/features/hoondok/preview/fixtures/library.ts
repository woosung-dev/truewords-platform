// SCR-PWA-007·008·009 말씀 프리뷰 fixture (PLAN-HD-002 W3-L).
// 권리 원장·Qdrant payload 확장·코퍼스 재적재 전이라 실데이터가 없다(§1.3). 화면 셸을 보기 위한 예시 값이며
// 서버로 가지 않고 이 파일에만 있다. 문장·수치의 원본은 프로토타입 app.html 의
// data-screen="library"·"search"·"words" 세 블록이고, 실명·실교회명은 두지 않는다.
//
// 원문 문서가 하나뿐인 이유: 앱바 제목은 screens.ts 가 `/hoondok/words` → "천성경 1편 3장" 으로 고정한다.
// 문서를 늘리려면 제목이 동적이어야 하므로(W0-W 소유 파일) 이번 웨이브는 프로토타입과 같은 한 편만 둔다.

import type { AuthorityGrade } from "../../today";

/** 저작물 한 줄 (프로토타입 `.shelf__item`). `wordId` 가 없으면 읽을 원문이 아직 없어 링크가 아니다. */
export type PreviewWork = {
  id: string;
  title: string;
  meta: string;
  grade: AuthorityGrade;
  wordId: string | null;
};

/** 원문 한 단락. `highlight` 는 형광펜 예시(표시만) — 저장·토글하지 않는다. */
export type PreviewVerse = {
  no: number;
  segments: readonly { text: string; highlight?: "hl-1" | "hl-2" | "hl-3" }[];
};

/** 원문 문서 (프로토타입 `data-screen="words"`). 목차 레일은 ≥1224px 에서만 보인다. */
export type PreviewWord = {
  id: string;
  /** 본문 위 제호 — 앱바 제목이 고정이라 문서 이름은 여기서 한 번 더 말한다 */
  title: string;
  /** 출처 줄 조각 (화자 · 판본). 저작물명은 목차 레일 제목이 말한다 */
  source: readonly string[];
  grade: AuthorityGrade;
  tocTitle: string;
  toc: readonly { label: string; isCurrent?: boolean }[];
  verses: readonly PreviewVerse[];
};

/** 검색 예시 결과 한 줄. `keywords` 는 예시 필터용이며 실제 검색 색인이 아니다. */
export type PreviewSearchResult = {
  id: string;
  title: string;
  source: string;
  snippet: string;
  grade: AuthorityGrade;
  wordId: string;
  keywords: readonly string[];
};

export const PREVIEW_WORD_ID = "cheonseonggyeong-1-3";

export const PREVIEW_WORDS: Readonly<Record<string, PreviewWord>> = {
  [PREVIEW_WORD_ID]: {
    id: PREVIEW_WORD_ID,
    title: "천성경 제1편 3장",
    source: ["참아버님", "2013 한국어판"],
    grade: "O1",
    tocTitle: "천성경 제1편",
    toc: [
      { label: "1장 참사랑의 근본" },
      { label: "2장 참사랑의 속성" },
      { label: "3장 참사랑은 직단거리를 갑니다", isCurrent: true },
      { label: "4장 참사랑과 참생명" },
      { label: "5장 참사랑의 완성" },
    ],
    verses: [
      {
        no: 10,
        segments: [
          {
            text: "역사는 남성과 여성을 접촉시켜 나왔습니다. 남자와 여자는 하나의 기점에서 연결되어야 합니다. 그 연결은 ",
          },
          { text: "참부모라는 내용을 중심삼고", highlight: "hl-2" },
          { text: " 되어야 합니다." },
        ],
      },
      {
        no: 11,
        segments: [
          { text: "참사랑은 직단거리를 갑니다.", highlight: "hl-1" },
          {
            text: " 종적인 사랑은 90각도 한 점밖에 없습니다. 91도도 89도도 직단이 아닙니다. 오로지 최단거리는 90각도밖에 없습니다.",
          },
        ],
      },
      {
        no: 12,
        segments: [
          { text: "아들 낳기를 고대하던 부부는 아들을 낳았다고 하더라도 그 아들 낳은 것만 좋아해서는 안 됩니다. " },
          { text: "어떻게 가치 있는 아들로 키우느냐", highlight: "hl-3" },
          { text: " 하는 문제를 놓고 걱정을 해야 합니다." },
        ],
      },
    ],
  },
};

export function findPreviewWord(id: string): PreviewWord | null {
  return PREVIEW_WORDS[id] ?? null;
}

/** 이어 읽기 (프로토타입 `.resume`). */
export const PREVIEW_RESUME = {
  title: "천성경 제1편 3장",
  meta: "12단락까지 읽었어요 · 참아버님 · 2013 한국어판",
  grade: "O1" as AuthorityGrade,
  wordId: PREVIEW_WORD_ID,
  when: "어제",
};

export const PREVIEW_WORKS: readonly PreviewWork[] = [
  { id: "cheonseonggyeong", title: "천성경", meta: "16편 · 2013 한국어판", grade: "O1", wordId: PREVIEW_WORD_ID },
  { id: "malssum-seonjip", title: "말씀선집", meta: "615권 · 원문 준비 중", grade: "O1", wordId: null },
  { id: "true-mother-words", title: "참어머님 말씀 모음", meta: "3권 · 원문 준비 중", grade: "O1", wordId: null },
  { id: "pyeonghwagyeong", title: "평화경", meta: "2013 한국어판", grade: "R", wordId: null },
  { id: "peace-loving", title: "평화를 사랑하는 세계인으로", meta: "자서전", grade: "R", wordId: null },
];

/** 서고 아래 고지 (프로토타입 `.notice`). */
export const PREVIEW_LIBRARY_NOTICE = "권리 확인 중인 저작물은 검색·AI 근거에 쓰이지 않습니다";

/** 검색 진입 안내 칩 (프로토타입 `.howto`). 분류 4가지는 그대로 옮긴다. */
export const PREVIEW_SEARCH_HOWTO: readonly { key: string; chips: readonly string[] }[] = [
  { key: "단어", chips: ["탕감복귀", "정성", "축복"] },
  { key: "구절", chips: ['"참사랑은 직단거리를 갑니다"'] },
  { key: "상황", chips: ["자녀와 갈등이 있을 때", "새벽에 일어나기 힘들 때"] },
  { key: "목차", chips: ["천성경 1편", "말씀선집 200권"] },
];

export const PREVIEW_SEARCH_RESULTS: readonly PreviewSearchResult[] = [
  {
    id: "r-1",
    title: "천성경 제1편 3장",
    source: "참아버님 · 2013 한국어판",
    snippet: "참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다.",
    grade: "O1",
    wordId: PREVIEW_WORD_ID,
    keywords: ["참사랑", "직단거리", "천성경"],
  },
  {
    id: "r-2",
    title: "천성경 제1편 3장",
    source: "참아버님 · 2013 한국어판",
    snippet: "그 연결은 참부모라는 내용을 중심삼고 되어야 합니다.",
    grade: "O1",
    wordId: PREVIEW_WORD_ID,
    keywords: ["참부모", "기점", "천성경"],
  },
  {
    id: "r-3",
    title: "천성경 제1편 3장",
    source: "참아버님 · 2013 한국어판",
    snippet: "어떻게 가치 있는 아들로 키우느냐 하는 문제를 놓고 걱정을 해야 합니다.",
    grade: "O1",
    wordId: PREVIEW_WORD_ID,
    keywords: ["자녀", "정성", "천성경"],
  },
];

/** 예시 결과 고르기 — 실제 검색이 아니라 fixture 부분 문자열 대조다. 빈 질의는 0건으로 본다. */
export function filterPreviewResults(query: string): readonly PreviewSearchResult[] {
  // 구절 칩은 따옴표를 달고 오므로(프로토타입 `"참사랑은 직단거리를 갑니다"`) 대조 전에 떼어 낸다.
  const needle = query.replace(/["“”]/g, "").trim().toLowerCase();
  if (!needle) return [];
  return PREVIEW_SEARCH_RESULTS.filter((result) =>
    [result.title, result.snippet, ...result.keywords].join(" ").toLowerCase().includes(needle),
  );
}
