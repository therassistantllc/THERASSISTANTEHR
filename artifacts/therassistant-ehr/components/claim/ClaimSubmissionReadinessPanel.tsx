"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Per-claim "Claim Readiness" panel.
 *
 * Renders two grouped sections — System Readiness and Claim Content — from
 * the combined report served by GET /api/claims/readiness-report. The same
 * combined report is enforced by the claim submission gate
 * (lib/validation/claimSubmissionGate.ts → assertClaimReadyForSubmission),
 * so panel verdict and gate verdict can never disagree.
 */

type Severity = "blocking" | "warning" | "info";

type Finding = {
  ruleId: string;
  category: string;
  severity: Severity;
  message: string;
  fixRoute: string;
  whyItMatters: string;
  resolution: string;
};

type Summary = {
  total: number;
  blocking: number;
  warning: number;
  info: number;
  ready: boolean;
};

type Report = {
  organizationId: string;
  generatedAt: string;
  summary: Summary;
  findings: Finding[];
};

type CombinedResponse = {
  organizationId: string;
  claimId: string | null;
  encounterId: string | null;
  generatedAt: string;
  systemReadiness: Report;
  claimContent: Report | null;
  combined: Summary;
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocking: "var(--text-danger, #c53030)",
  warning: "var(--text-warning, #b45309)",
  info: "var(--accent, #2563eb)",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  blocking: "Blocking",
  warning: "Warning",
  info: "Info",
};

const CATEGORY_LABEL: Record<string, string> = {
  organization: "Organization",
  providers: "Providers",
  locations: "Service Locations",
  payers: "Payers",
  clearinghouse: "Clearinghouse",
  feeSchedules: "Fee Schedules",
  billingDefaults: "Billing Defaults",
  claimDiagnoses: "Diagnoses",
  claimServiceLines: "Service Lines",
  claimParties: "Claim Parties",
  claimDates: "Service Dates",
  claimTelehealth: "Telehealth",
  claimAuthorization: "Authorization",
};

function fixHref(route: string, organizationId: string) {
  if (!organizationId) return route;
  return `${route}${route.includes("?") ? "&" : "?"}organizationId=${encodeURIComponent(organizationId)}`;
}

export interface ClaimSubmissionReadinessPanelProps {
  organizationId: string;
  /** Identify the claim by id, or by encounter id (the latest claim on that encounter will be resolved). */
  claimId?: string;
  encounterId?: string;
  /** Optional — for display only ("Claim #ABC123") */
  claimLabel?: string;
}

