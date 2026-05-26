import { redirect } from "next/navigation";

export default function PatientBalancesPage() {
  redirect("/billing/claims?tab=resolutions&filter=patient_resp");
}
