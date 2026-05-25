"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_ORG_ID } from "@/lib/config";
import WorkqueueShell, {
  type ColumnDef,
  type FilterDef,
  type RowAction,
  type SummaryMetric,
  type PrimaryAction,
  type DetailTab,
} from "@/components/billing/WorkqueueShell";
import { ClaimDocumentsPanel } from "@/components/billing/ClaimDocumentsPanel";
import PlaceClaimOnHoldModal from "@/components/billing/PlaceClaimOnHoldModal";
import ClaimSubmissionReadinessPanel from "@/components/claim/ClaimSubmissionReadinessPanel";
import {
  BUILD_ERROR_TABS,
  BUILD_HOLD_DEFER_UNTIL,
  DEFERRED_REASON_HOLD,
  DEFERRED_REASON_ROUTED,
  type BuildErrorTabId,
} from "@/lib/billing/claimBuildErrors";
import { getWorkqueue } from "@/lib/billing/workqueues";

type Severity = "blocking" | "warning" | "info";
type RowStatus = "open" | "held" | "routed";

interface BuildErrorRow {
  id: string;
  claimId: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  clinicianName: string | null;
  practiceName: string | null;
  dos: string | null;
  totalCharge: number;
  ruleId: string;
  tab: BuildErrorTabId;
  errorType: string;
  missingField: string;
  fieldLocation: string;
  severity: Severity;
  assignedTo: string | null;
  lastAttemptedBuild: string | null;
  status: RowStatus;
  fixRoute: string;
  whyItMatters: string;
  resolution: string;
  agingDays: number | null;
  followUpDue: string | null;
}

