"use client";

/**
 * PlaceholderQueueClient
 * ───────────────────────────────────────────────────────────────────────────
 * Shared scaffold for billing workqueues whose dedicated backend service
 * hasn't been built yet, but whose route, shell, filters, tabs, and column
 * layout we want in place so the universal nav stops showing "Soon" and
 * billers have a real surface to land on.
 *
 * Each queue passes its own tabs, columns, and summary labels. The shell
 * renders the universal filter rail + summary strip + table from
 * `WorkqueueShell`, an empty body, and a single "Refresh" header action.
 *
 * When the queue's real service ships, replace the page's import of this
 * client with the queue-specific client — no shell wiring changes needed.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import WorkqueueShell, {
  type ColumnDef,
  type DetailTab,
  type FilterDef,
  type PrimaryAction,
  type PrimaryTab,
  type SummaryMetric,
} from "@/components/billing/WorkqueueShell";
import { getWorkqueue } from "@/lib/billing/workqueues";

export interface PlaceholderTab {
  id: string;
  label: string;
}

export interface PlaceholderColumn {
  id: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: number | string;
}

export interface PlaceholderQueueConfig {
  queueId: string;
  /** Override the registry title (rare). */
  title?: string;
  /** Override the registry description (rare). */
  description?: string;
  /** URL namespace for filter persistence (?<ns>_<filter>=). */
  filterUrlNamespace: string;
  /** Tabs shown above the filter rail (e.g. lifecycle states for this queue). */
  tabs: PlaceholderTab[];
  /** Table columns. Cells render "—" until the backing service is wired. */
  columns: PlaceholderColumn[];
  /** Optional extra filters on top of the universal filter rail. */
  extraFilters?: FilterDef[];
  /** Optional summary card labels — default is count / $ / oldest / urgent. */
  summaryLabels?: {
    count?: string;
    dollars?: string;
    oldest?: string;
    urgent?: string;
  };
  /** Empty-state message — override per queue when the default reads oddly. */
  emptyMessage?: string;
  /**
   * Extra detail tabs shown in the right panel. The default detail panel
   * shows a single "Details" tab with a placeholder message.
   */
  detailTabs?: DetailTab[];
}

const UNIVERSAL_FILTERS: FilterDef[] = [
  { id: "practice", label: "Practice", kind: "select", options: [] },
  { id: "clinician", label: "Clinician", kind: "select", options: [] },
  { id: "payer", label: "Payer", kind: "select", options: [] },
  { id: "client", label: "Client", kind: "text", placeholder: "Client name…" },
  { id: "dosFrom", label: "DOS from", kind: "date" },
  { id: "dosTo", label: "DOS to", kind: "date" },
  { id: "assignedBiller", label: "Assigned biller", kind: "select", options: [] },
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

type Row = Record<string, never>; // no rows yet

export default function PlaceholderQueueClient(props: PlaceholderQueueConfig) {
  const {
    queueId,
    title,
    description,
    filterUrlNamespace,
    tabs,
    columns,
    extraFilters,
    summaryLabels,
    emptyMessage,
    detailTabs,
  } = props;

  const def = getWorkqueue(queueId);
  const resolvedTitle = title ?? def?.title ?? "Workqueue";
  const resolvedDesc = description ?? def?.description ?? "";

  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.id ?? "");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    // No service wired yet — record the refresh attempt so the user sees the
    // button respond. Real data load goes here when the queue's backend ships.
    setRefreshedAt(new Date());
  }, []);

  const headerActions: PrimaryAction[] = useMemo(
    () => [
      {
        id: "refresh",
        label: "Refresh",
        onClick: refresh,
      },
    ],
    [refresh],
  );

  const summary: SummaryMetric[] = useMemo(
    () => [
      { id: "count", label: summaryLabels?.count ?? "Open items", value: "0" },
      { id: "dollars", label: summaryLabels?.dollars ?? "Total $", value: "$0.00" },
      { id: "oldest", label: summaryLabels?.oldest ?? "Oldest age", value: "—" },
      { id: "urgent", label: summaryLabels?.urgent ?? "Urgent", value: "0" },
    ],
    [summaryLabels],
  );

  const primaryTabs: PrimaryTab[] = useMemo(
    () => tabs.map((t) => ({ id: t.id, label: t.label, count: 0 })),
    [tabs],
  );

  const shellColumns: ColumnDef<Row>[] = useMemo(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        align: c.align,
        width: c.width,
        cell: () => "—" as ReactNode,
      })),
    [columns],
  );

  const filters: FilterDef[] = useMemo(
    () => [...UNIVERSAL_FILTERS, ...(extraFilters ?? [])],
    [extraFilters],
  );

  const defaultDetail: DetailTab[] = useMemo(
    () => [
      {
        id: "details",
        label: "Details",
        render: () => (
          <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
            Row details will appear here once the queue&apos;s data service is live.
          </p>
        ),
      },
    ],
    [],
  );

  const placeholderEmpty =
    emptyMessage ??
    `No items in this queue yet. The ${resolvedTitle.toLowerCase()} feed will populate here as soon as upstream data starts flowing.`;

  return (
    <WorkqueueShell<Row>
      title={resolvedTitle}
      description={resolvedDesc}
      headerActions={headerActions}
      summary={summary}
      primaryTabs={primaryTabs}
      activePrimaryTabId={activeTab}
      onPrimaryTabChange={setActiveTab}
      filters={filters}
      filterValues={filterValues}
      onFilterChange={setFilterValues}
      filterUrlNamespace={filterUrlNamespace}
      rows={[]}
      columns={shellColumns}
      rowId={() => ""}
      emptyMessage={placeholderEmpty}
      detailTabs={detailTabs ?? defaultDetail}
      message={
        refreshedAt
          ? {
              tone: "success",
              text: `Refreshed at ${refreshedAt.toLocaleTimeString()} — no items yet.`,
            }
          : null
      }
    />
  );
}
