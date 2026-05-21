import BatchDetailClient from "./BatchDetailClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BatchDetailClient batchId={id} />;
}
