// 가정예배 프리뷰 fixture (PLAN-HD-002 W3-W · SCR-PWA-010~013).
// `DEC-PWA-020`(순서지 편성 주체)·`DEC-PWA-021`(설교 섭외 운영 주체)가 미결이라 이 화면들은 셸만 만들고
// 값은 전부 여기 고정 데이터에서 온다 — 서버 호출도, 저장도 없다.
//
// 문장·순서·수치는 프로토타입 app.html 의 `data-screen="worship|challenge|sermons|sermon-request"` 를 그대로 옮겼고
// **사람 이름과 교회 이름만 익명 자리표시로 바꿨다**(실명·실교회는 프리뷰에 두지 않는다, W3 공통 규칙).
// `DEC-PWA-019` 에 따라 순위·점수·달란트·보상 배지는 어떤 필드로도 두지 않는다 — 진행률과 참여 인원뿐이다.

import type { AuthorityGrade } from "@/features/hoondok/today";

/* ------------------------------------------------------------------ 010 순서지 */

export type WorshipOrderStep = {
  /** 순서 번호. `<ol>` 마커가 순서를 전달하고 이 값은 원형 배지(aria-hidden)용이다 */
  no: number;
  /** 구분 — "말씀 · 천성경 1편 3장" 처럼 단계의 종류 */
  kind: string;
  title: string;
  /** 보조 설명. 없는 단계도 있다 */
  note?: string;
};

export type WorshipOrder = {
  eyebrow: string;
  headline: string;
  meta: string;
  source: { speaker: string; work: string; grade: AuthorityGrade };
  steps: readonly WorshipOrderStep[];
  /** 공유 범위 고지 (AC-019-02) */
  shareHelp: string;
};

export const WORSHIP_ORDER: WorshipOrder = {
  eyebrow: "이번 주 가정예배 · 9월 13일 일요일 저녁",
  headline: "우리 집 순서지가 준비됐어요",
  meta: "6단계 · 약 20분",
  source: { speaker: "참아버님", work: "천성경 제1편 3장", grade: "O1" },
  steps: [
    { no: 1, kind: "경배", title: "하늘부모님과 참부모님께 경배" },
    {
      no: 2,
      kind: "찬양",
      title: "성가 1곡 · 가족이 고른 곡",
      note: "지난주엔 막내가 골랐어요. 이번 주는 둘째 차례.",
    },
    {
      no: 3,
      kind: "말씀 · 천성경 1편 3장",
      title: "참사랑은 직단거리를 갑니다",
      note: "돌아가며 한 단락씩 읽어요. 약 4분.",
    },
    {
      no: 4,
      kind: "나눔 질문",
      title: "이번 주 우리 집에서 “곧게 사랑한” 순간은?",
      note: "아이에게는: 누구를 제일 먼저 도와주고 싶었어?",
    },
    { no: 5, kind: "기도", title: "막내 새 학기 · 할머니 건강 · 우리 교회 40일 정성" },
    { no: 6, kind: "마무리", title: "축도와 저녁 식사" },
  ],
  shareHelp: "가족 4명에게만 보내요. 외부 링크는 만들지 않아요.",
};

/* ----------------------------------------------------- 010 목록 · 011 챌린지 상세 */

export type ChallengeMember = {
  id: string;
  name: string;
  /** "오전 6:12 완료" · "아직이에요" — 미완료를 부정적으로 적지 않는다 (RSK-PWA-009) */
  note: string;
  isDone: boolean;
};

/** 달력 한 칸. `rest` 는 주 1회 쉼(면제)이고 `todo` 는 아직 오지 않은 날이다 */
export type ChallengeDayState = "done" | "rest" | "today" | "todo";

export type ChallengeDay = { day: number; state: ChallengeDayState };

export type ChallengeCalendar = {
  title: string;
  monthLabel: string;
  /** 1일 앞 빈 칸 수 (월요일 시작 7열 그리드) */
  leadingBlanks: number;
  days: readonly ChallengeDay[];
};

export type PreviewChallenge = {
  id: string;
  title: string;
  /** D-day 또는 "모집 중". `tone` 은 badge 변형이며 순위·등급과 무관하다 */
  badge: { label: string; tone: "accent" | "plain" | "line" };
  /** 상세 히어로 부제 */
  summary: string;
  /** 모집 중이면 null — 진행 바 없이 시작일·예정 인원만 보인다 (DES §2.5) */
  progress: { done: number; total: number; percent: number; remainLabel: string } | null;
  /** 목록 카드 하단 왼쪽 문장 */
  cardFoot: string;
  participantLabel: string;
  /** 개설자·구성 한 줄. 이름 대신 관계로 적는다 */
  opener: string;
  todayLabel: string;
  members: readonly ChallengeMember[];
  /** 사전 정의 문구만. 자유 입력창을 두지 않는다 (AC-020-03) */
  cheers: readonly string[];
  calendar: ChallengeCalendar | null;
  /** 화면 맨 아래 고지 */
  notice: string;
};

