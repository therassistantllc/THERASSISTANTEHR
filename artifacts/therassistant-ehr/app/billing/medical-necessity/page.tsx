import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Medical Necessity" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function MedicalNecessityPage() {
  return (
    <LiveQueueClient
      queueId="medical_necessity"
      endpoint="medical-necessity"
      filterUrlNamespace="med_nec"
      tabs={[
        { id: "open", label: "Open" },
        { id: "records_gathered", label: "Records Gathered" },
        { id: "appeal_sent", label: "Appeal Sent" },
        { id: "decided", label: "Decided" },
      ]}
      columns={[
        { id: "client", header: "Client", cell: (r) => String(r.client_name ?? "—") },
        { id: "claim", header: "Claim #", cell: (r) => String(r.claim_number ?? "—") },
        { id: "payer", header: "Payer", cell: (r) => String(r.payer_name ?? "—") },
        { id: "dx", header: "Primary Dx", cell: (r) => String(r.diagnosis ?? "—") },
        { id: "cpt", header: "CPT", cell: (r) => String(r.cpt ?? "—") },
        { id: "dos", header: "DOS", cell: (r) => formatDate(r.date_of_service) },
        { id: "denial_code", header: "Denial code", cell: (r) => String(r.denial_code ?? "—") },
        {
          id: "charge",
          header: "Charge",
          align: "right",
          cell: (r) => formatMoney(r.charge_amount),
        },
      ]}
      actions={[
        { id: "gather_records", label: "Gather records" },
        { id: "send_appeal", label: "Send appeal", variant: "primary" },
        { id: "decide", label: "Mark decided" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Client", value: (r) => String(r.client_name ?? "—") },
        { label: "Claim #", value: (r) => String(r.claim_number ?? "—") },
        { label: "Payer", value: (r) => String(r.payer_name ?? "—") },
        { label: "Denial code", value: (r) => String(r.denial_code ?? "—") },
        { label: "Charge", value: (r) => formatMoney(r.charge_amount) },
      ]}
      getClaimId={(r) => (r.claim_id ? String(r.claim_id) : null)}
    />
  );
}
