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
import { getWorkqueue } from "@/lib/billing/workqueues";
import { ClaimDocumentsPanel } from "@/components/billing/ClaimDocumentsPanel";
import {
  ClaimDocumentUploadsOverlay,
  useClaimDocumentUploads,
} from "@/components/billing/ClaimDocumentUploads";

type Tab = "needed" | "replacement" | "void" | "ready" | "sent";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "needed", label: "Corrected Claim Needed" },
  { id: "replacement", label: "Replacement Claim" },
  { id: "void", label: "Void Claim" },
  { id: "ready", label: "Resubmission Ready" },
  { id: "sent", label: "Correction Sent" },
];

interface CorrectedRow {
  id: string;
  tab: Tab;
  tabs: Tab[];
  originalClaimId: string;
  correctedClaimId: string | null;
  clientId: string | null;
  clientName: string;
  clinician: string;
  payerId: string | null;
  payerName: string;
  dos: string | null;
  denialReason: string;
  denialCode: string;
  correctionType: "replacement" | "void" | null;
  correctionReason: string | null;
  frequencyCode: string;
  chargeAmount: number;
  status: string;
  correctionStatus: "pending" | "ready" | "sent" | null;
  createdAt: string | null;
  correctionSentAt: string | null;
  appealDeadlineDate: string | null;
  priority: "high" | "medium" | "low";
}

interface Facets {
  payers: Array<{ id: string; name: string }>;
  practices: Array<{ id: string; name: string }>;
  clinicians: string[];
}

interface ListPayload {
  success: boolean;
  error?: string;
  rows?: CorrectedRow[];
  facets?: Facets;
}

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

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const queueDef = getWorkqueue("corrected_claims");

function buildQuery(orgId: string, filters: Record<string, string>): string {
  const p = new URLSearchParams({ organizationId: orgId });
  for (const k of SERVER_FILTER_KEYS) {
    const v = filters[k];
    if (v && String(v).trim()) p.set(k, String(v).trim());
  }
  return p.toString();
}

// ─── Action modal (reason + optional correction-type / doc URL) ────────────

interface ModalConfig {
  title: string;
  prompt: string;
  needsReason: boolean;
  needsCorrectionType?: boolean;
  needsDocumentation?: boolean;
  run: (input: {
    reason: string;
    correctionType?: "replacement" | "void";
    documentation?: string;
  }) => Promise<void>;
}

