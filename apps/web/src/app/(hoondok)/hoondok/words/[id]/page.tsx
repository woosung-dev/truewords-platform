import { notFound } from "next/navigation";
import { WordsScreen } from "@/features/hoondok/library/components/words-screen";

export default async function HoondokWordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; chunk_id?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Next.js 16 App Router 는 이 경로의 params 값을 URL 인코딩된 채 전달한다.
  // API 어댑터가 한 번 인코딩하므로 경로 경계에서 한 번만 복원한다.
  let volume: string;
  try {
    volume = decodeURIComponent(id);
  } catch {
    notFound();
  }
  const page = Number(query.page ?? "1");
  return (
    <WordsScreen volume={volume} page={Number.isSafeInteger(page) && page > 0 ? page : 1} chunkId={query.chunk_id} />
  );
}
