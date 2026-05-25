"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_ORG_ID } from "@/lib/config";
import WorkqueueShell, {
  type ColumnDef,
  type DetailTab,
  type FilterDef,
  type PrimaryAction,
  type PrimaryTab,
  type RowAction,
  type SummaryMetric,
} from "@/components/billing/WorkqueueShell";
import { getWorkqueue } from "@/lib/billing/workqueues";
import { ClaimDocumentsPanel } from "@/components/billing/ClaimDocumentsPanel";
import {
  TRANSMISSION_FAILURE_TABS,
  describeFailureTab,
  type TransmissionFailureTabId,
} from "@/lib/billing/transmissionFailures";

interface ClaimSummary {
  id: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  totalCharge: number;
  status: string;
  earliestDos: string | null;
}

interface AttemptHistoryEntry {
  id: string;
  attemptNumber: number;
  attemptedAt: string | null;
  endpoint: string | null;
  httpStatus: number | null;
  idempotencyKey: string | null;
  externalTransactionId: string | null;
  outcome: "success" | "failure" | string;
  errorMessage: string | null;
  responseExcerpt: string | null;
  actorDisplayName: string | null;
}

interface EscalationSummary {
  id: string;
  status: string;
  priority: string;
  note: string | null;
  assigneeUserId: string | null;
  assigneeDisplayName: string | null;
  openedAt: string;
  openedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

interface FailureRow {
  id: string;
  batchNumber: string;
  batchStatus: string;
  tab: TransmissionFailureTabId;
  claimCount: number;
  totalCharges: number;
  errorMessage: string;
  attemptCount: number;
  attemptedAt: string | null;
  agingDays: number | null;
  lastEndpoint: string | null;
  lastHttpStatus: number | null;
  availityTransactionId: string | null;
  idempotencyKey: string | null;
  generatedFileName: string | null;
  createdAt: string;
  updatedAt: string;
  claims: ClaimSummary[];
  practiceName: string | null;
  clinicianName: string | null;
  attempts: AttemptHistoryEntry[];
  assignedToUserId: string | null;
  assignedToDisplayName: string | null;
  openEscalation: EscalationSummary | null;
}

interface Assignee {
  id: string;
  displayName: string;
}

interface ApiPayload {
  success: boolean;
  error?: string;
  items?: FailureRow[];
  assignees?: Assignee[];
}

interface EscalationDraft {
  row: FailureRow;
  assigneeUserId: string;
  priority: "low" | "normal" | "high" | "urgent";
  note: string;
}

function getOrganizationId(): string {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function money(value: number): string {
  return Number(value ?? 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function ciContains(haystack: string | null, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === "rejected" || s === "failed" || s === "transmission_failed") return "#c53030";
  if (s === "ready_to_generate" || s === "generated") return "#2563eb";
  return "#64748B";
}

const queueDef = getWorkqueue("transmission_failures");

export default function TransmissionFailuresClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [items, setItems] = useState<FailureRow[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<TransmissionFailureTabId>(
    TRANSMISSION_FAILURE_TABS[0].id,
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [escalationDraft, setEscalationDraft] = useState<EscalationDraft | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({ organizationId });
    for (const [k, v] of Object.entries(filterValues)) {
      if (v) qs.set(k, v);
    }
    fetch(`/api/billing/transmission-failures?${qs.toString()}`, {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<ApiPayload>)
      .then((json) => {
        if (json.success && Array.isArray(json.items)) {
          setItems(json.items);
          if (Array.isArray(json.assignees)) setAssignees(json.assignees);
        } else {
          setItems([]);
          if (json.error) setMessage({ tone: "error", text: json.error });
        }
      })
      .catch((e) => {
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Failed to load",
        });
      })
      .finally(() => setLoading(false));
  }, [organizationId, reloadKey, filterValues]);

  // ── Filter rail ─────────────────────────────────────────────────────────
  const payerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of items) {
      for (const c of r.claims) {
        if (c.payerId && c.payerName) map.set(c.payerId, c.payerName);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of items) {
      for (const c of r.claims) {
        if (c.clientId && c.clientName) map.set(c.clientId, c.clientName);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

  const filters: FilterDef[] = useMemo(
    () => [
      { id: "practice", label: "Practice", kind: "text", placeholder: "Service location…" },
      { id: "clinician", label: "Clinician", kind: "text", placeholder: "Rendering provider…" },
      { id: "payer", label: "Payer", kind: "select", options: payerOptions },
      { id: "client", label: "Client", kind: "select", options: clientOptions },
      { id: "dosFrom", label: "DOS from", kind: "date" },
      { id: "dosTo", label: "DOS to", kind: "date" },
      {
        id: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "rejected", label: "Rejected" },
          { value: "failed", label: "Failed" },
          { value: "ready_to_generate", label: "Re-queued" },
        ],
      },
      {
        id: "assignedBiller",
        label: "Assigned biller",
        kind: "select",
        options: [
          { value: "__unassigned__", label: "Unassigned" },
          ...assignees.map((a) => ({ value: a.id, label: a.displayName })),
        ],
      },
      { id: "minAmount", label: "Min $", kind: "number", placeholder: "0" },
      { id: "maxAmount", label: "Max $", kind: "number" },
      {
        id: "agingBucket",
        label: "Aging",
        kind: "select",
        options: [
          { value: "0-7", label: "0-7 days" },
          { value: "8-30", label: "8-30 days" },
          { value: "31-60", label: "31-60 days" },
          { value: "60+", label: "60+ days" },
        ],
      },
      { id: "carcRarc", label: "CARC/RARC", kind: "text", placeholder: "Error or endpoint…" },
      {
        id: "priority",
        label: "Priority",
        kind: "select",
        options: [
          { value: "urgent", label: "Urgent" },
          { value: "normal", label: "Normal" },
        ],
      },
      { id: "followUpDue", label: "Follow-up due", kind: "date" },
    ],
    [payerOptions, clientOptions],
  );

  // ── Tab narrowing then client-side filter pass for universal rail ───────
  const tabRows = useMemo(
    () => items.filter((r) => r.tab === activeTab),
    [items, activeTab],
  );

  const filtered = useMemo(() => {
    const v = filterValues;
    return tabRows.filter((r) => {
      if (v.payer && !r.claims.some((c) => c.payerId === v.payer)) return false;
      if (v.client && !r.claims.some((c) => c.clientId === v.client)) return false;
      if (v.status && r.batchStatus.toLowerCase() !== v.status.toLowerCase()) return false;
      if (v.minAmount) {
        const n = Number(v.minAmount);
        if (Number.isFinite(n) && r.totalCharges < n) return false;
      }
      if (v.maxAmount) {
        const n = Number(v.maxAmount);
        if (Number.isFinite(n) && r.totalCharges > n) return false;
      }
      if (v.agingBucket) {
        const a = r.agingDays ?? 0;
        const ok =
          v.agingBucket === "0-7" ? a <= 7
          : v.agingBucket === "8-30" ? a >= 8 && a <= 30
          : v.agingBucket === "31-60" ? a >= 31 && a <= 60
          : v.agingBucket === "60+" ? a > 60
          : true;
        if (!ok) return false;
      }
      if (v.priority === "urgent" && (r.agingDays ?? 0) <= 3) return false;
      if (v.practice && !ciContains(r.practiceName, v.practice)) return false;
      if (v.clinician && !ciContains(r.clinicianName, v.clinician)) return false;
      if (v.carcRarc) {
        if (
          !ciContains(r.errorMessage, v.carcRarc) &&
          !ciContains(r.lastEndpoint, v.carcRarc)
        ) return false;
      }
      if (v.dosFrom || v.dosTo) {
        const anyMatch = r.claims.some((c) => {
          if (!c.earliestDos) return false;
          if (v.dosFrom && c.earliestDos < v.dosFrom) return false;
          if (v.dosTo && c.earliestDos > v.dosTo) return false;
          return true;
        });
        if (!anyMatch) return false;
      }
      // assignedBiller is pushed down at the server (matches the
      // batch's assigned_to_user_id, or the "__unassigned__" sentinel)
      // so there is nothing left to enforce client-side.
      if (v.followUpDue) {
        // Last attempt date is the implied follow-up anchor for batches.
        const attemptDate = r.attemptedAt ? r.attemptedAt.slice(0, 10) : null;
        if (attemptDate !== v.followUpDue) return false;
      }
      return true;
    });
  }, [tabRows, filterValues]);

  // ── Summary strip ───────────────────────────────────────────────────────
  const summary: SummaryMetric[] = useMemo(() => {
    const dollars = tabRows.reduce((s, r) => s + (r.totalCharges || 0), 0);
    const ages = tabRows
      .map((r) => r.agingDays)
      .filter((n): n is number => n != null);
    const oldest = ages.length ? Math.max(...ages) : 0;
    const urgent = tabRows.filter((r) => (r.agingDays ?? 0) > 3).length;
    return [
      { id: "count", label: "Failed batches", value: tabRows.length.toLocaleString() },
      { id: "dollars", label: "Total $", value: money(dollars) },
      {
        id: "oldest",
        label: "Oldest (days)",
        value: oldest,
        tone: oldest > 7 ? "red" : oldest > 3 ? "amber" : "default",
      },
      {
        id: "urgent",
        label: "Urgent",
        value: urgent,
        tone: urgent > 0 ? "amber" : "default",
      },
    ];
  }, [tabRows]);

  // ── Columns: match spec exactly ─────────────────────────────────────────
  const columns: ColumnDef<FailureRow>[] = useMemo(
    () => [
      {
        id: "batchId",
        header: "Batch ID",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
            {r.batchNumber || r.id.slice(0, 8)}
          </span>
        ),
      },
      {
        id: "claimCount",
        header: "Claim count",
        align: "right",
        cell: (r) => r.claimCount.toLocaleString(),
      },
      {
        id: "failureType",
        header: "Failure type",
        cell: (r) => (
          <span style={{ fontSize: 12 }}>
            {TRANSMISSION_FAILURE_TABS.find((t) => t.id === r.tab)?.label ?? r.tab}
          </span>
        ),
      },
      {
        id: "errorMessage",
        header: "Error message",
        cell: (r) => (
          <span
            title={r.errorMessage}
            style={{
              display: "inline-block",
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12,
              color: "#475569",
            }}
          >
            {r.errorMessage}
          </span>
        ),
      },
      {
        id: "attemptTime",
        header: "Attempt time",
        cell: (r) => formatDateTime(r.attemptedAt),
      },
      {
        id: "retryCount",
        header: "Retry count",
        align: "right",
        cell: (r) => r.attemptCount.toLocaleString(),
      },
      {
        id: "totalCharges",
        header: "Total charges affected",
        align: "right",
        cell: (r) => money(r.totalCharges),
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: statusTone(r.batchStatus),
              color: "white",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {r.batchStatus || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  // ── Selection ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedRowId) return;
    if (!filtered.some((r) => r.id === selectedRowId)) setSelectedRowId(null);
  }, [filtered, selectedRowId]);

  const selectedRow = useMemo(
    () => filtered.find((r) => r.id === selectedRowId) ?? null,
    [filtered, selectedRowId],
  );

  // ── Actions: optimistic patch + server call ─────────────────────────────
  type ActionId = "retry" | "rebuild" | "escalate" | "resolve_escalation";
  interface ExtraArgs {
    note?: string;
    assigneeUserId?: string | null;
    assigneeDisplayName?: string | null;
    priority?: string;
    resolutionNote?: string;
  }

  const applyOptimistic = useCallback(
    (batchId: string, action: ActionId, extra?: ExtraArgs): FailureRow[] => {
      let snapshot: FailureRow[] = [];
      setItems((prev) => {
        snapshot = prev;
        if (action === "retry") return prev;
        return prev.map((r) => {
          if (r.id !== batchId) return r;
          if (action === "rebuild") {
            return {
              ...r,
              batchStatus: "ready_to_generate",
              errorMessage: "Re-queued for rebuild",
              attemptCount: 0,
            };
          }
          if (action === "escalate") {
            const assigneeId = extra?.assigneeUserId ?? null;
            const assigneeName = extra?.assigneeDisplayName ?? null;
            return {
              ...r,
              assignedToUserId: assigneeId,
              assignedToDisplayName: assigneeName,
              openEscalation: {
                id: "pending",
                status: "open",
                priority: extra?.priority ?? "normal",
                note: extra?.note ?? null,
                assigneeUserId: assigneeId,
                assigneeDisplayName: assigneeName,
                openedAt: new Date().toISOString(),
                openedByUserId: null,
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
              },
            };
          }
          if (action === "resolve_escalation") {
            return {
              ...r,
              assignedToUserId: null,
              assignedToDisplayName: null,
              openEscalation: null,
            };
          }
          return r;
        });
      });
      return snapshot;
    },
    [],
  );

  const runAction = useCallback(
    async (
      batchId: string,
      action: ActionId,
      extra?: ExtraArgs,
    ) => {
      setBusyId(batchId);
      setMessage(null);
      const snapshot = applyOptimistic(batchId, action, extra);
      try {
        const res = await fetch(
          `/api/billing/transmission-failures/${encodeURIComponent(batchId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId, action, ...(extra ?? {}) }),
          },
        );
        const json = await res.json();
        if (!res.ok || json.success === false) {
          throw new Error(json.error || "Action failed");
        }
        const label =
          action === "retry"
            ? "Retry transmitted."
            : action === "rebuild"
              ? "Batch re-queued for rebuild."
              : action === "resolve_escalation"
                ? "Escalation resolved."
                : extra?.assigneeDisplayName
                  ? `Escalation assigned to ${extra.assigneeDisplayName}.`
                  : "Escalation opened (unassigned).";
        setMessage({ tone: "success", text: label });
        setReloadKey((k) => k + 1);
      } catch (e) {
        setItems(snapshot);
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Action failed",
        });
      } finally {
        setBusyId(null);
      }
    },
    [organizationId, applyOptimistic],
  );

  const removeClaim = useCallback(
    async (batchId: string, claimId: string) => {
      setBusyId(batchId);
      setMessage(null);
      let snapshot: FailureRow[] = [];
      setItems((prev) => {
        snapshot = prev;
        return prev.map((r) => {
          if (r.id !== batchId) return r;
          const removed = r.claims.find((c) => c.id === claimId);
          if (!removed) return r;
          const nextClaims = r.claims.filter((c) => c.id !== claimId);
          return {
            ...r,
            claims: nextClaims,
            claimCount: Math.max(0, r.claimCount - 1),
            totalCharges: Math.max(
              0,
              Math.round((r.totalCharges - removed.totalCharge) * 100) / 100,
            ),
          };
        });
      });
      try {
        const res = await fetch(
          `/api/billing/transmission-failures/${encodeURIComponent(batchId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              organizationId,
              action: "remove_claim",
              claimId,
            }),
          },
        );
        const json = await res.json();
        if (!res.ok || json.success === false) {
          throw new Error(json.error || "Remove failed");
        }
        setMessage({ tone: "success", text: "Claim removed from batch." });
        setReloadKey((k) => k + 1);
      } catch (e) {
        setItems(snapshot);
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Remove failed",
        });
      } finally {
        setBusyId(null);
      }
    },
    [organizationId],
  );

  const openEscalateModal = useCallback((row: FailureRow) => {
    setEscalationDraft({
      row,
      assigneeUserId: row.assignedToUserId ?? "",
      priority: (row.openEscalation?.priority as EscalationDraft["priority"]) ?? "normal",
      note: "",
    });
  }, []);

  const submitEscalation = useCallback(
    async (draft: EscalationDraft) => {
      const assignee = assignees.find((a) => a.id === draft.assigneeUserId) ?? null;
      setEscalationDraft(null);
      await runAction(draft.row.id, "escalate", {
        note: draft.note.trim(),
        priority: draft.priority,
        assigneeUserId: assignee?.id ?? null,
        assigneeDisplayName: assignee?.displayName ?? null,
      });
    },
    [assignees, runAction],
  );

  const resolveEscalation = useCallback(
    (row: FailureRow) => {
      if (!row.openEscalation) return;
      void runAction(row.id, "resolve_escalation", {});
    },
    [runAction],
  );

  // ── Remove-failed-claim from a row: 0 claims = no-op; 1 claim removes
  // it directly; N claims prompts the user to pick which claim number to
  // pull out of the batch (the per-claim Remove button on the Affected
  // Claims detail tab remains for inline access). Confirms before
  // archiving so a misclick can't silently shrink a batch.
  const promptRemoveClaim = useCallback(
    (r: FailureRow) => {
      if (typeof window === "undefined") return;
      if (r.claims.length === 0) {
        window.alert("No claims are linked to this batch.");
        return;
      }
      let target = r.claims[0];
      if (r.claims.length > 1) {
        const labels = r.claims
          .map(
            (c, i) =>
              `${i + 1}. ${c.claimNumber ?? c.id.slice(0, 8)} — ${c.clientName} (${money(c.totalCharge)})`,
          )
          .join("\n");
        const choice = window.prompt(
          `This batch has ${r.claims.length} claims. Enter the number of the claim to remove:\n\n${labels}`,
          "1",
        );
        if (!choice) return;
        const idx = Number(choice.trim()) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= r.claims.length) {
          window.alert("Invalid selection.");
          return;
        }
        target = r.claims[idx];
      }
      const ok = window.confirm(
        `Remove claim ${target.claimNumber ?? target.id.slice(0, 8)} (${target.clientName}) from batch ${r.batchNumber || r.id.slice(0, 8)}?`,
      );
      if (!ok) return;
      void removeClaim(r.id, target.id);
    },
    [removeClaim],
  );

  // ── Row actions ─────────────────────────────────────────────────────────
  const rowActions: RowAction<FailureRow>[] = useMemo(
    () => [
      {
        id: "retry",
        label: "Retry transmission",
        variant: "primary",
        onClick: (r) => void runAction(r.id, "retry"),
        disabled: (r) => busyId === r.id,
      },
      {
        id: "rebuild",
        label: "Rebuild batch",
        onClick: (r) => void runAction(r.id, "rebuild"),
        disabled: (r) =>
          busyId === r.id || r.batchStatus.toLowerCase() === "ready_to_generate",
      },
      {
        id: "remove_claim",
        label: "Remove failed claim",
        onClick: (r) => promptRemoveClaim(r),
        disabled: (r) => busyId === r.id || r.claims.length === 0,
      },
      {
        id: "escalate",
        label: "Escalate / reassign…",
        variant: "danger",
        onClick: (r) => openEscalateModal(r),
        disabled: (r) => busyId === r.id,
      },
      {
        id: "resolve_escalation",
        label: "Resolve escalation",
        onClick: (r) => resolveEscalation(r),
        disabled: (r) => busyId === r.id || !r.openEscalation,
      },
    ],
    [busyId, runAction, openEscalateModal, resolveEscalation, promptRemoveClaim],
  );

  // ── Detail panel ────────────────────────────────────────────────────────
  const detailTabs: DetailTab[] = useMemo(() => {
    if (!selectedRow) return [];
    const r = selectedRow;
    const esc = r.openEscalation;
    return [
      {
        id: "errorLog",
        label: "Technical error log",
        render: () => (
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
                {TRANSMISSION_FAILURE_TABS.find((t) => t.id === r.tab)?.label ?? r.tab}
              </h3>
              <p style={{ margin: 0, fontSize: 12.5, color: "#475569" }}>
                {describeFailureTab(r.tab)}
              </p>
            </div>
            <div
              style={{
                padding: 10,
                border: `1px solid ${esc ? "#fcd34d" : "#e2e8f0"}`,
                background: esc ? "#fffbeb" : "#f8fafc",
                borderRadius: 6,
                display: "grid",
                gap: 6,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13 }}>
                  {esc ? "Escalation open" : "No escalation open"}
                </strong>
                {esc ? (
                  <span style={{ fontSize: 11, color: "#92400e", textTransform: "uppercase" }}>
                    {esc.priority} priority
                  </span>
                ) : null}
              </div>
              <div style={{ color: "#475569" }}>
                Assignee:{" "}
                <strong style={{ color: "#0f172a" }}>
                  {r.assignedToDisplayName ?? esc?.assigneeDisplayName ?? "Unassigned"}
                </strong>
              </div>
              {esc?.openedAt ? (
                <div style={{ color: "#64748B", fontSize: 11.5 }}>
                  Opened {formatDateTime(esc.openedAt)}
                </div>
              ) : null}
              {esc?.note ? (
                <p style={{ margin: 0, color: "#334155", whiteSpace: "pre-wrap" }}>{esc.note}</p>
              ) : null}
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: "#0f172a",
                color: "#f1f5f9",
                borderRadius: 6,
                fontSize: 11.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {r.errorMessage}
            </pre>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "max-content 1fr",
                gap: "4px 12px",
                margin: 0,
                fontSize: 12,
              }}
            >
              <dt style={{ color: "#64748B" }}>HTTP status</dt>
              <dd style={{ margin: 0 }}>{r.lastHttpStatus ?? "—"}</dd>
              <dt style={{ color: "#64748B" }}>Endpoint</dt>
              <dd
                style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}
              >
                {r.lastEndpoint ?? "—"}
              </dd>
            </dl>
          </div>
        ),
      },
      {
        id: "claims",
        label: "Affected claims",
        render: () => (
          <div style={{ display: "grid", gap: 8 }}>
            {r.claims.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "#64748B" }}>
                No claims linked to this batch.
              </p>
            ) : (
              r.claims.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    gap: 12,
                  }}
                >
                  <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <strong style={{ fontSize: 12.5 }}>{c.clientName}</strong>
                    <span style={{ fontSize: 11, color: "#64748B" }}>
                      {c.claimNumber ?? c.id.slice(0, 8)} · {c.payerName ?? "—"} ·{" "}
                      {money(c.totalCharge)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeClaim(r.id, c.id)}
                    disabled={busyId === r.id}
                    style={{
                      height: 26,
                      padding: "0 10px",
                      fontSize: 11.5,
                      border: "1px solid #fca5a5",
                      color: "#b91c1c",
                      background: "white",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        ),
      },
      {
        id: "payload",
        label: "Transmission payload metadata",
        render: () => (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "6px 12px",
              margin: 0,
              fontSize: 12.5,
            }}
          >
            <dt style={{ color: "#64748B" }}>Batch number</dt>
            <dd style={{ margin: 0 }}>{r.batchNumber || "—"}</dd>
            <dt style={{ color: "#64748B" }}>Generated file</dt>
            <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
              {r.generatedFileName ?? "—"}
            </dd>
            <dt style={{ color: "#64748B" }}>Idempotency key</dt>
            <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
              {r.idempotencyKey ?? "—"}
            </dd>
            <dt style={{ color: "#64748B" }}>Clearinghouse txn id</dt>
            <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
              {r.availityTransactionId ?? "—"}
            </dd>
            <dt style={{ color: "#64748B" }}>Practice</dt>
            <dd style={{ margin: 0 }}>{r.practiceName ?? "—"}</dd>
            <dt style={{ color: "#64748B" }}>Clinician</dt>
            <dd style={{ margin: 0 }}>{r.clinicianName ?? "—"}</dd>
            <dt style={{ color: "#64748B" }}>Created</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(r.createdAt)}</dd>
          </dl>
        ),
      },
      {
        id: "history",
        label: "Retry history",
        render: () => {
          // Newest-first timeline so the most recent failure is at the top —
          // the API returns attempts oldest → newest; reverse here so we
          // don't mutate the source array.
          const timeline = [...r.attempts].reverse();
          return (
            <div style={{ display: "grid", gap: 12 }}>
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "max-content 1fr",
                  gap: "6px 12px",
                  margin: 0,
                  fontSize: 12.5,
                }}
              >
                <dt style={{ color: "#64748B" }}>Attempts</dt>
                <dd style={{ margin: 0 }}>{r.attemptCount.toLocaleString()}</dd>
                <dt style={{ color: "#64748B" }}>Last attempt</dt>
                <dd style={{ margin: 0 }}>{formatDateTime(r.attemptedAt)}</dd>
                <dt style={{ color: "#64748B" }}>Last HTTP status</dt>
                <dd style={{ margin: 0 }}>{r.lastHttpStatus ?? "—"}</dd>
                <dt style={{ color: "#64748B" }}>Last updated</dt>
                <dd style={{ margin: 0 }}>{formatDateTime(r.updatedAt)}</dd>
              </dl>

              {timeline.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#64748B" }}>
                  No transmission attempts recorded yet. New attempts will
                  appear here as soon as the batch is submitted.
                </p>
              ) : (
                <ol
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {timeline.map((a) => {
                    const isSuccess = a.outcome === "success";
                    const accent = isSuccess ? "#16a34a" : "#c53030";
                    return (
                      <li
                        key={a.id}
                        style={{
                          border: "1px solid #E2E8F0",
                          borderLeft: `3px solid ${accent}`,
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: 12.5,
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            fontWeight: 600,
                          }}
                        >
                          <span>
                            Attempt #{a.attemptNumber || "—"} ·{" "}
                            <span style={{ color: accent }}>
                              {isSuccess ? "Success" : "Failed"}
                            </span>
                            {a.httpStatus != null && (
                              <span style={{ color: "#64748B", fontWeight: 400 }}>
                                {" "}· HTTP {a.httpStatus}
                              </span>
                            )}
                          </span>
                          <span style={{ color: "#64748B", fontWeight: 400 }}>
                            {formatDateTime(a.attemptedAt)}
                          </span>
                        </div>
                        {a.endpoint && (
                          <div style={{ color: "#475569", marginTop: 4, wordBreak: "break-all" }}>
                            {a.endpoint}
                          </div>
                        )}
                        {a.errorMessage && (
                          <div
                            style={{
                              color: "#c53030",
                              marginTop: 4,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {a.errorMessage}
                          </div>
                        )}
                        {(a.externalTransactionId ||
                          a.idempotencyKey ||
                          a.actorDisplayName) && (
                          <div
                            style={{
                              color: "#64748B",
                              marginTop: 6,
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "2px 12px",
                              fontSize: 11.5,
                            }}
                          >
                            {a.externalTransactionId && (
                              <span>Txn: {a.externalTransactionId}</span>
                            )}
                            {a.idempotencyKey && (
                              <span>Idem: {a.idempotencyKey}</span>
                            )}
                            {a.actorDisplayName && (
                              <span>By: {a.actorDisplayName}</span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              <Link
                href={`/billing/837p-batches?organizationId=${encodeURIComponent(
                  organizationId,
                )}`}
                style={{ fontSize: 12.5 }}
              >
                Open in 837P Batches →
              </Link>
            </div>
          );
        },
      },
      {
        id: "documents",
        label: "Related documents",
        render: () => {
          if (!selectedRow) return null;
          const claims = selectedRow.claims ?? [];
          if (claims.length === 0) {
            return (
              <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                No claims are attached to this batch yet.
              </p>
            );
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {claims.map((c) => (
                <section
                  key={c.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "#475569",
                      marginBottom: 8,
                      fontWeight: 600,
                    }}
                  >
                    Claim {c.claimNumber ?? c.id}
                  </div>
                  <ClaimDocumentsPanel
                    claimId={c.id}
                    organizationId={organizationId}
                  />
                </section>
              ))}
            </div>
          );
        },
      },
    ];
  }, [selectedRow, organizationId, busyId, removeClaim]);

  const detailActions: PrimaryAction[] = useMemo(() => {
    if (!selectedRow) return [];
    const r = selectedRow;
    return [
      {
        id: "retry",
        label: "Retry transmission",
        variant: "primary",
        onClick: () => void runAction(r.id, "retry"),
        disabled: busyId === r.id,
      },
      {
        id: "rebuild",
        label: "Rebuild batch",
        onClick: () => void runAction(r.id, "rebuild"),
        disabled:
          busyId === r.id || r.batchStatus.toLowerCase() === "ready_to_generate",
      },
      {
        id: "remove_claim",
        label: "Remove failed claim",
        onClick: () => promptRemoveClaim(r),
        disabled: busyId === r.id || r.claims.length === 0,
      },
      {
        id: "escalate",
        label: r.openEscalation ? "Reassign escalation…" : "Escalate technical issue…",
        variant: "danger",
        onClick: () => openEscalateModal(r),
        disabled: busyId === r.id,
      },
      ...(r.openEscalation
        ? [
            {
              id: "resolve_escalation",
              label: "Resolve escalation",
              onClick: () => resolveEscalation(r),
              disabled: busyId === r.id,
            } as PrimaryAction,
          ]
        : []),
    ];
  }, [selectedRow, busyId, runAction, openEscalateModal, resolveEscalation, promptRemoveClaim]);

  // Primary tabs surfaced via the shell so we stay layout-only here.
  const primaryTabs: PrimaryTab[] = useMemo(
    () =>
      TRANSMISSION_FAILURE_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        count: items.filter((r) => r.tab === t.id).length,
      })),
    [items],
  );

  const headerActions: PrimaryAction[] = useMemo(
    () => [
      {
        id: "refresh",
        label: loading ? "Refreshing…" : "Refresh",
        onClick: () => setReloadKey((k) => k + 1),
        disabled: loading,
      },
    ],
    [loading],
  );

  return (
    <WorkqueueShell<FailureRow>
      title={queueDef?.title ?? "Transmission Failures"}
      description={queueDef?.description}
      headerActions={headerActions}
      summary={summary}
      primaryTabs={primaryTabs}
      activePrimaryTabId={activeTab}
      onPrimaryTabChange={(id) => {
        setActiveTab(id as TransmissionFailureTabId);
        setSelectedRowId(null);
      }}
      filters={filters}
      filterValues={filterValues}
      onFilterChange={setFilterValues}
      filterUrlNamespace="tx"
      rows={filtered}
      columns={columns}
      rowId={(r) => r.id}
      loading={loading}
      emptyMessage="No transmission failures on this tab."
      selectedRowId={selectedRowId}
      onSelectRow={setSelectedRowId}
      rowActions={rowActions}
      detailTabs={detailTabs}
      detailActions={detailActions}
      message={message}
      overlay={
        escalationDraft ? (
          <EscalationModal
            draft={escalationDraft}
            assignees={assignees}
            onChange={setEscalationDraft}
            onCancel={() => setEscalationDraft(null)}
            onSubmit={() => void submitEscalation(escalationDraft)}
          />
        ) : null
      }
    />
  );
}

function EscalationModal({
  draft,
  assignees,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: EscalationDraft;
  assignees: Assignee[];
  onChange: (next: EscalationDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escalate transmission failure"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          background: "white",
          borderRadius: 8,
          padding: 20,
          display: "grid",
          gap: 14,
          boxShadow: "0 18px 48px rgba(15,23,42,0.25)",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Escalate batch {draft.row.batchNumber || draft.row.id.slice(0, 8)}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#64748B" }}>
            Route this transmission failure to a teammate. The batch is tagged
            with the assignee and an open escalation record.
          </p>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          <span style={{ color: "#334155" }}>Assignee</span>
          <select
            value={draft.assigneeUserId}
            onChange={(e) => onChange({ ...draft, assigneeUserId: e.target.value })}
            style={{ height: 32, padding: "0 8px", fontSize: 13 }}
          >
            <option value="">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          <span style={{ color: "#334155" }}>Priority</span>
          <select
            value={draft.priority}
            onChange={(e) =>
              onChange({
                ...draft,
                priority: e.target.value as EscalationDraft["priority"],
              })
            }
            style={{ height: 32, padding: "0 8px", fontSize: 13 }}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          <span style={{ color: "#334155" }}>Note (optional)</span>
          <textarea
            value={draft.note}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            rows={4}
            placeholder="What needs the biller's attention?"
            style={{ padding: 8, fontSize: 13, resize: "vertical" }}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 32,
              padding: "0 12px",
              fontSize: 13,
              border: "1px solid #cbd5e1",
              background: "white",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            style={{
              height: 32,
              padding: "0 14px",
              fontSize: 13,
              border: "1px solid #b91c1c",
              background: "#b91c1c",
              color: "white",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Open escalation
          </button>
        </div>
      </div>
    </div>
  );
}
