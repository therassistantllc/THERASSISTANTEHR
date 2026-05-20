import PatientsRosterClient from "@/app/patients/PatientsRosterClient";
import { getActiveOrganizationId } from "@/lib/server/getActiveOrganizationId";

export default async function ClientsPage() {
  const organizationId = await getActiveOrganizationId();
  return <PatientsRosterClient initialOrganizationId={organizationId} />;
}
