"use client";

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
import { ClaimDocumentsPanel } from "@/components/billing/ClaimDocumentsPanel";
import { getWorkqueue } from "@/lib/billing/workqueues";

type Tab =
  | "exact"
  | "same_dos_code"
  | "same_dos_diff"
  | "overlapping"
  | "previously_paid";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "exact", label: "Exact Match" },
  { id: "same_dos_code", label: "Same DOS/Same Code" },
  { id: "same_dos_diff", label: "Same DOS/Different Code" },
  { id: "overlapping", label: "Overlapping Time" },
  { id: "previously_paid", label: "Previously Paid" },
];

interface DuplicateRow {
  id: string;
  currentClaimId: string;
  otherClaimId: string;
  tab: Tab;
  tabs: Tab[];
  clientId: string | null;
  clientName: string;
  dos: string | null;
  clinician: string;
  code: string;
  current: {
    id: string;
    claimNumber: string;
    status: string;
    totalCharge: number;
    createdAt: string | null;
  };
  potential: {
    id: string;
    claimNumber: string;
    status: string;
    totalCharge: number;
    paidAmount: number;
    createdAt: string | null;
  };
  riskLevel: "high" | "medium" | "low";
  matchReason: string;
}

interface Facets {
  clinicians: string[];
  payers: Array<{ id: string; name: string }>;
  practices: Array<{ id: string; name: string }>;
}

interface ListPayload {
  success: boolean;
  error?: string;
  rows?: DuplicateRow[];
  facets?: Facets;
}

/**
 * Filter ids that are passed through to the list API as query parameters.
 * Anything else (currently nothing) would need client-side handling.
 */
const SERVER_FILTER_KEYS = [
  "client",
  "clinician",
  "payer",
  "practice",
  "dosFrom",
  "dosTo",
  "status",
  "assignedBiller",
  "minAmount",
  "maxAmount",
  "agingBucket",
  "carcRarc",
  "priority",
  "followUpDue",
] as const;

function getOrganizationId(): string {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  return (
    new URLSearchParams(window.location.search).get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value || 0,
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function ageDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 3600 * 1000)));
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ");
}

const queueDef = getWorkqueue("duplicate_claim_review");

function buildQueryString(
  organizationId: string,
  filterValues: Record<string, string>,
): string {
  const params = new URLSearchParams({ organizationId });
  for (const key of SERVER_FILTER_KEYS) {
    const v = filterValues[key];
    if (v && String(v).trim()) params.set(key, String(v).trim());
  }
  return params.toString();
}

// ─── Reason modal ──────────────────────────────────────────────────────────