export const PREVIEW_CHALLENGES: readonly PreviewChallenge[] = [
  {
    id: "family-21",
    title: "우리 가족 21일 훈독",
    badge: { label: "D-9", tone: "accent" },
    summary: "9월 1일 ~ 9월 21일 · 매일 훈독하기 1회 · 가족 챌린지",
    progress: { done: 13, total: 21, percent: 62, remainLabel: "D-9" },
    cardFoot: "13 / 21일 · 62%",
    participantLabel: "4명 참여",
    opener: "개설 우리 가족 · 가족 4명",
    todayLabel: "9월 10일",
    members: [
      { id: "me", name: "나", note: "오전 6:12 완료", isDone: true },
      { id: "spouse", name: "배우자", note: "아직이에요", isDone: false },
      { id: "child", name: "아이 (12세)", note: "오전 7:40 완료 · 보호자 연결", isDone: true },
      { id: "mother", name: "어머니", note: "아직이에요 · 저녁에 읽으세요", isDone: false },
    ],
    cheers: ["오늘도 함께 읽어요", "천천히 해도 괜찮아요", "저녁 예배 때 나눠요"],
    calendar: {
      title: "지난 13일",
      monthLabel: "9월",
      leadingBlanks: 1,
      days: [
        { day: 1, state: "done" },
        { day: 2, state: "done" },
        { day: 3, state: "done" },
        { day: 4, state: "done" },
        { day: 5, state: "rest" },
        { day: 6, state: "done" },
        { day: 7, state: "done" },
        { day: 8, state: "done" },
        { day: 9, state: "done" },
        { day: 10, state: "today" },
        { day: 11, state: "todo" },
        { day: 12, state: "todo" },
        { day: 13, state: "todo" },
      ],
    },
    notice: "가족끼리만 보이는 기록입니다. 순위도 점수도 매기지 않습니다",
  },
  {
    id: "church-40",
    title: "우리 교회 40일 정성",
    badge: { label: "D-23", tone: "plain" },
    summary: "8월 25일 ~ 10월 3일 · 매일 훈독하기 1회 · 교회 챌린지",
    progress: { done: 17, total: 40, percent: 42, remainLabel: "D-23" },
    cardFoot: "17 / 40일 · 42% · 오늘 71명 완료",
    participantLabel: "87명 참여",
    opener: "개설 우리 교회 · 87명 참여",
    todayLabel: "9월 10일",
    members: [
      { id: "me", name: "나", note: "오전 6:12 완료", isDone: true },
      { id: "n1", name: "같은 조 식구 A", note: "오전 5:50 완료", isDone: true },
      { id: "n2", name: "같은 조 식구 B", note: "아직이에요", isDone: false },
    ],
    cheers: ["오늘도 함께 읽어요", "천천히 해도 괜찮아요", "주일에 만나요"],
    calendar: null,
    notice: "교회 챌린지도 진행률과 참여 인원만 보여 줍니다. 개인 순위는 없습니다",
  },
  {
    id: "youth-reading",
    title: "청년부 천성경 1편 함께 읽기",
    badge: { label: "모집 중", tone: "line" },
    summary: "9월 15일 시작 · 매일 훈독하기 1회 · 청년부 챌린지",
    progress: null,
    cardFoot: "9월 15일 시작 · 12명 참여 예정 · 청년부장 A",
    participantLabel: "12명 참여 예정",
    opener: "개설 청년부장 A · 12명 참여 예정",
    todayLabel: "9월 10일",
    members: [],
    cheers: [],
    calendar: null,
    notice: "아직 시작하지 않은 챌린지예요. 시작일이 되면 진행률이 생깁니다",
  },
];

export function findPreviewChallenge(id: string): PreviewChallenge | undefined {
  return PREVIEW_CHALLENGES.find((challenge) => challenge.id === id);
}

/* ------------------------------------------------------------------- 012 설교 */

export type PreviewPastor = { id: string; name: string; church: string };

export type PreviewSermon = {
  id: string;
  title: string;
  meta: string;
  duration: string;
};

