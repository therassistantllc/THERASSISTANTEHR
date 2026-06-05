"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import PaymentRowActions, { type RowSummary } from "../PaymentRowActions";

type PaymentSource = "era" | "manual_insurance" | "client";

interface DashboardRow extends RowSummary {
  source: PaymentSource;
  claimMatchStatus: string | null;
  clientId: string | null;
  clientDisplayName: string | null;
  professionalClaimId: string | null;
  checkNumber: string | null;
  depositDate: string | null;
  paymentDate: string | null;
  importedAt: string | null;
  remainingRecoupable: number | null;
}

interface DashboardResponse {
  rows?: DashboardRow[];
  rowCount?: number;
  error?: string;
}

const PAGE_SIZE = 50;

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });
}

function sourceLabel(source: PaymentSource) {
  if (source === "manual_insurance") return "Manual EOB";
  if (source === "client") return "Client";
  return "ERA";
}

export default function PostedPaymentsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/billing/payments/dashboard", window.location.origin);
      url.searchParams.set("organizationId", organizationId);
      url.searchParams.set("postingStatus", "posted");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json()) as DashboardResponse;
      if (!res.ok) throw new Error(json.error ?? `Request failed with ${res.status}`);
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load posted payments");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        row.id,
        row.source,
        row.payerName,
        row.clientDisplayName,
        row.clientId,
        row.professionalClaimId,
        row.checkNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, search]);

  const exportHref = `/api/billing/payments/export?organizationId=${encodeURIComponent(
    organizationId,
  )}&postingStatus=posted`;

  return (
    <main className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link href="/billing/payments" className="text-[12px] font-medium text-slate-500 hover:text-slate-900">
          Back to payments
        </Link>
        <div className="h-4 w-px bg-slate-200" />
        <h1 className="text-[13px] font-semibold">Posted payments</h1>
        <span className="text-[11px] text-slate-400">ERA, manual EOB, and client payments</span>
        <div className="flex-1" />
        <a
          href={exportHref}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-300 bg-white px-2 text-[11px] hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </a>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-300 bg-white px-2 text-[11px] hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <section className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-full rounded border border-slate-300 bg-white pl-8 pr-2 text-[12px] outline-none focus:border-blue-500"
            placeholder="Search visible posted payments"
          />
        </div>
        {flash ? (
          <span className={`text-[12px] ${flash.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
            {flash.message}
          </span>
        ) : null}
      </section>

      {error ? (
        <div className="m-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Payer / Method</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Claim</th>
              <th className="px-3 py-2 text-left">Check / Ref</th>
              <th className="px-3 py-2 text-left">Payment date</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 bg-white hover:bg-slate-50">
                <td className="px-3 py-2 font-semibold">{sourceLabel(row.source)}</td>
                <td className="px-3 py-2">{row.payerName ?? "-"}</td>
                <td className="px-3 py-2">
                  {row.clientDisplayName ?? row.clientId ?? <span className="text-slate-400">-</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {row.professionalClaimId ? row.professionalClaimId.slice(0, 8) : "-"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{row.checkNumber ?? "-"}</td>
                <td className="px-3 py-2">{date(row.paymentDate ?? row.depositDate)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(row.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.remainingRecoupable == null ? "-" : money(row.remainingRecoupable)}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/billing/payments/posted/${encodeURIComponent(row.id)}?organizationId=${encodeURIComponent(
                      organizationId,
                    )}`}
                    className="text-blue-700 hover:text-blue-900"
                  >
                    Open
                  </Link>
                  <PaymentRowActions
                    row={row}
                    orgId={organizationId}
                    onChanged={() => void load()}
                    onFlash={(tone, message) => setFlash({ tone, message })}
                  />
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[12px] text-slate-400">
                  No posted payments found.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[12px] text-slate-400">
                  Loading posted payments...
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4">
        <span className="text-[11px] text-slate-500">
          Showing {filtered.length} of {rows.length} loaded rows
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={rows.length < PAGE_SIZE || loading}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </footer>
    </main>
  );
}
