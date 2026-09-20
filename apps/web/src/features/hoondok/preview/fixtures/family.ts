// 016 가족·친구 프리뷰 fixture (PLAN-HD-002 W3-F). 서버·저장소가 없는 표시용 예시 데이터이며
// 문구의 원본은 프로토타입 app.html 의 data-screen="family" 다.
// 실제 교회 이름(분당·영통·용인)은 지우고 "우리 교회"·"이웃 교회"로 바꿨다 — 프리뷰에 실교회명을 두지 않는다.

export type FamilyPerson = {
  id: string;
  /** 예시 이름. 실명을 두지 않는다 */
  name: string;
  /** 관계와 보여주는 범위. 색이 아니라 글자로 밝힌다 (DES-PWA-003 §3.3) */
  meta: string;
  /** 오늘 훈독 여부 — 표시만 한다 */
  isDoneToday: boolean;
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
  { id: "spouse", name: "재민", meta: "배우자 · 보여주기: 오늘 완료 여부", isDoneToday: false },
  { id: "child", name: "하늘 (12)", meta: "자녀 · 보호자 연결 · 보여주기: 완료 여부와 정성", isDoneToday: true },
  { id: "parent", name: "어머니", meta: "부모 · 보여주기: 오늘 완료 여부", isDoneToday: false },
];

export const FRIENDS: readonly FamilyPerson[] = [
  { id: "friend-1", name: "수아", meta: "우리 교회 · 21일 정성 함께 중", isDoneToday: true },
  { id: "friend-2", name: "민재", meta: "우리 교회", isDoneToday: false },
  { id: "friend-3", name: "지훈", meta: "우리 교회 청년부", isDoneToday: true },
  { id: "friend-4", name: "예린", meta: "이웃 교회", isDoneToday: true },
];

export const SCOPE_ROWS: readonly ScopeRow[] = [
  { id: "done", label: "오늘 완료 여부", isOn: true },
  { id: "jeongseong", label: "진행 중인 정성 이름", isOn: false },
  { id: "notes", label: "노트와 질문", fixedNote: "항상 비공개" },
];
