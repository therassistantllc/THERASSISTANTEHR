"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ClaimItem = {
  id: string;
  claimNumber: string | null;
  status: string | null;
  totalCharge: number | null;
  diagnosisCodes: string[];
  createdAt: string | null;
  submittedAt: string | null;
  appointmentId: string | null;
  encounterId: string | null;
  payerName: string | null;
  archivedAt: string | null;
  isPending?: boolean;
};

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

function formatMoney(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusClass(v: string | null | undefined) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("paid") || s.includes("accepted")) return "status status-green";
  if (s.includes("denied") || s.includes("rejected") || s.includes("error")) return "status status-red";
  if (s.includes("pending") || s.includes("submitted") || s.includes("batch")) return "status status-yellow";
  return "status";
}

export default function ClaimsPage() {
  const params = useParams<{ clientId?: string; id?: string }>();
  const clientId = params?.clientId ?? params?.id ?? "";
  const searchParams = useSearchParams();
  const orgId = searchParams.get("organizationId") ?? process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";

  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; tone: "ok" | "err" } | null>(null);

  const submittedCount = claims.filter((claim) => String(claim.status ?? "").toLowerCase().includes("submitted")).length;
  const paidCount = claims.filter((claim) => String(claim.status ?? "").toLowerCase().includes("paid")).length;
  const deniedOrRejectedCount = claims.filter((claim) => {
    const status = String(claim.status ?? "").toLowerCase();
    return status.includes("denied") || status.includes("rejected");
  }).length;
  const totalCharges = claims.reduce((sum, claim) => sum + Number(claim.totalCharge ?? 0), 0);

  const loadClaims = useCallback(async () => {
    if (!clientId || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ organizationId: orgId });
      if (showArchived) qs.set("includeArchived", "1");
      const r = await fetch(`/api/patients/${clientId}/claims?${qs.toString()}`, { cache: "no-store" });
      const json = await r.json() as { success: boolean; claims?: ClaimItem[]; error?: string };
      if (!json.success) throw new Error(json.error ?? "Failed");
      setClaims(json.claims ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [clientId, orgId, showArchived]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const archiveClaim = useCallback(async (claimId: string) => {
    if (!orgId) return;
    if (typeof window !== "undefined" && !window.confirm("Archive this claim? This frees the encounter so a fresh claim can be created.")) {
      return;
    }
    setArchivingId(claimId);
    setRowMessage(null);
    try {
      const r = await fetch(`/api/claims/${encodeURIComponent(claimId)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const json = await r.json() as { success: boolean; error?: string };
      if (!r.ok || !json.success) throw new Error(json.error ?? "Archive failed");
      setRowMessage({ id: claimId, text: "Claim archived.", tone: "ok" });
      await loadClaims();
    } catch (e: unknown) {
      setRowMessage({ id: claimId, text: e instanceof Error ? e.message : "Archive failed", tone: "err" });
    } finally {
      setArchivingId(null);
    }
  }, [orgId, loadClaims]);

  const restoreClaim = useCallback(async (claimId: string) => {
    if (!orgId) return;
    setRestoringId(claimId);
    setRowMessage(null);
    try {
      const r = await fetch(`/api/claims/${encodeURIComponent(claimId)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const json = await r.json() as { success: boolean; error?: string };
      if (!r.ok || !json.success) throw new Error(json.error ?? "Restore failed");
      setRowMessage({ id: claimId, text: "Claim restored.", tone: "ok" });
      await loadClaims();
    } catch (e: unknown) {
      setRowMessage({ id: claimId, text: e instanceof Error ? e.message : "Restore failed", tone: "err" });
    } finally {
      setRestoringId(null);
    }
  }, [orgId, loadClaims]);

  const orgQ = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";

  return (
    <main className="app-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">Client Chart</p>
          <h2>Claims History</h2>
        </div>
        <div className="hero-actions">
          <label className="checkbox-inline" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show archived</span>
          </label>
          <Link className="button button-secondary" href={`/billing/charge-capture${orgQ}`}>
            Charge Capture
          </Link>
          <Link className="button button-secondary" href={`/billing/837p-batches${orgQ}`}>
            837P Batches
          </Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Total Claims</span>
          <strong>{loading ? "-" : claims.length}</strong>
        </article>
        <article className="metric-card">
          <span>Submitted</span>
          <strong>{loading ? "-" : submittedCount}</strong>
        </article>
        <article className="metric-card">
          <span>Paid</span>
          <strong>{loading ? "-" : paidCount}</strong>
        </article>
        <article className="metric-card">
          <span>Total Charge</span>
          <strong className="metric-text">{loading ? "-" : formatMoney(totalCharges)}</strong>
        </article>
      </section>

      {!loading && deniedOrRejectedCount > 0 ? (
        <div className="alert-panel">{deniedOrRejectedCount} denied/rejected claim(s) need follow-up.</div>
      ) : null}

      {loading && <div className="empty-state">Loading claims…</div>}
      {error && <div className="alert-panel">{error}</div>}

      {!loading && claims.length === 0 && !error && (
        <div className="empty-state">No professional claims found for this client.</div>
      )}

      {claims.length > 0 && (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Status</th>
                <th>Payer</th>
                <th>Total Charge</th>
                <th>Diagnoses</th>
                <th>Created</th>
                <th>Submitted</th>
                <th>Encounter</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <td>
                    {claim.isPending ? (
                      <strong>{claim.claimNumber ?? claim.id.slice(0, 8)}</strong>
                    ) : (
                      <Link
                        className="inline-link"
                        href={`/billing/claims/${encodeURIComponent(claim.id)}${orgQ}`}
                      >
                        <strong>{claim.claimNumber ?? claim.id.slice(0, 8)}</strong>
                      </Link>
                    )}
                  </td>
                  <td><span className={statusClass(claim.status)}>{claim.status ?? "—"}</span></td>
                  <td>{claim.payerName ?? <span className="muted">—</span>}</td>
                  <td>{formatMoney(claim.totalCharge)}</td>
                  <td>{claim.diagnosisCodes.join(", ") || "—"}</td>
                  <td>{formatDate(claim.createdAt)}</td>
                  <td>{claim.submittedAt ? formatDate(claim.submittedAt) : <span className="muted">Not submitted</span>}</td>
                  <td>
                    {claim.encounterId
                      ? <Link className="inline-link" href={`/encounters/${claim.encounterId}${orgQ}`}>Encounter</Link>
                      : "—"}
                  </td>
                  <td>
                    {claim.isPending ? (
                      <Link
                        className="inline-link"
                        href={`/billing/charge-capture${orgQ}`}
                        title="Resolve in Charge Capture to create a claim"
                      >
                        Charge Capture
                      </Link>
                    ) : claim.archivedAt ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void restoreClaim(claim.id)}
                        disabled={restoringId === claim.id}
                        title={`Archived ${formatDate(claim.archivedAt)}`}
                      >
                        {restoringId === claim.id ? "Restoring…" : "Restore"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void archiveClaim(claim.id)}
                        disabled={archivingId === claim.id}
                      >
                        {archivingId === claim.id ? "Archiving…" : "Archive"}
                      </button>
                    )}
                    {rowMessage && rowMessage.id === claim.id ? (
                      <div className={rowMessage.tone === "ok" ? "status status-green" : "status status-red"}>
                        {rowMessage.text}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