function ActionModal({
  config,
  busy,
  onClose,
}: {
  config: ModalConfig;
  busy: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [correctionType, setCorrectionType] = useState<"replacement" | "void">(
    "replacement",
  );
  const [documentation, setDocumentation] = useState("");
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
          width: 520,
          maxWidth: "92vw",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>{config.title}</h2>
        <p style={{ color: "#475569", fontSize: 13, marginTop: 0 }}>{config.prompt}</p>

        {config.needsCorrectionType ? (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
              Correction type
            </label>
            <select
              value={correctionType}
              onChange={(e) =>
                setCorrectionType(e.target.value as "replacement" | "void")
              }
              style={{
                marginTop: 4,
                width: "100%",
                padding: 8,
                border: "1px solid #D1D5DB",
                borderRadius: 4,
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="replacement">Replacement (frequency 7)</option>
              <option value="void">Void (frequency 8)</option>
            </select>
          </div>
        ) : null}

        {config.needsDocumentation ? (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
              Documentation URL or description
            </label>
            <input
              value={documentation}
              onChange={(e) => setDocumentation(e.target.value)}
              autoFocus
              placeholder="e.g. https://… or 'Updated CPT with corrected modifier'"
              style={{
                marginTop: 4,
                width: "100%",
                padding: 8,
                border: "1px solid #D1D5DB",
                borderRadius: 4,
                boxSizing: "border-box",
              }}
            />
          </div>
        ) : null}

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          autoFocus={!config.needsDocumentation}
          placeholder={
            config.needsReason
              ? "Required — explain your decision"
              : "Optional context"
          }
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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
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
              if (config.needsReason && !reason.trim()) {
                setErr("A reason is required");
                return;
              }
              if (config.needsDocumentation && !documentation.trim()) {
                setErr("Documentation URL or description is required");
                return;
              }
              void config.run({
                reason: reason.trim(),
                correctionType: config.needsCorrectionType ? correctionType : undefined,
                documentation: config.needsDocumentation ? documentation.trim() : undefined,
              });
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

export default function CorrectedClaimsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const docUploads = useClaimDocumentUploads(organizationId);
  const [rows, setRows] = useState<CorrectedRow[]>([]);
  const [facets, setFacets] = useState<Facets>({
    payers: [],
    practices: [],
    clinicians: [],
  });
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("needed");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const queryString = useMemo(
    () => buildQuery(organizationId, filterValues),
    [organizationId, filterValues],
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/corrected-claims?${queryString}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ListPayload;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load corrected claims");
      }
      setRows(json.rows ?? []);
      if (json.facets) setFacets(json.facets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load corrected claims");
    } finally {
      setLoading(false);
    }
  }, [organizationId, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Filters ────────────────────────────────────────────────────────────
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
          { value: "rejected_oa", label: "Rejected (clearinghouse)" },
          { value: "rejected_payer", label: "Rejected (payer)" },
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

  // ── Tab partitioning ───────────────────────────────────────────────────
  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = {
      needed: 0,
      replacement: 0,
      void: 0,
      ready: 0,
      sent: 0,
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
    const dollars = tabRows.reduce((s, r) => s + (r.chargeAmount || 0), 0);
    const ages = tabRows
      .map((r) => ageDays(r.createdAt))
      .filter((n): n is number => n != null);
    const oldest = ages.length > 0 ? Math.max(...ages) : 0;
    const urgent = tabRows.filter((r) => r.priority === "high").length;
    return [
      { id: "count", label: "Total claims", value: total.toLocaleString() },
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
        tone: oldest > 60 ? "red" : oldest > 30 ? "amber" : "default",
      },
      {
        id: "urgent",
        label: "Urgent",
        value: urgent,
        tone: urgent > 0 ? "red" : "default",
      },
    ];
  }, [tabRows]);

  // ── Columns (spec order, exact labels) ─────────────────────────────────
  const columns: ColumnDef<CorrectedRow>[] = useMemo(
    () => [
      {
        id: "originalClaimId",
        header: "Original claim ID",
        cell: (r) => (
          <span
            style={{ fontFamily: "ui-monospace, monospace" }}
            title={r.originalClaimId}
          >
            {shortId(r.originalClaimId)}
          </span>
        ),
      },
      {
        id: "correctedClaimId",
        header: "Corrected claim ID",
        cell: (r) => (
          <span
            style={{ fontFamily: "ui-monospace, monospace" }}
            title={r.correctedClaimId ?? "—"}
          >
            {shortId(r.correctedClaimId)}
          </span>
        ),
      },
      { id: "client", header: "Client", cell: (r) => r.clientName },
      { id: "payer", header: "Payer", cell: (r) => r.payerName },
      { id: "dos", header: "DOS", cell: (r) => formatDate(r.dos) },
      {
        id: "denial",
        header: "Original denial/rejection reason",
        cell: (r) => (
          <span style={{ fontSize: 12.5 }}>
            {r.denialCode ? (
              <span
                style={{
                  display: "inline-block",
                  marginRight: 6,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "#FEE2E2",
                  color: "#B91C1C",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 11,
                }}
              >
                {r.denialCode}
              </span>
            ) : null}
            {r.denialReason}
          </span>
        ),
      },
      {
        id: "correctionType",
        header: "Correction type",
        cell: (r) =>
          r.correctionType
            ? r.correctionType === "void"
              ? "Void"
              : "Replacement"
            : "—",
      },
      {
        id: "frequency",
        header: "Frequency code",
        align: "center",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {r.frequencyCode}
          </span>
        ),
      },
      {
        id: "charge",
        header: "Charge amount",
        align: "right",
        cell: (r) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {money(r.chargeAmount)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => (
          <span
            style={{
              textTransform: "capitalize",
              fontWeight: 500,
              color:
                r.status === "denied" || r.status.startsWith("rejected")
                  ? "#B91C1C"
                  : r.status === "paid"
                  ? "#047857"
                  : "#0F172A",
            }}
          >
            {statusLabel(r.status)}
            {r.correctionStatus ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  color: "#475569",
                  fontWeight: 600,
                }}
              >
                · {r.correctionStatus}
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  );

  // ── Actions ────────────────────────────────────────────────────────────
  const runAction = useCallback(
    async (
      row: CorrectedRow,
      action:
        | "create_corrected"
        | "submit_replacement"
        | "submit_void"
        | "attach_documentation"
        | "mark_complete"
        | "dismiss",
      input: {
        reason?: string;
        correctionType?: "replacement" | "void";
        documentation?: string;
      },
    ) => {
      // Endpoint claimId:
      //   - create_corrected & dismiss target the ORIGINAL claim.
      //   - everything else targets the child corrected claim (when one
      //     exists) else falls back to the original.
      const targetId =
        action === "create_corrected" || action === "dismiss"
          ? row.originalClaimId
          : row.correctedClaimId ?? row.originalClaimId;

      setBusyAction(`${row.id}::${action}`);
      setError(null);
      setSuccess(null);
      try {
        const res = await fetch(
          `/api/billing/corrected-claims/${encodeURIComponent(targetId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              organizationId,
              action,
              correctionType: input.correctionType,
              reason: input.reason ?? null,
              documentation: input.documentation ?? null,
            }),
          },
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Action failed");
        }
        // Optimistic update — patch the row in place so the table reflects
        // the new state without waiting for a full re-fetch.
        setRows((prev) => {
          const next = [...prev];
          const idx = next.findIndex((r) => r.id === row.id);
          if (idx === -1) return next;
          const current = next[idx];
          if (action === "create_corrected") {
            // Drop the original from "needed" — a child row will appear after
            // the background reload kicks in.
            next.splice(idx, 1);
          } else if (action === "submit_replacement") {
            next[idx] = {
              ...current,
              correctionType: "replacement",
              correctionStatus: "sent",
              correctionSentAt: new Date().toISOString(),
              frequencyCode: "7",
              status: "ready_for_batch",
              tab: "sent",
              tabs: ["sent"],
            };
          } else if (action === "submit_void") {
            next[idx] = {
              ...current,
              correctionType: "void",
              correctionStatus: "sent",
              correctionSentAt: new Date().toISOString(),
              frequencyCode: "8",
              status: "ready_for_batch",
              tab: "sent",
              tabs: ["sent"],
            };
          } else if (action === "mark_complete") {
            if (current.correctedClaimId) {
              next[idx] = {
                ...current,
                correctionStatus: "sent",
                correctionSentAt: new Date().toISOString(),
                tab: "sent",
                tabs: ["sent"],
              };
            } else {
              next.splice(idx, 1);
            }
          } else if (action === "dismiss") {
            next.splice(idx, 1);
          }
          return next;
        });
        setSuccess(actionSuccessLabel(action));
        // Re-fetch in the background to pick up the newly-created child row.
        if (action === "create_corrected") void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusyAction(null);
        setModal(null);
      }
    },
    [organizationId, load],
  );

  const openModal = useCallback(
    (
      row: CorrectedRow,
      action:
        | "create_corrected"
        | "submit_replacement"
        | "submit_void"
        | "attach_documentation"
        | "mark_complete"
        | "dismiss",
    ) => {
      const labels = MODAL_COPY[action];
      setModal({
        title: labels.title,
        prompt: labels.prompt,
        needsReason: labels.needsReason,
        needsCorrectionType: action === "create_corrected",
        needsDocumentation: action === "attach_documentation",
        run: (input) => runAction(row, action, input),
      });
    },
    [runAction],
  );

  const rowActions: RowAction<CorrectedRow>[] = useMemo(
    () => [
      {
        id: "create",
        label: "Create corrected claim",
        variant: "primary",
        disabled: (r) => r.correctedClaimId != null,
        onClick: (r) => openModal(r, "create_corrected"),
      },
      {
        id: "replacement",
        label: "Submit replacement",
        disabled: (r) => r.correctedClaimId == null || r.correctionStatus === "sent",
        onClick: (r) => openModal(r, "submit_replacement"),
      },
      {
        id: "void",
        label: "Submit void",
        variant: "danger",
        disabled: (r) => r.correctedClaimId == null || r.correctionStatus === "sent",
        onClick: (r) => openModal(r, "submit_void"),
      },
      {
        id: "doc",
        label: "Attach documentation",
        onClick: (r) => openModal(r, "attach_documentation"),
      },
      {
        id: "complete",
        label: "Mark complete",
        variant: "success",
        onClick: (r) => openModal(r, "mark_complete"),
      },
    ],
    [openModal],
  );

  // ── Detail panel ───────────────────────────────────────────────────────
  const selectedRow = useMemo(
    () => tabRows.find((r) => r.id === selectedRowId) ?? null,
    [tabRows, selectedRowId],
  );

  const detailTabs: DetailTab[] = useMemo(
    () => [
      {
        id: "compare",
        label: "Original vs corrected claim",
        render: () =>
          selectedRow ? (
            <DetailSection title="Original vs corrected claim">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ClaimCard
                  label="Original claim"
                  claimId={selectedRow.originalClaimId}
                  status={selectedRow.status}
                  charge={selectedRow.chargeAmount}
                  frequencyCode={selectedRow.correctedClaimId ? "1" : selectedRow.frequencyCode}
                />
                <ClaimCard
                  label="Corrected claim"
                  claimId={selectedRow.correctedClaimId}
                  status={selectedRow.correctedClaimId ? selectedRow.status : "—"}
                  charge={selectedRow.correctedClaimId ? selectedRow.chargeAmount : 0}
                  frequencyCode={selectedRow.correctedClaimId ? selectedRow.frequencyCode : "—"}
                  placeholder={
                    selectedRow.correctedClaimId
                      ? undefined
                      : "Click \"Create corrected claim\" to begin."
                  }
                />
              </div>
            </DetailSection>
          ) : null,
      },
      {
        id: "reason",
        label: "Correction reason",
        render: () =>
          selectedRow ? (
            <DetailSection title="Correction reason">
              {selectedRow.correctionReason ? (
                <p style={{ color: "#0F172A", fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {selectedRow.correctionReason}
                </p>
              ) : (
                <p style={{ color: "#64748B", fontSize: 13 }}>
                  No correction reason captured yet. Reasons are recorded when a
                  corrected claim is created or submitted.
                </p>
              )}
            </DetailSection>
          ) : null,
      },
      {
        id: "priorResponse",
        label: "Prior payer response",
        render: () =>
          selectedRow ? (
            <DetailSection title="Prior payer response">
              <KV label="Status" value={statusLabel(selectedRow.status)} />
              {selectedRow.denialCode ? (
                <KV label="Denial / rejection code" value={selectedRow.denialCode} mono />
              ) : null}
              <KV label="Reason" value={selectedRow.denialReason} />
              <KV
                label="Appeal deadline"
                value={formatDate(selectedRow.appealDeadlineDate)}
              />
            </DetailSection>
          ) : null,
      },
      {
        id: "frequency",
        label: "Claim frequency code",
        render: () =>
          selectedRow ? (
            <DetailSection
              title="Claim frequency code"
              note="X12 1000A CLM05-3 — 1 = Original, 7 = Replacement, 8 = Void/Cancel."
            >
              <KV label="Current frequency" value={selectedRow.frequencyCode} mono />
              <KV
                label="Correction type"
                value={
                  selectedRow.correctionType === "void"
                    ? "Void (frequency 8)"
                    : selectedRow.correctionType === "replacement"
                    ? "Replacement (frequency 7)"
                    : "—"
                }
              />
              <KV
                label="Correction status"
                value={selectedRow.correctionStatus ?? "—"}
              />
            </DetailSection>
          ) : null,
      },
      {
        id: "documents",
        label: "Related documents",
        render: () =>
          selectedRow ? (
            <ClaimDocumentsPanel
              claimId={selectedRow.correctedClaimId ?? selectedRow.originalClaimId}
              organizationId={organizationId}
            />
          ) : null,
      },
      {
        id: "history",
        label: "Resubmission history",
        render: () =>
          selectedRow ? (
            <DetailSection title="Resubmission history">
              <KV
                label="Original created"
                value={formatDate(selectedRow.createdAt)}
              />
              <KV
                label="Original ID"
                value={selectedRow.originalClaimId}
                mono
              />
              <KV
                label="Corrected claim ID"
                value={selectedRow.correctedClaimId ?? "Not yet created"}
                mono
              />
              <KV
                label="Correction sent at"
                value={formatDate(selectedRow.correctionSentAt)}
              />
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
        id: "create",
        label: "Create corrected claim",
        variant: "primary",
        disabled: r.correctedClaimId != null,
        onClick: () => openModal(r, "create_corrected"),
      },
      {
        id: "replacement",
        label: "Submit replacement",
        disabled: r.correctedClaimId == null || r.correctionStatus === "sent",
        onClick: () => openModal(r, "submit_replacement"),
      },
      {
        id: "void",
        label: "Submit void",
        variant: "danger",
        disabled: r.correctedClaimId == null || r.correctionStatus === "sent",
        onClick: () => openModal(r, "submit_void"),
      },
      {
        id: "doc",
        label: "Attach documentation",
        onClick: () => openModal(r, "attach_documentation"),
      },
      {
        id: "complete",
        label: "Mark complete",
        variant: "success",
        onClick: () => openModal(r, "mark_complete"),
      },
    ];
  }, [selectedRow, openModal]);

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
        text:
          "Missing organizationId. Add ?organizationId=… to the URL or configure NEXT_PUBLIC_ORGANIZATION_ID.",
      }
    : error
    ? { tone: "error" as const, text: error }
    : success
    ? { tone: "success" as const, text: success }
    : null;

  return (
    <>
      <WorkqueueShell<CorrectedRow>
        title={queueDef?.title ?? "Corrected Claims"}
        description={queueDef?.description}
        headerActions={headerActions}
        summary={summary}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={setFilterValues}
        filterUrlNamespace="corr"
        rows={tabRows}
        columns={columns}
        rowId={(r) => r.id}
        rowActions={rowActions}
        loading={loading}
        emptyMessage="Nothing in this tab."
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRowId}
        detailTabs={detailTabs}
        detailActions={detailActions}
        message={message}
        onRowDrop={(row, files) => {
          const targetClaimId = row.correctedClaimId ?? row.originalClaimId;
          const label = `Claim ${shortId(row.originalClaimId)}${
            row.payerName ? ` · ${row.payerName}` : ""
          }`;
          docUploads.uploadFiles(targetClaimId, label, files);
        }}
      />
      <ClaimDocumentUploadsOverlay
        uploads={docUploads.uploads}
        onDismiss={docUploads.dismiss}
      />

      {modal ? (
        <ActionModal
          config={modal}
          busy={busyAction != null}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

// ─── Modal copy + success labels ──────────────────────────────────────────

const MODAL_COPY: Record<
  | "create_corrected"
  | "submit_replacement"
  | "submit_void"
  | "attach_documentation"
  | "mark_complete"
  | "dismiss",
  { title: string; prompt: string; needsReason: boolean }
> = {
  create_corrected: {
    title: "Create corrected claim",
    prompt:
      "We'll clone the original claim into a new draft tied to it. Choose replacement (frequency 7) for a corrected resubmission, or void (frequency 8) to cancel the prior payment.",
    needsReason: true,
  },
  submit_replacement: {
    title: "Submit replacement (frequency 7)",
    prompt:
      "Sets the corrected claim to frequency code 7 and moves it to ready_for_batch so it transmits with the next batch.",
    needsReason: false,
  },
  submit_void: {
    title: "Submit void (frequency 8)",
    prompt:
      "Sets the corrected claim to frequency code 8 and moves it to ready_for_batch to cancel the prior claim.",
    needsReason: false,
  },
  attach_documentation: {
    title: "Attach documentation",
    prompt:
      "Record the supporting documentation URL or short description. We'll append it to the claim notes so the audit trail captures what was submitted.",
    needsReason: false,
  },
  mark_complete: {
    title: "Mark correction complete",
    prompt:
      "Closes this item out of the queue. On a child correction, the status moves to sent. On an unresolved original, the original is archived.",
    needsReason: false,
  },
  dismiss: {
    title: "Dismiss from queue",
    prompt:
      "Removes this original from the Corrected Claim queue without creating a correction. Add a reason for the audit trail.",
    needsReason: true,
  },
};

function actionSuccessLabel(
  action:
    | "create_corrected"
    | "submit_replacement"
    | "submit_void"
    | "attach_documentation"
    | "mark_complete"
    | "dismiss",
): string {
  switch (action) {
    case "create_corrected": return "Corrected claim created.";
    case "submit_replacement": return "Replacement submitted (frequency 7).";
    case "submit_void": return "Void submitted (frequency 8).";
    case "attach_documentation": return "Documentation attached.";
    case "mark_complete": return "Correction marked complete.";
    case "dismiss": return "Dismissed from queue.";
  }
}

// ─── Detail subcomponents ──────────────────────────────────────────────────

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

function ClaimCard({
  label,
  claimId,
  status,
  charge,
  frequencyCode,
  placeholder,
}: {
  label: string;
  claimId: string | null;
  status: string;
  charge: number;
  frequencyCode: string;
  placeholder?: string;
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
      </div>
      {placeholder ? (
        <div style={{ fontSize: 13, color: "#64748B" }}>{placeholder}</div>
      ) : (
        <>
          <KV label="Claim ID" value={claimId ?? "—"} mono />
          <KV label="Status" value={statusLabel(status)} />
          <KV label="Frequency" value={frequencyCode} />
          <KV label="Charge" value={money(charge)} />
        </>
      )}
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
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}
