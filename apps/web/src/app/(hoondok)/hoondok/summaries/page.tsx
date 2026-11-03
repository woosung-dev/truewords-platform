import { SummaryListScreen } from "@/features/hoondok/summaries/screens";

export default async function Page({ searchParams }: { searchParams: Promise<{ volume?: string }> }) {
  const { volume } = await searchParams;
  return <SummaryListScreen volume={volume} />;
}
