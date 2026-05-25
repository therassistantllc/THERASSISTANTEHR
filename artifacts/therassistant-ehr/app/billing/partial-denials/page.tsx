import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Partial Denials" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function PartialDenialsPage() {
  return (
    <LiveQueueClient
      queueId="partial_denials"
      endpoint="partial-denials"
      filterUrlNamespace="partial_denials"
      summaryLabels={{ count: "Partial-pay claims", dollars: "Total shortfall" }}
      tabs={[
        { id: "open", label: "Open" },
        { id: "appealing", label: "Appealing" },
        { id: "recovered", label: "Recovered" },
        { id: "written_off", label: "Written Off" },
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
        {
          id: "billed",
          header: "Billed",
          align: "right",
          cell: (r) => formatMoney(r.billed_amount),
        },
        {
          id: "paid",
          header: "Paid",
          align: "right",
          cell: (r) => formatMoney(r.paid_amount),
        },
        {
          id: "shortfall",
          header: "Shortfall",
          align: "right",
          cell: (r) => <strong>{formatMoney(r.shortfall)}</strong>,
        },
        {
          id: "carc",
          header: "CARC / RARC",
          cell: (r) => (
            <span style={{ fontSize: 12 }}>
              {String(r.carc ?? "—")} / {String(r.rarc ?? "—")}
            </span>
          ),
        },
      ]}
      actions={[
        { id: "appeal", label: "Open appeal", variant: "primary" },
        { id: "mark_recovered", label: "Mark recovered" },
        { id: "write_off", label: "Write off", variant: "danger" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Payer", value: (r) => String(r.payer_name ?? "—") },
        { label: "Billed", value: (r) => formatMoney(r.billed_amount) },
        { label: "Paid", value: (r) => formatMoney(r.paid_amount) },
        { label: "Shortfall", value: (r) => formatMoney(r.shortfall) },
        { label: "CARC", value: (r) => String(r.carc ?? "—") },
        { label: "RARC", value: (r) => String(r.rarc ?? "—") },
      ]}
      getClaimId={(r) => (r.claim_id ? String(r.claim_id) : null)}
    />
  );
}
