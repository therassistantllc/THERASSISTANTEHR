import PatientChartClient from "@/app/patients/[clientId]/PatientChartClient";
import { getActiveOrganizationId } from "@/lib/server/getActiveOrganizationId";

export default async function ClientChartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organizationId = await getActiveOrganizationId();

  return (
    <main className="app-shell">
      <PatientChartClient clientId={id} initialOrganizationId={organizationId} />
    </main>
  );
}
