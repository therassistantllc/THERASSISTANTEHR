"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import WorkqueueShell, {
  type ColumnDef,
  type DetailTab,
  type FilterDef,
  type PrimaryAction,
  type RowAction,
  type SummaryMetric,
} from "@/components/billing/WorkqueueShell";

type PayerMixEntry = { payerId: string; payerName: string; count: number };

type BatchClaim = {
  id: string;
  patientId: string;
  patientName: string;
  claimNumber: unknown;
  status: unknown;
  totalChargeAmount: number;
  payerId: string;
  payerName: string;
};

type BatchRow = {
  id: string;
  batchNumber: string;
  status: string;
  tab: string;
  claimCount: number;
  totalChargeAmount: number;
  generatedFileName: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  submissionError: string;
  lastHttpStatus: number | null;
  ageDays: number;
  createdBy: string;
  clearinghouseStatus: string;
  errorCount: number;
  payerMix: PayerMixEntry[];
  claims: BatchClaim[];
};

type Payload = {
  success: boolean;
  error?: string;
  totals?: { count: number; totalCharges: number; oldestAgeDays: number; urgentCount: number };
  tabCounts?: Record<string, number>;
  payerOptions?: Array<{ value: string; label: string }>;
  batches?: BatchRow[];
};

type TransmissionEvent = {
  id: string;
  at: string;
  kind: "submission" | "status" | "response";
  severity: "info" | "success" | "warning" | "error";
  title: string;
  detail: string;
  claimNumber: string;
};

type Acknowledgement = {
  id: string;
  type: string;
  fileName: string;
  receivedAt: string;
  parsed: unknown;
};

type BatchDetail = {
  success: boolean;
  error?: string;
  acknowledgements?: Acknowledgement[];
  timeline?: TransmissionEvent[];
  claims?: Array<{ id: string; patientId: string; patientName: string; claimNumber: string; status: string; totalCharge: number }>;
};

const TABS: Array<{ id: string; label: string }> = [
  { id: "draft", label: "Draft Batches" },
  { id: "ready", label: "Ready to Submit" },
  { id: "submitted", label: "Submitted Batches" },
  { id: "failed", label: "Failed Batches" },
  { id: "partial", label: "Partially Accepted" },
];

