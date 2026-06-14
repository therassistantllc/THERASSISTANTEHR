"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for clearinghouse/Availity connection settings. This
 * page fetches the organization's clearinghouse connection record, if
 * any, and allows the user to update vendor, connection name, IDs,
 * ISA usage indicator, mode and active status. On save the record
 * is upserted into the `clearinghouse_connections` table and an
 * audit log entry is written. These values drive EDI envelope and
 * transport configuration but will not affect past submissions.
 */
interface ClearinghouseConnection {
  id?: string;
  vendor: string;
  name: string;
  submitter_id: string;
  receiver_id: string;
  receiver_name: string;
  isa_usage_indicator: string;
  mode: string;
  is_active: boolean;
}

export default function ClearinghouseSettingsPage() {
  const [connection, setConnection] = useState<ClearinghouseConnection>({
    vendor: "",
    name: "",
    submitter_id: "",
    receiver_id: "",
    receiver_name: "",
    isa_usage_indicator: "",
    mode: "",
    is_active: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchConnection() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("clearinghouse_connections")
        .select(
          "id, vendor, name, submitter_id, receiver_id, receiver_name, isa_usage_indicator, mode, is_active",
        )
        .eq("organization_id", ORGANIZATION_ID)
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setConnection({
          id: data.id,
          vendor: data.vendor ?? "",
          name: data.name ?? "",
          submitter_id: data.submitter_id ?? "",
          receiver_id: data.receiver_id ?? "",
          receiver_name: data.receiver_name ?? "",
          isa_usage_indicator: data.isa_usage_indicator ?? "",
          mode: data.mode ?? "",
          is_active: data.is_active ?? true,
        });
      }
      setLoading(false);
    }
    fetchConnection().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  const handleFieldChange = (
    field: keyof ClearinghouseConnection,
    value: string,
  ) => {
    setConnection((prev) => ({ ...prev, [field]: value }));
  };

  const handleCheckboxChange = (checked: boolean) => {
    setConnection((prev) => ({ ...prev, is_active: checked }));
  };

  const handleSave = async () => {
    // No required fields; vendor + submitter id recommended
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data: beforeData } = await supabase
        .from("clearinghouse_connections")
        .select(
          "id, vendor, name, submitter_id, receiver_id, receiver_name, isa_usage_indicator, mode, is_active",
        )
        .eq("organization_id", ORGANIZATION_ID)
        .maybeSingle();

      const upsertData = {
        id: connection.id || undefined,
        organization_id: ORGANIZATION_ID,
        vendor: connection.vendor || null,
        name: connection.name || null,
        submitter_id: connection.submitter_id || null,
        receiver_id: connection.receiver_id || null,
        receiver_name: connection.receiver_name || null,
        isa_usage_indicator: connection.isa_usage_indicator || null,
        mode: connection.mode || null,
        is_active: connection.is_active,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("clearinghouse_connections")
        .upsert([upsertData], { onConflict: "id" });
      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
        return;
      }

      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated clearinghouse connection",
        event_metadata: { before: beforeData, after: upsertData },
        object_type: "clearinghouse_connection",
        object_id: connection.id || null,
        action: "update",
      });

      setMessage("Clearinghouse settings saved successfully.");
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
      <h1 className="text-2xl font-semibold text-gray-900">
        Clearinghouse / Availity Settings
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Configure your clearinghouse connection. These values populate EDI
        envelopes and SFTP delivery but do not retroactively affect files
        already submitted.
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
            Vendor
          </label>
          <input
            type="text"
            value={connection.vendor}
            onChange={(e) => handleFieldChange("vendor", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Connection Name
          </label>
          <input
            type="text"
            value={connection.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Submitter ID
          </label>
          <input
            type="text"
            value={connection.submitter_id}
            onChange={(e) => handleFieldChange("submitter_id", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Receiver ID
          </label>
          <input
            type="text"
            value={connection.receiver_id}
            onChange={(e) => handleFieldChange("receiver_id", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Receiver Name
          </label>
          <input
            type="text"
            value={connection.receiver_name}
            onChange={(e) => handleFieldChange("receiver_name", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            ISA Usage Indicator (T/P)
          </label>
          <input
            type="text"
            value={connection.isa_usage_indicator}
            onChange={(e) => handleFieldChange("isa_usage_indicator", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={1}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Mode (test/production)
          </label>
          <input
            type="text"
            value={connection.mode}
            onChange={(e) => handleFieldChange("mode", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={connection.is_active}
            onChange={(e) => handleCheckboxChange(e.target.checked)}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
          />
          <label className="ml-2 block text-sm text-gray-700">Active</label>
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
