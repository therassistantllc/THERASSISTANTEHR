"use client";

/**
 * Task #694 — Orphaned Generation Failures workqueue.
 *
 * Dedicated tab listing every 837P batch stuck in `ready_to_generate`
 * with a persisted `last_generation_error` (i.e. the validator
 * rejected the file on Generate / Bulk Batch). Each row shows the
 * batch number, originating biller, claim count, $ total, the
 * validator error, and a Retry button that calls the existing
 * `/api/claims/837p/batch/[id]/rebuild` endpoint.
 *
 * The "Routed to me" toggle (on by default) narrows to batches whose
 * `created_by_user_id` matches the current session — that's how an
 * orphaned batch surfaces automatically for the biller who triggered
 * the failed generate, satisfying the "auto-route back to biller"
 * requirement.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_ORG_ID } from "@/lib/config";
import { getWorkqueue } from "@/lib/billing/workqueues";

interface ClaimSummary {
  id: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  totalCharge: number;
  status: string;
}

interface OrphanedBatchRow {
  id: string;
  batchNumber: string;
  batchStatus: string;
  claimCount: number;
  totalCharges: number;
  errorMessage: string;
  errorDetail: {
    code?: string;
    message?: string;
    claimId?: string;
    loop?: string;
    segment?: string;
    field?: string;
  } | null;
  attemptedAt: string | null;
  agingDays: number | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  claims: ClaimSummary[];
}

interface Biller {
  id: string;
  displayName: string;
}

interface ApiPayload {
  success: boolean;
  error?: string;
  items?: OrphanedBatchRow[];
  billers?: Biller[];
  sessionUserId?: string | null;
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

const queueDef = getWorkqueue("orphaned_batches");

export default function OrphanedBatchesClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [items, setItems] = useState<OrphanedBatchRow[]>([]);
  const [billers, setBillers] = useState<Biller[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [routedToMe, setRoutedToMe] = useState(true);
  const [billerFilter, setBillerFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({ organizationId });
    if (routedToMe) qs.set("assignedBiller", "__me__");
    else if (billerFilter) qs.set("assignedBiller", billerFilter);
    fetch(`/api/billing/orphaned-batches?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<ApiPayload>)
      .then((json) => {
        if (json.success && Array.isArray(json.items)) {
          setItems(json.items);
          if (Array.isArray(json.billers)) setBillers(json.billers);
          if (json.sessionUserId !== undefined) {
            setSessionUserId(json.sessionUserId ?? null);
          }
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
  }, [organizationId, reloadKey, routedToMe, billerFilter]);

  // ── Retry generation ────────────────────────────────────────────────────
  const retry = useCallback(
    async (batchId: string) => {
      setBusyId(batchId);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/claims/837p/batch/${encodeURIComponent(batchId)}/rebuild`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId }),
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
          throw new Error(json.error || "Retry failed — see batch detail for the validator error");
        }
        setMessage({ tone: "success", text: "Batch regenerated and removed from the queue." });
        setReloadKey((k) => k + 1);
      } catch (e) {
        setMessage({
          tone: "error",
          text: e instanceof Error ? e.message : "Retry failed",
        });
        // Refresh anyway — the validator error may have been updated on the row.
        setReloadKey((k) => k + 1);
      } finally {
        setBusyId(null);
      }
    },
    [organizationId],
  );

  // ── UI ──────────────────────────────────────────────────────────────────
  const totalDollars = items.reduce((s, r) => s + r.totalCharges, 0);
  const oldest = items.reduce((m, r) => Math.max(m, r.agingDays ?? 0), 0);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/billing"
          style={{ fontSize: 13, color: "#475569", textDecoration: "none" }}
        >
          ← All workqueues
        </Link>
        <h1 style={{ margin: "8px 0 4px", fontSize: 22, fontWeight: 700 }}>
          {queueDef?.title ?? "Orphaned Generation Failures"}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b", maxWidth: 760 }}>
          {queueDef?.description ??
            "837P batches that failed the validator and are stuck in ready_to_generate."}
        </p>
      </div>

      {/* Summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0,1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <SummaryCard label="Stuck batches" value={items.length.toLocaleString()} />
        <SummaryCard label="Total $" value={money(totalDollars)} />
        <SummaryCard
          label="Oldest (days)"
          value={oldest}
          tone={oldest > 7 ? "red" : oldest > 3 ? "amber" : "default"}
        />
      </div>

      {/* Filter rail */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 16px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={routedToMe}
            onChange={(e) => {
              setRoutedToMe(e.target.checked);
              if (e.target.checked) setBillerFilter("");
            }}
          />
          <span>
            Routed to me
            {sessionUserId ? "" : " (dev: no session)"}
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ color: "#475569" }}>Or biller:</span>
          <select
            value={billerFilter}
            disabled={routedToMe}
            onChange={(e) => setBillerFilter(e.target.value)}
            style={{
              padding: "4px 8px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 13,
              background: routedToMe ? "#f1f5f9" : "white",
            }}
          >
            <option value="">All billers</option>
            <option value="__unassigned__">Unassigned (no creator recorded)</option>
            {billers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          style={{
            marginLeft: "auto",
            padding: "4px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "white",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {message ? (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            borderRadius: 6,
            fontSize: 13,
            background: message.tone === "success" ? "#ecfdf5" : "#fef2f2",
            color: message.tone === "success" ? "#065f46" : "#991b1b",
            border: `1px solid ${message.tone === "success" ? "#a7f3d0" : "#fecaca"}`,
          }}
        >
          {message.text}
        </div>
      ) : null}

      {/* Table */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
          background: "white",
        }}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#64748b", fontSize: 13 }}>
            <strong>No orphaned batches.</strong>
            <div style={{ marginTop: 6 }}>
              Every 837P batch that failed validation is either resolved or has
              already been retried successfully.
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                <th style={th}>Batch</th>
                <th style={th}>Created by</th>
                <th style={{ ...th, textAlign: "right" }}>Claims</th>
                <th style={{ ...th, textAlign: "right" }}>Total $</th>
                <th style={th}>Last validator error</th>
                <th style={th}>Failed at</th>
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const isExpanded = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#1d4ed8",
                            cursor: "pointer",
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 12,
                            textAlign: "left",
                          }}
                        >
                          {r.batchNumber}
                        </button>
                      </td>
                      <td style={td}>
                        {r.createdByDisplayName ? (
                          <span>
                            {r.createdByDisplayName}
                            {r.createdByUserId &&
                            sessionUserId &&
                            r.createdByUserId === sessionUserId ? (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "#1d4ed8",
                                }}
                              >
                                YOU
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>Unknown</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {r.claimCount.toLocaleString()}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{money(r.totalCharges)}</td>
                      <td style={td}>
                        <span
                          title={r.errorMessage}
                          style={{
                            display: "inline-block",
                            maxWidth: 360,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "#b91c1c",
                          }}
                        >
                          {r.errorMessage}
                        </span>
                        {r.errorDetail?.field || r.errorDetail?.loop ? (
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            {[
                              r.errorDetail.loop && `Loop ${r.errorDetail.loop}`,
                              r.errorDetail.segment && `Segment ${r.errorDetail.segment}`,
                              r.errorDetail.field && `Field ${r.errorDetail.field}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <div>{formatDateTime(r.attemptedAt)}</div>
                        {r.agingDays != null ? (
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            {r.agingDays}d ago
                          </div>
                        ) : null}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => retry(r.id)}
                          disabled={busyId === r.id}
                          style={{
                            padding: "5px 12px",
                            border: "1px solid #1d4ed8",
                            borderRadius: 6,
                            background: busyId === r.id ? "#cbd5e1" : "#1d4ed8",
                            color: "white",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: busyId === r.id ? "wait" : "pointer",
                          }}
                        >
                          {busyId === r.id ? "Retrying…" : "Retry generation"}
                        </button>
                        <Link
                          href={`/billing/837p-batches/${r.id}`}
                          style={{
                            marginLeft: 8,
                            fontSize: 12,
                            color: "#475569",
                          }}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr style={{ background: "#f8fafc" }}>
                        <td style={{ padding: 12 }} colSpan={7}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>
                            Affected claims ({r.claims.length})
                          </div>
                          {r.claims.length === 0 ? (
                            <div style={{ color: "#64748b" }}>(no linked claims)</div>
                          ) : (
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: 12,
                              }}
                            >
                              <thead>
                                <tr style={{ textAlign: "left", color: "#475569" }}>
                                  <th style={tdSmall}>Claim #</th>
                                  <th style={tdSmall}>Client</th>
                                  <th style={tdSmall}>Payer</th>
                                  <th style={{ ...tdSmall, textAlign: "right" }}>
                                    Charge
                                  </th>
                                  <th style={tdSmall}>Flagged</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.claims.map((c) => (
                                  <tr
                                    key={c.id}
                                    style={{ borderTop: "1px solid #e2e8f0" }}
                                  >
                                    <td style={tdSmall}>
                                      {c.claimNumber ?? c.id.slice(0, 8)}
                                    </td>
                                    <td style={tdSmall}>{c.clientName}</td>
                                    <td style={tdSmall}>{c.payerName ?? "—"}</td>
                                    <td style={{ ...tdSmall, textAlign: "right" }}>
                                      {money(c.totalCharge)}
                                    </td>
                                    <td style={tdSmall}>
                                      {r.errorDetail?.claimId === c.id ? (
                                        <span style={{ color: "#b91c1c", fontWeight: 600 }}>
                                          ← validator pointed here
                                        </span>
                                      ) : (
                                        ""
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

const th: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "top",
};

const tdSmall: React.CSSProperties = {
  padding: "6px 8px",
  verticalAlign: "top",
};

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "amber" | "red";
}) {
  const color =
    tone === "red" ? "#b91c1c" : tone === "amber" ? "#b45309" : "#0f172a";
  return (
    <div
      style={{
        padding: "12px 16px",
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
