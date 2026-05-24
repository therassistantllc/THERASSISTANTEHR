import LiveQueueClient from "@/components/billing/LiveQueueClient";

export const metadata = { title: "Reconciliation Exceptions" };

const formatDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const formatMoney = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function ReconciliationExceptionsPage() {
  return (
    <LiveQueueClient
      queueId="reconciliation_exceptions"
      endpoint="reconciliation-exceptions"
      filterUrlNamespace="recon"
      summaryLabels={{ count: "Open exceptions", dollars: "Variance $" }}
      tabs={[
        { id: "open", label: "Open" },
        { id: "investigating", label: "Investigating" },
        { id: "resolved", label: "Resolved" },
      ]}
      columns={[
        { id: "deposit_date", header: "Deposit date", cell: (r) => formatDate(r.deposit_date) },
        {
          id: "bank_ref",
          header: "Bank ref",
          cell: (r) => (
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>
              {String(r.bank_ref ?? "—")}
            </span>
          ),
        },
        {
          id: "bank_amount",
          header: "Bank $",
          align: "right",
          cell: (r) => formatMoney(r.bank_amount),
        },
        {
          id: "ehr_amount",
          header: "EHR $",
          align: "right",
          cell: (r) => formatMoney(r.ehr_amount),
        },
        {
          id: "variance",
          header: "Variance",
          align: "right",
          cell: (r) => formatMoney(r.variance),
        },
        { id: "type", header: "Exception type", cell: (r) => String(r.exception_type ?? "—") },
        { id: "assigned", header: "Assigned to", cell: (r) => String(r.assigned ?? "—") },
        { id: "status", header: "Status", cell: (r) => String(r.state ?? "—") },
      ]}
      actions={[
        { id: "investigate", label: "Start investigation", variant: "primary" },
        { id: "resolve", label: "Mark resolved" },
        { id: "reopen", label: "Reopen" },
      ]}
      detailFields={[
        { label: "Bank ref", value: (r) => String(r.bank_ref ?? "—") },
        { label: "Exception type", value: (r) => String(r.exception_type ?? "—") },
        { label: "Error", value: (r) => String(r.error_description ?? "—") },
        { label: "Deposit date", value: (r) => formatDate(r.deposit_date) },
      ]}
    />
  );
}