interface ApiPayload {
  success: boolean;
  error?: string;
  items?: BuildErrorRow[];
}

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function money(value: number): string {
  return Number(value ?? 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function ciContains(haystack: string | null, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const SEVERITY_COLOR: Record<Severity, string> = {
  blocking: "#c53030",
  warning: "#b45309",
  info: "#2563eb",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  open: "Open",
  held: "Held",
  routed: "Routed",
};

const queueDef = getWorkqueue("claim_build_errors");

export default function ClaimBuildErrorsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [items, setItems] = useState<BuildErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<BuildErrorTabId>(
    BUILD_ERROR_TABS[0].id,
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [holdTarget, setHoldTarget] = useState<BuildErrorRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkHoldOpen, setBulkHoldOpen] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────
  // Filter values are also forwarded to the server so it can do cheap
  // narrowing (claim-level filters push down to SQL). Client-side
  // filtering still runs as a second pass to keep the UI deterministic
  // for the universal-rail subset that lives only in computed row data.
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
    fetch(`/api/billing/claim-build-errors?${qs.toString()}`, {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<ApiPayload>)
      .then((json) => {
        if (json.success && Array.isArray(json.items)) {
          setItems(json.items);
        } else {
          setItems([]);
          if (json.error) {
            setMessage({ tone: "error", text: json.error });
          }
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

  // ── Filters: universal rail + facet options ─────────────────────────────
  const payerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of items)
      if (r.payerId && r.payerName) map.set(r.payerId, r.payerName);
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of items)
      if (r.clientId && r.clientName) map.set(r.clientId, r.clientName);
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
          { value: "open", label: "Open" },
          { value: "held", label: "Held" },
          { value: "routed", label: "Routed" },
        ],
      },
      { id: "assignedBiller", label: "Assigned biller", kind: "text", placeholder: "Name or 'unassigned'" },
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
      { id: "carcRarc", label: "CARC/RARC", kind: "text", placeholder: "Rule or error text…" },
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

  // ── Tab narrowing happens first; row-level filters are then applied so
  // every universal-rail field actually constrains the table. Server-side
  // filters covered most of this already; we re-apply here so the UI is
  // never out of sync with what's in `filterValues`.
  const tabRows = useMemo(
    () => items.filter((r) => r.tab === activeTab),
    [items, activeTab],
  );

  const filtered = useMemo(() => {
    const v = filterValues;
    return tabRows.filter((r) => {
      if (v.payer && r.payerId !== v.payer) return false;
      if (v.client && r.clientId !== v.client) return false;
      if (v.status && r.status !== v.status) return false;
      if (v.dosFrom && (!r.dos || r.dos < v.dosFrom)) return false;
      if (v.dosTo && (!r.dos || r.dos > v.dosTo)) return false;
      if (v.minAmount) {
        const n = Number(v.minAmount);
        if (Number.isFinite(n) && r.totalCharge < n) return false;
      }
      if (v.maxAmount) {
        const n = Number(v.maxAmount);
        if (Number.isFinite(n) && r.totalCharge > n) return false;
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
      if (v.priority === "urgent" && (r.agingDays ?? 0) <= 14) return false;
      if (v.practice && !ciContains(r.practiceName, v.practice)) return false;
      if (v.clinician && !ciContains(r.clinicianName, v.clinician)) return false;
      if (v.assignedBiller) {
        const needle = v.assignedBiller.trim().toLowerCase();
        const isUnassignedQuery = ["unassigned", "—", "-", "none"].includes(needle);
        if (isUnassignedQuery) {
          if (r.assignedTo) return false;
        } else if (!ciContains(r.assignedTo, v.assignedBiller)) {
          return false;
        }
      }
      if (v.carcRarc) {
        if (
          !ciContains(r.ruleId, v.carcRarc) &&
          !ciContains(r.errorType, v.carcRarc) &&
          !ciContains(r.resolution, v.carcRarc)
        ) {
          return false;
        }
      }
      if (v.followUpDue && r.followUpDue !== v.followUpDue) return false;
      return true;
    });
  }, [tabRows, filterValues]);

  // ── Summary strip: queue-level (across all loaded rows, current tab),
  // independent of the filter rail so the header shows the real backlog
  // even while the user narrows the table.
  const summary: SummaryMetric[] = useMemo(() => {
    const dollars = tabRows.reduce((s, r) => s + (r.totalCharge || 0), 0);
    const ages = tabRows
      .map((r) => r.agingDays)
      .filter((n): n is number => n != null);
    const oldest = ages.length ? Math.max(...ages) : 0;
    const urgent = tabRows.filter((r) => (r.agingDays ?? 0) > 14).length;
    return [
      { id: "count", label: "Build errors", value: tabRows.length.toLocaleString() },
      { id: "dollars", label: "Total $", value: money(dollars) },
      {
        id: "oldest",
        label: "Oldest (days)",
        value: oldest,
        tone: oldest > 30 ? "red" : oldest > 14 ? "amber" : "default",
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
  const columns: ColumnDef<BuildErrorRow>[] = useMemo(
    () => [
      {
        id: "client",
        header: "Client",
        cell: (r) => (
          <>
            <span style={{ fontWeight: 600 }}>{r.clientName}</span>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              {STATUS_LABEL[r.status]}
            </div>
          </>
        ),
      },
      {
        id: "claimId",
        header: "Claim ID",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
            {r.claimNumber ?? r.claimId.slice(0, 8)}
          </span>
        ),
      },
      { id: "dos", header: "DOS", cell: (r) => formatDate(r.dos) },
      {
        id: "payer",
        header: "Payer",
        cell: (r) => r.payerName ?? "—",
      },
      {
        id: "errorType",
        header: "Error type",
        cell: (r) => r.errorType,
      },
      {
        id: "missingField",
        header: "Missing field",
        cell: (r) => r.missingField,
      },
      {
        id: "fieldLocation",
        header: "Field location",
        cell: (r) => (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
            {r.fieldLocation}
          </span>
        ),
      },
      {
        id: "severity",
        header: "Severity",
        cell: (r) => (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: SEVERITY_COLOR[r.severity],
              color: "white",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {r.severity}
          </span>
        ),
      },
      {
        id: "assignedTo",
        header: "Assigned to",
        cell: (r) => r.assignedTo ?? "—",
      },
      {
        id: "lastAttemptedBuild",
        header: "Last attempted build",
        cell: (r) => {
          const a = ageDays(r.lastAttemptedBuild);
          return a == null
            ? "—"
            : a === 0
              ? "today"
              : `${a}d ago`;
        },
      },
    ],
    [],
  );

  // ── Selected row + actions ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedRowId) return;
    if (!filtered.some((r) => r.id === selectedRowId)) setSelectedRowId(null);
  }, [filtered, selectedRowId]);

  const selectedRow = useMemo(
    () => filtered.find((r) => r.id === selectedRowId) ?? null,
    [filtered, selectedRowId],
  );

  /**
   * Apply an optimistic patch for the action so the row state flips
   * immediately. We snapshot the original items first; on failure we
   * roll back without a server round-trip.
   */
  const applyOptimistic = useCallback(
    (
      claimId: string,
      action: "hold" | "route_to_admin" | "release_hold" | "revalidate",
    ): BuildErrorRow[] => {
      let snapshot: BuildErrorRow[] = [];
      setItems((prev) => {
        snapshot = prev;
        if (action === "revalidate") return prev;
        return prev.map((r) => {
          if (r.claimId !== claimId) return r;
          if (action === "hold") {
            return {
              ...r,
              status: "held",
              followUpDue: BUILD_HOLD_DEFER_UNTIL,
            };
          }
          if (action === "route_to_admin") {
            return {
              ...r,
              status: "routed",
              followUpDue: BUILD_HOLD_DEFER_UNTIL,
            };
          }
          if (action === "release_hold") {
            return { ...r, status: "open", followUpDue: null };
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
      claimId: string,
      action: "revalidate" | "hold" | "route_to_admin" | "release_hold",
    ) => {
      setBusyId(claimId);
      setMessage(null);
      const snapshot = applyOptimistic(claimId, action);
      try {
        const res = await fetch(
          `/api/billing/claim-build-errors/${encodeURIComponent(claimId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId, action }),
          },
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Action failed");
        }
        const label =
          action === "revalidate"
            ? `Re-validated — ${json.blocking ?? 0} blocking remaining.`
            : action === "hold"
              ? "Claim held."
              : action === "route_to_admin"
                ? "Routed to admin."
                : "Hold released.";
        setMessage({ tone: "success", text: label });
        // Background refresh to pull authoritative state (especially
        // important for "revalidate", where the optimistic patch is a
        // no-op until the server tells us which findings survived).
        setReloadKey((k) => k + 1);
      } catch (e) {
        // Roll back optimistic patch.
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

  const fixHref = (route: string) =>
    `${route}${route.includes("?") ? "&" : "?"}organizationId=${encodeURIComponent(organizationId)}`;

  const rowActions: RowAction<BuildErrorRow>[] = useMemo(
    () => [
      {
        id: "fix",
        label: "Fix data",
        variant: "primary",
        onClick: (r) => {
          if (typeof window !== "undefined") {
            window.location.href = fixHref(r.fixRoute);
          }
        },
      },
      {
        id: "revalidate",
        label: "Revalidate",
        onClick: (r) => void runAction(r.claimId, "revalidate"),
        disabled: (r) => busyId === r.claimId,
      },
      {
        id: "hold",
        label: "Hold",
        onClick: (r) => void runAction(r.claimId, "hold"),
        disabled: (r) => busyId === r.claimId || r.status === "held",
      },
      {
        id: "place_on_hold",
        label: "Place on hold",
        onClick: (r) => setHoldTarget(r),
        disabled: (r) => busyId === r.claimId || r.status === "held",
      },
    ],
    [busyId, runAction, organizationId],
  );

  const detailActions: PrimaryAction[] = useMemo(() => {
    if (!selectedRow) return [];
    const acts: PrimaryAction[] = [
      {
        id: "fix",
        label: "Fix data",
        variant: "primary",
        onClick: () => {
          if (typeof window !== "undefined") {
            window.location.href = fixHref(selectedRow.fixRoute);
          }
        },
      },
      {
        id: "open",
        label: "Open related record",
        onClick: () => {
          if (typeof window !== "undefined") {
            window.location.href = fixHref(
              `/billing/claim-submission?claimId=${encodeURIComponent(selectedRow.claimId)}`,
            );
          }
        },
      },
      {
        id: "revalidate",
        label: "Revalidate",
        onClick: () => void runAction(selectedRow.claimId, "revalidate"),
        disabled: busyId === selectedRow.claimId,
      },
      {
        id: "route",
        label: "Route to admin",
        onClick: () => void runAction(selectedRow.claimId, "route_to_admin"),
        disabled: busyId === selectedRow.claimId,
      },
    ];
    if (selectedRow.status === "held" || selectedRow.status === "routed") {
      acts.push({
        id: "release",
        label: "Release hold",
        onClick: () => void runAction(selectedRow.claimId, "release_hold"),
        disabled: busyId === selectedRow.claimId,
      });
    } else {
      acts.push({
        id: "hold",
        label: "Hold claim",
        variant: "danger",
        onClick: () => void runAction(selectedRow.claimId, "hold"),
        disabled: busyId === selectedRow.claimId,
      });
      acts.push({
        id: "place_on_hold",
        label: "Place on hold",
        onClick: () => setHoldTarget(selectedRow),
        disabled: busyId === selectedRow.claimId,
      });
    }
    return acts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow, busyId, runAction, organizationId]);

  // ── Detail tabs ─────────────────────────────────────────────────────────
  const detailTabs: DetailTab[] = useMemo(() => {
    if (!selectedRow) return [];
    return [
      {
        id: "explanation",
        label: "Error explanation",
        render: () => (
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>{selectedRow.errorType}</h3>
              <p style={{ margin: 0, fontSize: 13 }}>{selectedRow.resolution}</p>
            </div>
            <div>
              <strong style={{ fontSize: 12 }}>Why it matters</strong>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#475569" }}>
                {selectedRow.whyItMatters}
              </p>
            </div>
            <div style={{ fontSize: 12, color: "#64748B" }}>
              Rule: <code>{selectedRow.ruleId}</code>
            </div>
          </div>
        ),
      },
      {
        id: "field",
        label: "Affected claim field",
        render: () => (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "6px 12px",
              margin: 0,
              fontSize: 13,
            }}
          >
            <dt style={{ color: "#64748B" }}>Missing field</dt>
            <dd style={{ margin: 0 }}>{selectedRow.missingField}</dd>
            <dt style={{ color: "#64748B" }}>837P location</dt>
            <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>
              {selectedRow.fieldLocation}
            </dd>
            <dt style={{ color: "#64748B" }}>Severity</dt>
            <dd style={{ margin: 0 }}>{selectedRow.severity}</dd>
            <dt style={{ color: "#64748B" }}>Last build</dt>
            <dd style={{ margin: 0 }}>{formatDate(selectedRow.lastAttemptedBuild)}</dd>
          </dl>
        ),
      },
      {
        id: "links",
        label: "Client/provider/payer record links",
        render: () => (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {selectedRow.clientId ? (
              <li>
                <Link href={fixHref(`/patients/${selectedRow.clientId}`)}>
                  Client chart — {selectedRow.clientName}
                </Link>
              </li>
            ) : null}
            {selectedRow.payerId ? (
              <li>
                <Link
                  href={fixHref(`/insurance-payers?payerId=${encodeURIComponent(selectedRow.payerId)}`)}
                >
                  Payer profile — {selectedRow.payerName}
                </Link>
              </li>
            ) : null}
            <li>
              <Link
                href={fixHref(
                  `/billing/claim-submission?claimId=${encodeURIComponent(selectedRow.claimId)}`,
                )}
              >
                Open claim {selectedRow.claimNumber ?? selectedRow.claimId.slice(0, 8)}
              </Link>
            </li>
            <li>
              <Link href={fixHref("/settings/providers")}>Providers settings</Link>
            </li>
          </ul>
        ),
      },
      {
        id: "checklist",
        label: "837P validation checklist",
        render: () => (
          <ClaimSubmissionReadinessPanel
            organizationId={organizationId}
            claimId={selectedRow.claimId}
            claimLabel={selectedRow.claimNumber ?? undefined}
          />
        ),
      },
      {
        id: "documents",
        label: "Related documents",
        render: () =>
          selectedRow?.claimId ? (
            <ClaimDocumentsPanel
              claimId={selectedRow.claimId}
              organizationId={organizationId}
            />
          ) : null,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow, organizationId]);

  // ── Tab counts (badge in tab labels) ────────────────────────────────────
  const countsByTab = useMemo(() => {
    const m: Record<BuildErrorTabId, number> = {
      missing_provider_data: 0,
      missing_payer_id: 0,
      missing_diagnosis: 0,
      invalid_modifier: 0,
      invalid_pos: 0,
      missing_npi_taxonomy: 0,
      invalid_client_data: 0,
    };
    for (const r of items) m[r.tab] += 1;
    return m;
  }, [items]);

  const headerActions: PrimaryAction[] = useMemo(
    () => [
      ...(selectedIds.length > 0
        ? [
            {
              id: "bulk-hold",
              label: `Place ${selectedIds.length} on hold`,
              variant: "primary" as const,
              onClick: () => setBulkHoldOpen(true),
            },
            {
              id: "clear-selection",
              label: "Clear selection",
              onClick: () => setSelectedIds([]),
            },
          ]
        : []),
      {
        id: "refresh",
        label: loading ? "Refreshing…" : "Refresh",
        onClick: () => setReloadKey((k) => k + 1),
        disabled: loading,
      },
    ],
    [loading, selectedIds],
  );

  // Reference enum exports so they're not flagged unused when the
  // component grows.
  void DEFERRED_REASON_HOLD;
  void DEFERRED_REASON_ROUTED;

  return (
    <main className="app-shell">
      <div
        role="tablist"
        aria-label="Claim build error categories"
        style={{
          display: "flex",
          gap: 4,
          padding: "0 12px",
          borderBottom: "1px solid #E2E8F0",
          background: "white",
          flexWrap: "wrap",
        }}
      >
        {BUILD_ERROR_TABS.map((t) => {
          const isActive = activeTab === t.id;
          const count = countsByTab[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveTab(t.id);
                setSelectedRowId(null);
              }}
              style={{
                padding: "10px 14px",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #2563EB" : "2px solid transparent",
                color: isActive ? "#0F172A" : "#64748B",
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {t.label}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  background: isActive ? "#DBEAFE" : "#F1F5F9",
                  color: isActive ? "#1E40AF" : "#475569",
                  padding: "1px 7px",
                  borderRadius: 999,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <WorkqueueShell<BuildErrorRow>
        title={queueDef?.title ?? "Claim Build Errors"}
        description={queueDef?.description}
        headerActions={headerActions}
        summary={summary}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={setFilterValues}
        filterUrlNamespace="cbe"
        rows={filtered}
        columns={columns}
        rowId={(r) => r.id}
        rowActions={rowActions}
        loading={loading}
        emptyMessage={`No ${BUILD_ERROR_TABS.find((t) => t.id === activeTab)?.label.toLowerCase()} errors.`}
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRowId}
        selectedRowIds={selectedIds}
        onSelectionChange={setSelectedIds}
        detailTabs={detailTabs}
        detailActions={detailActions}
        message={message}
      />
      {holdTarget ? (
        <PlaceClaimOnHoldModal
          claimId={holdTarget.claimId}
          organizationId={organizationId}
          subtitle={`Claim ${holdTarget.claimNumber ?? holdTarget.claimId.slice(0, 8)} · ${holdTarget.payerName ?? "—"}`}
          onClose={() => setHoldTarget(null)}
          onPlaced={() => {
            const label = holdTarget.claimNumber ?? holdTarget.claimId.slice(0, 8);
            setItems((prev) => prev.filter((r) => r.claimId !== holdTarget.claimId));
            if (selectedRowId && items.find((r) => r.id === selectedRowId)?.claimId === holdTarget.claimId) {
              setSelectedRowId(null);
            }
            setMessage({ tone: "success", text: `Claim ${label} placed on hold.` });
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
      {bulkHoldOpen ? (
        (() => {
          const selectedRows = items.filter((r) => selectedIds.includes(r.id));
          const claimIds = Array.from(
            new Set(
              selectedRows.map((r) => r.claimId).filter((id): id is string => !!id),
            ),
          );
          return (
            <PlaceClaimOnHoldModal
              claimIds={claimIds}
              organizationId={organizationId}
              subtitle={`${claimIds.length} claim${claimIds.length === 1 ? "" : "s"} selected`}
              onClose={() => setBulkHoldOpen(false)}
              onPlacedBulk={(summary) => {
                const heldClaims = new Set(
                  summary.results.filter((r) => r.success).map((r) => r.claimId),
                );
                setItems((prev) => prev.filter((r) => !heldClaims.has(r.claimId)));
                setSelectedIds([]);
                const parts = [
                  `${summary.succeeded} placed on hold`,
                  summary.failed > 0 ? `${summary.failed} failed` : null,
                ].filter(Boolean);
                setMessage({
                  tone: summary.failed > 0 ? "error" : "success",
                  text: parts.join(" · "),
                });
                setReloadKey((k) => k + 1);
              }}
            />
          );
        })()
      ) : null}
    </main>
  );
}
