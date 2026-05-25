import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Resubmission Queue" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function ResubmissionsPage() {
  return (
    <LiveQueueClient
      queueId="resubmission_queue"
      endpoint="resubmissions"
      filterUrlNamespace="resubmissions"
      tabs={[
        { id: "ready", label: "Ready to Resubmit" },
        { id: "queued", label: "Queued for Batch" },
        { id: "submitted", label: "Submitted" },
        { id: "blocked", label: "Blocked" },
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
        { id: "freq", header: "Frequency", cell: (r) => String(r.frequency_code ?? "7") },
        { id: "payer", header: "Payer", cell: (r) => String(r.payer_name ?? "—") },
        { id: "dos", header: "DOS", cell: (r) => formatDate(r.date_of_service) },
        { id: "reason", header: "Resubmit reason", cell: (r) => String(r.reason ?? "—") },
        {
          id: "charge",
          header: "Charge",
          align: "right",
          cell: (r) => formatMoney(r.charge_amount),
        },
        { id: "status", header: "Status", cell: (r) => String(r.state ?? "—") },
      ]}
      actions={[
        { id: "queue_for_batch", label: "Queue for batch", variant: "primary" },
        { id: "mark_submitted", label: "Mark submitted" },
        { id: "block", label: "Block", variant: "danger" },
        { id: "reopen", label: "Move to ready" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Payer", value: (r) => String(r.payer_name ?? "—") },
        { label: "Reason", value: (r) => String(r.reason ?? "—") },
        { label: "Charge", value: (r) => formatMoney(r.charge_amount) },
        { label: "DOS", value: (r) => formatDate(r.date_of_service) },
      ]}
      getClaimId={(r) => String(r.id)}
    />
  );
}