export type SermonsFixture = {
  /** 세그먼트 2종. 전체 설교 목록은 아직 데이터가 없어 꺼 둔다 */
  segments: readonly { id: string; label: string; isSoon?: boolean }[];
  pastors: readonly PreviewPastor[];
  featured: {
    tag: string;
    title: string;
    meta: string;
    duration: string;
    postedOn: string;
    grade: AuthorityGrade;
  };
  quote: { body: string; source: readonly string[]; grade: AuthorityGrade };
  popular: readonly PreviewSermon[];
  notice: string;
};

export const SERMONS: SermonsFixture = {
  segments: [
    { id: "short", label: "5분 설교" },
    { id: "full", label: "전체 설교", isSoon: true },
  ],
  pastors: [
    { id: "p1", name: "교회장 A", church: "우리 교회" },
    { id: "p2", name: "교회장 B", church: "이웃 교회 1" },
    { id: "p3", name: "청년부장 A", church: "우리 교회 청년부" },
    { id: "p4", name: "교회장 C", church: "이웃 교회 2" },
    { id: "p5", name: "교회장 D", church: "이웃 교회 3" },
  ],
  featured: {
    tag: "새 설교",
    title: "“내가 구한 것, 그 너머의 선물”",
    meta: "교회장 A · 우리 교회 · 천성경 1편 3장",
    duration: "4:52",
    postedOn: "9월 7일 게시",
    grade: "O5",
  },
  quote: {
    body: "“하늘부모님은 우리가 구한 것보다 더 큰 것을 준비해 두셨습니다.”",
    source: ["설교 요약", "우리 교회 게시"],
    grade: "O5",
  },
  popular: [
    {
      id: "s1",
      title: "“땅이 부족한 것이 아니라 믿음이 부족했던 것입니다”",
      meta: "교회장 B · 이웃 교회 1 · 1.1천 명 시청",
      duration: "4:05",
    },
    {
      id: "s2",
      title: "“참사랑은 우회하지 않습니다”",
      meta: "교회장 C · 이웃 교회 2 · 862명 시청",
      duration: "5:31",
    },
    {
      id: "s3",
      title: "“함박눈은 하늘의 축복”",
      meta: "교회장 D · 이웃 교회 3 · 704명 시청",
      duration: "4:29",
    },
    {
      id: "s4",
      title: "“가정은 하늘이 지으신 첫 학교입니다”",
      meta: "청년부장 A · 우리 교회 청년부 · 512명 시청",
      duration: "21:14",
    },
  ],
  notice: "설교는 각 교회가 게시한 지역 콘텐츠(O5)이며 외부 링크로 재생됩니다",
};

/* --------------------------------------------------------------- 013 섭외 폼 */

export type RequestTarget = { id: string; name: string; note: string };
export type RequestKind = { id: string; title: string; note: string };

export const REQUEST_TARGETS: readonly RequestTarget[] = [
  { id: "p1", name: "교회장 A", note: "우리 교회" },
  { id: "p3", name: "청년부장 A", note: "우리 교회 청년부" },
];

export const REQUEST_KINDS: readonly RequestKind[] = [
  { id: "short", title: "5분 설교", note: "짧은 영상 또는 음성" },
  { id: "full", title: "전체 설교", note: "주일 예배 설교" },
];

export const REQUEST_WHEN_OPTIONS: readonly string[] = ["9월 셋째 주", "9월 넷째 주", "10월 중", "상관없음"];

/** 최근 훈독·질문에서 자동으로 채워지는 주제 (DES §3.3.7 중복 입력 줄이기) */
export const REQUEST_TOPIC_DEFAULT = "자녀와 함께 읽는 참사랑";

export const REQUEST_LEDE =
  "교회장께 5분 설교 또는 전체 설교를 요청해요. 요청은 교회장과 운영자에게만 보이고, 응답은 알림함으로 와요.";

export const REQUEST_NOTE =
  "교회장께서 거절하거나 응답하지 않으실 수 있어요. 응답 기한은 없어요. 접수·확정·거절 상태는 알림함으로 알려 드려요.";

export const REQUEST_NOTICE = "요청 내용은 신청자·교회장·운영자에게만 보입니다";

/* ----------------------------------------------------------------- 프리뷰 공통 */

/** 모든 프리뷰 화면 맨 위의 한 줄. 예시 데이터임을 먼저 밝힌다 */
export const PREVIEW_LEAD = "미리보기 예시 데이터입니다";

/** 아직 붙지 않은 동작을 누른 사람에게 돌려주는 문장. 색이 아니라 글자로 알린다 (DES §3.3) */
export const SOON = "준비 중";
