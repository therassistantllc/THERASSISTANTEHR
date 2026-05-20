"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import { useUserRole } from "@/lib/store/userRole";

type Severity = "blocking" | "warning" | "info";

type Category =
  | "organization"
  | "providers"
  | "locations"
  | "payers"
  | "clearinghouse"
  | "feeSchedules"
  | "billingDefaults";

type Finding = {
  ruleId: string;
  category: Category;
  severity: Severity;
  message: string;
  fixRoute: string;
  whyItMatters: string;
  resolution: string;
  evidence?: Record<string, unknown>;
};

type ReadinessReport = {
  organizationId: string;
  organizationName: string | null;
  generatedAt: string;
  summary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
    ready: boolean;
  };
  findings: Finding[];
  findingsByCategory: Record<Category, Finding[]>;
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

const CATEGORY_LABELS: Record<Category, string> = {
  organization: "Organization",
  providers: "Providers",
  locations: "Service Locations",
  payers: "Payers",
  clearinghouse: "Clearinghouse",
  feeSchedules: "Fee Schedules",
  billingDefaults: "Billing Defaults",
};

const CATEGORY_ORDER: Category[] = [
  "organization",
  "billingDefaults",
  "providers",
  "locations",
  "payers",
  "clearinghouse",
  "feeSchedules",
];

const SEVERITY_LABEL: Record<Severity, string> = {
  blocking: "Blocking",
  warning: "Warning",
  info: "Info",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocking: "var(--text-danger, #c53030)",
  warning: "var(--text-warning, #b45309)",
  info: "var(--accent, #2563eb)",
};

type SeedResult = {
  success: boolean;
  reset?: boolean;
  seeded_at?: string;
  results?: Record<string, string>;
  errors?: Record<string, string>;
  error?: string;
};

