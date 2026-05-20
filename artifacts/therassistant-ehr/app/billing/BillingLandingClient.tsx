"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type WidgetStat = { label: string; value: number };

type WidgetData = {
  chargeCapture?: { error: string | null; total: number; blocked: number; readyForClaim: number; claimCreated: number };
  claimReadiness?: { error: string | null; validationFailed: number; readyForBatch: number; batched: number };
  denials?: { error: string | null; denied: number; rejectedPayer: number; rejectedOa: number; total: number };
  eraPayments?: { error: string | null; imports: number; unmatched: number; readyToPost: number; blocked: number };
  workqueue?: {
    error: string | null;
    total: number;
    no_response: number;
    clearinghouse_rejection: number;
    payer_rejection: number;
    eligibility_needed: number;
    payment_posting_needed: number;
  };
  patientInvoices?: { error: string | null; open: number; draft: number; paid: number };
};

type DashboardPayload = {
  success?: boolean;
  error?: string;
  totals?: {
    needsBillingAction: number;
    readyToSend: number;
    waitingForResponse: number;
    payerAccepted: number;
    eraNeedsPosting: number;
    openPatientInvoices: number;
  };
  widgets?: WidgetData;
};

function getOrganizationId() {
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
  return (
    new URLSearchParams(window.location.search).get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number | null; loading: boolean }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{loading ? "…" : value ?? 0}</strong>
    </article>
  );
}

function WidgetTile({
  title,
  description,
  href,
  primaryLabel,
  loading,
  error,
  stats,
}: {
  title: string;
  description: string;
  href: string;
  primaryLabel: string;
  loading: boolean;
  error: string | null;
  stats: WidgetStat[];
}) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      <p className="muted">{description}</p>

      {error ? (
        <p className="muted" style={{ color: "var(--danger, #b00020)" }}>
          Couldn&apos;t load these counts. {error}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, minmax(0, 1fr))`,
            gap: "0.75rem",
            margin: "0.75rem 0",
          }}
        >
          {stats.map((stat) => (
            <div key={stat.label} style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
              <span className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {stat.label}
              </span>
              <strong style={{ fontSize: "1.25rem" }}>{loading ? "…" : stat.value}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="section-actions">
        <Link className="button button-secondary" href={href}>
          {primaryLabel}
        </Link>
      </div>
    </article>
  );
}

export default function BillingLandingClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<DashboardPayload["totals"] | null>(null);
  const [widgets, setWidgets] = useState<WidgetData>({});
  const missingOrgMessage = "Missing organizationId. Add ?organizationId=... or configure NEXT_PUBLIC_ORGANIZATION_ID.";

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          `/api/billing/workflow-dashboard?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as DashboardPayload;
        if (cancelled) return;
        if (!response.ok || !json.success) throw new Error(json.error || "Failed to load billing dashboard");
        setTotals(json.totals || null);
        setWidgets(json.widgets || {});
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load billing dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const orgQuery = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Revenue Cycle</p>
          <h1>Billing Workspace</h1>
          <p className="hero-copy">
            OpenMRS-style billing hub for claim readiness, batching, AR follow-up, payment operations, and reporting.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" href={`/billing/workqueue${orgQuery}`}>Open Workqueue</Link>
          <Link className="button" href={`/billing/reports${orgQuery}`}>Open Reports</Link>
        </div>
      </section>

      {!organizationId ? <div className="alert-panel">{missingOrgMessage}</div> : null}
      {error ? <div className="alert-panel">{error}</div> : null}

      <section className="metric-grid">
        <MetricCard label="Needs Action" value={totals?.needsBillingAction ?? null} loading={loading && !totals} />
        <MetricCard label="Ready To Send" value={totals?.readyToSend ?? null} loading={loading && !totals} />
        <MetricCard label="Waiting Response" value={totals?.waitingForResponse ?? null} loading={loading && !totals} />
        <MetricCard label="Open Patient Invoices" value={totals?.openPatientInvoices ?? null} loading={loading && !totals} />
      </section>

      <section className="chart-grid">
        <WidgetTile
          title="Charge Capture"
          description="Validate encounters, diagnoses, and coding before batching to claims."
          href={`/billing/charge-capture${orgQuery}`}
          primaryLabel="Open Charge Capture"
          loading={loading && !widgets.chargeCapture}
          error={widgets.chargeCapture?.error ?? null}
          stats={[
            { label: "Open", value: widgets.chargeCapture?.total ?? 0 },
            { label: "Blocked", value: widgets.chargeCapture?.blocked ?? 0 },
            { label: "Ready", value: widgets.chargeCapture?.readyForClaim ?? 0 },
          ]}
        />

        <WidgetTile
          title="Claim Readiness"
          description="Claims awaiting validation, batching, and 837P submission."
          href={`/billing/claim-readiness${orgQuery}`}
          primaryLabel="Open Claim Readiness"
          loading={loading && !widgets.claimReadiness}
          error={widgets.claimReadiness?.error ?? null}
          stats={[
            { label: "Validation Failed", value: widgets.claimReadiness?.validationFailed ?? 0 },
            { label: "Ready For Batch", value: widgets.claimReadiness?.readyForBatch ?? 0 },
            { label: "Batched", value: widgets.claimReadiness?.batched ?? 0 },
          ]}
        />

        <WidgetTile
          title="Denials & Rejections"
          description="Payer denials and clearinghouse rejections that need follow-up."
          href={`/billing/workqueue${orgQuery}`}
          primaryLabel="Open Workqueue"
          loading={loading && !widgets.denials}
          error={widgets.denials?.error ?? null}
          stats={[
            { label: "Denied", value: widgets.denials?.denied ?? 0 },
            { label: "Payer Rejected", value: widgets.denials?.rejectedPayer ?? 0 },
            { label: "CH Rejected", value: widgets.denials?.rejectedOa ?? 0 },
          ]}
        />

        <WidgetTile
          title="ERA / Payments"
          description="Electronic remittance, payment matching, and posting status."
          href={`/billing/payments${orgQuery}`}
          primaryLabel="Open Payments"
          loading={loading && !widgets.eraPayments}
          error={widgets.eraPayments?.error ?? null}
          stats={[
            { label: "Incoming", value: widgets.eraPayments?.imports ?? 0 },
            { label: "Unmatched", value: widgets.eraPayments?.unmatched ?? 0 },
            { label: "Ready To Post", value: widgets.eraPayments?.readyToPost ?? 0 },
          ]}
        />

        <WidgetTile
          title="Claim Submission"
          description="Generate and track 837P submission lifecycle through clearinghouse responses."
          href={`/billing/claim-submission${orgQuery}`}
          primaryLabel="Open Claim Submission"
          loading={loading && !totals}
          error={null}
          stats={[
            { label: "Ready To Send", value: totals?.readyToSend ?? 0 },
            { label: "Waiting", value: totals?.waitingForResponse ?? 0 },
            { label: "Accepted", value: totals?.payerAccepted ?? 0 },
          ]}
        />

        <WidgetTile
          title="Reports"
          description="Claim status, payment activity, and monthly revenue-cycle performance."
          href={`/billing/reports${orgQuery}`}
          primaryLabel="Open Reports"
          loading={false}
          error={null}
          stats={[]}
        />
      </section>
    </main>
  );
}
