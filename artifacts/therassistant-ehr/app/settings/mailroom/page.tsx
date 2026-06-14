"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for mailroom defaults. Administrators can set
 * organization-wide defaults for document delivery priority and type.
 * These values are stored in the `system_settings` table under the
 * key `organization.mailroom_defaults` and influence new mailroom
 * items only; they do not retroactively alter existing items.
 */
interface MailroomDefaults {
  deliveryPriority: string;
  documentType: string;
}

export default function MailroomSettingsPage() {
  const [defaults, setDefaults] = useState<MailroomDefaults>({
    deliveryPriority: "standard",
    documentType: "correspondence",
  });
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDefaults() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.mailroom_defaults")
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setRecordId(data.id);
        try {
          const parsed = JSON.parse(data.value ?? '{}');
          setDefaults({
            deliveryPriority: parsed.deliveryPriority ?? "standard",
            documentType: parsed.documentType ?? "correspondence",
          });
        } catch {
          // ignore parse errors
        }
      }
      setLoading(false);
    }
    fetchDefaults().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  const handleChange = (field: keyof MailroomDefaults, value: string) => {
    setDefaults((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data: beforeData } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.mailroom_defaults")
        .maybeSingle();

      const payload = {
        id: recordId || undefined,
        organization_id: ORGANIZATION_ID,
        key: "organization.mailroom_defaults",
        value: JSON.stringify(defaults),
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
        event_summary: "Updated mailroom defaults",
        event_metadata: { before: beforeData, after: payload },
        object_type: "mailroom_defaults",
        object_id: payload.id || null,
        action: "update",
      });

      setMessage("Mailroom defaults saved successfully.");
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
      <h1 className="text-2xl font-semibold text-gray-900">Mailroom Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Set default options for mailroom processing. These defaults apply
        to new mailroom tasks but do not change existing items.
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
            Delivery Priority
          </label>
          <input
            type="text"
            value={defaults.deliveryPriority}
            onChange={(e) => handleChange("deliveryPriority", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Document Type
          </label>
          <input
            type="text"
            value={defaults.documentType}
            onChange={(e) => handleChange("documentType", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
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
