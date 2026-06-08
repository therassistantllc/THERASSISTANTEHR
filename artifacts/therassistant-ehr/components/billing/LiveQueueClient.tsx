"use client";

/**
 * LiveQueueClient
 * ───────────────────────────────────────────────────────────────────────────
 * Generic data-driven workqueue client. Each of the 13 second-wave billing
 * workqueues (payer rejections, resubmissions, partial denials, adjustments
 * review, medical necessity, unposted payments, credit balances,
 * reconciliation exceptions, bad debt review, write-offs, audit queue,
 * compliance holds) uses this same shell — pages pass a `queueId`, a list
 * of tabs, a column projector, and an action set, and the client takes
 * care of fetching, filtering, tab routing, and POSTing row actions.
 *
 * Data contract — the server route at `/api/billing/<endpoint>` MUST return:
 *   {
 *     success: true,
 *     items: Row[],
 *     summary: {
 *       total_count, total_dollars,
 *       oldest_age_days, urgent_count,
 *       by_tab: Record<TabId, number>,
 *     }
 *   }
 *
 * Row actions hit `POST /api/billing/<endpoint>/action` with
 *   { action, rowId, organizationId, ...extras }.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import WorkqueueShell, {
  type ColumnDef,
  type DetailTab,
  type FilterDef,
  type PrimaryAction,
  type RowAction,
  type SummaryMetric,
} from "@/components/billing/WorkqueueShell";
import { getWorkqueue } from "@/lib/billing/workqueues";
import { DEFAULT_ORG_ID } from "@/lib/config";
import { ClaimDocumentsPanel } from "@/components/billing/ClaimDocumentsPanel";

export type LiveRow = Record<string, unknown> & {
  id: string;
  tabs?: string[];
  charge_amount?: number;
  age_days?: number | null;
  priority?: "low" | "medium" | "high" | "critical";
  state?: string;
};

export interface LiveSummary {
  total_count: number;
  total_dollars: number;
  oldest_age_days: number | null;
  urgent_count: number;
  by_tab: Record<string, number>;
}

export interface LiveTabDef {
  id: string;
  label: string;
}

export interface LiveColumnDef {
  id: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: number | string;
  cell: (row: LiveRow) => ReactNode;
}

export interface LiveActionDef {
  id: string;
  label: string;
  variant?: "default" | "primary" | "danger" | "success";
  /** Optional confirm prompt — if returns null/false the action is skipped. */
  prompt?: (row: LiveRow) =>
    | null
    | true
    | Record<string, unknown>;
  /** When set, hides the action for rows where this returns false. */
  enabled?: (row: LiveRow) => boolean;
}

export interface LiveDetailFieldDef {
  label: string;
  value: (row: LiveRow) => ReactNode;
}

