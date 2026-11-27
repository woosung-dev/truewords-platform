import { SearchScreen } from "@/features/hoondok/library/components/search-screen";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  // 머리글 검색의 "결과 페이지로 크게 보기"가 ?q= 로 연다. 입력 칸 maxLength(200)와 같은 길이로 자른다.
  // (word-search 는 클라이언트 모듈이라 서버 컴포넌트에서 상수를 가져오지 않는다.)
  const initialQuery = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 200) ?? "";
  return <SearchScreen key={initialQuery} initialQuery={initialQuery} />;
}
