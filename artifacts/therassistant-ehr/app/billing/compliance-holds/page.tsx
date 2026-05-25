import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Compliance Holds" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function ComplianceHoldsPage() {
  return (
    <LiveQueueClient
      queueId="compliance_holds"
      endpoint="compliance-holds"
      filterUrlNamespace="comp_holds"
      tabs={[
        { id: "active", label: "Active Holds" },
        { id: "under_review", label: "Under Review" },
        { id: "released", label: "Released" },
      ]}
      columns={[
        { id: "placed", header: "Placed", cell: (r) => formatDate(r.placed) },
        { id: "client", header: "Client", cell: (r) => String(r.client_name ?? "—") },
        { id: "claim", header: "Claim #", cell: (r) => String(r.claim_number ?? "—") },
        { id: "provider", header: "Rendering provider", cell: (r) => String(r.provider ?? "—") },
        { id: "reason", header: "Hold reason", cell: (r) => String(r.reason ?? "—") },
        {
          id: "charge",
          header: "Charge",
          align: "right",
          cell: (r) => formatMoney(r.charge_amount),
        },
        { id: "placed_by", header: "Placed by", cell: (r) => String(r.placed_by ?? "—") },
        { id: "status", header: "Status", cell: (r) => String(r.state ?? "—") },
      ]}
      actions={[
        { id: "start_review", label: "Start review" },
        { id: "release", label: "Release hold", variant: "primary" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Reason", value: (r) => String(r.reason ?? "—") },
        { label: "Placed", value: (r) => formatDate(r.placed) },
      ]}
      getClaimId={(r) => String(r.id)}
    />
  );
}
