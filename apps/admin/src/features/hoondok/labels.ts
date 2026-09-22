import type { AuthorityGrade, ContentRight, ReviewStatus } from "./types";

// 화면 문구 — web `authority-badge.tsx` 와 같은 뜻(DES-PWA-003 §2.3)이지만 앱 간 import 금지라 admin 이 따로 둔다.
// 등급은 항상 "숫자 + 한국어 라벨"로 보여 O1/O2, O3~O5 를 구분한다. R 은 숫자가 없다.
export const GRADE_LABEL: Record<AuthorityGrade, string> = {
  O1: "O1 공식 원문",
  O2: "O2 공식 편집",
  O3: "O3 공식 해설",
  O4: "O4 교회 자료",
  O5: "O5 지역 콘텐츠",
  R: "권리 확인 중",
};

// unverified 는 web 카드에 "확인되지 않음" 배지로 보이고, withdrawn 은 그날 본문을 내리지 않는다(AC-016-04).
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  reviewed: "검수 완료",
  unverified: "확인되지 않음",
  withdrawn: "철회",
};

// 권리 원장 승인 상태. 개별 폼·시리즈 요약·일괄 다이얼로그가 같은 문구를 쓴다.
export const STATUS_LABEL: Record<NonNullable<ContentRight["status"]>, string> = {
  pending: "확인 대기",
  allowed: "허용",
  withdrawn: "철회",
};

// 저작물 총서 키 → 표시 제목. 서버(`library_series`)가 title 을 주므로 화면은 그 값을 쓰고,
// 목록처럼 title 이 없는 곳에서만 이 표를 폴백으로 쓴다.
export const SERIES_TITLE: Record<string, string> = {
  father_anthology: "문선명선생 말씀선집",
  cheonseong_gyeong: "천성경",
  pyeonghwa_gyeong: "평화경",
  wonri_gangron: "원리강론",
  tongil_thought: "통일사상요강",
  chambumo_autobiography: "평화를 사랑하는 세계인으로",
};

// 후보 검색 필터용 코퍼스 출처(API-HD-012 `sources`). backend candidates.py 의 SOURCE_LABELS 와 같은 값이며
// 앱 간 import 금지 관례상 admin 이 따로 둔다. 서버가 키를 늘리면 여기도 늘린다.
export const SOURCE_LABEL: Record<string, string> = {
  L: "원리강론",
  M: "3대 경전",
  N: "자서전",
  O: "말씀선집",
  B: "어머님 말씀",
  P: "참부모론",
  Q: "통일사상요강",
};

export const SOURCE_KEYS = Object.keys(SOURCE_LABEL);
