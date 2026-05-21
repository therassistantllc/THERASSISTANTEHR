"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type BatchClaim = {
  id: string;
  patientId: string;
  patientName: string;
  dateOfBirth?: string | null;
  claimNumber?: unknown;
  status?: unknown;
  totalChargeAmount: number;
  updatedAt?: unknown;
};

type Batch837P = {
  id: string;
  batchNumber?: unknown;
  status?: unknown;
  claimCount: number;
  totalChargeAmount: number;
  generatedFileName?: unknown;
  submittedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  claims: BatchClaim[];
};

type Payload = {
  success: boolean;
  error?: string;
  metrics?: {
    total: number;
    readyToGenerate: number;
    generated: number;
    submitted: number;
    rejected: number;
  };
  batches?: Batch837P[];
};

type Acknowledgement = {
  id: string;
  acknowledgement_type: string;
  file_name: string | null;
  raw_content: string | null;
  parsed_content: unknown;
  created_at: string;
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function getHighlightBatchId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("batchId");
}

function formatDate(value: unknown) {
  if (!value) return "Not listed";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function formatMoney(value: number) {
  return Number(value ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusClass(value: unknown) {
  const status = String(value ?? "").toLowerCase();
  if (status.includes("accepted") || status.includes("generated") || status.includes("submitted")) return "status status-green";
  if (status.includes("rejected") || status.includes("failed")) return "status status-red";
  return "status status-yellow";
}

const SUBMITTABLE = new Set(["generated", "ready", "queued"]);
const RETRY_STATUSES = new Set(["rejected", "rejected_999", "rejected_oa", "failed"]);

export default function Batches837PClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const highlightBatchId = useMemo(() => getHighlightBatchId(), []);
  const highlightedRef = useRef<HTMLElement | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; message: string } | null>(null);
  const [ackModal, setAckModal] = useState<{ batchId: string; type: "999" | "277CA"; loading: boolean; items: Acknowledgement[]; error: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setError("Missing organizationId. Add ?organizationId=... to the URL or configure NEXT_PUBLIC_ORGANIZATION_ID.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/billing/837p-batches?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" });
      const json = (await response.json()) as Payload;
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to load 837P batches");
      setPayload(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load 837P batches");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!highlightBatchId || loading) return;
    const node = highlightedRef.current;
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightBatchId, loading, payload]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = payload?.metrics ?? { total: 0, readyToGenerate: 0, generated: 0, submitted: 0, rejected: 0 };
  const batches = payload?.batches ?? [];
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected]);
  const hasSelection = selectedIds.length > 0;

  function flash(tone: "ok" | "err", message: string) {
    setToast({ tone, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function markSubmitted(batchIds: string[], action: "submit" | "retry" = "submit") {
    let ok = 0;
    const errs: string[] = [];
    for (const batchId of batchIds) {
      try {
        const res = await fetch(`/api/claims/837p/batch/${encodeURIComponent(batchId)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, action }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) errs.push(`${batchId.slice(0, 8)}: ${json.error ?? "failed"}`);
        else ok++;
      } catch (e) {
        errs.push(`${batchId.slice(0, 8)}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    return { ok, errs };
  }

  async function handleSubmitSelected() {
    const eligible = batches.filter((b) => selected[b.id] && SUBMITTABLE.has(String(b.status ?? "").toLowerCase()));
    if (eligible.length === 0) {
      flash("err", "Select one or more batches in a submittable state (generated/ready/queued).");
      return;
    }
    if (!window.confirm(`Submit ${eligible.length} batch(es) to the clearinghouse?`)) return;
    setBusy("submit");
    const { ok, errs } = await markSubmitted(eligible.map((b) => b.id));
    setBusy(null);
    setSelected({});
    await load();
    flash(errs.length ? "err" : "ok", `${ok} submitted${errs.length ? `; errors: ${errs.join("; ")}` : ""}.`);
  }

  async function handleRetryRejected() {
    const targets = (hasSelection ? batches.filter((b) => selected[b.id]) : batches).filter((b) =>
      RETRY_STATUSES.has(String(b.status ?? "").toLowerCase()),
    );
    if (targets.length === 0) {
      flash("err", "No rejected batches to retry.");
      return;
    }
    if (!window.confirm(`Retry ${targets.length} rejected batch(es)?`)) return;
    setBusy("retry");
    const { ok, errs } = await markSubmitted(targets.map((b) => b.id), "retry");
    setBusy(null);
    setSelected({});
    await load();
    flash(errs.length ? "err" : "ok", `${ok} retried${errs.length ? `; errors: ${errs.join("; ")}` : ""}.`);
  }

  async function handleRevalidate() {
    const targets = (hasSelection ? batches.filter((b) => selected[b.id]) : batches);
    if (targets.length === 0) {
      flash("err", "No batches to revalidate.");
      return;
    }
    setBusy("revalidate");
    let passed = 0;
    let failedClaims = 0;
    const errs: string[] = [];
    for (const b of targets) {
      try {
        const res = await fetch(`/api/claims/837p/batch/${encodeURIComponent(b.id)}/revalidate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) errs.push(`${b.id.slice(0, 8)}: ${json.error ?? "failed"}`);
        else {
          passed += Number(json.passed ?? 0);
          failedClaims += Array.isArray(json.failed) ? json.failed.length : 0;
        }
      } catch (e) {
        errs.push(`${b.id.slice(0, 8)}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBusy(null);
    await load();
    flash(errs.length ? "err" : "ok", `Revalidated ${targets.length} batch(es): ${passed} claim(s) passed, ${failedClaims} still blocked${errs.length ? `; ${errs.join("; ")}` : ""}.`);
  }

  function handleExport(batchId: string) {
    const url = `/api/claims/837p/batch/${encodeURIComponent(batchId)}/file?organizationId=${encodeURIComponent(organizationId)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function openAck(batchId: string, type: "999" | "277CA") {
    setAckModal({ batchId, type, loading: true, items: [], error: null });
    try {
      const res = await fetch(
        `/api/claims/837p/batch/${encodeURIComponent(batchId)}/acknowledgements?organizationId=${encodeURIComponent(organizationId)}&type=${type}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed");
      setAckModal({ batchId, type, loading: false, items: (json.acknowledgements ?? []) as Acknowledgement[], error: null });
    } catch (e) {
      setAckModal({ batchId, type, loading: false, items: [], error: e instanceof Error ? e.message : "Failed" });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Billing</p>
          <h1>Claim Submission</h1>
          <p className="hero-copy">Submit and monitor 837P batch transmissions using existing clearinghouse integration workflows.</p>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" href="/billing/charge-capture">Charge Capture</Link>
          <Link className="button button-secondary" href="/calendar">Calendar</Link>
        </div>
      </section>

      {error ? <div className="alert-panel">{error}</div> : null}
      {toast ? (
        <div
          className="alert-panel"
          style={{
            background: toast.tone === "ok" ? "#ECFDF5" : "#FEF2F2",
            borderColor: toast.tone === "ok" ? "#A7F3D0" : "#FECACA",
            color: toast.tone === "ok" ? "#065F46" : "#991B1B",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card"><span>Total Batches</span><strong>{loading ? "—" : metrics.total}</strong></article>
        <article className="metric-card"><span>Ready to Generate</span><strong>{loading ? "—" : metrics.readyToGenerate}</strong></article>
        <article className="metric-card"><span>Submitted</span><strong>{loading ? "—" : metrics.submitted}</strong></article>
        <article className="metric-card"><span>Rejected</span><strong>{loading ? "—" : metrics.rejected}</strong></article>
      </section>

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Submission Queue</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="button"
              disabled={busy !== null || !hasSelection}
              onClick={() => void handleSubmitSelected()}
              title={hasSelection ? "Mark selected generated/ready batches as submitted" : "Select one or more batches first"}
            >
              {busy === "submit" ? "Submitting…" : `Submit selected${hasSelection ? ` (${selectedIds.length})` : ""}`}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void handleRetryRejected()}
              title={hasSelection ? "Retry rejected batches in your selection" : "Retry every rejected batch"}
            >
              {busy === "retry" ? "Retrying…" : "Retry rejected"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void handleRevalidate()}
              title={hasSelection ? "Re-run validation on claims in selected batches" : "Re-run validation on claims in all listed batches"}
            >
              {busy === "revalidate" ? "Revalidating…" : "Revalidate"}
            </button>
          </div>
        </div>

        {loading ? <div className="empty-state">Loading 837P batches…</div> : null}
        {!loading && batches.length === 0 ? <div className="empty-state">No 837P batches found.</div> : null}

        <div className="stack-list">
          {batches.map((batch) => {
            const isHighlighted = highlightBatchId === batch.id;
            const statusLower = String(batch.status ?? "").toLowerCase();
            const canExport = true; // file endpoint reports a clear 404 if no content yet
            return (
              <article
                className="stack-item"
                key={batch.id}
                ref={isHighlighted ? highlightedRef : undefined}
                style={isHighlighted ? {
                  border: "2px solid #3B82F6",
                  background: "#EFF6FF",
                  boxShadow: "0 0 0 4px rgba(59,130,246,0.12)",
                  transition: "background 0.3s",
                } : undefined}
              >
                <div className="stack-row">
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[batch.id])}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [batch.id]: e.target.checked }))}
                      style={{ marginTop: 4 }}
                      aria-label={`Select batch ${String(batch.batchNumber ?? batch.id.slice(0, 8))}`}
                    />
                    <div>
                      <strong>
                        {String(batch.batchNumber ?? "837P Batch")}
                        {isHighlighted ? (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#3B82F6", background: "#DBEAFE", padding: "2px 8px", borderRadius: 12 }}>
                            Selected
                          </span>
                        ) : null}
                      </strong>
                      <span>Created: {formatDate(batch.createdAt)} · Claims: {batch.claimCount}</span>
                      <span>Total charge: {formatMoney(batch.totalChargeAmount)}</span>
                      {batch.generatedFileName ? <span>File: {String(batch.generatedFileName)}</span> : null}
                    </div>
                  </div>
                  <div className="invoice-money-grid">
                    <span className={statusClass(batch.status)}>{String(batch.status ?? "status not set")}</span>
                    {batch.submittedAt ? <span>Submitted {formatDate(batch.submittedAt)}</span> : <span>Not submitted</span>}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <Link
                    className="button"
                    href={`/billing/batches/${encodeURIComponent(batch.id)}?organizationId=${encodeURIComponent(organizationId)}`}
                  >
                    Open lifecycle
                  </Link>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!canExport}
                    onClick={() => handleExport(batch.id)}
                  >
                    Export 837P
                  </button>
                  <button type="button" className="button button-secondary" onClick={() => void openAck(batch.id, "999")}>
                    View 999
                  </button>
                  <button type="button" className="button button-secondary" onClick={() => void openAck(batch.id, "277CA")}>
                    View 277CA
                  </button>
                  {RETRY_STATUSES.has(statusLower) ? (
                    <button
                      type="button"
                      className="button"
                      disabled={busy !== null}
                      onClick={async () => {
                        if (!window.confirm("Retry this rejected batch?")) return;
                        setBusy("retry");
                        const { ok, errs } = await markSubmitted([batch.id], "retry");
                        setBusy(null);
                        await load();
                        flash(errs.length ? "err" : "ok", ok ? "Batch retried." : (errs.join("; ") || "Retry failed"));
                      }}
                    >
                      Resubmit
                    </button>
                  ) : null}
                </div>

                {batch.claims.length > 0 ? (
                  <div className="payment-history">
                    <strong>Claims in Batch</strong>
                    {batch.claims.map((claim) => (
                      <span key={claim.id}>
                        {claim.patientName} · Claim {String(claim.claimNumber ?? claim.id.slice(0, 8))} · {String(claim.status ?? "status not set")} · {formatMoney(claim.totalChargeAmount)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {ackModal ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setAckModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 760, maxHeight: "85vh", overflow: "auto", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{ackModal.type} acknowledgements · batch {ackModal.batchId.slice(0, 8)}</h3>
              <button type="button" className="button button-secondary" onClick={() => setAckModal(null)}>Close</button>
            </div>
            {ackModal.loading ? (
              <div className="empty-state">Loading…</div>
            ) : ackModal.error ? (
              <div className="alert-panel">{ackModal.error}</div>
            ) : ackModal.items.length === 0 ? (
              <div className="empty-state">
                No {ackModal.type} acknowledgement received for this batch yet. Once the clearinghouse posts one,
                it will be parsed and displayed here.
              </div>
            ) : (
              <div className="stack-list">
                {ackModal.items.map((ack) => (
                  <article key={ack.id} className="stack-item">
                    <div className="stack-row">
                      <div>
                        <strong>{ack.file_name || `${ack.acknowledgement_type} ${ack.id.slice(0, 8)}`}</strong>
                        <span>Received: {formatDate(ack.created_at)}</span>
                      </div>
                    </div>
                    {ack.parsed_content ? (
                      <pre style={{ background: "#F8FAFC", padding: 10, borderRadius: 6, fontSize: 12, overflow: "auto", margin: "8px 0" }}>
                        {JSON.stringify(ack.parsed_content, null, 2)}
                      </pre>
                    ) : null}
                    {ack.raw_content ? (
                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12, color: "#475569" }}>Raw EDI</summary>
                        <pre style={{ background: "#0F172A", color: "#E2E8F0", padding: 10, borderRadius: 6, fontSize: 11, overflow: "auto", whiteSpace: "pre-wrap" }}>
                          {ack.raw_content}
                        </pre>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
