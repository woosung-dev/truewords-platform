import { SummaryDetailScreen } from "@/features/hoondok/summaries/screens";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SummaryDetailScreen key={id} id={id} />;
}
