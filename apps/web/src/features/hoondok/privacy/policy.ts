// 개인정보 처리방침(/privacy)의 바뀔 수 있는 값. 구글 OAuth 동의 화면의 "개인정보처리방침 링크"가 이 화면을 가리킨다.
// 본문은 실제 코드 동작(저장 테이블·계정 삭제 범위·기기 저장소·백업 보관)과 맞춰 쓴다. 저장 항목·외부 서비스·보관 기간이
// 바뀌면 이 파일과 화면 본문을 함께 고치고 시행일을 올린다. 법적 운영 주체는 아직 정해지지 않았다(docs/TODO.md) — 정해지면 바꾼다.

/** 화면에 보이는 시행일. 내용을 바꾸면 새 날짜로 올리고 PRIVACY_HISTORY 에 이전 날짜를 남긴다. */
export const PRIVACY_EFFECTIVE_DATE = "2026년 11월 19일";

/** 처리방침 버전. 문구·형식만 바꿔도 올린다. */
export const PRIVACY_VERSION = "1.0";

/** 이전 시행일 (최신이 앞). 첫 판이라 비어 있다. */
export const PRIVACY_HISTORY: readonly string[] = [];

/**
 * 개인정보 문의·열람·삭제 요청을 받는 곳. 개인정보 보호법 제30조 제1항 제6호는 "보호책임자의 성명 또는
 * 고충 처리 부서의 명칭과 연락처"를 요구하므로 개인 이름 대신 부서 이름과 실제로 답하는 연락처를 쓴다.
 */
// privacy@woosung.dev 는 Cloudflare Email Routing 으로 운영자 메일함에 전달된다(woosung.dev MX)
export const PRIVACY_CONTACT = {
  department: "훈독 운영팀",
  email: "privacy@woosung.dev",
} as const;

/** 처리를 맡기거나 해외로 옮겨 보관하는 곳 (개인정보 보호법 제26조 위탁 · 제28조의8 국외 이전 고지) */
export type PrivacyProcessor = {
  name: string;
  country: string;
  purpose: string;
  items: string;
  period: string;
};

export const PRIVACY_PROCESSORS: readonly PrivacyProcessor[] = [
  {
    name: "Oracle Corporation (Oracle Cloud)",
    country: "일본",
    purpose: "서버 운영, 데이터베이스·백업 보관",
    items: "계정 정보, 훈독 기록 전체",
    period: "계정 삭제 시까지 (백업 최대 90일)",
  },
  {
    name: "Google LLC",
    country: "미국",
    purpose: "구글 로그인, AI 질문 답변 생성",
    items: "구글 계정 확인 정보, AI 질문 내용 (이름·이메일 제외)",
    period: "요청 처리 동안",
  },
  {
    name: "Cloudflare, Inc.",
    country: "미국 등",
    purpose: "접속 연결과 보안",
    items: "접속 정보 (IP 주소, 브라우저 정보)",
    period: "연결 전달 동안",
  },
  {
    name: "브라우저 알림 서비스 (Google, Apple, Mozilla)",
    country: "미국",
    purpose: "훈독 알림 전달",
    items: "알림 받을 주소, 알림 문구",
    period: "알림 해제 또는 계정 삭제 시까지",
  },
];

/** 개인정보 침해 상담·신고 기관 (국번 없이 거는 번호) */
export const PRIVACY_HELP_CENTERS = [
  { name: "개인정보침해 신고센터", phone: "118", url: "https://privacy.kisa.or.kr" },
  { name: "개인정보 분쟁조정위원회", phone: "1833-6972", url: "https://www.kopico.go.kr" },
  { name: "대검찰청 사이버수사과", phone: "1301", url: "https://www.spo.go.kr" },
  { name: "경찰청 사이버수사국", phone: "182", url: "https://ecrm.police.go.kr" },
] as const;
