"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

interface AuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_role: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  claim_id: string | null;
  workqueue_item_id: string | null;
  event_summary: string | null;
  before_value: unknown;
  after_value: unknown;
  event_metadata: unknown;
}

interface ApiResponse {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  actions: string[];
  error?: string;
}

function getOrgId() {
  if (typeof window === "undefined")
    return process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
  return (
    new URLSearchParams(window.location.search).get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const PAGE_SIZE = 50;

export default function AuditViewer() {
  const organizationId = useMemo(() => getOrgId(), []);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      organizationId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (actionFilter) qs.set("action", actionFilter);
    if (userIdFilter) qs.set("userId", userIdFilter);
    if (fromFilter) {
      const d = new Date(fromFilter);
      if (!Number.isNaN(d.getTime())) qs.set("from", d.toISOString());
    }
    if (toFilter) {
      const d = new Date(toFilter);
      if (!Number.isNaN(d.getTime())) qs.set("to", d.toISOString());
    }
    try {
      const r = await fetch(`/api/billing/payments/audit?${qs.toString()}`);
      const json = (await r.json()) as ApiResponse;
      if (!r.ok) {
        setError(json.error ?? `HTTP ${r.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(json.rows);
      setTotal(json.total);
      setActions(json.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [organizationId, offset, actionFilter, userIdFilter, fromFilter, toFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const onApplyFilters = () => {
    setOffset(0);
  };

  const onClearFilters = () => {
    setActionFilter("");
    setUserIdFilter("");
    setFromFilter("");
    setToFilter("");
    setOffset(0);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Payment Audit Log</h1>
        <p className="text-sm text-slate-600">
          Admin view of every mutating payment action (post, reverse, void, adjust, refund,
          recoupment, batch import/post). Scoped to your organization.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          Action
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          Actor user_id
          <input
            type="text"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="UUID"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          From
          <input
            type="datetime-local"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          To
          <input
            type="datetime-local"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApplyFilters}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
          <span>
            {loading ? "Loading…" : `${total} row${total === 1 ? "" : "s"}`} · showing{" "}
            {rows.length > 0 ? `${offset + 1}–${offset + rows.length}` : "0"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Object</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Summary</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = !!expanded[row.id];
              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {fmtDate(row.created_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <div>{row.object_type}</div>
                      <div className="text-slate-500">{row.object_id ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <div>{row.user_role ?? "—"}</div>
                      <div className="text-slate-500">{row.user_id ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.event_summary ?? "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [row.id]: !isOpen }))}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                      >
                        {isOpen ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                          <div>
                            <div className="font-medium text-slate-700 mb-1">before_value</div>
                            <pre className="bg-white border border-slate-200 rounded p-2 max-h-48 overflow-auto">
                              {JSON.stringify(row.before_value, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div className="font-medium text-slate-700 mb-1">after_value</div>
                            <pre className="bg-white border border-slate-200 rounded p-2 max-h-48 overflow-auto">
                              {JSON.stringify(row.after_value, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div className="font-medium text-slate-700 mb-1">metadata</div>
                            <pre className="bg-white border border-slate-200 rounded p-2 max-h-48 overflow-auto">
                              {JSON.stringify(row.event_metadata, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                  No audit rows match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
