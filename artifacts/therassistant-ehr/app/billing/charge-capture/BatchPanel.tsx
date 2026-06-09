"use client";

import styles from "./BatchPanel.module.css";

export interface Batch {
  id: string;
  batchNumber: string;
  status: string;
  claimCount: number;
  totalChargeAmount: number;
  payerName: string;
  billingProviderTaxId: string | null;
  submittedAt: string | null;
  generatedFileName: string | null;
}

export interface BatchTotals {
  totalUnbilledCharges: number;
  pendingBatches: number;
  readyToSubmit: number;
}

interface Props {
  batches: Batch[];
  loading: boolean;
  error: string | null;
  generating: boolean;
  readyCount: number;
  canGenerate: boolean;
  busyBatchId: string | null;
  orgId: string;
  onGenerate: () => void;
  onMarkSubmitted: (batchId: string) => void;
  onSubmit: (batchId: string) => void;
}

function batchStatusClass(s: string): string {
  switch (s.toLowerCase()) {
    case "submitted":
    case "accepted":
      return "statusBadgeSub";
    case "generated":
    case "ready_to_generate":
      return "statusBadgeGen";
    case "failed":
    case "rejected":
      return "statusBadgeFail";
    default:
      return "statusBadgeDef";
  }
}

function batchStatusLabel(s: string): string {
  switch (s.toLowerCase()) {
    case "ready_to_generate":
      return "Ready";
    case "generated":
      return "Generated";
    case "submitted":
      return "Submitted";
    case "accepted":
      return "Accepted";
    case "failed":
      return "Failed";
    case "rejected":
      return "Rejected";
    default:
      return s.replace(/_/g, " ");
  }
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  const d = new Date(v + (v.includes("T") ? "" : "T00:00:00"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function BatchPanel({
  batches,
  loading,
  error,
  generating,
  readyCount,
  canGenerate,
  busyBatchId,
  orgId,
  onGenerate,
  onMarkSubmitted,
  onSubmit,
}: Props) {
  return (
    <section className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderTop}>
          <div className={styles.panelTitleRow}>
            <h2 className={styles.panelTitle}>837P Batches</h2>
            {readyCount > 0 && (
              <span className={styles.readyBadge}>{readyCount} ready</span>
            )}
          </div>
          <button
            type="button"
            disabled={generating || !canGenerate}
            onClick={onGenerate}
            className={styles.generateBtn}
          >
            {generating ? "Generating…" : "⬡ Generate 837P Batches"}
          </button>
        </div>

        <div className={styles.workflowBox}>
          <div className={styles.workflowTitle}>Availity Upload Workflow</div>
          <ol className={styles.workflowList}>
            <li>Click &quot;Generate 837P Batches&quot; to group all ready charges by payer / TIN into downloadable batches.</li>
            <li>Click &quot;↓ Download 837&quot; on each batch to save the X12 EDI file.</li>
            <li>Log into Availity → Claims → EDI Upload and submit the file. Availity will validate and forward to the payer.</li>
            <li>Once you confirm the submission in Availity, click &quot;✓ Mark Submitted&quot; to update the batch status here.</li>
          </ol>
          <a href="https://apps.availity.com" target="_blank" rel="noopener noreferrer" className={styles.availityLink}>
            Open Availity Portal →
          </a>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className={styles.error}>{error}</div>
      ) : loading ? (
        <div className={styles.empty}>Loading batches…</div>
      ) : batches.length === 0 ? (
        <div className={styles.empty}>
          {readyCount > 0
            ? `${readyCount} charge${readyCount === 1 ? "" : "s"} ready to batch — click &quot;Generate 837P Batches&quot; above.`
            : "No batches yet. Release charges first, then click \"Generate 837P Batches\" to create downloadable 837P files."}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {["Batch #", "Payer", "TIN", "Claims", "Total Charge", "Status", "Submitted", "Actions"].map((h) => (
                  <th key={h} className={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const ss = batchStatusClass(b.status);
                const isBusy = busyBatchId === b.id;
                const downloadUrl = `/api/billing/charges/batches/${encodeURIComponent(b.id)}/download?organizationId=${encodeURIComponent(orgId)}`;
                const isSubmitted = ["submitted", "accepted"].includes(b.status.toLowerCase());
                return (
                  <tr key={b.id} className={styles.tr}>
                    <td className={styles.tdBold}>{b.batchNumber}</td>
                    <td className={styles.td}>{b.payerName}</td>
                    <td className={styles.tdMono}>{b.billingProviderTaxId || "—"}</td>
                    <td className={styles.tdCenter}>{b.claimCount}</td>
                    <td className={styles.tdNum}>{fmtMoney(b.totalChargeAmount)}</td>
                    <td className={styles.td}>
                      <span className={styles[ss]}>
                        {batchStatusLabel(b.status)}
                      </span>
                    </td>
                    <td className={styles.tdMuted}>{b.submittedAt ? fmtDate(b.submittedAt) : "—"}</td>
                    <td className={styles.td}>
                      <div className={styles.actions}>
                        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className={styles.actionBtn}>
                          ↓ Download 837
                        </a>
                        {!isSubmitted ? (
                          <button type="button" disabled={isBusy} onClick={() => onSubmit(b.id)} className={styles.actionBtnPrimary}>
                            {isBusy ? "…" : "Submit Batch"}
                          </button>
                        ) : null}
                        {!isSubmitted ? (
                          <button type="button" disabled={isBusy} onClick={() => onMarkSubmitted(b.id)} className={styles.actionBtnDark}>
                            {isBusy ? "…" : "✓ Mark Submitted"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
