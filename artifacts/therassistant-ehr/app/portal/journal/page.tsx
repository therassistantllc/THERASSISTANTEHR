import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal/session";
import PortalJournalClient from "./PortalJournalClient";

export default async function PortalJournalPage() {
  const session = await getPortalSession();
  if (!session) redirect("/portal/signed-out");
  return <PortalJournalClient />;
}
