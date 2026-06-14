"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for patient portal settings. This page reads and writes
 * portal branding and messaging stored under the `organization.portal_settings`
 * key in the `system_settings` table. Administrators can configure
 * display name, welcome/heading templates, support messaging and the
 * accent color used in the portal UI. Changes here apply prospectively
 * and do not affect past portal communications.
 */
interface PortalSettings {
  portalDisplayName: string;
  welcomeHeadingTemplate: string;
  welcomeMessage: string;
  supportMessage: string;
  accentColor: string;
}

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<PortalSettings>({
    portalDisplayName: "",
    welcomeHeadingTemplate: "",
    welcomeMessage: "",
    supportMessage: "",
    accentColor: "#3b82f6", // default blue
  });
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.portal_settings")
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setRecordId(data.id);
        try {
          const parsed = JSON.parse(data.value ?? '{}');
          setSettings({
            portalDisplayName: parsed.portalDisplayName ?? "",
            welcomeHeadingTemplate: parsed.welcomeHeadingTemplate ?? "",
            welcomeMessage: parsed.welcomeMessage ?? "",
            supportMessage: parsed.supportMessage ?? "",
            accentColor: parsed.accentColor ?? "#3b82f6",
          });
        } catch {
          // ignore JSON parse errors
        }
      }
      setLoading(false);
    }
    fetchSettings().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  const handleChange = (field: keyof PortalSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const validateColor = (color: string) => {
    return /^#([0-9a-fA-F]{6})$/.test(color);
  };

  const handleSave = async () => {
    // Validate accent color
    if (!validateColor(settings.accentColor)) {
      setError("Accent color must be a valid 6-digit hex code starting with #.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data: beforeData } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.portal_settings")
        .maybeSingle();

      const payload = {
        id: recordId || undefined,
        organization_id: ORGANIZATION_ID,
        key: "organization.portal_settings",
        value: JSON.stringify(settings),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("system_settings")
        .upsert([payload], { onConflict: "id" });
      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
        return;
      }
      setRecordId(payload.id || recordId);

      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated portal settings",
        event_metadata: { before: beforeData, after: payload },
        object_type: "portal_settings",
        object_id: payload.id || null,
        action: "update",
      });

      setMessage("Portal settings saved successfully.");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="p-6">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Patient Portal Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Customize the patient portal experience, including branding and
        messaging. These settings apply to future portal sessions and do
        not retroactively change previous communications.
      </p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-4 text-sm text-green-600">{message}</p>}
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Portal Display Name
          </label>
          <input
            type="text"
            value={settings.portalDisplayName}
            onChange={(e) => handleChange("portalDisplayName", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Welcome Heading Template
          </label>
          <input
            type="text"
            value={settings.welcomeHeadingTemplate}
            onChange={(e) => handleChange("welcomeHeadingTemplate", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Welcome Message
          </label>
          <textarea
            value={settings.welcomeMessage}
            onChange={(e) => handleChange("welcomeMessage", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Support Message
          </label>
          <textarea
            value={settings.supportMessage}
            onChange={(e) => handleChange("supportMessage", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Accent Color (Hex)
          </label>
          <input
            type="text"
            value={settings.accentColor}
            onChange={(e) => handleChange("accentColor", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={7}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </form>
      <div className="mt-4 text-sm">
        <a href="/settings" className="font-medium text-blue-700 hover:text-blue-800">
          Back to Settings index
        </a>
      </div>
    </main>
  );
}
