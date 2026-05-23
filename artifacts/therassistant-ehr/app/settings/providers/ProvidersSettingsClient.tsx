"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type TelehealthPlatform = "zoom" | "google_meet";

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
  default_telehealth_platform: TelehealthPlatform | null;
  is_active: boolean;
  updated_at: string;
};

type TelehealthConnection = {
  platform: TelehealthPlatform;
  connectionId: string;
  accountEmail: string | null;
  status: string;
  expiresAt: string | null;
  lastError: string | null;
};

type TelehealthConnectionsResponse = {
  success?: boolean;
  error?: string;
  platformStatus?: Record<TelehealthPlatform, { configured: boolean; missingEnv: string[] }>;
  connections?: TelehealthConnection[];
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

      <TelehealthConnectionsPanel />

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
  const [defaultPlatform, setDefaultPlatform] = useState<TelehealthPlatform | "">(
    provider.default_telehealth_platform ?? "",
  );
  const [savingDefault, setSavingDefault] = useState(false);

  const updateDefaultPlatform = async (next: TelehealthPlatform | "") => {
    setSavingDefault(true);
    try {
      const res = await fetch(`/api/settings/telehealth/default`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, platform: next === "" ? null : next }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to update default platform");
      setDefaultPlatform(next);
      onSaved({ id: provider.id, default_telehealth_platform: next === "" ? null : next });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to update default platform");
    } finally {
      setSavingDefault(false);
    }
  };

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

        <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px dashed var(--border-default, #e2e8f0)" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>Default Telehealth Platform</strong>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            Used when staff click Join Telehealth — a meeting is auto-created on the chosen platform if the clinician is connected. Falls back to the static URL above when no platform is set or no connection exists.
          </div>
          <select
            value={defaultPlatform}
            disabled={savingDefault}
            onChange={(e) => void updateDefaultPlatform(e.target.value as TelehealthPlatform | "")}
            style={{ marginTop: 6, padding: "6px 10px", border: "1px solid var(--border-default, #d8e1e9)", borderRadius: 4, fontSize: 13 }}
          >
            <option value="">— None (use static URL) —</option>
            <option value="zoom">Zoom</option>
            <option value="google_meet">Google Meet</option>
          </select>
        </div>
      </div>
    </article>
  );
}

function TelehealthConnectionsPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TelehealthConnectionsResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    fetch("/api/telehealth/connections")
      .then((r) => r.json())
      .then((json: TelehealthConnectionsResponse) => setData(json))
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to load connections"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("telehealth_error")) setActionError(`Connection failed: ${params.get("telehealth_error")}`);
    }
    refresh();
  }, []);

  const connectHref = (platform: TelehealthPlatform) => `/api/telehealth/oauth/${platform}/start`;
  const disconnect = async (platform: TelehealthPlatform) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/telehealth/oauth/${platform}/disconnect`, { method: "POST" });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? "Disconnect failed");
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const platforms: { key: TelehealthPlatform; label: string }[] = [
    { key: "zoom", label: "Zoom" },
    { key: "google_meet", label: "Google Meet" },
  ];

  const status = data?.platformStatus;
  const connections = data?.connections ?? [];

  return (
    <section className="panel" style={{ marginTop: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
        <h2 style={{ margin: 0 }}>My Telehealth Connections</h2>
        <button type="button" className="button button-secondary" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 0 }}>
        Connect your personal Zoom or Google account so Join Telehealth auto-creates a meeting on your account, with token refresh handled for you. Tokens are encrypted at rest.
      </p>
      {actionError ? <div className="alert-panel" style={{ marginBottom: 12 }}>{actionError}</div> : null}
      <div style={{ display: "grid", gap: 12 }}>
        {platforms.map(({ key, label }) => {
          const conn = connections.find((c) => c.platform === key);
          const platformStatus = status?.[key];
          const notConfigured = platformStatus && !platformStatus.configured;
          return (
            <article key={key} className="metric-card" style={{ padding: "var(--space-3)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <strong>{label}</strong>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  {notConfigured ? (
                    <span style={{ color: "var(--text-danger, #dc2626)" }}>
                      OAuth credentials not configured. Add {platformStatus!.missingEnv.join(", ")} to project secrets to enable.
                    </span>
                  ) : conn ? (
                    <>
                      Connected as <strong>{conn.accountEmail ?? "unknown account"}</strong>
                      {conn.lastError ? <span style={{ color: "var(--text-danger, #dc2626)", marginLeft: 8 }}>(last error: {conn.lastError})</span> : null}
                    </>
                  ) : (
                    <span>Not connected.</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {conn ? (
                  <button type="button" className="button button-secondary" onClick={() => void disconnect(key)}>
                    Disconnect
                  </button>
                ) : null}
                <a
                  className="button button-primary"
                  href={connectHref(key)}
                  aria-disabled={notConfigured ? "true" : undefined}
                  onClick={(e) => { if (notConfigured) e.preventDefault(); }}
                  style={notConfigured ? { opacity: 0.5, pointerEvents: "none" } : undefined}
                >
                  {conn ? "Reconnect" : "Connect"}
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
