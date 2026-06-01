import EraPosterClient from "./EraPosterClient";

export const dynamic = "force-dynamic";

export default async function EraPosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EraPosterClient batchId={id} />;
}
