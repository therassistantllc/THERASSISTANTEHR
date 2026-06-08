import { redirect } from "next/navigation";
import { getActiveOrganizationId } from "@/lib/server/getActiveOrganizationId";

export default async function PatientChartRedirectPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  // Defense-in-depth: forward the active org id so the chart still works
  // even if a downstream page falls back to reading the query string.
  const organizationId = await getActiveOrganizationId();
  const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  redirect(`/clients/${clientId}${qs}`);
}
