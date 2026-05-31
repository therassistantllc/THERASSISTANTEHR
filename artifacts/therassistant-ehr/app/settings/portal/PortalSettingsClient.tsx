"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyPortalTemplate,
  DEFAULT_PORTAL_SETTINGS,
  type PortalSettings,
} from "@/lib/portal/portalSettings";
import { DEFAULT_ORG_ID } from "@/lib/config";

type ApiResponse = {
  success?: boolean;
  error?: string;
  fields?: Record<string, string>;
  organizationName?: string;
  settings?: PortalSettings;
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border-color, #CBD5E1)",
  fontSize: 14,
};

export default function PortalSettingsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [organizationName, setOrganizationName] = useState("Your care team");
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_PORTAL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingPortal, setTestingPortal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!organizationId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/settings/portal?organizationId=${encodeURIComponent(organizationId)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Failed to load portal settings");
        }
        if (json.organizationName?.trim()) setOrganizationName(json.organizationName.trim());
        if (json.settings) setSettings({ ...DEFAULT_PORTAL_SETTINGS, ...json.settings });
      } catch (err) {
        if (!cancelled) {
          setStatusError(err instanceof Error ? err.message : "Failed to load portal settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function saveSettings() {
    setSaving(true);
    setStatus(null);
    setStatusError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/settings/portal?organizationId=${encodeURIComponent(organizationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        if (json.fields) setFieldErrors(json.fields);
        throw new Error(json.error ?? "Failed to save portal settings");
      }
      setStatus("Portal settings saved.");
      if (json.settings) setSettings({ ...DEFAULT_PORTAL_SETTINGS, ...json.settings });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to save portal settings");
    } finally {
      setSaving(false);
    }
  }

  async function testPortal() {
    if (typeof window === "undefined") return;
    setTestingPortal(true);
    setStatus(null);
    setStatusError(null);
    try {
      const clientsRes = await fetch(
        `/api/clients?organizationId=${encodeURIComponent(organizationId)}&limit=1&offset=0`,
        { cache: "no-store" },
      );
      const clientsJson = (await clientsRes.json().catch(() => null)) as
        | { success?: boolean; error?: string; clients?: Array<{ id?: string; name?: string }> }
        | null;
      if (!clientsRes.ok || !clientsJson?.success) {
        throw new Error(clientsJson?.error ?? "Failed to load a test client for portal preview");
      }

      const testClient = clientsJson.clients?.[0];
      const testClientId = String(testClient?.id ?? "").trim();
      if (!testClientId) {
        throw new Error("No clients found. Add a client first, then run Test Portal.");
      }

      const inviteRes = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: testClientId, delivery: "clipboard" }),
      });
      const inviteJson = (await inviteRes.json().catch(() => null)) as
        | { success?: boolean; error?: string; invite?: { url?: string } }
        | null;
      if (!inviteRes.ok || !inviteJson?.success || !inviteJson.invite?.url) {
        throw new Error(inviteJson?.error ?? "Failed to create a portal invite for test mode");
      }

      const inviteUrl = String(inviteJson.invite.url).trim();
      const fullUrl = inviteUrl.startsWith("http") ? inviteUrl : `${window.location.origin}${inviteUrl}`;
      window.open(fullUrl, "_blank", "noopener,noreferrer");
      const testClientName = String(testClient?.name ?? "the selected client").trim() || "the selected client";
      setStatus(`Opened portal test invite for ${testClientName}. Click Continue to portal in the new tab.`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to open portal test session");
    } finally {
      setTestingPortal(false);
    }
  }

  const portalName = settings.portalDisplayName.trim() || organizationName;
  const previewPatient = "Jordan";
  const previewHeading =
    applyPortalTemplate(settings.welcomeHeadingTemplate, {
      patientName: previewPatient,
      practiceName: organizationName,
    }) || `Hi, ${previewPatient}`;
  const previewWelcome =
    applyPortalTemplate(settings.welcomeMessage, {
      patientName: previewPatient,
      practiceName: organizationName,
    }) || DEFAULT_PORTAL_SETTINGS.welcomeMessage;
  const previewSupport =
    applyPortalTemplate(settings.supportMessage, {
      patientName: previewPatient,
      practiceName: organizationName,
    }) || applyPortalTemplate(DEFAULT_PORTAL_SETTINGS.supportMessage, { practiceName: organizationName });

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Patient Portal</p>
          <h1>Portal Settings</h1>
          <p className="hero-copy">
            Edit the branding and copy patients see in the portal, then preview before saving.
          </p>
        </div>
      </section>

      {status ? <div className="empty-state success-panel">{status}</div> : null}
      {statusError ? <div className="alert-panel">{statusError}</div> : null}

      <section
        className="panel"
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="portalDisplayName"><strong>Portal display name</strong></label>
            <input
              id="portalDisplayName"
              style={FIELD_STYLE}
              placeholder="Defaults to organization name"
              value={settings.portalDisplayName}
              onChange={(e) => setSettings((prev) => ({ ...prev, portalDisplayName: e.target.value }))}
              disabled={loading}
            />
            {fieldErrors.portalDisplayName ? <p className="alert-text">{fieldErrors.portalDisplayName}</p> : null}
          </div>

          <div>
            <label htmlFor="welcomeHeadingTemplate"><strong>Welcome heading template</strong></label>
            <input
              id="welcomeHeadingTemplate"
              style={FIELD_STYLE}
              placeholder="Hi, {patientName}"
              value={settings.welcomeHeadingTemplate}
              onChange={(e) => setSettings((prev) => ({ ...prev, welcomeHeadingTemplate: e.target.value }))}
              disabled={loading}
            />
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              Tokens available: {"{patientName}"}, {"{practiceName}"}
            </p>
            {fieldErrors.welcomeHeadingTemplate ? <p className="alert-text">{fieldErrors.welcomeHeadingTemplate}</p> : null}
          </div>

          <div>
            <label htmlFor="welcomeMessage"><strong>Welcome message</strong></label>
            <textarea
              id="welcomeMessage"
              style={{ ...FIELD_STYLE, minHeight: 88, resize: "vertical" }}
              value={settings.welcomeMessage}
              onChange={(e) => setSettings((prev) => ({ ...prev, welcomeMessage: e.target.value }))}
              disabled={loading}
            />
            {fieldErrors.welcomeMessage ? <p className="alert-text">{fieldErrors.welcomeMessage}</p> : null}
          </div>

          <div>
            <label htmlFor="supportMessage"><strong>Support/footer message</strong></label>
            <textarea
              id="supportMessage"
              style={{ ...FIELD_STYLE, minHeight: 88, resize: "vertical" }}
              value={settings.supportMessage}
              onChange={(e) => setSettings((prev) => ({ ...prev, supportMessage: e.target.value }))}
              disabled={loading}
            />
            {fieldErrors.supportMessage ? <p className="alert-text">{fieldErrors.supportMessage}</p> : null}
          </div>

          <div>
            <label htmlFor="accentColor"><strong>Accent color</strong></label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                id="accentColor"
                style={{ ...FIELD_STYLE, maxWidth: 180 }}
                placeholder="#1D4ED8"
                value={settings.accentColor}
                onChange={(e) => setSettings((prev) => ({ ...prev, accentColor: e.target.value }))}
                disabled={loading}
              />
              <div
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid #CBD5E1",
                  background: /^#[0-9a-fA-F]{6}$/.test(settings.accentColor)
                    ? settings.accentColor
                    : DEFAULT_PORTAL_SETTINGS.accentColor,
                }}
              />
            </div>
            {fieldErrors.accentColor ? <p className="alert-text">{fieldErrors.accentColor}</p> : null}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" className="button" onClick={saveSettings} disabled={saving || loading}>
              {saving ? "Saving…" : "Save Portal Settings"}
            </button>
            <button type="button" className="button button-secondary" onClick={testPortal} disabled={loading || testingPortal}>
              {testingPortal ? "Opening test…" : "Test Portal"}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Test Portal now creates a temporary invite link and opens the real client portal in a new tab.
          </p>
        </div>

        <div>
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>Live Preview</h2>
          <div
            style={{
              border: "1px solid #DBE2EA",
              borderRadius: 14,
              overflow: "hidden",
              background: "#F8FAFC",
            }}
          >
            <div style={{ padding: 14, borderBottom: "1px solid #E2E8F0", background: "#fff" }}>
              <div className="eyebrow" style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>
                {portalName}
              </div>
              <h3 style={{ margin: "4px 0 0", color: "#0F172A" }}>{previewHeading}</h3>
              <p style={{ margin: "8px 0 0", color: "#334155", fontSize: 13 }}>{previewWelcome}</p>
            </div>
            <div style={{ padding: 14, display: "grid", gap: 10 }}>
              <div className="panel" style={{ margin: 0, background: "#fff" }}>
                <strong style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>Upcoming Appointments</strong>
                <p className="muted" style={{ marginBottom: 0 }}>Therapy follow-up · Tue 3:00 PM</p>
              </div>
              <div className="panel" style={{ margin: 0, background: "#fff" }}>
                <strong style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>Check-In Preview</strong>
                <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12 }}>
                  This is how the pre-session question flow appears to patients.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
                      What would you like to focus on today?
                    </p>
                    <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
                      Anxiety and stress management
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
                      Anything your provider should know before session?
                    </p>
                    <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
                      Sleep has been worse this week and I had two panic episodes.
                    </p>
                  </div>
                </div>
              </div>
              <div className="panel" style={{ margin: 0, background: "#fff" }}>
                <strong style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>Journal Preview</strong>
                <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12 }}>
                  Patients can add reflections, patterns, triggers, coping entries, and voice notes.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
                      Reflection entry
                    </p>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      I noticed my mood improved after taking a walk and using breathing exercises.
                    </p>
                  </div>
                  <div style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
                      Trigger entry
                    </p>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      Trigger: conflict at work · Intensity: 7/10
                    </p>
                  </div>
                </div>
              </div>
              <div className="panel" style={{ margin: 0, background: "#fff" }}>
                <strong style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>Balance</strong>
                <p className="muted" style={{ marginBottom: 0 }}>$85.00 due</p>
              </div>
              <div className="panel" style={{ margin: 0, background: "#fff" }}>
                <strong style={{ color: settings.accentColor || DEFAULT_PORTAL_SETTINGS.accentColor }}>Documents</strong>
                <p className="muted" style={{ marginBottom: 0 }}>Treatment Plan Update.pdf</p>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                {previewSupport}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
