"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type CredentialingRecord = {
  id: string;
  provider_name: string;
  credential_display: string | null;
  individual_npi: string | null;
  taxonomy_code: string | null;
  individual_medicaid_id: string | null;
  group_npi: string | null;
  practice_tax_id: string | null;
  primary_license_number: string | null;
  payer_revalidation_date: string | null;
  telehealth_url: string | null;
  stripe_payment_link_url: string | null;
  is_active: boolean;
  updated_at: string;
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

function missing(value: string | null | undefined) {
  return !value ? (
    <span style={{ color: "var(--text-danger)", fontWeight: 600 }}>⚠ Missing</span>
  ) : (
    <span style={{ color: "var(--text-success)" }}>{value}</span>
  );
}

export default function ProvidersSettingsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [providers, setProviders] = useState<CredentialingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!organizationId) { setLoading(false); return; }
    fetch(`/api/providers/credentialing?organizationId=${encodeURIComponent(organizationId)}`)
      .then((r) => r.json())
      .then((json: { success?: boolean; providers?: CredentialingRecord[]; error?: string }) => {
        if (!json.success) throw new Error(json.error ?? "Failed to load providers");
        setProviders(json.providers ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [organizationId]);

  const warnings = useMemo(() => {
    const issues: string[] = [];
    providers.forEach((p) => {
      if (!p.individual_npi) issues.push(`${p.provider_name}: missing individual NPI`);
      if (!p.taxonomy_code) issues.push(`${p.provider_name}: missing taxonomy code`);
      if (!p.practice_tax_id) issues.push(`${p.provider_name}: missing practice Tax ID`);
    });
    return issues;
  }, [providers]);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Provider Settings</h1>
          <p className="hero-copy">Credentialing profiles, NPI, taxonomy, payer enrollment status, and claim readiness.</p>
        </div>
        <div className="hero-actions">
          <Link className="button button-primary" href={`/admin/provider-credentialing${organizationId ? `?organizationId=${organizationId}` : ""}`}>
            Manage Credentialing
          </Link>
          <Link className="button button-secondary" href="/settings">← Settings</Link>
        </div>
      </section>

      {!organizationId && <div className="alert-panel">No organization context.</div>}
      {error && <div className="alert-panel">{error}</div>}

      {warnings.length > 0 && (
        <div className="alert-panel">
          <strong>Claim readiness warnings:</strong>
          <ul style={{ margin: "8px 0 0 16px", fontSize: "var(--text-sm)" }}>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <section className="metric-grid">
        <article className="metric-card">
          <span>Total Credentialing Profiles</span>
          <strong>{loading ? "—" : providers.length}</strong>
        </article>
        <article className="metric-card">
          <span>Active</span>
          <strong>{loading ? "—" : providers.filter((p) => p.is_active !== false).length}</strong>
        </article>
        <article className="metric-card">
          <span>Missing NPI</span>
          <strong style={{ color: providers.filter((p) => !p.individual_npi).length > 0 ? "var(--text-danger)" : undefined }}>
            {loading ? "—" : providers.filter((p) => !p.individual_npi).length}
          </strong>
        </article>
        <article className="metric-card">
          <span>Missing Taxonomy</span>
          <strong style={{ color: providers.filter((p) => !p.taxonomy_code).length > 0 ? "var(--text-danger)" : undefined }}>
            {loading ? "—" : providers.filter((p) => !p.taxonomy_code).length}
          </strong>
        </article>
      </section>

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2>Credentialing Profiles</h2>
          <Link
            className="button button-primary"
            href={`/admin/provider-credentialing${organizationId ? `?organizationId=${organizationId}` : ""}`}
          >
            Add / Edit Profiles
          </Link>
        </div>

        {loading && <div className="empty-state">Loading…</div>}
        {!loading && providers.length === 0 && (
          <div className="alert-panel">
            No credentialing profiles found. Claims cannot be generated without provider NPI and taxonomy.
          </div>
        )}

        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            organizationId={organizationId}
            onSaved={(updated) =>
              setProviders((prev) => prev.map((existing) => (existing.id === updated.id ? { ...existing, ...updated } : existing)))
            }
          />
        ))}
      </section>
    </main>
  );
}

