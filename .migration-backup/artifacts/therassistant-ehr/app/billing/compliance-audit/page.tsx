import { Metadata } from "next";
import ComplianceAuditClient from "./ComplianceAuditClient";

export const metadata: Metadata = {
  title: "Compliance & Audit · Billing",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <ComplianceAuditClient />;
}
