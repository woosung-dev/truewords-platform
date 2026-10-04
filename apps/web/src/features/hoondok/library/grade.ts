// 서고·권 목록·검색 결과의 등급 배지 묶기 (DES-PWA-003 §2.3).
// 목록 전체가 같은 등급이면 배지를 묶음 머리에 한 번만 두고, 행에는 그와 다른 등급만 단다.
import type { AuthorityGrade } from "@/features/hoondok/today";

/** 목록 전체가 같은 등급이면 그 등급, 섞였거나 비었으면 null. */
export function sharedGrade(grades: readonly AuthorityGrade[]): AuthorityGrade | null {
  const [first, ...rest] = grades;
  return first !== undefined && rest.every((grade) => grade === first) ? first : null;
}

/** 묶음 전체가 R 일 때 머리 아래 한 줄 안내. 등급 설명을 처음 만나는 자리에 둔다(§2.3 접근성). */
export const R_GROUP_NOTE = "모두 공식성이 확인되지 않은 참고 자료예요.";