export default function ClaimSubmissionReadinessPanel({
  organizationId,
  claimId,
  encounterId,
  claimLabel,
}: ClaimSubmissionReadinessPanelProps) {
  const [data, setData] = useState<CombinedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      setError("Missing organizationId.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organizationId });
      if (claimId) params.set("claimId", claimId);
      else if (encounterId) params.set("encounterId", encounterId);
      const res = await fetch(`/api/claims/readiness-report?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load claim readiness");
      setData(json as CombinedResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claim readiness.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, claimId, encounterId]);

  useEffect(() => {
    load();
  }, [load]);

  const sysFindings = useMemo(() => data?.systemReadiness.findings ?? [], [data]);
  const claimFindings = useMemo(() => data?.claimContent?.findings ?? [], [data]);

  const sysBlocking = sysFindings.filter((f) => f.severity === "blocking");
  const sysWarnings = sysFindings.filter((f) => f.severity === "warning");
  const claimBlocking = claimFindings.filter((f) => f.severity === "blocking");
  const claimWarnings = claimFindings.filter((f) => f.severity === "warning");

  const ready = data?.combined.ready === true;
  const totalBlocking = data?.combined.blocking ?? 0;
  const statusColor = ready ? "var(--text-success, #15803d)" : "var(--text-danger, #c53030)";

  return (
    <section className="panel" style={{ borderLeft: `3px solid ${statusColor}` }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          marginBottom: "var(--space-2)",
        }}
      >
        <h2 style={{ margin: 0 }}>
          Claim Readiness{claimLabel ? ` — ${claimLabel}` : ""}{" "}
          {loading ? (
            <span style={{ color: "var(--text-secondary)", fontSize: "0.85em", fontWeight: 400 }}>checking…</span>
          ) : ready ? (
            <span style={{ color: statusColor }}>· ✓ Ready to Submit</span>
          ) : (
            <span style={{ color: statusColor }}>· ⚠ Blocked ({totalBlocking})</span>
          )}
        </h2>
        <button
          type="button"
          className="button button-secondary"
          onClick={load}
          disabled={loading}
          style={{ fontSize: "var(--text-sm)", padding: "4px 10px" }}
        >
          {loading ? "Validating…" : "Run Validation Again"}
        </button>
      </header>

      {error && <div className="alert-panel">{error}</div>}

      {!error && data && (
        <>
          {!ready && (
            <p style={{ fontSize: "var(--text-sm)", margin: "0 0 var(--space-3)" }}>
              <strong>This claim cannot be generated or transmitted</strong> while blocking findings exist in either
              section. The same rules are enforced by the submission gate.
            </p>
          )}

          <ReportSection
            title="Claim Content"
            subtitle={
              data.claimContent
                ? `${data.claimContent.summary.blocking} blocking · ${data.claimContent.summary.warning} warning`
                : "No claim linked to this encounter yet — content rules will run once a claim is created."
            }
            blocking={claimBlocking}
            warnings={claimWarnings}
            organizationId={organizationId}
            emptyOk={data.claimContent != null && claimBlocking.length === 0 && claimWarnings.length === 0}
          />

          <ReportSection
            title="System Readiness"
            subtitle={`${data.systemReadiness.summary.blocking} blocking · ${data.systemReadiness.summary.warning} warning`}
            blocking={sysBlocking}
            warnings={sysWarnings}
            organizationId={organizationId}
            emptyOk={sysBlocking.length === 0 && sysWarnings.length === 0}
          />

          <p
            style={{
              fontSize: "var(--text-xs, 0.7rem)",
              color: "var(--text-secondary)",
              textAlign: "right",
              marginTop: "var(--space-3)",
              marginBottom: 0,
            }}
          >
            Last validated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </section>
  );
}

function ReportSection({
  title,
  subtitle,
  blocking,
  warnings,
  organizationId,
  emptyOk,
}: {
  title: string;
  subtitle: string;
  blocking: Finding[];
  warnings: Finding[];
  organizationId: string;
  emptyOk: boolean;
}) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <h3 style={{ fontSize: "var(--text-sm)", margin: "0 0 4px" }}>{title}</h3>
      <p
        style={{
          fontSize: "var(--text-xs, 0.7rem)",
          color: "var(--text-secondary)",
          margin: "0 0 var(--space-2)",
        }}
      >
        {subtitle}
      </p>
      {blocking.length === 0 && warnings.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0 }}>
          {emptyOk ? "All checks passed." : "—"}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
          {[...blocking, ...warnings].map((f) => (
            <FindingRow key={f.ruleId} finding={f} organizationId={organizationId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ finding, organizationId }: { finding: Finding; organizationId: string }) {
  const categoryLabel = CATEGORY_LABEL[finding.category] ?? finding.category;
  return (
    <li
      style={{
        padding: "var(--space-2) var(--space-3)",
        background: "var(--surface-2, #f7f9fc)",
        borderLeft: `3px solid ${SEVERITY_COLOR[finding.severity]}`,
        borderRadius: "var(--radius, 6px)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "baseline",
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: "var(--text-xs, 0.7rem)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "2px 8px",
            borderRadius: 999,
            background: SEVERITY_COLOR[finding.severity],
            color: "white",
          }}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <strong style={{ fontSize: "var(--text-sm)" }}>{finding.message}</strong>
      </div>
      <p style={{ fontSize: "var(--text-xs, 0.75rem)", color: "var(--text-secondary)", margin: "2px 0" }}>
        <strong>Why: </strong>
        {finding.whyItMatters}
      </p>
      <p style={{ fontSize: "var(--text-xs, 0.75rem)", margin: "2px 0" }}>
        <strong>Resolve: </strong>
        {finding.resolution}
      </p>
      <Link
        href={fixHref(finding.fixRoute, organizationId)}
        style={{
          color: "var(--accent)",
          fontSize: "var(--text-xs, 0.75rem)",
          textDecoration: "underline",
        }}
      >
        Fix in {categoryLabel} →
      </Link>
    </li>
  );
}
