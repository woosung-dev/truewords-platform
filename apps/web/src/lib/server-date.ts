/**
 * 서버 시각 문자열 → Date. 끝에 `Z`·`+09:00`·`+0900` 같은 오프셋이 없으면 naive UTC(서버 규칙)로 읽는다.
 * 그대로 파싱하면 브라우저가 로컬 시각으로 오해해 KST 기준 9시간 어긋난다.
 */
export function serverDate(value: string): Date {
  return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
}
