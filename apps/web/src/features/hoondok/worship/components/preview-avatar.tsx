// 프리뷰 아바타. 프로토타입은 외부 사진(picsum)을 쓰지만 프리뷰 셸은 바깥 네트워크를 타지 않으므로
// 정원 프로필(`.gd-profile__av`, W1-G)처럼 글자 한 자로 대신한다. 이름은 장식이 아니라 옆 줄에 그대로 있으므로
// 아바타 자체는 aria-hidden 이다.

/** "교회장 A" → "A" · "어머니" → "어". 익명 자리표시 이름의 끝 알파벳을 우선 쓴다 */
export function avatarText(name: string): string {
  const trimmed = name.trim();
  const last = trimmed.slice(-1);
  return /[A-Za-z]/.test(last) ? last.toUpperCase() : trimmed.slice(0, 1);
}

export function PreviewAvatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`pv-avatar ${className}`.trim()} aria-hidden="true">
      {avatarText(name)}
    </span>
  );
}
