import type { AuthorityGrade, ReviewStatus } from "./types";

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
