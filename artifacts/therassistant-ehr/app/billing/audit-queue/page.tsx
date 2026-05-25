import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Audit Queue" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function AuditQueuePage() {
  return (
    <LiveQueueClient
      queueId="audit_queue"
      endpoint="audit-queue"
      filterUrlNamespace="audit"
      tabs={[
        { id: "pre_bill", label: "Pre-bill" },
        { id: "post_payment", label: "Post-payment" },
        { id: "in_progress", label: "In Progress" },
        { id: "complete", label: "Complete" },
      ]}
      columns={[
        { id: "selected", header: "Selected on", cell: (r) => formatDate(r.selected_on) },
        { id: "client", header: "Client", cell: (r) => String(r.client_name ?? "—") },
        { id: "claim", header: "Claim #", cell: (r) => String(r.claim_number ?? "—") },
        { id: "payer", header: "Payer", cell: (r) => String(r.payer_name ?? "—") },
        { id: "dos", header: "DOS", cell: (r) => formatDate(r.date_of_service) },
        { id: "audit_type", header: "Audit type", cell: (r) => String(r.audit_type ?? "—") },
        { id: "auditor", header: "Auditor", cell: (r) => String(r.auditor ?? "—") },
        { id: "status", header: "Status", cell: (r) => String(r.state ?? "—") },
      ]}
      actions={[
        { id: "start_audit", label: "Start audit", variant: "primary" },
        { id: "complete_audit", label: "Complete audit" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Audit type", value: (r) => String(r.audit_type ?? "—") },
        { label: "Charge", value: (r) => formatMoney(r.charge_amount) },
      ]}
      getClaimId={(r) => (r.claim_id ? String(r.claim_id) : null)}
    />
  );
}