function ProviderCard({
  provider,
  organizationId,
  onSaved,
}: {
  provider: CredentialingRecord;
  organizationId: string;
  onSaved: (updated: Partial<CredentialingRecord> & { id: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [telehealthUrl, setTelehealthUrl] = useState(provider.telehealth_url ?? "");
  const [stripeUrl, setStripeUrl] = useState(provider.stripe_payment_link_url ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/providers/credentialing?organizationId=${encodeURIComponent(organizationId)}&id=${encodeURIComponent(provider.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telehealth_url: telehealthUrl.trim() || null,
            stripe_payment_link_url: stripeUrl.trim() || null,
          }),
        },
      );
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? "Save failed");
      onSaved({
        id: provider.id,
        telehealth_url: telehealthUrl.trim() || null,
        stripe_payment_link_url: stripeUrl.trim() || null,
      });
      setEditing(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="metric-card" style={{ marginBottom: "var(--space-3)", padding: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{provider.provider_name}</strong>
          {provider.credential_display && (
            <span style={{ color: "var(--text-secondary)", marginLeft: "8px", fontSize: "var(--text-sm)" }}>
              {provider.credential_display}
            </span>
          )}
        </div>
        <span className={provider.is_active !== false ? "status status-green" : "status status-red"}>
          {provider.is_active !== false ? "Active" : "Inactive"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-2)", marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
        <div><strong>Individual NPI:</strong> {missing(provider.individual_npi)}</div>
        <div><strong>Taxonomy:</strong> {missing(provider.taxonomy_code)}</div>
        <div><strong>Group NPI:</strong> {missing(provider.group_npi)}</div>
        <div><strong>Medicaid ID:</strong> {missing(provider.individual_medicaid_id)}</div>
        <div><strong>Practice Tax ID:</strong> {missing(provider.practice_tax_id)}</div>
        <div><strong>License:</strong> {missing(provider.primary_license_number)}</div>
        {provider.payer_revalidation_date && (
          <div><strong>Revalidation:</strong> {new Date(provider.payer_revalidation_date).toLocaleDateString()}</div>
        )}
      </div>

      <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3)", background: "var(--surface-muted, #f8fafc)", border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>Telehealth &amp; Copay Collection</strong>
          {!editing ? (
            <button type="button" className="button button-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
        </div>

        {!editing ? (
          <div style={{ display: "grid", gap: 6, fontSize: "var(--text-sm)" }}>
            <div>
              <strong>Telehealth URL:</strong>{" "}
              {provider.telehealth_url ? (
                <a href={provider.telehealth_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary, #6366f1)" }}>
                  {provider.telehealth_url}
                </a>
              ) : (
                <span style={{ color: "var(--text-secondary)" }}>Not configured — Join Telehealth button will be disabled.</span>
              )}
            </div>
            <div>
              <strong>Stripe Payment Link:</strong>{" "}
              {provider.stripe_payment_link_url ? (
                <a href={provider.stripe_payment_link_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary, #6366f1)" }}>
                  {provider.stripe_payment_link_url}
                </a>
              ) : (
                <span style={{ color: "var(--text-secondary)" }}>Not configured — Collect Copay will only log manually.</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "block", fontSize: 12 }}>
              <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Telehealth URL</span>
              <input
                type="url"
                value={telehealthUrl}
                onChange={(e) => setTelehealthUrl(e.target.value)}
                placeholder="https://us02web.zoom.us/j/1234567890 or https://doxy.me/yourname"
                style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border-default, #d8e1e9)", borderRadius: 4, fontSize: 13 }}
              />
              <small style={{ color: "var(--text-secondary)" }}>
                Your personal room URL — Zoom, Google Meet, Doxy.me, etc. Opens in a new tab when staff or clients click Join Telehealth.
              </small>
            </label>
            <label style={{ display: "block", fontSize: 12 }}>
              <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Stripe Payment Link</span>
              <input
                type="url"
                value={stripeUrl}
                onChange={(e) => setStripeUrl(e.target.value)}
                placeholder="https://buy.stripe.com/abc123"
                style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border-default, #d8e1e9)", borderRadius: 4, fontSize: 13 }}
              />
              <small style={{ color: "var(--text-secondary)" }}>
                Create a Payment Link in your own Stripe dashboard. Funds settle to your Stripe account; we only log the transaction here.
              </small>
            </label>
            {saveError ? <div style={{ color: "var(--text-danger, #dc2626)", fontSize: 12 }}>{saveError}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="button button-primary" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => {
                  setTelehealthUrl(provider.telehealth_url ?? "");
                  setStripeUrl(provider.stripe_payment_link_url ?? "");
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
