import { SummaryEditPage } from "@/features/hoondok/summaries/workspace";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SummaryEditPage id={id} />;
}
