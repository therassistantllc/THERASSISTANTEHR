"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for organization settings. Replaces the placeholder
 * page with a real form that persists to the `organizations` table and
 * writes an audit event. This page reads the current organization row
 * using the configured ORGANIZATION_ID, allows basic profile fields to
 * be edited, validates required fields, and saves changes to the
 * database. On save, an entry is inserted into `audit_logs` so the
 * change history can be reviewed. The prior placeholder implementation
 * referenced a SettingsPlaceholderTable; this form is now live.
 */
export default function OrganizationsSettingsPage() {
  const [org, setOrg] = useState({
    name: "",
    legal_name: "",
    tax_id_last4: "",
    timezone: "",
    default_state: "",
    is_active: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Load organization profile once on mount
  useEffect(() => {
    async function fetchOrg() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("organizations")
        .select("name, legal_name, tax_id_last4, timezone, default_state, is_active")
        .eq("id", ORGANIZATION_ID)
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setOrg({
          name: data.name ?? "",
          legal_name: data.legal_name ?? "",
          tax_id_last4: data.tax_id_last4 ?? "",
          timezone: data.timezone ?? "",
          default_state: data.default_state ?? "",
          is_active: data.is_active ?? true,
        });
      }
      setLoading(false);
    }
    fetchOrg().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  // Handle simple input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setOrg((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setOrg((prev) => ({ ...prev, [name]: checked }));
  };

  // Save updated organization settings and write audit log
  const handleSave = async () => {
    // Require a non-empty name
    if (!org.name || !org.name.trim()) {
      setError("Organization name is required");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Capture the pre-update values for auditing
      const { data: beforeData } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", ORGANIZATION_ID)
        .maybeSingle();

      const updateData = {
        name: org.name,
        legal_name: org.legal_name || null,
        tax_id_last4: org.tax_id_last4 || null,
        timezone: org.timezone || null,
        default_state: org.default_state || null,
        is_active: org.is_active,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("organizations")
        .update(updateData)
        .eq("id", ORGANIZATION_ID);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      // Insert a minimal audit log entry. We intentionally
      // exclude patient/appointment identifiers here because this
      // action modifies only organization-level metadata.
      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated organization settings",
        event_metadata: { before: beforeData, after: updateData },
        object_type: "organization",
        object_id: ORGANIZATION_ID,
        action: "update",
      });

      setMessage("Settings saved successfully.");
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
      <h1 className="text-2xl font-semibold text-gray-900">Organization Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Update your organization profile and defaults. Values saved here feed into
        billing, clearinghouse envelopes and readiness checks but will not
        retroactively alter past claims or reports.
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
            Organization Name
          </label>
          <input
            type="text"
            name="name"
            value={org.name}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Legal Name</label>
          <input
            type="text"
            name="legal_name"
            value={org.legal_name}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Tax ID Last 4</label>
          <input
            type="text"
            name="tax_id_last4"
            value={org.tax_id_last4}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={4}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Timezone</label>
          <input
            type="text"
            name="timezone"
            value={org.timezone}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Default State</label>
          <input
            type="text"
            name="default_state"
            value={org.default_state}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={2}
          />
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            name="is_active"
            checked={org.is_active}
            onChange={handleCheckbox}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
          />
          <label className="ml-2 block text-sm text-gray-700">Active</label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
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
