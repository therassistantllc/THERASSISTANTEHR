/**
 * Code Sets freshness panel (Task #197).
 *
 * Read-only admin/billing-settings page that shows when each reference
 * code system (ICD-10-CM, HCPCS Level II, CPT) was last loaded by the
 * scheduled refresh, plus a "Stale" badge if the newest CMS release is
 * more than 30 days older than the last load.
 *
 * Server-rendered so the data is fresh on every navigation.
 */
import Link from "next/link";
import { fetchCodeSetFreshness, type CodeSetStatus } from "@/lib/billing/codeSetFreshness";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function StatusRow({ status }: { status: CodeSetStatus }) {
  const badgeStyle: React.CSSProperties = status.isStale
    ? {
        background: "rgba(220, 38, 38, 0.12)",
        color: "rgb(185, 28, 28)",
        border: "1px solid rgba(220, 38, 38, 0.35)",
      }
    : {
        background: "rgba(34, 197, 94, 0.12)",
        color: "rgb(21, 128, 61)",
        border: "1px solid rgba(34, 197, 94, 0.35)",
      };

  return (
    <article
      className="metric-card"
      style={{ minHeight: "112px", display: "flex", flexDirection: "column", gap: "8px" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{status.label}</strong>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: "999px",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            ...badgeStyle,
          }}
        >
          {status.isStale ? "Stale" : "Current"}
        </span>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
        <dt style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Last loaded</dt>
        <dd style={{ margin: 0, fontSize: "var(--text-sm)" }}>{formatDate(status.lastLoadedAt)}</dd>

        <dt style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Active codes</dt>
        <dd style={{ margin: 0, fontSize: "var(--text-sm)" }}>{status.activeCount.toLocaleString()}</dd>

        <dt style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Latest CMS release</dt>
        <dd style={{ margin: 0, fontSize: "var(--text-sm)" }}>{status.expectedReleaseDate}</dd>
      </dl>

      {status.isStale ? (
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "rgb(185, 28, 28)" }}>
          {status.staleReason}. Re-run <code>pnpm --filter @workspace/therassistant-ehr import:billing-codes</code> with the latest CMS release files.
        </p>
      ) : null}
    </article>
  );
}

export default async function CodeSetsPage() {
  const result = await fetchCodeSetFreshness();

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">
            <Link href="/settings" style={{ color: "inherit" }}>Settings</Link> · Billing
          </p>
          <h1>Reference Code Sets</h1>
          <p className="hero-copy">
            When ICD-10-CM, HCPCS, and CPT reference data were last loaded. Flagged as
            stale if the latest CMS release is more than 30 days newer than the load —
            a signal the scheduled refresh may have stopped running.
          </p>
        </div>
      </section>

      {!result.ok ? (
        <section className="metric-grid" style={{ gridTemplateColumns: "1fr" }}>
          <article className="metric-card" style={{ borderColor: "rgba(220, 38, 38, 0.35)" }}>
            <strong>Could not load code set freshness</strong>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{result.error}</span>
          </article>
        </section>
      ) : (
        <>
          <section
            className="metric-grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
          >
            {result.statuses.map((s) => (
              <StatusRow key={`${s.table}-${s.codeSystem}`} status={s} />
            ))}
          </section>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Checked {new Date(result.fetchedAt).toUTCString()}.
          </p>
        </>
      )}
    </main>
  );
}
