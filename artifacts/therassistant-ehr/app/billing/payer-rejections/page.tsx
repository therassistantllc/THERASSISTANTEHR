import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Payer Rejections" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function PayerRejectionsPage() {
  return (
    <LiveQueueClient
      queueId="payer_rejections"
      endpoint="payer-rejections"
      filterUrlNamespace="payer_rejections"
      tabs={[
        { id: "new", label: "New" },
        { id: "in_review", label: "In Review" },
        { id: "fixed_pending", label: "Fixed — Pending Resubmit" },
        { id: "resubmitted", label: "Resubmitted" },
      ]}
      columns={[
        { id: "client", header: "Client", cell: (r) => String(r.client_name ?? "—") },
        {
          id: "claim",
          header: "Claim #",
          cell: (r) => (
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>
              {String(r.claim_number ?? "—")}
            </span>
          ),
        },
        { id: "payer", header: "Payer", cell: (r) => String(r.payer_name ?? "—") },
        { id: "dos", header: "DOS", cell: (r) => formatDate(r.date_of_service) },
        { id: "reason", header: "Rejection reason", cell: (r) => String(r.reason ?? "—") },
        { id: "received", header: "Received", cell: (r) => formatDate(r.received_at) },
        {
          id: "charge",
          header: "Charge",
          align: "right",
          cell: (r) => formatMoney(r.charge_amount),
        },
        { id: "status", header: "Status", cell: (r) => String(r.state ?? "—") },
      ]}
      actions={[
        { id: "start_review", label: "Start review" },
        { id: "mark_fixed", label: "Mark fixed", variant: "primary" },
        { id: "mark_resubmitted", label: "Mark resubmitted" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Payer", value: (r) => String(r.payer_name ?? "—") },
        { label: "Rejection reason", value: (r) => String(r.reason ?? "—") },
        { label: "Reason code", value: (r) => String(r.reason_code ?? "—") },
        { label: "Charge", value: (r) => formatMoney(r.charge_amount) },
        { label: "Received", value: (r) => formatDate(r.received_at) },
        { label: "Last action", value: (r) => String(r.last_action ?? "—") },
      ]}
    />
  );
}