function ReasonModal({
  title,
  prompt,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  prompt: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: 480,
          maxWidth: "92vw",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>{title}</h2>
        <p style={{ color: "#475569", fontSize: 13, marginTop: 0 }}>{prompt}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Required — explain your decision"
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid #D1D5DB",
            borderRadius: 4,
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        {err ? (
          <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 6 }}>{err}</div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              if (!reason.trim()) {
                setErr("A reason is required");
                return;
              }
              onConfirm(reason.trim());
            }}
            disabled={busy}
          >
            {busy ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function DuplicateClaimReviewClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [rows, setRows] = useState<DuplicateRow[]>([]);
  const [facets, setFacets] = useState<Facets>({
    clinicians: [],
    payers: [],
    practices: [],
  });
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("exact");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<
    | {
        title: string;
        prompt: string;
        run: (reason: string) => Promise<void>;
      }
    | null
  >(null);

  const queryString = useMemo(
    () => buildQueryString(organizationId, filterValues),
    [organizationId, filterValues],
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/duplicate-claim-review?${queryString}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ListPayload;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load duplicate review");
      }
      setRows(json.rows ?? []);
      if (json.facets) setFacets(json.facets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load duplicate review");
    } finally {
      setLoading(false);
    }
  }, [organizationId, queryString]);

  // Re-fetch whenever the filter set changes so the table, summary strip,
  // and tab counts always reflect server-side filtering.
  useEffect(() => {
    void load();
  }, [load]);

  // ── Filters ──────────────────────────────────────────────────────────────
  const filters: FilterDef[] = useMemo(
    () => [
      { id: "client", label: "Client", kind: "text", placeholder: "Name…" },
      {
        id: "practice",
        label: "Practice",
        kind: "select",
        options: facets.practices.map((p) => ({ value: p.id, label: p.name })),
      },
      {
        id: "clinician",
        label: "Clinician",
        kind: "select",
        options: facets.clinicians.map((c) => ({ value: c, label: c })),
      },
      {
        id: "payer",
        label: "Payer",
        kind: "select",
        options: facets.payers.map((p) => ({ value: p.id, label: p.name })),
      },
      { id: "dosFrom", label: "DOS from", kind: "date" },
      { id: "dosTo", label: "DOS to", kind: "date" },
      {
        id: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "ready_for_batch", label: "Ready for batch" },
          { value: "submitted", label: "Submitted" },
          { value: "denied", label: "Denied" },
          { value: "paid", label: "Paid" },
        ],
      },
      {
        id: "assignedBiller",
        label: "Assigned biller",
        kind: "text",
        placeholder: "Name or email…",
      },
      { id: "minAmount", label: "Min $", kind: "number", placeholder: "0" },
      { id: "maxAmount", label: "Max $", kind: "number", placeholder: "0" },
      {
        id: "agingBucket",
        label: "Aging",
        kind: "select",
        options: [
          { value: "0-30", label: "0-30 days" },
          { value: "31-60", label: "31-60 days" },
          { value: "61-90", label: "61-90 days" },
          { value: "90+", label: "90+ days" },
        ],
      },
      { id: "carcRarc", label: "CARC/RARC", kind: "text", placeholder: "e.g. 18" },
      {
        id: "priority",
        label: "Priority",
        kind: "select",
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
      { id: "followUpDue", label: "Follow-up due by", kind: "date" },
    ],
    [facets],
  );

  // ── Tab partitioning (server returns all buckets; tabs are a client view) ──
  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = {
      exact: 0,
      same_dos_code: 0,
      same_dos_diff: 0,
      overlapping: 0,
      previously_paid: 0,
    };
    for (const r of rows) {
      for (const t of r.tabs) counts[t] += 1;
    }
    return counts;
  }, [rows]);

  const tabRows = useMemo(
    () => rows.filter((r) => r.tabs.includes(activeTab)),
    [rows, activeTab],
  );

  const summary: SummaryMetric[] = useMemo(() => {
    const total = tabRows.length;
    const dollars = tabRows.reduce((s, r) => s + (r.current.totalCharge || 0), 0);
    const ages = tabRows
      .map((r) => ageDays(r.current.createdAt))
      .filter((n): n is number => n != null);
    const oldest = ages.length > 0 ? Math.max(...ages) : 0;
    const urgent = tabRows.filter((r) => r.riskLevel === "high").length;
    return [
      { id: "count", label: "Potential duplicates", value: total.toLocaleString() },
      {
        id: "dollars",
        label: "Total charges",
        value: money(dollars),
        tone: dollars > 0 ? "amber" : "default",
      },
      {
        id: "oldest",
        label: "Oldest (days)",
        value: oldest,
        tone: oldest > 30 ? "red" : oldest > 14 ? "amber" : "default",
      },
      {
        id: "urgent",
        label: "Urgent (high risk)",
        value: urgent,
        tone: urgent > 0 ? "red" : "default",
      },
    ];
  }, [tabRows]);

  const columns: ColumnDef<DuplicateRow>[] = useMemo(
    () => [
      { id: "client", header: "Client", cell: (r) => r.clientName },
      { id: "dos", header: "DOS", cell: (r) => formatDate(r.dos) },
      { id: "clinician", header: "Clinician", cell: (r) => r.clinician },
      {
        id: "code",
        header: "Code",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{r.code}</span>
        ),
      },
      {
        id: "current",
        header: "Current claim",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {r.current.claimNumber}
          </span>
        ),
      },
      {
        id: "potential",
        header: "Potential duplicate claim",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {r.potential.claimNumber}
          </span>
        ),
      },
      {
        id: "origStatus",
        header: "Original status",
        cell: (r) => statusLabel(r.potential.status),
      },
      {
        id: "origPaid",
        header: "Original paid amount",
        align: "right",
        cell: (r) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {money(r.potential.paidAmount)}
          </span>
        ),
      },
      {
        id: "risk",
        header: "Risk level",
        cell: (r) => (
          <span
            style={{
              fontWeight: 600,
              color:
                r.riskLevel === "high"
                  ? "#B91C1C"
                  : r.riskLevel === "medium"
                  ? "#B45309"
                  : "#475569",
              textTransform: "capitalize",
            }}
          >
            {r.riskLevel}
          </span>
        ),
      },
      {
        id: "reason",
        header: "Match reason",
        cell: (r) => (
          <span style={{ color: "#0F172A", fontSize: 12.5 }}>{r.matchReason}</span>
        ),
      },
    ],
    [],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  const runAction = useCallback(
    async (
      row: DuplicateRow,
      action: "submit_anyway" | "void_duplicate" | "merge" | "hold" | "mark_not_duplicate",
      reason: string | null,
    ) => {
      setBusyAction(`${row.id}::${action}`);
      setError(null);
      setSuccess(null);
      try {
        const res = await fetch(
          `/api/billing/duplicate-claim-review/${encodeURIComponent(row.currentClaimId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              organizationId,
              action,
              otherClaimId: row.otherClaimId,
              reason,
            }),
          },
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Action failed");
        }
        // Optimistic update — drop the pair and its reverse from the list.
        setRows((prev) =>
          prev.filter(
            (r) =>
              !(r.currentClaimId === row.currentClaimId && r.otherClaimId === row.otherClaimId) &&
              !(r.currentClaimId === row.otherClaimId && r.otherClaimId === row.currentClaimId),
          ),
        );
        if (selectedRowId === row.id) setSelectedRowId(null);
        setSuccess(actionSuccessLabel(action));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusyAction(null);
        setReasonPrompt(null);
      }
    },
    [organizationId, selectedRowId],
  );

  const promptThen = useCallback(
    (
      row: DuplicateRow,
      action: "submit_anyway" | "void_duplicate" | "merge" | "hold" | "mark_not_duplicate",
      title: string,
      prompt: string,
    ) => {
      setReasonPrompt({
        title,
        prompt,
        run: (reason: string) => runAction(row, action, reason),
      });
    },
    [runAction],
  );

  const rowActions: RowAction<DuplicateRow>[] = useMemo(
    () => [
      {
        id: "submit",
        label: "Submit anyway",
        variant: "primary",
        onClick: (r) =>
          promptThen(
            r,
            "submit_anyway",
            "Submit anyway with reason",
            "Explain why this is not actually a duplicate so we keep a paper trail.",
          ),
      },
      {
        id: "void",
        label: "Void duplicate",
        variant: "danger",
        onClick: (r) =>
          promptThen(
            r,
            "void_duplicate",
            "Void as duplicate",
            "Add a reason — this voids and archives the current claim.",
          ),
      },
      {
        id: "merge",
        label: "Merge/reconcile",
        onClick: (r) =>
          promptThen(
            r,
            "merge",
            "Merge into the original claim",
            "We'll archive the current claim and add a reconciliation note on the original. Add a reason.",
          ),
      },
      {
        id: "hold",
        label: "Hold",
        onClick: (r) =>
          promptThen(r, "hold", "Hold for review", "Add a reason — this defers the claim for 30 days."),
      },
      {
        id: "notdup",
        label: "Mark not duplicate",
        onClick: (r) =>
          promptThen(
            r,
            "mark_not_duplicate",
            "Mark as not a duplicate",
            "Explain why these claims are distinct so other billers see your reasoning.",
          ),
      },
    ],
    [promptThen],
  );

  // ── Detail panel ─────────────────────────────────────────────────────────
  const selectedRow = useMemo(
    () => tabRows.find((r) => r.id === selectedRowId) ?? null,
    [tabRows, selectedRowId],
  );

  const detailTabs: DetailTab[] = useMemo(
    () => [
      {
        id: "compare",
        label: "Side-by-side claim comparison",
        render: () => (selectedRow ? <SideBySide row={selectedRow} /> : null),
      },
      {
        id: "appointment",
        label: "Appointment comparison",
        render: () =>
          selectedRow ? (
            <DetailSection
              title="Appointment context"
              note="When both claims trace back to an appointment, the encounter and provider on each side are shown here. If only one side has an appointment, the difference is highlighted below."
            >
              <KV label="Current claim DOS" value={formatDate(selectedRow.dos)} />
              <KV label="Current clinician" value={selectedRow.clinician} />
              <KV label="Potential duplicate claim" value={selectedRow.potential.claimNumber} />
              <KV label="Reason" value={selectedRow.matchReason} />
            </DetailSection>
          ) : null,
      },
      {
        id: "payments",
        label: "Payment history",
        render: () =>
          selectedRow ? (
            <DetailSection title="Payment history">
              <KV
                label="Current claim status"
                value={statusLabel(selectedRow.current.status)}
              />
              <KV
                label="Current claim charge"
                value={money(selectedRow.current.totalCharge)}
              />
              <KV
                label="Original claim status"
                value={statusLabel(selectedRow.potential.status)}
              />
              <KV
                label="Original paid amount"
                value={money(selectedRow.potential.paidAmount)}
              />
            </DetailSection>
          ) : null,
      },
      {
        id: "denials",
        label: "Prior denial history",
        render: () =>
          selectedRow ? (
            <DetailSection title="Prior denial history">
              {selectedRow.potential.status === "denied" ? (
                <KV
                  label="Original claim"
                  value={`${selectedRow.potential.claimNumber} — denied`}
                />
              ) : (
                <div style={{ color: "#64748B", fontSize: 13 }}>
                  No prior denial recorded against the matched claim.
                </div>
              )}
            </DetailSection>
          ) : null,
      },
    ],
    [selectedRow],
  );

  const detailActions: PrimaryAction[] = useMemo(() => {
    if (!selectedRow) return [];
    const r = selectedRow;
    return [
      {
        id: "submit",
        label: "Submit anyway with reason",
        variant: "primary",
        onClick: () =>
          promptThen(
            r,
            "submit_anyway",
            "Submit anyway with reason",
            "Explain why this is not actually a duplicate so we keep a paper trail.",
          ),
      },
      {
        id: "void",
        label: "Void duplicate",
        variant: "danger",
        onClick: () =>
          promptThen(
            r,
            "void_duplicate",
            "Void as duplicate",
            "Add a reason — this voids and archives the current claim.",
          ),
      },
      {
        id: "merge",
        label: "Merge/reconcile",
        onClick: () =>
          promptThen(
            r,
            "merge",
            "Merge into the original claim",
            "We'll archive the current claim and add a reconciliation note on the original.",
          ),
      },
      {
        id: "hold",
        label: "Hold",
        onClick: () => promptThen(r, "hold", "Hold for review", "Defer for 30 days. Add a reason."),
      },
      {
        id: "notdup",
        label: "Mark not duplicate",
        onClick: () =>
          promptThen(
            r,
            "mark_not_duplicate",
            "Mark as not a duplicate",
            "Explain why these claims are distinct.",
          ),
      },
      {
        id: "documents",
        label: "Related documents",
        render: () =>
          selectedRowId ? (
            <ClaimDocumentsPanel
              claimId={selectedRowId}
              organizationId={organizationId}
            />
          ) : null,
      },
    ];
  }, [selectedRow, selectedRowId, organizationId, promptThen]);

  // ── Header (tabs as primary actions) + message ───────────────────────────
  const headerActions: PrimaryAction[] = useMemo(
    () => [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        label: `${t.label} (${tabCounts[t.id]})`,
        variant: (activeTab === t.id ? "primary" : "default") as PrimaryAction["variant"],
        onClick: () => {
          setActiveTab(t.id);
          setSelectedRowId(null);
        },
      })),
      {
        id: "refresh",
        label: loading ? "Loading…" : "Refresh",
        onClick: () => void load(),
        disabled: loading,
      },
    ],
    [activeTab, tabCounts, loading, load],
  );

  const message = !organizationId
    ? {
        tone: "error" as const,
        text: "Missing organizationId. Add ?organizationId=… to the URL or configure NEXT_PUBLIC_ORGANIZATION_ID.",
      }
    : error
    ? { tone: "error" as const, text: error }
    : success
    ? { tone: "success" as const, text: success }
    : null;

  return (
    <>
      <WorkqueueShell<DuplicateRow>
        title={queueDef?.title ?? "Duplicate Claim Review"}
        description={queueDef?.description}
        headerActions={headerActions}
        summary={summary}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={setFilterValues}
        filterUrlNamespace="dup"
        rows={tabRows}
        columns={columns}
        rowId={(r) => r.id}
        rowActions={rowActions}
        loading={loading}
        emptyMessage="No potential duplicates in this bucket."
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRowId}
        detailTabs={detailTabs}
        detailActions={detailActions}
        message={message}
      />

      {reasonPrompt ? (
        <ReasonModal
          title={reasonPrompt.title}
          prompt={reasonPrompt.prompt}
          busy={busyAction != null}
          onClose={() => setReasonPrompt(null)}
          onConfirm={(reason) => void reasonPrompt.run(reason)}
        />
      ) : null}
    </>
  );
}

function actionSuccessLabel(
  action: "submit_anyway" | "void_duplicate" | "merge" | "hold" | "mark_not_duplicate",
): string {
  switch (action) {
    case "submit_anyway": return "Submitted with override reason.";
    case "void_duplicate": return "Claim voided as duplicate.";
    case "merge": return "Claims merged.";
    case "hold": return "Held for review.";
    case "mark_not_duplicate": return "Marked as not a duplicate.";
  }
}

// ─── Detail subcomponents ──────────────────────────────────────────────────

function SideBySide({ row }: { row: DuplicateRow }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <ClaimCard label="Current claim" value={row.current} risk={row.riskLevel} />
      <ClaimCard
        label="Potential duplicate"
        value={{
          ...row.potential,
          paidAmount: row.potential.paidAmount,
        }}
        showPaid
      />
      <div style={{ gridColumn: "1 / span 2" }}>
        <DetailSection title="Why they look like duplicates">
          <div style={{ color: "#0F172A", fontSize: 13 }}>{row.matchReason}</div>
        </DetailSection>
      </div>
    </div>
  );
}

function ClaimCard({
  label,
  value,
  showPaid,
  risk,
}: {
  label: string;
  value: {
    claimNumber: string;
    status: string;
    totalCharge: number;
    paidAmount?: number;
    createdAt: string | null;
  };
  showPaid?: boolean;
  risk?: DuplicateRow["riskLevel"];
}) {
  return (
    <div
      style={{
        border: "1px solid #E2E8F0",
        borderRadius: 8,
        padding: 12,
        background: "#F8FAFC",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "#64748B",
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        {label}
        {risk ? (
          <span
            style={{
              marginLeft: 8,
              padding: "1px 6px",
              borderRadius: 4,
              background:
                risk === "high" ? "#FEE2E2" : risk === "medium" ? "#FEF3C7" : "#E2E8F0",
              color:
                risk === "high" ? "#B91C1C" : risk === "medium" ? "#B45309" : "#475569",
              fontWeight: 600,
            }}
          >
            {risk.toUpperCase()}
          </span>
        ) : null}
      </div>
      <KV label="Claim #" value={value.claimNumber} mono />
      <KV label="Status" value={statusLabel(value.status)} />
      <KV label="Charge" value={money(value.totalCharge)} />
      {showPaid ? <KV label="Paid" value={money(value.paidAmount ?? 0)} /> : null}
      <KV label="Created" value={formatDate(value.createdAt)} />
    </div>
  );
}

function DetailSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h4
        style={{
          fontSize: 13,
          color: "#0F172A",
          margin: "0 0 6px",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {title}
      </h4>
      {note ? (
        <p style={{ color: "#64748B", fontSize: 12, marginTop: 0 }}>{note}</p>
      ) : null}
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        padding: "5px 0",
        borderBottom: "1px solid #F1F5F9",
      }}
    >
      <span style={{ color: "#64748B", fontWeight: 500 }}>{label}</span>
      <span
        style={{
          color: "#0F172A",
          textAlign: "right",
          maxWidth: "60%",
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