export default function SystemReadinessClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const { role } = useUserRole();
  const isAdmin = role === "admin_biller";
  const [data, setData] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const load = useCallback(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/settings/system-readiness?organizationId=${encodeURIComponent(organizationId)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error ?? "Failed to load");
        return json as ReadinessReport;
      })
      .then((json) => setData(json))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load system readiness."))
      .finally(() => setLoading(false));
  }, [organizationId]);

  const runSeed = useCallback(
    async (force = false) => {
      setSeeding(true);
      setSeedResult(null);
      setShowResetConfirm(false);
      try {
        const res = await fetch("/api/admin/seed-settings", {
          method: "POST",
          headers: force ? { "Content-Type": "application/json" } : undefined,
          body: force ? JSON.stringify({ force: true }) : undefined,
        });
        const json: SeedResult = await res.json();
        setSeedResult(json);
        if (json.success) load();
      } catch {
        setSeedResult({ success: false, error: "Network error — could not reach seed endpoint." });
      } finally {
        setSeeding(false);
      }
    },
    [load],
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    load();
  }, [load]);

  const fixHref = (route: string) =>
    `${route}${organizationId ? `${route.includes("?") ? "&" : "?"}organizationId=${organizationId}` : ""}`;

  const orderedCategories = useMemo(() => {
    if (!data) return [] as Category[];
    return CATEGORY_ORDER.filter((c) => (data.findingsByCategory[c]?.length ?? 0) > 0);
  }, [data]);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>System Readiness</h1>
          <p className="hero-copy">
            Configuration validation — blocking items must be resolved before claims can be transmitted; warnings and
            info items improve reliability and downstream automation.
          </p>
        </div>
        <div className="hero-actions">
          {isAdmin && (
            <>
              <button
                className="button button-primary"
                onClick={() => runSeed(false)}
                disabled={seeding || loading || showResetConfirm}
              >
                {seeding ? "Seeding…" : "Seed Demo Data"}
              </button>
              {showResetConfirm ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "var(--surface-2, #f4f6f9)",
                    border: "1px solid var(--text-danger, #c53030)",
                    borderRadius: "var(--radius, 6px)",
                    padding: "6px 12px",
                  }}
                >
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-danger, #c53030)", fontWeight: 600 }}>
                    Deletes &amp; re-inserts all demo records — continue?
                  </span>
                  <button
                    className="button button-danger"
                    style={{ padding: "4px 10px", fontSize: "var(--text-sm)" }}
                    onClick={() => runSeed(true)}
                    disabled={seeding}
                  >
                    Yes, reset
                  </button>
                  <button
                    className="button button-secondary"
                    style={{ padding: "4px 10px", fontSize: "var(--text-sm)" }}
                    onClick={() => setShowResetConfirm(false)}
                    disabled={seeding}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="button button-secondary"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={seeding || loading}
                >
                  Reset Demo Data
                </button>
              )}
            </>
          )}
          <button className="button button-secondary" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
          <Link className="button button-secondary" href="/settings">
            ← Settings
          </Link>
        </div>
      </section>

      {!organizationId && <div className="alert-panel">No organization context.</div>}
      {error && <div className="alert-panel">{error}</div>}

      {seedResult && (
        <section
          className="panel"
          style={{
            borderLeft: `3px solid ${seedResult.success ? "var(--text-success)" : "var(--text-danger)"}`,
          }}
        >
          <h2 style={{ marginBottom: "var(--space-3)" }}>
            {seedResult.success
              ? seedResult.reset
                ? "⚡ Demo Data Reset & Re-seeded"
                : "✓ Demo Data Seeded"
              : "⚠ Seed Encountered Issues"}
          </h2>
          {seedResult.error && (
            <p style={{ color: "var(--text-danger)", fontSize: "var(--text-sm)" }}>{seedResult.error}</p>
          )}
          {seedResult.seeded_at && (
            <p style={{ fontSize: "var(--text-xs, 0.75rem)", color: "var(--text-secondary)", marginTop: 8 }}>
              {seedResult.reset ? "Reset" : "Seeded"} at {new Date(seedResult.seeded_at).toLocaleString()}
            </p>
          )}
        </section>
      )}

      {loading && (
        <div className="panel">
          <div className="empty-state">Running configuration validation…</div>
        </div>
      )}

      {!loading && data && (
        <>
          <section className="metric-grid">
            <article className="metric-card">
              <span>Overall</span>
              <strong>
                {data.summary.ready ? (
                  <span style={{ color: "var(--text-success)" }}>✓ Ready to bill</span>
                ) : (
                  <span style={{ color: "var(--text-danger)" }}>⚠ Not ready</span>
                )}
              </strong>
            </article>
            <article className="metric-card">
              <span>Blocking</span>
              <strong style={{ color: data.summary.blocking > 0 ? SEVERITY_COLOR.blocking : undefined }}>
                {data.summary.blocking}
              </strong>
            </article>
            <article className="metric-card">
              <span>Warning</span>
              <strong style={{ color: data.summary.warning > 0 ? SEVERITY_COLOR.warning : undefined }}>
                {data.summary.warning}
              </strong>
            </article>
            <article className="metric-card">
              <span>Info</span>
              <strong style={{ color: data.summary.info > 0 ? SEVERITY_COLOR.info : undefined }}>
                {data.summary.info}
              </strong>
            </article>
          </section>

          {data.summary.blocking > 0 && (
            <div className="alert-panel">
              <strong>
                {data.summary.blocking} blocking item{data.summary.blocking !== 1 ? "s" : ""} must be resolved before
                claim submission.
              </strong>{" "}
              Use the &quot;Fix&quot; links below to address each finding.
            </div>
          )}

          {data.summary.total === 0 && (
            <section className="panel">
              <div className="empty-state">
                <strong style={{ color: "var(--text-success)" }}>All configuration checks passed.</strong>
                <p style={{ marginTop: 8, color: "var(--text-secondary)" }}>
                  No blocking, warning, or informational findings for this organization.
                </p>
              </div>
            </section>
          )}

          {orderedCategories.map((cat) => {
            const findings = data.findingsByCategory[cat];
            return (
              <section key={cat} className="panel">
                <h2 style={{ marginBottom: "var(--space-3)" }}>
                  {CATEGORY_LABELS[cat]}{" "}
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.85em", fontWeight: 400 }}>
                    ({findings.length} finding{findings.length !== 1 ? "s" : ""})
                  </span>
                </h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-3)" }}>
                  {findings.map((f) => (
                    <li
                      key={f.ruleId}
                      style={{
                        padding: "var(--space-4)",
                        background: "var(--surface-2, #f7f9fc)",
                        borderLeft: `3px solid ${SEVERITY_COLOR[f.severity]}`,
                        borderRadius: "var(--radius, 6px)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--space-3)",
                          alignItems: "baseline",
                          flexWrap: "wrap",
                          marginBottom: 6,
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
                            background: SEVERITY_COLOR[f.severity],
                            color: "white",
                          }}
                        >
                          {SEVERITY_LABEL[f.severity]}
                        </span>
                        <strong style={{ fontSize: "var(--text-md, 0.95rem)" }}>{f.message}</strong>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                          {f.ruleId}
                        </span>
                      </div>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "4px 0" }}>
                        <strong>Why it matters: </strong>
                        {f.whyItMatters}
                      </p>
                      <p style={{ fontSize: "var(--text-sm)", margin: "4px 0" }}>
                        <strong>How to resolve: </strong>
                        {f.resolution}
                      </p>
                      <div style={{ marginTop: 8 }}>
                        <Link
                          href={fixHref(f.fixRoute)}
                          style={{
                            color: "var(--accent)",
                            fontSize: "var(--text-sm)",
                            textDecoration: "underline",
                          }}
                        >
                          Fix in {CATEGORY_LABELS[f.category]} →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <p style={{ fontSize: "var(--text-xs, 0.7rem)", color: "var(--text-secondary)", textAlign: "right" }}>
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </main>
  );
}
