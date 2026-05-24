"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type ReportPayload = {
  success?: boolean;
  error?: string;
  month?: string;
  claims?: {
    submitted: number;
    paid: number;
    deniedOrRejected: number;
    totalChargeSubmitted: number;
  };
  payments?: {
    count: number;
    totalAmount: number;
  };
};

type Provider = {
  id: string;
  provider_name: string;
};

function getOrganizationId() {
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
  return new URLSearchParams(window.location.search).get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function money(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatMonth(value: string) {
  if (!value) return "Current month";
  const parsed = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function thisMonth() {
  const now = new Date();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${now.getFullYear()}-${m}`;
}

export default function BillingReportsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [month, setMonth] = useState(thisMonth());
  const [scope, setScope] = useState<string>("practice"); // "practice" | providerId
  const [providers, setProviders] = useState<Provider[]>([]);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const missingOrgMessage = "Missing organizationId. Add ?organizationId=... or configure NEXT_PUBLIC_ORGANIZATION_ID.";

  // Providers for the scope dropdown.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/providers?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.success !== false) {
          const rows = Array.isArray(json?.providers) ? json.providers : Array.isArray(json) ? json : [];
          setProviders(
            rows.map((p: { id: string; provider_name?: string; name?: string }) => ({
              id: String(p.id),
              provider_name: String(p.provider_name ?? p.name ?? "Unnamed clinician"),
            })),
          );
        }
      } catch {
        /* providers list is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Report payload, refetches when month or scope changes.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ organizationId, month });
        if (scope !== "practice") params.set("providerId", scope);
        const response = await fetch(`/api/billing/reports?${params.toString()}`, { cache: "no-store" });
        const json = (await response.json()) as ReportPayload;
        if (cancelled) return;
        if (!response.ok || !json.success) throw new Error(json.error || "Failed to load billing report");
        setPayload(json);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load billing report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, month, scope]);

  const scopeLabel =
    scope === "practice"
      ? "Practice (all clinicians)"
      : providers.find((p) => p.id === scope)?.provider_name ?? "Clinician";

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Billing Reports</p>
          <h1>Revenue-Cycle KPIs</h1>
          <p className="hero-copy">
            Headline billing metrics for {formatMonth(payload?.month || month)} ·{" "}
            <strong>{scopeLabel}</strong>.
          </p>
        </div>
      </section>

      <section className="toolbar-panel">
        <label className="field-label compact-field">
          Reporting month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="field-label compact-field">
          View
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="practice">Practice (all clinicians)</option>
            {providers.length > 0 ? <optgroup label="Clinician" /> : null}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.provider_name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {!organizationId ? <div className="alert-panel">{missingOrgMessage}</div> : null}
      {error ? <div className="alert-panel">{error}</div> : null}
      {loading ? <div className="empty-state">Loading KPIs…</div> : null}

      {!loading && payload ? (
        <section className="metric-grid">
          <article className="metric-card">
            <span>Claims Submitted</span>
            <strong>{payload.claims?.submitted ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Claims Paid</span>
            <strong>{payload.claims?.paid ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Denials / Rejections</span>
            <strong>{payload.claims?.deniedOrRejected ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Total Charges Submitted</span>
            <strong>{money(payload.claims?.totalChargeSubmitted ?? 0)}</strong>
          </article>
          <article className="metric-card">
            <span>Patient Payments {scope !== "practice" ? "(practice-wide only)" : ""}</span>
            <strong>{payload.payments?.count ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Payments Posted {scope !== "practice" ? "(practice-wide only)" : ""}</span>
            <strong>{money(payload.payments?.totalAmount ?? 0)}</strong>
          </article>
        </section>
      ) : null}
    </main>
  );
}