export interface LiveQueueConfig {
  queueId: string;
  endpoint: string;                 // e.g. "payer-rejections"
  filterUrlNamespace: string;
  tabs: LiveTabDef[];
  columns: LiveColumnDef[];
  actions?: LiveActionDef[];
  extraFilters?: FilterDef[];
  summaryLabels?: {
    count?: string;
    dollars?: string;
    oldest?: string;
    urgent?: string;
  };
  /** Field list rendered inside the right-side detail panel. */
  detailFields?: LiveDetailFieldDef[];
  emptyMessage?: string;
  /**
   * When set, appends a "Related documents" tab to the detail panel that
   * mounts ClaimDocumentsPanel for the claim id returned by this resolver.
   * Return null/empty when the selected row isn't tied to a single claim.
   */
  getClaimId?: (row: LiveRow) => string | null | undefined;
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

function formatMoney(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

const UNIVERSAL_FILTERS: FilterDef[] = [
  { id: "payer", label: "Payer", kind: "text", placeholder: "Payer name…" },
  { id: "client", label: "Client", kind: "text", placeholder: "Client name…" },
  { id: "dosFrom", label: "DOS from", kind: "date" },
  { id: "dosTo", label: "DOS to", kind: "date" },
  { id: "minAmount", label: "Min $", kind: "number" },
  { id: "maxAmount", label: "Max $", kind: "number" },
  {
    id: "agingBucket",
    label: "Aging",
    kind: "select",
    options: [
      { value: "0_30", label: "0–30d" },
      { value: "31_60", label: "31–60d" },
      { value: "61_90", label: "61–90d" },
      { value: "90_plus", label: "90+d" },
    ],
  },
  {
    id: "priority",
    label: "Priority",
    kind: "select",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
    ],
  },
];

export default function LiveQueueClient(props: LiveQueueConfig) {
  const {
    queueId,
    endpoint,
    filterUrlNamespace,
    tabs,
    columns,
    actions,
    extraFilters,
    summaryLabels,
    detailFields,
    emptyMessage,
    getClaimId,
  } = props;

  const def = getWorkqueue(queueId);
  const title = def?.title ?? "Workqueue";
  const description = def?.description ?? "";

  const organizationId = useMemo(() => getOrganizationId(), []);

  const [items, setItems] = useState<LiveRow[]>([]);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.id ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ organizationId, tab: activeTab });
      for (const [k, v] of Object.entries(filterValues)) {
        if (v && v.length > 0) qs.set(k, v);
      }
      const res = await fetch(
        `/api/billing/${endpoint}?${qs.toString()}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        items?: LiveRow[];
        summary?: LiveSummary;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load worklist");
      }
      setItems(json.items ?? []);
      setSummary(json.summary ?? null);
    } catch (e) {
      setItems([]);
      setSummary(null);
      setMessage({
        tone: "error",
        text: e instanceof Error ? e.message : "Failed to load worklist",
      });
    } finally {
      setLoading(false);
    }
  }, [organizationId, endpoint, activeTab, filterValues]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (rowId: string, action: string, extras: Record<string, unknown>) => {
      setBusyRow(rowId);
      try {
        const res = await fetch(`/api/billing/${endpoint}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, rowId, organizationId, ...extras }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Action failed");
        }
        setMessage({
          tone: "success",
          text: `Action "${action.replace(/_/g, " ")}" applied.`,
        });
        void load();
      } catch (e) {
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Action failed",
        });
      } finally {
        setBusyRow(null);
      }
    },
    [endpoint, organizationId, load],
  );

  // Undo dispatches to a separate endpoint that reads the latest audit_logs
  // entry for the row and reverses its mutation atomically. Disabled when
  // there is no recorded action (last_action is null) or the latest action
  // is itself an undo, AND server-side it also refuses when a downstream
  // action (refund issued, claim status drifted, …) makes undo unsafe.
  const runUndo = useCallback(
    async (rowId: string) => {
      setBusyRow(rowId);
      try {
        const res = await fetch(`/api/billing/${endpoint}/action/undo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId, organizationId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          undoneEventType?: string | null;
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Undo failed");
        }
        const label = json.undoneEventType
          ? json.undoneEventType.split("_").slice(1).join(" ") || json.undoneEventType
          : "last action";
        setMessage({ tone: "success", text: `Undid "${label}".` });
        void load();
      } catch (e) {
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Undo failed",
        });
      } finally {
        setBusyRow(null);
      }
    },
    [endpoint, organizationId, load],
  );

  const canUndo = useCallback((r: LiveRow): boolean => {
    const la = (r as Record<string, unknown>).last_action;
    if (typeof la !== "string" || la.length === 0) return false;
    // The most recent entry being itself an `<prefix>_undo` means there is
    // nothing left to undo.
    return !la.endsWith("_undo");
  }, []);

  const filters: FilterDef[] = useMemo(
    () => [...UNIVERSAL_FILTERS, ...(extraFilters ?? [])],
    [extraFilters],
  );

  const primaryTabs = useMemo(
    () =>
      tabs.map((t) => ({
        id: t.id,
        label: t.label,
        count: summary?.by_tab?.[t.id] ?? 0,
      })),
    [tabs, summary],
  );

  const shellColumns: ColumnDef<LiveRow>[] = useMemo(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        align: c.align,
        width: c.width,
        cell: (r) => c.cell(r),
      })),
    [columns],
  );

  const rowActions: RowAction<LiveRow>[] = useMemo(() => {
    const list: RowAction<LiveRow>[] = [];
    if (actions && actions.length > 0) {
      for (const a of actions) {
        list.push({
          id: a.id,
          label: a.label,
          variant: a.variant,
          disabled: (r) => {
            if (busyRow === r.id) return true;
            if (a.enabled && !a.enabled(r)) return true;
            return false;
          },
          onClick: (r) => {
            const extras = a.prompt ? a.prompt(r) : true;
            if (extras == null) return;
            const payload = typeof extras === "object" ? extras : {};
            void runAction(r.id, a.id, payload);
          },
        });
      }
    }
    list.push({
      id: "undo",
      label: "Undo last action",
      disabled: (r) => busyRow === r.id || !canUndo(r),
      onClick: (r) => void runUndo(r.id),
    });
    return list;
  }, [actions, busyRow, runAction, runUndo, canUndo]);

  const selectedRow = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  );

  const detailTabs: DetailTab[] = useMemo(() => {
    if (!selectedRow) return [];
    const fields = detailFields ?? [];
    const list: DetailTab[] = [
      {
        id: "details",
        label: "Details",
        render: () => (
          <div>
            {fields.length === 0 ? (
              <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
                Select a row to see its details.
              </p>
            ) : (
              fields.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 13,
                    padding: "4px 0",
                  }}
                >
                  <span style={{ color: "#64748b", minWidth: 160 }}>
                    {f.label}
                  </span>
                  <span>{f.value(selectedRow)}</span>
                </div>
              ))
            )}
          </div>
        ),
      },
    ];
    if (getClaimId) {
      const claimId = getClaimId(selectedRow);
      if (claimId) {
        list.push({
          id: "documents",
          label: "Related documents",
          render: () => (
            <ClaimDocumentsPanel
              claimId={claimId}
              organizationId={organizationId}
            />
          ),
        });
      }
    }
    return list;
  }, [selectedRow, detailFields, getClaimId, organizationId]);

  const detailActions: PrimaryAction[] = useMemo(() => {
    if (!selectedRow) return [];
    const list: PrimaryAction[] = [];
    for (const a of actions ?? []) {
      list.push({
        id: a.id,
        label: a.label,
        variant: a.variant,
        disabled: busyRow === selectedRow.id || (a.enabled ? !a.enabled(selectedRow) : false),
        onClick: () => {
          const extras = a.prompt ? a.prompt(selectedRow) : true;
          if (extras == null) return;
          const payload = typeof extras === "object" ? extras : {};
          void runAction(selectedRow.id, a.id, payload);
        },
      });
    }
    list.push({
      id: "undo",
      label: "Undo last action",
      disabled: busyRow === selectedRow.id || !canUndo(selectedRow),
      onClick: () => void runUndo(selectedRow.id),
    });
    return list;
  }, [selectedRow, actions, busyRow, runAction, runUndo, canUndo]);

  const headerActions: PrimaryAction[] = useMemo(
    () => [
      {
        id: "refresh",
        label: loading ? "Refreshing…" : "Refresh",
        onClick: () => void load(),
        disabled: loading,
      },
    ],
    [loading, load],
  );

  const summaryMetrics: SummaryMetric[] = useMemo(() => {
    const s = summary ?? {
      total_count: 0,
      total_dollars: 0,
      oldest_age_days: null,
      urgent_count: 0,
      by_tab: {},
    };
    return [
      {
        id: "count",
        label: summaryLabels?.count ?? "Open items",
        value: String(s.total_count),
      },
      {
        id: "dollars",
        label: summaryLabels?.dollars ?? "Total $",
        value: formatMoney(s.total_dollars),
      },
      {
        id: "oldest",
        label: summaryLabels?.oldest ?? "Oldest age",
        value: s.oldest_age_days == null ? "—" : `${s.oldest_age_days}d`,
        tone: (s.oldest_age_days ?? 0) > 60 ? "red" : "default",
      },
      {
        id: "urgent",
        label: summaryLabels?.urgent ?? "Urgent",
        value: String(s.urgent_count),
        tone: s.urgent_count > 0 ? "amber" : "default",
      },
    ];
  }, [summary, summaryLabels]);

  return (
    <WorkqueueShell<LiveRow>
      title={title}
      description={description}
      headerActions={headerActions}
      summary={summaryMetrics}
      primaryTabs={primaryTabs}
      activePrimaryTabId={activeTab}
      onPrimaryTabChange={(id) => {
        setActiveTab(id);
        setSelectedId(null);
      }}
      filters={filters}
      filterValues={filterValues}
      onFilterChange={setFilterValues}
      filterUrlNamespace={filterUrlNamespace}
      rows={items}
      columns={shellColumns}
      rowId={(r) => r.id}
      loading={loading}
      emptyMessage={
        emptyMessage ??
        `No rows in this queue yet. Adjust your filters or check back as new ${title.toLowerCase()} activity comes in.`
      }
      selectedRowId={selectedId}
      onSelectRow={setSelectedId}
      rowActions={rowActions}
      detailTabs={detailTabs}
      detailActions={detailActions}
      message={message}
    />
  );
}
