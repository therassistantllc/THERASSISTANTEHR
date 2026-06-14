import PortalPreviewClient from "./PortalPreviewClient";

export default async function PatientPortalPreviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <main className="app-shell">
      <PortalPreviewClient clientId={clientId} />
    </main>
  );
}