const AGING_OPTIONS = [
  { value: "0-7", label: "0–7 days" },
  { value: "8-30", label: "8–30 days" },
  { value: "31-60", label: "31–60 days" },
  { value: "61-90", label: "61–90 days" },
  { value: "90+", label: "90+ days" },
];

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function formatMoney(value: number) {
  return Number(value ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function payerMixSummary(mix: PayerMixEntry[]): string {
  if (mix.length === 0) return "—";
  return mix
    .slice(0, 3)
    .map((p) => `${p.payerName} (${p.count})`)
    .join(", ") + (mix.length > 3 ? ` +${mix.length - 3}` : "");
}

export default function Batches837PClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("draft");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [detail, setDetail] = useState<Record<string, BatchDetail | undefined>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string | undefined>>({});

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ organizationId, tab: activeTab });
      for (const [k, v] of Object.entries(filterValues)) if (v) params.set(k, v);
      const res = await fetch(`/api/billing/837p-batches?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load batches");
      setPayload(json);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Failed to load batches" });
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeTab, filterValues]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load per-batch detail (for the right panel) lazily.
  const loadDetail = useCallback(
    async (batchId: string) => {
      if (detail[batchId]) return;
      try {
        const res = await fetch(
          `/api/billing/batches/${encodeURIComponent(batchId)}?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as BatchDetail;
        setDetail((cur) => ({ ...cur, [batchId]: json }));
      } catch (e) {
        setDetail((cur) => ({
          ...cur,
          [batchId]: { success: false, error: e instanceof Error ? e.message : "Failed" },
        }));
      }
    },
    [detail, organizationId],
  );

  const loadFilePreview = useCallback(
    async (batchId: string) => {
      if (filePreviews[batchId] !== undefined) return;
      try {
        const res = await fetch(
          `/api/claims/837p/batch/${encodeURIComponent(batchId)}/file?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const txt = await res.text();
          setFilePreviews((cur) => ({ ...cur, [batchId]: `(${res.status}) ${txt.slice(0, 400)}` }));
          return;
        }
        const txt = await res.text();
        setFilePreviews((cur) => ({ ...cur, [batchId]: txt.slice(0, 4000) }));
      } catch (e) {
        setFilePreviews((cur) => ({
          ...cur,
          [batchId]: `Error: ${e instanceof Error ? e.message : "preview failed"}`,
        }));
      }
    },
    [filePreviews, organizationId],
  );

  useEffect(() => {
    if (selectedRowId) {
      void loadDetail(selectedRowId);
      void loadFilePreview(selectedRowId);
    }
  }, [selectedRowId, loadDetail, loadFilePreview]);

  function flash(tone: "success" | "error", text: string) {
    setMessage({ tone, text });
    window.setTimeout(() => setMessage(null), 5000);
  }

  async function callAction(url: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...body }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `${label} failed`);
      flash("success", `${label} succeeded.`);
      // Reset cached detail/preview so next selection re-loads.
      setDetail({});
      setFilePreviews({});
      await load();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  const batches = payload?.batches ?? [];
  const totals = payload?.totals ?? { count: 0, totalCharges: 0, oldestAgeDays: 0, urgentCount: 0 };
  const tabCounts = payload?.tabCounts ?? {};
  const payerOptions = payload?.payerOptions ?? [];
  const selectedBatch = useMemo(
    () => (selectedRowId ? batches.find((b) => b.id === selectedRowId) ?? null : null),
    [selectedRowId, batches],
  );

  const summary: SummaryMetric[] = [
    { id: "count", label: "Total batches", value: totals.count.toLocaleString() },
    { id: "dollars", label: "Total charges", value: formatMoney(totals.totalCharges) },
    {
      id: "oldest",
      label: "Oldest batch age",
      value: `${totals.oldestAgeDays} day${totals.oldestAgeDays === 1 ? "" : "s"}`,
      tone: totals.oldestAgeDays >= 14 ? "amber" : "default",
    },
    {
      id: "urgent",
      label: "Urgent items",
      value: totals.urgentCount.toLocaleString(),
      tone: totals.urgentCount > 0 ? "red" : "default",
    },
  ];

  const filters: FilterDef[] = [
    { id: "practice", label: "Practice", kind: "text", placeholder: "Practice…", width: 140 },
    { id: "clinician", label: "Clinician", kind: "text", placeholder: "Clinician…", width: 140 },
    {
      id: "payer",
      label: "Payer",
      kind: "select",
      options: payerOptions,
      width: 180,
    },
    { id: "client", label: "Client", kind: "text", placeholder: "Name…", width: 180 },
    { id: "dosFrom", label: "DOS from", kind: "date" },
    { id: "dosTo", label: "DOS to", kind: "date" },
    { id: "status", label: "Status", kind: "text", placeholder: "Raw status…", width: 140 },
    { id: "assignedBiller", label: "Assigned biller", kind: "text", placeholder: "Biller…", width: 140 },
    { id: "minAmount", label: "Min $", kind: "number", width: 100 },
    { id: "maxAmount", label: "Max $", kind: "number", width: 100 },
    { id: "agingBucket", label: "Aging", kind: "select", options: AGING_OPTIONS, width: 140 },
    { id: "carcRarc", label: "CARC/RARC", kind: "text", placeholder: "Code…", width: 120 },
    {
      id: "priority",
      label: "Priority",
      kind: "select",
      options: [{ value: "urgent", label: "Urgent only" }],
      width: 140,
    },
    { id: "followUpDue", label: "Follow-up due", kind: "date" },
  ];

  const columns: ColumnDef<BatchRow>[] = [
    { id: "batchNumber", header: "Batch ID", cell: (r) => <code>{r.batchNumber}</code> },
    { id: "createdAt", header: "Created date", cell: (r) => formatDate(r.createdAt) },
    { id: "claimCount", header: "Claim count", align: "right", cell: (r) => r.claimCount.toLocaleString() },
    { id: "totalCharges", header: "Total charges", align: "right", cell: (r) => formatMoney(r.totalChargeAmount) },
    { id: "payerMix", header: "Payer mix", cell: (r) => payerMixSummary(r.payerMix) },
    { id: "createdBy", header: "Created by", cell: (r) => r.createdBy },
    {
      id: "chStatus",
      header: "Clearinghouse status",
      cell: (r) => (
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 10,
            background:
              r.clearinghouseStatus === "Accepted"
                ? "#DCFCE7"
                : r.clearinghouseStatus === "Rejected"
                ? "#FEE2E2"
                : r.clearinghouseStatus === "Partial"
                ? "#FEF3C7"
                : "#E0E7FF",
            color:
              r.clearinghouseStatus === "Accepted"
                ? "#166534"
                : r.clearinghouseStatus === "Rejected"
                ? "#991B1B"
                : r.clearinghouseStatus === "Partial"
                ? "#92400E"
                : "#3730A3",
          }}
        >
          {r.clearinghouseStatus}
        </span>
      ),
    },
    {
      id: "errorCount",
      header: "Error count",
      align: "right",
      cell: (r) => (r.errorCount > 0 ? <strong style={{ color: "#DC2626" }}>{r.errorCount}</strong> : "0"),
    },
    { id: "submittedAt", header: "Submission date", cell: (r) => formatDate(r.submittedAt) },
  ];

  const submittableTabs = new Set(["ready", "failed"]);
  const draftTabs = new Set(["draft", "ready", "failed"]);

  const rowActions: RowAction<BatchRow>[] = [
    {
      id: "submit",
      label: "Submit",
      variant: "primary",
      disabled: (r) => !submittableTabs.has(r.tab) || busy !== null,
      onClick: (r) =>
        void callAction(
          `/api/claims/837p/batch/${encodeURIComponent(r.id)}/submit`,
          { action: r.tab === "failed" ? "retry" : "submit" },
          "Submit batch",
        ),
    },
    {
      id: "download",
      label: "Download 837",
      onClick: (r) => {
        const url = `/api/claims/837p/batch/${encodeURIComponent(r.id)}/file?organizationId=${encodeURIComponent(organizationId)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    {
      id: "rebuild",
      label: "Rebuild",
      disabled: (r) => !draftTabs.has(r.tab) || busy !== null,
      onClick: (r) =>
        void callAction(`/api/claims/837p/batch/${encodeURIComponent(r.id)}/rebuild`, {}, "Rebuild batch"),
    },
    {
      id: "cancel",
      label: "Cancel",
      variant: "danger",
      disabled: (r) => r.tab === "submitted" || busy !== null,
      onClick: (r) => {
        if (!window.confirm(`Cancel batch ${r.batchNumber} and release ${r.claimCount} claim(s)?`)) return;
        void callAction(`/api/claims/837p/batch/${encodeURIComponent(r.id)}/cancel`, {}, "Cancel batch");
      },
    },
  ];

  const detailTabs: DetailTab[] = [
    {
      id: "claims",
      label: "Claims in batch",
      render: () => {
        if (!selectedBatch) return null;
        const det = detail[selectedBatch.id];
        const rows = det?.claims ?? selectedBatch.claims.map((c) => ({
          id: c.id,
          patientId: c.patientId,
          patientName: c.patientName,
          claimNumber: String(c.claimNumber ?? ""),
          status: String(c.status ?? ""),
          totalCharge: c.totalChargeAmount,
        }));
        if (rows.length === 0) {
          return <div style={{ padding: 12, color: "#64748b" }}>No claims linked to this batch.</div>;
        }
        const canRemove = selectedBatch.tab !== "submitted";
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
            {rows.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    <Link className="inline-link" href={`/clients/${encodeURIComponent(c.patientId)}`}>
                      {c.patientName}
                    </Link>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {c.claimNumber || c.id.slice(0, 8)} · {c.status || "—"} · {formatMoney(c.totalCharge)}
                  </div>
                </div>
                {canRemove ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ height: 26, padding: "0 8px", fontSize: 12 }}
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Remove ${c.patientName} from this batch?`)) return;
                      void callAction(
                        `/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/claims/${encodeURIComponent(c.id)}/remove`,
                        {},
                        "Remove claim",
                      );
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      id: "file",
      label: "837 file preview/download",
      render: () => {
        if (!selectedBatch) return null;
        const preview = filePreviews[selectedBatch.id];
        return (
          <div style={{ padding: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <a
                className="button button-secondary"
                href={`/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/file?organizationId=${encodeURIComponent(organizationId)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download 837 file
              </a>
              {selectedBatch.generatedFileName ? (
                <span style={{ marginLeft: 10, fontSize: 12, color: "#475569" }}>
                  {selectedBatch.generatedFileName}
                </span>
              ) : null}
            </div>
            <pre
              style={{
                background: "#0f172a",
                color: "#e2e8f0",
                padding: 10,
                borderRadius: 6,
                fontSize: 11,
                maxHeight: 320,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {preview ?? "Loading preview…"}
            </pre>
          </div>
        );
      },
    },
    {
      id: "validation",
      label: "Batch validation summary",
      render: () => {
        if (!selectedBatch) return null;
        const det = detail[selectedBatch.id];
        const claimErrors = (det?.claims ?? selectedBatch.claims).filter((c) => /reject|error|fail|denied/i.test(String(c.status ?? "")));
        return (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13 }}>
              <strong>Batch status:</strong> {selectedBatch.status || "—"} (
              {selectedBatch.clearinghouseStatus})
              <br />
              <strong>Error count:</strong> {selectedBatch.errorCount}
              <br />
              <strong>Last HTTP status:</strong> {String(selectedBatch.lastHttpStatus ?? "—")}
            </div>
            {selectedBatch.submissionError ? (
              <div
                style={{
                  padding: 10,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#991B1B",
                  borderRadius: 6,
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {selectedBatch.submissionError}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#475569" }}>No submission errors recorded.</div>
            )}
            {claimErrors.length > 0 ? (
              <div>
                <strong style={{ fontSize: 13 }}>Claims with issues ({claimErrors.length})</strong>
                <ul style={{ fontSize: 12, paddingLeft: 20 }}>
                  {claimErrors.map((c) => (
                    <li key={c.id}>
                      {("patientName" in c ? c.patientName : "")} · {String(c.status)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#475569" }}>All claims in this batch validate cleanly.</div>
            )}
          </div>
        );
      },
    },
    {
      id: "transmission",
      label: "Transmission log",
      render: () => {
        if (!selectedBatch) return null;
        const det = detail[selectedBatch.id];
        const timeline = det?.timeline ?? [];
        const acks = det?.acknowledgements ?? [];
        return (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13 }}>
              <strong>Submitted at:</strong> {formatDateTime(selectedBatch.submittedAt)}
              <br />
              <strong>Acknowledgements:</strong> {acks.length}
            </div>
            {acks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {acks.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      padding: 8,
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <strong>{a.type}</strong> · {a.fileName || "(no file name)"} · received{" "}
                    {formatDateTime(a.receivedAt)}
                  </div>
                ))}
              </div>
            ) : null}
            {timeline.length === 0 ? (
              <div style={{ fontSize: 12, color: "#475569" }}>No transmission events yet.</div>
            ) : (
              <ol style={{ paddingLeft: 20, fontSize: 12 }}>
                {timeline.map((e) => (
                  <li key={e.id} style={{ marginBottom: 6 }}>
                    <span
                      style={{
                        color:
                          e.severity === "error"
                            ? "#DC2626"
                            : e.severity === "warning"
                            ? "#D97706"
                            : e.severity === "success"
                            ? "#059669"
                            : "#2563EB",
                        fontWeight: 600,
                      }}
                    >
                      {e.title}
                    </span>
                    <br />
                    <span style={{ color: "#475569" }}>
                      {formatDateTime(e.at)} · claim {e.claimNumber}
                      {e.detail ? ` · ${e.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      },
    },
  ];

  const detailActions: PrimaryAction[] = selectedBatch
    ? [
        {
          id: "submit",
          label: "Submit batch",
          variant: "primary",
          disabled: !submittableTabs.has(selectedBatch.tab) || busy !== null,
          onClick: () =>
            void callAction(
              `/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/submit`,
              { action: selectedBatch.tab === "failed" ? "retry" : "submit" },
              "Submit batch",
            ),
        },
        {
          id: "rebuild",
          label: "Rebuild batch",
          disabled: !draftTabs.has(selectedBatch.tab) || busy !== null,
          onClick: () =>
            void callAction(`/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/rebuild`, {}, "Rebuild batch"),
        },
        {
          id: "download",
          label: "Download 837",
          onClick: () => {
            const url = `/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/file?organizationId=${encodeURIComponent(organizationId)}`;
            window.open(url, "_blank", "noopener,noreferrer");
          },
        },
        {
          id: "cancel",
          label: "Cancel batch",
          variant: "danger",
          disabled: selectedBatch.tab === "submitted" || busy !== null,
          onClick: () => {
            if (!window.confirm(`Cancel batch ${selectedBatch.batchNumber} and release ${selectedBatch.claimCount} claim(s)?`)) return;
            void callAction(`/api/claims/837p/batch/${encodeURIComponent(selectedBatch.id)}/cancel`, {}, "Cancel batch");
          },
        },
      ]
    : [];

  const headerActions: PrimaryAction[] = [
    { id: "refresh", label: loading ? "Refreshing…" : "Refresh", onClick: () => void load(), disabled: loading },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Tab strip */}
      <nav
        style={{
          display: "flex",
          gap: 6,
          padding: "4px 4px 0",
          borderBottom: "1px solid #e2e8f0",
        }}
        aria-label="Batch lifecycle tabs"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActiveTab(t.id);
              setSelectedRowId(null);
            }}
            style={{
              padding: "8px 14px",
              border: "none",
              borderBottom: activeTab === t.id ? "2px solid #2563eb" : "2px solid transparent",
              background: "transparent",
              fontWeight: activeTab === t.id ? 600 : 500,
              color: activeTab === t.id ? "#1d4ed8" : "#475569",
              cursor: "pointer",
            }}
            aria-pressed={activeTab === t.id}
          >
            {t.label}
            {tabCounts[t.id] !== undefined ? (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  background: "#e2e8f0",
                  color: "#334155",
                  borderRadius: 10,
                  padding: "1px 8px",
                }}
              >
                {tabCounts[t.id]}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <WorkqueueShell<BatchRow>
        title="Batch Review"
        description="Final batch-level review before transmission to the clearinghouse."
        headerActions={headerActions}
        summary={summary}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={setFilterValues}
        filterUrlNamespace="batches"
        rows={batches}
        columns={columns}
        rowId={(r) => r.id}
        loading={loading}
        emptyMessage="No batches in this tab match the current filters."
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRowId}
        rowActions={rowActions}
        detailTabs={detailTabs}
        detailActions={detailActions}
        message={message}
      />
    </div>
  );
}
