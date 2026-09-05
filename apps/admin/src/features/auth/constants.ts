// 레드팀 시연 기간 관리자 게이트 계정 — 클라이언트 측 라우팅 힌트일 뿐, 최종 권한은 FastAPI 가 판정한다.
// ponytail: 시연 한시 — 시연 종료 후 role 기반 권한으로 교체/삭제. 비교는 항상 소문자 정규화.
// 값은 빌드 시 NEXT_PUBLIC_DEMO_ADMIN_EMAIL 로 구워진다 (코드에 개인 이메일을 두지 않는다).
// 호출 시점에 읽는 함수다 — 테스트가 env 를 stub 할 수 있고, Next 는 함수 안의 process.env.NEXT_PUBLIC_* 도 인라인한다.
// 비어 있으면 호출부가 어떤 계정도 관리자 라우트로 보내지 않는다 (API 도 같은 값이 없으면 403).
export function gateAdminEmail(): string {
  return (process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL ?? "").trim().toLowerCase();
}
