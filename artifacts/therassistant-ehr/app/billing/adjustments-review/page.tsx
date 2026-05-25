import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Adjustments Review" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function AdjustmentsReviewPage() {
  return (
    <LiveQueueClient
      queueId="adjustments_review"
      endpoint="adjustments-review"
      filterUrlNamespace="adjustments"
      summaryLabels={{ count: "Adjustments flagged", dollars: "Flagged $" }}
      tabs={[
        { id: "needs_review", label: "Needs Review" },
        { id: "approved", label: "Approved" },
        { id: "reversed", label: "Reversed" },
      ]}
      columns={[
        { id: "client", header: "Client", cell: (r) => String(r.client_name ?? "—") },
        { id: "claim", header: "Claim #", cell: (r) => String(r.claim_number ?? "—") },
        { id: "payer", header: "Payer", cell: (r) => String(r.payer_name ?? "—") },
        { id: "dos", header: "DOS", cell: (r) => formatDate(r.date_of_service) },
        { id: "type", header: "Adjustment type", cell: (r) => String(r.adjustment_type ?? "—") },
        { id: "group_reason", header: "Group / reason", cell: (r) => String(r.group_reason ?? "—") },
        {
          id: "amount",
          header: "Amount",
          align: "right",
          cell: (r) => formatMoney(r.amount),
        },
        { id: "posted_by", header: "Posted by", cell: (r) => String(r.posted_by ?? "—") },
      ]}
      actions={[
        { id: "approve", label: "Approve", variant: "primary" },
        { id: "reverse", label: "Reverse", variant: "danger" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Adjustment type", value: (r) => String(r.adjustment_type ?? "—") },
        { label: "Group / reason", value: (r) => String(r.group_reason ?? "—") },
        { label: "Amount", value: (r) => formatMoney(r.amount) },
        { label: "Description", value: (r) => String(r.description ?? "—") },
        { label: "Posted by", value: (r) => String(r.posted_by ?? "—") },
        { label: "Posted at", value: (r) => formatDate(r.posted_at) },
      ]}
      getClaimId={(r) => (r.claim_id ? String(r.claim_id) : null)}
    />
  );
}
