// 016 가족·친구 프리뷰 fixture (PLAN-HD-002 W3-F). 서버·저장소가 없는 표시용 예시 데이터이며
// 문구의 원본은 프로토타입 app.html 의 data-screen="family" 다.
// 소속 교회는 받지 않으므로 교회명을 두지 않는다. 사람별 완료/미완료 상태도 두지 않는다 —
// 친구는 오늘 읽은 수만 요약한다 (DEC-PWA-023: 완료자만 보인다).

export type FamilyPerson = {
  id: string;
  /** 예시 이름. 실명을 두지 않는다 */
  name: string;
  /** 관계와 보여주는 범위. 색이 아니라 글자로 밝힌다 (DES-PWA-003 §3.3) */
  meta: string;
};

export type ScopeRow = {
  id: string;
  label: string;
  /** 사용자가 바꿀 수 있는 행의 기본값 */
  isOn?: boolean;
  /** 바꿀 수 없는 행은 컨트롤 대신 글자만 둔다 (REQ-PWA-015 노트·질문은 항상 비공개) */
  fixedNote?: string;
};

export const FAMILY_MEMBERS: readonly FamilyPerson[] = [
  { id: "spouse", name: "재민", meta: "배우자 · 보여주기: 읽은 날" },
  { id: "child", name: "하늘 (12)", meta: "자녀 · 보호자 연결 · 보여주기: 읽은 날과 정성" },
  { id: "parent", name: "어머니", meta: "부모 · 보여주기: 읽은 날" },
];

export const FRIENDS: readonly FamilyPerson[] = [
  { id: "friend-1", name: "수아", meta: "21일 정성 함께 중" },
  { id: "friend-2", name: "민재", meta: "함께 읽는 친구" },
  { id: "friend-3", name: "지훈", meta: "함께 읽는 친구" },
  { id: "friend-4", name: "예린", meta: "함께 읽는 친구" },
];

/** 친구 섹션 머리 요약. 읽은 사람 수만 적고 누가 안 읽었는지는 드러내지 않는다 */
export const FRIENDS_TODAY_LABEL = "오늘 3명이 함께 읽었어요";

export const SCOPE_ROWS: readonly ScopeRow[] = [
  { id: "done", label: "오늘 읽은 날 표시", isOn: true },
  { id: "jeongseong", label: "진행 중인 정성 이름", isOn: false },
  { id: "notes", label: "노트와 질문", fixedNote: "항상 비공개" },
];
